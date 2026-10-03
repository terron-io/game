import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

// terron 04.09: сторожа над пачкой фиксов по разбору хелса (конец недели):
// реконнект с паузой, коалесцер конфига лобби, шим хранилища, музыка без
// рекурсии Howler, GPU в сводке перфа, фильтр чужих скриптов. Сканеры — потому
// что все точки живут в тяжёлых модулях (сокет, Lit-модалка, index.html),
// которые в jsdom не поднять; каждый пункт проверен обратным прогоном.
const root = path.join(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("reconnect backoff (Transport)", () => {
  const src = read("src/client/Transport.ts");
  test("socket close (code ≠ 1000) goes through the scheduler, not straight reconnect()", () => {
    const i = src.indexOf("event.code !== 1000");
    expect(i).toBeGreaterThan(0);
    const branch = src.slice(i, i + 600);
    expect(branch).toContain("this.scheduleReconnect()");
    expect(branch).not.toMatch(/this\.reconnect\(\)/);
  });
  test("sending on a CLOSED socket does not open a connection per message", () => {
    const i = src.indexOf("readyState === WebSocket.CLOSED");
    const branch = src.slice(i, i + 700);
    expect(branch).not.toContain("this.connectRemote(");
    expect(branch).toContain("this.scheduleReconnect()");
  });
  test("backoff has a ceiling, resets on open and dies with the transport", () => {
    expect(src).toMatch(/RECONNECT_MAX_MS = 8000/);
    const onopen = src.slice(src.indexOf("this.socket.onopen = () =>"));
    expect(onopen.slice(0, 400)).toContain("this.reconnectAttempts = 0");
    const leave = src.slice(src.indexOf("  leaveGame() {"));
    expect(leave.slice(0, 300)).toContain("this.cancelScheduledReconnect()");
  });
  test("identical game config is not re-sent within a second", () => {
    const i = src.indexOf("private onSendUpdateGameConfigIntent(");
    const body = src.slice(i, i + 600);
    expect(body).toContain("this.lastConfigJson");
    expect(body).toContain("< 1000");
  });
});

describe("config coalescer (HostLobbyModal)", () => {
  const src = read("src/client/HostLobbyModal.ts");
  test("putGameConfig schedules one send per window instead of sending each call", () => {
    const i = src.indexOf("private putGameConfig(): void {");
    expect(i).toBeGreaterThan(0);
    const body = src.slice(i, src.indexOf("private async flushGameConfig", i));
    expect(body).toContain("window.setTimeout(");
    expect(body).toContain("sendGameConfigNow()");
    expect(body).not.toContain("dispatchEvent(");
  });
  test("storm sensor carries the caller stack", () => {
    expect(src).toMatch(/reportHealth\("config_update_storm"/);
    const i = src.indexOf('reportHealth("config_update_storm"');
    expect(src.slice(i, i + 200)).toContain("stack");
  });
  test("start flushes the pending config first", () => {
    const i = src.indexOf("private async requestStart() {");
    expect(src.slice(i, i + 300)).toContain("await this.flushGameConfig()");
  });
  test("dedupe key includes the lobby id (a new lobby must get the config again)", () => {
    expect(src).toContain("JSON.stringify([this.lobbyId, config])");
  });
});

describe("storage shim (index.html)", () => {
  const html = read("index.html");
  test("shim runs before the platform bootstrap and covers both storages", () => {
    const shim = html.indexOf("function mem()");
    const boot = html.indexOf("terron_platform_launch");
    expect(shim).toBeGreaterThan(0);
    expect(shim).toBeLessThan(boot);
    expect(html).toContain('["localStorage", "sessionStorage"]');
    expect(html).toContain("__terronMemStorage");
  });
  test("Health reports sessions running on the shim", () => {
    const h = read("src/client/Health.ts");
    expect(h).toMatch(/reportHealth\("storage_denied"/);
  });
});

describe("music: no synchronous Howler recursion", () => {
  test("playNext defers to a macrotask and respects a stopped player", () => {
    const src = read("src/client/sound/SoundManager.ts");
    const i = src.indexOf("private playNext(): void {");
    const body = src.slice(i, src.indexOf("\n  }\n", i));
    expect(body).toContain("window.setTimeout(");
    expect(body).toContain("this.musicRequested");
    expect(body).not.toMatch(/^\s*this\.playBackgroundMusic\(\);/m);
  });
});

describe("health telemetry", () => {
  const h = read("src/client/Health.ts");
  test("perf_summary carries the GPU name", () => {
    const i = h.indexOf("meta.gpu = gpuName");
    expect(h.slice(i - 250, i)).toContain('kind === "perf_summary"');
  });
  test("third-party script load errors are not counted as our rejections", () => {
    const i = h.indexOf('addEventListener("unhandledrejection"');
    const body = h.slice(i, i + 900);
    expect(body).toContain("<(script|link)>");
    expect(body).toContain("window.location.host");
  });
  test("new kinds are whitelisted on the API", () => {
    const api = read("../platform-api/src/clientHealth.ts");
    for (const k of ["config_update_storm", "storage_denied"]) {
      expect(h).toContain(`| "${k}"`);
      expect(api).toContain(`"${k}",`);
    }
  });
});

describe("join timeout grace (JoinLobbyModal)", () => {
  const src = read("src/client/JoinLobbyModal.ts");
  test("a fresh join gets its own 60s by local clock, whatever the showcase says", () => {
    const i = src.indexOf("private checkForJoinTimeout()");
    const body = src.slice(i, i + 2500);
    expect(body).toContain(
      "Date.now() - this.joinStartedAt < JOIN_START_GRACE_MS",
    );
    // проверка стоит ДО пометки handledJoinTimeout — иначе она бесполезна
    expect(body.indexOf("this.joinStartedAt")).toBeLessThan(
      body.indexOf("this.handledJoinTimeout = true"),
    );
  });
  test("startTrackingLobby stamps the join moment", () => {
    const i = src.indexOf("private startTrackingLobby(");
    expect(src.slice(i, i + 900)).toContain("this.joinStartedAt = Date.now()");
  });
  test("the reported gameID is captured before the state is wiped", () => {
    const i = src.indexOf('reportHealth("join_timeout"');
    expect(src.slice(i - 400, i)).toContain(
      "const gameID = this.currentLobbyId",
    );
  });
});

describe("context-loss snapshot", () => {
  test("GameView snapshots the renderer BEFORE disposing it and ships it with the event", () => {
    const src = read("src/client/render/gl/GameView.ts");
    const i = src.indexOf("private onContextLost = ");
    const body = src.slice(i, i + 2500);
    expect(body.indexOf("lossSnapshot()")).toBeGreaterThan(0);
    expect(body.indexOf("lossSnapshot()")).toBeLessThan(
      body.indexOf("this.renderer.dispose()"),
    );
    expect(body).toContain("...lossSnap,");
  });
  test("renderer snapshot names frame, backbuffer, passes and missiles", () => {
    const src = read("src/client/render/gl/Renderer.ts");
    const i = src.indexOf("lossSnapshot(): Record<string, unknown> {");
    const body = src.slice(i, i + 1500);
    for (const k of [
      "frame:",
      "cw:",
      "edpr:",
      "light:",
      "bloom:",
      "fog:",
      "nukes,",
    ]) {
      expect(body).toContain(k);
    }
  });
});

describe("perf/tombstone sensors 04.09", () => {
  test("perf_summary carries worst-frame timing, early stutters and worst ingest step", () => {
    const src = read("src/client/PerfHud.ts");
    for (const k of ["wfT:", "wfS:", "lt2:", "wi:"]) expect(src).toContain(k);
    const w = read("src/client/WebGLFrameBuilder.ts");
    expect(w).toContain("perfHud.noteIngest(");
    expect((w.match(/lap\("/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });
  test("tombstone records visibility and hidden duration", () => {
    const h = read("src/client/Health.ts");
    const i = h.indexOf("const write = (clean: boolean)");
    expect(h.slice(i, i + 900)).toContain("vis: document.visibilityState");
    expect(h.slice(i, i + 900)).toContain("hiddenS:");
  });
});

describe("dev experiment: parallel shader compile + reconnect reasons", () => {
  test("renderer enables KHR_parallel_shader_compile right after context creation", () => {
    const src = read("src/client/render/gl/Renderer.ts");
    const i = src.indexOf('gl.getExtension("KHR_parallel_shader_compile")');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(
      src.indexOf('gl.getExtension("EXT_color_buffer_float")'),
    );
  });
  test("game_reconnect carries the close code and reason", () => {
    const src = read("src/client/Transport.ts");
    expect(src).toContain("this.lastCloseCode = event.code");
    const i = src.indexOf('reportHealth("game_reconnect"');
    expect(src.slice(i, i + 200)).toContain("code,");
  });
});

describe("reconnect buffer is flushed after the join is acknowledged", () => {
  const src = read("src/client/Transport.ts");
  test("onopen does not send the buffer before onconnect()", () => {
    const i = src.indexOf("this.socket.onopen = () =>");
    const body = src.slice(i, src.indexOf("this.socket.onmessage", i));
    expect(body).not.toContain("this.socket.send(");
    expect(body).toContain("this.flushBufferOnAck = this.buffer.length > 0");
  });
  test("the flush happens on the first parsed server message", () => {
    const i = src.indexOf("this.goneRetries = 0;");
    expect(src.slice(i, i + 200)).toContain("flushBufferAfterAck()");
  });
  test("input_mode after (re)join waits for the server's first message", () => {
    const i = src.indexOf("public sendInputMode(mode: InputMode)");
    expect(src.slice(i, i + 700)).toContain("this.flushBufferOnAck");
    const j = src.indexOf("async rejoinGame(lastTurn: number)");
    expect(src.slice(j, j + 900)).toContain("this.flushBufferOnAck = true");
    const k = src.indexOf("async joinGame()");
    expect(src.slice(k, k + 700)).toContain("this.flushBufferOnAck = true");
  });
  test("sending on a CONNECTING socket buffers instead of throwing", () => {
    const i = src.indexOf("private sendMsg(msg: ClientMessage)");
    expect(src.slice(i, i + 1200)).toContain("WebSocket.CONNECTING");
  });
});

describe("build ghost click outside the map", () => {
  test("createStructure never calls ref() on raw click coordinates", () => {
    const src = read("src/client/controllers/BuildPreviewController.ts");
    const i = src.indexOf("private createStructure(e: MouseUpEvent)");
    const body = src.slice(i, src.indexOf("\n  }\n", i));
    expect(body).toContain("this.game.isValidCoord(tile.x, tile.y)");
    expect(
      (body.match(/this\.game\.ref\(tile\.x, tile\.y\)/g) ?? []).length,
    ).toBe(1);
    expect(body).toContain("if (clickRef === null)");
  });
});

describe("small crash guards", () => {
  test("easter-egg key handler survives a keydown without e.key", () => {
    expect(read("src/client/UserSettingModal.ts")).toContain('(e.key ?? "")');
  });
  test("attack warning click survives a worker timeout", () => {
    const src = read("src/client/hud/layers/AttacksDisplay.ts");
    const i = src.indexOf("attackClusteredPositions(attack.id)");
    expect(src.slice(i, i + 80)).toContain(".catch(() => [])");
  });
  test("GameImpl no longer throws on too few teams", () => {
    expect(read("src/core/game/GameImpl.ts")).not.toMatch(
      /throw new Error\(`Too few teams/,
    );
  });
});
