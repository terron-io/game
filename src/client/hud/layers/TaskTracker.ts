import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { getMyProfile } from "../../Api";
import { isLoggedIn } from "../../Auth";
import { Controller } from "../../Controller";
import { L } from "../../Utils";

// terron: трекер задач после обучения. MVP-цепочка (выводится справа-сверху):
//   survive5 — выжить 5 минут (трекается живьём в матче).
//   eat10    — сожрать 10 наций/игроков (кумулятивно по аккаунту, из профиля).
// Аноним → «войди для заданий». По клику карточка скрывается.
type Task = "loading" | "anon" | "survive5" | "eat10" | "done" | "hidden";

const SURVIVE_TARGET = 300; // секунд
// terron: «выжил 5 минут» в localStorage — работает и для анонов, гасит подсказки
// навсегда (и при будущей авторизации можно засчитать ачивку survive_5).
const SURVIVED5_KEY = "terron-survived5";
const EAT_TARGET = 10;

@customElement("task-tracker")
export class TaskTracker extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;

  @state() private task: Task = "loading";
  @state() private aliveSec = 0;
  @state() private eatenBase = 0;
  @state() private eatenLive = 0; // съедено врагов В ЭТОМ матче (живой счёт)
  @state() private dismissed = false;
  @state() private active = false; // показываем только ПОСЛЕ обучения
  private anon = false; // аноним → survive5-карточка с «Награда: нет подсказок»

  private lastTick = 0;
  private survive5Done = false; // чтобы блок завершения не срабатывал каждый тик
  // награда ЛТС за ачивку (из профиля; для тоста «+N ЛТС»). 0 = не показываем.
  private survive5Reward = 0;
  private glutton10Reward = 0;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.right = "16px";
    // terron iOS: +safe-area, иначе лезет под нотч/часы (десктоп = +0)
    this.style.top = "calc(76px + env(safe-area-inset-top))";
    this.style.zIndex = "999"; // под карточками обучения
    this.style.pointerEvents = "none";
    this.style.maxWidth = "min(86vw, 300px)";
    return this;
  }

  private onTutorialDone = () => {
    this.active = true;
  };

  init() {
    window.addEventListener("terron-tutorial-done", this.onTutorialDone);
    void this.loadTask();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("terron-tutorial-done", this.onTutorialDone);
  }

  private survived5Local(): boolean {
    try {
      return localStorage.getItem(SURVIVED5_KEY) === "1";
    } catch {
      return false;
    }
  }

  private async loadTask() {
    // terron: один раз выжил 5 минут → основы понял → подсказки скрыты навсегда
    // (для всех, включая анонов).
    if (this.survived5Local()) {
      this.task = "hidden";
      return;
    }
    if (!(await isLoggedIn())) {
      // аноним учится так же: «Выживи 5 минут» (награда — нет подсказок).
      this.anon = true;
      this.task = "survive5";
      return;
    }
    const p = await getMyProfile();
    if (!p) {
      this.anon = true;
      this.task = "survive5";
      return;
    }
    // задачи привязаны к АЧИВКАМ — если ачивка уже есть, задача выполнена
    // (иначе конфликт: «Аппетит» получен, а трекер снова просит 10).
    const done = (id: string) =>
      p.achievements.some((a) => a.id === id && a.unlockedAt != null);
    // награды для тоста «+N ЛТС» (фактические, с учётом БД-оверрайдов)
    const reward = (id: string) =>
      p.achievements.find((a) => a.id === id)?.reward ?? 0;
    this.survive5Reward = reward("survive_5");
    this.glutton10Reward = reward("glutton_10");
    const s = p.stats;
    if (!done("survive_5")) {
      this.task = "survive5";
    } else if (!done("glutton_10")) {
      // «Аппетит» = сожрать 10 врагов (нации + племена + игроки)
      this.eatenBase = s.eatenPlayers + s.eatenNations + s.eatenTribes;
      this.task = "eat10";
    } else {
      this.task = "done";
    }
  }

  tick() {
    if (!this.active) return;
    // terron: в обучающей песочнице НИЧЕГО не трекаем (ни «выживи 5 мин», ни прочее) —
    // там только пошаговое обучение (TutorialCards ставит window.__terronInTutorial).
    if (window.__terronInTutorial) {
      if (this.task !== "hidden") this.task = "hidden";
      return;
    }

    if (this.task === "survive5") {
      const alive = this.game?.myPlayer()?.isAlive() === true;
      if (!alive) {
        this.lastTick = 0; // умер/не заспавнен — пауза таймера
        return;
      }
      const now = Date.now();
      if (this.lastTick === 0) {
        this.lastTick = now;
        return;
      }
      this.aliveSec += (now - this.lastTick) / 1000;
      this.lastTick = now;
      // завершение — РОВНО один раз (иначе тост-спам + dismissed сбрасывался
      // каждый тик → попап нельзя было закрыть)
      if (!this.survive5Done && this.aliveSec >= SURVIVE_TARGET) {
        this.survive5Done = true;
        // terron: запомнить навсегда — подсказки больше не показываем; при будущей
        // авторизации этот флаг можно засчитать в ачивку survive_5 + награду.
        try {
          localStorage.setItem(SURVIVED5_KEY, "1");
        } catch {}
        if (this.anon) {
          // анониму награда = тишина: подсказки выключаются
          this.toast(
            L(
              "🏆 Выжил 5 минут — подсказки больше не мешают!",
              "🏆 Survived 5 minutes — hints are off now!",
            ),
          );
          this.task = "hidden";
        } else {
          this.toast(
            L(
              "🏆 Достижение: Выживший — продержался 5 минут!",
              "🏆 Achievement: Survivor — held on for 5 minutes!",
            ),
            this.survive5Reward,
          );
          this.dismissed = false;
          void this.startEat10(); // дальше — «сожри 10» (без опоры на серверную ачивку)
        }
      }
      return;
    }

    if (this.task === "eat10") {
      // живой счёт: каждое завоевание игрока/нации/племени локальным игроком
      const me = this.game?.myPlayer();
      const updates = me ? this.game.updatesSinceLastTick() : null;
      const ce = updates ? updates[GameUpdateType.ConquestEvent] : undefined;
      if (me && ce && ce.length) {
        const myID = me.id();
        for (const ev of ce) if (ev.conquerorId === myID) this.eatenLive++;
      }
      if (this.eatenBase + this.eatenLive >= EAT_TARGET) {
        this.toast(
          L(
            "🏆 Достижение: Аппетит — сожрал 10 врагов!",
            "🏆 Achievement: Appetite — devoured 10 enemies!",
          ),
          this.glutton10Reward,
        );
        this.task = "done";
      }
      return;
    }
  }

  // Перейти к «сожри 10» после выживания (профиль за базу, дальше считаем живьём).
  private async startEat10() {
    this.eatenLive = 0;
    const p = await getMyProfile();
    if (p?.achievements.some((a) => a.id === "glutton_10" && a.unlockedAt != null)) {
      this.task = "done";
      return;
    }
    const s = p?.stats;
    this.eatenBase = s ? s.eatenPlayers + s.eatenNations + s.eatenTribes : 0;
    this.task = "eat10";
  }

  // toast достижения: текст + (если есть награда) «+N ЛТС» отдельной строкой
  // снизу-справа внутри плашки. TemplateResult рисует только HUD (heads-up-message).
  private toast(message: string, lts = 0) {
    const content =
      lts > 0
        ? html`<div style="display:flex;flex-direction:column;gap:3px">
            <span class="font-medium">${message}</span>
            <span
              style="align-self:flex-end;width:100%;text-align:right;font-size:12px;font-weight:700;opacity:.9;border-top:1px solid rgba(255,255,255,.25);padding-top:3px"
              >+${lts} ${L("бумаг", "securities")}</span
            >
          </div>`
        : message;
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message: content, color: "green", duration: 5000 },
      }),
    );
  }

  private dismiss = () => {
    this.dismissed = true;
  };

  private mmss(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  render() {
    // terron (19.07): в РЕПЛЕЕ квест-трекер бессмыслен («Выживи 5 минут» у
    // зрителя) — не показываем, как и обучение (SpawnTutorial.suppressed).
    try {
      if (this.game?.config().isReplay()) return html``;
    } catch {
      /* конфиг ещё не готов — решим на следующем кадре */
    }
    if (
      !this.active ||
      this.dismissed ||
      this.task === "loading" ||
      this.task === "done" ||
      this.task === "hidden"
    ) {
      return html``;
    }

    const styles = html`<style>
      .ttk {
        position: relative;
        font-family: "Golos Text", system-ui, sans-serif;
        color: #fff;
        border-radius: 10px;
        padding: 12px 14px;
        background: rgba(17, 24, 39, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.5);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(2px);
        pointer-events: auto;
        cursor: pointer;
      }
      .ttk .lbl {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        opacity: 0.6;
      }
      .ttk h4 {
        margin: 4px 0 0;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
      }
      .ttk .sub {
        font-size: 12px;
        opacity: 0.85;
        margin-top: 4px;
      }
      .ttk .x {
        position: absolute;
        top: 5px;
        right: 8px;
        font-size: 15px;
        line-height: 1;
        opacity: 0.4;
        cursor: pointer;
      }
      .ttk .x:hover {
        opacity: 0.9;
      }
      .ttk-prog {
        margin-top: 9px;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.15);
        overflow: hidden;
      }
      .ttk-prog > i {
        display: block;
        height: 100%;
        background: #d4af37;
        transition: width 0.3s ease;
      }
    </style>`;

    const closeX = html`<div class="x" title=${L("закрыть", "close")}>✕</div>`;
    const card = (body: unknown) => html`${styles}
      <div class="ttk" @click=${this.dismiss}>${closeX}${body}</div>`;

    if (this.task === "anon") {
      return card(html`<h4>
          ${L("Войди в аккаунт для заданий", "Sign in for tasks")}
        </h4>
        <div class="sub">
          ${L(
            "Прогресс и достижения хранятся в профиле.",
            "Progress and achievements are stored in your profile.",
          )}
        </div>`);
    }
    if (this.task === "survive5") {
      const pct = Math.min(100, (this.aliveSec / SURVIVE_TARGET) * 100);
      return card(html`<h4>${L("Выживи 5 минут", "Survive 5 minutes")}</h4>
        <div class="sub">${this.mmss(this.aliveSec)} / 5:00</div>
        <div class="ttk-prog"><i style="width:${pct}%"></i></div>
        ${this.anon
          ? html`<div class="sub" style="font-weight:700">
              ${L("Награда: нет подсказок", "Reward: no hints")}
            </div>`
          : ""}`);
    }
    // eat10
    const eaten = Math.min(this.eatenBase + this.eatenLive, EAT_TARGET);
    const pct = (eaten / EAT_TARGET) * 100;
    return card(html`<h4>${L("Сожри 10 врагов", "Devour 10 enemies")}</h4>
      <div class="sub">${L("Захвачено", "Captured")}: ${eaten} / ${EAT_TARGET}</div>
      <div class="ttk-prog"><i style="width:${pct}%"></i></div>`);
  }
}
