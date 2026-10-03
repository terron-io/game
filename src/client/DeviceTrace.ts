// terron 28.09: ID УСТРОЙСТВА И ОТПЕЧАТОК БРАУЗЕРА ДЛЯ ЖУРНАЛА ЧАТА.
//
// Решение владельца: анонимов в чате связывать с устройством. Аноним получает
// новый id Centrifugo на каждый токен, поэтому без этого два его захода — два
// разных человека. Шлём:
//   • id устройства — тот же, что уже живёт в localStorage и считает воронку,
//     пульс онлайна и заказы (`getDeviceID`); внутри одного браузера это точная
//     связь;
//   • отпечаток браузера — экран, пояс, языки, ядра, память, тач, отпечаток
//     отрисовки 2D-холста. Совпадение отпечатка — ПОДСКАЗКА для модерации
//     («вероятно, тот же человек»), не доказательство: одинаковых устройств
//     много, а обновление браузера отпечаток меняет.
// ⚠️ GL-контекст ради отпечатка НЕ создаём: он отъедает слот из браузерного
// лимита — этим мы уже ломали игрокам графику ([[webgl-context-leak]]).
// ⚠️ Кэш/ETag-«вечные куки» не используем (решение владельца 28.09).
import { getDeviceID } from "./Auth";

export type DeviceFingerprint = Record<string, string | number | string[]>;

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Отпечаток отрисовки 2D-холста: текст и фигуры рисуются по-разному на
 *  разных связках ОС/шрифтов/видеокарты. Пусто, если холст недоступен. */
function canvasHash(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 220;
    c.height = 40;
    const g = c.getContext("2d");
    if (!g) return "";
    g.textBaseline = "top";
    g.font = "14px 'Arial'";
    g.fillStyle = "#f60";
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = "#069";
    g.fillText("TERRON.io ▲ ёж 😀", 2, 15);
    g.fillStyle = "rgba(102, 204, 0, 0.7)";
    g.beginPath();
    g.arc(180, 20, 14, 0, Math.PI * 2);
    g.fill();
    return fnv1a(c.toDataURL());
  } catch {
    return "";
  }
}

let cached: DeviceFingerprint | null = null;

export function deviceFingerprint(): DeviceFingerprint {
  if (cached) return cached;
  const fp: DeviceFingerprint = {};
  try {
    const s = window.screen;
    if (s) {
      fp.sw = s.width;
      fp.sh = s.height;
      fp.aw = s.availWidth;
      fp.ah = s.availHeight;
      fp.cd = s.colorDepth;
    }
    fp.dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  } catch {
    /* нет экрана — не беда */
  }
  try {
    fp.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* старый движок */
  }
  fp.tzo = new Date().getTimezoneOffset();
  const nav = navigator as Navigator & { deviceMemory?: number };
  fp.langs = (nav.languages ?? [nav.language]).slice(0, 5).map(String);
  fp.plat = String(nav.platform ?? "");
  if (nav.hardwareConcurrency) fp.hc = nav.hardwareConcurrency;
  if (nav.deviceMemory) fp.dm = nav.deviceMemory;
  fp.tp = nav.maxTouchPoints ?? 0;
  const cv = canvasHash();
  if (cv) fp.cv = cv;
  cached = fp;
  return fp;
}

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Заголовки для запроса токена чата: id устройства + отпечаток (base64 JSON —
 *  значение заголовка обязано быть ASCII). */
export function deviceTraceHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  const did = getDeviceID();
  if (did) out["X-Terron-Device"] = did;
  try {
    out["X-Terron-Fp"] = base64Utf8(JSON.stringify(deviceFingerprint()));
  } catch {
    /* без отпечатка токен всё равно выдаётся */
  }
  return out;
}

/** id устройства для поля `did` в публикации сообщения чата. */
export function chatDeviceId(): string {
  return getDeviceID();
}
