import newsItemsFallback from "resources/news.json";
import { z } from "zod";
import type { NewsItem } from "../core/ApiSchemas";
import {
  NewsItemSchema,
  PlayerProfile,
  PlayerProfileSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { AnalyticsRecord, AnalyticsRecordSchema } from "../core/Schemas";
import { getPersistentID, getAuthHeader, logOut, userAuth } from "./Auth";
import { payHostHeaders } from "./PayGate";
import { platformAuthHeaders } from "./PlatformContext";

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return false;
    const { jwt } = userAuthResult;

    const url = `${getApiBase()}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}

let __userMe: Promise<UserMeResponse | false> | null = null;
export async function getUserMe(): Promise<UserMeResponse | false> {
  if (__userMe !== null) {
    return __userMe;
  }
  const p = (async () => {
    try {
      const userAuthResult = await userAuth();
      if (!userAuthResult) return false;
      const { jwt } = userAuthResult;

      // Get the user object
      const response = await fetch(getApiBase() + "/users/@me", {
        headers: {
          authorization: `Bearer ${jwt}`,
        },
      });
      if (response.status === 401) {
        await logOut();
        return false;
      }
      if (response.status !== 200) return false;
      const body = await response.json();
      const result = UserMeResponseSchema.safeParse(body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        console.error("Invalid response", error);
        return false;
      }
      return result.data;
    } catch (e) {
      return false;
    }
  })();
  __userMe = p;
  // terron: НЕ кэшируем неудачу. getUserMe зовётся очень рано (до того как
  // refreshJwt поднимет сессию) → раньше кэшировался `false` НАВСЕГДА: клан-тег
  // участника оставался красным, баланс/косметика не грузились, хотя вход есть.
  // Теперь при false сбрасываем кэш — следующий вызов (после готовности auth)
  // перезапросит и получит реальные данные.
  const settled = await p;
  if (settled === false && __userMe === p) {
    __userMe = null;
  }
  return settled;
}

export function invalidateUserMe() {
  __userMe = null;
}

export async function purchaseWithCurrency(
  cosmeticType: "pattern" | "skin" | "flag",
  cosmeticName: string,
  currencyType: "hard" | "soft",
  colorPaletteName?: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/shop/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        cosmeticType,
        cosmeticName,
        currencyType,
        colorPaletteName,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "purchaseWithCurrency: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("purchaseWithCurrency: request failed", e);
    return false;
  }
}

export async function createCheckoutSession(
  priceId: string,
  colorPaletteName?: string,
): Promise<string | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          priceId: priceId,
          hostname: window.location.origin,
          colorPaletteName: colorPaletteName,
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "createCheckoutSession: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("createCheckoutSession: request failed", e);
    return false;
  }
}

export async function cancelSubscription(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/cancel`, {
      method: "POST",
      headers: {
        Authorization: await getAuthHeader(),
      },
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "cancelSubscription: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("cancelSubscription: request failed", e);
    return false;
  }
}

