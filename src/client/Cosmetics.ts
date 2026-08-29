import { assetUrl } from "src/core/AssetUrls";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  Cosmetics,
  CosmeticsSchema,
  Flag,
  Pack,
  Pattern,
  Product,
  Skin,
  Subscription,
} from "../core/CosmeticSchemas";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPattern,
} from "../core/Schemas";
import { UserSettings } from "../core/game/UserSettings";
import {
  changeSubscriptionTier,
  createCheckoutSession,
  getApiBase,
  getUserMe,
  invalidateUserMe,
  purchaseWithCurrency,
} from "./Api";
import { applyNamedSkinWithTimeout, namedSkinRef } from "./NamedSkin";
import { confirmDialog, toast } from "./Toast";
import { translateText } from "./Utils";

export const TEMP_FLARE_OFFSET = 1 * 60 * 1000; // 1 minute

let __cosmetics: Promise<Cosmetics | null> | null = null;
let __cosmeticsHash: string | null = null;
let __cosmeticsCache: Cosmetics | null = null;

/**
 * Synchronous accessor for the most recently resolved cosmetics. Returns null
 * before the first successful `fetchCosmetics()` call. Useful when a code path
 * cannot await (e.g. WebGL per-frame sync).
 */
export function getCachedCosmetics(): Cosmetics | null {
  return __cosmeticsCache;
}

/**
 * Resolve the local player's selected skin from UserSettings + cached
 * cosmetics. Returns null if no skin is selected, cosmetics aren't loaded,
 * or the saved skin no longer exists.
 */
export function getLocalSelectedSkin(): { name: string; url: string } | null {
  const skinName = new UserSettings().getSelectedSkinName();
  if (!skinName) return null;
  const skin = __cosmeticsCache?.skins?.[skinName];
  if (!skin) return null;
  return { name: skin.name, url: skin.url };
}

export type PaymentMethod = "dollar" | "hard" | "soft";

