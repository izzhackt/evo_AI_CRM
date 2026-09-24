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
