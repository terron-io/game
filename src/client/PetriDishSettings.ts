import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  clearPetriDish,
  getPetriDish,
  setPetriDish,
  type PetriLogEntry,
  type PetriState,
} from "./Api";
import { toast } from "./Toast";
import { L } from "./Utils";

/**
 * Вкладка «Чашка Петри» в настройках. Юзер привязывает свой uid из игры «Чашка
 * Петри»; с этого момента за КАЖДУЮ победу в матче ему в Чашке начисляется бонус
 * опыта с затуханием (50/40/30/20/10% на 1..5-й день). Здесь же — лог событий.
 * Стиль — общие .t-* классы из terron-theme.css.
 */
@customElement("petridish-settings")
export class PetriDishSettings extends LitElement {
  @state() private loading = true;
  @state() private state: PetriState | null = null; // null = не авторизован
  @state() private input = "";
  @state() private saving = false;

  createRenderRoot() {
    return this; // light DOM → тема применяется
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const s = await getPetriDish();
      this.state = s;
      this.input = s?.playerId != null ? String(s.playerId) : "";
    } finally {
      this.loading = false;
    }
  }

  private async save(): Promise<void> {
    const raw = this.input.trim();
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
      toast(
        L("Введите числовой ID из Чашки Петри.", "Enter a numeric Petri Dish ID."),
        "error",
      );
      return;
    }
    this.saving = true;
    const r = await setPetriDish(Number(raw));
    this.saving = false;
    if (!r.ok) {
      toast(
        r.error === "invalid_player_id"
          ? L("Некорректный ID.", "Invalid ID.")
          : L("Не удалось сохранить.", "Couldn't save."),
        "error",
      );
      return;
    }
    if (r.linkBonus?.granted) {
      toast(
        L("Привязано ✓ Начислено +10 ПТС в Чашке Петри.", "Linked ✓ +10 PTS granted in Petri Dish."),
        "success",
      );
    } else {
      toast(L("Аккаунт Чашки Петри привязан ✓", "Petri Dish account linked ✓"), "success");
    }
    await this.load();
  }

  private async unlink(): Promise<void> {
    this.saving = true;
    const ok = await clearPetriDish();
    this.saving = false;
    if (!ok) {
      toast(L("Не удалось отвязать.", "Couldn't unlink."), "error");
      return;
    }
    this.input = "";
    toast(L("Привязка снята.", "Unlinked."), "info");
    await this.load();
  }

  render(): TemplateResult {
    if (this.loading) {
      return html`<div class="t-page">
        <div class="t-muted">${L("Загрузка…", "Loading…")}</div>
      </div>`;
    }
    // Не авторизован → отправляем в таб «Аккаунт».
    if (this.state === null) {
      return html`<div class="t-page">
        <h3 class="t-h3" style="margin-top:0">${L("Чашка Петри", "Petri Dish")}</h3>
        <p class="t-muted" style="line-height:1.6">
          ${L(
            "Войдите в аккаунт (вкладка «Аккаунт»), чтобы привязать Чашку Петри и получать бонусы за победы.",
            "Sign in (the “Account” tab) to link Petri Dish and earn bonuses for wins.",
          )}
        </p>
      </div>`;
    }
    const linked = this.state.playerId != null;
    return html`<div class="t-page">
      <h3 class="t-h3" style="margin-top:0">${L("Чашка Петри", "Petri Dish")}</h3>
      <p class="t-muted" style="line-height:1.6">
        ${L(
          "Привяжите свой ID из игры «Чашка Петри» — за первую привязку начислим +10 ПТС. После этого за каждую победу в матче вы получаете там бонус опыта с затуханием: +50% в первые сутки со снижением к 5-му дню.",
          "Link your ID from the “Petri Dish” game — the first link grants +10 PTS. After that, every match win gives you a decaying XP bonus there: +50% on day one, tapering off by day five.",
        )}
      </p>

      ${linked
        ? html`<div class="t-stat" style="margin-bottom:14px">
            <div class="t-stat-lbl">${L("Привязан ID", "Linked ID")}</div>
            <div class="t-stat-val" style="font-size:18px;font-family:var(--t-mono,monospace)">
              ${this.state.playerId}
            </div>
          </div>`
        : ""}

      <div class="t-field">
        <label class="t-label">${L("ID игрока в Чашке Петри", "Petri Dish player ID")}</label>
        <input
          class="t-input"
          inputmode="numeric"
          placeholder="123456"
          .value=${this.input}
          @input=${(e: Event) => {
            this.input = (e.target as HTMLInputElement).value.replace(/\D/g, "");
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this.save();
          }}
        />
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap">
        <button class="t-btn" ?disabled=${this.saving} @click=${() => this.save()}>
          ${this.saving
            ? L("Сохранение…", "Saving…")
            : linked
              ? L("Обновить", "Update")
              : L("Привязать", "Link")}
        </button>
        ${linked
          ? html`<button
              class="t-btn ghost"
              ?disabled=${this.saving}
              @click=${() => this.unlink()}
            >
              ${L("Отвязать", "Unlink")}
            </button>`
          : ""}
      </div>

      <h3 class="t-h3">${L("Лог начислений", "Bonus log")}</h3>
      ${this.renderLog(this.state.log)}
    </div>`;
  }

  private renderLog(log: PetriLogEntry[]): TemplateResult {
    if (!log || log.length === 0) {
      return html`<div class="t-muted" style="font-size:13px">
        ${L(
          "Пока пусто. Выиграйте матч — бонусы появятся здесь.",
          "Empty so far. Win a match — bonuses will show up here.",
        )}
      </div>`;
    }
    return html`<div style="display:flex;flex-direction:column;gap:8px">
      ${log.map((e) => this.renderLogRow(e))}
    </div>`;
  }

  private renderLogRow(e: PetriLogEntry): TemplateResult {
    const when = new Date(e.created_at);
    const whenStr = isNaN(when.getTime())
      ? ""
      : when.toLocaleString(undefined, {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
    const badge = this.statusBadge(e.status);
    return html`<div
      style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--t-sheet,#fdfcf7);border:1px solid var(--t-line,#e5ddc7)"
    >
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;color:var(--t-ink)">${this.bonusLabel(e)}</div>
        <div class="t-muted" style="font-size:12px">
          ${e.kind === "link" ? L("За привязку", "For linking") : L("За победу", "For a win")}
          · ${whenStr}
        </div>
      </div>
      <span
        style="flex:0 0 auto;font-size:11px;font-weight:700;padding:3px 8px;border:1px solid ${badge.color};color:${badge.color};white-space:nowrap"
        title=${e.error ?? ""}
      >
        ${badge.label}
      </span>
    </div>`;
  }

  // Человекочитаемое описание по типу бонуса. Победный ExpMult шлётся тирами
  // ExpMult_d1..d5 — их сводим к общему «Опыт ×+N% · K дн.».
  private bonusLabel(e: PetriLogEntry): string {
    const days = Math.round(e.duration / 86400);
    const t = e.bonus_type;
    if (t === "ExpMult" || t.startsWith("ExpMult_")) {
      return `${L("Опыт", "XP")} ×+${e.bonus_size}% · ${days} ${L("дн.", "d")}`;
    }
    if (t === "ExpAdd") return `${L("Опыт", "XP")} +${e.bonus_size}`;
    if (t === "PTSMult") {
      return `${L("Множитель покупки", "Purchase multiplier")} +${e.bonus_size}%`;
    }
    if (t === "PTSAdd") return `${L("Валюта ПТС", "PTS currency")} +${e.bonus_size}`;
    return `${t} · ${e.bonus_size}`;
  }

  private statusBadge(status: string): { label: string; color: string } {
    switch (status) {
      case "sent":
        return { label: L("Начислено", "Granted"), color: "#3b7a3b" };
      case "too_frequent":
        return { label: L("Уже есть", "Already"), color: "#7a7a3b" };
      case "banned":
        return { label: L("Бан", "Banned"), color: "#a8432b" };
      case "not_found":
        return { label: L("Нет игрока", "No player"), color: "#a8432b" };
      case "skipped":
        return { label: L("Отложено", "Skipped"), color: "#7a7a7a" };
      default:
        return { label: L("Ошибка", "Failed"), color: "#a8432b" };
    }
  }
}