export async function changeSubscriptionTier(
  tierName: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${getApiBase()}/subscriptions/@me/change-tier`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ tierName }),
      },
    );
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "changeSubscriptionTier: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("changeSubscriptionTier: request failed", e);
    return false;
  }
}

export async function openSubscriptionPortal(): Promise<string | false> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/portal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        returnUrl: window.location.origin,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "openSubscriptionPortal: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("openSubscriptionPortal: request failed", e);
    return false;
  }
}

// ── Кошелёк ЛТС/ПТС + правила экономики ────────────────────────────────────────
export interface WalletBalances {
  lts: number;
  pts: number;
}
export interface WalletTx {
  currency: "lts" | "pts";
  amount: number;
  reason: string;
  balance_after: number;
  ref: string | null;
  created_at: string;
}
export interface EconomyRules {
  // terron 21.08: поля выправлены ПО ФАКТУ ответа /economy/rules. Раньше здесь
  // стоял несуществующий ltsPerKill — страница «как получить» печатала
  // «+undefined за съеденного игрока» (репорт владельца со скриншотом).
  rates: {
    ltsPerMinute: number;
    ltsMinPerMatch: number;
    ltsPerNation: number;
    ptsPerPlayerKill: number;
    ptsPerWin: number;
    ltsPerAchievement: number;
  };
  caps: {
    ltsPerDay: number;
    ptsPerDayFree: number;
    ptsPerDayPremium: number;
    ptsDoublePerDay?: number;
    ptsDoublePerDayPremium?: number;
  };
}

export async function getWallet(): Promise<WalletBalances | null> {
  try {
    const r = await fetch(getApiBase() + "/me/wallet", {
      headers: { Authorization: await getAuthHeader() },
    });
    return r.ok ? ((await r.json()) as WalletBalances) : null;
  } catch {
    return null;
  }
}

/**
 * terron: ЗАБРАТЬ ОТЛОЖЕННЫЕ НАГРАДЫ. Выиграл золотой матч ДО регистрации →
 * алмазы лежат на сервере «на предъявителя» по анонимному persistentID этого
 * браузера (он остаётся в localStorage и после логина — чистится только при
 * выходе). Зовём один раз за загрузку у залогиненного игрока; вернёт нули,
 * если забирать нечего. См. platform-api /me/rewards/claim.
 */
export async function claimPendingRewards(
  anonIds: string[],
): Promise<{ lts: number; pts: number }> {
  const empty = { lts: 0, pts: 0 };
  if (anonIds.length === 0) return empty;
  try {
    const r = await fetch(getApiBase() + "/me/rewards/claim", {
      method: "POST",
      headers: {
        Authorization: await getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ anonIds }),
    });
    if (!r.ok) return empty;
    return (
      ((await r.json()) as { claimed?: { lts: number; pts: number } })
        .claimed ?? empty
    );
  } catch {
    return empty;
  }
}

export async function getWalletHistory(limit = 50): Promise<WalletTx[]> {
  try {
    const r = await fetch(`${getApiBase()}/me/wallet/history?limit=${limit}`, {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return [];
    return (
      ((await r.json()) as { transactions: WalletTx[] }).transactions ?? []
    );
  } catch {
    return [];
  }
}

export async function getEconomyRules(): Promise<EconomyRules | null> {
  try {
    const r = await fetch(getApiBase() + "/economy/rules");
    return r.ok ? ((await r.json()) as EconomyRules) : null;
  } catch {
    return null;
  }
}

// ── Пополнение (пакеты ПТС за рубли) ────────────────────────────────────────
// Бэкенд: platform-api routes/pay.ts. Провайдер скрыт за адаптером, клиент про
// него не знает — получает только ссылку на оплату.
export interface PtsPack {
  sku: string;
  pts: number;
  priceRub: number;
  badge: string | null;
  /**
   * terron 25.08: сколько дней TERRON Prime дарит этот пакет (лестница живёт в
   * platform-api/src/orders.ts PTS_PACKS.primeDays). Подпись собирает КЛИЕНТ по
   * этому числу — серверный `primeLabel` только по-русски, а витрина двуязычна.
   */
  primeDays?: number;
}

export interface PayPacks {
  enabled: boolean;
  multiplier: number;
  bonus: boolean;
  packs: PtsPack[];
}

export async function getPayPacks(): Promise<PayPacks | null> {
  try {
    const r = await fetch(getApiBase() + "/pay/packs", {
      // terron 26.08: ХОСТ ЕДЕТ НА СЕРВЕР. Без этих двух заголовков сервер не
      // может отличить сайт от каталога площадки и от нашей апки: у fetch
      // `Sec-Fetch-Dest` ВСЕГДА `empty`, во фрейме он тоже `empty`. См.
      // client/PayGate.ts и platform-api/src/payGate.ts.
      headers: {
        Authorization: await getAuthHeader(),
        ...payHostHeaders(),
        ...platformAuthHeaders(),
      },
    });
    return r.ok ? ((await r.json()) as PayPacks) : null;
  } catch {
    return null;
  }
}

/** Заказ → ссылка на оплату. null = не вышло (не залогинен, оплата выключена). */
export async function createPayment(sku: string): Promise<string | null> {
  try {
    const r = await fetch(getApiBase() + "/pay/create", {
      method: "POST",
      credentials: "include", // серверная страница ходит по куке, клиент — по токену
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
        // Тот же хост, что и у витрины: заказ из площадки/апки сервер отобьёт.
        ...payHostHeaders(),
        ...platformAuthHeaders(),
      },
      // ⚠️ vid = persistentID. Сервер это поле принимал с самого начала, но
      // клиент его не слал — и все заказы легли с пустым vid, то есть выручку
      // нельзя было разложить по источникам трафика (мост orders.vid →
      // traffic_journey.vid). Найдено 28.08 по пустой колонке «Источник».
      body: JSON.stringify({ sku, vid: getPersistentID() }),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { payUrl?: string };
    return d.payUrl ?? null;
  } catch {
    return null;
  }
}

// ── Магазин / косметика ─────────────────────────────────────────────────────────
export interface ShopItem {
  sku: string;
  kind: "skin" | "slot";
  title: string;
  priceLts: number | null;
  pricePts: number | null;
  url?: string;
  mode?: number;
  tileTiles?: number;
  dim?: number;
  tags?: string[];
  search?: string; // алиасы для мультиязычного поиска
  owned: boolean;
}
export interface CustomSkin {
  id: string;
  data_url: string;
  mode: number;
  dim: number;
  tile_tiles: number;
  status: string;
  created_at: string;
}

export async function getCatalog(): Promise<ShopItem[]> {
  try {
    const r = await fetch(getApiBase() + "/shop/catalog");
    if (!r.ok) return [];
    return ((await r.json()) as { items: ShopItem[] }).items ?? [];
  } catch {
    return [];
  }
}

export interface RatingRow {
  /**
   * Хэндл для ссылки `/@…`: слаг, а если его нет — номер аккаунта. ⚠️ Ссылку
   * строить ТОЛЬКО по нему: слага нет у большинства игроков, и по сырому
   * `slug` выходило `/@null` → досье 404 (репорт владельца 26.08).
   * Опционален: старый API мог не отдавать.
   */
  handle?: string | null;
  /** Сырой слаг: может быть null (у «Наций» — служебное имя). */
  slug: string | null;
  name: string;
  // terron: есть своя аватарка → рисуем картинку из API (Avatar.customAvatarUrl),
  // иначе портрет по seed. Саму картинку в списках не гоняем — см. Avatar.ts.
  hasAvatar?: boolean;
  rating: number;
  matches: number;
  wins: number;
  winRate: number;
  pvpMatches: number;
  pvpWins: number;
  pvpWinRate: number;
  pveMatches: number;
  pveWins: number;
  pveWinRate: number;
}

/** ФФА ПВП лидерборд (все с ≥10 матчей + «Нации»). Публичный. */
export async function getRatingLeaderboard(): Promise<RatingRow[]> {
  try {
    const r = await fetch(getApiBase() + "/rating/leaderboard");
    if (!r.ok) return [];
    return ((await r.json()) as { rows: RatingRow[] }).rows ?? [];
  } catch {
    return [];
  }
}

export interface SpeedrunRow {
  /** Хэндл для ссылки `/@…` (слаг ИЛИ номер) — см. RatingRow.handle. */
  handle?: string | null;
  slug: string | null;
  name: string;
  best: number; // лучшее время, сек
  runs: number;
  // terron 2026-07-05: матч лучшего забега — для «смотреть» (реплей).
  // Опциональны: старый API мог не отдавать (обратная совместимость).
  gameId?: string | null;
  hasReplay?: boolean;
  // terron 2026-07-26: с какого устройства сыгран ЛУЧШИЙ забег игрока.
  // device — по UA на игровом сервере (фолбэк, подделывается тумблером);
  // inputMode — по живым pointer-событиям матча (client/InputMode.ts),
  // основной сигнал для значка 📱. Значок — справка, не категория топа.
  device?: "mobile" | "tablet" | "desktop" | null;
  inputMode?: "touch" | "mouse" | "mixed" | null;
  hasAvatar?: boolean;
}

/**
 * Эпоха баланса: версия правил, при которой сыграны забеги. Топ сравнивает
 * только внутри эпохи, прежние уезжают в «Архив» (см. TERRON_BALANCE_EPOCH).
 */
export interface BalanceEpoch {
  epoch: number;
  label: string | null; // EN-база из игры («Capitals»), RU — оверлеем в UI
  runs: number;
  current: boolean;
  firstAt: string | null;
  lastAt: string | null;
}

/**
 * Спидран-лидерборд категории (карта Мира, онлайн). Публичный.
 * `epoch` — архивная эпоха баланса; без неё API отдаёт актуальную.
 */
export async function getSpeedrunLeaderboard(
  difficulty: string,
  solo: boolean,
  epoch?: number,
): Promise<SpeedrunRow[]> {
  try {
    const ep = epoch === undefined ? "" : `&epoch=${epoch}`;
    const r = await fetch(
      `${getApiBase()}/speedrun/leaderboard?difficulty=${encodeURIComponent(
        difficulty,
      )}&solo=${solo ? "true" : "false"}${ep}`,
    );
    if (!r.ok) return [];
    return ((await r.json()) as { rows: SpeedrunRow[] }).rows ?? [];
  } catch {
    return [];
  }
}

/** Эпохи баланса с забегами (для переключателя «актуальный / архив»). */
export async function getSpeedrunEpochs(): Promise<BalanceEpoch[]> {
  try {
    const r = await fetch(getApiBase() + "/speedrun/epochs");
    if (!r.ok) return [];
    return ((await r.json()) as { epochs: BalanceEpoch[] }).epochs ?? [];
  } catch {
    return [];
  }
}

export interface ExcludedRun {
  gameId: string;
  difficulty: string;
  solo: boolean;
  durationSeconds: number;
  reasons: string[]; // машинные коды («bots=336»), переводит RatingPage
  createdAt: string;
}

/** Мои победы на World FFA, НЕ попавшие в топ спидрана, с кодами причин. */
export async function getMyExcludedSpeedruns(): Promise<ExcludedRun[]> {
  try {
    const r = await fetch(getApiBase() + "/me/speedrun/excluded", {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return [];
    return ((await r.json()) as { rows: ExcludedRun[] }).rows ?? [];
  } catch {
    return [];
  }
}

export async function getMyCosmetics(): Promise<{
  owned: string[];
  customs: CustomSkin[];
}> {
  try {
    const r = await fetch(getApiBase() + "/me/cosmetics", {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return { owned: [], customs: [] };
    return (await r.json()) as { owned: string[]; customs: CustomSkin[] };
  } catch {
    return { owned: [], customs: [] };
  }
}

export async function buyItem(
  sku: string,
  currency: "lts" | "pts",
): Promise<{ ok: boolean; error?: string; skinId?: string }> {
  try {
    const r = await fetch(getApiBase() + "/shop/buy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ sku, currency }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      error?: string;
      skinId?: string;
    };
    return r.ok
      ? { ok: true, skinId: j.skinId }
      : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Задать ник купленному скину-черновику (бесплатно).
export async function nameSkin(
  id: string,
  name: string,
): Promise<{ ok: boolean; skin?: NamedSkin; error?: string }> {
  try {
    const r = await fetch(`${getApiBase()}/skins/${id}/name`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ name }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      skin?: NamedSkin;
      error?: string;
    };
    return r.ok ? { ok: true, skin: j.skin } : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Имя столицы скина-«государства» (50 ПТС; пустое = снять, бесплатно).
export async function setSkinCapitalName(
  id: string,
  name: string,
): Promise<{ ok: boolean; skin?: NamedSkin; error?: string }> {
  try {
    const r = await fetch(`${getApiBase()}/skins/${id}/capital-name`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ name }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      skin?: NamedSkin;
      error?: string;
    };
    return r.ok ? { ok: true, skin: j.skin } : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Узор ядерного пепла (50 ПТС; index 0 = снять, бесплатно).
export async function setSkinFalloutSkin(
  id: string,
  index: number,
): Promise<{ ok: boolean; skin?: NamedSkin; error?: string }> {
  try {
    const r = await fetch(`${getApiBase()}/skins/${id}/fallout-skin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ index }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      skin?: NamedSkin;
      error?: string;
    };
    return r.ok ? { ok: true, skin: j.skin } : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

