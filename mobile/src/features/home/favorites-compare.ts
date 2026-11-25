// «Всё избранное» на «Главной»: модель карточек и таблица сравнения. Источник правил - веб `FavoritesView.tsx` (раздел
// «Сравнение»: страна и город, уровни, программы, ближайший набор) и `publishedTileModel` (карточка избранного, веб
// `university-tiles.ts`). Файлы веба нельзя импортировать (клиентский компонент, `server-only`), поэтому копия
// здесь, а совпадение держит тест `favorites-compare.test.ts`.
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import type { PortalStrings } from "@web/lib/portal/i18n";
import { universityCountryLabel, universityLevelKey, universityLevels } from "@web/lib/portal/universities";

import { nearestIntakeText } from "@/features/home/HomeCards";
import type { TileModel } from "@/features/universities/model";

type Lang = "ru" | "ky";

/** Карточка избранного вуза для общей плитки каталога (веб `publishedTileModel`): место, уровни, ближайший набор. */
export function publishedTile(item: PublishedUniversity, strings: PortalStrings<"universities">, lang: Lang, now: Date): TileModel {
  const content = item.content;
  const country = universityCountryLabel(content.country, lang);
  return {
    id: item.id,
    name: content.name,
    place: content.city ? `${content.city} · ${country}` : country,
    levels: universityLevels(content).map((level) => strings[universityLevelKey(level)]),
    // Нет открытого набора - «Даты уточняются у источника»: у плитки каталога строка есть всегда (веб `intakeText`).
    intake: nearestIntakeText(item, lang, now, strings),
    photoKey: content.photoKey,
  };
}

export type CompareRowKey = "country" | "levels" | "programs" | "intake";

/** Ячейка таблицы: текст или список строк (программы). */
export type CompareCell = Readonly<{ id: string; name: string; lines: readonly string[] }>;

export type CompareRow = Readonly<{ key: CompareRowKey; label: string; cells: readonly CompareCell[] }>;

/**
 * Таблица сравнения выбранных вузов (веб `CompareTable`): колонки - вузы в порядке избранного, строки - свойства.
 * «Страна и город»: «Малайзия · Куала-Лумпур» или «Малайзия · Город не указан»; «Уровни» - через запятую; «Программы» -
 * «название — уровень» по одной на строку; «Ближайший набор» - срок подачи или старт, без набора - «Даты уточняются».
 */
export function compareRows(
  selected: readonly PublishedUniversity[],
  favorites: PortalStrings<"favorites">,
  universities: PortalStrings<"universities">,
  lang: Lang,
  now: Date,
): readonly CompareRow[] {
  const row = (key: CompareRowKey, label: string, lines: (item: PublishedUniversity) => readonly string[]): CompareRow => ({
    key,
    label,
    cells: selected.map((item) => ({ id: item.id, name: item.content.name, lines: lines(item) })),
  });
  return [
    row("country", favorites.compareCountry, (item) => [
      `${universityCountryLabel(item.content.country, lang)}${item.content.city ? ` · ${item.content.city}` : ` · ${favorites.cityUnknown}`}`,
    ]),
    row("levels", favorites.compareLevels, (item) => [
      universityLevels(item.content)
        .map((level) => universities[universityLevelKey(level)])
        .join(", "),
    ]),
    row("programs", favorites.comparePrograms, (item) =>
      item.content.programs.map((program) => `${program.title} — ${universities[universityLevelKey(program.level)]}`),
    ),
    row("intake", favorites.compareIntake, (item) => [nearestIntakeText(item, lang, now, universities)]),
  ];
}

/**
 * Выбранные для сравнения: вузы избранного в их порядке, а не в порядке нажатий. Запись могла уйти из избранного после
 * обновления - выбор не держит исчезнувшие карточки (веб `FavoritesView`: `items.filter(selectedIds.includes)`).
 */
export function selectedUniversities(items: readonly PublishedUniversity[], selectedIds: readonly string[]): readonly PublishedUniversity[] {
  return items.filter((item) => selectedIds.includes(item.id));
}

/** Таблица появляется, когда отмечено не меньше двух вузов (веб: `selected.length >= 2`). */
export const COMPARE_MIN = 2;
