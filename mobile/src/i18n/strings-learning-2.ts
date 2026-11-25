// Строки раздела «Учёба: профессии, английский, тесты», которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `prof.*`, `eng.*`, `assess.*`. Закрывает G48-G62 аудита паритета 25.11.2026.
// Строки CSCA ведёт strings-learning.ts (другая половина среза «Учёба»).
// Новый ключ добавляется в RU и в KY сразу: тип `Learn2StringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const LEARN2_RU = {
  // Пока пусто: строки добавляет срез.
} as const;

export type Learn2StringKey = keyof typeof LEARN2_RU;

export const LEARN2_KY: Readonly<Record<Learn2StringKey, string>> = {
  // Пока пусто: см. соглашение в шапке.
};
