import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl } from "../core/AssetUrls";
import { GAME_ID_REGEX } from "../core/Schemas";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";
import { ServerEnv } from "./ServerEnv";

// terron: index.html (app-shell) — без долгого stale-while-revalidate, иначе
// браузер сутки отдаёт устаревший шелл со старым хэшем бандла и деплои не
// подхватываются обычным рефрешем. Ревалидируем всегда (304 дёшев).
const APP_SHELL_CACHE_CONTROL =
  "public, max-age=0, must-revalidate, s-maxage=10";

const appShellContentCache = new Map<string, Promise<string>>();
// финальный шелл с инжектнутым OG-блоком, ключ = `${path}|${lang}`
const appShellFinalCache = new Map<string, string>();

export type OgLang = "ru" | "en";

// Рунет-краулеры → русская выдача/OG. Остальным — EN.
//  • Яндекс (YandexBot/YandexWebmaster/…) — рунет-поисковик, русский SERP;
//  • VK / Mail.ru / Одноклассники — русские превью ссылок в соцсетях;
//  • Rambler/Sputnik — прочие рунет-боты.
// Английский остаётся базой и фолбэком (Googlebot, боты соцсетей и т.д.).
const RU_CRAWLER =
  /yandex|vkshare|vkontakte|mail\.ru|odnoklassniki|rambler|sputnikbot/i;
export function ogLangFromUA(ua: string | undefined): OgLang {
  return ua && RU_CRAWLER.test(ua) ? "ru" : "en";
}

// OG-картинки генерит platform-api (api.terron.io/og/*). Кросс-ориджин og:image
// краулеры едят без проблем; и prod, и dev.terron.io делят один бэкенд.
const OG_API_BASE = "https://api.terron.io";

// SEO title/description главной под язык краулера. Это же ложится и в <title>/
// <meta description>, и в OG/Twitter, и в JSON-LD — единый источник.
export function homeTitle(lang: OgLang): string {
  return lang === "ru"
    ? "TERRON — браузерная стратегия: захвати мир онлайн"
    : "TERRON — Multiplayer World Conquest Strategy Game";
}
export function homeDesc(lang: OgLang): string {
  return lang === "ru"
    ? "Многопользовательская стратегия захвата территорий. Расширяй свою нацию, уничтожай врагов и доминируй на карте. Бесплатно, прямо в браузере."
    : "Conquer the world in this multiplayer battle royale! Expand your nation, eliminate opponents, and dominate the map in this fast-paced IO game.";
}

