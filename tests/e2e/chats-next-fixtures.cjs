"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Синтетические данные для «Нового вида» чатов («WhatsApp» `/v3/inbox` и «Переписка» `/v3/messages`):
 * tests/e2e/chats-next-static-render.cjs и tests/ui-next-chats.test.mjs. Люди, номера, дела и сообщения ВЫДУМАНЫ для
 * проверки вёрстки и не являются записями EVO; настоящих номеров, ключей и сессий здесь нет.
 */
const { staffRoleKeys } = require("./staff-role-templates.cjs");

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const STUDENT = "aaaaaaaa-1111-4111-8111-000000000099";
const BASE_ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid", assignments: [], permissionKeys: [],
};
const ACTORS = {
  admin: { ...BASE_ACTOR, displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: null },
  preview: { ...BASE_ACTOR, displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: "sales" },
  sales: {
    ...BASE_ACTOR, displayName: "Менеджер продаж (синтетический)", systemRole: "staff", presentationRole: null,
    assignments: [{ label: "Sales Manager", scope: { kind: "own", key: null, resourceKind: null } }], permissionKeys: staffRoleKeys("sales-manager"),
  },
};

// --- «Переписка» (кабинет студента): «сейчас» — воскресенье 27.09.2026, 12:00 по Бишкеку ---------------------------
const READ_AT = "2026-09-27T06:00:00.000Z";
const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;
const row = (n, name, fields) => ({
  studentCaseId: caseId(n), studentDisplayName: name, lastMessageSnippet: fields.snippet ?? null,
  lastMessageAt: fields.at ?? null, lastMessageAuthorMembershipId: fields.mine ? ME : fields.at ? STUDENT : null,
  awaitState: fields.state ?? "none", unread: fields.unread ?? false,
});
const ALL_ROWS = [
  row(3, "Данияр Макетов", { state: "needs_reply", at: "2026-09-27T05:20:00.000Z", snippet: "Прислал фото аттестата, так подойдёт?", unread: true }),
  row(4, "Лейла Тестовая", { state: "needs_reply", at: "2026-09-26T13:30:00.000Z", snippet: "Когда будет готов перевод диплома?", unread: true }),
  row(5, "Алина Условная", { state: "awaiting_student", at: "2026-09-26T10:00:00.000Z", snippet: "Пришлите, пожалуйста, скан паспорта.", mine: true }),
  row(1, "Нурай Образцова", { state: "needs_reply", at: "2026-09-25T08:00:00.000Z", snippet: "Добрый день! Какие документы нужны для визы?" }),
  row(6, "Софья Эскизова", { state: "awaiting_student", at: "2026-09-24T09:00:00.000Z", snippet: "Ждём от вас подписанное заявление.", mine: true }),
  row(7, "Руслан Черновиков", { at: "2026-09-20T07:00:00.000Z", snippet: "Спасибо, всё получил." }),
  row(9, "Нурсултан Бекмурзаевич Джумабаев-Осмоналиев", { at: "2026-09-19T07:00:00.000Z", snippet: "Длинное имя проверяет обрезку строки списка и шапки переписки." }),
  row(8, "Камила Вымыслова", {}),
];
const ANSWERED_ROWS = ALL_ROWS.map((item) => item.awaitState === "needs_reply"
  ? { ...item, awaitState: "awaiting_student", lastMessageAuthorMembershipId: ME, lastMessageSnippet: "Ответили, ждём документы.", unread: false }
  : item);