// ── Реестр именованных скинов (чашка) ──
// ползунки/поворот скина — для предзагрузки в редакторе (серверное запекание)
export interface SkinBake {
  b: number; // brightness %
  c: number; // contrast %
  s: number; // saturation %
  rot: number; // 0/90/180/270
  flip: boolean;
}

export interface NamedSkin {
  id: string;
  name: string | null; // null = купленный черновик без ника
  capital_name?: string | null; // имя столицы «государства» (null = генератор)
  fallout_skin?: number | null; // узор ядерного пепла 1..10 (null = по хэшу)
  data_url: string;
  mode: number;
  dim: number;
  tile_tiles: number;
  aspect?: number; // imgW/imgH — для статичного mode 4
  status: string;
  created_at: string;
  bake_params?: SkinBake | null; // ползунки/поворот (для редактора)
  has_master?: boolean; // есть чистый 4K-мастер → тир можно перепечь без перезаливки
}

export async function createNamedSkin(
  visual: string,
  name: string,
  mode: number,
  dim: number,
  tileTiles: number,
  hd: boolean,
  bake?: SkinBake | null,
  aspect?: number,
): Promise<{ ok: boolean; skin?: NamedSkin; error?: string }> {
  try {
    const r = await fetch(getApiBase() + "/skins/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        visual,
        name,
        mode,
        dim,
        tileTiles,
        hd,
        bake,
        aspect,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      skin?: NamedSkin;
      error?: string;
    };
    return r.ok ? { ok: true, skin: j.skin } : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function editNamedSkin(
  id: string,
  visual: string | null,
  mode: number,
  dim: number,
  tileTiles: number,
  hd = false,
  bake?: SkinBake | null,
  aspect?: number,
): Promise<{ ok: boolean; skin?: NamedSkin; error?: string }> {
  try {
    const r = await fetch(`${getApiBase()}/skins/${id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ visual, mode, dim, tileTiles, hd, bake, aspect }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      skin?: NamedSkin;
      error?: string;
    };
    return r.ok ? { ok: true, skin: j.skin } : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Чистый 4K-мастер своего скина — для редактора (живое превью ползунков по
// оригиналу). null, если мастера нет (legacy) или ошибка → редактор фолбэкнет на sample.
export async function getSkinMaster(id: string): Promise<string | null> {
  try {
    const r = await fetch(`${getApiBase()}/skins/${id}/master`, {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return null;
    return ((await r.json()) as { master: string | null }).master ?? null;
  } catch {
    return null;
  }
}

export async function getMyNamedSkins(): Promise<NamedSkin[]> {
  try {
    const r = await fetch(getApiBase() + "/me/skins", {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return [];
    return ((await r.json()) as { skins: NamedSkin[] }).skins ?? [];
  } catch {
    return [];
  }
}

export interface ModSkin extends NamedSkin {
  user_id: string;
  username: string | null;
}

/** ВСЕ скины (модерация, только админ — иначе 403 → []). */
export async function getAllSkins(): Promise<ModSkin[]> {
  try {
    const r = await fetch(getApiBase() + "/skins/all", {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return [];
    return ((await r.json()) as { skins: ModSkin[] }).skins ?? [];
  } catch {
    return [];
  }
}

/** Удалить скин по id (модерация). */
export async function deleteSkin(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${getApiBase()}/skins/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return false;
    return ((await r.json()) as { ok?: boolean }).ok ?? false;
  } catch {
    return false;
  }
}

/**
 * Публичный lookup по имени (виральность), С РАЗЛИЧЕНИЕМ ИСХОДА.
 * `ok:false` = не дозвонились (офлайн/5xx) — про ник НИЧЕГО не известно.
 * `ok:true, skin:null` = сервер ответил «за этим ником скина нет» — это ФАКТ.
 * Разница важна: по факту «скина нет» мы снимаем активный скин (NamedSkin.ts),
 * а по обрыву связи — НЕ снимаем, иначе офлайн-старт раздевал бы игрока.
 */
export async function getSkinByNameResult(
  name: string,
): Promise<{ ok: true; skin: NamedSkin | null } | { ok: false }> {
  try {
    const r = await fetch(
      `${getApiBase()}/skins/by-name/${encodeURIComponent(name)}`,
    );
    if (!r.ok) return { ok: false };
    return {
      ok: true,
      skin: ((await r.json()) as { skin: NamedSkin | null }).skin,
    };
  } catch {
    return { ok: false };
  }
}

/** Публичный lookup по имени (виральность). */
export async function getSkinByName(name: string): Promise<NamedSkin | null> {
  const r = await getSkinByNameResult(name);
  return r.ok ? r.skin : null;
}

export async function uploadCustomSkin(
  dataUrl: string,
  mode: number,
  dim: number,
  tileTiles: number,
): Promise<{ ok: boolean; skin?: CustomSkin; error?: string }> {
  try {
    const r = await fetch(getApiBase() + "/shop/skin/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ dataUrl, mode, dim, tileTiles }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      skin?: CustomSkin;
      error?: string;
    };
    return r.ok ? { ok: true, skin: j.skin } : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

// terron: РЕФРЕШ УЛЬТ — платный переролл сетки выбора за ЛТС (только залогиненным).
// Цену считает СЕРВЕР (по леджеру за матч), клиент лишь шлёт gameId. Возвращает
// списанную цену, следующую цену и остаток ЛТС; при нехватке — ok:false+insufficient.
export async function refreshUltimates(gameId: string): Promise<{
  ok: boolean;
  price?: number;
  nextPrice?: number;
  lts?: number;
  error?: string;
}> {
  try {
    const r = await fetch(getApiBase() + "/me/ult-refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ gameId }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      price?: number;
      nextPrice?: number;
      lts?: number;
      error?: string;
    };
    return r.ok
      ? { ok: true, price: j.price, nextPrice: j.nextPrice, lts: j.lts }
      : { ok: false, error: j.error ?? "error", price: j.price };
  } catch {
    return { ok: false, error: "network" };
  }
}

// terron 29.07: ИТОГИ МАТЧА — сколько начислено и можно ли удвоить за рекламу.
// Цифры считает СЕРВЕР по леджеру (клиент их не назначает), поэтому экран итогов
// показывает факт, а не собственную арифметику.
export interface MatchReward {
  lts: number;
  pts: number;
  doubledLts: number;
  doubledPts: number;
  canDouble: boolean;
  // Рекламу посмотрели раньше начисления (игрока съели, матч ещё шёл) —
  // удвоение применится вместе с наградой на архиве.
  doublePending?: boolean;
  // Суточный фарм и его потолок: нулевая награда чаще всего означает не сбой,
  // а выбранный дневной лимит — и об этом честнее сказать прямо.
  dailyLts?: number;
  dailyLtsCap?: number;
  dailyPts?: number;
  dailyPtsCap?: number;
}

export async function getMatchReward(
  gameId: string,
): Promise<MatchReward | null> {
  try {
    const r = await fetch(
      `${getApiBase()}/me/match-reward/${encodeURIComponent(gameId)}`,
      { headers: { Authorization: await getAuthHeader() } },
    );
    if (!r.ok) return null;
    return (await r.json()) as MatchReward;
  } catch {
    return null;
  }
}

/** Удвоить награду за матч (после просмотра rewarded). Идемпотентно на сервере. */
export async function doubleMatchReward(
  gameId: string,
): Promise<MatchReward | null> {
  try {
    const r = await fetch(`${getApiBase()}/me/match-reward/double`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ gameId }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { summary?: MatchReward };
    return j.summary ?? null;
  } catch {
    return null;
  }
}

export function getApiBase() {
  const domainname = getAudience();

  if (domainname === "localhost") {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

export function getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

// Check if the user's account is linked to a Discord or email account.
export function hasLinkedAccount(
  userMeResponse: UserMeResponse | false,
): boolean {
  return (
    userMeResponse !== false &&
    (userMeResponse.user?.discord !== undefined ||
      userMeResponse.user?.email !== undefined)
  );
}

export async function fetchGameById(
  gameId: string,
): Promise<AnalyticsRecord | false> {
  try {
    const url = `${getApiBase()}/game/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchGameById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = AnalyticsRecordSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchGameById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchGameById: request failed", err);
    return false;
  }
}

export async function fetchPlayerLeaderboard(
  page: number,
): Promise<RankedLeaderboardResponse | "reached_limit" | false> {
  try {
    const url = new URL(`${getApiBase()}/leaderboard/ranked`);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = RankedLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Handle "Page must be between X and Y" error as end of list
      if (json?.message?.includes?.("Page must be between")) {
        return "reached_limit";
      }
      console.warn(
        "fetchPlayerLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchPlayerLeaderboard: request failed", err);
    return false;
  }
}

export async function getNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch(`${getApiBase()}/news.json`, {
      headers: { Accept: "application/json" },
    });
    if (res.status !== 200) {
      console.warn("getNews: unexpected status", res.status);
      return newsItemsFallback as NewsItem[];
    }
    const json = await res.json();
    // API отдаёт либо голый массив, либо { items: [...] } — принимаем оба.
    // Раньше ждали только массив → Zod-ошибка в консоли на КАЖДОЙ загрузке и
    // вечный фолбэк. Пустой/битый ответ → фолбэк (в бандле есть реальные новости).
    const raw = Array.isArray(json)
      ? json
      : Array.isArray((json as { items?: unknown })?.items)
        ? (json as { items: unknown[] }).items
        : null;
    const parsed = z.array(NewsItemSchema).safeParse(raw);
    if (!parsed.success || parsed.data.length === 0) {
      return newsItemsFallback as NewsItem[];
    }
    return parsed.data;
  } catch (err) {
    console.warn("getNews: request failed, using fallback", err);
    return newsItemsFallback as NewsItem[];
  }
}






// ---- terron profile (api.terron.io platform-api) ----

export interface TerronStats {
  games: number;
  wins: number;
  winRate: number;
  deaths: number;
  abandons: number;
  abandonRate: number;
  survivalTotalSeconds: number;
  survivalAvgSeconds: number;
  survivalBestSeconds: number;
  conquests: number;
  eatenPlayers: number;
  eatenNations: number;
  eatenTribes: number;
  betrayals: number;
  alliesPlayers: number;
  alliesNations: number;
  alliesTribes: number;
  goldEarned: number;
  attacksSent: number;
  bombsLaunched: number;
  bombsLanded: number;
  structuresBuilt: number;
  boatsSent: number;
  xp: number;
  level: number;
}

/** Серия подряд: сейчас и лучшая за всё время. Ленты независимы (см. streaks.ts). */
export interface TerronStreakPair {
  current: number;
  best: number;
}

export interface TerronStreaks {
  win: TerronStreakPair; // побед подряд
  bad: TerronStreakPair; // подряд без побед (проигрыш = лив)
  golden: TerronStreakPair; // побед подряд в золотых
  diamond: TerronStreakPair; // побед подряд в алмазных
}

export interface TerronAchievement {
  id: string;
  family: string;
  tier: number;
  icon: string;
  reward: number; // награда ЛТС за разблокировку
  threshold: number;
  progress: number; // текущее значение метрики (для прогресс-бара)
  enabled: boolean;
  unlockedAt: string | null;
}

export interface TerronGame {
  game_id: string;
  mode: string | null;
  map: string | null;
  started_at: string | null;
  won: boolean;
  abandoned: boolean;
  survival_seconds: number;
  // запись ходов сохранена → можно открыть реплей (/game/:id)
  has_replay?: boolean;
  // событийный матч: "golden" | "diamond" | null — метка ⭐/💎 в реплеях досье
  event_tier?: string | null;
}

export interface TerronProfile {
  user: {
    name: string;
    slug: string | null; // null = ещё не задан
    number?: number; // публичный порядковый номер аккаунта (#1000+)
    avatar?: string | null; // кастомная аватарка (data-URL) или null → идентикон
    url?: string;
    email?: string | null;
    // Через что игрок входит (email/gamepush/yandex/…) — подпись «Вход через».
    authProvider?: string | null;
    points?: number; // = pts (обратная совместимость)
    lts?: number; // soft, игровые
    pts?: number; // paid
    // terron: обучение пройдено (см. Tutorial.shouldShowTutorialEntry).
    tutorialDone?: boolean;
  };
  stats: TerronStats;
  achievements: TerronAchievement[];
  games: TerronGame[];
  // terron 27.08: СЕРИИ. Ачивка знает только ЛУЧШУЮ серию (её метрика обязана
  // быть монотонной), поэтому текущая едет отдельным полем — иначе «7/10» в
  // досье после проигрыша читается как враньё. Старый API поля не отдаёт → «?».
  streaks?: TerronStreaks;
  // Отношение зрителя к этому игроку (для кнопки в досье). Есть только у чужих
  // профилей и только если зритель залогинен; иначе state="none".
  relation?: {
    state: "self" | "friends" | "incoming" | "outgoing" | "none";
    requestId?: string;
  };
}

// ── Ачивки: каталог + админ-правка ──────────────────────────────────────────
export interface TerronAchievementConfig {
  id: string;
  family: string;
  tier: number;
  icon: string;
  stat: string;
  threshold: number;
  reward: number;
  enabled: boolean;
}

// ── Дейли-квесты («задачи на сегодня») ──────────────────────────────────────
export interface TerronDailyQuest {
  id: string;
  icon: string;
  threshold: number;
  reward: number;
  progress: number;
  claimed: boolean;
}

/** Дейлики залогиненного юзера (null если не авторизован). */
export async function getDailyQuests(): Promise<{
  day: string;
  quests: TerronDailyQuest[];
} | null> {
  try {
    const auth = await getAuthHeader();
    if (!auth) return null;
    const r = await fetch(getApiBase() + "/me/daily", {
      headers: { Authorization: auth },
    });
    if (!r.ok) return null;
    return (await r.json()) as { day: string; quests: TerronDailyQuest[] };
  } catch {
    return null;
  }
}


/** Правка ачивки (награда/порог/вкл). Возвращает обновлённую или null. */
export async function updateAchievement(
  id: string,
  patch: {
    reward?: number | null;
    threshold?: number | null;
    enabled?: boolean;
  },
): Promise<TerronAchievementConfig | null> {
  try {
    const r = await fetch(
      `${getApiBase()}/admin/achievements/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: await getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      },
    );
    if (!r.ok) return null;
    return ((await r.json()) as { item: TerronAchievementConfig }).item ?? null;
  } catch {
    return null;
  }
}



/** Установить абсолютные балансы юзера (только переданные валюты). */
export async function setUserWallet(
  id: string,
  patch: { lts?: number; pts?: number },
): Promise<{ lts: number; pts: number } | null> {
  try {
    const r = await fetch(
      `${getApiBase()}/admin/users/${encodeURIComponent(id)}/wallet`,
      {
        method: "PATCH",
        headers: {
          Authorization: await getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      },
    );
    if (!r.ok) return null;
    return (
      ((await r.json()) as { balances: { lts: number; pts: number } })
        .balances ?? null
    );
  } catch {
    return null;
  }
}

// ── «Чашка Петри» (petridish): привязка аккаунта + лог бонусов ────────────────
export interface PetriLogEntry {
  id: number;
  kind: string; // link | win
  game_id: string | null;
  bonus_type: string; // ExpMult | ExpAdd | PTSMult | PTSAdd
  bonus_size: number;
  duration: number; // секунды
  status: string; // sent | too_frequent | banned | not_found | failed | skipped
  bonus_id: number | null;
  error: string | null;
  created_at: string;
}
export interface PetriState {
  playerId: number | null;
  log: PetriLogEntry[];
}

/** Привязка + лог. null, если не авторизован. */
export async function getPetriDish(): Promise<PetriState | null> {
  try {
    const auth = await getAuthHeader();
    if (!auth) return null;
    const r = await fetch(getApiBase() + "/me/petridish", {
      headers: { Authorization: auth },
    });
    if (!r.ok) return null;
    return (await r.json()) as PetriState;
  } catch {
    return null;
  }
}

export interface PetriLinkBonus {
  granted: boolean;
  status?: string;
}

/** Привязать uid Чашки Петри. */
export async function setPetriDish(playerId: number): Promise<{
  ok: boolean;
  error?: string;
  playerId?: number;
  linkBonus?: PetriLinkBonus;
}> {
  try {
    const r = await fetch(getApiBase() + "/me/petridish", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ playerId }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      error?: string;
      playerId?: number;
      linkBonus?: PetriLinkBonus;
    };
    return r.ok
      ? { ok: true, playerId: j.playerId, linkBonus: j.linkBonus }
      : { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Снять привязку Чашки Петри. */
export async function clearPetriDish(): Promise<boolean> {
  try {
    const r = await fetch(getApiBase() + "/me/petridish", {
      method: "DELETE",
      headers: { Authorization: await getAuthHeader() },
    });
    return r.ok;
  } catch {
    return false;
  }
}


/** Full profile for the logged-in user. Null when not authenticated. */
export async function getMyProfile(): Promise<TerronProfile | null> {
  try {
    const auth = await getAuthHeader();
    if (!auth) return null;
    const res = await fetch(`${getApiBase()}/me/profile`, {
      headers: { authorization: auth, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as TerronProfile;
  } catch (err) {
    console.warn("getMyProfile: request failed", err);
    return null;
  }
}

/** terron 01.08: отметить в аккаунте, что обучение пройдено. Нужна, чтобы на
 *  другом устройстве предложение обучения не всплыло заново (локальный флаг
 *  туда не переезжает). Аноним — тихо отваливается по отсутствию токена. */
export async function reportTutorialDone(): Promise<void> {
  const auth = await getAuthHeader();
  if (!auth) return;
  await fetch(`${getApiBase()}/me/tutorial-done`, {
    method: "POST",
    headers: { authorization: auth },
  });
}

/** Update account display name and/or URL slug. */
export async function updateMe(patch: {
  name?: string;
  slug?: string;
  avatar?: string | null;
}): Promise<{ ok: boolean; error?: string; name?: string; slug?: string }> {
  try {
    const res = await fetch(`${getApiBase()}/me`, {
      method: "PATCH",
      headers: {
        authorization: await getAuthHeader(),
        "content-type": "application/json",
      },
      body: JSON.stringify(patch),
    });
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      name?: string;
      slug?: string;
    };
    if (!res.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}` };
    return { ok: true, name: j.name, slug: j.slug };
  } catch {
    return { ok: false, error: "network" };
  }
}

// ---- terron: /propaganda баннеры (админ-загрузка + публичная галерея) ----
export interface PropagandaBanner {
  id: string;
  title: string;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

/** Публичный список загруженных админом баннеров (новые сверху). */
export async function getPropagandaBanners(): Promise<PropagandaBanner[]> {
  try {
    const res = await fetch(`${getApiBase()}/propaganda/banners`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { banners?: PropagandaBanner[] };
    return Array.isArray(j.banners) ? j.banners : [];
  } catch {
    return [];
  }
}

/**
 * Сколько платных рефрешей ульт игрок уже сделал в ЭТОМ матче и почём будет
 * следующий. Истина — леджер на сервере: клиентский счётчик живёт в памяти
 * вкладки и обнуляется при F5 (см. primeUltRefreshOffset).
 */
export async function getUltRefreshState(
  gameId: string,
): Promise<{ n: number; price: number } | null> {
  try {
    const r = await fetch(
      `${getApiBase()}/me/ult-refresh?gameId=${encodeURIComponent(gameId)}`,
      { headers: { Authorization: await getAuthHeader() } },
    );
    if (!r.ok) return null; // 401 у анонима — рефреш ему и так недоступен
    const j = (await r.json()) as { n?: number; price?: number };
    return typeof j.n === "number" && typeof j.price === "number"
      ? { n: j.n, price: j.price }
      : null;
  } catch {
    return null;
  }
}

/** terron: выдать/продлить/снять TERRON Prime игроку. until=null → снять. */
export async function setUserPrime(
  id: string,
  until: number | null,
): Promise<{ primeUntil: number | null } | null> {
  try {
    const r = await fetch(
      `${getApiBase()}/admin/users/${encodeURIComponent(id)}/prime`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ until }),
      },
    );
    if (!r.ok) return null;
    return (await r.json()) as { primeUntil: number | null };
  } catch {
    return null;
  }
}

