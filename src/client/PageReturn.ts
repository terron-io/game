// terron 20.09: «назад» со страницы, открытой ИЗ другой страницы, обязано вести
// туда, откуда пришли. `BaseModal.close()` у inline-страниц всегда уводит на
// главную — репорт владельца: открыл описание Prime из магазина, нажал «назад»
// и оказался не в магазине. Страница-источник оставляет здесь свой id перед
// переходом, страница-цель забирает его при «назад» (одноразово).
let returnTo: string | null = null;

/** Открыть страницу `target`, запомнив, что вернуться надо на `from`. */
export function openPageFrom(from: string, target: string): void {
  returnTo = from;
  window.showPage?.(target);
}

/** Забрать (и забыть) страницу возврата. null — пришли не из другой страницы. */
export function takeReturnPage(): string | null {
  const v = returnTo;
  returnTo = null;
  return v;
}
