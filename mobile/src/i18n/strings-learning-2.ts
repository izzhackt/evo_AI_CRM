// Строки раздела «Учёба: профессии, английский, тесты», которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `prof.*`, `eng.*`, `assess.*`. Закрывает G48-G62 аудита паритета 25.11.2026.
// Строки CSCA ведёт strings-learning.ts (другая половина среза «Учёба»).
// Новый ключ добавляется в RU и в KY сразу: тип `Learn2StringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const LEARN2_RU = {
  // Пока пусто: строки добавляет срез.
  // Тесты: окно подтверждения замены ответов (веб показывает системное `window.confirm`, у телефона своё окно с двумя кнопками).
  "assess.replaceCancel": "Отмена",
  "assess.replaceConfirm": "Заменить",
  // Тесты: упорный сбой сохранения (ревью #1559). У веба этих строк нет: у телефона есть выходы, которых защита не видит (меню ☰ и вкладки).
  "assess.unsavedNote": "Ответы ещё не сохранены, свайп назад выключен. Если выйти через меню или вкладки, сохранение остановится, и ответы могут пропасть.",
  "assess.leaveAnyway": "Выйти без сохранения",
  "assess.leaveTitle": "Выйти без сохранения?",
  "assess.leaveBody": "Ответы, которые не удалось сохранить, пропадут. Те, что сохранены раньше, останутся.",
  "assess.leaveCancel": "Остаться",
  "assess.leaveConfirm": "Выйти",
} as const;

export type Learn2StringKey = keyof typeof LEARN2_RU;

export const LEARN2_KY: Readonly<Record<Learn2StringKey, string>> = {
  // Пока пусто: см. соглашение в шапке.
  "assess.replaceCancel": "Жокко чыгаруу", // KY: needs native proofreading
  "assess.replaceConfirm": "Алмаштыруу", // KY: needs native proofreading
  "assess.unsavedNote": "Жооптор азырынча сакталган жок, артка сүрүү өчүрүлгөн. Меню же өтмөктөр аркылуу чыксаңыз, сактоо токтойт жана жооптор жоголушу мүмкүн.", // KY: needs native proofreading
  "assess.leaveAnyway": "Сактабай чыгуу", // KY: needs native proofreading
  "assess.leaveTitle": "Сактабай чыгасызбы?", // KY: needs native proofreading
  "assess.leaveBody": "Сакталбай калган жооптор жоголот. Мурда сакталгандары калат.", // KY: needs native proofreading
  "assess.leaveCancel": "Калуу", // KY: needs native proofreading
  "assess.leaveConfirm": "Чыгуу", // KY: needs native proofreading
};
