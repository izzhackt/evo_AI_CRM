// Строки раздела «Требования и документы программы» (владелец: срез «Документы, оплата, программы»), которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `prep.*`. Закрывает G35-G38 аудита паритета 25.11.2026.
// Новый ключ добавляется в RU и в KY сразу: тип `PreparationsStringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const PREPARATIONS_RU = {
  // Пока пусто: строки добавляет срез.
} as const;

export type PreparationsStringKey = keyof typeof PREPARATIONS_RU;

export const PREPARATIONS_KY: Readonly<Record<PreparationsStringKey, string>> = {
  // Пока пусто: см. соглашение в шапке.
};
