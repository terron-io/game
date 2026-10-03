// terron 02.09: ОДИН @customElement НА ИМЯ — ПО ВСЕМУ ДЕРЕВУ.
//
// Прод лёг на 4 минуты: в хирургически собранной копии LangSelector.ts декоратор
// @customElement("lang-selector") оказался ДВАЖДЫ (скрипт сборки копии захватил его
// вместе со вставляемым блоком). Регистрация элемента бросает NotSupportedError на
// загрузке index-чанка — и вся главная у всех игроков пустая. ⚠️ `tsc` это
// ПРОПУСКАЕТ (два одинаковых декоратора — валидный TS), поймать можно только
// сканером: каждое имя элемента объявляется ровно один раз во всём src.
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("customElements", () => {
  it("каждое имя объявлено ровно один раз, и ни разу дважды в одном файле", () => {
    const seen = new Map<string, string[]>();
    for (const f of walk(join(process.cwd(), "src"))) {
      const src = readFileSync(f, "utf-8");
      for (const m of src.matchAll(/@customElement\("([a-z0-9-]+)"\)/g)) {
        seen.set(m[1], [...(seen.get(m[1]) ?? []), f]);
      }
    }
    const dups = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(dups, JSON.stringify(dups, null, 1)).toEqual([]);
  });
});