export async function purchaseCosmetic(
  resolved: ResolvedCosmetic,
  method: PaymentMethod,
): Promise<void> {
  if (!resolved.cosmetic) return;
  const c = resolved.cosmetic;
  const colorPaletteName = resolved.colorPalette?.name;

  if (resolved.type === "subscription") {
    const sub = c as Subscription;
    const userMe = await getUserMe();
    const currentSub =
      userMe === false ? null : (userMe.player.subscription ?? null);

    if (currentSub) {
      if (currentSub.tier === sub.name) {
        toast(translateText("store.already_subscribed"));
        return;
      }

      // Direction-aware confirm based on priceMonthly. We don't have the
      // server's sortOrder client-side — priceMonthly is a good proxy.
      const currentCosmetic =
        (await fetchCosmetics())?.subscriptions?.[currentSub.tier] ?? null;
      const isUpgrade =
        currentCosmetic !== null
          ? sub.priceMonthly > currentCosmetic.priceMonthly
          : true;
      const targetName = translateCosmetic("subscriptions", sub.name);
      const confirmKey = isUpgrade
        ? "store.confirm_upgrade"
        : "store.confirm_downgrade";
      const confirmed = await confirmDialog(
        translateText(confirmKey, { tier: targetName }),
      );
      if (!confirmed) return;

      const ok = await changeSubscriptionTier(sub.name);
      if (!ok) {
        toast(translateText("store.change_tier_failed"));
        return;
      }
      toast(translateText("store.change_tier_success", { tier: targetName }));
      void import("./SoftNavigate").then(({ softReload }) => softReload());
      return;
    }
  }

  if (method === "dollar") {
    if (!c.product) {
      toast(translateText("store.checkout_failed"));
      return;
    }
    const url = await createCheckoutSession(
      c.product.priceId,
      colorPaletteName,
    );
    if (url === false) {
      toast(translateText("store.checkout_failed"));
      return;
    }
    window.location.href = url;
    return;
  }

  // Currency purchase (hard or soft) — not valid for subscriptions.
  if (resolved.type === "subscription") {
    console.error(
      "purchaseCosmetic: currency purchase not supported for subscriptions",
    );
    return;
  }
  // ResolvedCosmetic isn't a discriminated union, so the guard above doesn't
  // narrow cosmetic's type. Subscriptions are excluded by the runtime check.
  const priced = c as Pattern | Flag | Pack;
  const price =
    method === "hard" ? (priced.priceHard ?? 0) : (priced.priceSoft ?? 0);
  const userMe = await getUserMe();
  if (userMe === false) {
    toast(translateText("store.login_required"));
    return;
  }
  const balance =
    method === "hard"
      ? (userMe.player.currency?.hard ?? 0)
      : (userMe.player.currency?.soft ?? 0);
  if (balance < price) {
    toast(translateText("store.not_enough_currency"));
    if (method === "hard") {
      // Send the user to the packs tab so they can top up plutonium.
      window.location.hash = "#modal=store&tab=packs";
    }
    return;
  }

  const cosmeticType = resolved.type as "pattern" | "skin" | "flag";
  const success = await purchaseWithCurrency(
    cosmeticType,
    c.name,
    method,
    colorPaletteName,
  );
  if (!success) {
    toast(translateText("store.purchase_failed"));
    return;
  }
  toast(translateText("store.purchase_success", { name: c.name }));
  invalidateUserMe();
  void import("./SoftNavigate").then(({ softReload }) => softReload());
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export async function fetchCosmetics(): Promise<Cosmetics | null> {
  if (__cosmetics !== null) {
    return __cosmetics;
  }
  __cosmetics = (async () => {
    try {
      const response = await fetch(`${getApiBase()}/cosmetics.json`);
      if (!response.ok) {
        console.error(`HTTP error! status: ${response.status}`);
        return null;
      }
      const result = CosmeticsSchema.safeParse(await response.json());
      if (!result.success) {
        console.error(`Invalid cosmetics: ${result.error.message}`);
        return null;
      }
      const patternKeys = Object.keys(result.data.patterns).sort();
      const hashInput = patternKeys
        .map((k) => k + (result.data.patterns[k].product ? "sale" : ""))
        .join(",");
      __cosmeticsHash = simpleHash(hashInput);
      __cosmeticsCache = result.data;
      return result.data;
    } catch (error) {
      console.error("Error getting cosmetics:", error);
      return null;
    }
  })();
  return __cosmetics;
}

// terron: кэш флага клана по тегу. Флаг хранится на клане как data:image и
// отдаётся публично из GET /clans/:tag. На проводе летит лишь короткая ссылка
// `clan:<tag>`, картинку резолвим тут (каждый клиент — для рендера чужих флагов).
const clanFlagCache = new Map<string, string | undefined>();

// terron: заранее положить флаг клана в кэш (у нас уже есть картинка, напр. из
// списка «Мои кланы») → флаг показывается МГНОВЕННО, без round-trip к /clans/:tag.
export function primeClanFlag(
  tag: string,
  url: string | null | undefined,
): void {
  clanFlagCache.set(tag.toUpperCase(), url ?? undefined);
}

async function fetchClanFlagUrl(tag: string): Promise<string | undefined> {
  const key = tag.toUpperCase();
  const cached = clanFlagCache.get(key);
  if (cached !== undefined || clanFlagCache.has(key)) return cached;
  let url: string | undefined;
  try {
    const res = await fetch(`${getApiBase()}/clans/${encodeURIComponent(tag)}`);
    if (res.ok) {
      const c = (await res.json()) as { flag?: string | null };
      url = c.flag ?? undefined;
      // terron: кэшируем ТОЛЬКО успешный ответ (флаг ИЛИ подтверждённое его
      // отсутствие). При СБОЕ фетча (сеть/не-2xx) НЕ отравляем кэш undefined'ом —
      // иначе тяжёлый флаг (напр. [epta] ~200КБ), подвисший разок, «не грузился»
      // навсегда (.has(key) → больше не фетчили). Теперь — ретрай на след. заходе.
      clanFlagCache.set(key, url);
    }
  } catch {
    /* офлайн/ошибка — НЕ кэшируем, дадим ретрай в следующий раз */
  }
  return url;
}

export async function resolveFlagUrl(
  flagRef: string,
): Promise<string | undefined> {
  if (flagRef.startsWith("flag:")) {
    const key = flagRef.slice("flag:".length);
    const cosmetics = await fetchCosmetics();
    const flagData = cosmetics?.flags?.[key];
    return flagData?.url;
  }
  if (flagRef.startsWith("country:")) {
    const code = flagRef.slice("country:".length);
    return assetUrl(`flags/${code}.svg`);
  }
  if (flagRef.startsWith("clan:")) {
    return fetchClanFlagUrl(flagRef.slice("clan:".length));
  }
  return undefined;
}

// terron 20.07: ЕДИНАЯ точка «значение флага → готовая ссылка на картинку».
// Раньше каждый потребитель (карта в WebGLFrameBuilder, панель игрока в
// PlayerInfoOverlay) решал сам, и решал по-разному: панель гнала через
// assetUrl ВСЁ подряд — готовую картинку data:image/... он склеивал в
// относительный путь длиной в килобайты, nginx отвечал 414 Request-URI Too
// Large, и флаг клана в шапке не появлялся. Проверка формата живёт здесь.

/** Ссылка уже является картинкой и в assetUrl не нуждается. */
function isReadyImageUrl(u: string): boolean {
  return /^(data:|blob:|https?:)/i.test(u);
}

/**
 * Готовая ссылка на картинку флага БЕЗ асинхронного резолва — то, что можно
 * отдать в `<img src>` прямо сейчас. Для `clan:`/`flag:`/`country:` вернёт
 * значение, только если оно уже в кэше; иначе `undefined` — потребителю нужно
 * дождаться `flagImageUrl()` и перерисоваться.
 */
export function flagImageUrlSync(
  flagRef: string | null | undefined,
): string | undefined {
  if (!flagRef) return undefined;
  if (isReadyImageUrl(flagRef)) return flagRef;
  if (flagRef.startsWith("country:")) {
    return assetUrl(`flags/${flagRef.slice("country:".length)}.svg`);
  }
  if (flagRef.startsWith("clan:")) {
    const cached = clanFlagCache.get(
      flagRef.slice("clan:".length).toUpperCase(),
    );
    return cached !== undefined && isReadyImageUrl(cached)
      ? cached
      : cached !== undefined
        ? assetUrl(cached)
        : undefined;
  }
  if (flagRef.startsWith("flag:")) return undefined; // нужен fetchCosmetics
  return assetUrl(flagRef);
}

/**
 * Готовая ссылка на картинку флага. Сама решает, что перед ней: уже картинка
 * (`data:`/`blob:`/`http:`) — отдаём как есть; `clan:`/`flag:`/`country:` —
 * резолвим; иначе путь к ассету — через `assetUrl`.
 */
export async function flagImageUrl(
  flagRef: string | null | undefined,
): Promise<string | undefined> {
  if (!flagRef) return undefined;
  if (isReadyImageUrl(flagRef)) return flagRef;
  if (
    flagRef.startsWith("clan:") ||
    flagRef.startsWith("flag:") ||
    flagRef.startsWith("country:")
  ) {
    const resolved = await resolveFlagUrl(flagRef);
    if (resolved === undefined) return undefined;
    return isReadyImageUrl(resolved) ? resolved : assetUrl(resolved);
  }
  return assetUrl(flagRef);
}

export async function getCosmeticsHash(): Promise<string | null> {
  await fetchCosmetics();
  return __cosmeticsHash;
}

export function cosmeticRelationship(
  opts: {
    wildcardFlare: string;
    requiredFlare: string;
    product: Product | null;
    priceSoft?: number;
    priceHard?: number;
    affiliateCode: string | null;
    itemAffiliateCode: string | null;
  },
  userMeResponse: UserMeResponse | false,
): "owned" | "purchasable" | "blocked" {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);

  if (flares.includes(opts.wildcardFlare)) {
    return "owned";
  }

  if (flares.includes(opts.requiredFlare)) {
    return "owned";
  }

  if (opts.affiliateCode !== opts.itemAffiliateCode) {
    return "blocked";
  }

  // Purchasable if any purchase method is available
  if (opts.priceSoft !== undefined || opts.priceHard !== undefined) {
    return "purchasable";
  }

  if (opts.product === null) {
    return "blocked";
  }

  return "purchasable";
}

