import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import Color from "colorjs.io";
import { ColoredTeams, Team } from "../../core/game/Game";
import { PseudoRandom } from "../../core/PseudoRandom";
import { simpleHash } from "../../core/Util";
import {
  blueTeamColors,
  botTeamColors,
  greenTeamColors,
  orangeTeamColors,
  purpleTeamColors,
  redTeamColors,
  tealTeamColors,
  yellowTeamColors,
} from "./Colors";
extend([lchPlugin]);
extend([labPlugin]);

export class ColorAllocator {
  private availableColors: Colord[];
  private fallbackColors: Colord[];
  private assigned = new Map<string, Colord>();
  private teamPlayerColors = new Map<string, Colord>();
  // terron: ОБЩИЙ реестр выданных цветов между аллокаторами (человек+нации).
  // Без него нация могла получить цвет, неотличимый от цвета игрока — репорты
  // 17.07 «видно противника на МОЕЙ территории, а захватить нечего»: остаток
  // нации в 100-500 тайлов красился в тон игрока и сливался с его землёй.
  private sharedAssigned: Colord[] | null = null;

  constructor(colors: Colord[], fallback: Colord[], shared?: Colord[]) {
    this.availableColors = [...colors];
    this.fallbackColors = [...colors, ...fallback];
    this.sharedAssigned = shared ?? null;
  }

  private getTeamColorVariations(team: Team): Colord[] {
    switch (team) {
      case ColoredTeams.Blue:
        return blueTeamColors;
      case ColoredTeams.Red:
        return redTeamColors;
      case ColoredTeams.Teal:
        return tealTeamColors;
      case ColoredTeams.Purple:
        return purpleTeamColors;
      case ColoredTeams.Yellow:
        return yellowTeamColors;
      case ColoredTeams.Orange:
        return orangeTeamColors;
      case ColoredTeams.Green:
        return greenTeamColors;
      case ColoredTeams.Bot:
        return botTeamColors;
      case ColoredTeams.Humans:
        return blueTeamColors;
      case ColoredTeams.Nations:
        return redTeamColors;
      default:
        return [this.assignColor(team)];
    }
  }

  // terron 20.07 ПЕРФ: инкрементальный подбор отличимого цвета.
  // Было: на КАЖДОГО игрока — selectDistinctColorIndex(), а это заново строит
  // LAB-объекты всех выданных цветов и гоняет deltaE2000 по всей палитре ×
  // всем выданным. Суммарно на матч выходит КВАДРАТ (палитра × n²/2): на 400
  // ботах это миллионы вызовов deltaE2000 и ~2.4-3.8с ЗАМОРОЗКИ главного
  // потока в первом пакете состояния — карта уже видна, но страница не
  // отвечает (ни зума, ни протяжки), пока не пройдёт ингест.
  // Стало: держим для каждого цвета палитры его минимальное расстояние до уже
  // выданных. Выдали цвет — обновили массив за O(палитра). Выбор = argmax по
  // этому массиву. Итог тот же (жадный выбор максимально далёкого цвета),
  // сложность O(палитра × n) вместо O(палитра × n²).
  /** LAB-представления availableColors (параллельный массив). */
  private paletteLab: Color[] | null = null;
  /** Минимальное расстояние каждого цвета палитры до уже выданных. */
  private minDistToAssigned: number[] | null = null;
  /** Сколько записей reference уже учтено в minDistToAssigned. */
  private foldedRefCount = 0;

  private dropCaches() {
    this.paletteLab = null;
    this.minDistToAssigned = null;
    this.foldedRefCount = 0;
  }

  /** Учесть в кэше расстояний цвета reference, добавленные с прошлого раза. */
  private foldReference(reference: Colord[]) {
    const palette = this.availableColors;
    if (
      this.paletteLab === null ||
      this.minDistToAssigned === null ||
      this.paletteLab.length !== palette.length
    ) {
      this.paletteLab = palette.map(toColor);
      this.minDistToAssigned = new Array<number>(palette.length).fill(Infinity);
      this.foldedRefCount = 0;
    }
    // Реестр общий между аллокаторами — новые записи могли прийти со стороны.
    for (let r = this.foldedRefCount; r < reference.length; r++) {
      const assignedLab = toColor(reference[r]);
      for (let i = 0; i < this.paletteLab.length; i++) {
        const d = deltaE2000(this.paletteLab[i], assignedLab);
        if (d < this.minDistToAssigned[i]) this.minDistToAssigned[i] = d;
      }
    }
    this.foldedRefCount = reference.length;
  }