// profileSlug задан для шеринга /@slug — картинку берём динамическую (досье со
// статой). Заголовок/описание общие: у game-сервера нет доступа к БД со статой,
// но всё нужное уже «запечено» в саму картинку /og/u/:slug.png.
function ogBlock(lang: OgLang, profileSlug?: string): string {
  const ru = lang === "ru";
  const locale = ru ? "ru_RU" : "en_US";
  const altLocale = ru ? "en_US" : "ru_RU";
  const url = profileSlug
    ? `https://terron.io/@${profileSlug}`
    : "https://terron.io/";
  const type = profileSlug ? "profile" : "game";
  const title = profileSlug
    ? ru
      ? `@${profileSlug} — досье игрока · terron.io`
      : `@${profileSlug} — player dossier · terron.io`
    : homeTitle(lang);
  const desc = profileSlug
    ? ru
      ? "Многопользовательская стратегия захвата территорий. Расширяй свою нацию, уничтожай врагов и доминируй на карте. Бесплатно, прямо в браузере."
      : "Conquer the world in this multiplayer battle royale! Expand your nation, eliminate opponents, and dominate the map in this fast-paced IO game."
    : homeDesc(lang);
  const img = profileSlug
    ? `${OG_API_BASE}/og/u/${encodeURIComponent(profileSlug)}.png?lang=${lang}`
    : `${OG_API_BASE}/og/cover.png?lang=${lang}`;
  return [
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="terron.io" />`,
    `<meta property="og:locale" content="${locale}" />`,
    `<meta property="og:locale:alternate" content="${altLocale}" />`,
    `<meta property="og:title" content="${htmlEsc(title)}" />`,
    `<meta property="og:description" content="${htmlEsc(desc)}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${htmlEsc(title)}" />`,
    `<meta name="twitter:description" content="${htmlEsc(desc)}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ].join("\n    ");
}

// JSON-LD (schema.org) главной: Organization + WebSite + VideoGame. Даёт
// поисковикам структурированные данные для «богатой» выдачи (карточка игры,
// логотип, привязка бренда). Инжектится только на главной под язык краулера.
function homeJsonLd(lang: OgLang): string {
  const ru = lang === "ru";
  const inLanguage = ru ? "ru" : "en";
  const img = `${OG_API_BASE}/og/cover.png?lang=${lang}`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://terron.io/#org",
        name: "terron.io",
        url: "https://terron.io/",
        logo: img,
      },
      {
        "@type": "WebSite",
        "@id": "https://terron.io/#website",
        url: "https://terron.io/",
        name: "TERRON",
        alternateName: "terron.io",
        inLanguage,
        publisher: { "@id": "https://terron.io/#org" },
      },
      {
        "@type": "VideoGame",
        "@id": "https://terron.io/#game",
        name: "TERRON",
        url: "https://terron.io/",
        description: homeDesc(lang),
        image: img,
        inLanguage,
        genre: ru
          ? ["Стратегия", "IO", "Battle Royale"]
          : ["Strategy", "IO", "Battle Royale"],
        gamePlatform: "Web browser",
        applicationCategory: "Game",
        operatingSystem: "Any (web browser)",
        playMode: "MultiPlayer",
        publisher: { "@id": "https://terron.io/#org" },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
      },
    ],
  };
  // Экранируем `<` в JSON, чтобы значение не могло закрыть <script>.
  const json = JSON.stringify(graph).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// hreflang: страница у нас одна (SPA, язык выбирается клиентом; сервер лишь
// подбирает мета под краулера) — отдельных URL на язык НЕТ. Поэтому корректно
// объявляем только x-default → корень, а язык сигналим через <html lang> +
// og:locale + заголовок Content-Language. Фейковых ru/en-альтернатив на один и
// тот же URL не плодим (это невалидный hreflang).
const HOME_HREFLANG =
  '<link rel="alternate" hreflang="x-default" href="https://terron.io/" />';

// Индексируемый текст в <noscript> для краулеров со слабым JS (Яндекс): у SPA
// «живой» контент рисует JS, а сырой шелл почти пуст → тонкая страница. Даём
// реальный заголовок + описание игры под язык краулера.
function homeSeoBody(lang: OgLang): string {
  const ru = lang === "ru";
  const h1 = ru
    ? "TERRON — браузерная онлайн-стратегия захвата мира"
    : "TERRON — browser multiplayer world conquest strategy";
  const p = ru
    ? "TERRON — бесплатная многопользовательская стратегия в браузере. Захватывай территории, расширяй свою нацию, заключай и разрывай союзы, применяй ультимейты и уничтожай соперников на карте мира. Играй прямо сейчас, без установки, на ПК и телефоне."
    : "TERRON is a free multiplayer browser strategy game. Capture territory, expand your nation, forge and break alliances, unleash ultimates and eliminate rivals across the world map. Play instantly, no install, on desktop and mobile.";
  return `<noscript><h1>${h1}</h1><p>${p}</p></noscript>`;
}

// ── terron: SEO/OG для вики ультов (/wiki/ult[/<slug>]) ─────────────────────
// Серверный per-page title/description/canonical + OG/Twitter (краулеры не
// исполняют JS → берут из сырого HTML; клиентский WikiPage дублирует
// document.title для браузерной вкладки/JS-краулеров). Картинка — брендовая
// cover.png (per-ult картинки = отдельная задача, требует правки ОБЩЕГО
// platform-api). Тексты — коротко, под сниппет; синхронны с client/WikiPage.ts.
type LangText = { ru: string; en: string };
export interface WikiSeo {
  slug: string; // канонический сегмент (пусто = индекс /wiki/ult)
  title: LangText;
  desc: LangText;
}

