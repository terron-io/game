// terron 12.09: ПРИКАЗЫ ЗА ОБРЫВ СЕТИ — «ОТПРАВИЛ» ≠ «СЕРВЕР ПОЛУЧИЛ».
//
// Тест владельца на деве 12.09 (выключил Wi-Fi посреди матча, отдал атаку,
// включил) показал, что фикс 04.09 до приказов не доходил вовсе:
//  1) Transport.sendIntent при закрытом сокете НЕ звал sendMsg — печатал
//     «WebSocket is not open… attempting reconnect» и выбрасывал приказ. Буфер
//     до подтверждения джойна жил в sendMsg, куда приказы не попадали.
//  2) Первые ~5 секунд обрыва сокет считается ОТКРЫТЫМ (обрыв замечает только
//     сторож «нет сообщений 5 с»), и приказы уходят в мёртвое соединение —
//     теряются без следа, никакой буфер их не видит.
//
// Лечение — очередь до ЭХА: сервер кладёт каждый принятый приказ в ход
// дословно, со своим штампом clientID (GameServer → addIntent), и ход приходит
// обратно всем, включая автора. Значит клиент может знать, что приказ дошёл:
// запись снимается, когда её копия вернулась в ходе. Всё, что ушло в прежний
// сокет и так и не вернулось, после переподключения досылается ОДИН раз.
//
// Дубля не будет: при rejoin сервер снимает обработчики со старого сокета
// (rejoinClient → removeAllListeners), то есть приказ из старого соединения
// либо уже лежит в ходе (придёт в start-сообщении или первом ходе после него),
// либо сервер его больше не примет. Поэтому досылка — на первом ходе ПОСЛЕ
// start на новом сокете, а не раньше.
//
// Отслеживаем только типы, которые сервер кладёт в ход как есть: у лобби- и
// служебных приказов (конфиг, старт, кик, жалоба, пауза) эха в ходах нет, и
// они висели бы «неподтверждёнными» вечно.

/** Типы, которые сервер кладёт в ход дословно (ветка addIntent в GameServer). */
export const RELIABLE_INTENT_TYPES: ReadonlySet<string> = new Set([
  "attack",
  "boat",
  "air_assault",
  "spawn",
  "allianceRequest",
  "allianceReject",
  "allianceExtension",
  "breakAlliance",
  "targetPlayer",
  "emoji",
  "embargo",
  "embargo_all",
  "donate_gold",
  "donate_troops",
  "build_unit",
  "upgrade_structure",
  "cancel_attack",
  "cancel_boat",
  "move_warship",
  "delete_unit",
  "quick_chat",
  "choose_ultimate",
]);

/** Приказ старше этого не досылаем: за полминуты без связи карта успевает
 *  измениться, и давняя атака может ударить не туда, куда игрок целился. */
export const OUTBOX_MAX_AGE_MS = 30_000;
/** Сервер пропускает 10 приказов в секунду (ClientMsgRateLimiter) — досылка
 *  пачкой больше этого упрётся в лимит и потеряет хвост. */
export const OUTBOX_MAX_RESEND = 10;
/** Потолок памяти: неподтверждённые приказы, которые сервер отверг сам. */
const OUTBOX_MAX_ENTRIES = 200;

interface Entry {
  key: string;
  wire: string;
  at: number;
  /** Номер сокета, в который приказ ушёл; null — ещё не отправлен. */
  sentOn: number | null;
}

function canon(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

/** Ключ приказа без штампа сервера и без зависимости от порядка полей
 *  (zod на сервере и на клиенте пересобирает объект в порядке схемы). */
export function intentKey(intent: object): string {
  const { clientID: _stamp, ...rest } = intent as { clientID?: unknown };
  return JSON.stringify(canon(rest));
}

export class IntentOutbox {
  private entries: Entry[] = [];
  private socketNo = 0;

  constructor(
    private readonly maxAgeMs = OUTBOX_MAX_AGE_MS,
    private readonly maxResend = OUTBOX_MAX_RESEND,
  ) {}

  get size(): number {
    return this.entries.length;
  }

  /** Открывается новый сокет: всё, что ушло в прежний, теперь под вопросом. */
  newSocket(): void {
    this.socketNo++;
  }

  /** Запомнить приказ; sent — ушёл ли он в текущий сокет прямо сейчас. */
  track(intent: object, wire: string, now: number, sent: boolean): void {
    // Подтверждения от текущего сокета, не пришедшие за срок, — приказы,
    // которые сервер отверг сам (лимит, замок ульты, пауза). Досылать их
    // незачем, держать тоже.
    const cutoff = now - this.maxAgeMs;
    this.entries = this.entries.filter(
      (e) => e.at >= cutoff || e.sentOn !== this.socketNo,
    );
    this.entries.push({
      key: intentKey(intent),
      wire,
      at: now,
      sentOn: sent ? this.socketNo : null,
    });
    if (this.entries.length > OUTBOX_MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - OUTBOX_MAX_ENTRIES);
    }
  }

  /** Эхо сервера: снимаем по одной записи на каждый свой приказ в ходе
   *  (первую подходящую — два одинаковых клика подряд снимаются по одному). */
  ack(
    intents: ReadonlyArray<{ clientID?: unknown }>,
    myClientID: string | null,
  ): number {
    if (myClientID === null || this.entries.length === 0) return 0;
    let n = 0;
    for (const it of intents) {
      if (it.clientID !== myClientID) continue;
      const key = intentKey(it);
      const i = this.entries.findIndex(
        (e) => e.sentOn !== null && e.key === key,
      );
      if (i >= 0) {
        this.entries.splice(i, 1);
        n++;
        if (this.entries.length === 0) break;
      }
    }
    return n;
  }

  /** Что отправить сейчас, в исходном порядке.
   *  withStale=false — только не отправленные (тот же сокет, джойн подтверждён);
   *  withStale=true — ещё и ушедшие в прежний сокет без эха (первый ход после
   *  start на новом сокете). Просроченные и лишние сверх потолка выбрасываются. */
  take(now: number, withStale: boolean): { wires: string[]; dropped: number } {
    const cutoff = now - this.maxAgeMs;
    const isDue = (e: Entry) =>
      e.sentOn === null || (withStale && e.sentOn !== this.socketNo);
    let dropped = 0;
    const due: Entry[] = [];
    this.entries = this.entries.filter((e) => {
      if (!isDue(e)) return true;
      if (e.at < cutoff) {
        dropped++;
        return false;
      }
      due.push(e);
      return true;
    });
    let send = due;
    if (due.length > this.maxResend) {
      const cut = new Set(due.slice(0, due.length - this.maxResend));
      dropped += cut.size;
      this.entries = this.entries.filter((e) => !cut.has(e));
      send = due.slice(due.length - this.maxResend);
    }
    for (const e of send) e.sentOn = this.socketNo;
    return { wires: send.map((e) => e.wire), dropped };
  }
}
