// terron 23.08: СЕКРЕТНЫЕ ПОСТРОЙКИ — приёмник кода (new-units/CUBE.md).
//
// Сетка выбора ульт 3×3 — это цифровая клавиатура: слоты 1–9 по ПОЗИЦИИ,
// «ноль» — широкая кнопка под сеткой (на десктопе строка рефреша, на телефоне
// `cornerAction` в углу колеса). Набрал код — в углу сетки появляется слот
// постройки, которой в витрине нет и не будет.
//
// ⚠️ КОД ПОЗИЦИОННЫЙ, а не по ультам: слоты перемешаны сидом матча
// (`matchUltSeed` = id матча + smallID), поэтому «нажми Религию»
// невоспроизводимо, а «нажми левый-верх» — всегда одно и то же.
//
// ⚠️ Код — это ЖЕСТ, а не гейт. Клиент открытый: обе последовательности
// окажутся в чате через день после выката, и это заложено в дизайн. Право на
// квадрат проверяет сервер (владение ключом `cube_key`, реле — fail-closed),
// право на круг — ядро (сколько золота заработано за матч). Здесь только UI.
import {
  TERRON_SECRET_CODE_TIMEOUT_MS,
  TERRON_TREASURE_CODE,
  TERRON_WALKING_CODE,
} from "../core/configuration/TerronTuning";
import { UnitType } from "../core/game/Game";

interface SecretCode {
  readonly type: UnitType;
  readonly digits: readonly number[];
}

const CODES: readonly SecretCode[] = [
  // 1337 = leet = elite. Ноль набирается широкой кнопкой под сеткой.
  { type: UnitType.SecretTreasure, digits: TERRON_TREASURE_CODE },
  // 4444 — Шагающий город. В отличие от клада у него ЕЩЁ И ЗАМОК: код только
  // показывает слот, взять ульту сможет лишь тот, кто открыл ключ.
  { type: UnitType.WalkingCity, digits: TERRON_WALKING_CODE },
];

/** Максимальная длина кода — сколько последних нажатий имеет смысл помнить. */
const MAX_LEN = CODES.reduce((m, c) => Math.max(m, c.digits.length), 0);

/** Раскрытое в ЭТОМ матче. Ключ матча — чтобы не протекало между играми. */
let revealedTypes: UnitType[] = [];
let revealedGid = "";
/** Последние нажатия (хвост длиной MAX_LEN). */
let buffer: number[] = [];
let lastPressAt = 0;
/** Кому сообщить, что код сработал (ставит гост и подсвечивает слот). */
let onReveal: ((type: UnitType) => void) | null = null;

function currentGid(): string {
  try {
    return location.pathname.split("/game/")[1] ?? "";
  } catch {
    return "";
  }
}

function syncMatch(): void {
  const gid = currentGid();
  if (gid === revealedGid) return;
  revealedGid = gid;
  revealedTypes = [];
  buffer = [];
}

/** Что уже раскрыто вводом в этом матче (сетка показывает это слотом). */
export function revealedSecrets(): readonly UnitType[] {
  syncMatch();
  return revealedTypes;
}

export function isSecretRevealed(t: UnitType): boolean {
  return revealedSecrets().includes(t);
}

/** Кого дёрнуть при удачном коде (UnitDisplay ставит гост). */
export function setSecretRevealHandler(
  fn: ((type: UnitType) => void) | null,
): void {
  onReveal = fn;
}

/**
 * Нажали «цифру»: 1–9 = позиция слота в сетке (слева направо, сверху вниз),
 * 0 = широкая кнопка под сеткой.
 *
 * Возвращает раскрытый тип, если этим нажатием код сошёлся.
 *
 * ⚠️ Вызывать ДО гейтов доступности: слоты нижнего ряда премиальные и серые, а
 * при неполном пуле бывают пустыми — иначе часть цифр просто не нажимается.
 */
export function feedSecretDigit(digit: number): UnitType | null {
  syncMatch();
  const now = Date.now();
  // Пауза дольше таймаута = это уже не набор кода, а обычная игра.
  if (now - lastPressAt > TERRON_SECRET_CODE_TIMEOUT_MS) buffer = [];
  lastPressAt = now;
  buffer.push(digit);
  if (buffer.length > MAX_LEN) buffer = buffer.slice(-MAX_LEN);

  for (const code of CODES) {
    const tail = buffer.slice(-code.digits.length);
    if (tail.length < code.digits.length) continue;
    if (!tail.every((d, i) => d === code.digits[i])) continue;
    buffer = [];
    if (!revealedTypes.includes(code.type)) revealedTypes.push(code.type);
    onReveal?.(code.type);
    return code.type;
  }
  return null;
}

/** Только для тестов: полный сброс состояния между кейсами. */
export function resetSecretCodesForTest(): void {
  revealedTypes = [];
  revealedGid = currentGid();
  buffer = [];
  lastPressAt = 0;
  onReveal = null;
}