const WIKI_INDEX: WikiSeo = {
  slug: "",
  title: {
    ru: "Ультимейты TERRON — полный гайд",
    en: "TERRON Ultimates — full guide",
  },
  desc: {
    ru: "Все ультимейты TERRON: министерство правды, укрепления, религия, небо наше и другие — что делают, точные параметры и что открывают.",
    en: "All TERRON ultimates: Ministry of Truth, Fortifications, Religion, Our Sky and more — what they do, exact stats and what they unlock.",
  },
};

// slug → SEO. slug в записи = КАНОНИЧЕСКИЙ URL (mirv/split ведут на здание).
const WIKI_SEO: Record<string, WikiSeo> = {
  nuclear_factory: {
    slug: "nuclear_factory",
    title: {
      ru: "Ядерный завод — ультимейт TERRON",
      en: "Nuclear Factory — TERRON ultimate",
    },
    desc: {
      ru: "Ядерный завод разблокирует пуск МИРВ — разделяющейся боеголовки на 350 зарядов. Цена, механика и контрплей.",
      en: "The Nuclear Factory unlocks MIRV — a 350-warhead nuke. Cost, mechanics and counterplay.",
    },
  },
  ministry_of_truth: {
    slug: "ministry_of_truth",
    title: {
      ru: "Министерство правды — ультимейт TERRON",
      en: "Ministry of Truth — TERRON ultimate",
    },
    desc: {
      ru: "Аура радиусом 300 тайлов высасывает войска врагов вокруг и половину отдаёт тебе. Можно построить два министерства.",
      en: "A 300-tile aura drains enemy troops around it and gives you half. You can build up to two.",
    },
  },
  fortifications: {
    slug: "fortifications",
    title: {
      ru: "Укрепления — ультимейт TERRON",
      en: "Fortifications — TERRON ultimate",
    },
    desc: {
      ru: "Бункеры сами захватывают землю в радиусе защиты. Апгрейд до 3 уровней, радиус штаба до 90 тайлов.",
      en: "Bunkers auto-capture land within their defense radius. Upgrades to level 3, HQ radius up to 90 tiles.",
    },
  },
  central_bank: {
    slug: "central_bank",
    title: {
      ru: "Центробанк — ультимейт TERRON",
      en: "Central Bank — TERRON ultimate",
    },
    desc: {
      ru: "Твои корабли нельзя перехватить, а самолёты не платят комиссию за пролёт над чужой территорией.",
      en: "Your boats can't be intercepted and your planes pay no overflight toll.",
    },
  },
  air_command: {
    slug: "air_command",
    title: {
      ru: "Авиаштаб — ультимейт TERRON",
      en: "Air Command — TERRON ultimate",
    },
    desc: {
      ru: "Воздушный десант бесплатный, высаживается на 100% состава и держит плацдарм 60 секунд.",
      en: "Airborne assault is free, lands at 100% strength and holds the beachhead for 60 seconds.",
    },
  },
  tank_factory: {
    slug: "tank_factory",
    title: {
      ru: "Танковый завод — ультимейт TERRON",
      en: "Tank Factory — TERRON ultimate",
    },
    desc: {
      ru: "Твои атаки игнорируют защиту вражеских бункеров и теряют на 15% меньше войск.",
      en: "Your attacks ignore enemy bunker defense and lose 15% fewer troops.",
    },
  },
  religion: {
    slug: "religion",
    title: {
      ru: "Религия — ультимейт TERRON",
      en: "Religion — TERRON ultimate",
    },
    desc: {
      ru: "Храм заставляет всю твою территорию медленно расползаться наружу, поглощая любую соседнюю сушу.",
      en: "The temple makes your whole territory slowly creep outward, swallowing any adjacent land.",
    },
  },
  mining: {
    slug: "mining",
    title: {
      ru: "Минирование — ультимейт TERRON",
      en: "Mining — TERRON ultimate",
    },
    desc: {
      ru: "Половина вражеского морского десанта гибнет на минах при высадке на твой берег.",
      en: "Half of any enemy sea landing dies on the mines hitting your shore.",
    },
  },
  media: {
    slug: "media",
    title: { ru: "МЕДИА — ультимейт TERRON", en: "Media — TERRON ultimate" },
    desc: {
      ru: "Предательство союзов не карается меткой, и разблокируется каст «Раскол» — таргетная пропаганда.",
      en: "Betrayal goes unpunished and it unlocks casting Split — a targeted propaganda strike.",
    },
  },
  revanchism: {
    slug: "revanchism",
    title: {
      ru: "Реваншизм — ультимейт TERRON",
      en: "Revanchism — TERRON ultimate",
    },
    desc: {
      ru: "Теряя землю от исторического пика, ты получаешь до +200% к защите всей территории.",
      en: "As you lose land from your peak, you gain up to +200% defense across all your territory.",
    },
  },
  our_sky: {
    slug: "our_sky",
    title: {
      ru: "Небо наше — ультимейт TERRON",
      en: "Our Sky — TERRON ultimate",
    },
    desc: {
      ru: "Антиспутник: после 60-секундного телеграфа на минуту накрывает всех, кроме тебя, туманом войны.",
      en: "Anti-satellite: after a 60-second telegraph it blankets everyone but you in fog of war for a minute.",
    },
  },
  // Активные способности → канон на страницу их здания.
  mirv: {
    slug: "nuclear_factory",
    title: { ru: "МИРВ — ультимейт TERRON", en: "MIRV — TERRON ultimate" },
    desc: {
      ru: "Разделяющаяся ядерная боеголовка на 350 зарядов. Разблокируется зданием «Ядерный завод».",
      en: "A 350-warhead nuke. Unlocked by the Nuclear Factory building.",
    },
  },
  split: {
    slug: "media",
    title: { ru: "Раскол — ультимейт TERRON", en: "Split — TERRON ultimate" },
    desc: {
      ru: "Таргетная пропаганда откалывает кусок чужой страны боту-сепаратисту. Разблокируется зданием «МЕДИА».",
      en: "Targeted propaganda splits a chunk of an enemy country off to a separatist bot. Unlocked by Media.",
    },
  },
};

