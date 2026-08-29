import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe, uploadScreenshot } from "../../Api";
import { toast } from "../../Toast";
import { L } from "../../Utils";

// terron: кнопка-фотик в игре. Снимает карту (WebGL-слой) БЕЗ интерфейсов
// (window.__terronCaptureMap, выставляется в ClientGameRunner) и кладёт скрин в
// альбом игрока (/propaganda → «Мои»). Оттуда за ЛТС можно опубликовать в общую
// галерею. Показывается только в игре (CSS body.in-game — задаётся в index.html).
@customElement("screenshot-button")
export class ScreenshotButton extends LitElement {
  @state() private busy = false;

  createRenderRoot() {
    return this; // light DOM — чтобы применялись Tailwind-классы из index.html
  }

  private async capture(): Promise<void> {
    if (this.busy) return;
    const cap = (
      window as unknown as {
        __terronCaptureMap?: (
          maxW?: number,
        ) => { dataUrl: string; width: number; height: number } | null;
      }
    ).__terronCaptureMap?.();
    if (!cap) {
      toast(L("Снимок не удался", "Screenshot failed"), "error");
      return;
    }
    this.busy = true;
    try {
      const me = await getUserMe();
      if (!me) {
        toast(
          L(
            "Войдите, чтобы сохранять скриншоты в альбом",
            "Sign in to save screenshots to your album",
          ),
          "error",
        );
        return;
      }
      const shot = await uploadScreenshot({
        dataUrl: cap.dataUrl,
        width: cap.width,
        height: cap.height,
      });
      if (shot) {
        toast(
          L(
            "Скрин в альбоме — «Пропаганда» → Мои",
            "Saved to album — Propaganda → Mine",
          ),
          "success",
        );
      } else {
        toast(L("Не удалось сохранить", "Save failed"), "error");
      }
    } finally {
      this.busy = false;
    }
  }

  render() {
    return html`<button
      class="pointer-events-auto flex items-center justify-center w-8 h-8 bg-gray-700/80 hover:bg-gray-600/90 backdrop-blur-sm shadow-lg rounded-full text-white transition-colors ${this
        .busy
        ? "opacity-60"
        : ""}"
      title=${L("Снимок карты (без интерфейса)", "Screenshot (no UI)")}
      aria-label=${L("Снимок карты", "Screenshot")}
      @click=${() => void this.capture()}
    >
      <svg
        class="w-5 h-5"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
        />
        <circle cx="12" cy="13" r="4" />
      </svg>
    </button>`;
  }
}
