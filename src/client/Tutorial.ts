// terron: запуск обучающей песочницы (см. ОБУЧЕНИЕ.md в корне репо terron.io).
// Офлайн-сингл на карте «TERRON» со слабыми ботами (Easy). Это ЕДИНАЯ точка входа
// для всех кнопок «Сыграть обучение» (death-модалка, хедер, помощь) и будущий
// хук для пошагового TutorialController (гибрид-пауза).

import { html, TemplateResult } from "lit";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { generateID } from "../core/Util";
import { L } from "./Utils";
import { getLocalStartCosmetics } from "./Cosmetics";
import type { JoinLobbyEvent } from "./Main";
import type { UsernameInput } from "./UsernameInput";

// terron 01.08: КОГДА ПРЯЧЕМ ПРЕДЛОЖЕНИЕ ОБУЧЕНИЯ (решение владельца).
// Два условия, любого достаточно:
//   1. обучение пройдено (дошёл до «Поздравляем!»);
//   2. выиграл ЛЮБОЙ настоящий матч — онлайн, офлайн, одиночка, без разницы.
// Оба факта пишем И локально, И в аккаунт: локально — чтобы работало у анонима
// и офлайн, в аккаунт — чтобы не всплывало заново на другом устройстве.
// Функция СИНХРОННАЯ (её зовут из render), поэтому аккаунтные факты держим
// зеркалом в localStorage: их подтягивает syncTutorialFlagsFromAccount().
const TUT_DONE_KEY = "terron_tutorial_done";
const REAL_WIN_KEY = "terron_real_win";

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string): boolean {
  try {
    if (localStorage.getItem(key) === "1") return false;
    localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function shouldShowTutorialEntry(): boolean {
  return !flag(TUT_DONE_KEY) && !flag(REAL_WIN_KEY);
}

/** Обучение пройдено. Локально сразу, в аккаунт — если игрок вошёл. */
export function markTutorialDone(): void {
  const isNew = setFlag(TUT_DONE_KEY);
  if (!isNew) return;
  void import("./Api").then(({ reportTutorialDone }) =>
    reportTutorialDone().catch(() => {
      /* аноним/офлайн — хватит локального флага */
    }),
  );
}

/** Победа в НАСТОЯЩЕМ матче (не в обучении). Только локально: онлайн-победы
 *  сервер и так знает (profile.stats.wins), а офлайн ему не видны. */
export function markRealWin(): void {
  if (isTutorialActive()) return;
  setFlag(REAL_WIN_KEY);
}

/** Подтянуть факты из аккаунта в локальное зеркало (зовётся при загрузке
 *  профиля). Победы берём из статистики — отдельного поля не надо. */
export function syncTutorialFlagsFromAccount(acc: {
  tutorialDone?: boolean;
  wins?: number;
}): void {
  if (acc.tutorialDone) setFlag(TUT_DONE_KEY);
  if ((acc.wins ?? 0) > 0) setFlag(REAL_WIN_KEY);
}

// Флаг «текущая игра — обучающая». Ставится при запуске через launchTutorial,
// читается слоем обучающих карточек (TutorialCards). Обычные игры его не трогают
// → слой карточек для них инертен (ничего не рисует, HUD не прячет).
let _tutorialActive = false;
export function isTutorialActive(): boolean {
  return _tutorialActive;
}
export function setTutorialActive(v: boolean): void {
  _tutorialActive = v;
}

// Единый вид кнопки обучения (большая, зелёная). Возвращает Lit-шаблон со
// встроенным <style> — работает и в shadow DOM, и в light DOM компонентов.
export function tutorialButton(onClick: () => void): TemplateResult {
  return html`
    <style>
      .terron-tut-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.9rem 1.25rem;
        font-size: 1.05rem;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: #ffffff;
        background: #16a34a;
        border: none;
        border-radius: 0.7rem;
        box-shadow: 0 3px 0 #0f7a37;
        cursor: pointer;
        transition:
          background 0.15s ease,
          transform 0.05s ease,
          box-shadow 0.1s ease;
      }
      .terron-tut-cta:hover {
        background: #22c55e;
      }
      .terron-tut-cta:active {
        transform: translateY(2px);
        box-shadow: 0 1px 0 #0f7a37;
      }
      .terron-tut-cta__badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1rem 0.45rem;
        border-radius: 0.4rem;
        background: rgba(0, 0, 0, 0.22);
        font-size: 0.9rem;
        font-weight: 700;
      }
    </style>
    <button class="terron-tut-cta" @click=${onClick}>
      <span>${L("Сыграть обучение", "Play the tutorial")}</span>
      <span class="terron-tut-cta__badge"
        >5
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 7v5l3 2"></path>
        </svg>
      </span>
    </button>
  `;
}

// параметры песочницы в одном месте — правь тут
export const TUTORIAL_CONFIG = {
  gameMap: GameMapType.TerronTutor2,
  difficulty: Difficulty.Easy, // слабые боты = обычные племена
  bots: 30,
} as const;

function usernameEl(): UsernameInput | null {
  return document.querySelector("username-input") as UsernameInput | null;
}

function tutorialUsername(): string {
  const u = usernameEl()?.getUsername?.();
  if (u && u.trim()) return u;
  try {
    const stored = localStorage.getItem("username");
    if (stored && stored.trim()) return stored;
  } catch {}
  return "Игрок";
}

// Собирает и диспатчит join-lobby с конфигом песочницы. target — элемент, от
// которого всплывёт событие (по умолчанию body → долетит до Main).
export async function launchTutorial(
  target: EventTarget = document.body,
): Promise<void> {
  setTutorialActive(true); // текущая игра — обучающая (читает слой TutorialCards)

  const clientID = generateID();
  const gameID = generateID();
  const el = usernameEl();

  const detail: JoinLobbyEvent = {
    gameID,
    gameStartInfo: {
      gameID,
      players: [
        {
          clientID,
          username: tutorialUsername(),
          clanTag: el?.getClanTag?.() ?? null,
          cosmetics: await getLocalStartCosmetics(tutorialUsername()),
        },
      ],
      config: {
        gameMap: TUTORIAL_CONFIG.gameMap,
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        difficulty: TUTORIAL_CONFIG.difficulty,
        bots: TUTORIAL_CONFIG.bots,
        nations: "default",
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        // terron: infiniteGold НЕ включаем — иначе цена=0 и полосы прогресса золота
        // (город/фабрика/порт) не показываются. Натурального золота в обучении и так с
        // избытком (100к+), всё строится сразу, но прогресс-бар виден.
        randomSpawn: false,
        donateGold: false,
        donateTroops: false,
        disabledUnits: [],
        maxTimerValue: undefined,
      },
      lobbyCreatedAt: Date.now(),
    },
    source: "tutorial",
  };

  target.dispatchEvent(
    new CustomEvent("join-lobby", {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

// terron: «в живой матч» из финала обучения — обычный офлайн-сингл на карте World
// с ботами, БЕЗ обучающего слоя (setTutorialActive НЕ ставим). Игрок доигрывает
// нормальную партию.
export async function launchLiveMatch(
  target: EventTarget = document.body,
): Promise<void> {
  setTutorialActive(false);
  const clientID = generateID();
  const gameID = generateID();
  const el = usernameEl();
  const detail: JoinLobbyEvent = {
    gameID,
    gameStartInfo: {
      gameID,
      players: [
        {
          clientID,
          username: tutorialUsername(),
          clanTag: el?.getClanTag?.() ?? null,
          cosmetics: await getLocalStartCosmetics(tutorialUsername()),
        },
      ],
      config: {
        gameMap: GameMapType.World,
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        difficulty: Difficulty.Medium,
        bots: 400,
        nations: "default",
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        donateGold: false,
        donateTroops: false,
        disabledUnits: [],
        maxTimerValue: undefined,
      },
      lobbyCreatedAt: Date.now(),
    },
    source: "singleplayer",
  };
  target.dispatchEvent(
    new CustomEvent("join-lobby", { detail, bubbles: true, composed: true }),
  );
}
