// «Всё избранное»: карточка и таблица сравнения. Правила те же, что у веб-файлов `FavoritesView.tsx` (сравнение) и
// `university-tiles.ts` (`publishedTileModel`): их нельзя импортировать (клиентский компонент и `server-only`), поэтому
// совпадение держат значения ниже и проверка порядка строк и разделителей по тексту веб-файла.
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPortalStrings } from "@web/lib/portal/i18n";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";

import { COMPARE_MIN, compareRows, publishedTile, selectedUniversities } from "@/features/home/favorites-compare";
import { universityRow } from "@/test-fixtures/universities";

const FAVORITES_VIEW = path.resolve(__dirname, "../../../../../src/components/portal/favorites/FavoritesView.tsx");
const NOW = new Date("2026-09-08T05:00:00Z");

const favorites = getPortalStrings("favorites", "ru");
const universities = getPortalStrings("universities", "ru");

/** Вуз из фикстуры; `edit` меняет содержимое (город, программы, сроки). */
function university(n: number, edit: (content: Record<string, unknown>) => void = () => undefined, name?: string): PublishedUniversity {
  const row = universityRow(n, name);
  const content = JSON.parse(JSON.stringify(row.content)) as Record<string, unknown>;
  edit(content);
  return { ...row, content } as never;
}

describe("карточка избранного (веб publishedTileModel)", () => {
  it("название, «город · страна», уровни словами и ближайший срок подачи", () => {
    const tile = publishedTile(university(1), universities, "ru", NOW);
    expect(tile).toEqual({
      id: university(1).id,
      name: "Университет 1",
      place: "Куала-Лумпур · Малайзия",
      levels: ["Бакалавриат"],
      intake: "подача до 1 мая 2027 г.",
      photoKey: null,
    });
  });

  it("города нет - место одна страна; нет открытого набора - «Даты уточняются» (у плитки строка есть всегда)", () => {
    const tile = publishedTile(
      university(2, (content) => {
        content.city = null;
        const programs = content.programs as { intakes: Record<string, unknown>[] }[];
        programs[0].intakes[0] = { ...programs[0].intakes[0], applicationDeadline: null, startMonth: null };
      }),
      universities,
      "ru",
      NOW,
    );
    expect(tile.place).toBe("Малайзия");
    expect(tile.intake).toBe(universities.intakeDatesPending);
  });

  it("кыргызский: слова уровня и страны из словаря", () => {
    const ky = getPortalStrings("universities", "ky");
    const tile = publishedTile(university(1), ky, "ky", NOW);
    expect(tile.levels).toEqual([ky["level.bachelor"]]);
    expect(tile.place).toContain("·");
  });
});

describe("таблица сравнения (веб CompareTable)", () => {
  const first = university(1);
  const second = university(
    2,
    (content) => {
      content.city = null;
      (content.programs as Record<string, unknown>[]).push({ ...(content.programs as Record<string, unknown>[])[0], id: "ms", title: "Прикладная математика", level: "master" });
    },
    "Университет Б",
  );

  it("четыре строки в порядке веба: страна и город, уровни, программы, ближайший набор", () => {
    const rows = compareRows([first, second], favorites, universities, "ru", NOW);
    expect(rows.map((row) => [row.key, row.label])).toEqual([
      ["country", "Страна и город"],
      ["levels", "Уровни"],
      ["programs", "Программы"],
      ["intake", "Ближайший набор"],
    ]);
  });

  it("ячейки: город или «Город не указан», уровни через запятую, программы «название — уровень», срок подачи", () => {
    const [country, levels, programs, intake] = compareRows([first, second], favorites, universities, "ru", NOW);
    expect(country.cells.map((cell) => cell.lines)).toEqual([["Малайзия · Куала-Лумпур"], ["Малайзия · Город не указан"]]);
    expect(levels.cells.map((cell) => cell.lines)).toEqual([["Бакалавриат"], ["Бакалавриат, Магистратура"]]);
    expect(programs.cells.map((cell) => cell.lines)).toEqual([["Информатика — Бакалавриат"], ["Информатика — Бакалавриат", "Прикладная математика — Магистратура"]]);
    expect(intake.cells.map((cell) => cell.lines)).toEqual([["подача до 1 мая 2027 г."], ["подача до 1 мая 2027 г."]]);
    expect(country.cells.map((cell) => cell.name)).toEqual(["Университет 1", "Университет Б"]);
  });

  it("у вуза без открытого набора в таблице «Даты уточняются» (в таблице строка есть, на карточке ленты нет)", () => {
    const noDates = university(3, (content) => {
      const programs = content.programs as { intakes: Record<string, unknown>[] }[];
      programs[0].intakes[0] = { ...programs[0].intakes[0], applicationDeadline: null, startMonth: null };
    });
    const intake = compareRows([first, noDates], favorites, universities, "ru", NOW)[3];
    expect(intake.cells[1].lines).toEqual([universities.intakeDatesPending]);
  });

  it("кыргызский: подписи строк из общего словаря", () => {
    const rows = compareRows([first, second], getPortalStrings("favorites", "ky"), getPortalStrings("universities", "ky"), "ky", NOW);
    const ky = getPortalStrings("favorites", "ky");
    expect(rows.map((row) => row.label)).toEqual([ky.compareCountry, ky.compareLevels, ky.comparePrograms, ky.compareIntake]);
    expect(rows[0].cells[1].lines[0]).toContain(ky.cityUnknown);
  });
});

describe("выбор для сравнения", () => {
  const items = [university(1), university(2), university(3)];

  it("вузы идут в порядке избранного, а не в порядке нажатий; исчезнувшие из избранного отбрасываются", () => {
    expect(selectedUniversities(items, [items[2].id, items[0].id]).map((item) => item.id)).toEqual([items[0].id, items[2].id]);
    expect(selectedUniversities(items, [items[1].id, "нет-такого"]).map((item) => item.id)).toEqual([items[1].id]);
    expect(selectedUniversities(items, [])).toEqual([]);
  });

  it("таблица от двух вузов", () => {
    expect(COMPARE_MIN).toBe(2);
  });
});

describe("сверка с веб-файлом FavoritesView.tsx", () => {
  const source = readFileSync(FAVORITES_VIEW, "utf8");

  it("те же строки в том же порядке, тот же порог и те же разделители", () => {
    const order = [...source.matchAll(/<th scope="row">\{strings\.(compare\w+)\}<\/th>/g)].map((match) => match[1]);
    expect(order).toEqual(["compareCountry", "compareLevels", "comparePrograms", "compareIntake"]);
    expect(source).toMatch(/selected\.length >= 2/);
    expect(source).toContain("` · ${strings.cityUnknown}`"); // нет города
    expect(source).toContain('{" — "}'); // программа и уровень
    expect(source).toContain('.join(", ")'); // уровни через запятую
  });
});