function threadPage() {
  const lines = [
    [false, "2026-09-24T04:10:00.000Z", "Здравствуйте! Хочу поступать в Китай на бакалавриат, с чего начать?"],
    [true, "2026-09-24T04:40:00.000Z", "Здравствуйте! Начнём с документов: паспорт, аттестат и его перевод. Список уже в кабинете."],
    [false, "2026-09-24T09:15:00.000Z", "Паспорт загрузила, аттестат отправлю завтра."],
    [true, "2026-09-24T10:02:00.000Z", "Отлично, паспорт видим. Проверим его сегодня."],
    [false, "2026-09-25T08:00:00.000Z", "Добрый день! Какие документы нужны для визы?"],
  ];
  const messages = lines.map(([mine, at, body], index) => ({
    id: `cccccccc-9999-4999-8999-${String(index + 1).padStart(12, "0")}`, sequenceId: String(index + 1),
    authorMembershipId: mine ? ME : STUDENT, authorName: mine ? "Администратор (синтетический)" : "Нурай Образцова",
    body, createdAt: at, quotedMessageId: null, quotedPreview: null, attachmentKind: null, attachmentId: null, attachmentLabel: null,
  })).reverse();
  return { messages, cursor: "1", hasMore: false, thread: { awaitState: "needs_reply", lastMessageAt: messages[0].createdAt, lastMessageSequenceId: "5" }, readSequenceId: "5" };
}
const SNIPPETS = [
  { replySnippetId: "99999999-5555-4555-8555-000000000001", title: "Документы получены", body: "Документы получили, спасибо! Проверим в течение двух рабочих дней и напишем здесь.", audience: "admissions" },
  { replySnippetId: "99999999-5555-4555-8555-000000000002", title: "Список документов для визы", body: "Для визы нужны: паспорт, фото 3×4, письмо о зачислении и справка о здоровье.", audience: "all" },
];
const QUEUE_ROW = {
  studentCaseId: caseId(1), studentDisplayName: "Нурай Образцова", state: "active", admissionsDirection: "CN", targetCountry: null, targetDegree: "Бакалавриат",
  pipelineStage: "documents", pipelineHidden: false, nextAction: null, nextActionDueOn: null, dueBand: "no_step", admissionsVersion: "3",
  currentCuratorMembershipId: ME, currentCuratorDisplayName: "Администратор (синтетический)", isMine: true, attentionFlags: [], needsReply: true,
  overdueTaskCount: 0, documents: null, updatedAt: "2026-09-26T05:00:00.000000Z", cursor: "x",
};
const MESSAGES_SCENARIOS = {
  cabinet: { search: {}, rows: ALL_ROWS },
  thread: { search: { case: caseId(1) }, rows: ALL_ROWS },
  "thread-long-name": { search: { case: caseId(9) }, rows: ALL_ROWS },
  all: { search: { queue: "all" }, rows: ALL_ROWS },
  answered: { search: {}, rows: ANSWERED_ROWS },
  "answered-awaiting": { search: { queue: "awaiting_student" }, rows: ANSWERED_ROWS },
  failure: { search: {}, rows: ALL_ROWS, failure: "unavailable" },
  forbidden: { search: {}, rows: ALL_ROWS, failure: "forbidden" },
};