export function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (colorPalette === null) {
    // For backwards compatibility only show non-colored patterns if they are owned.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  if (colorPalette.isArchived) {
    // Check ownership first — if owned, show it even if archived.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}:${colorPalette.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  return cosmeticRelationship(
    {
      wildcardFlare: "pattern:*",
      requiredFlare: `pattern:${pattern.name}:${colorPalette.name}`,
      product: pattern.product,
      priceSoft: pattern.priceSoft,
      priceHard: pattern.priceHard,
      affiliateCode,
      itemAffiliateCode: pattern.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function flagRelationship(
  flag: Flag,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "flag:*",
      requiredFlare: `flag:${flag.name}`,
      product: flag.product,
      priceSoft: flag.priceSoft,
      priceHard: flag.priceHard,
      affiliateCode,
      itemAffiliateCode: flag.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function skinRelationship(
  skin: Skin,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "skin:*",
      requiredFlare: `skin:${skin.name}`,
      product: skin.product,
      priceSoft: skin.priceSoft,
      priceHard: skin.priceHard,
      affiliateCode,
      itemAffiliateCode: skin.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export type ResolvedCosmetic = {
  type: "pattern" | "skin" | "flag" | "pack" | "subscription";
  cosmetic: Pattern | Skin | Flag | Pack | Subscription | null;
  colorPalette: ColorPalette | null;
  relationship: "owned" | "purchasable" | "blocked";
  /** Unique key for selection/identity, e.g. "pattern:hearts:red" or "skin:mountain" */
  key: string;
};

/**
 * Resolves all cosmetics into a flat display-ready list with relationship
 * status and resolved color palettes. Callers can filter by relationship.
 */
export function resolveCosmetics(
  cosmetics: Cosmetics | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): ResolvedCosmetic[] {
  if (!cosmetics) return [];
  const result: ResolvedCosmetic[] = [];

  // Default pattern (always owned)
  result.push({
    type: "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: "pattern:default",
  });

  // Patterns × color palettes
  for (const [patternKey, pattern] of Object.entries(cosmetics.patterns)) {
    const colorPalettes = [...(pattern.colorPalettes ?? []), null];
    for (const cp of colorPalettes) {
      const rel = patternRelationship(
        pattern,
        cp,
        userMeResponse,
        affiliateCode,
      );
      const resolvedPalette = cp
        ? (cosmetics.colorPalettes?.[cp.name] ?? null)
        : null;
      const key = cp
        ? `pattern:${patternKey}:${cp.name}`
        : `pattern:${patternKey}`;
      result.push({
        type: "pattern",
        cosmetic: pattern,
        colorPalette: resolvedPalette,
        relationship: rel,
        key,
      });
    }
  }

  // Flags
  for (const [flagKey, flag] of Object.entries(cosmetics.flags)) {
    const rel = flagRelationship(flag, userMeResponse, affiliateCode);
    result.push({
      type: "flag",
      cosmetic: flag,
      colorPalette: null,
      relationship: rel,
      key: `flag:${flagKey}`,
    });
  }

  // Skins (image-based territory cosmetics). No separate "default" entry —
  // the pattern default doubles as "no skin": selecting it clears both.
  for (const [skinKey, skin] of Object.entries(cosmetics.skins ?? {})) {
    const rel = skinRelationship(skin, userMeResponse, affiliateCode);
    result.push({
      type: "skin",
      cosmetic: skin,
      colorPalette: null,
      relationship: rel,
      key: `skin:${skinKey}`,
    });
  }

  // Packs
  for (const [packKey, pack] of Object.entries(cosmetics.currencyPacks ?? {})) {
    const rel = pack.product ? "purchasable" : "blocked";
    result.push({
      type: "pack",
      cosmetic: pack,
      colorPalette: null,
      relationship: rel,
      key: `pack:${packKey}`,
    });
  }

  // Subscriptions
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  const currentSubTier =
    userMeResponse === false
      ? null
      : (userMeResponse.player.subscription?.tier ?? null);
  for (const [subKey, sub] of Object.entries(cosmetics.subscriptions ?? {})) {
    const key = `subscription:${subKey}`;
    const isCurrent = subKey === currentSubTier || flares.includes(key);
    const rel: ResolvedCosmetic["relationship"] = isCurrent
      ? "owned"
      : sub.product
        ? "purchasable"
        : "blocked";
    result.push({
      type: "subscription",
      cosmetic: sub,
      colorPalette: null,
      relationship: rel,
      key,
    });
  }

  return result;
}

export function resolvedToPlayerPattern(
  resolved: ResolvedCosmetic,
): PlayerPattern | null {
  if (resolved.type !== "pattern") return null;
  const c = resolved.cosmetic;
  if (c === null) return null;
  return {
    name: c.name,
    patternData: (c as Pattern).pattern,
    colorPalette: resolved.colorPalette ?? undefined,
  };
}

export async function getPlayerCosmeticsRefs(): Promise<PlayerCosmeticRefs> {
  const userSettings = new UserSettings();
  const cosmetics = await fetchCosmetics();
  let pattern: PlayerPattern | null =
    userSettings.getSelectedPatternName(cosmetics);

  if (pattern) {
    const userMe = await getUserMe();
    if (userMe) {
      const flareName =
        pattern.colorPalette?.name === undefined
          ? `pattern:${pattern.name}`
          : `pattern:${pattern.name}:${pattern.colorPalette.name}`;
      const flares = userMe.player.flares ?? [];
      const hasWildcard = flares.includes("pattern:*");
      if (!hasWildcard && !flares.includes(flareName)) {
        pattern = null;
      }
    }
    if (pattern === null) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let flag = userSettings.getFlag();
  if (flag?.startsWith("flag:")) {
    const key = flag.slice("flag:".length);
    const flagData = cosmetics?.flags?.[key];
    if (!flagData) {
      // Only clear if cosmetics loaded successfully but the key is missing
      if (cosmetics) {
        flag = null;
      }
    } else {
      const userMe = await getUserMe();
      if (!userMe) {
        flag = null;
      } else {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("flag:*");
        if (!hasWildcard && !flares.includes(`flag:${flagData.name}`)) {
          flag = null;
        }
      }
    }
  }
  if (flag === null) {
    userSettings.clearFlag();
  }

  let skinName = userSettings.getSelectedSkinName() ?? undefined;
  if (skinName) {
    const skin = cosmetics?.skins?.[skinName];
    if (cosmetics && !skin) {
      // Cosmetics loaded but the saved skin no longer exists.
      skinName = undefined;
    } else if (skin) {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("skin:*");
        if (!hasWildcard && !flares.includes(`skin:${skin.name}`)) {
          skinName = undefined;
        }
      }
    }
    if (skinName === undefined) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  return {
    flag: flag ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
    skinName,
  };
}

export async function getPlayerCosmetics(): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs();
  const cosmetics = await fetchCosmetics();

  const result: PlayerCosmetics = {};

  if (refs.flag) {
    result.flag = await resolveFlagUrl(refs.flag);
  }

  const devPattern = new UserSettings().getDevOnlyPattern();

  if (devPattern) {
    result.pattern = {
      name: devPattern.name,
      patternData: devPattern.patternData,
      colorPalette: devPattern.colorPalette,
    };
  } else if (refs.patternName && cosmetics) {
    const pattern = cosmetics.patterns[refs.patternName];

    if (pattern) {
      result.pattern = {
        name: refs.patternName,
        patternData: pattern.pattern,
        colorPalette: refs.patternColorPaletteName
          ? cosmetics.colorPalettes?.[refs.patternColorPaletteName]
          : undefined,
      };
    }
  }

  if (refs.skinName && cosmetics) {
    const skin = cosmetics.skins?.[refs.skinName];
    if (skin) {
      result.skin = { name: refs.skinName, url: skin.url };
    }
  }

  return result;
}

// terron (баг 18.07 «офлайн не стартует с первого раза / двойной звук старта»):
// getPlayerCosmetics ходит В СЕТЬ (fetchCosmetics + getUserMe) БЕЗ таймаута.
// В офлайне/без API «Начать игру» висла на этом await десятки секунд, игрок жал
// ещё раз → два старта выстреливали одновременно (двойной звук, вторая игра
// убивала первую на полпути). Для ЛОКАЛЬНЫХ стартов — гонка с таймером:
// не успели за timeoutMs — играем без серверной косметики (dev-skin из
// localStorage рендер подтягивает сам).
export async function getPlayerCosmeticsWithTimeout(
  timeoutMs = 1500,
): Promise<PlayerCosmetics> {
  try {
    const timeout = new Promise<PlayerCosmetics>((resolve) =>
      setTimeout(() => resolve({}), timeoutMs),
    );
    return await Promise.race([getPlayerCosmetics(), timeout]);
  } catch {
    return {};
  }
}

/**
 * terron: косметика для ЛОКАЛЬНОГО старта (одиночка/хост-офлайн/обучение) —
 * с резолвом ника в named-скин («чашка»). Раньше локальные старты звали голый
 * getPlayerCosmetics, который customSkin не заполняет, и территория надевалась
 * только протухшим dev-skin от прошлого онлайн-входа (а после смены ника —
 * чужим). Обе сетевые ходки идут ПАРАЛЛЕЛЬНО и обе с таймером.
 */
export async function getLocalStartCosmetics(
  nick: string,
  timeoutMs = 1500,
): Promise<PlayerCosmetics> {
  const [cosmetics, namedSkin] = await Promise.all([
    getPlayerCosmeticsWithTimeout(timeoutMs),
    applyNamedSkinWithTimeout(nick, timeoutMs),
  ]);
  if (namedSkin) cosmetics.customSkin = namedSkinRef(namedSkin);
  return cosmetics;
}

export function translateCosmetic(prefix: string, name: string): string {
  const translation = translateText(`${prefix}.${name}`);
  if (translation.startsWith(prefix)) {
    return name
      .split("_")
      .filter((word) => word.length > 0)
      .map((word) => word[0].toUpperCase() + word.substring(1))
      .join(" ");
  }
  return translation;
}
