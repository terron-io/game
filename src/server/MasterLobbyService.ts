import { Worker } from "cluster";
import winston from "winston";
import {
  nextDiamondMatchAt,
  nextGoldenMatchAt,
  TERRON_DIAMOND_ENABLED,
  TERRON_GOLDEN_ENABLED,
} from "../core/configuration/TerronTuning";
import { PublicGameInfo, PublicGameType } from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  MasterCreateGame,
  MasterLobbiesBroadcast,
  MasterUpdateGame,
  WorkerMessageSchema,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { ServerEnv } from "./ServerEnv";

export interface MasterLobbyServiceOptions {
  playlist: MapPlaylist;
  log: typeof logger;
}

export class MasterLobbyService {
  private readonly workers = new Map<number, Worker>();
  // Worker id => the lobbies it owns.
  private readonly workerLobbies = new Map<number, PublicGameInfo[]>();
  private readonly readyWorkers = new Set<number>();
  private started = false;

  constructor(
    private playlist: MapPlaylist,
    private log: winston.Logger,
  ) {}

  registerWorker(workerId: number, worker: Worker) {
    this.workers.set(workerId, worker);

    worker.on("message", (raw: unknown) => {
      const result = WorkerMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from worker:", raw);
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case "workerReady":
          this.handleWorkerReady(msg.workerId);
          break;
        case "lobbyList":
          this.workerLobbies.set(workerId, msg.lobbies);
          // Заявка на смену карты обрабатывается сразу, не дожидаясь такта
          // планировщика (иначе +до 1с к задержке превью на витрине).
          if (msg.lobbies.some((l) => l.wantsMapRotation)) {
            void this.rotateRequestedLobbies();
          }
          break;
      }
    });
  }

  removeWorker(workerId: number) {
    this.workers.delete(workerId);
    this.workerLobbies.delete(workerId);
    this.readyWorkers.delete(workerId);
  }

  isHealthy(): boolean {
    // We consider the lobby service healthy if at least half of the workers are ready.
    // This allows for some leeway if a worker crashes.
    const minWorkers = Math.max(ServerEnv.numWorkers() / 2, 1);
    return this.started && this.readyWorkers.size >= minWorkers;
  }

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${ServerEnv.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size === ServerEnv.numWorkers() && !this.started) {
      this.started = true;
      this.log.info("All workers ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 500);
      startPolling(async () => await this.maybeScheduleLobby(), 1000);
    }
  }

  private getAllLobbies(): Record<PublicGameType, PublicGameInfo[]> {
    const lobbies = Array.from(this.workerLobbies.values()).flat();

    const result: Record<PublicGameType, PublicGameInfo[]> = {
      ffa: [],
      team: [],
      special: [],
      golden: [], // terron: золотой матч — свой тип, см. maintainEventLobby
      diamond: [], // terron: алмазный матч (раз в сутки), там же
    };

    for (const lobby of lobbies) {
      result[lobby.publicGameType].push(lobby);
    }

    for (const type of Object.keys(result) as PublicGameType[]) {
      result[type].sort((a, b) => {
        if (a.startsAt === undefined && b.startsAt === undefined) {
          // Sort by game id for stability.
          return a.gameID > b.gameID ? 1 : -1;
        }
        // If a lobby has startsAt set, we assume it's the active one.
        if (a.startsAt === undefined) return 1;
        if (b.startsAt === undefined) return -1;
        return a.startsAt - b.startsAt;
      });
    }

    return result;
  }

  private broadcastLobbies() {
    const msg = {
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: Date.now(),
        games: this.getAllLobbies(),
      },
    } satisfies MasterLobbiesBroadcast;
    for (const [workerId, worker] of this.workers.entries()) {
      worker.send(msg, (e) => {
        if (e) {
          this.log.error(
            `Failed to send lobbies broadcast to worker ${workerId}, killing worker:`,
            e,
          );
          worker.kill();
        }
      });
    }
  }

  // terron: ротация карты пустого лобби — КАК РАНЬШЕ, но без старта пустых игр.
  // История: до 14.07 пустое лобби каждые ~10с СТАРТОВАЛО (пул из ~12 бот-игр
  // по 400 ботов жёг CPU) и пересоздавалось — это и давало смену карты каждые
  // 10с. Фикс 14.07 убрал старты, но случайно убил и ротацию. Теперь семантика:
  // отсчёт пустого лобби дотикивает до нуля (пила воркера) → мастер в этот
  // момент меняет карту + перезаряжает отсчёт. Лобби с людьми не трогаем —
  // их отсчёт настоящий и кончается стартом (+ воркер-гарды от гонки по IPC).
  // ⚠️ 20.07: момент истечения фиксирует ВОРКЕР (флаг wantsMapRotation), а не
  // мастер по своим часам. Мастер сравнивал now с закэшированным startsAt, но
  // воркер продлевает startsAt ПЕРЕД отправкой lobbyList → истёкший таймер был
  // виден мастеру лишь в узком окне IPC-лага. Сдвиг фазы таймера (заход-выход
  // игрока в лобби) закрывал это окно НАВСЕГДА — «Марс висит вечно» (репорт
  // владельца 20.07: ffa встало, team/special крутились).
  // Дебаунс: вью мастера обновляется lobbyList-ами с лагом ~1с — без него
  // мастер слал бы ротацию дважды за одно истечение (флаг ещё не погашен).
  private static readonly ROTATE_DEBOUNCE_MS = 3_000;
  private readonly lastMapRotation = new Map<string, number>();

  // Смена карты по заявке воркера. Зовётся и по такту планировщика, и СРАЗУ по
  // приходу lobbyList — витрина не должна ждать следующего такта (это и был
  // «превью меняется на секунду позже нуля»).
  private async rotateIfRequested(
    type: PublicGameType,
    lobby: PublicGameInfo | undefined,
  ) {
    // terron: у событийных лобби своё расписание — общая ротация ставит
    // startsAt = now + отсчёт лобби и уводила бы старт с сетки часов (репорт владельца
    // 28.07: «запускаешь в 45 минут»). Карту им меняет maintainEventLobby.
    if (MasterLobbyService.isEvent(type)) return;
    if (!lobby || lobby.startsAt === undefined) return;
    if (lobby.numClients !== 0 || lobby.wantsMapRotation !== true) return;
    const now = Date.now();
    const last = this.lastMapRotation.get(lobby.gameID) ?? 0;
    if (now - last <= MasterLobbyService.ROTATE_DEBOUNCE_MS) return;
    this.lastMapRotation.set(lobby.gameID, now);
    this.sendMessageToWorker({
      type: "updateLobby",
      gameID: lobby.gameID,
      startsAt: now + ServerEnv.gameCreationRate(),
      gameConfig: await this.playlist.gameConfig(type),
    });
    this.log.info(`rotated empty ${type} lobby map`, { gameID: lobby.gameID });
  }

  private async rotateRequestedLobbies() {
    const lobbiesByType = this.getAllLobbies();
    for (const type of Object.keys(lobbiesByType) as PublicGameType[]) {
      // своё расписание, см. maintainEventLobby
      if (MasterLobbyService.isEvent(type)) continue;
      await this.rotateIfRequested(type, lobbiesByType[type][0]);
    }
  }

  // terron: СОБЫТИЙНЫЕ ЛОББИ — золотой (TERRON_GOLDEN_*) и алмазный
  // (TERRON_DIAMOND_*) матчи. Устройство у них общее, отличаются только
  // расписанием и наградой, поэтому конвейер тут ОДИН на оба типа.
  //
  // Такое лобби живёт ПОСТОЯННО (на витрине — соседняя вкладка к ротационному
  // ффа) и стартует строго по расписанию: золотое раз в
  // TERRON_GOLDEN_PERIOD_MINUTES, алмазное раз в сутки в TERRON_DIAMOND_HOUR_MSK.
  // Зайти и позвать друзей (ссылки /gold и /diamond) можно в любой момент, а не
  // за минуту до старта — у алмазного это вообще главное свойство: люди должны
  // видеть событие весь день. Победитель получает алмазы + ачивку — начисляет
  // API на архиве матча.
  //
  // Мастер держит РОВНО ОДНО лобби каждого типа и всё время подтягивает его
  // startsAt к ближайшему слоту расписания. Стартовало (значит, люди пришли) →
  // создаём следующее. Слот прошёл впустую (никого не было) → лобби живёт
  // дальше, ждёт следующего слота и меняет карту (заявка ротации от воркера).
  private static isEvent(type: PublicGameType): boolean {
    return type === "golden" || type === "diamond";
  }

  private readonly lastEventSentAt = new Map<PublicGameType, number>();
  private readonly lastEventCreatedAt = new Map<PublicGameType, number>();

  private async maintainEventLobby(
    type: "golden" | "diamond",
    lobbies: PublicGameInfo[],
  ) {
    if (type === "golden" && !TERRON_GOLDEN_ENABLED) return;
    if (type === "diamond" && !TERRON_DIAMOND_ENABLED) return;
    const now = Date.now();
    const eventAt =
      type === "diamond" ? nextDiamondMatchAt(now) : nextGoldenMatchAt(now);
    const lobby = lobbies[0];
    if (!lobby) {
      // Вью мастера отстаёт на такт lobbyList (~0.5-1с), а планировщик тикает
      // раз в секунду: без паузы создали бы ВТОРОЕ событийное лобби, не
      // дождавшись первого. Их должно быть ровно по одному на тип.
      if (now - (this.lastEventCreatedAt.get(type) ?? 0) < 5_000) return;
      this.lastEventCreatedAt.set(type, now);
      this.sendMessageToWorker({
        type: "createGame",
        gameID: generateID(),
        gameConfig: await this.playlist.gameConfig(type),
        publicGameType: type,
      } satisfies MasterCreateGame);
      this.log.info(`created ${type} match lobby`, {
        startsAt: new Date(eventAt).toISOString(),
      });
      return;
    }
    // Пустое лобби на просроченном слоте просит новую карту — отдаём её вместе
    // с новым временем (иначе воркер сам поставит now + отсчёт лобби, как карусели).
    const wantsRotation =
      lobby.numClients === 0 && lobby.wantsMapRotation === true;
    // ⚠️ ГЛАВНОЕ: время НАСТУПИЛО, а лобби не просит ротацию — значит внутри
    // люди и матч вот-вот стартует. Трогать startsAt тут НЕЛЬЗЯ: nextGoldenMatchAt
    // уже показывает СЛЕДУЮЩИЙ слот, и мы бы отодвинули старт на час, опередив
    // тик воркера (репорт владельца 28.07: «не стартанул, таймер пошёл заново»).
    // Гонка была ровно на секунду и потому ловилась через раз.
    const expired = lobby.startsAt !== undefined && lobby.startsAt <= now;
    if (expired && !wantsRotation) return;
    if (lobby.startsAt === eventAt && !wantsRotation) return;
    // Троттл, а НЕ «отправили один раз»: вью мастера отстаёт на такт lobbyList,
    // и по разовой отправке startsAt мог остаться сбитым навсегда (воркер тоже
    // двигает таймер пустым лобби) — событийный матч уезжал с сетки часов.
    if (now - (this.lastEventSentAt.get(type) ?? 0) < 2_000) return;
    this.lastEventSentAt.set(type, now);
    this.sendMessageToWorker({
      type: "updateLobby",
      gameID: lobby.gameID,
      startsAt: eventAt,
      gameConfig: wantsRotation
        ? await this.playlist.gameConfig(type)
        : undefined,
    });
  }

  // terron 29.07: ЗОЛОТОЕ И ОБЫЧНЫЕ ЛОББИ ПОЛНОСТЬЮ РАЗВЯЗАНЫ (решение владельца).
  // Здесь была «заморозка» ффа-карусели за 70с до золотого — её лобби ждало,
  // пока уйдёт золотое. Идея была в концентрации онлайна, но на деле это
  // связывало два независимых конвейера: обычный ротатор вставал, таймер ффа
  // показывал минуту вместо 10 секунд, и любая правка золотого рисковала
  // сломать обычные матчи. Теперь золотой матч — ЧИСТО ДОПОЛНИТЕЛЬНЫЙ модуль:
  // сервер про связь не знает вообще, а «главность» золотого перед стартом —
  // исключительно клиентская витрина (вкладки меняются местами, см.
  // GameModeSelector.goldenIsFeatured).

  private async maybeScheduleLobby() {
    const lobbiesByType = this.getAllLobbies();

    // Чистка трекера ротаций от умерших лобби (иначе Map растёт вечно).
    const liveIDs = new Set(
      Object.values(lobbiesByType)
        .flat()
        .map((l) => l.gameID),
    );
    for (const id of this.lastMapRotation.keys()) {
      if (!liveIDs.has(id)) this.lastMapRotation.delete(id);
    }

    for (const type of Object.keys(lobbiesByType) as PublicGameType[]) {
      const lobbies = lobbiesByType[type];

      // terron: у событийных лобби своё расписание и ровно один экземпляр —
      // общий конвейер (таймер отсчёта лобби, две штуки в очереди) к ним не применяем.
      if (MasterLobbyService.isEvent(type)) {
        await this.maintainEventLobby(type as "golden" | "diamond", lobbies);
        continue;
      }

      const nextLobby = lobbies[0];

      // Always ensure the next lobby has a timer, even if we already have 2+
      // lobbies. This prevents a race where two lobbies are created before
      // either receives a startsAt (IPC round-trip delay), leaving both stuck
      // without a countdown.
      if (nextLobby && nextLobby.startsAt === undefined) {
        this.sendMessageToWorker({
          type: "updateLobby",
          gameID: nextLobby.gameID,
          startsAt: Date.now() + ServerEnv.gameCreationRate(),
        });
      }

      await this.rotateIfRequested(type, nextLobby);

      if (lobbies.length >= 2) {
        continue;
      }

      this.sendMessageToWorker({
        type: "createGame",
        gameID: generateID(),
        gameConfig: await this.playlist.gameConfig(type),
        publicGameType: type,
      } satisfies MasterCreateGame);
    }
  }

  private sendMessageToWorker(msg: MasterCreateGame | MasterUpdateGame): void {
    const workerId = ServerEnv.workerIndex(msg.gameID);
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.log.error(`Worker ${workerId} not found`);
      return;
    }
    worker.send(msg, (e) => {
      if (e) {
        this.log.error(
          `Failed to send message to worker ${workerId}, killing worker:`,
          e,
        );
        worker.kill();
      }
    });
  }
}
