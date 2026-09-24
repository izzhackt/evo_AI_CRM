/**
 * Дорожки CSS grid досок (решение владельца 25.09.2026: все колонки на экране,
 * без прокрутки вбок). Чистые функции без JSX — их проверяют тесты напрямую.
 */

/** Свёрнутая колонка: рейка с названием и числом. */
export const BOARD_RAIL_TRACK = "44px";
/** Рабочая колонка продаж: делит ширину поровну и никогда не шире доски. */
export const BOARD_FLUID_TRACK = "minmax(0, 1fr)";

/**
 * Дорожки доски с фокусом этапа. Без фокуса рабочие этапы делят ширину, а
 * `railKeys` (исход, который копится вечно, — «Переданы») стоят рейкой. С
 * фокусом раскрыта только выбранная колонка, остальные — рейки.
 */
export function boardTracks(
  keys: readonly string[],
  focus: string,
  railKeys: readonly string[] = [],
): string {
  return keys
    .map((key) => {
      if (focus === "all") return railKeys.includes(key) ? BOARD_RAIL_TRACK : BOARD_FLUID_TRACK;
      return key === focus ? BOARD_FLUID_TRACK : BOARD_RAIL_TRACK;
    })
    .join(" ");
}

/**
 * Дорожки доски поступления: 5 или 4 этапа по 168–360 px, по левому краю.
 * Верхняя граница не даёт четырём колонкам «Визы и выезда» на 1920 px стать
 * карточками по 400 px.
 */
export function cappedBoardTracks(count: number): string {
  return `repeat(${count}, minmax(168px, 360px))`;
}
