import { Colord } from "colord";
import { base64url } from "jose";
import { assetUrl } from "../core/AssetUrls";
import { decodePatternData } from "../core/PatternDecoder";
import { PlayerType, UnitType } from "../core/game/Game";
import { GameView } from "../core/game/GameView";
import { flagImageUrl, flagImageUrlSync } from "./Cosmetics";
import { uploadFrameData } from "./render/frame/Upload";
import {
  PlayerStatic,
  SpawnCenter,
  GameView as WebGLGameView,
} from "./render/gl";

const PALETTE_SIZE = 4096;

// data-URL (кастомный загруженный скин) и полные URL отдаём как есть; ассет-пути
// прогоняем через assetUrl.
function resolveSkinUrl(url: string): string {
  return /^(data:|https?:)/.test(url) ? url : assetUrl(url);
}

/**
 * The renderer-side glue between GameView (which already builds the full
 * FrameData each tick) and the WebGL view. Two responsibilities:
 *
 *   1. Palette management — translate PlayerView colors into a Float32Array
 *      the renderer uploads to a 1D texture, and call view.addPlayers() when
 *      new players appear (this is a renderer-side lifecycle event, not part
 *      of FrameData).
 *   2. Per-tick upload — pass the FrameData to the renderer's uploadFrameData
 *      helper, which dispatches to all the view.update*() methods.
 */
export class WebGLFrameBuilder {
  private readonly palette: Float32Array;
  private readonly patternMeta: Float32Array;
  private readonly patternData: Uint8Array;

  private readonly knownSmallIDs = new Set<number>();
  /**
   * Last spawn tile pushed to the renderer per smallID. Players can re-pick
   * spawn during the spawn phase, so this tracks the latest value rather than
   * just first-seen — re-uploads only when the tile actually changes.
   */
  private readonly lastSpawnTile = new Map<number, number>();
  /** Skin atlas allocated once on first syncPlayers — player set is locked at game start. */
  private skinsInitialized = false;
  /** terron: dev-скин (localStorage["dev-skin"]) уже применён к локальному игроку. */
  private devSkinApplied = false;
  // The renderer needs to know which player is "me" so affiliation tint,
  // unit colors, and SAM-radius perspective work. Push it once the local
  // player's update arrives (may take several ticks during join).
  private localPlayerSmallID = 0;
  // Scratch buffer for terrain-delta uploads (parallel to the refs list).
  private terrainDeltaBytes: Uint8Array = new Uint8Array(0);

  constructor(private readonly view: WebGLGameView) {
    this.palette = new Float32Array(PALETTE_SIZE * 2 * 4);
    this.patternMeta = new Float32Array(PALETTE_SIZE * 4);
    this.patternData = new Uint8Array(PALETTE_SIZE * 1024);
  }

  /**
   * Дособрать ленивые GL-пассы в простое (зовётся после первого хода).
   * Пробрасывает вызов в GL-вид — раннер держит билдер, а не вид напрямую.
   */
  warmLazyPasses(): void {
    this.view.warmLazyPasses();
  }

  /** Drop internal caches to force a full re-upload of state on the next update(). */
  clearCaches(): void {
    this.knownSmallIDs.clear();
    this.lastSpawnTile.clear();
    this.localPlayerSmallID = 0;
    this.skinsInitialized = false;
    this.devSkinApplied = false;
    this.lastFog = null;
  }

