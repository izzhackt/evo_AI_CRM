// Строки раздела «Университеты», которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `uni.*`, `programs.*`. Закрывает G39-G47 аудита паритета 25.11.2026.
// Прежние ключи `uni.*` и `programs.*` пока лежат в mobile-strings.ts: переносит их сюда этот срез, это его единственная правка в том файле.
// Новый ключ добавляется в RU и в KY сразу: тип `UniversitiesStringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const UNIVERSITIES_RU = {
  // Пока пусто: строки добавляет срез.
} as const;

export type UniversitiesStringKey = keyof typeof UNIVERSITIES_RU;

export const UNIVERSITIES_KY: Readonly<Record<UniversitiesStringKey, string>> = {
  // Пока пусто: см. соглашение в шапке.
};
