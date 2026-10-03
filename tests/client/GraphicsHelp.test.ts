// terron 25.09: окно «видеокарта сбросила графику» с шагами решения и гайд
// /graphics-help (отзыв с Пикабу: «через 3 минуты экран белый», Intel UHD).
//
// Сторожим:
//   1) у каждого совета в окне есть раздел гайда В ОБОИХ ЯЗЫКАХ — иначе «Как?»
//      откроет модалку и никуда не прокрутит;
//   2) гайд читается модалкой: блок языка один, кнопки переключения языка
//      (data-switch) не мешают выбору блока, внешние ссылки внутри площадки
//      становятся текстом;
//   3) окно: «Лёгкая графика» — главная, пока настройка выключена; выбор игрока
//      уходит в телеметрию; «Как?» открывает гайд поверх, не закрывая окна;
//   4) все три тупика восстановления ведут в это окно, а не в голое «Перезагрузить?»;
//   5) страница раздаётся сервером и CORS-ом для хостинга площадки;
//   6) новые события телеметрии приняты API.
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gpuVendorOf,
  helpSteps,
  shortGpuName,
  showGraphicsHelp,
  supportCode,
} from "../../src/client/GraphicsHelpDialog";
import { extractDoc } from "../../src/client/LegalModal";
import { browserTag } from "../../src/client/render/gl/GameView";