  /**
   * terron (dev/демо): localStorage["dev-skin"] = JSON
   * { url, mode (0 stamp|1 tile|2 stretch), tileTiles, dim }. Применяется к
   * локальному игроку, чтобы админ видел скин в игре до появления админки/выбора.
   */
  private getDevSkin(): {
    url: string;
    mode: number;
    tileTiles: number;
    dim: number;
    aspect: number;
  } | null {
    try {
      const raw = localStorage.getItem("dev-skin");
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.url !== "string") return null;
      return {
        url: o.url,
        mode: Number(o.mode) || 0,
        tileTiles: Number(o.tileTiles) || 8,
        dim: o.dim === undefined ? 1 : Number(o.dim),
        aspect: Number(o.aspect) || 1,
      };
    } catch {
      return null;
    }
  }

  // terron 20.07: один ингест = один кадр работы главного потока. Когда он
  // распухает, страница просто ЗАМИРАЕТ — именно так выглядел квадратичный
  // подбор цветов игроков (2.4-3.8с на первом тике: «камера мертва, ввод не
  // работает»). Датчик держит правку под наблюдением: порог 800мс, репорт
  // один раз на вкладку (капы Health и так не дадут больше пяти).
  private slowIngestReported = false;

  update(gameView: GameView): void {
    const t0 = performance.now();
    this.syncPlayers(gameView);
    this.syncPlayerSpawns(gameView);
    this.syncLocalPlayer(gameView);
    this.syncSpawnOverlay(gameView);
    this.syncTerrainDeltas(gameView);
    this.syncFog(gameView);
    this.syncSatCastPings(gameView);
    this.syncFortShots(gameView);
    this.syncClosedCountries(gameView);
    uploadFrameData(this.view, gameView.frameData());
    const ms = Math.round(performance.now() - t0);
    if (ms > 800 && !this.slowIngestReported) {
      this.slowIngestReported = true;
      const ticks = gameView.ticks();
      void import("./Health").then(({ reportHealth }) =>
        reportHealth("slow_ingest", `${ms}мс на тике ${ticks}`),
      );
    }
  }

  /**
   * terron: туман войны. Формула «туман активен для меня» живёт в
   * GameView.fogOfWarActive() (единый источник с CPU-гейтами кликов): опция
   * лобби (с самой спавн-фазы) ИЛИ блэкаут «Неба нашего», минус реплей/смерть/
   * владелец. Переключение, совпавшее с окном блэкаута, анимируется ВОЛНОЙ из
   * эпицентра запуска (TERRON_OURSKY_WAVE_MS); возврат тумана в матче С
   * лобби-туманом — ОБРАТНОЙ волной (круг света схлопывается в эпицентр,
   * решение владельца 12.07). Прочие переходы — мгновенные. Плюс каждый тик
   * пушим ревилы (окна видимости после своих ударов).
   */
  private lastFog: boolean | null = null;
  private syncFog(gameView: GameView): void {
    // Ревилы — каждый тик (радиус схлопывается со временем).
    this.view.setFogReveals(gameView.fogReveals());

    const on = gameView.fogOfWarActive();
    if (on === this.lastFog) return;
    this.lastFog = on;
    let wave: { x: number; y: number; contract: boolean } | undefined;
    const b = gameView.satBlackoutRaw();
    if (b !== null) {
      const t = gameView.ticks();
      if (t >= b.blastTick - 20 && t <= b.endTick + 20) {
        wave = {
          x: gameView.x(b.epicenter),
          y: gameView.y(b.epicenter),
          // Туман ВКЛЮЧАЕТСЯ поверх лобби-тумана (владелец теряет спутниковое
          // окно) → обратная анимация: круг света схлопывается в эпицентр.
          contract: on && gameView.config().fogOfWar(),
        };
      }
    }
    this.view.setFogOfWar(on, wave);
  }

  /**
   * terron: «Небо наше» — пульс-кольца на СОБИРАЮЩЕЙСЯ ракете «Сбить спутники»
   * (реворк 21.08: телеграф переехал со штаба на носитель-каст): маркер «вот
   * кого сносить» всем. Носитель весь свой век в underConstruction, поэтому
   * пингуем любой живой — маркер горит всю сборку, до запуска.
   */
  private syncSatCastPings(gameView: GameView): void {
    if (gameView.ticks() % 15 !== 0) return; // раз в 1.5с
    for (const u of gameView.units(UnitType.SatelliteStrike)) {
      const t = u.tile();
      this.view.pushSatCastPing(gameView.x(t), gameView.y(t));
    }
  }

  /**
   * terron: ЗАКРЫТАЯ СТРАНА — раз в секунду пересчитываем, чьи подписи войск на
   * карте скрыты от нас (штаб стоит и это не мы/не наша команда). Дёшево:
   * штабов единицы, проходим только их владельцев.
   */
  private lastHiddenKey = "";
  private syncClosedCountries(gameView: GameView): void {
    if (gameView.ticks() % 10 !== 0) return;
    const hidden = new Set<number>();
    for (const u of gameView.units(UnitType.ClosedCountry)) {
      if (u.isUnderConstruction()) continue;
      const owner = u.owner();
      if (gameView.statsHiddenFor(owner)) hidden.add(owner.smallID());
    }
    const key = [...hidden].sort((a, b) => a - b).join(",");
    if (key === this.lastHiddenKey) return;
    this.lastHiddenKey = key;
    this.view.setTroopsHidden(hidden);
    // terron (22.08, решение владельца): закрытая страна прячет и СОДЕРЖИМОЕ —
    // постройки и технику, не только цифры. Фильтр живёт в Renderer.
    this.view.setUnitsHidden(hidden);
  }

  /**
   * terron: Укрепления — снаряд-«выстрел» бункера/штаба ПО ЗАХВАЧЕННОМУ тайлу
   * (летящая белая точка from→to, как реальный Shell). Сим шлёт пары
   * бункер→тайл на каждый захват (FortShotUpdate); тут пушим их в FX, который
   * анимирует полёт по кадрам. Захват тихий (прямой conquer), поэтому визуал —
   * тут, из сим-события, а не из боевого юнита.
   */
  private syncFortShots(gameView: GameView): void {
    for (const s of gameView.fortShots()) {
      this.view.pushFortShot(
        gameView.x(s.from),
        gameView.y(s.from),
        gameView.x(s.to),
        gameView.y(s.to),
      );
    }
  }

  /**
   * Push each player's current spawn tile to the renderer as the skin anchor
   * (image center lines up with this tile). Players re-pick spawn during the
   * spawn phase, so we re-upload whenever the tile changes, not just on first
   * sighting. Once spawn phase ends, spawnTile is locked and this becomes a
   * no-op via the cache check.
   */
  private syncPlayerSpawns(gameView: GameView): void {
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      const spawnTile = p.state.spawnTile;
      if (spawnTile === undefined) continue;
      if (this.lastSpawnTile.get(smallID) === spawnTile) continue;
      this.lastSpawnTile.set(smallID, spawnTile);
      this.view.setPlayerSpawn(
        smallID,
        gameView.x(spawnTile),
        gameView.y(spawnTile),
      );
    }
  }

  /**
   * Water-nuke conversions (land → water) mutate the underlying terrain.
   * Forward this tick's terrain-changed refs to the renderer so it can
   * re-upload those texels in both the RGBA color texture and the R8UI
   * water-detection texture used by railroads/bridges.
   */
  private syncTerrainDeltas(gameView: GameView): void {
    const refs = gameView.recentlyUpdatedTerrainTiles();
    if (refs.length === 0) return;
    if (this.terrainDeltaBytes.length < refs.length) {
      this.terrainDeltaBytes = new Uint8Array(refs.length);
    }
    for (let i = 0; i < refs.length; i++) {
      this.terrainDeltaBytes[i] = gameView.terrainByte(refs[i]);
    }
    this.view.applyTerrainDelta(refs, this.terrainDeltaBytes);
  }

  private syncLocalPlayer(gameView: GameView): void {
    const sid = gameView.myPlayer()?.smallID() ?? 0;
    if (sid === this.localPlayerSmallID) return;
    this.localPlayerSmallID = sid;
    this.view.setLocalPlayerID(sid);
  }

  /**
   * Spawn-phase highlights: each already-spawned human player gets a colored
   * ring + tile glow around their starting territory. Pushed every tick
   * during spawn phase; the pass animates locally from the snapshot.
   */
  private syncSpawnOverlay(gameView: GameView): void {
    const inSpawnPhase = gameView.inSpawnPhase();
    if (!inSpawnPhase) {
      this.view.updateSpawnOverlay(false, []);
      return;
    }
    const me = gameView.myPlayer();
    const myTeam = me?.team() ?? null;
    // terron: туман со спавн-фазы — чужие пики скрыты, свои/командные рисуются
    // ПОВЕРХ тумана (Renderer переносит спавн-оверлей за фог-композит).
    const fogged = gameView.fogOfWarActive();
    const centers: SpawnCenter[] = [];
    for (const p of gameView.players()) {
      if (!p.isPlayer() || p.type() !== PlayerType.Human) continue;
      const spawnTile = p.state.spawnTile;
      if (spawnTile === undefined) continue;
      const isSelf = me !== null && p.smallID() === me.smallID();
      if (fogged && !isSelf) {
        const teammate =
          myTeam !== null &&
          p.team() === myTeam &&
          p.smallID() !== me?.smallID();
        if (!teammate) continue;
      }
      // myPlayer reads as a near-white with a faint gold/silver tint so the
      // local-player ring is visually distinct from any team color; everyone
      // else uses their territory tint.
      const c = isSelf
        ? { r: 248, g: 218, b: 140 }
        : p.territoryColor().toRgb();
      centers.push({
        // spawnTile tracks the player's currently-selected spawn directly —
        // updates the same tick the player picks a new location (faster than
        // the nameData centroid which only refreshes every 2 ticks).
        x: gameView.x(spawnTile),
        y: gameView.y(spawnTile),
        r: c.r / 255,
        g: c.g / 255,
        b: c.b / 255,
        isSelf,
        isTeammate:
          myTeam !== null &&
          p.team() === myTeam &&
          p.smallID() !== me?.smallID(),
      });
    }
    this.view.updateSpawnOverlay(true, centers);
  }

  private syncPlayers(gameView: GameView): void {
    if (!this.skinsInitialized) {
      this.skinsInitialized = true;
      const urls = new Set<string>();
      // letterbox — статичные (mode 4, CONTAIN без кропа); stretch — растягиваемые
      // (mode 2, заливка в квадрат, шейдер cover'ит по истинным пропорциям).
      const letterbox = new Set<string>();
      const stretch = new Set<string>();
      const classify = (url: string, mode: number) => {
        if (mode === 4) letterbox.add(url);
        // stretch = растяг в квадрат (полная картинка без обрезки): cover-зона (mode 2)
        // и тайл (1/3, форму восстанавливает прямоугольная ячейка по aspect в шейдере).
        else if (mode === 2 || mode === 1 || mode === 3) stretch.add(url);
      };
      for (const p of gameView.players()) {
        const url = p.cosmetics.skin?.url;
        if (url) urls.add(assetUrl(url));
        // terron виральность: named-скин владельца. url несёт data_url/путь-пресет →
        // резолвим как dev-skin (data: как есть, путь → assetUrl), без кросс-ориджин.
        const cs = p.cosmetics.customSkin;
        if (cs?.url) {
          const r = resolveSkinUrl(cs.url);
          urls.add(r);
          classify(r, cs.mode);
        }
      }
      // terron: зарегистрировать URL активного/dev-скина в атласе (фиксируется тут).
      const dev = this.getDevSkin();
      if (dev) {
        const r = resolveSkinUrl(dev.url);
        urls.add(r);
        classify(r, dev.mode);
      }
      this.view.initSkinAtlas([...urls], letterbox, stretch);
    }

    // terron: применить dev-скин (ручная инъекция/локальный) к локальному игроку.
    if (!this.devSkinApplied) {
      const dev = this.getDevSkin();
      const meId = gameView.myPlayer()?.smallID();
      if (dev && meId !== undefined && meId > 0) {
        this.view.setPlayerSkin(meId, resolveSkinUrl(dev.url));
        this.view.setPlayerSkinParams(
          meId,
          dev.mode,
          dev.tileTiles,
          dev.dim,
          dev.aspect,
        );
        this.devSkinApplied = true;
      }
    }
    const newPlayers: PlayerStatic[] = [];
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      if (this.knownSmallIDs.has(smallID)) continue;
      this.knownSmallIDs.add(smallID);

      this.writePaletteEntry(smallID, p.territoryColor(), p.borderColor());

      // p.cosmetics.flag: сервер резолвит flag:/country: в URL/путь (assetUrl их
      // пропускает), а КЛАН-флаг отдаёт СЫРЫМ `clan:tag` — его резолвит КЛИЕНТ
      // async (Cosmetics.resolveFlagUrl→fetchClanFlagUrl). Поэтому clan: ставим
      // позже через setPlayerFlag (assetUrl("clan:tag") не резолвится → раньше
      // на карте флага не было). См. BACKLOG / Privilege.isFlagAllowed.
      const flagRef = p.cosmetics.flag;
      // Формат ссылки разбирает Cosmetics.flagImageUrl* — ОДНА точка на всех
      // потребителей флага (карта и панель игрока). Готовое — сразу в палитру,
      // остальное (clan:/flag:) доезжает async через setPlayerFlag.
      const flagUrl = flagImageUrlSync(flagRef);
      if (flagRef && flagUrl === undefined) {
        void flagImageUrl(flagRef)
          .then((url) => {
            if (url) this.view.setPlayerFlag(smallID, url);
          })
          .catch(() => {});
      }

      const skin = p.cosmetics.skin;
      if (skin?.url) {
        this.view.setPlayerSkin(smallID, assetUrl(skin.url));
      }
      // terron виральность: named-скин владельца — текстура + per-owner режим/dim/плитка
      // надеваются ВСЕМ клиентам (у каждого свой режим одновременно).
      const customSkin = p.cosmetics.customSkin;
      if (customSkin?.url) {
        this.view.setPlayerSkin(smallID, resolveSkinUrl(customSkin.url));
        this.view.setPlayerSkinParams(
          smallID,
          customSkin.mode,
          customSkin.tileTiles,
          customSkin.dim,
          customSkin.aspect ?? 1,
        );
      }

      const pattern = p.cosmetics.pattern;
      if (pattern && pattern.patternData) {
        try {
          const decoded = decodePatternData(
            pattern.patternData,
            base64url.decode,
          );
          const metaOff = smallID * 4;
          this.patternMeta[metaOff] = 1.0; // hasPattern = true
          this.patternMeta[metaOff + 1] = decoded.width;
          this.patternMeta[metaOff + 2] = decoded.height;
          this.patternMeta[metaOff + 3] = decoded.scale;

          this.patternData.set(decoded.bytes.slice(3), smallID * 1024);
        } catch (e) {
          console.warn("Failed to decode territory pattern", e);
        }
      }

      newPlayers.push({
        ...p.static,
        flag: flagUrl,
        color: p.territoryColor().toHex(),
      });
    }
    if (newPlayers.length > 0) {
      this.view.addPlayers(
        newPlayers,
        this.palette,
        this.patternMeta,
        this.patternData,
      );
    }
  }

  private writePaletteEntry(
    smallID: number,
    fill: Colord,
    border: Colord,
  ): void {
    const fillRgba = fill.toRgb();
    const fillOff = smallID * 4;
    this.palette[fillOff] = fillRgba.r / 255;
    this.palette[fillOff + 1] = fillRgba.g / 255;
    this.palette[fillOff + 2] = fillRgba.b / 255;
    this.palette[fillOff + 3] = 150 / 255;

    const borderRgba = border.toRgb();
    const borderOff = PALETTE_SIZE * 4 + smallID * 4;
    this.palette[borderOff] = borderRgba.r / 255;
    this.palette[borderOff + 1] = borderRgba.g / 255;
    this.palette[borderOff + 2] = borderRgba.b / 255;
    this.palette[borderOff + 3] = 1.0;
  }
}
