/**
 * Куда встаёт фокус, когда в «Документах» открыли папку: нажатая строка или ссылка пути исчезла из разметки, и фокус упал бы на страницу.
 * Подпапка — её название в пути (текущее звено); корень — таблица (на телефоне — первая карточка списка), чтобы Tab и читалка остались в списке.
 */
export function focusAfterOpen(frame: HTMLElement | null, currentCrumb: HTMLElement | null): void {
  const visible = (element: HTMLElement) => element.offsetParent !== null;
  const target = currentCrumb ?? [...(frame?.querySelectorAll<HTMLElement>('[role="region"], [data-card-open]') ?? [])].find(visible);
  target?.focus({ preventScroll: true });
}
