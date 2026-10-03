import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { Transport } from "../../src/client/Transport";

// terron 16.09: СВЁРНУТАЯ ВКЛАДКА ВЫЛЕТАЛА ИЗ ЛОББИ МОЛЧА (жалоба беты,
// KDaniilW в алмазном лобби 7JJbULxE). Пинг жил только на таймере раз в 5 с,
// Chrome будит таймеры скрытой вкладки раз в минуту → сервер через 60 с
// закрывал сокет кодом 1000 «no heartbeats received», а клиент считал 1000
// штатным и не переподключался. Игрок пропадал из лобби, вкладка показывала
// лобби дальше, матч стартовал без него. Прод за сутки: 10 из 11 лобби-обрывов
// не восстановились.

const src = readFileSync(join(__dirname, "..", "..", "src/client/Transport.ts"), "utf8");

describe("heartbeat drop is a drop, not a clean close", () => {
  test("server's «no heartbeats» close (1000) is recognised", () => {
    expect(
      Transport.isHeartbeatDrop(1000, "no heartbeats received, closing connection"),
    ).toBe(true);
  });

  test("other 1000 closes stay deliberate", () => {
    expect(Transport.isHeartbeatDrop(1000, "game has ended")).toBe(false);
    expect(Transport.isHeartbeatDrop(1000, "kick_reason.lobby_creator")).toBe(false);
    expect(Transport.isHeartbeatDrop(1000, "")).toBe(false);
    expect(Transport.isHeartbeatDrop(1006, "no heartbeats received")).toBe(false);
  });

  test("onclose reconnects on a heartbeat drop", () => {
    const i = src.indexOf("this.socket.onclose = (event: CloseEvent) => {");
    const body = src.slice(i, src.indexOf("\n    };\n", i));
    const branch = body.indexOf("Transport.isHeartbeatDrop(event.code, event.reason)");
    expect(branch).toBeGreaterThan(0);
    const after = body.slice(branch);
    expect(after.indexOf("this.scheduleReconnect();")).toBeGreaterThan(0);
    expect(after).toContain("this.closedOnPurpose = false;");
  });
});

describe("pings do not depend on throttled timers alone", () => {
  test("every server message may send a due ping", () => {
    const i = src.indexOf("this.socket.onmessage = (event: MessageEvent) => {");
    const body = src.slice(i, src.indexOf("this.onmessage(result.data);", i));
    expect(body).toContain("this.sendPingIfDue();");
  });

  test("due-ping is rate limited to the ping period", () => {
    const i = src.indexOf("private sendPingIfDue(): void {");
    const body = src.slice(i, src.indexOf("\n  }\n", i));
    expect(body).toContain("now - this.lastPingSentAt < Transport.PING_EVERY_MS");
    expect(body).toContain("this.lastPingSentAt = now;");
  });

  test("returning to the tab reconnects a dead socket, but not a deliberately closed one", () => {
    const i = src.indexOf("this.onVisibilityPing = () => {");
    const body = src.slice(i, src.indexOf("\n      };\n", i));
    expect(body).toContain("!this.closedOnPurpose");
    expect(body).toContain("this.scheduleReconnect();");
    const stop = src.slice(src.indexOf("private stopPing() {"));
    expect(stop.slice(0, stop.indexOf("\n  }\n"))).toContain(
      'removeEventListener("visibilitychange", this.onVisibilityPing)',
    );
  });
});
