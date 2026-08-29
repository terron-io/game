import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./AccountSettings";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { L, translateText } from "./Utils";

/**
 * Маршрут /account (back-compat). Само тело аккаунта живёт в <account-settings>
 * и переиспользуется первым табом настроек (/settings). Меню-пункта аккаунта
 * больше нет — вход/настройки аккаунта в Настройках.
 */
@customElement("account-modal")
export class AccountModal extends BaseModal {
  protected routerName = "account";

  // под-раздел из URL: /account/delete → view="delete" (страница удаления).
  @state() private view = "";

  protected onOpen(args?: Record<string, unknown>): void {
    this.view = typeof args?.tab === "string" ? args.tab : "";
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: L("Аккаунт", "Account"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    return html`<account-settings .view=${this.view}></account-settings>`;
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }
}
