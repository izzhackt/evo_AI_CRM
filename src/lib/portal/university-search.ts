/**
 * Поиск по названию вуза (S3, план 7.3). Отдельный файл без зависимостей:
 * его выполняет браузер на первом экране «Университетов», и в клиентскую
 * сборку не попадают разборщики и библиотека фото.
 */
/**
 * Нормализация для поиска по названию: без регистра и диакритики, единый
 * апостроф. «Bogazici» находит «Boğaziçi», «Xi'an» находит «Xi’an».
 */
export function normalizeUniversitySearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ı/gu, "i")
    .replace(/ł/gu, "l")
    .replace(/[øœ]/gu, "o")
    .replace(/ß/gu, "ss")
    .replace(/[’‘ʼ`´]/gu, "'")
    .replace(/[^\p{L}\p{N}'&]+/gu, " ")
    .trim();
}

/** Все слова запроса есть в тексте (без регистра и диакритики); пустой запрос ничего не находит. */
export function matchesSearch(haystack: string, query: string): boolean {
  const words = normalizeUniversitySearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const text = normalizeUniversitySearch(haystack);
  return words.every((word) => text.includes(word));
}

/**
 * Вузы, в названии которых (или в `search`: город, страна) есть все слова
 * запроса; порядок индекса сохраняется.
 */
export function searchUniversities<T extends Readonly<{ name: string; search?: string }>>(items: readonly T[], query: string): readonly T[] {
  return items.filter((item) => matchesSearch(item.search ? `${item.name} ${item.search}` : item.name, query));
}

/**
 * Программы на карточке вуза у сотрудника: все слова запроса есть в названии или в описании; порядок сохраняется. Названия
 * программ английские, описания русские — по одному названию «компьютер» и «магистратура» не находили ничего.
 */
export function searchPrograms<T extends Readonly<{ title: string; summary: string }>>(items: readonly T[], query: string): readonly T[] {
  return items.filter((item) => matchesSearch(`${item.title} ${item.summary}`, query));
}