// terron: кэш статуса TERRON Prime в localStorage — isTerronPrime() читает его
// СИНХРОННО в рендере сетки ульт. Обновляется из /me при старте.
export async function refreshPrimeStatus(): Promise<void> {
  try {
    const res = await fetch(`${getApiBase()}/me`, {
      headers: { authorization: await getAuthHeader() },
    });
    // 401 = мы не залогинены (или сессия истекла). Раньше тут был голый
    // return, и кэш прошлого хозяина устройства оставался лежать как есть —
    // после выхода из прем-аккаунта следующий игрок получал прем-ряд ульт.
    // Тот же класс, что чинили у clearUltUnlocks 23.08.
    if (res.status === 401 || res.status === 403) {
      clearPrimeStatus();
      return;
    }
    if (!res.ok) return; // 5xx/сеть — статус неизвестен, кэш не трогаем
    const j = (await res.json()) as { prime?: boolean; primeUntil?: number };
    localStorage.setItem("terron_prime_active", j.prime ? "1" : "0");
    // Срок нужен странице /prime («активен до …»). Нет према — ключа нет.
    if (j.prime && typeof j.primeUntil === "number") {
      localStorage.setItem("terron_prime_until", String(j.primeUntil));
    } else {
      localStorage.removeItem("terron_prime_until");
    }
  } catch {
    /* ignore — прем не критичен */
  }
}

