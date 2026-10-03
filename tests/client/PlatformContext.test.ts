// terron 25.08: контекст сессии (сайт против каталога площадки). Разделение
// держится на том, что клиент СООБЩАЕТ площадку заголовком, а сервер по нему
// выбирает куку. Тест закрывает ровно те места, где это ломается молча:
// гонка с поднятием SDK и мусор вместо типа площадки.
import { beforeEach, describe, expect, it, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  return await import("../../src/client/PlatformContext");
}

describe("контекст площадки на клиенте", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    // ⚠️ terron 09.09: кэш контекста читается ТОЛЬКО на площадке (иначе сессия
    // обычного terron.io уехала бы в платформенную куку), поэтому тесты про
    // площадку обязаны ставить признак сами.
    document.documentElement.classList.add("gp-embed");
    delete (window as unknown as { __gpReady?: unknown }).__gpReady;
  });

  it("вне площадки заголовка нет и ждать нечего", async () => {
    document.documentElement.classList.remove("gp-embed");
    const m = await fresh();
    expect(m.platformContext()).toBeNull();
    expect(m.platformAuthHeaders()).toEqual({});
    await expect(m.platformContextReady()).resolves.toBeNull();
  });

  it("на площадке заголовок появляется и переживает перезагрузку модуля", async () => {
    const m = await fresh();
    m.setPlatformContext("VK");
    expect(m.platformAuthHeaders()).toEqual({ "X-Terron-Platform": "VK" });
    // Кэш переживает и перезагрузку модуля, и ПЕРЕЗАПУСК приложения площадки
    // (localStorage): иначе каждый запуск снова ждал бы SDK и снова промахивался
    // мимо нужной куки — это и был десятисекундный вход с телефона.
    const again = await fresh();
    expect(again.platformContext()).toBe("VK");
  });

  it("песочница и мусор не считаются площадкой", async () => {
    const m = await fresh();
    for (const v of ["NONE", "", "   ", 42, null, undefined]) {
      m.setPlatformContext(v as unknown);
      expect(m.platformContext()).toBeNull();
    }
  });

  it("ЖДЁТ поднятия SDK — иначе запрос уйдёт без заголовка", async () => {
    const m = await fresh();
    let release: (v: unknown) => void = () => {};
    (window as unknown as { __gpReady?: Promise<unknown> }).__gpReady =
      new Promise((r) => (release = r));
    const pending = m.platformContextReady();
    // Пока SDK молчит — контекст неизвестен, но мы его ДОЖИДАЕМСЯ, а не считаем сайтом.
    expect(m.platformContext()).toBeNull();
    release({ platform: { type: "OK" } });
    await expect(pending).resolves.toBe("OK");
    expect(m.platformAuthHeaders()).toEqual({ "X-Terron-Platform": "OK" });
  });

  it("молчащий SDK не вешает вход навсегда", async () => {
    // Потолок поднят (12 с вместо 2.5): промах мимо куки стоит ПОЛНОГО круга
    // входа, это дороже ожидания. Но он есть — иначе мёртвый SDK держал бы
    // сессию вечно.
    vi.useFakeTimers();
    const m = await fresh();
    (window as unknown as { __gpReady?: Promise<unknown> }).__gpReady =
      new Promise(() => {});
    const pending = m.platformContextReady();
    await vi.advanceTimersByTimeAsync(13000);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});