// ⚠️ terron 25.08: СТРАНИЦЫ ВИКИ БЕЗ КУРИРОВАННОГО SEO — ТОЖЕ НАСТОЯЩИЕ.
//
// `WIKI_SEO` выше — это карточки с РУЧНЫМ title/description под краулера, их
// тринадцать. А статей в вики (`client/WikiContent.ts`) тридцать шесть, и
// дерево ульт рисует ссылку на каждую (`UltTree.ts`: href="/wiki/ult/<key>").
// Пока список известных роутов строился из ключей `WIKI_SEO`, остальные 25
// страниц отдавались с 404 — живые страницы, на которые ведут наши же ссылки
// (проверено на проде: /wiki/ult/port, /city, /piracy, /sam_launcher… — 404).
//
// Поэтому список слагов ОТДЕЛЬНЫЙ и полный, а `WIKI_SEO` остаётся тем, чем и
// был: набором курированных описаний. У страницы без своего описания OG
// берётся от индекса вики (см. wikiSeoFromPath) — это лучше, чем 404.
//
// ⚠️ ДЕРЖАТЬ В СИНХРОНЕ с `client/WikiContent.ts`. Инвариант закрыт тестом
// `tests/server/SpaRoutesCoverage.test.ts` («каждая статья вики открывается по
// прямой ссылке») — он читает слаги прямо из контента, так что забытая статья
// валит гейт, а не тихо отдаёт 404.
const WIKI_ULT_PAGES = [
  "air_command",
  "airport",
  "central_bank",
  "city",
  "closed_country",
  "defense_post",
  "factory",
  "fanaticism",
  "fortifications",
  "fuel",
  "greens",
  "media",
  "mining",
  "ministry_of_truth",
  "missile_silo",
  "nuclear_factory",
  "nuclear_plant",
  "oil_rig",
  "olympics",
  "our_sky",
  "peace_palace",
  "peaceful_sky",
  "piracy",
  "port",
  "pride",
  "rail_gun",
  "religion",
  "revanchism",
  "rivers_back",
  "sam_launcher",
  "spaceport",
  "submarine_base",
  "tank_factory",
  "train_depot",
  "victory_banner",
  "walking_city",
];

