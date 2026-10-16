import "server-only";

import type { ActiveStudentPortalActor } from "../student-portal-auth";
import type { PublishedUniversity, UniversityFilters, UniversityPage } from "../platform-university-catalog";
import { readStudentUniversities } from "../v3/university-source";

/** Страница `student_university_catalog`: 30 записей, следующая — offset + 30. */
const CATALOGUE_PAGE = 30;
/** Предохранитель: 12 страниц (360 записей). */
const CATALOGUE_PAGES = 12;
/** Страниц за один параллельный заход после первой. */
const CATALOGUE_BATCH = 4;

/**
 * Полный отфильтрованный набор для карты (PORT-3a): карта показывает все
 * подходящие записи, а не одну страницу списка — иначе точки зависели бы от
 * пагинации.
 *
 * Стоимость (план A, 16.10.2026): первая страница читается одна, потому что
 * отфильтрованный каталог часто умещается в 30 записей. Дальше — по четыре
 * страницы сразу, как staff-каталог (`readStaffUniversityCatalogue`).
 * При 143 опубликованных карточках это 1 + 4 запроса за два последовательных
 * шага вместо пяти. Потолок в 12 страниц (360 записей) — честный
 * предохранитель: если каталог его перерастёт, карта переходит в явное
 * состояние ошибки, а список продолжает работать (план §6: сбой карты не
 * маскируется).
 */
export async function readStudentUniversitiesComplete(
  actor: ActiveStudentPortalActor,
  filters: UniversityFilters,
): Promise<readonly PublishedUniversity[]> {
  const items: PublishedUniversity[] = [];
  const seen = new Set<string>();
  /** true — страница последняя. */
  const take = (page: UniversityPage, offset: number): boolean => {
    for (const item of page.items) {
      // Публикация между страницами может сдвинуть offset и повторить запись;
      // для карты дубль безвреден — берём первую версию.
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (page.nextOffset === null) return true;
    if (page.nextOffset !== offset + CATALOGUE_PAGE) throw new Error("Catalogue unavailable");
    return false;
  };
  if (take(await readStudentUniversities(actor, { ...filters, offset: 0 }), 0)) return items;
  for (let first = 1; first < CATALOGUE_PAGES; first += CATALOGUE_BATCH) {
    const offsets = Array.from(
      { length: Math.min(CATALOGUE_BATCH, CATALOGUE_PAGES - first) },
      (_, index) => (first + index) * CATALOGUE_PAGE,
    );
    const pages = await Promise.all(offsets.map((offset) => readStudentUniversities(actor, { ...filters, offset })));
    for (const [index, page] of pages.entries()) {
      if (take(page, offsets[index])) return items;
    }
  }
  throw new Error("Catalogue unavailable");
}