const root = path.join(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const GUIDE = read("resources/graphics-help.html");
const INTEL =
  "ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)";

describe("видеокарта из строки рендера", () => {
  it("производитель и короткое имя для кода поддержки", () => {
    expect(gpuVendorOf(INTEL)).toBe("intel");
    expect(shortGpuName(INTEL)).toBe("Intel UHD");
    const nv =
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    expect(gpuVendorOf(nv)).toBe("nvidia");
    expect(shortGpuName(nv)).toBe("NVIDIA GeForce RTX 3060");
    const mac =
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)";
    expect(gpuVendorOf(mac)).toBe("apple");
    expect(shortGpuName(mac)).toBe("Apple M1");
    expect(gpuVendorOf("Mali-G57")).toBeNull();
  });

  it("код поддержки называет сбой, железо и число потерь", () => {
    const code = supportCode("giveup", {
      gpu: INTEL,
      losses: 2,
      lightOn: false,
    });
    expect(code).toContain("GL-2");
    expect(code).toContain("Intel UHD");
    expect(code).toContain("2");
  });

  it("браузер с версией для телеметрии", () => {
    expect(
      browserTag(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36",
      ),
    ).toBe("chrome153");
    expect(
      browserTag("Mozilla/5.0 Chrome/140.0 YaBrowser/25.8.1.1 Safari/537.36"),
    ).toBe("yandex25");
    expect(browserTag("Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe(
      "edge140",
    );
    expect(browserTag("Mozilla/5.0 (X11) Gecko/20100101 Firefox/131.0")).toBe(
      "firefox131",
    );
  });
});

describe("советы ↔ разделы гайда", () => {
  it("лёгкая графика первой, пока выключена; включена — совета нет", () => {
    const off = helpSteps("intel", false);
    expect(off[0].sec).toBe("light");
    expect(off.map((s) => s.sec)).toContain("hardware");
    expect(off[off.length - 1].text).toMatch(/Intel/);
    expect(helpSteps("intel", true).map((s) => s.sec)).not.toContain("light");
  });

  it("каждый совет окна есть в гайде на обоих языках", () => {
    const secs = new Set(helpSteps(null, false).map((s) => s.sec));
    for (const ru of [true, false]) {
      const html = extractDoc(GUIDE, { ru, embedded: false });
      const host = document.createElement("div");
      host.innerHTML = html;
      for (const sec of secs) {
        expect(
          host.querySelector(`[data-sec="${sec}"]`),
          `${ru ? "ru" : "en"}: нет раздела ${sec}`,
        ).not.toBeNull();
      }
    }
  });

  it("модалка берёт ровно один язык, кнопки языка не путают выбор блока", () => {
    const ru = extractDoc(GUIDE, { ru: true, embedded: false });
    expect(ru).toContain("Аппаратное ускорение");
    expect(ru).not.toContain("Hardware acceleration in the browser");
    const en = extractDoc(GUIDE, { ru: false, embedded: false });
    expect(en).toContain("Hardware acceleration in the browser");
    expect(en).not.toContain("Аппаратное ускорение");
    // кнопки переключения — data-switch, не data-lang (иначе querySelector
    // схватил бы кнопку вместо блока)
    expect(GUIDE).not.toMatch(/<button[^>]*data-lang=/);
  });

  it("аппаратное ускорение расписано по браузерам, адреса — текстом", () => {
    const ru = extractDoc(GUIDE, { ru: true, embedded: true });
    for (const addr of [
      "chrome://settings/system",
      "browser://settings/system",
      "edge://settings/system",
      "opera://settings/system",
    ]) {
      expect(ru).toContain(addr);
    }
    expect(ru).toContain("Firefox");
    // внутри площадки внешних ссылок не остаётся (почта можно)
    const host = document.createElement("div");
    host.innerHTML = ru;
    const hrefs = [...host.querySelectorAll("a[href]")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.every((h) => h!.startsWith("mailto:"))).toBe(true);
  });
});

describe("окно сбоя", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("главная кнопка — лёгкая графика; выбор уходит в телеметрию", async () => {
    const report = vi.fn();
    const p = showGraphicsHelp(
      "giveup",
      { gpu: INTEL, losses: 2, lightOn: false },
      report,
    );
    const btns = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-choice]"),
    ];
    expect(btns.map((b) => b.dataset.choice)).toEqual([
      "light",
      "reload",
      "later",
    ]);
    expect(document.querySelector(".terron-gfx-code")!.textContent).toContain(
      "Intel UHD",
    );
    btns[0].click();
    await expect(p).resolves.toBe("light");
    expect(report).toHaveBeenCalledWith("light");
    expect(document.querySelector(".terron-gfx-help")).toBeNull();
  });

  it("лёгкая уже включена — без неё: перезагрузить и позже", () => {
    void showGraphicsHelp("stuck", { gpu: "", losses: 1, lightOn: true });
    const choices = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-choice]"),
    ].map((b) => b.dataset.choice);
    expect(choices).toEqual(["reload", "later"]);
  });

  it("«Как?» открывает гайд поверх, окно остаётся", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(GUIDE, { status: 200 })),
    );
    const report = vi.fn();
    void showGraphicsHelp(
      "giveup",
      { gpu: INTEL, losses: 2, lightOn: false },
      report,
    );
    document
      .querySelector<HTMLButtonElement>('.terron-gfx-how[data-sec="hardware"]')!
      .click();
    expect(report).toHaveBeenCalledWith("guide:hardware");
    expect(document.querySelector(".terron-legal-overlay")).not.toBeNull();
    expect(document.querySelector(".terron-gfx-help")).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("проводка", () => {
  it("все тупики восстановления ведут в окно с советами", () => {
    const gv = read("src/client/render/gl/GameView.ts");
    for (const reason of ['"stuck"', '"giveup"', '"restore_failed"']) {
      expect(gv).toContain(`offerGraphicsHelp(${reason})`);
    }
    expect(gv).not.toContain("confirmDialog(");
    // время восстановления меряется на каждом пути
    for (const via of ['"restored"', '"fresh"', '"failed"', '"giveup"']) {
      expect(gv).toContain(`reportRestore(${via})`);
    }
  });

  it("гайд раздаётся сервером и CORS-ом для хостинга площадки", () => {
    expect(read("src/server/Master.ts")).toContain(
      '"/graphics-help": "graphics-help.html"',
    );
    expect(read("src/server/PublicAssetManifest.ts")).toContain(
      '"graphics-help.html"',
    );
    const nginx = read("nginx.conf");
    const at = nginx.indexOf("location ~* ^/(terms|privacy");
    expect(nginx.slice(at, at + 160)).toContain("graphics-help");
  });

  it("новые события телеметрии в белом списке API", () => {
    const api = read("../platform-api/src/clientHealth.ts");
    for (const k of ["gl_restore", "gl_help_choice"]) {
      expect(
        api.match(new RegExp(`"${k}"`, "g"))?.length ?? 0,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