// Слаги, по которым /wiki/ult/<slug> — настоящая страница: статьи вики плюс
// алиасы «скилл → здание» из WikiPage.SKILL_TO_BUILDING (mirv, split).
const WIKI_ULT_SLUGS = new Set([...WIKI_ULT_PAGES, ...Object.keys(WIKI_SEO)]);

// /wiki и разделы (/wiki/ult, /wiki/buildings, /wiki/speedrun) → индекс;
// /wiki/ult/<slug> → запись (или индекс, если slug чужой). Разделы добавлены
// 22.07 вместе с хабом — без них краулер получал бы страницу вообще без OG.
export function wikiSeoFromPath(p: string): WikiSeo | undefined {
  const m =
    /^\/wiki(?:\/(ult|buildings|speedrun)(?:\/([A-Za-z0-9_-]{1,40}))?)?\/?$/.exec(
      p,
    );
  if (!m) return undefined;
  const slug = m[1] === "ult" ? m[2] : undefined;
  if (!slug) return WIKI_INDEX;
  return WIKI_SEO[slug] ?? WIKI_INDEX;
}

// Настоящий sitemap.xml. БЕЗ него SPA-fallback отдаёт на /sitemap.xml обычный
// HTML-шелл (200) — краулер получает мусор вместо карты сайта. Перечисляем
// стабильные контентные URL: главная, вики (индекс + разделы + канонические
// ульты), новости, рейтинг. lastmod намеренно опускаем (не врём датами).
export function buildSitemapXml(): string {
  const urls: { loc: string; priority: string; changefreq: string }[] = [
    { loc: "https://terron.io/", priority: "1.0", changefreq: "daily" },
    {
      loc: "https://terron.io/wiki/ult",
      priority: "0.7",
      changefreq: "weekly",
    },
    {
      loc: "https://terron.io/wiki/buildings",
      priority: "0.6",
      changefreq: "weekly",
    },
    {
      loc: "https://terron.io/wiki/speedrun",
      priority: "0.6",
      changefreq: "weekly",
    },
    { loc: "https://terron.io/news", priority: "0.6", changefreq: "weekly" },
    { loc: "https://terron.io/rating", priority: "0.5", changefreq: "daily" },
  ];
  // Канонические URL ультов (WIKI_SEO содержит алиасы mirv→nuclear_factory,
  // split→media — дедуплицируем по .slug).
  const seenSlugs = new Set<string>();
  for (const seo of Object.values(WIKI_SEO)) {
    if (!seo.slug || seenSlugs.has(seo.slug)) continue;
    seenSlugs.add(seo.slug);
    urls.push({
      loc: wikiUrl(seo.slug),
      priority: "0.5",
      changefreq: "monthly",
    });
  }
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function htmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wikiUrl(slug: string): string {
  return slug
    ? `https://terron.io/wiki/ult/${slug}`
    : "https://terron.io/wiki/ult";
}

// OG/Twitter-блок вики (type=article, картинка — брендовая cover).
function wikiOgBlock(lang: OgLang, seo: WikiSeo): string {
  const ru = lang === "ru";
  const title = htmlEsc(ru ? seo.title.ru : seo.title.en);
  const desc = htmlEsc(ru ? seo.desc.ru : seo.desc.en);
  const url = wikiUrl(seo.slug);
  const img = `${OG_API_BASE}/og/cover.png?lang=${lang}`;
  return [
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="terron.io" />`,
    `<meta property="og:locale" content="${ru ? "ru_RU" : "en_US"}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ].join("\n    ");
}

// Статические SEO-теги из index.html, которые для вики заменяем per-page.
const STATIC_TITLE = "<title>terron.io</title>";
const STATIC_CANONICAL = '<link rel="canonical" href="https://terron.io/" />';
const STATIC_DESC_CONTENT =
  'content="Conquer the world in this multiplayer battle royale! Expand your nation, eliminate opponents, and dominate the map in this fast-paced IO game."';
// index.html объявлен `<html lang="en">`; для рунет-краулера меняем на ru.
const STATIC_HTML_LANG = '<html lang="en"';
function swapHtmlLang(html: string, lang: OgLang): string {
  return lang === "ru"
    ? html.replace(STATIC_HTML_LANG, '<html lang="ru"')
    : html;
}

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetManifest = await getRuntimeAssetManifest();
  const cdnBase = ServerEnv.cdnBase();
  return ejs.render(htmlContent, {
    gitCommit: JSON.stringify(ServerEnv.gitCommit()),
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    // Raw (unquoted) value for use as a URL prefix in the index.html template,
    // e.g. <script src="<%- cdnBaseRaw %>/assets/index-XXX.js">. The Vite
    // build plugin inject-cdn-base-template rewrites Vite's emitted /assets/
    // refs to use this placeholder.
    cdnBaseRaw: cdnBase,
    gameEnv: JSON.stringify(ServerEnv.gameEnvName()),
    numWorkers: JSON.stringify(ServerEnv.numWorkers()),
    turnstileSiteKey: JSON.stringify(ServerEnv.turnstileSiteKey()),
    jwtAudience: JSON.stringify(ServerEnv.jwtAudience()),
    instanceId: JSON.stringify(ServerEnv.instanceId()),
    manifestHref: buildAssetUrl("manifest.json", assetManifest, cdnBase),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetManifest, cdnBase),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
      cdnBase,
    ),
    backgroundImageUrl: buildAssetUrl(
      "images/background.webp",
      assetManifest,
      cdnBase,
    ),
    desktopLogoImageUrl: buildAssetUrl(
      "images/TerronLogo.png",
      assetManifest,
      cdnBase,
    ),
    mobileLogoImageUrl: buildAssetUrl(
      "images/TerronLogo.png",
      assetManifest,
      cdnBase,
    ),
  });
}

