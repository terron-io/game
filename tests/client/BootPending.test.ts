// terron 02.09: ГЛАВНАЯ — ЕДИНЫМ БЛОКОМ.
//
// Владелец, шесть скринов с телефона: «мыльное превью, флаг и перевод сломаны на
// 3 секунды — какого хуя точечно правишь, если всё должно работать единым блоком».
// Ответ — не догонять каждую деталь по отдельности, а не показывать главную, пока
// не пришёл словарь и не догрузились ассеты первого экрана. Класс ставится
// СИНХРОННО в <head> (до первого кадра), снимается по событию словаря + load,
// с потолком — мёртвая сеть не должна оставить пустой экран навсегда.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "index.html"), "utf-8");
const head = html.slice(0, html.indexOf("</head>"));

describe("boot-pending", () => {
  it("класс ставится синхронно в head, до первого кадра", () => {
    expect(head).toContain('root.classList.add("boot-pending")');
  });
  it("снимается по словарю (terron-lang-loaded) и load, не раньше", () => {
    expect(head).toContain('window.addEventListener("terron-lang-loaded"');
    expect(head).toContain('window.addEventListener("load", maybe)');
    expect(head).toMatch(/if \(!langReady\) return;/);
  });
  it("есть потолок ожидания — мёртвая сеть не даёт пустой экран навсегда", () => {
    expect(head).toMatch(/setTimeout\(release, 6000\)/);
  });
  it("матч снимает оверлей сразу, CSS не трогает HUD", () => {
    expect(head).toContain('classList.contains("in-game")) release()');
    expect(head).toMatch(/html\.boot-pending body:not\(\.in-game\) main-layout \{\s*visibility: hidden;/);
  });
  it("событие словаря действительно шлёт LangSelector", () => {
    const ls = readFileSync(join(process.cwd(), "src/client/LangSelector.ts"), "utf-8");
    expect(ls).toContain('new CustomEvent("terron-lang-loaded")');
  });
});
