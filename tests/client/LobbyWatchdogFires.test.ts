// terron 28.09: СТОРОЖ ЗАВИСШЕГО ЛОББИ ОБЯЗАН СРАБАТЫВАТЬ.
// Репорт tomsrn: свернул вкладку в алмазном лобби, сервер закрыл соединение за
// молчание, вернулся — вечное «Starting…». Сторож (01.09) должен был увести в
// живое лобби или перезагрузить, но за 3 дня не сработал НИ РАЗУ: он проверял
// окно загрузки по style.display, а оно прячется свойством isVisible.
// Обратный прогон: верни проверку `loading.style.display !== "none"` — краснеет.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";

function stuckModal(): JoinLobbyModal {
  const modal = new JoinLobbyModal();
  const m = modal as any;
  m.isModalOpen = true;
  m.isConnecting = false;
  m.currentLobbyId = "stuck01";
  m.lobbyStartAt = Date.now() - 120_000; // старт прошёл 2 минуты назад
  m.serverTimeOffset = 0;
  m.gameConfig = { gameType: GameType.Public };
  return modal;
}

describe("сторож зависшего лобби", () => {
  afterEach(() => {
    document.querySelectorAll("game-starting-modal").forEach((e) => e.remove());
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("срабатывает, когда окно загрузки спрятано (isVisible=false)", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const loading = document.createElement("game-starting-modal") as any;
    loading.isVisible = false; // style.display остаётся пустым, как в живой игре
    document.body.appendChild(loading);
    // перезагрузку глушим штатным гейтом «уже перезагружались»
    sessionStorage.setItem("terron-stuck-stuck01", "1");
    const modal = stuckModal();
    (modal as any).checkStuckLobby();
    expect((modal as any).staleHandled).toBe(true);
  });

  it("молчит, пока окно загрузки показано (матч грузится)", () => {
    const loading = document.createElement("game-starting-modal") as any;
    loading.isVisible = true;
    document.body.appendChild(loading);
    const modal = stuckModal();
    (modal as any).checkStuckLobby();
    expect((modal as any).staleHandled).toBe(false);
  });
});
