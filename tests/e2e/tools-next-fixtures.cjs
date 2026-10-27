"use strict";

/**
 * Синтетические данные «Нового вида» потока «tools» (Календарь, Документы, Шаблоны ответов, База знаний, Командный чат):
 * люди, задачи, файлы, материалы и сообщения ВЫДУМАНЫ для проверки вёрстки и не являются записями EVO. Файл читают
 * `tools-next-static-render.cjs` (Chromium) и `tools-next-pages.cjs` (настоящие страницы на Node).
 */

const id = (head, n) => `${head}-2222-4222-8222-${String(n).padStart(12, "0")}`;
const uuid = (n) => id("cccccccc", n);

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const B = "aaaaaaaa-1111-4111-8111-000000000002";
const C = "aaaaaaaa-1111-4111-8111-000000000003";
const NAMES = { [ME]: "Администратор (синтетический)", [B]: "Айгерим Макетова", [C]: "Тимур Образцов" };
const NOW = "2026-09-24T04:00:00.000Z";
const TODAY = "2026-09-24";

const actorOf = (fields) => ({
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid",
  assignments: [], permissionKeys: [], displayName: NAMES[ME], systemRole: "admin", presentationRole: null, ...fields,
});
const ADMIN = actorOf({});
const STAFF = actorOf({ systemRole: "staff", displayName: "Сотрудник (синтетический)" });
const PREVIEW = actorOf({ presentationRole: "sales" });
const PARTICIPANTS = [ME, B, C].map((membershipId) => ({ membershipId, displayName: NAMES[membershipId], role: null }));

/* ------------------------------------------------------------------ календарь */

const caseTask = (n, fields) => ({
  kind: "case", key: `case:${id("cccccccc", 40 + n)}`, id: id("cccccccc", 40 + n), studentCaseId: id("dddddddd", 40 + n), taskType: "follow_up",
  title: fields.title, details: fields.details ?? null, dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, day: fields.day ?? null,
  minutes: fields.minutes ?? null, overdue: fields.overdue ?? false, state: fields.state ?? "open", cancelReason: null, person: fields.person ?? null,
  priority: "normal", studentVisible: false, assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: NAMES[fields.assignee ?? ME],
  caseState: "active", version: "2",
});
const staffTask = (n, fields) => ({
  kind: "staff", key: `staff:${id("ffffffff", 40 + n)}`, id: id("ffffffff", 40 + n), title: fields.title, details: fields.details ?? null,
  dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, day: fields.day ?? null, minutes: fields.minutes ?? null, overdue: false,
  state: fields.state ?? "open", cancelReason: null, person: null, priority: "normal", assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], version: "3",
});
const WEEK = [
  caseTask(1, { title: "Записать на визу X1", person: "Мээрим Жолдошева", dueAt: "2026-09-24T08:30:00.000Z", day: "2026-09-24", minutes: 870, details: "Подтвердить время в консульстве и предупредить семью." }),
  caseTask(2, { title: "Собрать апостиль на аттестат", person: "Айдана Сыдыкова", dueOn: "2026-09-25", day: "2026-09-25" }),
  caseTask(3, { title: "Согласовать список программ", person: "Тимур Абдылдаев", dueAt: "2026-09-22T05:00:00.000Z", day: "2026-09-22", minutes: 660, overdue: true }),
  staffTask(1, { title: "Подготовить вопросы к планёрке", dueAt: "2026-09-24T05:00:00.000Z", day: "2026-09-24", minutes: 660 }),
  staffTask(2, { title: "Обновить памятку по нострификации", dueOn: "2026-09-26", day: "2026-09-26" }),
  caseTask(4, { title: "Уточнить у семьи список документов", person: "Асель Бакирова" }),
  caseTask(5, { title: "Проверить перевод аттестата", person: "Данияр Мамытов" }),
  caseTask(6, { title: "Позвонить после консультации", person: "Камила Усенова", state: "done" }),
];
const MONTH_EXTRA = ["Перевести паспорт", "Заверить у нотариуса", "Отправить пакет партнёру", "Собрать справку об оплате"].map((title, index) =>
  caseTask(12 + index, { title, person: "Санжар Алиев", dueAt: `2026-09-15T0${3 + index}:00:00.000Z`, day: "2026-09-15", minutes: 540 + index * 60 }));
