// Строки среза «Входящие» (M3), которых нет в общих словарях веба (messages, admission).
// Файл ведёт срез «Главная, входящие, оболочка» (владелец: docs/mobile/PLAN.md, «Волна 0 паритета»), префикс `inbox.`.
// Закрывает G25-G28 аудита паритета 25.11.2026.
// KY: needs native proofreading.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const INBOX_RU = {
  "inbox.sendLabel": "Отправить сообщение",
  "inbox.failedLabel": "Не отправлено",
  "inbox.discard": "Удалить",
  // «Прежние вопросы куратору и ответы» под списком «Входящих» (веб CaseHelpPanel/CaseHelpWorkspace, `student`).
  "inbox.helpFootTitle": "Прежние вопросы куратору и ответы",
  "inbox.helpFootFailedTitle": "Помощь по делу",
  "inbox.helpFootFailed": "Обращения пока недоступны. Потяните вниз, чтобы повторить чтение.",
  "inbox.helpAwaiting": "Ожидает ответа",
  "inbox.helpAnswered": "Ответ получен",
  "inbox.helpEmpty": "Обращений пока нет.",
  "inbox.helpOlder": "Более ранние обращения",
  "inbox.helpLatest": "Последние обращения",
  "inbox.helpOlderError": "Не удалось прочитать обращения. Проверьте доступ и повторите.",
} as const;

export type InboxStringKey = keyof typeof INBOX_RU;

export const INBOX_KY: Readonly<Record<InboxStringKey, string>> = {
  "inbox.sendLabel": "Билдирүү жөнөтүү",
  "inbox.failedLabel": "Жөнөтүлгөн жок",
  "inbox.discard": "Өчүрүү",
  "inbox.helpFootTitle": "Куратордон мурунку суроолор жана жооптор", // KY: needs native proofreading
  "inbox.helpFootFailedTitle": "Иш боюнча жардам", // KY: needs native proofreading
  "inbox.helpFootFailed": "Кайрылуулар азырынча жеткиликсиз. Кайра окуу үчүн экранды ылдый тартыңыз.", // KY: needs native proofreading
  "inbox.helpAwaiting": "Жооп күтүлүүдө", // KY: needs native proofreading
  "inbox.helpAnswered": "Жооп алынды", // KY: needs native proofreading
  "inbox.helpEmpty": "Кайрылуулар азырынча жок.", // KY: needs native proofreading
  "inbox.helpOlder": "Мурунку кайрылуулар", // KY: needs native proofreading
  "inbox.helpLatest": "Акыркы кайрылуулар", // KY: needs native proofreading
  "inbox.helpOlderError": "Кайрылуулар окулган жок. Мүмкүнчүлүктү текшерип, кайра аракет кылыңыз.", // KY: needs native proofreading
};