export async function getAppShellContent(htmlPath: string): Promise<string> {
  let cachedContent = appShellContentCache.get(htmlPath);
  if (!cachedContent) {
    cachedContent = renderHtmlContent(htmlPath).catch((error: unknown) => {
      appShellContentCache.delete(htmlPath);
      throw error;
    });
    appShellContentCache.set(htmlPath, cachedContent);
  }
  return cachedContent;
}

// Финальный шелл: берём (кешированный) базовый рендер и инжектим OG-блок под язык.
// Профильные варианты (/@slug) НЕ кешируем — их много и они редкие (только краулеры),
// дешевле пересобрать строку, чем плодить записи в кеше на каждый шаренный профиль.
async function getAppShellFinal(
  htmlPath: string,
  lang: OgLang,
  profileSlug?: string,
  wikiSeo?: WikiSeo,
): Promise<string> {
  const base = await getAppShellContent(htmlPath);
  // Вики: per-page title/canonical/description + OG-блок (не кешируем — редкие,
  // только краулеры/шеринг). Приоритетнее профиля (пути не пересекаются).
  if (wikiSeo) {
    const title = htmlEsc(lang === "ru" ? wikiSeo.title.ru : wikiSeo.title.en);
    const desc = htmlEsc(lang === "ru" ? wikiSeo.desc.ru : wikiSeo.desc.en);
    return swapHtmlLang(base, lang)
      .replace(STATIC_TITLE, `<title>${title}</title>`)
      .replace(
        STATIC_CANONICAL,
        `<link rel="canonical" href="${wikiUrl(wikiSeo.slug)}" />`,
      )
      .replace(STATIC_DESC_CONTENT, `content="${desc}"`)
      .replace("<!--TERRON_OG-->", wikiOgBlock(lang, wikiSeo));
  }
  if (profileSlug) {
    return swapHtmlLang(base, lang).replace(
      "<!--TERRON_OG-->",
      ogBlock(lang, profileSlug),
    );
  }
  const key = `${htmlPath}|${lang}`;
  const cached = appShellFinalCache.get(key);
  if (cached) return cached;
  // Главная: локализованные <title>/description/<html lang> + OG + JSON-LD +
  // hreflang + индексируемый <noscript>. Всё под язык краулера.
  const finalHtml = swapHtmlLang(base, lang)
    .replace(STATIC_TITLE, `<title>${htmlEsc(homeTitle(lang))}</title>`)
    .replace(STATIC_DESC_CONTENT, `content="${htmlEsc(homeDesc(lang))}"`)
    .replace("<!--TERRON_OG-->", ogBlock(lang))
    .replace(
      "<!--TERRON_HEAD_EXTRA-->",
      homeJsonLd(lang) + "\n    " + HOME_HREFLANG,
    )
    .replace("<!--TERRON_SEO_BODY-->", homeSeoBody(lang));
  appShellFinalCache.set(key, finalHtml);
  return finalHtml;
}

