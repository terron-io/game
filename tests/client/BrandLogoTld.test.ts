// terron 11.09: «.ио» в логотипе рисуется легче имени (владелец: «название таки
// террон, ио — домен»). Домен появляется только внутри площадки (правило Яндекса
// 5.1.3), поэтому на terron.io логотип не меняется вовсе.
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { brandLogoParts } from "../../src/client/components/ui/brandLogo";

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("логотип: имя + лёгкий домен", () => {
  it("делит wordmark на имя и домен по первой точке", () => {
    expect(brandLogoParts("ТЕРРОН.ио")).toEqual({ name: "ТЕРРОН", tld: ".ио" });
    expect(brandLogoParts("TERRON.io")).toEqual({ name: "TERRON", tld: ".io" });
    // на сайте домена нет — ничего не режем
    expect(brandLogoParts("terron")).toEqual({ name: "terron", tld: "" });
    expect(brandLogoParts(".io")).toEqual({ name: ".io", tld: "" });
  });

  it("оба навбара рисуют логотип через brandLogo(), а не сырым brandWordmark()", () => {
    for (const f of [
      "src/client/components/MobileNavBar.ts",
      "src/client/components/DesktopNavBar.ts",
      // мобильная верхняя панель — третье место, где стоял хардкод «terron»
      "src/client/components/PlayPage.ts",
    ]) {
      const src = code(f);
      expect(src).toContain("${brandLogo()}");
      expect(src).not.toContain("${brandWordmark()}");
      expect(src).not.toMatch(/>\s*terron\s*<\/span/i);
    }
  });

  it("тема делает домен легче имени", () => {
    const css = readFileSync("src/client/styles/terron-theme.css", "utf8");
    const m = /:is\(\.terron-logo, \.terron-logo-top\) \.terron-logo-tld \{([^}]*)\}/.exec(css);
    // и капс с верхней панели на площадке снят — иначе «.ИО»
    expect(css).toMatch(/html\.gp-embed body:not\(\.in-game\) \.terron-logo-top \{\s*text-transform: none;/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/font-weight:\s*400/);
    expect(m![1]).toMatch(/text-transform:\s*none/);
    // капс панели — в теме, не inline (inline перебивал бы снятие под площадкой)
    const play = readFileSync("src/client/components/PlayPage.ts", "utf8");
    expect(play).not.toMatch(/terron-logo-top[\s\S]{0,300}text-transform:uppercase/);
    expect(m![1]).toMatch(/opacity:\s*0?\.\d+/);
    expect(m![1]).toMatch(/font-size:\s*0?\.\d+em/);
  });
});
