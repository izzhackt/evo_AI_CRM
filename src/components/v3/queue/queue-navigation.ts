/**
 * Выбор строки очереди клавишами. Чистые функции без DOM и React: их
 * проверяет unit-тест, а `useQueueKeyboard` применяет к строкам страницы.
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
