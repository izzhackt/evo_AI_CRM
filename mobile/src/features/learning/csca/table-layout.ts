// Раскладка таблицы теории на узком экране (аудит паритета, U13; веб: `.cs-table-wrap` с `overflow-x: auto`). На вебе таблица
// шириной по содержимому, а рамка прокручивается вбок, когда таблица шире экрана. Здесь так же: до трёх столбцов столбцы
// делят ширину поровну, начиная с четырёх каждый столбец получает ширину по самой длинной ячейке (не уже минимума), и если
// сумма шире экрана, таблица прокручивается вбок. Ширину текста оценивает число знаков, а не измерение шрифта: расчёт чистый и
// не ждёт отрисовки.
import type { CscaCell, CscaTheoryBlock } from "@web/lib/portal/csca";

export type TableBlock = Extract<CscaTheoryBlock, { kind: "table" }>;

/** С этого числа столбцов таблица ширится по содержимому и прокручивается: на телефоне в 360 pt четыре равных столбца тесны для дробей. */
export const TABLE_SCROLL_FROM = 4;
/** Поля ячейки слева и справа. */
export const CELL_PADDING = 12;
const MIN_COLUMN = 84;
const MAX_COLUMN = 220;
/** Ширина одного знака текста ячейки (шрифт 15 pt), pt. */
const CHAR = 8;

/** Сколько знаков занимает формула на экране: дробь, корень и скобки стоят этажами, поэтому команды и скобки не считаются. */
function formulaLength(tex: string): number {
  return tex
    .replace(/\\(?:frac|sqrt|left|right|quad)\b/gu, "")
    .replace(/\\[A-Za-z]+/gu, "x")
    .replace(/[{}^_]/gu, "").length;
}

/** Оценка ширины ячейки в pt вместе с полями. */
export function cellWidth(cell: CscaCell, lang: "ru" | "ky"): number {
  if ("tex" in cell) return formulaLength(cell.tex) * CHAR + 2 * CELL_PADDING;
  // Слова переносятся: ширину задаёт самое длинное слово, но не больше половины длины строки (вторая половина уйдёт на перенос).
  const text = cell[lang];
  const longestWord = Math.max(...text.split(/\s+/u).map((word) => word.length));
  return Math.max(longestWord, Math.ceil(text.length / 2)) * CHAR + 2 * CELL_PADDING;
}

export type TableLayout = Readonly<{
  /** Ширины столбцов в pt; `null` - столбцы делят ширину поровну. */
  widths: readonly number[] | null;
  /** Таблица шире экрана и прокручивается вбок. */
  scroll: boolean;
}>;

/** `available` - ширина рамки таблицы на экране (0, пока она не известна: тогда таблица рисуется по содержимому). */
export function tableLayout(block: TableBlock, lang: "ru" | "ky", available: number): TableLayout {
  const columns = block.header.length;
  if (columns < TABLE_SCROLL_FROM) return { widths: null, scroll: false };
  const natural = block.header.map((_, column) => {
    const widest = Math.max(cellWidth(block.header[column], lang), ...block.rows.map((row) => cellWidth(row[column], lang)));
    return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, Math.ceil(widest)));
  });
  const total = natural.reduce((sum, width) => sum + width, 0);
  // Таблица уже экрана: растягиваем столбцы пропорционально, прокрутка не нужна.
  if (available > 0 && total <= available) return { widths: natural.map((width) => (width / total) * available), scroll: false };
  return { widths: natural, scroll: true };
}
