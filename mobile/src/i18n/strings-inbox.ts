// Строки среза «Входящие» (M3), которых нет в общих словарях веба (messages, admission).
// KY: needs native proofreading.

export const INBOX_RU = {
  "inbox.listTitle": "Входящие",
  "inbox.back": "Все чаты",
  "inbox.unreadBadge": "Новых: {count}",
  "inbox.chatUnread": "Есть непрочитанные сообщения",
  "inbox.sendLabel": "Отправить сообщение",
  "inbox.failedLabel": "Не отправлено",
  "inbox.discard": "Удалить",
  "inbox.limitLeft": "Осталось символов: {count}",
  "inbox.today": "Сегодня",
  "inbox.you": "Вы",
  "inbox.markReadHint": "Нажмите, чтобы отметить прочитанным.",
  "inbox.openTarget": "Открыть",
} as const;

export type InboxStringKey = keyof typeof INBOX_RU;

export const INBOX_KY: Readonly<Record<InboxStringKey, string>> = {
  "inbox.listTitle": "Келген каттар",
  "inbox.back": "Бардык маектер",
  "inbox.unreadBadge": "Жаңы: {count}",
  "inbox.chatUnread": "Окула элек билдирүүлөр бар",
  "inbox.sendLabel": "Билдирүү жөнөтүү",
  "inbox.failedLabel": "Жөнөтүлгөн жок",
  "inbox.discard": "Өчүрүү",
  "inbox.limitLeft": "Калган белгилер: {count}",
  "inbox.today": "Бүгүн",
  "inbox.you": "Сиз",
  "inbox.markReadHint": "Окулду деп белгилөө үчүн басыңыз.",
  "inbox.openTarget": "Ачуу",
};
