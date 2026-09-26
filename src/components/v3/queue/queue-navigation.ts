/**
 * Выбор строки очереди клавишами и видимость выбранной строки. Чистые
 * функции без DOM и React: их проверяет unit-тест, а `useQueueKeyboard`
 * применяет к строкам страницы.
 */

/**
 * Следующая строка для j/k и ↑/↓: от строки с фокусом, иначе от выбранной
 * (`aria-current`), иначе первая. Чистая функция — её проверяет unit-тест.
 */
export function nextQueueIndex(count: number, current: number, selected: number, step: 1 | -1): number {
  if (count === 0) return -1;
  const from = current >= 0 ? current : selected;
  if (from < 0) return step === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, from + step));
}

/** Липкий заголовок группы закрывает верх окна: строка под ним не считается видимой. */
export const QUEUE_REVEAL_TOP_PX = 48;

/**
 * Нужно ли прокрутить к выбранной строке: да, если она не видна целиком между
 * липким заголовком группы и низом окна. Видимую строку не трогаем — щелчок по
 * строке список не сдвигает.
 */
export function rowNeedsReveal(rect: Readonly<{ top: number; bottom: number }>, viewportHeight: number, topInset = QUEUE_REVEAL_TOP_PX): boolean {
  return rect.top < topInset || rect.bottom > viewportHeight;
}

/**
 * Куда перевести фокус, когда строка с фокусом уходит из списка (истекло
 * «Отменить» у завершённой задачи): на следующую остающуюся строку, иначе на
 * предыдущую; `null` — остающихся строк нет. `gone` — ключи строк, которые
 * исчезнут с обновлением списка.
 */
export function queueFocusAfterRemoval(keys: readonly string[], current: string, gone: ReadonlySet<string>): string | null {
  const index = keys.indexOf(current);
  if (index < 0) return null;
  return [...keys.slice(index + 1), ...keys.slice(0, index).reverse()].find((key) => !gone.has(key)) ?? null;
}

/**
 * Атрибут всплывающего окна, которое не забирает клавиши очереди. Меню, окно
 * «Результат» и подсказка «?» — окна, в которых человек сейчас работает:
 * пока они открыты, j/k, «/», «?», Shift+Enter и Esc панели молчат. Строка
 * «Отменить» нового облика (UndoToast, `popover="manual"`) — не такое окно:
 * она висит не меньше 6 секунд после каждого завершения и не должна
 * выключать клавиатуру очереди на это время.
 */
export const QUEUE_PASSIVE_POPOVER = "data-queue-passive";

/**
 * Молчит ли клавиатура очереди при открытых всплывающих окнах
 * (`:popover-open`): да, если среди них есть хоть одно не пассивное (без
 * `data-queue-passive`). Одна строка «Отменить» клавиши не выключает. Чистая
 * функция — её проверяет unit-тест.
 */
export function popoverBlocksQueueKeys(open: Iterable<Readonly<{ hasAttribute(name: string): boolean }>>): boolean {
  for (const element of open) if (!element.hasAttribute(QUEUE_PASSIVE_POPOVER)) return true;
  return false;
}
