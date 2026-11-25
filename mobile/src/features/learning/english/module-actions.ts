// Две кнопки модуля («Повторить ошибки», «Тест по английскому») стоят в строке поровну, пока самое длинное слово подписи
// помещается в половину строки; иначе одна под другой на всю ширину. Раньше строка была всегда: на экране 320 pt и при крупном
// шрифте системы длинное слово («английскому») ломалось посреди слова (ревью #1567, мелочь 3).
//
// Правило считает по ширине, которую телефон сообщил самой строке (`onLayout`), и по масштабу шрифта системы, а не по номеру
// модели. Ширина слова оценивается долей кегля (`WORD_EM`: средняя ширина буквы кириллицы полужирным с запасом около 8 %,
// у «английскому» в SF Semibold 17 pt около 105 pt, оценка 116 pt), рост шрифта у общего `Text` ограничен вдвое (`body`).
export const ACTIONS_GAP = 8;
/** Внутри `Button`: поля по 16 pt и рамка по 1 pt с каждой стороны. */
export const BUTTON_CHROME = 2 * (16 + 1);
/** Ширина буквы в долях кегля. */
export const WORD_EM = 0.62;
/** Предел роста шрифта общего `Text` (вариант `body`). */
const MAX_SCALE = 2;

/** Число букв в самом длинном слове из подписей. */
export function longestWordLength(labels: readonly string[]): number {
  return Math.max(0, ...labels.flatMap((label) => label.split(/\s+/).map((word) => [...word].length)));
}

/** Нужна ли колонка: слово не поместится в половину строки при данной ширине строки (0 - ещё не измерена), кегле и масштабе шрифта. */
export function actionsStacked({ rowWidth, labels, fontSize, fontScale }: { rowWidth: number; labels: readonly string[]; fontSize: number; fontScale: number }): boolean {
  if (rowWidth <= 0 || labels.length < 2) return false;
  const scale = Math.min(Math.max(fontScale, 1), MAX_SCALE);
  const needed = longestWordLength(labels) * WORD_EM * fontSize * scale + BUTTON_CHROME;
  return needed > (rowWidth - ACTIONS_GAP) / 2;
}
