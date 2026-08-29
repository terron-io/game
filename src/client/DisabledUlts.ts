// terron 24.08: РУБИЛЬНИК ПОЭТАПНОЙ РАСКАТКИ УЛЬТ — клиентская половина.
// Сервер выключает юниты из TERRON_DISABLED_ULTS во всех ОНЛАЙН-лобби сам
// (GameServer.enforceUltimateGate), но одиночка/офлайн/полигон через сервер
// не проходят — их конфиг собирает клиент. Этот модуль тянет список из
// /api/version, кэширует в localStorage (офлайн живёт последним увиденным)
// и отдаёт синхронно для LocalServer и карты /ults.
//
// Fail-open: сеть легла и кэша нет → пустой список (все ульты видны) — как
// у реле-гейта замков: матч важнее рубильника. На деве сервер отдаёт [].
const LS_KEY = "terron_disabled_ults";

let cached: string[] | null = null;

function readLs(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Синхронно: из памяти, иначе из localStorage (прошлый визит). */
export function disabledUltsSync(): string[] {
  if (cached === null) cached = readLs();
  return cached;
}

/**
 * Ролл/чузер в матче: выключен ли юнит рубильником (клиентский кэш).
 * Нужен ПОВЕРХ конфига матча: резюмнутые матчи со старым конфигом списка не
 * знают, а ролл обязан совпадать с картой /ults (репорт владельца 24.08).
 */
export function isUltRollDisabled(t: string): boolean {
  return disabledUltsSync().includes(t);
}

/** Обновить с сервера (зовётся на старте приложения и картой /ults). */
export async function refreshDisabledUlts(): Promise<string[]> {
  try {
    const r = await fetch("/api/version");
    if (!r.ok) return disabledUltsSync();
    const j: unknown = await r.json();
    const list = (j as { disabledUlts?: unknown })?.disabledUlts;
    if (!Array.isArray(list)) return disabledUltsSync();
    cached = list.filter((x): x is string => typeof x === "string");
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cached));
    } catch {
      // приватный режим — живём на памяти
    }
    return cached;
  } catch {
    return disabledUltsSync();
  }
}
