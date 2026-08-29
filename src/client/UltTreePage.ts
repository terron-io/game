import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import "./UltTree";
import "./UltStatsTable";
import { L, translateText } from "./Utils";

// terron: /ults — дерево ульт (базовые + закрытые с замками). TZ-ult-unlocks.md
// terron 26.08: вторая вкладка /ults/stats — публичная таблица винрейта ульт
// (решение владельца). Роутер кладёт второй сегмент пути в args.tab, поэтому
// отдельной регистрации маршруту не нужно — как у /shop/history.
type PageTab = "tree" | "stats";

@customElement("ult-tree-page")
export class UltTreePage extends BaseModal {
  protected routerName = "ults";
  @state() private tab: PageTab = "tree";

  protected modalConfig() {
    return { title: L("Ульты", "Ultimates"), fullscreen: true };
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.tab = args?.tab === "stats" ? "stats" : "tree";
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title:
        this.tab === "stats"
          ? L("Статистика ульт", "Ultimate stats")
          : L("Дерево ульт", "Ultimate tree"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  /**
   * Переключение вкладки БЕЗ перезагрузки, но с честным адресом: настоящий
   * <a href> (cmd+клик открывает вкладку браузера — урок липкого лобби), а
   * обычный клик правит историю сами. softGo() тут не годится: вне площадки
   * он делает полную перезагрузку страницы, а мы просто меняем панель.
   */
  private go(tab: PageTab, e: Event): void {
    e.preventDefault();
    if (this.tab === tab) return;
    this.tab = tab;
    try {
      history.pushState(null, "", tab === "stats" ? "/ults/stats" : "/ults");
    } catch {
      /* адрес не главное — панель уже переключилась */
    }
  }

  private renderTabs(): TemplateResult {
    const tabs: [PageTab, string, string][] = [
      ["tree", "/ults", L("Дерево", "Tree")],
      ["stats", "/ults/stats", L("Статистика", "Stats")],
    ];
    return html`<div
      style="display:flex;gap:18px;padding:2px 0 10px;font-size:13.5px;border-bottom:1px solid rgba(0,0,0,.1);margin-bottom:12px"
    >
      ${tabs.map(
        ([id, href, label]) =>
          html`<a
            href=${href}
            @click=${(e: Event) => this.go(id, e)}
            style=${this.tab === id
              ? "font-weight:800;border-bottom:2px solid var(--t-ink,#2b2a24);padding-bottom:8px;margin-bottom:-11px;color:inherit;text-decoration:none"
              : "opacity:.55;color:inherit;text-decoration:none"}
            >${label}</a
          >`,
      )}
    </div>`;
  }

  protected renderBody(): TemplateResult {
    return html`<div class="t-page" style="max-width:none">
      ${this.renderTabs()}
      ${this.tab === "stats"
        ? html`<ult-stats-table></ult-stats-table>`
        : html`<ult-tree></ult-tree>`}
    </div>`;
  }
}
