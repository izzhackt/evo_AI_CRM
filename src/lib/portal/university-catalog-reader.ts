import "server-only";

import type { ActiveStudentPortalActor } from "../student-portal-auth";
import type { PublishedUniversity, UniversityFilters } from "../platform-university-catalog";
import { readStudentUniversities } from "../v3/university-source";

/**
 * Полный отфильтрованный набор для карты (PORT-3a): карта показывает все
 * подходящие записи, а не одну страницу списка — иначе точки зависели бы от
 * пагинации.
 *
 * Стоимость: `student_university_catalog` отдаёт страницы по 30 записей;
 * при сегодняшних 143 опубликованных карточках это максимум 5
 * последовательных RPC-вызовов на открытие карты. Потолок в 12 страниц
 * (360 записей) — честный предохранитель: если каталог его перерастёт,
 * карта переходит в явное состояние ошибки, а список продолжает работать
 * (план §6: сбой карты не маскируется).
 */
export async function readStudentUniversitiesComplete(
  actor: ActiveStudentPortalActor,
  filters: UniversityFilters,
): Promise<readonly PublishedUniversity[]> {
  const items: PublishedUniversity[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let page = 0; page < 12; page++) {
    const result = await readStudentUniversities(actor, { ...filters, offset });
    for (const item of result.items) {
      // Публикация между страницами может сдвинуть offset и повторить запись;
      // для карты дубль безвреден — берём первую версию.
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (result.nextOffset === null) return items;
    if (result.nextOffset <= offset) throw new Error("Catalogue unavailable");
    offset = result.nextOffset;
  }
  throw new Error("Catalogue unavailable");
}
