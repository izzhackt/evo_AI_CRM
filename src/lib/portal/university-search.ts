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

/** Вузы, в названии которых есть все слова запроса (порядок индекса сохраняется). */
export function searchUniversities<T extends Readonly<{ name: string }>>(items: readonly T[], query: string): readonly T[] {
  const words = normalizeUniversitySearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const name = normalizeUniversitySearch(item.name);
    return words.every((word) => name.includes(word));
  });
}
