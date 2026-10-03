// terron 11.09: тест-режим площадки — `?embed=1&platform=<тип>` и переключатель.
// Владелец: «спец ссылки для всех платформ, текущих и будущих… плюс переключатель,
// НО ТОЛЬКО В РЕЖИМЕ, НЕ В САМИХ ПЛОЩАДКАХ».
import { beforeEach, describe, expect, it, vi } from "vitest";

type W = Window & { __platformLaunch?: boolean };

async function boot(
  url: string,
  opts: { launched?: boolean; embed?: boolean } = {},
) {
  vi.resetModules();
  window.history.replaceState(null, "", url);
  document.documentElement.className = opts.embed === false ? "" : "gp-embed";
  (window as W).__platformLaunch = opts.launched ?? false;
  return await import("../../src/client/PlatformContext");
}

describe("?embed=1&platform=<тип>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("включает площадку как при детекте: контекст, класс, кэш", async () => {
    const m = await boot("/?embed=1&platform=vk");
    expect(m.embedTestMode()).toBe(true);
    expect(m.platformContext()).toBe("VK");
    expect(document.documentElement.classList.contains("gp-platform-vk")).toBe(
      true,
    );
    expect(m.platformAuthHeaders()).toEqual({ "X-Terron-Platform": "VK" });
  });

  it("platform=none забывает площадку целиком", async () => {
    localStorage.setItem("terron_platform_ctx", "YANDEX");
    document.documentElement.classList.add("gp-platform-yandex");
    const m = await boot("/?embed=1&platform=none");
    expect(m.platformContext()).toBeNull();
    expect(localStorage.getItem("terron_platform_ctx")).toBeNull();
    expect(document.documentElement.className).not.toContain("gp-platform-");
  });

  it("внутри НАСТОЯЩЕЙ площадки параметр не действует", async () => {
    localStorage.setItem("terron_platform_ctx", "OK");
    const m = await boot("/?embed=1&platform=vk", { launched: true });
    expect(m.embedTestMode()).toBe(false);
    expect(m.platformContext()).toBe("OK");
  });

  it("без маркера embed=1 параметр — просто мусор в адресе", async () => {
    const m = await boot("/?platform=vk", { embed: false });
    expect(m.embedTestMode()).toBe(false);
    expect(m.platformContext()).toBeNull();
    expect(localStorage.getItem("terron_platform_ctx")).toBeNull();
  });
});

describe("переключатель площадок", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("в тест-режиме рисуется со всеми площадками значка + «без площадки» + «другая…»", async () => {
    await boot("/?embed=1&platform=yandex");
    // В бою PlatformContext подтягивает переключатель ленивым импортом (сканер
    // ниже); здесь монтируем явно — тайминг vite-трансформа в jsdom не наш.
    const sw = await import("../../src/client/EmbedPlatformSwitcher");
    sw.mountEmbedPlatformSwitcher();
    const box = document.getElementById("terron-embed-switch");
    expect(box).not.toBeNull();
    const sel = box!.querySelector("select")!;
    const { platformTypes } = await import(
      "../../src/client/components/ui/platformBadge"
    );
    expect(sel.options.length).toBe(platformTypes().length + 2);
    expect(sel.value).toBe("YANDEX");
    expect([...sel.options].map((o) => o.value)).toContain("VK");
  });

  it("PlatformContext сам подтягивает переключатель в тест-режиме", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync("src/client/PlatformContext.ts", "utf8");
    expect(src).toMatch(
      /if \(EMBED_TEST\) \{\s*void import\("\.\/EmbedPlatformSwitcher"\)/,
    );
  });

  it("вне тест-режима не рисуется даже при прямом вызове", async () => {
    await boot("/?platform=vk", { embed: false });
    const sw = await import("../../src/client/EmbedPlatformSwitcher");
    sw.mountEmbedPlatformSwitcher();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("terron-embed-switch")).toBeNull();
  });
});
