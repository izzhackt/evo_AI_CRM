// Строки раздела «Оплата» (владелец: срез «Документы, оплата, программы»), которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `pay.*`. Закрывает G31-G34 аудита паритета 25.11.2026.
// Новый ключ добавляется в RU и в KY сразу: тип `PaymentsStringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const PAYMENTS_RU = {
  // Пока пусто: строки добавляет срез.
} as const;

export type PaymentsStringKey = keyof typeof PAYMENTS_RU;

export const PAYMENTS_KY: Readonly<Record<PaymentsStringKey, string>> = {
  // Пока пусто: см. соглашение в шапке.
};