export function clearAppShellContentCache(): void {
  appShellContentCache.clear();
  appShellFinalCache.clear();
}

export function setAppShellCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", APP_SHELL_CACHE_CONTROL);
  res.setHeader("Content-Type", "text/html");
  // Dynamic serving: мета/язык шелла зависят от User-Agent краулера — кэши
  // (CDN/Caddy s-maxage) обязаны учитывать UA, иначе отдадут ru-шелл Гуглу и
  // наоборот. Google этого же и требует для UA-based content negotiation.
  res.setHeader("Vary", "User-Agent");
}

export function setHtmlNoCacheHeaders(res: Response): void {
  setNoStoreHeaders(res);
  res.setHeader("ETag", "");
  res.setHeader("Content-Type", "text/html");
}

// Из пути вытаскиваем slug профиля для шеринга /@slug (иначе undefined).
export function profileSlugFromPath(p: string): string | undefined {
  const m = /^\/@([A-Za-z0-9_-]{1,40})\/?$/.exec(p);
  return m ? m[1] : undefined;
}

// Известные SPA-роуты. Всё, что НЕ матчится, отдаётся с 404 (см. Master.ts
// SPA-fallback), иначе любой мусорный путь возвращал бы 200 + шелл — soft-404,
// вредит SEO (дубли/ложные страницы, размывание индекса).
// ⚠️ ДЕРЖАТЬ В СИНХРОНЕ с клиентом: client/ModalRouter.ts (SEGMENT_OVERRIDES +
// SEGMENT_ALIASES + parsePath), client/Main.ts handleUrl (game/tutorial/
// singleplayer/streamer-mode) и STATIC_PAGES/спец-роутами в Master.ts.
// Список НАМЕРЕННО щедрый: лишний сегмент = 200 (безвредно), а вот зарубить
// живую страницу 404 — регресс. Новый роут в клиенте → добавь сегмент сюда.
const SPA_SEGMENTS = new Set<string>([
  // ModalRouter-регистр + overrides(leaderboard→rating) + алиасы
  "prime",
  "history",
  "store",
  "settings",
  "rating",
  "leaderboard",
  "ffa-rating",
  "leaders",
  "clan",
  "new", // /new = создание клана
  "friends",
  "account",
  "skins",
  "shop",
  "currency",
  "guide",
  "wiki",
  "stats",
  "propaganda",
  "copyrights",
  "glory",
  // terron 23.08: внутренние песочницы. Клиентский маршрут у них был, а в
  // списке известных — нет, поэтому сервер отдавал 404 (шелл рендерился, но
  // статус пугал: «ссылка нерабочая», репорт владельца).
  // ⚠️ terron 25.08: ПОСТОЯННЫЕ ССЫЛКИ СОБЫТИЙНЫХ ЛОББИ. Их копирует кнопка
  // «Позвать друзей», ими зовут народ в чат и телеграм — а сервер отдавал по
  // ним 404 (шелл рисовался, человек в лобби попадал, но краулер по 404
  // карточку-превью не строит, и ссылка выглядит битой).
  // Почему проскочило мимо сторожа SpaRoutesCoverage: тот сверяет список с
  // `modalRouter.register(...)`, а лобби-модалки НАМЕРЕННО не регистрируются —
  // они правят адрес сами (см. шапку ModalRouter). Поэтому ниже отдельный тест
  // именно на эти два адреса.
  "gold", // текущее золотое лобби
  "diamond", // текущее алмазное лобби
  "test", // полигон: бесконечные ресурсы, слабые боты, все ульты открыты
  "tutorial", // обучающая песочница
  "singleplayer",
  "слава",
  "slava",
  "fame",
  "hall-of-fame",
  // terron 28.08: сегменты админки/модерации убраны — страницы вынесены в
  // отдельное внутреннее приложение. Были: admin, admin-ios, moder-skin,
  // moder-achievements (плюс вложенные /admin/* ловились по parts[0]="admin").
  // Теперь эти адреса на игровом сайте честно отдают 404 — их там больше нет.
  "news",
  "language",
  "troubleshooting",
  "territory-patterns",
  "flag-input",
  "help",
  // Спец-потоки/страницы (Main.handleUrl / HostLobbyModal)
  "tutorial",
  "singleplayer",
  "streamer-mode",
  "game", // /game/<id> — валидность id проверяем ниже
  "invite", // /invite/<code>
  // ⚠️ terron 25.08 (находка соседней вкладки «/ults 404 по прямой ссылке»):
  // список РАЗЪЕХАЛСЯ с ModalRouter.register в Main.ts — девять живых страниц
  // отдавали 404 прямым заходом (шелл рисовался, но статус пугал и ссылку
  // нельзя было отправить). Инвариант держит тест SpaRoutesCoverage.test.ts:
  // каждый register("x") обязан быть здесь.
  "ults", // карта/дерево ульт
  "money", // кошелёк
  "ranked", // ranked 1×1 (кнопка ведёт на страницу-заглушку)
  "clan-create",
  "clan-edit",
  "profile", // /profile (публичный профиль — ещё и /@slug)
  "admin-balance",
  "admin-news",
  "admin-petri-bonus",
  "admin-ru-ban",
]);

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// true — путь ведёт на реальную страницу SPA (или спец-роут); false → 404.
export function isKnownSpaRoute(pathname: string): boolean {
  // Опциональный воркер-префикс /w<N>/ (nginx в прод-контейнере игры) — снимаем.
  const p = pathname.replace(/^\/w\d+(?=\/)/, "");
  if (p === "" || p === "/") return true;
  // Профиль /@slug.
  if (profileSlugFromPath(p)) return true;
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return true;
  // Ни один сегмент не должен быть обходом каталога — такой путь не роут.
  if (parts.some((s) => s === ".." || s === ".")) return false;
  const seg = decodeSeg(parts[0]);
  // Вики: /wiki, /wiki/{ult,buildings,speedrun}, /wiki/ult/<slug>. Неизвестный
  // слаг ульты → 404 (иначе /wiki/ult/чтоугодно = 200 = бесконечные soft-дубли).
  if (seg === "wiki") {
    if (!parts[1]) return true; // /wiki
    if (
      parts[1] !== "ult" &&
      parts[1] !== "buildings" &&
      parts[1] !== "speedrun"
    )
      return false;
    if (parts[1] !== "ult" || !parts[2]) return true; // /wiki/ult|buildings|speedrun
    return WIKI_ULT_SLUGS.has(parts[2]); // /wiki/ult/<slug> — только известный
  }
  // /game/<id> — только валидный 8-символьный id (мусорный id → 404).
  if (seg === "game") return parts.length >= 2 && GAME_ID_REGEX.test(parts[1]);
  // /invite/<code> — код обязателен.
  if (seg === "invite") return parts.length >= 2 && parts[1].length > 0;
  return SPA_SEGMENTS.has(seg) || SPA_SEGMENTS.has(parts[0]);
}

export async function renderAppShell(
  res: Response,
  htmlPath: string,
  lang: OgLang = "en",
  profileSlug?: string,
  wikiSeo?: WikiSeo,
): Promise<void> {
  const rendered = await getAppShellFinal(htmlPath, lang, profileSlug, wikiSeo);
  setAppShellCacheHeaders(res);
  res.setHeader("Content-Language", lang === "ru" ? "ru" : "en");
  res.send(rendered);
}
