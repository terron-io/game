// @vitest-environment jsdom
// terron 28.09: пока (re)join не подтверждён, в сокет уходит только сам джойн.
// Прод за сутки: сервер отбросил «до входа» 105 hash и 8 «старт» хоста.
// Обратный прогон: убери ветку flushBufferOnAck из sendMsg — краснеет.
import { describe, expect, it, vi } from "vitest";
import { Transport } from "../../src/client/Transport";

function transport(flag: boolean) {
  const t = Object.create(Transport.prototype) as any;
  const send = vi.fn();
  t.isLocal = false;
  t.buffer = [];
  t.flushBufferOnAck = flag;
  t.socket = { readyState: WebSocket.OPEN, send };
  return { t, send };
}

describe("буфер до подтверждения джойна", () => {
  it("hash и приказ хоста ждут подтверждения", () => {
    const { t, send } = transport(true);
    t.sendMsg({ type: "hash", turnNumber: 5, hash: 1 });
    t.sendMsg({ type: "intent", intent: { type: "request_start" } });
    expect(send).not.toHaveBeenCalled();
    expect(t.buffer).toHaveLength(2);
  });

  it("сам джойн и пинг уходят сразу", () => {
    const { t, send } = transport(true);
    t.sendMsg({ type: "rejoin", gameID: "g", lastTurn: 0, token: "x" });
    t.sendMsg({ type: "ping" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(t.buffer).toHaveLength(0);
  });

  it("после подтверждения всё идёт напрямую", () => {
    const { t, send } = transport(false);
    t.sendMsg({ type: "hash", turnNumber: 5, hash: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