// --- «WhatsApp»: «сейчас» — 06.10.2026, 14:00 по Бишкеку ----------------------------------------------------------
const WA_READ_AT = "2026-10-06T08:00:00.000Z";
const waId = (n) => `ffffffff-6666-4666-8666-${String(n).padStart(12, "0")}`;
const WA_CONVERSATION = waId(1);
const waRow = (n, person, phone, updatedAt, waitingSince = null, awaitingReplyFor = null) => ({
  id: waId(n), person, phone, queue: "sales", status: "open", updatedAt, waitingSince, awaitingReplyFor, href: `/v3/inbox?conversation=${waId(n)}`,
});
const WA_ROWS = [
  waRow(1, "Аружан Примерова", "+996 ••• 31 07 15", "06.10 13:40", "06.10 13:40", "20 мин"),
  waRow(2, "WhatsApp", "+996 ••• 55 48 21", "06.10 12:05"),
  waRow(3, "Тимур Макетов", "+7 ••• 90 12 34", "06.10 09:12"),
  waRow(4, "Мадина Условная", "+996 ••• 20 46 64", "05.10 18:30"),
  waRow(5, "WhatsApp", "+996 ••• 90 48 21", "05.10 11:02"),
  waRow(6, "Нурсултан Бекмурзаевич Джумабаев-Осмоналиев", "+996 ••• 12 46 64", "04.10 16:45"),
  waRow(7, "Жанна Вымыслова", null, "03.10 10:20"),
];
const waMessage = (n, inbound, createdAt, body, extra = {}) => ({
  id: waId(100 + n), inbound, body, createdAt, origin: inbound ? "client" : "phone", senderName: null, senderIsViewer: false,
  ack: inbound ? null : "READ", media: [], ...extra,
});
const WA_MESSAGES = [
  waMessage(1, true, "2026-10-04T05:10:00.000Z", "Здравствуйте! Интересует бакалавриат в Малайзии.", { origin: "history" }),
  waMessage(2, false, "2026-10-04T05:24:00.000Z", "Здравствуйте! Подскажите, какую специальность рассматриваете?", { origin: "history", ack: null }),
  waMessage(3, true, "2026-10-05T04:02:00.000Z", "Компьютерные науки. Сколько стоит обучение в год?"),
  waMessage(4, false, "2026-10-05T04:15:00.000Z", "Отправил подборку из трёх вузов с ценами.", { ack: "READ" }),
  waMessage(6, true, "2026-10-06T04:12:00.000Z", "Добрый день! А можно поступить без IELTS?"),
  waMessage(7, false, "2026-10-06T04:20:00.000Z", "Да, в двух вузах из подборки есть подготовительный курс английского.", { origin: "crm", senderName: "Айгерим Синтетическая", ack: "READ" }),
  waMessage(9, true, "2026-10-06T07:40:00.000Z", "Спасибо! Жду."),
];
function waChat(overrides = {}) {
  return {
    messages: WA_MESSAGES, hasOlder: false, attempts: [], latestInboundMessageId: waId(109), replyAccess: "allowed",
    stage: { label: "Квалифицирован", phase: "sales" }, readAt: WA_READ_AT, pulse: "0000000000000001", ...overrides,
  };
}
function waView({ selected = true, chat = {}, row: index = 0, channelState = "ready", sort = "newest", rows = WA_ROWS, extra = {} } = {}) {
  return {
    conversations: rows,
    selected: selected ? {
      ...rows[index], channelState,
      canonicalContext: { leadId: "ffffffff-6666-4666-8666-000000000700", clientId: "ffffffff-6666-4666-8666-000000000701", studentCaseId: null },
      chat: waChat(chat),
    } : null,
    queueCurrentHref: "/v3/inbox", queueNewestHref: null, queueOlderHref: "/v3/inbox?before_at=x&before_id=y",
    searchQuery: null, sort, sortHrefs: { newest: "/v3/inbox", unanswered: "/v3/inbox?sort=unanswered" }, channelState, listPulse: "0000000000000002",
    ...extra,
  };
}
const WAZZUP_CHAT = {
  messages: [
    waMessage(1, true, "2026-10-06T04:12:00.000Z", "Добрый день! А можно поступить без IELTS?"),
    waMessage(2, false, "2026-10-06T04:20:00.000Z", "Да, в двух вузах из подборки есть подготовительный курс английского.", { origin: "wazzup", ack: null }),
    waMessage(3, true, "2026-10-06T07:40:00.000Z", "Спасибо! Жду список."),
  ],
  hasOlder: false, attempts: [], replyAccess: "receive_only",
};
const WA_ANSWERED_ROWS = WA_ROWS.map((item) => ({ ...item, waitingSince: null, awaitingReplyFor: null }));
const INBOX_SCENARIOS = {
  chat: { search: { conversation: WA_CONVERSATION }, inbox: waView({ chat: { replyAccess: "allowed" } }) },
  "chat-long-name": { search: { conversation: waId(6) }, inbox: waView({ row: 5 }) },
  list: { search: {}, inbox: waView({ selected: false }) },
  "list-answered": { search: {}, inbox: waView({ selected: false, rows: WA_ANSWERED_ROWS, extra: { queueOlderHref: null } }) },
  "list-unanswered": { search: { sort: "unanswered" }, inbox: waView({ selected: false, sort: "unanswered" }) },
  empty: { search: {}, inbox: waView({ selected: false, rows: [], extra: { queueOlderHref: null } }) },
  "empty-filtered": { search: { q: "Нет такого" }, inbox: waView({ selected: false, rows: [], extra: { searchQuery: "Нет такого", queueOlderHref: null } }) },
  "empty-paged": { search: { before_at: "2026-10-01T00:00:00.000Z", before_id: waId(1) }, inbox: waView({ selected: false, rows: [], extra: { queueOlderHref: null, queueNewestHref: "/v3/inbox" } }) },
  "not-connected": { search: {}, inbox: waView({ selected: false, rows: [], channelState: "not_connected", extra: { queueOlderHref: null } }) },
  "list-attention": { search: {}, inbox: waView({ selected: false, channelState: "attention" }) },
  "chat-attention": { search: { conversation: WA_CONVERSATION }, inbox: waView({ channelState: "attention", chat: { replyAccess: "attention" } }) },
  "no-client-message": { search: { conversation: waId(2) }, inbox: waView({ row: 1, chat: { messages: [waMessage(1, false, "2026-10-06T05:00:00.000Z", "Здравствуйте! Это EVO Admissions, вы оставляли заявку на сайте.")], latestInboundMessageId: null, replyAccess: "no_client_message", stage: null } }) },
  "no-permission": { search: { conversation: WA_CONVERSATION }, inbox: waView({ chat: { replyAccess: "no_permission" } }) },
  "wazzup-read-only": { search: { conversation: WA_CONVERSATION }, inbox: waView({ chat: WAZZUP_CHAT }) },
  "wazzup-attention": { search: { conversation: WA_CONVERSATION }, inbox: waView({ channelState: "attention", chat: WAZZUP_CHAT }) },
};

module.exports = {
  ORG, ME, ACTORS, READ_AT, ALL_ROWS, ANSWERED_ROWS, caseId, threadPage, SNIPPETS, QUEUE_ROW, MESSAGES_SCENARIOS,
  WA_READ_AT, WA_CONVERSATION, waId, WA_ROWS, waView, INBOX_SCENARIOS, WAZZUP_CHAT,
};
