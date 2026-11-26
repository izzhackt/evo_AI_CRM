// Таблицы теории на узком экране (аудит паритета, U13): от четырёх столбцов таблица шире 360-пунктового телефона и
// прокручивается вбок, как на вебе; до трёх столбцов столбцы делят ширину поровну. Проверено на настоящих таблицах выпуска
// контента (23 таблицы в 28 уроках: 17 из двух и трёх столбцов, 6 из четырёх и пяти).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CscaCell } from "@web/lib/portal/csca";

import { CELL_PADDING, TABLE_SCROLL_FROM, cellWidth, tableLayout, type TableBlock } from "@/features/learning/csca/table-layout";

const LESSONS = path.join(__dirname, "../../../../../docs/design/portal/content/csca/math/lessons");

/** Таблицы выпуска как блоки теории (ключи snake_case, как в ответе сервера). */
function contentTables(): { where: string; block: TableBlock }[] {
  return readdirSync(LESSONS)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const lesson = JSON.parse(readFileSync(path.join(LESSONS, name), "utf8")) as { blocks: { kind: string }[] };
      return lesson.blocks.flatMap((block, index) => (block.kind === "table" ? [{ where: `${name}#${index}`, block: block as unknown as TableBlock }] : []));
    });
}

/** Ширина рамки таблицы на телефоне в 360 pt: поля экрана 16 и поля листа 16 с каждой стороны, рамка 1. */
const PHONE_360 = 360 - 2 * 16 - 2 * 16 - 2;

const text = (ru: string): CscaCell => ({ ru, ky: ru });
const table = (columns: number, rows = 3): TableBlock => ({
  kind: "table",
  caption_ru: "Таблица",
  caption_ky: "Таблица",
  header: Array.from({ length: columns }, (_, i) => text(`Столбец ${i + 1}`)),
  rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ tex: "1" }) as CscaCell)),
});

describe("раскладка таблицы теории", () => {
  it("выпуск содержит таблицы из двух, трёх, четырёх и пяти столбцов", () => {
    const columns = new Set(contentTables().map(({ block }) => block.header.length));
    expect([...columns].sort()).toEqual([2, 3, 4, 5]);
  });

  it("до трёх столбцов: поровну на всю ширину, прокрутки нет", () => {
    for (const { where, block } of contentTables().filter(({ block }) => block.header.length < TABLE_SCROLL_FROM)) {
      expect([where, tableLayout(block, "ru", PHONE_360)]).toEqual([where, { widths: null, scroll: false }]);
    }
  });

  it("от четырёх столбцов на телефоне в 360 pt таблица прокручивается вбок", () => {
    const wide = contentTables().filter(({ block }) => block.header.length >= TABLE_SCROLL_FROM);
    expect(wide.length).toBeGreaterThanOrEqual(6);
    for (const { where, block } of wide) {
      const layout = tableLayout(block, "ru", PHONE_360);
      expect([where, layout.scroll]).toEqual([where, true]);
      expect(layout.widths).toHaveLength(block.header.length);
      // Столбец не уже минимума и не шире потолка: формулы с дробями не сжимаются в щель.
      for (const width of layout.widths ?? []) expect(width).toBeGreaterThanOrEqual(84);
      expect((layout.widths ?? []).reduce((sum, width) => sum + width, 0)).toBeGreaterThan(PHONE_360);
    }
  });

  it("то же на кыргызском", () => {
    for (const { block } of contentTables().filter(({ block }) => block.header.length >= TABLE_SCROLL_FROM)) {
      expect(tableLayout(block, "ky", PHONE_360).scroll).toBe(true);
    }
  });

  it("пока ширина рамки неизвестна, таблица рисуется по содержимому и прокручивается", () => {
    expect(tableLayout(table(5), "ru", 0).scroll).toBe(true);
  });

  it("широкий экран: четыре столбца помещаются, растягиваются пропорционально и не прокручиваются", () => {
    const layout = tableLayout(table(4), "ru", 700);
    expect(layout.scroll).toBe(false);
    expect(layout.widths).toHaveLength(4);
    expect((layout.widths ?? []).reduce((sum, width) => sum + width, 0)).toBeCloseTo(700, 5);
  });

  it("порог ровно у границы: три столбца поровну, четыре по содержимому", () => {
    expect(tableLayout(table(TABLE_SCROLL_FROM - 1), "ru", PHONE_360)).toEqual({ widths: null, scroll: false });
    expect(tableLayout(table(TABLE_SCROLL_FROM), "ru", PHONE_360).scroll).toBe(true);
  });

  it("длинный текст в ячейке расширяет столбец, но не выше потолка", () => {
    const block = table(4);
    block.rows[0][2] = text("Очень длинное объяснение условия, которое переносится по словам и не должно растянуть столбец без предела");
    const widths = tableLayout(block, "ru", PHONE_360).widths ?? [];
    expect(widths[2]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeLessThanOrEqual(220);
  });

  it("оценка ячейки: формулу считают без команд и скобок, слова по самому длинному слову и половине строки", () => {
    expect(cellWidth({ tex: "\\frac{\\sqrt{3}}{2}" }, "ru")).toBe(2 * 8 + 2 * CELL_PADDING);
    expect(cellWidth({ ru: "Градусы", ky: "Градус" }, "ru")).toBe(7 * 8 + 2 * CELL_PADDING);
    expect(cellWidth({ ru: "Градусы", ky: "Градус" }, "ky")).toBe(6 * 8 + 2 * CELL_PADDING);
  });
});
