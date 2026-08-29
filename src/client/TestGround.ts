// terron: ПОЛИГОН `/test` — песочница для проверки интерфейса и механик руками.
//
// Зачем отдельный вход: любую правку HUD надо щупать в ЖИВОМ матче, а живой
// матч — это либо ждать людей в лобби, либо одиночка, где тебя за минуту
// съедают племена и до проверки дело не доходит. Полигон снимает оба
// препятствия: маленькая карта (быстрая загрузка), бесконечное золото и войска
// (все кнопки доступны сразу и умереть нельзя), мгновенная стройка, немного
// слабых ботов — чтобы было по кому целиться.
//
// Адрес: `/test`, необязательный `?ui=classic|g|flanks|fan` сразу ставит схему
// управления (см. UserSettings.aimLayout) — чтобы переключать раскладки ссылкой,
// не лазая в настройки. `?map=Africa` — другая карта.

import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import {
  AIM_LAYOUTS,
  AimLayout,
  UserSettings,
} from "../core/game/UserSettings";
import { generateID } from "../core/Util";
import { getLocalStartCosmetics } from "./Cosmetics";
import type { JoinLobbyEvent } from "./Main";
import type { UsernameInput } from "./UsernameInput";

// Флаг «текущая игра — полигон». Ставится при запуске, читают слои обучения:
// подсказки новичку на стенде только мешают и закрывают треть экрана.
let testGroundActive = false;
export function isTestGroundActive(): boolean {
  return testGroundActive;
}
export function setTestGroundActive(v: boolean): void {
  testGroundActive = v;
}

/** Параметры полигона в одном месте — правь тут. */
export const TEST_GROUND_CONFIG = {
  // Britannia — компактная карта с длинным берегом: рядом и суша, и вода, и
  // соседи. На World полигон грузился бы дольше самой проверки.
  gameMap: GameMapType.Britannia,
  // terron 24.08 (просьба владельца «чтобы боты как-то быстрее развивались»):
  // сложность HARD. На Easy нации ползли, и через пять минут вокруг всё ещё
  // было пусто — щупать ульты не на ком.
  difficulty: Difficulty.Hard,
  bots: 20,
  infiniteGold: true,
  infiniteTroops: true,
  instantBuild: true,
  // terron 23.08: на полигоне ВСЕ ульты открыты — он для того и заведён,
  // чтобы щупать механики, а не собирать ачивки. Сервер выполнит это только
  // на деве (TERRON_ENV=dev), на проде поле игнорируется. TZ-ult-unlocks.md
  devUnlockUlts: true,
  // terron 23.08 (решение владельца): полигон должен позволять проверить
  // ЛЮБОЕ здание сразу, а не копить на него. Золото стартовое — потолок для
  // самых дорогих ульт с запасом; неуязвимость на старте, чтобы двадцать
  // ботов не съели раньше, чем поставишь первую постройку.
  startingGold: 30_000_000,
  spawnImmunityTicks: 30 * 10, // 30 секунд
} as const;

/** Адрес полигона (с учётом префикса воркера, как у /tutorial). */
export const TEST_GROUND_PATH = /^\/(?:w\d+\/)?test\/?$/;

/** `?ui=` → схема управления. Возвращает применённую (или null). */
export function applyTestGroundLayout(
  search: string,
  settings: UserSettings = new UserSettings(),
): AimLayout | null {
  const want = new URLSearchParams(search).get("ui");
  if (want === null) return null;
  if (!(AIM_LAYOUTS as readonly string[]).includes(want)) return null;
  settings.setAimLayout(want as AimLayout);
  return want as AimLayout;
}

/** `?map=` → карта полигона (по имени значения enum). Иначе дефолтная. */
export function testGroundMap(search: string): GameMapType {
  const want = new URLSearchParams(search).get("map");
  if (want === null) return TEST_GROUND_CONFIG.gameMap;
  const found = Object.values(GameMapType).find(
    (m) => m.toLowerCase() === want.toLowerCase().replace(/_/g, " "),
  );
  return found ?? TEST_GROUND_CONFIG.gameMap;
}

function username(): string {
  const el = document.querySelector("username-input") as UsernameInput | null;
  const u = el?.getUsername?.();
  if (u && u.trim()) return u;
  try {
    const stored = localStorage.getItem("username");
    if (stored && stored.trim()) return stored;
  } catch {
    /* приватный режим — не беда */
  }
  return "Полигон";
}

/** Собирает и диспатчит join-lobby с конфигом полигона. */
export async function launchTestGround(
  target: EventTarget = document.body,
  search: string = window.location.search,
): Promise<void> {
  setTestGroundActive(true);
  applyTestGroundLayout(search);

  const clientID = generateID();
  const gameID = generateID();
  const name = username();
  const el = document.querySelector("username-input") as UsernameInput | null;

  const detail: JoinLobbyEvent = {
    gameID,
    gameStartInfo: {
      gameID,
      players: [
        {
          clientID,
          username: name,
          clanTag: el?.getClanTag?.() ?? null,
          cosmetics: await getLocalStartCosmetics(name),
        },
      ],
      config: {
        gameMap: testGroundMap(search),
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        difficulty: TEST_GROUND_CONFIG.difficulty,
        bots: TEST_GROUND_CONFIG.bots,
        nations: "default",
        infiniteGold: TEST_GROUND_CONFIG.infiniteGold,
        infiniteTroops: TEST_GROUND_CONFIG.infiniteTroops,
        instantBuild: TEST_GROUND_CONFIG.instantBuild,
        devUnlockUlts: TEST_GROUND_CONFIG.devUnlockUlts,
        startingGold: TEST_GROUND_CONFIG.startingGold,
        spawnImmunityDuration: TEST_GROUND_CONFIG.spawnImmunityTicks,
        randomSpawn: false,
        donateGold: false,
        donateTroops: false,
        disabledUnits: [],
        maxTimerValue: undefined,
      },
      lobbyCreatedAt: Date.now(),
    },
    source: "singleplayer",
  };

  target.dispatchEvent(
    new CustomEvent("join-lobby", { detail, bubbles: true, composed: true }),
  );
}
