// Строки раздела «Запись на консультацию» (владелец: срез «Аккаунт и приложение целиком»), которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `consult.*`. Закрывает G14 аудита паритета 25.11.2026.
// Новый ключ добавляется в RU и в KY сразу: тип `ConsultationStringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const CONSULTATION_RU = {
  // Пока пусто: строки добавляет срез.
} as const;

export type ConsultationStringKey = keyof typeof CONSULTATION_RU;

export const CONSULTATION_KY: Readonly<Record<ConsultationStringKey, string>> = {
  // Пока пусто: см. соглашение в шапке.
};