const CASE_OPTIONS = [["Айдана Сыдыкова", 1], ["Тимур Абдылдаев", 2], ["Мээрим Жолдошева", 3]].map(([name, n]) => ({ id: id("dddddddd", 40 + n), name }));

/* ------------------------------------------------------------ шаблоны ответов */

const snippet = (n, audience, title, body, extra = {}) => ({
  snippet: {
    replySnippetId: id("99999999", n), audience, title, body, version: "2", createdByMembershipId: extra.author ?? B,
    createdByDisplayName: NAMES[extra.author ?? B], createdAt: "2026-09-10T05:00:00.000Z", updatedAt: "2026-09-12T05:00:00.000Z",
  },
  canMutate: extra.canMutate ?? true, updateRequestId: id("88888888", n), archiveRequestId: id("77777777", n),
});
const SNIPPETS = [
  snippet(1, "sales", "Первый ответ на заявку", "Здравствуйте! Спасибо за обращение в EVO Admissions. Подскажите, пожалуйста, в какую страну и на какую программу вы хотите поступать? Мы подберём варианты и расскажем про сроки подачи."),
  snippet(2, "all", "Документы для визы X1", "Для визы X1 понадобятся: загранпаспорт, приглашение от вуза, справка об оплате, медицинская справка и фото 3×4. Список с примерами пришлю отдельным сообщением."),
  snippet(3, "admissions", "Напоминание о сроке подачи", "Напоминаем: срок подачи документов в выбранный вуз — через неделю. Если нужна помощь с переводом, напишите нам сегодня.", { author: C }),
  snippet(4, "sales", "Стоимость обучения — общий ответ", "Стоимость зависит от вуза и программы: в Китае от 2 500 до 4 500 долларов в год, в Малайзии — от 4 000. Точную цифру назовём после выбора программы.", { canMutate: false, author: C }),
];

/** Двенадцать шаблонов: двенадцатый не попадает на первую страницу таблицы (по 10 строк) — на нём проверяется ссылка `#reply-snippet-<id>`. */
const SNIPPETS_MANY = [
  ...SNIPPETS,
  ...["Приглашение на консультацию", "Как оплатить обучение", "Сроки рассмотрения заявки", "Список документов для поступления", "Перенос консультации", "Напоминание о договоре", "Что делать после оплаты", "Итоговое напоминание о подписании"]
    .map((title, index) => snippet(5 + index, ["sales", "admissions", "all"][index % 3], title, `Синтетический текст шаблона «${title}».`)),
];

/* ------------------------------------------------------------------ документы */

const folder = (key, name, parentId, kind = "company", number = 0) => ({
  id: key, name, parentId, kind, version: kind === "company" ? "2" : null,
  renameRequestId: kind === "company" ? id("10000000", number) : null, moveRequestId: kind === "company" ? id("20000000", number) : null,
  archiveRequestId: kind === "company" ? id("30000000", number) : null,
});
const FOLDERS = [
  folder("company", "Компания", null, "company-root"),
  folder(id("60000000", 1), "Бланки договоров", "company", "company", 1),
  folder(id("60000000", 2), "Презентации для партнёров", "company", "company", 2),
  folder(id("60000000", 3), "Договоры 2026", id("60000000", 1), "company", 3),
  folder("students", "Студенты", null, "students"),
  folder("student-" + id("dddddddd", 41), "Айдана Сыдыкова", "students", "student"),
  folder("student-" + id("dddddddd", 42), "Тимур Абдылдаев", "students", "student"),
];
const file = (n, folderId, name, size, kind = "company") => ({
  id: id("50000000", n), folderId, name, addedAt: "18.09", size, kind, version: kind === "company" ? "1" : null, currentVersionId: id("55555555", n),
  downloadHref: `/api/v3/company-file-versions/${id("55555555", n)}/download`,
  renameRequestId: kind === "company" ? id("41000000", n) : null, moveRequestId: kind === "company" ? id("42000000", n) : null,
  archiveRequestId: kind === "company" ? id("43000000", n) : null, uploadRequestId: kind === "company" ? id("44000000", n) : null,
});
const FILES = [
  file(1, "company", "Устав и реквизиты.pdf", "1,2 МБ"),
  file(2, id("60000000", 1), "Договор — образец.pdf", "240 КБ"),
  file(3, id("60000000", 1), "Дополнительное соглашение о сроках оплаты и условиях возврата.docx", "88 КБ"),
  file(4, id("60000000", 3), "Договор Сыдыкова А.pdf", "310 КБ"),
  file(5, id("60000000", 2), "Презентация Китай 2026.pptx", "6,4 МБ"),
  file(6, "student-" + id("dddddddd", 41), "Аттестат — скан.pdf", "2,1 МБ", "student"),
  file(7, "student-" + id("dddddddd", 41), "Паспорт — перевод.pdf", "1,4 МБ", "student"),
];