  /** Индекс цвета, максимально далёкого от уже выданных (как раньше — argmax). */
  private selectDistinctIndexCached(reference: Colord[]): number {
    this.foldReference(reference);
    const dist = this.minDistToAssigned!;
    let maxDeltaE = 0;
    let maxIndex = 0;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] > maxDeltaE) {
        maxDeltaE = dist[i];
        maxIndex = i;
      }
    }
    return maxIndex;
  }

  assignColor(id: string): Colord {
    if (this.assigned.has(id)) {
      return this.assigned.get(id)!;
    }

    if (this.availableColors.length === 0) {
      this.availableColors = [...this.fallbackColors];
      this.dropCaches(); // палитра сменилась — расстояния пересчитать
    }

    let selectedIndex: number;

    // terron: сравниваем с ОБЩИМ реестром (человек+нации), а не только со
    // своим — иначе нация получала цвет игрока. Кап поднят 50 → 300: раньше
    // при 72 нациях подбор отличимости ВЫКЛЮЧАЛСЯ на 51-й (случайные дубли —
    // репорты «противник на моей территории» 17.07). Подбор одноразовый на
    // игрока, O(палитра × выдано) — при 300 это всё ещё дёшево.
    const reference = this.sharedAssigned ?? Array.from(this.assigned.values());
    if (reference.length === 0 || reference.length > 300) {
      const rand = new PseudoRandom(simpleHash(id));
      selectedIndex = rand.nextInt(0, this.availableColors.length);
    } else {
      selectedIndex = this.selectDistinctIndexCached(reference);
    }

    const color = this.availableColors.splice(selectedIndex, 1)[0];
    // Цвет ушёл из палитры — выкидываем его и из параллельных кэшей.
    this.paletteLab?.splice(selectedIndex, 1);
    this.minDistToAssigned?.splice(selectedIndex, 1);
    this.assigned.set(id, color);
    this.sharedAssigned?.push(color);
    return color;
  }

  assignTeamColor(team: Team): Colord {
    const teamColors = this.getTeamColorVariations(team);
    const rgb = teamColors[0].toRgb();
    rgb.r = Math.round(rgb.r);
    rgb.g = Math.round(rgb.g);
    rgb.b = Math.round(rgb.b);
    return colord(rgb);
  }

  assignTeamPlayerColor(team: Team, playerId: string): Colord {
    if (this.teamPlayerColors.has(playerId)) {
      return this.teamPlayerColors.get(playerId)!;
    }

    const teamColors = this.getTeamColorVariations(team);
    const hashValue = simpleHash(playerId);
    const colorIndex = hashValue % teamColors.length;
    const color = teamColors[colorIndex];

    this.teamPlayerColors.set(playerId, color);

    return color;
  }
}

// Select a distinct color index from the available colors that
// is most different from the assigned colors
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
): number | null {
  if (assignedColors.length === 0) {
    throw new Error("No assigned colors");
  }

  const assignedLabColors = assignedColors.map(toColor);

  let maxDeltaE = 0;
  let maxIndex = 0;

  for (let i = 0; i < availableColors.length; i++) {
    const color = availableColors[i];
    const deltaE = minDeltaE(toColor(color), assignedLabColors);
    if (deltaE > maxDeltaE) {
      maxDeltaE = deltaE;
      maxIndex = i;
    }
  }
  return maxIndex;
}

function minDeltaE(lab1: Color, assignedLabColors: Color[]) {
  return assignedLabColors.reduce((min, assigned) => {
    return Math.min(min, deltaE2000(lab1, assigned));
  }, Infinity);
}

function deltaE2000(c1: Color, c2: Color): number {
  return c1.deltaE(c2, "2000");
}

function toColor(colord: Colord): Color {
  const lab = colord.toLab();
  return new Color("lab", [lab.l, lab.a, lab.b]);
}
