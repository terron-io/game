import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { L } from "../Utils";

// terron: атмосфера дня/ночи на ГЛАВНОЙ. Ночь наступает САМА по локальному
// времени игрока (вечер темнеет, ночь — тёмная комната + виньетка). Свет
// настольной лампы можно включить/выключить В ЛЮБОЕ ВРЕМЯ шнуровым
// выключателем (как у подключённой лампы). Отдельная спрятанная «луна» в углу —
// принудительно врубить ночь, минуя часы. Всё состояние — в localStorage.
const LAMP_KEY = "terronLamp"; // "on" | "off" — свет лампы
const NIGHT_KEY = "terronForceNight"; // "1" — принудительная ночь
const MAX_DARK = 0.82;

@customElement("terron-ambient")
export class TerronAmbient extends LitElement {
  @state() private darkness = 0;
  @state() private lampOn = true;
  @state() private forceNight = false;
  private timer: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    try {
      this.lampOn = localStorage.getItem(LAMP_KEY) !== "off";
      this.forceNight = localStorage.getItem(NIGHT_KEY) === "1";
    } catch {
      /* ignore */
    }
    this.recompute();
    this.timer = window.setInterval(() => this.recompute(), 60_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timer) clearInterval(this.timer);
    document.body.classList.remove("terron-dim");
  }

  private recompute() {
    if (this.forceNight) {
      this.darkness = MAX_DARK;
    } else {
      const now = new Date();
      this.darkness = TerronAmbient.darknessForHour(
        now.getHours() + now.getMinutes() / 60,
      );
    }
    // тёмное время → логотип (тёмный текст) делаем светлым, чтоб читался
    document.body.classList.toggle("terron-dim", this.darkness > 0.3);
  }

  // 0 = светло (день), MAX_DARK = глубокая ночь. Плавные закат/рассвет.
  static darknessForHour(h: number): number {
    if (h >= 7 && h < 18) return 0; // день
    if (h >= 18 && h < 21) return (MAX_DARK * (h - 18)) / 3; // закат
    if (h >= 21 || h < 5) return MAX_DARK; // ночь
    if (h >= 5 && h < 7) return MAX_DARK * (1 - (h - 5) / 2); // рассвет
    return 0;
  }

  private toggle = () => {
    this.lampOn = !this.lampOn;
    try {
      localStorage.setItem(LAMP_KEY, this.lampOn ? "on" : "off");
    } catch {
      /* ignore */
    }
  };

  private toggleNight = () => {
    this.forceNight = !this.forceNight;
    try {
      localStorage.setItem(NIGHT_KEY, this.forceNight ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.recompute(); // мгновенно применить, не ждать таймер
  };

  render() {
    const d = this.darkness;
    // углы виньетки гасим сильнее, чтобы ночью читалась «тёмная комната»
    const night = Math.min(1, d * 1.4);
    // тёплая лужа света — только когда лампа включена и уже темно
    const glow = this.lampOn ? Math.min(1, d * 1.25) : 0;
    return html`
      <style>
        /* terron perf: ОБА слоя живут в собственном стекинг-контексте
           (isolation:isolate). Без него mix-blend-mode:screen у .amb-glow
           смешивался с КОРНЕВЫМ слоем — браузер не мог скроллить контент
           композитором и перерисовывал весь вьюпорт каждый кадр (скролл шёл
           рывками на всех страницах). Внутри группы блендинг сохранён:
           свет по-прежнему ложится screen'ом на ночную виньетку. */
        .amb-layers {
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          isolation: isolate;
          contain: layout paint;
        }
        .amb-night,
        .amb-glow {
          position: absolute;
          inset: 0;
          pointer-events: none;
          will-change: opacity;
        }
        /* Тёмная комната — ВИНЬЕТКА. z-index:-1 → лежит ПОД интерфейсом, темнеет
           только ФОН (карта/пергамент), а белые панели и хедер остаются яркими. */
        .amb-night {
          background: radial-gradient(
            ellipse 76% 80% at 47% 54%,
            rgba(6, 9, 22, 0.1) 0%,
            rgba(6, 9, 22, 0.34) 40%,
            rgba(4, 6, 16, 0.78) 72%,
            rgba(1, 2, 8, 1) 100%
          );
          transition: opacity 1.6s ease;
        }
        /* Тёплый свет настольной лампы (слева) по фону: яркое пятно у лампы +
           «лужа» по центру. Тоже под интерфейсом. screen — подсвечивает фон. */
        .amb-glow {
          mix-blend-mode: screen;
          background:
            radial-gradient(
              1100px 800px at 40% 56%,
              rgba(255, 196, 104, 0.6),
              rgba(255, 164, 60, 0.2) 46%,
              transparent 75%
            ),
            radial-gradient(
              460px 420px at 4% 52%,
              rgba(255, 214, 130, 0.85),
              transparent 70%
            );
          transition: opacity 1.2s ease;
        }
        /* шнуровой выключатель света (спрайт) — низ-право, шнур уходит вверх.
           Вкл/выкл свет в любое время; состояние подсвечивается ярче/тусклее. */
        .amb-switch {
          position: fixed;
          right: 26px;
          bottom: -10px;
          z-index: 42;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          line-height: 0;
        }
        .amb-switch img {
          height: 208px;
          width: auto;
          display: block;
          user-select: none;
          transition: filter 0.3s ease;
        }
        .amb-switch.on img {
          filter: drop-shadow(0 0 13px rgba(255, 200, 110, 0.45));
        }
        .amb-switch.off img {
          filter: brightness(0.5) saturate(0.8);
        }
        /* спрятанная «луна» — принудительно врубить ночь, минуя часы */
        .amb-nightbtn {
          position: fixed;
          left: 14px;
          bottom: 14px;
          z-index: 43;
          background: none;
          border: none;
          padding: 5px;
          cursor: pointer;
          line-height: 0;
          color: #6b5f3a;
          opacity: 0.22;
          transition:
            opacity 0.3s ease,
            color 0.3s ease;
        }
        .amb-nightbtn:hover {
          opacity: 0.85;
        }
        .amb-nightbtn.on {
          color: #e6c878;
          opacity: 0.8;
        }
        body.in-game terron-ambient {
          display: none;
        }
        /* terron mobile: кабель-выключатель (208px) и луна налезали на контент — прячем */
        @media (max-width: 767px) {
          .amb-switch,
          .amb-nightbtn {
            display: none !important;
          }
        }
      </style>
      <div class="amb-layers">
        <div class="amb-night" style="opacity:${night}"></div>
        <div class="amb-glow" style="opacity:${glow}"></div>
      </div>

      <!-- terron: шнуровой выключатель света убран с главной (по просьбе). -->

      <!-- спрятанный тумблер принудительной ночи (минуя часы) -->
      <button
        class="amb-nightbtn ${this.forceNight ? "on" : ""}"
        @click=${this.toggleNight}
        title=${this.forceNight
          ? L("Вернуть авто-режим", "Back to auto mode")
          : L("Ночной режим", "Night mode")}
        aria-label=${L("ночной режим", "night mode")}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
          />
        </svg>
      </button>
    `;
  }
}