/** До какого момента действует прем (мс) — для страницы /prime. null = неизвестно. */
export function primeUntilMs(): number | null {
  try {
    const v = Number(localStorage.getItem("terron_prime_until"));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Забыть кэш према (выход из аккаунта / аноним). См. refreshPrimeStatus. */
export function clearPrimeStatus(): void {
  try {
    localStorage.removeItem("terron_prime_active");
    localStorage.removeItem("terron_prime_until");
  } catch {
    /* приватный режим — кэша всё равно нет */
  }
}

/** True, если текущий пользователь — админ (platform `/me`.admin). */
export async function isMeAdmin(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/me`, {
      headers: { authorization: await getAuthHeader() },
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { admin?: boolean };
    return !!j.admin;
  } catch {
    return false;
  }
}

/** Загрузить баннер (только админ; иначе бэкенд вернёт 403 → null). */
export async function adminUploadPropagandaBanner(input: {
  title: string;
  dataUrl: string;
  width: number;
  height: number;
}): Promise<PropagandaBanner | null> {
  try {
    const res = await fetch(`${getApiBase()}/admin/propaganda/banners`, {
      method: "POST",
      headers: {
        authorization: await getAuthHeader(),
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { banner?: PropagandaBanner };
    return j.banner ?? null;
  } catch {
    return null;
  }
}

/** Удалить баннер (только админ). */
export async function adminDeletePropagandaBanner(
  id: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getApiBase()}/admin/propaganda/banners/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: { authorization: await getAuthHeader() } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---- terron: игровые скриншоты (альбом игрока + публичная галерея) ----
export interface Screenshot {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  published: boolean;
  createdAt: string;
  author: { name: string; slug: string; number: number | null } | null;
}

/** Публичная галерея (только опубликованные скрины). */
export async function getPublicScreenshots(): Promise<Screenshot[]> {
  try {
    const res = await fetch(`${getApiBase()}/screenshots`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { screenshots?: Screenshot[] };
    return Array.isArray(j.screenshots) ? j.screenshots : [];
  } catch {
    return [];
  }
}

/** Мой альбом (вкл. неопубликованные). Требует входа. */
export async function getMyScreenshots(): Promise<Screenshot[]> {
  try {
    const res = await fetch(`${getApiBase()}/me/screenshots`, {
      headers: { authorization: await getAuthHeader() },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { screenshots?: Screenshot[] };
    return Array.isArray(j.screenshots) ? j.screenshots : [];
  } catch {
    return [];
  }
}

/** Сохранить скрин из игры в альбом. Возвращает запись или null. */
export async function uploadScreenshot(input: {
  dataUrl: string;
  width: number;
  height: number;
}): Promise<Screenshot | null> {
  try {
    const res = await fetch(`${getApiBase()}/screenshots`, {
      method: "POST",
      headers: {
        authorization: await getAuthHeader(),
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { screenshot?: Screenshot };
    return j.screenshot ?? null;
  } catch {
    return null;
  }
}

/** Опубликовать скрин в общую галерею (спишет 1000 ЛТС). */
export async function publishScreenshot(
  id: string,
): Promise<{ ok: boolean; lts?: number; error?: string }> {
  try {
    const res = await fetch(
      `${getApiBase()}/screenshots/${encodeURIComponent(id)}/publish`,
      { method: "POST", headers: { authorization: await getAuthHeader() } },
    );
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      lts?: number;
      error?: string;
    };
    if (!res.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}` };
    return { ok: true, lts: j.lts };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Удалить скрин (владелец или админ). */
export async function deleteScreenshot(id: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${getApiBase()}/screenshots/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: { authorization: await getAuthHeader() } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Public profile for any player by slug. Null when not found. */
export async function getProfileBySlug(
  slug: string,
): Promise<TerronProfile | null> {
  try {
    const s = slug.replace(/^@/, "");
    // Bearer (если залогинен) → бэкенд посчитает relation (друзья/заявка) для кнопки
    // в досье. Аноним шлёт пустой заголовок → relation="none".
    const res = await fetch(
      `${getApiBase()}/u/${encodeURIComponent(s)}/profile`,
      {
        headers: {
          Accept: "application/json",
          Authorization: await getAuthHeader(),
        },
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as TerronProfile;
  } catch (err) {
    console.warn("getProfileBySlug: request failed", err);
    return null;
  }
}

// terron: рейтинг тестировщиков — наигранное время на ДЕВ-сервере (по минутам).
// Пара с ачивкой «Тестер». Публичный эндпоинт. new-units/ULTIMATES.md
export interface TesterRow {
  /** Хэндл для ссылки `/@…` (слаг ИЛИ номер) — см. RatingRow.handle. */
  handle?: string | null;
  slug: string | null;
  username: string | null;
  seconds: number;
  hasAvatar?: boolean;
}

export async function getTestersLeaderboard(): Promise<TesterRow[]> {
  try {
    const r = await fetch(getApiBase() + "/rating/testers");
    if (!r.ok) return [];
    return ((await r.json()) as { rows: TesterRow[] }).rows ?? [];
  } catch {
    return [];
  }
}


// ── terron: ЗАМКИ НА УЛЬТЫ (TZ-ult-unlocks.md) ──────────────────────────────
export interface UltUnlockView {
  id: string; // строка UnitType
  pricePts: number;
  achievement: string;
  parent: string;
  unlocked: boolean;
  source: string | null;
  progress: number;
  threshold: number;
  achievementDone: boolean;
}

/** Моя витрина замков. null = не залогинен / сеть. */
export async function getMyUlts(): Promise<UltUnlockView[] | null> {
  try {
    const r = await fetch(getApiBase() + "/me/ults", {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { ults?: UltUnlockView[] };
    return Array.isArray(j.ults) ? j.ults : [];
  } catch {
    return null;
  }
}

/** Купить закрытую ульту за ПТС. */
export async function buyUlt(
  id: string,
): Promise<{ ok: true; balanceAfter: number } | { ok: false; error: string }> {
  try {
    const r = await fetch(
      getApiBase() + "/me/ults/" + encodeURIComponent(id) + "/buy",
      { method: "POST", headers: { Authorization: await getAuthHeader() } },
    );
    const j = (await r.json().catch(() => ({}))) as {
      balanceAfter?: number;
      error?: string;
    };
    if (!r.ok) return { ok: false, error: j.error ?? `http ${r.status}` };
    invalidateUserMe();
    return { ok: true, balanceAfter: j.balanceAfter ?? 0 };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