/* ------------------------------------------------------------------ чат */

const messageId = (sequence) => `cccccccc-9999-4999-8999-${String(sequence).padStart(12, "0")}`;
function message(sequence, author, createdAt, body, extra = {}) {
  const deleted = Boolean(extra.deleted);
  return {
    id: messageId(sequence), channelKey: extra.channel ?? "general", sequence: String(sequence), authorMembershipId: author, authorName: NAMES[author],
    body: deleted ? "" : body, parentMessageId: extra.root ? messageId(extra.root) : null,
    quoteMessageId: extra.quote ? messageId(extra.quote) : extra.root ? messageId(extra.root) : null,
    mentionedMembershipIds: deleted ? [] : extra.mentions ?? [], version: deleted || extra.edited ? "2" : "1", createdAt,
    editedAt: extra.edited && !deleted ? extra.edited : null, deletedAt: deleted ? "2026-09-28T01:00:00.000Z" : null, replyCount: extra.replies ?? 0,
  };
}
const quoteOf = (row) => ({
  id: row.id, sequence: row.sequence, authorMembershipId: row.authorMembershipId, authorName: row.authorName, version: row.version,
  deletedAt: row.deletedAt, bodyPreview: row.deletedAt ? "" : Array.from(row.body).slice(0, 240).join(""),
});
function chatPage(messages) {
  const byId = new Map(messages.map((row) => [row.id, row]));
  const quotes = [...new Set(messages.map((row) => row.quoteMessageId).filter(Boolean))].map((key) => quoteOf(byId.get(key)));
  return {
    schemaVersion: 2, messages, quotes, beforeCursor: messages[0]?.sequence ?? "0", afterCursor: messages.at(-1)?.sequence ?? "0",
    hasBefore: false, hasAfter: false, watermark: "40", latestMessageId: messages.at(-1)?.id ?? null, focusMessageId: null,
  };
}
const micro = (value) => value.replace(/\.(\d{3})Z$/u, ".$1000Z");
function channel(key, latest, { unread = 0, firstUnread = null } = {}) {
  return {
    key, muted: false, preferenceVersion: "1", readSequence: "0", unreadCount: unread, firstUnreadId: firstUnread,
    latestPreview: latest ? {
      id: latest.id, sequence: latest.sequence, version: latest.version, authorMembershipId: latest.authorMembershipId, authorName: latest.authorName,
      bodyPreview: latest.deletedAt ? "" : Array.from(latest.body).slice(0, 240).join(""), deletedAt: latest.deletedAt,
    } : null,
    latestPreviewCreatedAt: latest ? micro(latest.createdAt) : null,
  };
}
const CONVERSATION = [
  message(11, B, "2026-09-26T03:10:00.000Z", "Доброе утро! Кто сегодня принимает звонки по Китаю?", { replies: 1 }),
  message(12, B, "2026-09-26T03:12:00.000Z", "Нужен человек до обеда: в 11:00 созвон с родителями студентки."),
  message(13, ME, "2026-09-26T03:20:00.000Z", "Я возьму. Список документов для визы уже в папке дела.", { root: 11 }),
  message(14, C, "2026-09-26T04:05:00.000Z", "", { deleted: true }),
  message(16, C, "2026-09-26T04:30:00.000Z", "Обновил прайс на перевод документов: https://example.invalid/price"),
  message(19, C, "2026-09-28T04:40:00.000Z", "Коллеги, в пятницу обучение по новой форме анкеты. Время подтвержу до среды.", { mentions: [ME] }),
  message(20, B, "2026-09-28T05:02:00.000Z", "Спасибо, буду."),
];
const SALES_LATEST = message(30, C, "2026-09-28T05:40:00.000Z", "Лид из Instagram просит перезвонить после 18:00.", { channel: "sales" });
const ADMISSIONS_LATEST = message(31, B, "2026-09-28T05:45:00.000Z", "Пакет документов для Шанхая собран, проверьте, пожалуйста.", { channel: "admissions" });
const CHAT = {
  messages: CONVERSATION, page: chatPage(CONVERSATION), participants: PARTICIPANTS.map((row) => ({ ...row, role: null })),
  channels: [
    channel("general", CONVERSATION.at(-1)),
    channel("sales", SALES_LATEST, { unread: 3, firstUnread: SALES_LATEST.id }),
    channel("admissions", ADMISSIONS_LATEST, { unread: 12, firstUnread: ADMISSIONS_LATEST.id }),
  ],
};

/* ------------------------------------------------------------- база знаний */

/** Материалы «Базы знаний»: ключи папок (`F.bjdocs`) называет адрес сценария (`folder=@bjdocs`). */
function knowledgeFixture() {
  let serial = 0;
  const at = (month, day, hour = 10) => new Date(Date.UTC(2026, month - 1, day, hour - 6, 5)).toISOString();
  const node = (area, parent, kind, title, extra = {}) => {
    serial += 1;
    return {
      id: extra.id ?? uuid(1000 + serial), organization_id: ORG, area, parent_id: parent, kind, title, description: "", client_case_id: null,
      blob_id: kind === "file" ? uuid(9000 + serial) : null, source_blob_id: null, mime_type: kind === "file" ? "application/pdf" : kind === "page" ? "text/markdown" : "",
      source_key: null, review_question: "", version: 3, archived_at: null, deleted_at: null, created_at: at(9, 1),
      updated_at: extra.updated_at ?? at(9, 20 - (serial % 9), 9 + (serial % 8)), updated_by: ME, ...extra,
    };
  };
  const F = {};
  const folders = [];
  const addFolder = (key, area, parentKey, title) => { const item = node(area, parentKey ? F[parentKey].id : null, "folder", title); F[key] = item; folders.push(item); return item; };
  addFolder("countries", "internal", null, "Страны и направления");
  addFolder("china", "internal", "countries", "Китай");
  addFolder("unis", "internal", "china", "Университеты-партнёры");
  addFolder("beijing", "internal", "unis", "Пекин");
  addFolder("bjdocs", "internal", "beijing", "Документы для подачи");
  addFolder("shanghai", "internal", "unis", "Шанхай");
  addFolder("visa", "internal", "china", "Виза X1 и X2");
  addFolder("malaysia", "internal", "countries", "Малайзия");
  addFolder("process", "internal", null, "Процессы отдела поступления");
  addFolder("templates", "internal", null, "Шаблоны писем и ответов");
  addFolder("rawmail", "raw", null, "Почта 2025");
  addFolder("clientsroot", "clients", null, "Клиенты 2026");
  addFolder("secretsvps", "secrets", null, "Серверы");
  const items = [];
  const add = (area, parentKey, kind, title, extra) => { const item = node(area, parentKey ? F[parentKey].id : null, kind, title, extra); items.push(item); return item; };
  add("internal", "bjdocs", "page", "Чек-лист документов: бакалавриат", { review_question: "Нужен ли апостиль на аттестат для 2027?" });
  add("internal", "bjdocs", "page", "Порядок подготовки и заверения пакета документов для магистратуры в Китае: перевод, нотариальное заверение и легализация в консульстве");
  add("internal", "bjdocs", "file", "Анкета университета — образец.pdf");
  add("internal", "bjdocs", "file", "Требования к фото.pdf", { updated_at: new Date(Date.UTC(2025, 11, 3, 4)).toISOString() });
  const editor = add("internal", "bjdocs", "page", "Как готовить мотивационное письмо", {
    body: "## Структура\n\nПисьмо — одна страница: кто вы, почему этот вуз и эта программа.\n\n- Начало — конкретный случай.\n- Конец — план на учёбу.",
  });
  add("internal", null, "page", "Новые правила визы", { review_question: "Кто ответственный за партнёра?" });
  add("internal", null, "file", "Прайс вуза 2026.xlsx");
  add("clients", "clientsroot", "folder", "Материалы без дела");
  add("secrets", "secretsvps", "secret", "Панель хостинга");
  return { folders, items, aliases: Object.fromEntries(Object.entries(F).map(([key, value]) => [key, value.id])), editor: editor.id };
}

module.exports = {
  id, uuid, ORG, ME, B, C, NAMES, NOW, TODAY, ADMIN, STAFF, PREVIEW, PARTICIPANTS,
  WEEK, MONTH_EXTRA, CASE_OPTIONS, SNIPPETS, SNIPPETS_MANY, FOLDERS, FILES, CHAT, messageId, knowledgeFixture,
};
