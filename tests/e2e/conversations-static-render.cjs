"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в shell-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Переписки: «Переписка» (`/v3/messages`, пункт «Поступления»; до решения
 * владельца 28.09.2026 — «Переписка со студентами») и WhatsApp (`/v3/inbox`,
 * пункт «Продаж») — две отдельные страницы по решению владельца 27.09.2026
 * вместо одного пункта «Переписки» с каналами (Э5). «Переписка» сохраняет
 * всё Э5: очереди с числами, шапку переписки с видимым переключателем
 * состояния, шаблоны ответа в поле ответа и следующую переписку в пустой
 * правой части; WhatsApp — честное «не подключён».
 *
 * Страницы строят НАСТОЯЩИЕ `v3/messages/page.tsx` и `v3/inbox/page.tsx`:
 * их чтения подменены синтетическими (актёр, чтение очередей 234 — через
 * настоящий `readCaseChatQueueWith`, страница переписки, строка очереди 241,
 * шаблоны, WhatsApp «не подключён»). Оболочка (`AppShell`) и рабочая часть
 * «Кабинета студента» (`CaseChatWorkspace`) рендерятся на сервере и
 * гидратируются в браузере настоящими клиентскими компонентами (бандл
 * esbuild); серверные действия отвечают той же синтетикой, запись честно
 * недоступна. Люди, дела, переписки и шаблоны ВЫДУМАНЫ для проверки вёрстки
 * и не являются записями EVO. Живой Supabase, права сервера и маршрутизатор
 * Next.js этот рендер не проверяет.
 *
 *   node tests/e2e/conversations-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — статическая разметка страниц
 *       (для tests/v3-conversations.test.mjs).
 *   node tests/e2e/conversations-static-render.cjs --screenshots [outDir] [--prefix=split]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844: список со
 *       следующей перепиской, переписка с переключателем, открытый выбор
 *       шаблона (кнопкой и «/»), смена состояния с перечитанным списком,
 *       меню сообщения, «Все ответы даны», WhatsApp у Admin, у продаж и у
 *       куратора (пункт WhatsApp есть и у ролей поступления, решение 06.10.2026,
 *       правило 27.09 снято); у каждой страницы свой h1 и свой пункт
 *       меню, вкладок каналов нет, заголовки обеих страниц — на одной высоте.
 *       По умолчанию outDir — .impeccable/review (не коммитится); файлы
 *       `e5-*.png` (`--prefix=` меняет начало имени). Проверки печатаются
 *       JSON-строками; при нарушении — код выхода 1.
 *   node tests/e2e/conversations-static-render.cjs --whatsapp-chat [outDir]
 *     → «Продажи → WhatsApp» как чат (решение владельца 06.10.2026, миграция
 *       266): настоящая страница `v3/inbox/page.tsx` с синтетическим чтением,
 *       гидратированная клиентским чатом. Снимки 1440×900 и 390×844: лента со
 *       всеми происхождениями (клиент, из CRM, с телефона, история), разделители
 *       дней, состояния отправок (неизвестен — «Проверить»; не найдено после
 *       проверки через 5 мин — «Проверить» и «Вернуть текст в поле»; отклонено;
 *       не ушло — отправка прервалась), окно шаблонов, «Отправляется…» и «Связь
 *       прервалась», чат без сообщений клиента, только чтение, список и
 *       телефон. Тёмной темы у
 *       хоста сотрудников нет (решение владельца 02.10.2026, layout.tsx).
 *       Серверные действия и опрос отвечают синтетикой этой вкладки: ничего не
 *       отправляется. По умолчанию outDir —
 *       docs/design/evo-platform/implementation-screenshots/whatsapp-chat.
 *   node tests/e2e/conversations-static-render.cjs --ai-agent [outDir]
 *     → «ИИ-агент» P1 (план ИИ-агента §12): окно ИИ в настоящем чате
 *       WhatsApp — капсула, поток «Ищу → Пишу → Ответ готов», источники и
 *       номера, «Почему такой ответ», вставка в поле без отправки, 409 «ответ
 *       устарел», Esc, перетаскивание мышью и Home, честные состояния (не
 *       подключён, нет согласия, недоступен, баланс Gemini, лимит, без
 *       источников, ждём клиента) — и раздел «ИИ-агент» (материалы, правила,
 *       расходы, согласие администратора). 1440×900 и 390×844, синтетика.
 *       По умолчанию outDir —
 *       docs/design/evo-platform/implementation-screenshots/ai-agent.
 *   node tests/e2e/conversations-static-render.cjs --ai-agent-p3 [outDir]
 *     → «ИИ-агент» P3 (план §9): «Что ИИ знает о клиенте» в окне ИИ —
 *       свёрнуто, раскрыто (шесть строк сводки, «Показать всё»), «Забыть
 *       сводку» с подтверждением, выключена (с согласием и без), на паузе
 *       без согласия, короткая переписка, 21–25 сообщений (сводка рано),
 *       сводку пора собрать, сбой и «Повторить», окончательный отказ — и
 *       «Память о клиенте» в «Агенте и лимите» (выключена, включена с
 *       подтверждением выключения, без согласия; переключение туда и
 *       обратно — итог и фокус переживают смену вида; отзыв согласия при
 *       включённой памяти — последствия до кнопки). 1440×900 и 390×844,
 *       синтетика. По умолчанию outDir —
 *       docs/design/evo-platform/implementation-screenshots/ai-agent-p3.
 *   node tests/e2e/conversations-static-render.cjs --ai-agent-p4 [outDir]
 *     → «ИИ-агент» P4 (план §11): раздел «Автоответчик» — выключен (с
 *       согласием и без), «Проверка без отправки» с замком «Нужно ещё N ночей
 *       проверки», пауза и «Отправка выключена на сервере», отвечает, только
 *       чтение, журнал (и фильтр), утренняя сводка (и пустая), строка паузы в
 *       другом подразделе; настройки вживую (ошибки до записи, «Проверено»
 *       снимается с изменённой фразы, запись с версией); режим вживую
 *       («Отвечает» — только после подтверждения плашкой, «Отмена» без
 *       записи, фокус туда и обратно); лента с подписью
 *       «Автоответчик» и чипом «Ночью отвечает автоответчик»; в окне ИИ —
 *       «Автоответчик в этом чате» (включён, исключение, проверка без
 *       отправки, пауза, сбой и «Повторить», выключен в организации — полосы
 *       нет). 1440×900 и 390×844, синтетика. По умолчанию outDir —
 *       docs/design/evo-platform/implementation-screenshots/ai-agent-p4.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8")), filename);
  };
}
Module._extensions[".png"] = (module) => {
  module.exports = { src: LOGO_URL, width: 1843, height: 842 };
};
const cssModules = new Map();
Module._extensions[".css"] = (module, filename) => {
  cssModules.set(filename, readFileSync(filename, "utf8"));
  module.exports = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") {
    return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  }
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement: h } = require("react");
const { renderToStaticMarkup, renderToString } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function withContexts(node, pathname, search) {
  return h(AppRouterContext.Provider, { value: routerStub },
    h(PathnameContext.Provider, { value: pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

// --- синтетические сотрудники ---------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const STUDENT = "aaaaaaaa-1111-4111-8111-000000000099";
const BASE_ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid",
  assignments: [], permissionKeys: [],
};
const { staffRoleKeys } = require("./staff-role-templates.cjs");
const ACTORS = {
  admin: { ...BASE_ACTOR, displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: null },
  // Приглашённый сотрудник продаж (права шаблонов 173): «Переписки» поступления у него нет, WhatsApp — в «Продажах».
  sales: {
    ...BASE_ACTOR, displayName: "Менеджер продаж (синтетический)", systemRole: "staff", presentationRole: null,
    assignments: [{ label: "Sales Manager", scope: { kind: "own", key: null, resourceKind: null } }], permissionKeys: staffRoleKeys("sales-manager"),
  },
  // Куратор (права шаблонов 173): маршрут WhatsApp открыт и пункт «WhatsApp» есть в меню (решение
  // владельца 06.10.2026, «все могут», заменило правило 27.09, где у поступления пункта не было).
  admissions: {
    ...BASE_ACTOR, displayName: "Куратор (синтетический)", systemRole: "staff", presentationRole: null,
    assignments: [{ label: "Admissions", scope: { kind: "own", key: null, resourceKind: null } }], permissionKeys: staffRoleKeys("admissions"),
  },
};

// --- синтетические переписки ------------------------------------------------------
// «Сейчас» — воскресенье 27.09.2026, 12:00 по Бишкеку (06:00 UTC).
const READ_AT = "2026-09-27T06:00:00.000Z";
const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;
const row = (n, name, fields) => ({
  studentCaseId: caseId(n), studentDisplayName: name, lastMessageSnippet: fields.snippet ?? null,
  lastMessageAt: fields.at ?? null, lastMessageAuthorMembershipId: fields.mine ? ME : fields.at ? STUDENT : null,
  awaitState: fields.state ?? "none", unread: fields.unread ?? false,
});
// Порядок — как у чтения 234: от новых, без сообщений — в конце.
const ALL_ROWS = [
  row(3, "Данияр Макетов", { state: "needs_reply", at: "2026-09-27T05:20:00.000Z", snippet: "Прислал фото аттестата, так подойдёт?", unread: true }),
  row(4, "Лейла Тестовая", { state: "needs_reply", at: "2026-09-26T13:30:00.000Z", snippet: "Когда будет готов перевод диплома?", unread: true }),
  row(5, "Алина Условная", { state: "awaiting_student", at: "2026-09-26T10:00:00.000Z", snippet: "Пришлите, пожалуйста, скан паспорта.", mine: true }),
  row(1, "Нурай Образцова", { state: "needs_reply", at: "2026-09-25T08:00:00.000Z", snippet: "Добрый день! Какие документы нужны для визы?" }),
  row(6, "Софья Эскизова", { state: "awaiting_student", at: "2026-09-24T09:00:00.000Z", snippet: "Ждём от вас подписанное заявление.", mine: true }),
  row(7, "Руслан Черновиков", { at: "2026-09-20T07:00:00.000Z", snippet: "Спасибо, всё получил." }),
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
  { replySnippetId: "99999999-5555-4555-8555-000000000002", title: "Список документов для визы", body: "Для визы нужны: паспорт, фото 3×4, письмо о зачислении и справка о здоровье. Полный список — в разделе «Документы» кабинета.", audience: "all" },
  { replySnippetId: "99999999-5555-4555-8555-000000000003", title: "Перевод диплома", body: "Перевод диплома делаем в партнёрском бюро, срок — пять рабочих дней.", audience: "admissions" },
];

// Строка очереди 241 открытого дела: направление и этап доски.
const QUEUE_ROW = {
  studentCaseId: caseId(1), studentDisplayName: "Нурай Образцова", state: "active", admissionsDirection: "CN", targetCountry: null, targetDegree: "Бакалавриат",
  pipelineStage: "documents", pipelineHidden: false, nextAction: null, nextActionDueOn: null, dueBand: "no_step", admissionsVersion: "3",
  currentCuratorMembershipId: ME, currentCuratorDisplayName: "Администратор (синтетический)", isMine: true, attentionFlags: [], needsReply: true,
  overdueTaskCount: 0, documents: null, updatedAt: "2026-09-26T05:00:00.000000Z", cursor: "x",
};

// --- настоящие страницы с подменёнными чтениями -------------------------------------
const NOT_CONNECTED_VIEW = Object.freeze({
  conversations: [], selected: null, queueCurrentHref: "/v3/inbox", queueNewestHref: null, queueOlderHref: null,
  searchQuery: null, waitingOnly: false, waitingToggleHref: "/v3/inbox?waiting=1", channelState: "not_connected",
  listPulse: null,
});

function stubReads({ actor, rows, inbox = NOT_CONNECTED_VIEW }) {
  const guards = require(join(ROOT, "src/lib/platform-guards.ts"));
  guards.requireV3PageActor = async () => actor;
  const { readCaseChatQueueWith } = require(join(ROOT, "src/components/v3/case-chat/case-chat-queue.ts"));
  const chat = require(join(ROOT, "src/lib/v3/case-chat-source.ts"));
  chat.readStaffCaseChatQueue = async (_actor, query, queue) => readCaseChatQueueWith(async (filter) => {
    const needle = (query ?? "").trim().toLocaleLowerCase("ru");
    const found = rows.filter((item) => (!needle || item.studentDisplayName.toLocaleLowerCase("ru").includes(needle))
      && (filter === "all" || item.awaitState === filter));
    return { rows: found, truncated: false };
  }, queue, () => new Date(READ_AT));
  chat.readCaseChatPage = async () => threadPage();
  require(join(ROOT, "src/lib/v3/case-work-source.ts")).readCaseQueueRow = async (_actor, target) => target.studentCaseId === QUEUE_ROW.studentCaseId ? QUEUE_ROW : null;
  require(join(ROOT, "src/lib/v3/reply-snippets-source.ts")).readV3ReplySnippets = async () => SNIPPETS;
  require(join(ROOT, "src/lib/supabase/config.ts")).getSupabasePublicConfig = () => ({ url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" });
  require(join(ROOT, "src/lib/i18n.ts")).getLocale = async () => "ru";
  require(join(ROOT, "src/lib/v3/inbox-source.ts")).readInbox = async () => ({ view: inbox });
  require(join(ROOT, "src/lib/v3/inbox-media.ts")).readV3InboxMediaAttachmentContext = async () => null;
}

const SCENARIOS = {
  // Список: по умолчанию «Нужен ответ», справа — следующая переписка.
  cabinet: { actor: "admin", page: "messages", search: {}, rows: ALL_ROWS },
  // Переписка с переключателем состояния; шаблоны — в поле ответа.
  thread: { actor: "admin", page: "messages", search: { case: caseId(1) }, rows: ALL_ROWS },
  // Ответы даны: «Все ответы даны» — в пустой очереди слева, а в «Ждём студента» — справа.
  answered: { actor: "admin", page: "messages", search: {}, rows: ANSWERED_ROWS },
  "answered-awaiting": { actor: "admin", page: "messages", search: { queue: "awaiting_student" }, rows: ANSWERED_ROWS },
  // «Все»: отметки состояния в строках.
  all: { actor: "admin", page: "messages", search: { queue: "all" }, rows: ALL_ROWS },
  // WhatsApp не подключён — отдельная страница «Продаж»: у Admin, у продаж и у
  // куратора (решение владельца 06.10.2026, «нет, все могут»: пункт есть и у
  // ролей поступления, диалоги и ответы решает база — миграция 261).
  whatsapp: { actor: "admin", page: "inbox", search: {}, rows: ALL_ROWS },
  "whatsapp-sales": { actor: "sales", page: "inbox", search: {}, rows: ALL_ROWS },
  "whatsapp-admissions": { actor: "admissions", page: "inbox", search: {}, rows: ALL_ROWS },
};
const TITLES = { messages: "Переписка", inbox: "WhatsApp" };

const pathnameOf = (scenario) => (scenario.page === "messages" ? "/v3/messages" : "/v3/inbox");
const searchOf = (scenario) => new URLSearchParams(scenario.search).toString();

/** Дерево страницы: для «Кабинета студента» — разметка и пропсы для гидратации. */
async function buildPage(name) {
  const scenario = SCENARIOS[name];
  const actor = ACTORS[scenario.actor];
  stubReads({ actor, rows: scenario.rows });
  const file = scenario.page === "messages" ? "src/app/(v3)/v3/messages/page.tsx" : "src/app/(v3)/v3/inbox/page.tsx";
  const { default: Page } = require(join(ROOT, file));
  const element = await Page({ searchParams: Promise.resolve(scenario.search) });
  if (scenario.page === "messages") {
    const { children: workspace, ...main } = element.props;
    return { actor, scenario, element, cabinet: { main, workspace: workspace.props } };
  }
  return { actor, scenario, element, cabinet: null };
}

// --- оболочка -------------------------------------------------------------------
function shellTree({ actor, pathname, search, body, cabinet, chatApp = null }) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const content = chatApp
    ? h(require(join(ROOT, "src/components/v3/PartShell.tsx")).PartShell, chatApp.main,
      h(require(join(ROOT, "src/components/v3/Inbox.tsx")).Inbox, chatApp.inbox))
    : cabinet
    ? h(require(join(ROOT, "src/components/v3/ConversationsMain.tsx")).ConversationsMain, cabinet.main,
      h(require(join(ROOT, "src/components/v3/case-chat/CaseChatThread.tsx")).CaseChatWorkspace, cabinet.workspace))
    : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: body } });
  return withContexts(
    h("div", { className: "v3-world", "data-surface": "staff" },
      h(AppShell, { actor, initialNotifications: null }, content)),
    pathname, search);
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), readFileSync(join(ROOT, "src/app/(v3)/ai-agent.css"), "utf8"), ...cssModules.values()].join("\n");
}

// --- браузерная сборка ----------------------------------------------------------
const LINK_SHIM = `
const React = require("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const ONLY = new Set(["prefetch", "scroll", "replace", "shallow", "locale", "passHref", "legacyBehavior", "onNavigate", "as", "unstable_dynamicOnHover"]);
function Link(props) {
  const router = React.useContext(AppRouterContext);
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!ONLY.has(key) && key !== "href" && key !== "onClick") rest[key] = value;
  const href = String(props.href);
  return React.createElement("a", { ...rest, href, onClick(event) {
    if (props.onClick) props.onClick(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    let prevented = false;
    if (props.onNavigate) props.onNavigate({ preventDefault() { prevented = true; } });
    if (!prevented) router.push(href);
  } });
}
module.exports = Link;
module.exports.default = Link;
module.exports.__esModule = true;
`;

const FIXTURE_ID = "conversations-fixture";
const CLIENT_ENTRY = `
const React = require("react");
const { hydrateRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { ConversationsMain } = require("@/components/v3/ConversationsMain");
const { CaseChatWorkspace } = require("@/components/v3/case-chat/CaseChatThread");
const { PartShell } = require("@/components/v3/PartShell");
const { Inbox } = require("@/components/v3/Inbox");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [], aiRefs: [], memory: [], autosend: [], refreshes: 0, polls: 0 };
// Опрос и «Показать ранее» отвечают синтетикой этой вкладки (сети нет).
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("/api/v3/inbox/pulse")) {
    window.__harness.polls += 1;
    return new Response(JSON.stringify(fixture.pulse || { list: null, chat: null }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.startsWith("/api/v3/inbox/conversations/")) {
    return new Response(JSON.stringify(fixture.older || { messages: [], hasOlder: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // Окно ИИ (--ai-agent): сохранённый ответ, поток агента и вставка отвечают
  // синтетикой этой вкладки по очереди; ни агента, ни Gemini, ни базы нет.
  if (fixture.ai && url.startsWith("/api/v3/ai-agent/")) {
    const method = (init && init.method) || "GET";
    const take = (list) => (list.length > 1 ? list.shift() : list[0]);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    // «Что ИИ знает о клиенте» (P3): чтение и «Забыть сводку» — своя очередь
    // (window.__harness.memory), чтобы последовательность ответа не менялась.
    // Без своей синтетики — память выключена, как её поставляют (memory_enabled false).
    // «Автоответчик в этом чате» (P4): своя очередь (window.__harness.autosend). Без
    // своей синтетики автоответчик выключен в организации — полосы в окне нет.
    if (url.endsWith("/autosend")) {
      if (method === "PUT") {
        const sent = JSON.parse(init.body);
        window.__harness.autosend.push("put:" + sent.excluded + ":" + sent.requestId);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const reply = take(fixture.ai.autosendPut || [{ status: 200, body: { excluded: sent.excluded } }]);
        return json(reply.status, reply.body);
      }
      window.__harness.autosend.push("read");
      const reply = take(fixture.ai.autosend || [{ status: 200, body: { chat: {
        enabled: false, mode: "off", paused: false, excluded: false, liveTest: false, handedOff: false,
      }, serverOn: false } }]);
      return json(reply.status, reply.body);
    }
    if (url.endsWith("/memory")) {
      if (method === "DELETE") {
        window.__harness.memory.push("clear:" + JSON.parse(init.body).requestId);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const reply = take(fixture.ai.memoryClear || [{ status: 200, body: { deleted: true, enqueued: true } }]);
        return json(reply.status, reply.body);
      }
      window.__harness.memory.push("read");
      const reply = take(fixture.ai.memory || [{ status: 200, body: { memory: {
        enabled: false, consentRecorded: true, active: false, canManage: true, messageCount: 9, summaryDue: false, interestDue: false,
        memory: null, lead: { name: "Аружан", interestDirection: "MY", stage: "qualified" },
      } } }]);
      return json(reply.status, reply.body);
    }
    if (url.includes("/insert")) {
      window.__harness.actions.push("ai-insert:" + JSON.parse(init.body).part);
      const reply = take(fixture.ai.insert);
      return json(reply.status, reply.body);
    }
    if (method === "GET") {
      window.__harness.actions.push("ai-read");
      return json(200, take(fixture.ai.saved));
    }
    const request = JSON.parse(init.body);
    window.__harness.actions.push("ai-answer:" + request.intent);
    window.__harness.aiRefs.push(request.refId);
    // Как answer_claim_v1: билет не на последнее сообщение клиента в базе — PT409.
    if (fixture.ai.latest && request.refId !== fixture.ai.latest) return json(409, { error: { code: "superseded" } });
    const reply = take(fixture.ai.post);
    if (!reply.frames) return json(reply.status, reply.body);
    const encoder = new TextEncoder();
    const signal = init && init.signal;
    const stream = new ReadableStream({
      async start(controller) {
        for (const frame of reply.frames) {
          await new Promise((resolve) => setTimeout(resolve, frame.delay || 0));
          if (signal && signal.aborted) { controller.close(); return; }
          controller.enqueue(encoder.encode("event: " + frame.event + "\\ndata: " + JSON.stringify(frame.data) + "\\n\\n"));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  return originalFetch(input, init);
};
const router = {
  push: (href) => { window.__harness.pushes.push(href); }, replace: (href) => { window.__harness.pushes.push(href); },
  refresh() { window.__harness.refreshes += 1; }, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
const contentFor = (inbox) => fixture.chatApp
  ? h(PartShell, fixture.chatApp.main, h(Inbox, inbox))
  : fixture.cabinet
  ? h(ConversationsMain, fixture.cabinet.main, h(CaseChatWorkspace, fixture.cabinet.workspace))
  : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: fixture.body } });
const treeFor = (content) => h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: fixture.pathname },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-surface": "staff" },
          h(AppShell, { actor: fixture.actor, initialNotifications: null }, content))))));
const root = hydrateRoot(document.getElementById("root"), treeFor(contentFor(fixture.chatApp && fixture.chatApp.inbox)), {
  onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)),
});
// Новое сообщение клиента в открытом чате (как после опроса): меняется только
// последнее входящее у страницы.
window.__harness.newInbound = (id) => {
  const inbox = fixture.chatApp.inbox;
  const selected = inbox.view.selected;
  root.render(treeFor(contentFor({ ...inbox, view: { ...inbox.view, selected: { ...selected, chat: { ...selected.chat, latestInboundMessageId: id } } } })));
};
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.hydrated = "true"; }));
`;

async function buildClientBundle(outFile, entry = CLIENT_ENTRY) {
  const esbuild = require("esbuild");
  // Чтения отвечают той же синтетикой через настоящий composeCaseChatQueue.
  // Отправка честно недоступна. Смена состояния пишется в синтетические строки
  // этой вкладки (базы нет — в EVO ничего не пишется): следующее чтение списка
  // видит новое состояние, и снимок показывает, что переключатель зовёт
  // прежнюю команду, а список перечитывается через onListChanged → refreshList.
  const caseChatStub = `
import { composeCaseChatQueue } from "@/components/v3/case-chat/case-chat-queue";
const fixture = () => JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
let store = null;
const rows = () => (store ??= fixture().rows.map((item) => ({ ...item })));
const threadStates = new Map();
export async function readCaseChatPageAction(caseId) {
  const page = fixture().cabinet.workspace.initialPage;
  const state = threadStates.get(caseId);
  return { status: "ready", page: state ? { ...page, thread: { ...page.thread, awaitState: state } } : page };
}
export async function loadStaffCaseChatThreadsAction(query, queue) {
  window.__harness.actions.push("load:" + queue);
  const needle = (query || "").trim().toLocaleLowerCase("ru");
  const found = rows().filter((item) => !needle || item.studentDisplayName.toLocaleLowerCase("ru").includes(needle));
  return { status: "ready", read: composeCaseChatQueue({ all: { rows: found, truncated: false } }, queue, fixture().readAt) };
}
export async function markCaseChatReadAction() { return { status: "saved", requestId: null }; }
export async function postCaseChatMessageAction() { window.__harness.actions.push("post"); return { status: "unavailable", requestId: null }; }
export async function setCaseChatAwaitAction(_previous, form) {
  const caseId = form.get("case_id");
  const state = form.get("state");
  window.__harness.actions.push("await:" + state + ":" + caseId);
  const target = rows().find((item) => item.studentCaseId === caseId);
  if (target) target.awaitState = state;
  threadStates.set(caseId, state);
  return { status: "saved", requestId: form.get("request_id") };
}`;
  // Чат WhatsApp: отправка честно не доходит — сервер «молчит» 1,5 с, затем
  // связь «прерывается» (состояние «Повторить»); проверка результата не
  // удаётся. В WhatsApp и в базу ничего не уходит.
  const whatsappStub = `
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function sendPlatformWhatsAppMessageAction(input) {
  window.__harness.actions.push("send:" + input.requestId);
  await wait(window.__harness.sendDelay ?? 1500);
  return { status: "unavailable", workItemId: null, attemptId: null, messageId: null };
}
export async function reconcilePlatformWhatsAppSendAction(input) {
  window.__harness.actions.push("check:" + input.attemptId);
  await wait(window.__harness.checkDelay ?? 1200);
  return { status: "readback_failed" };
}`;
  const plugin = {
    name: "conversations-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        if (args.path.endsWith("platform-case-chat-actions.ts")) return { contents: caseChatStub, loader: "ts", resolveDir: ROOT };
        if (args.path.endsWith("platform-provider-actions.ts")) return { contents: whatsappStub, loader: "ts", resolveDir: ROOT };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}() { window.__harness.errors.push("server action ${name}"); throw new Error("harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, sourcefile: "conversations-client-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } };" },
    plugins: [plugin], logLevel: "error",
  });
}

// --- измерения ---------------------------------------------------------------------
function pageMetrics() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const main = [...document.querySelectorAll("main")].find(visible);
  const inMain = main ? [...main.querySelectorAll("*")].filter(visible) : [];
  const texts = inMain.filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  // Закрытые окна (popover) не показаны — их цели не меряются.
  const targets = main ? [...main.querySelectorAll("a, button, select, textarea, input:not([type=hidden])")]
    .filter((element) => visible(element) && !element.closest("details:not([open]) > :not(summary)")) : [];
  const box = (element) => { if (!visible(element)) return null; const rect = element.getBoundingClientRect(); return { top: Math.round(rect.top * 10) / 10, bottom: Math.round(rect.bottom * 10) / 10 }; };
  const paint = (element) => (element ? { bg: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, tone: element.dataset.tone ?? null } : null);
  const h1 = [...document.querySelectorAll("h1")].find(visible);
  const list = document.querySelector('nav[aria-label="Переписки кабинета студента"]');
  const header = document.querySelector('[data-testid="case-chat-thread-header"]');
  const composer = main ? [...main.querySelectorAll("textarea")].find(visible) : null;
  const popover = document.querySelector("[popover]:popover-open");
  const nav = [...document.querySelectorAll('nav[aria-label="Разделы"] a, [data-shell-menu] a, [data-testid="v3-shell-tabbar"] a')].filter(visible);
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    h1: [...document.querySelectorAll("h1")].filter(visible).map((element) => element.textContent.trim()),
    channels: [...document.querySelectorAll('nav[aria-label="Каналы переписки"] a')].filter(visible).map((link) => `${link.textContent.trim()}${link.getAttribute("aria-current") ? "*" : ""}`),
    queues: [...document.querySelectorAll('[data-testid="case-chat-queues"] button')].filter(visible).map((button) => `${button.textContent.trim()}${button.getAttribute("aria-pressed") === "true" ? "*" : ""}`),
    awaitControl: [...document.querySelectorAll('[data-testid="case-chat-await-control"] button')].filter(visible).map((button) => `${button.textContent.trim()}${button.getAttribute("aria-pressed") === "true" ? "*" : ""}`),
    facts: document.querySelector('[data-testid="case-chat-case-facts"]')?.innerText.replace(/\s+/gu, " ").trim() ?? null,
    next: (() => { const pane = document.querySelector('[data-testid="case-chat-next"]'); return visible(pane) ? pane.textContent.trim() : null; })(),
    rows: [...document.querySelectorAll("[data-case-chat-row]")].filter(visible).map((element) => element.querySelector(".t-item")?.textContent.trim()),
    listEmpty: document.querySelector('nav[aria-label="Переписки кабинета студента"] [role="status"]')?.parentElement.textContent.trim() ?? null,
    // Место заголовка: одна высота у обеих страниц переписки.
    // Шапка страницы, скрытая для глаз (`sr-only`), — корень в 1 px: h1 внутри сохраняет свой размер.
    h1Shown: h1 ? h1.parentElement.parentElement.getBoundingClientRect().height > 1 : false,
    place: { h1: box(h1) },
    // Нажатое в переключателе состояния и в очереди: разный вид.
    awaitPressed: paint(document.querySelector('[data-testid="case-chat-await-control"] button[aria-pressed="true"]')),
    queuePressed: paint(visible(list) ? list.querySelector('[data-testid="case-chat-queues"] button[aria-pressed="true"]') : null),
    awaitLabel: header ? [...header.querySelectorAll("span")].some((element) => visible(element) && element.textContent.trim() === "Состояние") : null,
    listEdge: visible(list) ? getComputedStyle(list).borderInlineEndWidth : null,
    glyphs: main ? [...main.querySelectorAll("*")].filter((element) => visible(element) && [...element.childNodes].some((node) => node.nodeType === 3 && /[⋯…]/u.test(node.textContent) && node.textContent.trim().length <= 2)).length : 0,
    thread: header && visible(header) ? {
      // Сколько экрана под верхом страницы уходит до начала ленты.
      headerBottomFromMain: Math.round(header.getBoundingClientRect().bottom - main.getBoundingClientRect().top),
      backInNameRow: Boolean(header.querySelector('a[aria-label="К списку"]')?.parentElement?.querySelector("h2")),
    } : null,
    // Видимые пункты меню и вкладки: «имя=адрес», «*» — текущий.
    menu: nav.map((link) => `${link.getAttribute("aria-label") ?? link.textContent.trim()}=${link.getAttribute("href")}${link.getAttribute("aria-current") ? "*" : ""}`),
    menuRetired: nav.filter((link) => ["Сообщения", "Переписки"].includes(link.getAttribute("aria-label") ?? link.textContent.trim())).length,
    moreCurrent: document.querySelector('[data-testid="v3-shell-tabbar"] [data-shell-tab="more"]')?.hasAttribute("data-current-inside") ?? null,
    textUnder12: texts.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).length,
    smallTargets: targets.filter((element) => { const box = element.getBoundingClientRect(); return box.height < 44 && !element.closest("[popover]") && element.tagName !== "TEXTAREA"; })
      .map((element) => element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)),
    solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
    composer: composer ? { bottom: Math.round(composer.getBoundingClientRect().bottom), inViewport: composer.getBoundingClientRect().bottom <= window.innerHeight } : null,
    popover: popover ? {
      label: popover.getAttribute("aria-label"),
      focus: popover.contains(document.activeElement) ? document.activeElement.tagName : null,
      inViewport: (() => { const box = popover.getBoundingClientRect(); return box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth; })(),
    } : null,
  };
}

const VIEWPORTS = {
  "1440": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  "1280": { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  "390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const prefix = process.argv.find((arg) => arg.startsWith("--prefix="))?.slice("--prefix=".length) || "e5";
  const bundleName = `${prefix}-conversations-client.js`;
  const css = await compileCss();
  await buildClientBundle(join(outDir, bundleName));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

  const htmlFor = {};
  for (const name of Object.keys(SCENARIOS)) {
    const { actor, scenario, element, cabinet } = await buildPage(name);
    const pathname = pathnameOf(scenario);
    const search = searchOf(scenario);
    const body = cabinet ? null : renderToStaticMarkup(withContexts(element, pathname, search));
    const markup = renderToString(shellTree({ actor, pathname, search, body, cabinet }));
    const data = JSON.stringify({ actor, pathname, search, body, cabinet, rows: scenario.rows, readAt: READ_AT }).replaceAll("<", "\\u003c");
    const htmlPath = join(outDir, `${prefix}-${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>${TITLES[scenario.page]} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${data}</script><script src="${bundleName}"></script></body></html>`,
    ].join(""));
    htmlFor[name] = htmlPath;
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (htmlPath, viewportKey) => {
    const context = await browser.newContext(VIEWPORTS[viewportKey]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    // Чтение списка при монтировании (как у страницы) — дождаться его.
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(150);
    return { context, page, errors };
  };
  const finish = async ({ context, page, errors }, label) => {
    const harness = await page.evaluate(() => window.__harness);
    const problems = [...errors.filter((message) => !/127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|Failed to load resource/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };
  const common = (label, metrics, viewportKey, scenario) => {
    const title = TITLES[scenario.page];
    const href = pathnameOf(scenario);
    check(metrics.overflowX === 0, `${label}: horizontal overflow ${metrics.overflowX}px`);
    check(metrics.h1.length === 1 && metrics.h1[0] === title, `${label}: h1 ${JSON.stringify(metrics.h1)}`);
    check(metrics.channels.length === 0, `${label}: channel tabs ${metrics.channels.join(" · ")}`);
    check(metrics.glyphs === 0, `${label}: ${metrics.glyphs} text glyphs standing in for icons`);
    check(metrics.textUnder12 === 0, `${label}: ${metrics.textUnder12} texts under 12px`);
    check(metrics.smallTargets.length === 0, `${label}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
    check(metrics.solidRed <= 1, `${label}: ${metrics.solidRed} solid red controls`);
    check(metrics.menuRetired === 0, `${label}: «Сообщения»/«Переписки» still in the menu`);
    // Свой пункт меню подсвечен; пункт WhatsApp есть и у куратора (06.10.2026).
    const current = metrics.menu.filter((item) => item.endsWith("*"));
    if (viewportKey !== "390" || scenario.page === "messages") {
      check(JSON.stringify(current) === JSON.stringify([`${title}=${href}*`]), `${label}: current menu item ${JSON.stringify(current)}`);
    } else {
      // Телефон продаж и Admin: WhatsApp — в «Ещё», оно и подсвечено.
      check(current.length === 0 && metrics.moreCurrent === true, `${label}: WhatsApp not in «Ещё» ${JSON.stringify({ current, more: metrics.moreCurrent })}`);
    }
  };

  // Место заголовка «Переписки» и WhatsApp — для сравнения.
  const places = {};
  try {
    for (const name of Object.keys(SCENARIOS)) {
      for (const viewportKey of Object.keys(VIEWPORTS)) {
        if ((name === "all" || name === "answered-awaiting") && viewportKey === "1280") continue;
        const file = `${prefix}-${name}-${viewportKey}.png`;
        const session = await open(htmlFor[name], viewportKey);
        const metrics = await session.page.evaluate(pageMetrics);
        await session.page.screenshot({ path: join(outDir, file) });
        await finish(session, file);
        report({ file, ...metrics });
        common(file, metrics, viewportKey, SCENARIOS[name]);
        places[`${name}:${viewportKey}`] = metrics.place;
        // Телефон, открытая переписка: заголовок страницы — только для читалки.
        const phoneThread = name === "thread" && viewportKey === "390";
        check(metrics.h1Shown === !phoneThread, `${file}: h1 shown ${metrics.h1Shown}`);
        if (SCENARIOS[name].page === "messages") {
          check(metrics.overflowY <= 0, `${file}: page scrolls ${metrics.overflowY}px`);
          if (!phoneThread) check(metrics.queues.length === 3, `${file}: queues ${metrics.queues.join(" · ")}`);
          // Список на всю ширину телефона — без своей черты справа внутри скругления карточки.
          if (!phoneThread) check(metrics.listEdge === (viewportKey === "390" ? "0px" : "1px"), `${file}: list edge ${metrics.listEdge}`);
        }
        if (name === "cabinet") {
          check(JSON.stringify(metrics.queues) === JSON.stringify(["Нужен ответ3*", "Ждём студента2", "Все"]), `${file}: queue counts ${metrics.queues.join(" · ")}`);
          check(JSON.stringify(metrics.rows) === JSON.stringify(["Нурай Образцова", "Лейла Тестовая", "Данияр Макетов"]), `${file}: not oldest first ${metrics.rows.join(", ")}`);
          if (viewportKey !== "390") check(metrics.next === "Следующий: Нурай Образцова — ждёт 2 днОткрыть", `${file}: next pane «${metrics.next}»`);
        }
        // Пустая «Нужен ответ»: справа — «Все ответы даны», слева — без повтора.
        if (name === "answered") {
          check(metrics.listEmpty === "Нет переписок, ждущих ответа.Показать все переписки", `${file}: list «${metrics.listEmpty}»`);
          if (viewportKey !== "390") check(metrics.next === "Все ответы даны", `${file}: pane «${metrics.next}»`);
        }
        if (name === "answered-awaiting" && viewportKey !== "390") check(metrics.next === "Все ответы даны", `${file}: pane «${metrics.next}»`);
        if (name === "thread") {
          check(JSON.stringify(metrics.awaitControl) === JSON.stringify(["Нужен ответ*", "Ждём студента", "Не требуется"]), `${file}: await control ${metrics.awaitControl.join(" · ")}`);
          check(metrics.awaitLabel === true, `${file}: no visible «Состояние» label`);
          check(metrics.awaitPressed?.tone === "warn", `${file}: pressed «Нужен ответ» tone ${JSON.stringify(metrics.awaitPressed)}`);
          // Запись состояния не выглядит как фильтр очереди рядом.
          if (!phoneThread) check(metrics.queuePressed && metrics.awaitPressed.bg !== metrics.queuePressed.bg && metrics.awaitPressed.color !== metrics.queuePressed.color,
            `${file}: state switch looks like the queue filter ${JSON.stringify([metrics.awaitPressed, metrics.queuePressed])}`);
          check(metrics.thread?.backInNameRow === true, `${file}: «К списку» not on the name row`);
          if (phoneThread) check(metrics.thread.headerBottomFromMain <= 190, `${file}: thread header ends ${metrics.thread.headerBottomFromMain}px below the page top`);
          check(metrics.facts === "Китай · Документы", `${file}: facts «${metrics.facts}»`);
          check(metrics.composer?.inViewport === true, `${file}: composer ${JSON.stringify(metrics.composer)}`);
          check(metrics.solidRed === 1, `${file}: ${metrics.solidRed} solid red controls (only «Отправить»)`);
        }
        // У продаж «Переписки» поступления нет: ни пункта, ни ссылки.
        if (name === "whatsapp-sales") check(!metrics.menu.some((item) => item.includes("=/v3/messages")), `${file}: student chat in the sales menu`);
      }
    }

    // Переход между двумя страницами переписки не сдвигает заголовок: его
    // верх у «Переписки» и у WhatsApp — на одной высоте.
    for (const viewportKey of Object.keys(VIEWPORTS)) {
      const cabinet = places[`cabinet:${viewportKey}`];
      const whatsapp = places[`whatsapp:${viewportKey}`];
      report({ journey: "title-place", viewport: viewportKey, cabinet, whatsapp });
      check(cabinet?.h1 && whatsapp?.h1 && cabinet.h1.top === whatsapp.h1.top, `page titles at different heights at ${viewportKey}: ${JSON.stringify({ cabinet, whatsapp })}`);
    }

    // Выбор шаблона: кнопкой «Шаблон» (все окна) и «/» в пустом поле (1440).
    // Вставка — в текст, без отправки; окно закрывается, фокус — в поле.
    for (const [viewportKey, via] of [["1440", "button"], ["1280", "button"], ["390", "button"], ["1440", "slash"]]) {
      const session = await open(htmlFor.thread, viewportKey);
      const { page } = session;
      if (via === "button") await page.locator('form[aria-label="Новое сообщение"] button[aria-haspopup="dialog"]').click();
      else {
        await page.locator('form[aria-label="Новое сообщение"] textarea').focus();
        await page.keyboard.press("/");
      }
      await page.waitForSelector('[data-testid="case-chat-snippet-popover"]:popover-open');
      await page.waitForTimeout(100);
      const opened = await page.evaluate(pageMetrics);
      const file = `${prefix}-thread-picker-${via === "slash" ? "slash-" : ""}${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      await page.locator('[data-testid="case-chat-snippet-popover"] select').selectOption({ label: "Список документов для визы" });
      await page.locator('[data-testid="case-chat-snippet-popover"] button', { hasText: "Вставить в текст" }).click();
      await page.waitForTimeout(150);
      const inserted = await page.evaluate(() => ({
        text: document.querySelector('form[aria-label="Новое сообщение"] textarea').value,
        open: Boolean(document.querySelector("[popover]:popover-open")),
        focus: document.activeElement?.tagName ?? null,
        actions: window.__harness.actions,
      }));
      await finish(session, file);
      report({ journey: "snippet", file, via, popover: opened.popover, inserted });
      check(opened.popover?.label === "Шаблон ответа" && opened.popover.focus === "SELECT" && opened.popover.inViewport, `${file}: picker ${JSON.stringify(opened.popover)}`);
      check(inserted.text.startsWith("Для визы нужны:") && !inserted.open && inserted.focus === "TEXTAREA", `${file}: insert ${JSON.stringify(inserted)}`);
      check(!inserted.actions.includes("post"), `${file}: inserting a template sent the message`);
    }
    // Переключатель состояния — прежняя команда set_await: «Ждём студента»
    // уходит с делом открытой переписки, выбранное меняется, список
    // перечитан (onListChanged → refreshList): дело ушло из «Нужен ответ»,
    // числа 3 · 2 стали 2 · 3.
    {
      const session = await open(htmlFor.thread, "1440");
      const { page } = session;
      await page.evaluate(() => { window.__harness.actions.length = 0; });
      await page.locator('[data-testid="case-chat-await-control"] button', { hasText: "Ждём студента" }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="case-chat-await-control"] button[aria-pressed="true"]')?.textContent === "Ждём студента");
      await page.waitForFunction(() => document.querySelector('[data-queue-count="needs_reply"]')?.textContent === "2", null, { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => ({
        pressed: [...document.querySelectorAll('[data-testid="case-chat-await-control"] button')].filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent),
        actions: window.__harness.actions,
      }));
      const metrics = await page.evaluate(pageMetrics);
      const file = `${prefix}-thread-await-1440.png`;
      await page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ journey: "await", file, after, queues: metrics.queues, rows: metrics.rows, awaitPressed: metrics.awaitPressed });
      check(after.actions[0] === `await:awaiting_student:${caseId(1)}`, `${file}: command ${JSON.stringify(after.actions)}`);
      check(after.actions.some((action) => action.startsWith("load:")), `${file}: list not re-read after the change`);
      check(JSON.stringify(after.pressed) === JSON.stringify(["Ждём студента"]), `${file}: pressed ${after.pressed}`);
      check(metrics.awaitPressed?.tone === "neutral", `${file}: pressed tone ${JSON.stringify(metrics.awaitPressed)}`);
      check(JSON.stringify(metrics.queues) === JSON.stringify(["Нужен ответ2*", "Ждём студента3", "Все"]), `${file}: counts after the change ${metrics.queues.join(" · ")}`);
      check(JSON.stringify(metrics.rows) === JSON.stringify(["Лейла Тестовая", "Данияр Макетов"]), `${file}: rows after the change ${metrics.rows.join(", ")}`);
    }

    // Действия с сообщением: знак из набора иконок в строке «автор · время»,
    // меню — в верхнем слое; «Ответить с цитатой» ставит цитату в поле ответа.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open(htmlFor.thread, viewportKey);
      const { page } = session;
      const trigger = page.locator('[id^="case-message-"] button[aria-label="Действия с сообщением"]').last();
      const placed = await trigger.evaluate((button) => {
        const line = button.parentElement.querySelector("time").getBoundingClientRect();
        const icon = button.querySelector("svg").getBoundingClientRect();
        const bubble = button.closest('[id^="case-message-"] > div').getBoundingClientRect();
        return { onNameLine: Math.abs((icon.top + icon.bottom) / 2 - (line.top + line.bottom) / 2) <= 3, insideBubble: icon.top >= bubble.top && icon.bottom <= bubble.bottom, height: Math.round(button.getBoundingClientRect().height) };
      });
      await trigger.click();
      await page.waitForSelector('[id^="case-message-"] [popover]:popover-open');
      await page.waitForTimeout(100);
      const file = `${prefix}-thread-message-menu-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      const menu = await page.evaluate(() => { const popover = document.querySelector("[popover]:popover-open"); const box = popover.getBoundingClientRect(); return { label: popover.getAttribute("aria-label"), inViewport: box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth }; });
      await page.locator("[popover]:popover-open button", { hasText: "Ответить с цитатой" }).click();
      await page.waitForTimeout(100);
      const quoted = await page.evaluate(() => ({ open: Boolean(document.querySelector("[popover]:popover-open")), quote: document.querySelector('form[aria-label="Новое сообщение"] p.truncate')?.textContent ?? null, actions: window.__harness.actions }));
      await finish(session, file);
      report({ journey: "message-menu", file, placed, menu, quoted });
      check(placed.onNameLine && placed.insideBubble && placed.height >= 44, `${file}: menu icon ${JSON.stringify(placed)}`);
      check(menu.label === "Действия с сообщением" && menu.inViewport, `${file}: menu ${JSON.stringify(menu)}`);
      check(!quoted.open && quoted.quote?.startsWith("Нурай Образцова: Добрый день!") && !quoted.actions.includes("post"), `${file}: quote ${JSON.stringify(quoted)}`);
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`conversations checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

// --- «Продажи → WhatsApp» как чат (решение владельца 06.10.2026) ------------------
// Люди, номера, сообщения и шаблоны ВЫДУМАНЫ для проверки вёрстки и не являются
// записями EVO. «Сейчас» — 06.10.2026, 14:00 по Бишкеку (08:00 UTC).
const WA_READ_AT = "2026-10-06T08:00:00.000Z";
const waId = (n) => `ffffffff-6666-4666-8666-${String(n).padStart(12, "0")}`;
const WA_CONVERSATION = waId(1);
// Имя — из профиля WhatsApp, без имени — «WhatsApp»; номер — код страны и
// последние шесть цифр (07.10.2026, миграция 278). Ряды 2 и 5, 4 и 6 кончаются
// одинаковыми четырьмя цифрами — их различают две следующие цифры.
const waRow = (n, person, phone, updatedAt, waitingSince = null, awaitingReplyFor = null) => ({
  id: waId(n), person, phone, queue: "sales", status: "open", updatedAt, waitingSince, awaitingReplyFor,
  href: `/v3/inbox?conversation=${waId(n)}`,
});
const WA_ROWS = [
  waRow(1, "Аружан Примерова", "+996 ••• 31 07 15", "06.10 13:40", "06.10 13:40", "20 мин"),
  // Клиент сюда ещё не писал: чат не «ждёт ответа».
  waRow(2, "WhatsApp", "+996 ••• 55 48 21", "06.10 12:05"),
  waRow(3, "Тимур Макетов", "+7 ••• 90 12 34", "06.10 09:12"),
  waRow(4, "Мадина Условная", "+996 ••• 20 46 64", "05.10 18:30"),
  waRow(5, "WhatsApp", "+996 ••• 90 48 21", "05.10 11:02"),
  waRow(6, "Эльдар Эскизов", "+996 ••• 12 46 64", "04.10 16:45"),
  // Не WhatsApp-заглушка (номер неизвестен): тема чата без номера.
  waRow(7, "Жанна Вымыслова", null, "03.10 10:20"),
];
const waMessage = (n, inbound, createdAt, body, extra = {}) => ({
  id: waId(100 + n), inbound, body, createdAt, origin: inbound ? "client" : "phone", senderName: null,
  senderIsViewer: false, ack: inbound ? null : "READ", media: [], ...extra,
});
const WA_MESSAGES = [
  waMessage(1, true, "2026-10-04T05:10:00.000Z", "Здравствуйте! Интересует бакалавриат в Малайзии.", { origin: "history" }),
  waMessage(2, false, "2026-10-04T05:24:00.000Z", "Здравствуйте! Подскажите, какую специальность рассматриваете?", { origin: "history", ack: null }),
  waMessage(3, true, "2026-10-05T04:02:00.000Z", "Компьютерные науки. Сколько стоит обучение в год?"),
  waMessage(4, false, "2026-10-05T04:15:00.000Z", "Отправил подборку из трёх вузов с ценами, посмотрите 👇", { ack: "READ" }),
  waMessage(5, true, "2026-10-05T04:31:00.000Z", "📎 Документ", {
    media: [{ mediaId: "ffffffff-6666-4666-8666-000000000901", kindLabel: "Документ", fileName: "Аттестат_скан.pdf", mimeType: "application/pdf",
      fileSizeLabel: "1,2 МБ", state: "available", stateLabel: "Доступно", previewHref: "#preview", downloadHref: "#download", attachable: false }],
  }),
  waMessage(6, true, "2026-10-06T04:12:00.000Z", "Добрый день! А можно поступить без IELTS?"),
  waMessage(7, false, "2026-10-06T04:20:00.000Z", "Да, в двух вузах из подборки есть подготовительный курс английского — его можно пройти перед первым семестром.", {
    origin: "crm", senderName: "Айгерим Синтетическая", ack: "READ",
  }),
  waMessage(8, false, "2026-10-06T04:21:00.000Z", "Список требований пришлю сегодня до вечера.", { origin: "crm", senderName: "Менеджер продаж (синтетический)", senderIsViewer: true, ack: "DEVICE" }),
  waMessage(9, true, "2026-10-06T07:40:00.000Z", "Спасибо! Жду 🙏"),
];
const waAttempt = (n, status, at, text, extra = {}) => ({
  attemptId: status === "queued" ? null : waId(300 + n), workItemId: waId(400 + n), requestId: waId(500 + n), status,
  reconciliationRequired: status === "unknown", text, authorName: "Менеджер продаж (синтетический)", authorIsViewer: true,
  at, claimedAt: status === "queued" ? null : at, sourceMessageId: waId(109),
  failureCode: status === "rejected" ? "message_rejected" : null, readback: null, readbackSettled: false, ...extra,
});
const WA_ATTEMPTS = [
  waAttempt(1, "unknown", "2026-10-06T07:45:00.000Z", "Требования: аттестат с приложением, паспорт, мотивационное письмо на английском."),
  waAttempt(2, "rejected", "2026-10-06T07:46:00.000Z", "Анкета: заполните, пожалуйста, до пятницы.", { authorName: "Айгерим Синтетическая", authorIsViewer: false }),
  // Записана 13 минут назад и никем не взята: действие автора оборвалось — «не ушло».
  waAttempt(3, "queued", "2026-10-06T07:47:00.000Z", "И ещё: можно записаться на консультацию в четверг.", { authorName: "Айгерим Синтетическая", authorIsViewer: false }),
  // Проверка через 5 минут после отправки ничего не нашла: «Проверить» и «Вернуть текст в поле».
  waAttempt(4, "unknown", "2026-10-06T07:48:00.000Z", "Стоимость общежития пришлю отдельно.", { readback: "message_not_found", readbackSettled: true }),
];
function waChat(overrides = {}) {
  return {
    messages: WA_MESSAGES, hasOlder: true, attempts: WA_ATTEMPTS, latestInboundMessageId: waId(109),
    replyAccess: "allowed", stage: { label: "Квалифицирован", phase: "sales" }, readAt: WA_READ_AT, pulse: "0000000000000001",
    ...overrides,
  };
}
function waView({ selected = true, chat = {}, row = 0, channelState = "ready" } = {}) {
  return {
    conversations: WA_ROWS,
    selected: selected ? {
      ...WA_ROWS[row], channelState,
      canonicalContext: { leadId: "ffffffff-6666-4666-8666-000000000700", clientId: "ffffffff-6666-4666-8666-000000000701", studentCaseId: null },
      chat: waChat(chat),
    } : null,
    queueCurrentHref: "/v3/inbox", queueNewestHref: null, queueOlderHref: "/v3/inbox?before_at=x&before_id=y",
    searchQuery: null, waitingOnly: false, waitingToggleHref: "/v3/inbox?waiting=1", channelState,
    listPulse: "0000000000000002",
  };
}
const WA_SCENARIOS = {
  "chat": { actor: "sales", search: { conversation: WA_CONVERSATION }, inbox: waView(), viewports: ["1440", "390"] },
  "list": { actor: "sales", search: {}, inbox: waView({ selected: false }), viewports: ["1440", "390"] },
  "no-client-message": {
    // Открыт тот же чат, что выбран в списке («WhatsApp», +996 ••• 55 48 21), и он не «ждёт ответа».
    actor: "sales", search: { conversation: waId(2) }, viewports: ["1440"],
    inbox: waView({ row: 1, chat: {
      messages: [waMessage(1, false, "2026-10-06T05:00:00.000Z", "Здравствуйте! Это EVO Admissions, вы оставляли заявку на сайте."), waMessage(2, false, "2026-10-06T05:01:00.000Z", "Когда вам удобно поговорить?", { ack: "SERVER" })],
      hasOlder: false, attempts: [], latestInboundMessageId: null, replyAccess: "no_client_message", stage: null,
    } }),
  },
  "read-only": { actor: "sales", search: { conversation: WA_CONVERSATION }, viewports: ["1440"], inbox: waView({ chat: { replyAccess: "no_permission", attempts: [] } }) },
  "attention": { actor: "sales", search: { conversation: WA_CONVERSATION }, viewports: ["1440"], inbox: waView({ channelState: "attention", chat: { replyAccess: "attention", attempts: [] } }) },
};

async function buildWhatsAppPage(name) {
  const scenario = WA_SCENARIOS[name];
  const actor = ACTORS[scenario.actor];
  stubReads({ actor, rows: ALL_ROWS, inbox: scenario.inbox });
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/inbox/page.tsx"));
  const element = await Page({ searchParams: Promise.resolve(scenario.search) });
  const { children: inbox, ...main } = element.props;
  return { actor, scenario, chatApp: { main, inbox: inbox.props } };
}

function whatsappMetrics() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const main = [...document.querySelectorAll("main")].find(visible);
  const inMain = main ? [...main.querySelectorAll("*")].filter(visible) : [];
  const texts = inMain.filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  const targets = main ? [...main.querySelectorAll("a, button, select, input:not([type=hidden])")].filter((element) => visible(element) && !element.closest("[popover]")) : [];
  const composer = document.querySelector('[data-testid="v3-inbox-composer"]');
  const feed = document.querySelector('[role="log"]');
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // Шапка страницы, скрытая для глаз, — корень в 1 px: h1 внутри сохраняет свой размер.
    h1Visible: [...document.querySelectorAll("h1")].some((h1) => h1.parentElement.parentElement.getBoundingClientRect().height > 1),
    textUnder12: texts.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => element.textContent.trim().slice(0, 20)),
    smallTargets: targets.filter((element) => element.getBoundingClientRect().height < 44).map((element) => element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)),
    solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
    composer: visible(composer) ? { top: Math.round(composer.getBoundingClientRect().top), bottom: Math.round(composer.getBoundingClientRect().bottom), inViewport: composer.getBoundingClientRect().bottom <= window.innerHeight } : null,
    feedAtBottom: feed ? Math.round(feed.scrollHeight - feed.scrollTop - feed.clientHeight) : null,
    days: [...document.querySelectorAll('[data-testid="v3-inbox-messages"] > li > span.t-meta')].map((element) => element.textContent.trim()),
    origins: [...document.querySelectorAll('[data-testid="v3-inbox-message"]')].map((element) => element.dataset.origin),
    outgoing: [...document.querySelectorAll('[data-testid="v3-inbox-outgoing"]')].map((element) => element.dataset.state),
    checks: [...document.querySelectorAll('[data-testid="v3-inbox-outgoing"] button')].filter((element) => element.textContent.trim() === "Проверить").length,
    returns: [...document.querySelectorAll('[data-testid="v3-inbox-outgoing"] button')].filter((element) => element.textContent.trim() === "Вернуть текст в поле").length,
    selectedRow: document.querySelector('[data-testid="v3-inbox-row"] a[aria-current="page"] .t-item')?.textContent.trim() ?? null,
    selectedPhone: document.querySelector('[data-testid="v3-inbox-row"] a[aria-current="page"] [data-testid="v3-inbox-contact-phone"] [aria-hidden="true"]')?.textContent.trim() ?? null,
    listPhones: [...document.querySelectorAll('[data-testid="v3-inbox-row"] [data-testid="v3-inbox-contact-phone"] [aria-hidden="true"]')].map((element) => element.textContent.trim()),
    headerPhone: document.querySelector('[data-testid="v3-inbox-thread"] header [data-testid="v3-inbox-contact-phone"] [aria-hidden="true"]')?.textContent.trim() ?? null,
    channelLine: document.querySelector('[data-testid="v3-inbox-thread-channel"]')?.textContent.trim() ?? null,
    channelBanner: document.querySelector('[data-testid="v3-inbox-channel-status"]')?.textContent.trim() ?? null,
    waitingPill: /Ждёт ответа/u.test(document.querySelector('[data-testid="v3-inbox-thread"] header')?.textContent ?? ""),
    unavailable: document.querySelector('[data-testid="v3-inbox-reply-unavailable"]')?.textContent.trim() ?? null,
    popover: (() => { const open = document.querySelector("[popover]:popover-open"); if (!open) return null; const box = open.getBoundingClientRect();
      return { label: open.getAttribute("aria-label"), inViewport: box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth }; })(),
  };
}

async function whatsappScreenshots() {
  const outIndex = process.argv.indexOf("--whatsapp-chat") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--")
    ? process.argv[outIndex] : join(ROOT, "docs/design/evo-platform/implementation-screenshots/whatsapp-chat"));
  // Страницы и бандл — во временной папке: в репозиторий попадают только снимки.
  const workDir = join(require("node:os").tmpdir(), "evo-whatsapp-chat-render");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const bundleName = "whatsapp-chat-client.js";
  const css = await compileCss();
  await buildClientBundle(join(workDir, bundleName));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

  const htmlFor = {};
  for (const name of Object.keys(WA_SCENARIOS)) {
    const { actor, scenario, chatApp } = await buildWhatsAppPage(name);
    const pathname = "/v3/inbox";
    const search = searchOf(scenario);
    const markup = renderToString(shellTree({ actor, pathname, search, body: null, cabinet: null, chatApp }));
    const data = JSON.stringify({
      actor, pathname, search, body: null, cabinet: null, chatApp, rows: [], readAt: WA_READ_AT,
      pulse: { list: scenario.inbox.listPulse, chat: scenario.inbox.selected?.chat.pulse ?? null },
      older: { messages: [], hasOlder: false },
    }).replaceAll("<", "\\u003c");
    const htmlPath = join(workDir, `${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      `<html lang="ru" data-theme="${scenario.theme ?? "light"}" class="h-full antialiased">`,
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>WhatsApp — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${data}</script><script src="${bundleName}"></script></body></html>`,
    ].join(""));
    htmlFor[name] = htmlPath;
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (name, viewportKey) => {
    const context = await browser.newContext({ ...VIEWPORTS[viewportKey], colorScheme: WA_SCENARIOS[name].theme ?? "light" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(htmlFor[name]).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    await page.waitForTimeout(200);
    return { context, page, errors };
  };
  const close = async ({ context, page, errors }, label) => {
    const harness = await page.evaluate(() => window.__harness);
    const problems = [...errors.filter((message) => !/Failed to load resource|ERR_FILE_NOT_FOUND|#preview|#download/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };
  const shot = async (session, file) => {
    await session.page.screenshot({ path: join(outDir, file) });
    const metrics = await session.page.evaluate(whatsappMetrics);
    report({ file, ...metrics });
    check(metrics.overflowX === 0, `${file}: horizontal overflow ${metrics.overflowX}px`);
    check(metrics.textUnder12.length === 0, `${file}: texts under 12px ${metrics.textUnder12.join(", ")}`);
    check(metrics.smallTargets.length === 0, `${file}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
    check(metrics.solidRed <= 1, `${file}: ${metrics.solidRed} solid red controls`);
    return metrics;
  };

  try {
    for (const name of Object.keys(WA_SCENARIOS)) {
      for (const viewportKey of WA_SCENARIOS[name].viewports) {
        const file = `${name}-${viewportKey}.png`;
        const session = await open(name, viewportKey);
        const metrics = await shot(session, file);
        if (WA_SCENARIOS[name].inbox.selected) {
          check(metrics.feedAtBottom !== null && metrics.feedAtBottom <= 2, `${file}: the feed does not open on the newest message (${metrics.feedAtBottom})`);
          check(viewportKey !== "390" || !metrics.h1Visible, `${file}: the phone chat keeps the page title visible`);
        }
        // 07.10.2026: исправный WhatsApp не подписан, беда — видна; у каждого чата свой номер.
        if (WA_SCENARIOS[name].inbox.channelState === "ready") {
          check(metrics.channelLine === null && metrics.channelBanner === null, `${file}: a working channel is announced: ${metrics.channelLine ?? metrics.channelBanner}`);
        } else {
          check(metrics.channelLine === "WhatsApp требует проверки", `${file}: channel warning ${metrics.channelLine}`);
        }
        if (viewportKey === "1440" || !WA_SCENARIOS[name].inbox.selected) {
          check(JSON.stringify(metrics.listPhones) === JSON.stringify(WA_ROWS.map((row) => row.phone).filter(Boolean)), `${file}: list phones ${JSON.stringify(metrics.listPhones)}`);
          check(new Set(metrics.listPhones).size === metrics.listPhones.length, `${file}: two chats read the same`);
        }
        if (WA_SCENARIOS[name].inbox.selected) {
          const selectedRow = WA_SCENARIOS[name].inbox.selected;
          check(metrics.headerPhone === selectedRow.phone, `${file}: header phone ${metrics.headerPhone}`);
        }
        if (name === "chat") {
          check(metrics.composer?.inViewport === true, `${file}: composer not in the viewport ${JSON.stringify(metrics.composer)}`);
          check(JSON.stringify(metrics.days) === JSON.stringify(["4 октября", "Вчера", "Сегодня"]), `${file}: days ${JSON.stringify(metrics.days)}`);
          check(JSON.stringify(metrics.outgoing) === JSON.stringify(["unknown", "rejected", "stalled", "unknown"]), `${file}: outgoing ${JSON.stringify(metrics.outgoing)}`);
          // «Проверить» — у обоих неизвестных (и после «не найдено»); «Вернуть текст в поле» — у отклонённого и у проверенного через 5 минут.
          check(metrics.checks === 2 && metrics.returns === 2, `${file}: «Проверить» ${metrics.checks}, «Вернуть текст в поле» ${metrics.returns}`);
          check(["history", "client", "phone", "crm"].every((origin) => metrics.origins.includes(origin)), `${file}: origins ${JSON.stringify(metrics.origins)}`);
        }
        if (name === "no-client-message") {
          check(/Клиент ещё не писал в этот чат/u.test(metrics.unavailable ?? ""), `${file}: ${metrics.unavailable}`);
          check(metrics.selectedRow === "WhatsApp" && metrics.selectedPhone === "+996 ••• 55 48 21" && !metrics.waitingPill,
            `${file}: list selection ${metrics.selectedRow} ${metrics.selectedPhone}, waiting pill ${metrics.waitingPill}`);
        }
        if (name === "read-only") check(/Только просмотр/u.test(metrics.unavailable ?? ""), `${file}: ${metrics.unavailable}`);
        await close(session, file);
      }
    }

    // Окно шаблонов кнопкой «Шаблон» и «/» в пустом поле; вставка — без отправки.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open("chat", viewportKey);
      const { page } = session;
      await page.locator('[data-testid="v3-inbox-composer"] textarea').click();
      await page.keyboard.press("/");
      await page.waitForTimeout(150);
      const metrics = await shot(session, `picker-${viewportKey}.png`);
      check(metrics.popover?.label === "Шаблон ответа" && metrics.popover.inViewport, `picker-${viewportKey}: ${JSON.stringify(metrics.popover)}`);
      await page.getByRole("button", { name: "Вставить в текст" }).click();
      await page.waitForTimeout(150);
      const value = await page.locator('[data-testid="v3-inbox-composer"] textarea').inputValue();
      const harness = await close(session, `picker-${viewportKey}`);
      check(value.startsWith("Документы получили") && !harness.actions.some((action) => action.startsWith("send:")), `picker-${viewportKey}: inserted ${JSON.stringify(value.slice(0, 30))} ${JSON.stringify(harness.actions)}`);
    }

    // Отправка: Enter → «Отправляется…» → связь прервалась → «Повторить» тем же запросом.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open("chat", viewportKey);
      const { page } = session;
      const field = page.locator('[data-testid="v3-inbox-composer"] textarea');
      await field.click();
      await field.fill("Хорошо, тогда пришлю список вечером.");
      if (viewportKey === "1440") await page.keyboard.press("Enter");
      else await page.getByRole("button", { name: "Отправить" }).click();
      await page.waitForTimeout(200);
      const sending = await shot(session, `sending-${viewportKey}.png`);
      check(sending.outgoing.at(-1) === "sending", `sending-${viewportKey}: ${JSON.stringify(sending.outgoing)}`);
      check(await field.inputValue() === "", `sending-${viewportKey}: the field is not cleared`);
      await page.waitForTimeout(1700);
      const lost = await shot(session, `connection-lost-${viewportKey}.png`);
      check(lost.outgoing.at(-1) === "lost", `connection-lost-${viewportKey}: ${JSON.stringify(lost.outgoing)}`);
      await page.getByRole("button", { name: "Повторить" }).click();
      await page.waitForTimeout(100);
      const harness = await page.evaluate(() => window.__harness.actions);
      const sends = harness.filter((action) => action.startsWith("send:"));
      check(sends.length === 2 && sends[0] === sends[1], `retry-${viewportKey}: the retry must reuse the request id ${JSON.stringify(sends)}`);
      // «Проверить» у неизвестного результата: «Проверяем…», затем честная неудача.
      if (viewportKey === "1440") {
        await page.getByRole("button", { name: /Проверить результат сообщения от/u }).first().click();
        await page.waitForTimeout(150);
        await shot(session, "checking-1440.png");
        await page.waitForTimeout(1300);
        await shot(session, "check-failed-1440.png");
      }
      await close(session, `send-${viewportKey}`);
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`whatsapp chat checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, outDir })}\n`);
}

// --- «ИИ-агент» P1: окно ИИ в чате и раздел «ИИ-агент» (план ИИ-агента §12) ---
// Ответы, источники, документы, правила и расходы ВЫДУМАНЫ для проверки
// вёрстки; вузы и цены условные. Окно гидратируется настоящим клиентским
// компонентом; поток агента, сохранённый ответ и вставку отвечает синтетика
// вкладки (fixture.ai), ничего не отправляется. Раздел — настоящая страница
// `v3/ai-agent/page.tsx` с подменёнными чтениями, разметка сервера.
const AI_SECRET = "synthetic-harness-ai-agent-secret-000000000000";
const AI_ACTOR = { ...ACTORS.sales, permissionKeys: [...ACTORS.sales.permissionKeys, "ai.agent.use", "ai.agent.manage"] };
const AI_ADMIN = { ...ACTORS.admin };
const aiId = (n) => `eeeeeeee-7777-4777-8777-${String(n).padStart(12, "0")}`;
const AI_REPLY_PARTS = [
  ["Здравствуйте! Бакалавриат по компьютерным наукам в Малайзии стоит от 5 000 до 7 500 долларов в год — зависит от вуза.", 1],
  [" Без IELTS поступить можно: в двух вузах из подборки есть подготовительный курс английского перед первым семестром.", 2],
  [" Пришлю список таких программ сегодня.", null],
];
function aiReply() {
  let text = "";
  const marks = [];
  for (const [part, n] of AI_REPLY_PARTS) {
    const start = Array.from(text).length;
    text += part;
    if (n !== null) marks.push({ n, start, end: Array.from(text).length });
  }
  return { text, marks };
}
const AI_SOURCES = [
  { n: 1, chunk_id: 101, document_id: aiId(201), title: "Прайс 2026", audience: "client", page_from: 2, page_to: 2, sheet_name: null,
    section_path: "Прайс 2026 › Малайзия › Бакалавриат", live: true, missing: false, unverified: true, unverified_values: ["7 500"],
    quote: "Компьютерные науки, бакалавриат: от 5 000 до 7 500 USD в год в зависимости от вуза. Регистрационный сбор оплачивается отдельно и не возвращается. Цены действуют для набора 2026–2027 учебного года; общежитие в стоимость не входит и оплачивается напрямую вузу по его тарифам." },
  { n: 2, chunk_id: 102, document_id: aiId(202), title: "Вузы Малайзии — требования", audience: "client", page_from: null, page_to: null, sheet_name: "Языковые требования",
    section_path: "Требования › Английский язык", live: true, missing: false, unverified: false, unverified_values: [],
    quote: "Без IELTS: Университет Примерный и Колледж Условный принимают на подготовительный курс английского (один семестр) перед первым курсом." },
  { n: 3, chunk_id: 103, document_id: aiId(203), title: "Правила скидок", audience: "internal", page_from: 1, page_to: 1, sheet_name: null,
    section_path: "Скидки", live: true, missing: false, unverified: false, unverified_values: [],
    quote: "Скидку до 10% даёт только руководитель отдела продаж; клиенту сумму скидки до согласования не называем." },
];
function aiAnswer(overrides = {}) {
  const { text, marks } = aiReply();
  return {
    answerId: aiId(1), status: "ready", intent: "reply", current: true, createdAt: "2026-10-06T07:41:00Z", insertedAt: null, errorCode: null,
    result: {
      reply: text, reply_citations: marks, citations: [{ n: 1, chunk_id: 101 }, { n: 2, chunk_id: 102 }],
      reason: "Цены — из «Прайса 2026» (Малайзия, бакалавриат), требования к английскому — из листа «Языковые требования». Скидку клиенту не предлагаем: по внутренним правилам её согласует руководитель.",
      question: "На какой год поступления смотрите — 2027?", language: "ru", sources: AI_SOURCES, warnings: [],
    },
    ...overrides,
  };
}
const aiView = (answer, extra = {}) => ({
  view: { answer, latestInboundMessageId: waId(109), lastMessageDirection: "inbound", consentRecorded: true, ...extra.view },
  featureOn: extra.featureOn ?? true,
});
function aiFrames() {
  const { text } = aiReply();
  const chars = Array.from(text);
  const deltas = [];
  for (let at = 0; at < chars.length; at += 34) deltas.push({ delay: 160, event: "delta", data: { text: chars.slice(at, at + 34).join("") } });
  return [
    { delay: 50, event: "status", data: { stage: "searching" } },
    { delay: 1400, event: "sources", data: { count: 3 } },
    { delay: 50, event: "status", data: { stage: "writing" } },
    ...deltas,
    { delay: 200, event: "final", data: { answer: { answer_id: aiId(1) } } },
  ];
}
const NO_SOURCE_RESULT = {
  reply: "Уточню у коллег и вернусь с ответом сегодня до вечера.", reply_citations: [], citations: [],
  reason: "В материалах агента нет сведений об общежитиях этого вуза.", question: "Какой вуз из подборки вам ближе?", language: "ru",
  sources: [], warnings: [],
};
const AI_SCENARIOS = {
  // Свёрнуто: капсула в углу ленты; ничего не запрошено.
  "capsule": { viewports: ["1440", "390"], ai: { saved: [aiView(null)], post: [{ frames: aiFrames() }], insert: [{ status: 200, body: { text: "x" } }] } },
  // Открытие: сохранённого ответа нет, последнее — клиента → поток → готово.
  "stream": { viewports: ["1440", "390"], ai: { saved: [aiView(null), aiView(aiAnswer())], post: [{ frames: aiFrames() }], insert: [{ status: 200, body: { text: aiReply().text } }] } },
  // Повторное открытие: сохранённый ответ без нового запроса; вставка; затем 409.
  "ready": { viewports: ["1440", "390"], ai: { saved: [aiView(aiAnswer())], post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }],
    insert: [{ status: 200, body: { text: aiReply().text } }, { status: 409, body: { error: { code: "stale_answer" } } }] } },
  "no-sources": { viewports: ["1440"], ai: { saved: [aiView(aiAnswer({ result: NO_SOURCE_RESULT }))], post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  "waiting": { viewports: ["1440"], ai: { saved: [aiView(null, { view: { lastMessageDirection: "outbound" } })], post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  "off": { viewports: ["1440", "390"], featureOff: true, ai: { saved: [aiView(null, { featureOn: false })], post: [{ status: 503, body: { error: { code: "ai_agent_off" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  "consent": { viewports: ["1440"], ai: { saved: [aiView(null, { view: { consentRecorded: false } })], post: [{ status: 412, body: { error: { code: "consent_required" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  "unavailable": { viewports: ["1440"], ai: { saved: [aiView(null)], post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  "balance": { viewports: ["1440"], ai: { saved: [aiView(null)], post: [{ frames: [{ delay: 50, event: "status", data: { stage: "searching" } },
    { delay: 300, event: "error", data: { code: "gemini_billing", message_ru: "x", status: 402 } }] }], insert: [{ status: 200, body: { text: "x" } }] } },
  "rate": { viewports: ["1440"], ai: { saved: [aiView(null)], post: [{ status: 429, body: { error: { code: "rate_limited" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  // Страница отстала от базы (опрос не дошёл): билет берётся по базе, не по странице.
  "lagging": { viewports: ["1440"], ai: { latest: aiId(900),
    saved: [aiView(null, { view: { latestInboundMessageId: aiId(900) } }), aiView(aiAnswer(), { view: { latestInboundMessageId: aiId(900) } })],
    post: [{ frames: aiFrames() }], insert: [{ status: 200, body: { text: "x" } }] } },
  // Без агента открытое окно на новое сообщение перечитывает состояние, а не пустеет.
  "off-new-message": { viewports: ["1440"], featureOff: true, ai: { saved: [aiView(null, { featureOn: false })],
    post: [{ status: 503, body: { error: { code: "ai_agent_off" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
  // Согласие записали, пока окно было свёрнуто: повторное открытие перечитывает.
  "consent-later": { viewports: ["1440"], ai: { saved: [aiView(null, { view: { consentRecorded: false } }), aiView(aiAnswer())],
    post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }], insert: [{ status: 200, body: { text: "x" } }] } },
};

async function buildAiChatPage(name, scenario = AI_SCENARIOS[name]) {
  if (scenario.featureOff) delete process.env.EVO_AI_AGENT_INTERNAL_SECRET;
  else process.env.EVO_AI_AGENT_INTERNAL_SECRET = AI_SECRET;
  stubReads({ actor: AI_ACTOR, rows: ALL_ROWS, inbox: waView() });
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/inbox/page.tsx"));
  const element = await Page({ searchParams: Promise.resolve({ conversation: WA_CONVERSATION }) });
  const { children: inbox, ...main } = element.props;
  return { actor: AI_ACTOR, chatApp: { main, inbox: inbox.props } };
}

// Раздел: синтетические документы, правила, расходы, настройки.
const aiDoc = (n, title, fields = {}) => ({
  id: aiId(300 + n), title, kind: "knowledge", audience: "client", autosendAllowed: false, status: "ready", stage: null, progress: 100,
  errorCode: null, source: "seed_kb", sourceRef: { nodeId: aiId(400 + n), nodeVersion: 2 }, editedInLab: false, docVersion: 1, rowVersion: 3,
  pageCount: null, replacesId: null, supersededById: null, createdAt: "2026-10-06T05:00:00Z", updatedAt: `2026-10-06T0${Math.min(n, 7)}:12:00Z`,
  indexedAt: "2026-10-06T05:10:00Z", chunkCount: 12 + n * 3, openReviewCount: 0, ...fields,
});
const AI_DOCUMENTS = { items: [
  aiDoc(7, "Прайс 2026 — Малайзия, Китай, ОАЭ", { kind: "pdf", source: "upload", sourceRef: {}, pageCount: 14, chunkCount: 48 }),
  aiDoc(6, "Как отвечать на вопрос о цене", { audience: "internal", chunkCount: 9 }),
  aiDoc(5, "Вузы Малайзии — требования", { status: "processing", stage: "embed", progress: 60, chunkCount: 0, indexedAt: null }),
  aiDoc(4, "Правила скидок", { audience: "internal", chunkCount: 4 }),
  aiDoc(3, "Визы: сроки и документы", { status: "failed", stage: "embed", progress: 60, errorCode: "embedding_unavailable", chunkCount: 0 }),
  aiDoc(2, "Услуги и условия EVO", { chunkCount: 21 }),
  aiDoc(1, "Частые вопросы родителей", { status: "queued", stage: null, progress: 0, chunkCount: 0 }),
], hasMore: false, canManage: true, isAdmin: false };
const AI_RULES_BODY = [
  "# Правила общения EVO",
  "",
  "Тон — вежливый и тёплый, на «вы». Коротко: два-три предложения, без канцелярита.",
  "Отвечаем на языке клиента: русский, кыргызский или английский.",
  "",
  "## Цены",
  "Называем цену «от … до …» из прайса и всегда уточняем вуз и программу. Скидки не обещаем — их согласует руководитель.",
  "",
  "## Квалификация",
  "Узнаём: страну, ступень (бакалавриат, магистратура), год поступления, бюджет, уровень английского, кто принимает решение.",
].join("\n");
const AI_RULES = {
  current: { id: aiId(501), version: 3, body: AI_RULES_BODY, source: "seed", sourceRef: {}, createdAt: "2026-10-06T05:20:00Z",
    createdByName: "Администратор (синтетический)", confirmedAt: null, confirmedByName: null, needsReview: true },
  versions: [
    { id: aiId(501), version: 3, source: "seed", createdAt: "2026-10-06T05:20:00Z", createdByName: "Администратор (синтетический)", confirmedAt: null, bytes: 1180, current: true },
    { id: aiId(502), version: 2, source: "manual", createdAt: "2026-10-05T11:02:00Z", createdByName: "Менеджер продаж (синтетический)", confirmedAt: "2026-10-05T12:00:00Z", bytes: 960, current: false },
    { id: aiId(503), version: 1, source: "seed", createdAt: "2026-10-04T09:30:00Z", createdByName: "Администратор (синтетический)", confirmedAt: "2026-10-04T10:00:00Z", bytes: 720, current: false },
  ],
  canManage: true,
};
const AI_SPEND = {
  currency: "USD", timezone: "Asia/Bishkek", today: "2026-10-06", monthStart: "2026-10-01", todayUsd: 0.4132, monthUsd: 1.9471,
  monthEstimatedUsd: 0.0214, monthEstimated: true, forecastUsd: 10.06, monthlyCapUsd: 50, reservedUsd: 0.06, remainingUsd: 47.99,
  answers: 164, averageAnswerUsd: 0.0109,
  byPurpose: [],
  byGroup: [
    { group: "answers", usd: 1.6123, calls: 164, estimated: false },
    { group: "search", usd: 0.1748, calls: 290, estimated: true },
    { group: "documents", usd: 0.1406, calls: 37, estimated: true },
    { group: "probe", usd: 0, calls: 6, estimated: false },
  ],
  days: [],
  priceChanges: [
    { model: "gemini-3.8-flash", kind: "input", effectiveFrom: "2027-01-01", usdPerMillion: 1.5, previousUsdPerMillion: 0.75 },
    { model: "gemini-3.8-flash", kind: "output", effectiveFrom: "2027-01-01", usdPerMillion: 7.5, previousUsdPerMillion: 3.75 },
  ],
};
const aiSettings = (fields = {}) => ({
  version: 7, models: { answer: "gemini-3.8-flash", fast: "gemini-3.5-flash-lite", vision: "gemini-3.8-flash", arbiter: "gemini-3.8-pro", arbiterFallback: "gemini-3.8-flash", embedding: "gemini-embedding-2" },
  unpricedModels: [], embeddingDim: 1536, monthlyCapUsd: 50, ratePerMemberMinute: 20, timezone: "Asia/Bishkek", rerankMode: "off",
  precomputeEnabled: false, memoryEnabled: false, knowledgeVersion: 14,
  consent: { recorded: true, at: "2026-10-06T04:30:00Z", byName: "Администратор (синтетический)", textVersion: "gemini-v1-2026-10-06" },
  canManage: true, isAdmin: false, ...fields,
});
const { normalizeAiDocuments, normalizeAiRules, normalizeAiSettings, normalizeAiSpend } = require(join(ROOT, "src/lib/v3/ai-agent.ts"));
const available = (normalize, value) => ({ status: "available", data: normalize(value) });
const AI_SECTION_SCENARIOS = {
  "section-documents": { actor: AI_ACTOR, section: "documents", viewports: ["1440", "390"] },
  "section-documents-empty": { actor: AI_ACTOR, section: "documents", viewports: ["1440"], documents: { items: [], hasMore: false, canManage: true, isAdmin: false } },
  "section-rules": { actor: AI_ACTOR, section: "rules", viewports: ["1440", "390"] },
  "section-spend": { actor: AI_ACTOR, section: "spend", viewports: ["1440", "390"] },
  "section-consent": { actor: AI_ADMIN, section: "documents", viewports: ["1440"], featureOff: true,
    settings: aiSettings({ isAdmin: true, consent: { recorded: false, at: null, byName: null, textVersion: null } }) },
};

async function buildAiSectionMarkup(name, scenario = AI_SECTION_SCENARIOS[name]) {
  if (scenario.featureOff) delete process.env.EVO_AI_AGENT_INTERNAL_SECRET;
  else process.env.EVO_AI_AGENT_INTERNAL_SECRET = AI_SECRET;
  stubReads({ actor: scenario.actor, rows: ALL_ROWS });
  const source = require(join(ROOT, "src/lib/v3/ai-agent-source.ts"));
  source.readAiSettings = async () => available(normalizeAiSettings, scenario.settings ?? aiSettings());
  source.readAiDocuments = async () => available(normalizeAiDocuments, scenario.documents ?? AI_DOCUMENTS);
  source.readAiRules = async () => available(normalizeAiRules, AI_RULES);
  source.readAiSpend = async () => available(normalizeAiSpend, AI_SPEND);
  require(join(ROOT, "src/lib/server/ai-agent-route-handlers.ts")).readAiAgentStatus = async () => (
    scenario.featureOff ? { state: "off" } : { state: "ready", keyAccepted: true, model: "gemini-3.8-flash", block: null });
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/ai-agent/page.tsx"));
  const search = scenario.section === "documents" ? {} : { section: scenario.section };
  const element = await Page({ searchParams: Promise.resolve(search) });
  return { actor: scenario.actor, search: new URLSearchParams(search).toString(), body: renderToStaticMarkup(withContexts(element, "/v3/ai-agent", new URLSearchParams(search).toString())) };
}

function aiMetrics() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const main = [...document.querySelectorAll("main")].find(visible);
  const inMain = main ? [...main.querySelectorAll("*")].filter(visible) : [];
  const texts = inMain.filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  // Номер источника в тексте — строчная цель внутри предложения (WCAG 2.5.8, «inline»).
  const targets = main ? [...main.querySelectorAll("a, button, select, input:not([type=hidden])")]
    .filter((element) => visible(element) && !element.closest("[popover]") && !element.matches(".v3-ai-mark")) : [];
  const box = (selector) => { const element = document.querySelector(selector); if (!visible(element)) return null; const rect = element.getBoundingClientRect(); return { top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }; };
  const composer = box('[data-testid="v3-inbox-composer"]');
  const win = box('[data-testid="v3-ai-window"]');
  const feed = box('[role="log"]');
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    textUnder12: texts.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => element.textContent.trim().slice(0, 20)),
    smallTargets: targets.filter((element) => element.getBoundingClientRect().height < 44).map((element) => element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)),
    solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
    capsule: box('[data-testid="v3-ai-capsule"]'),
    window: win,
    feed,
    composer,
    windowInsideFeed: win && feed ? win.top >= feed.top - 1 && win.bottom <= feed.bottom + 1 && win.left >= feed.left - 1 && win.right <= feed.right + 1 : null,
    status: document.querySelector('[data-testid="v3-ai-window"] [role="status"]')?.textContent.trim() ?? null,
    blocked: document.querySelector('[data-testid="v3-ai-blocked"]')?.dataset.code ?? null,
    error: document.querySelector('[data-testid="v3-ai-error"]')?.dataset.code ?? null,
    errorText: document.querySelector('[data-testid="v3-ai-error"] [role="alert"]')?.textContent.trim() ?? null,
    marks: [...document.querySelectorAll('[data-testid="v3-ai-reply"] .v3-ai-mark')].map((element) => element.textContent.trim()),
    sources: [...document.querySelectorAll('[data-testid="v3-ai-sources"] > li')].map((element) => element.dataset.sourceN),
    warnings: [...document.querySelectorAll('[data-testid="v3-ai-warnings"] li')].map((element) => element.textContent.trim()),
    insertDisabled: (() => { const button = document.querySelector('[data-testid="v3-ai-insert"]'); return button ? button.disabled || button.getAttribute("aria-disabled") === "true" : null; })(),
    draft: document.querySelector('[data-testid="v3-inbox-composer"] textarea')?.value ?? null,
    focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30) ?? null,
  };
}

async function aiScreenshots() {
  const outIndex = process.argv.indexOf("--ai-agent") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--")
    ? process.argv[outIndex] : join(ROOT, "docs/design/evo-platform/implementation-screenshots/ai-agent"));
  const workDir = join(require("node:os").tmpdir(), "evo-ai-agent-render");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const bundleName = "ai-agent-client.js";
  const css = await compileCss();
  await buildClientBundle(join(workDir, bundleName));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const page = (name, title, markup, data) => {
    const htmlPath = join(workDir, `${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>${title} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="${bundleName}"></script></body></html>`,
    ].join(""));
    return htmlPath;
  };

  const htmlFor = {};
  for (const name of Object.keys(AI_SCENARIOS)) {
    const { actor, chatApp } = await buildAiChatPage(name);
    const search = `conversation=${WA_CONVERSATION}`;
    const markup = renderToString(shellTree({ actor, pathname: "/v3/inbox", search, body: null, cabinet: null, chatApp }));
    htmlFor[name] = page(`chat-${name}`, "WhatsApp", markup, {
      actor, pathname: "/v3/inbox", search, body: null, cabinet: null, chatApp, rows: [], readAt: WA_READ_AT,
      pulse: { list: "0000000000000002", chat: "0000000000000001" }, older: { messages: [], hasOlder: false }, ai: AI_SCENARIOS[name].ai,
    });
  }
  for (const name of Object.keys(AI_SECTION_SCENARIOS)) {
    const { actor, search, body } = await buildAiSectionMarkup(name);
    const markup = renderToString(shellTree({ actor, pathname: "/v3/ai-agent", search, body, cabinet: null }));
    htmlFor[name] = page(name, "ИИ-агент", markup, { actor, pathname: "/v3/ai-agent", search, body, cabinet: null, rows: [], readAt: WA_READ_AT });
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (name, viewportKey) => {
    const context = await browser.newContext({ ...VIEWPORTS[viewportKey], colorScheme: "light" });
    const session = await context.newPage();
    const errors = [];
    session.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    session.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await session.goto(pathToFileURL(htmlFor[name]).href, { waitUntil: "load" });
    await session.evaluate(() => document.fonts.ready);
    await session.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    await session.waitForTimeout(200);
    return { context, page: session, errors };
  };
  const close = async ({ context, page: session, errors }, label) => {
    const harness = await session.evaluate(() => window.__harness);
    const problems = [...errors.filter((message) => !/Failed to load resource|ERR_FILE_NOT_FOUND|#preview|#download/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };
  const shot = async (session, file, { save = true } = {}) => {
    if (save) await session.page.screenshot({ path: join(outDir, file) });
    const metrics = await session.page.evaluate(aiMetrics);
    report({ file, ...metrics });
    check(metrics.overflowX === 0, `${file}: horizontal overflow ${metrics.overflowX}px`);
    check(metrics.textUnder12.length === 0, `${file}: texts under 12px ${metrics.textUnder12.join(", ")}`);
    check(metrics.smallTargets.length === 0, `${file}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
    check(metrics.solidRed <= 1, `${file}: ${metrics.solidRed} solid red controls`);
    if (metrics.window) check(metrics.windowInsideFeed === true, `${file}: the window leaves the feed ${JSON.stringify([metrics.window, metrics.feed])}`);
    if (metrics.window && metrics.composer) check(metrics.window.bottom <= metrics.composer.top + 1, `${file}: the window covers the composer`);
    return metrics;
  };
  const expand = async (session) => {
    await session.page.getByRole("button", { name: "Помочь с ответом — открыть помощника" }).click();
    await session.page.waitForTimeout(260);
  };

  try {
    // Свёрнуто: только капсула, ни одного запроса.
    for (const viewportKey of AI_SCENARIOS.capsule.viewports) {
      const session = await open("capsule", viewportKey);
      const metrics = await shot(session, `capsule-${viewportKey}.png`);
      check(metrics.capsule !== null && metrics.window === null, `capsule-${viewportKey}: ${JSON.stringify(metrics.capsule)}`);
      const harness = await close(session, `capsule-${viewportKey}`);
      check(!harness.actions.some((action) => action.startsWith("ai-")), `capsule-${viewportKey}: a collapsed window asked ${JSON.stringify(harness.actions)}`);
    }

    // Поток: «Ищу в материалах…» → «Пишу ответ…» → «Ответ готов · 3 источника».
    for (const viewportKey of AI_SCENARIOS.stream.viewports) {
      const session = await open("stream", viewportKey);
      await expand(session);
      const searching = await shot(session, `stream-searching-${viewportKey}.png`, { save: viewportKey === "1440" });
      check(searching.status === "Ищу в материалах…", `stream-${viewportKey}: ${searching.status}`);
      await session.page.waitForTimeout(2100);
      const writing = await shot(session, `stream-writing-${viewportKey}.png`, { save: viewportKey === "1440" });
      check(/^Пишу ответ… · 3 источника$/u.test(writing.status ?? ""), `stream-${viewportKey}: ${writing.status}`);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]', { timeout: 8000 });
      await session.page.waitForTimeout(150);
      const ready = await shot(session, `stream-ready-${viewportKey}.png`);
      check(ready.status === "Ответ готов · 3 источника", `stream-${viewportKey}: ${ready.status}`);
      check(JSON.stringify(ready.marks) === JSON.stringify(["1", "2"]), `stream-${viewportKey}: marks ${JSON.stringify(ready.marks)}`);
      check(JSON.stringify(ready.sources) === JSON.stringify(["1", "2", "3"]), `stream-${viewportKey}: sources ${JSON.stringify(ready.sources)}`);
      check(JSON.stringify(ready.warnings) === JSON.stringify(["Число в источнике ещё не проверено"]), `stream-${viewportKey}: warnings ${JSON.stringify(ready.warnings)}`);
      const harness = await close(session, `stream-${viewportKey}`);
      check(JSON.stringify(harness.actions) === JSON.stringify(["ai-read", "ai-answer:reply", "ai-read"]), `stream-${viewportKey}: ${JSON.stringify(harness.actions)}`);
    }

    // Сохранённый ответ: номер источника, «Почему такой ответ», вставка без отправки, затем 409.
    for (const viewportKey of AI_SCENARIOS.ready.viewports) {
      const session = await open("ready", viewportKey);
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
      await session.page.locator(".v3-ai-mark", { hasText: "1" }).first().click();
      await session.page.locator(".v3-ai-why summary").click();
      await session.page.waitForTimeout(250);
      const opened = await shot(session, `ready-sources-${viewportKey}.png`);
      check(opened.status === "Ответ готов · 3 источника", `ready-${viewportKey}: ${opened.status}`);
      await session.page.getByTestId("v3-ai-insert").click();
      await session.page.waitForTimeout(250);
      const inserted = await shot(session, `ready-inserted-${viewportKey}.png`, { save: viewportKey === "1440" });
      check((inserted.draft ?? "").startsWith("Здравствуйте! Бакалавриат"), `ready-${viewportKey}: draft ${JSON.stringify(inserted.draft?.slice(0, 40))}`);
      await session.page.getByTestId("v3-ai-insert").click();
      await session.page.waitForTimeout(250);
      const stale = await shot(session, `ready-stale-${viewportKey}.png`, { save: viewportKey === "1440" });
      check(stale.insertDisabled === true && stale.status === "Ответ устарел", `ready-${viewportKey}: stale ${stale.insertDisabled} ${stale.status}`);
      // Устаревший ответ держит фокус на «Вставить в ответ» (aria-disabled); Esc
      // сворачивает окно, фокус — на капсуле.
      const focused = await session.page.evaluate(() => document.activeElement?.dataset.testid ?? null);
      check(focused === "v3-ai-insert", `ready-${viewportKey}: focus after 409 ${focused}`);
      await session.page.keyboard.press("Escape");
      await session.page.waitForTimeout(100);
      const collapsed = await session.page.evaluate(aiMetrics);
      check(collapsed.window === null && collapsed.focus === "Помочь с ответом — открыть помощника", `ready-${viewportKey}: Esc ${collapsed.focus}`);
      const harness = await close(session, `ready-${viewportKey}`);
      check(JSON.stringify(harness.actions) === JSON.stringify(["ai-read", "ai-insert:reply", "ai-insert:reply"]), `ready-${viewportKey}: ${JSON.stringify(harness.actions)}`);
      check(!harness.actions.some((action) => action.startsWith("send:")), `ready-${viewportKey}: something was sent`);
    }

    // Перетаскивание мышью и стрелками; позиция в пределах ленты.
    {
      const session = await open("ready", "1440");
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
      const before = (await session.page.evaluate(aiMetrics)).window;
      const head = session.page.locator(".v3-ai-head h2");
      const point = await head.boundingBox();
      await session.page.mouse.move(point.x + 20, point.y + 10);
      await session.page.mouse.down();
      await session.page.mouse.move(point.x - 260, point.y - 2000, { steps: 8 });
      await session.page.mouse.up();
      await session.page.waitForTimeout(120);
      const dragged = await shot(session, "drag-1440.png");
      check(dragged.window.left < before.left - 200 && dragged.windowInsideFeed === true, `drag: ${JSON.stringify([before, dragged.window])}`);
      await session.page.getByRole("button", { name: /Переместить окно/u }).focus();
      await session.page.keyboard.press("Home");
      await session.page.waitForTimeout(80);
      const home = (await session.page.evaluate(aiMetrics)).window;
      check(Math.abs(home.right - before.right) <= 1 && Math.abs(home.bottom - before.bottom) <= 1, `drag Home: ${JSON.stringify([before, home])}`);
      await close(session, "drag-1440");
    }

    // Честные состояния.
    const states = [
      ["no-sources", (metrics) => metrics.warnings[0] === "Проверьте факты — источники не найдены" && metrics.status === "Ответ готов · без источников"],
      ["waiting", (metrics) => metrics.status === "Ждём ответ клиента"],
      ["off", (metrics) => metrics.blocked === "ai_agent_off"],
      ["consent", (metrics) => metrics.blocked === "consent_required"],
      ["unavailable", (metrics) => metrics.error === "agent_unavailable" && metrics.errorText === "ИИ-агент сейчас недоступен."],
      ["balance", (metrics) => metrics.error === "gemini_billing" && metrics.errorText === "Закончился оплаченный баланс Gemini. Пополните его в Google Cloud."],
      ["rate", (metrics) => metrics.error === "rate_limited" && metrics.errorText === "Слишком много запросов. Подождите минуту."],
    ];
    for (const [name, ok] of states) {
      for (const viewportKey of AI_SCENARIOS[name].viewports) {
        const session = await open(name, viewportKey);
        await expand(session);
        await session.page.waitForTimeout(name === "balance" ? 700 : 300);
        const metrics = await shot(session, `state-${name}-${viewportKey}.png`);
        check(ok(metrics), `state-${name}-${viewportKey}: ${JSON.stringify({ status: metrics.status, blocked: metrics.blocked, error: metrics.error, text: metrics.errorText, warnings: metrics.warnings })}`);
        await close(session, `state-${name}-${viewportKey}`);
      }
    }

    // Отставшая страница: один запрос с билетом по базе, без «пришло новое сообщение».
    {
      const session = await open("lagging", "1440");
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]', { timeout: 8000 });
      await session.page.waitForTimeout(150);
      const metrics = await shot(session, "lagging-1440.png", { save: false });
      check(metrics.status === "Ответ готов · 3 источника", `lagging: ${metrics.status}`);
      const harness = await close(session, "lagging-1440");
      check(JSON.stringify(harness.actions) === JSON.stringify(["ai-read", "ai-answer:reply", "ai-read"]), `lagging: ${JSON.stringify(harness.actions)}`);
      check(JSON.stringify(harness.aiRefs) === JSON.stringify([aiId(900)]), `lagging: refs ${JSON.stringify(harness.aiRefs)}`);
    }

    // Без агента: новое сообщение при открытом окне — снова «не подключён», не пустое окно.
    {
      const session = await open("off-new-message", "1440");
      await expand(session);
      await session.page.waitForTimeout(300);
      check((await session.page.evaluate(aiMetrics)).blocked === "ai_agent_off", "off-new-message: before");
      await session.page.evaluate((id) => window.__harness.newInbound(id), aiId(901));
      await session.page.waitForTimeout(300);
      const metrics = await shot(session, "off-new-message-1440.png", { save: false });
      check(metrics.blocked === "ai_agent_off", `off-new-message: after ${JSON.stringify({ status: metrics.status, blocked: metrics.blocked })}`);
      const harness = await close(session, "off-new-message-1440");
      check(JSON.stringify(harness.actions) === JSON.stringify(["ai-read", "ai-read"]), `off-new-message: ${JSON.stringify(harness.actions)}`);
    }

    // «Нет согласия» → свернуть → администратор включил → открыть: ответ без перезагрузки страницы.
    {
      const session = await open("consent-later", "1440");
      await expand(session);
      await session.page.waitForTimeout(300);
      check((await session.page.evaluate(aiMetrics)).blocked === "consent_required", "consent-later: before");
      await session.page.keyboard.press("Escape");
      await session.page.waitForTimeout(100);
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]', { timeout: 4000 });
      const metrics = await shot(session, "consent-later-1440.png", { save: false });
      check(metrics.status === "Ответ готов · 3 источника", `consent-later: ${metrics.status}`);
      const harness = await close(session, "consent-later-1440");
      check(JSON.stringify(harness.actions) === JSON.stringify(["ai-read", "ai-read"]), `consent-later: ${JSON.stringify(harness.actions)}`);
    }

    // Раздел «ИИ-агент».
    for (const name of Object.keys(AI_SECTION_SCENARIOS)) {
      for (const viewportKey of AI_SECTION_SCENARIOS[name].viewports) {
        const session = await open(name, viewportKey);
        await shot(session, `${name}-${viewportKey}.png`);
        await close(session, `${name}-${viewportKey}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`ai agent checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, outDir })}\n`);
}

// --- «ИИ-агент» P3: «Что ИИ знает о клиенте» и «Память о клиенте» -------------------
// Память, сводка, интерес и карточка лида ВЫДУМАНЫ (тот же синтетический чат
// «Аружан Примерова»); чтение и «Забыть сводку» отвечает синтетика вкладки
// (fixture.ai.memory / memoryClear), ни базы, ни агента, ни Gemini.
const MEMORY_SUMMARY = [
  "Ищет бакалавриат по компьютерным наукам в Малайзии, начало — сентябрь 2027 года.",
  "Бюджет — до 6 000 $ в год вместе с общежитием. IELTS нет, английский средний: подходит подготовительный курс.",
  "Предложили три вуза из подборки; клиент прислал фото аттестата. Решение принимает вместе с родителями.",
  "Договорились: пришлём требования и сравнение общежитий. Выяснить: успеет ли оплатить регистрационный сбор до конца ноября и нужен ли перевод аттестата.",
].join(" ");
// Форма ai_agent_memory_v1 (274): active — включена и согласие записано;
// summaryDue/interestDue база отдаёт только при active.
const memoryView = (fields = {}) => ({ status: 200, body: { memory: {
  enabled: true, consentRecorded: true, active: true, canManage: true, messageCount: 45, summaryDue: false, interestDue: false,
  memory: { interest: "Бакалавриат по компьютерным наукам в Малайзии, без IELTS, до 6 000 $ в год", summary: MEMORY_SUMMARY, coveredCount: 25, updatedAt: "2026-10-06T08:20:00Z" },
  lead: { name: "Аружан", interestDirection: "MY", stage: "qualified" },
  ...fields,
} } });
const memoryAi = (memory, extra = {}) => ({
  saved: [aiView(aiAnswer())], post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }],
  insert: [{ status: 200, body: { text: "x" } }], memory, ...extra,
});
const AI_P3_CHAT = {
  "memory-ready": { viewports: ["1440", "390"], ai: memoryAi([memoryView()]) },
  // clear в 274 сразу ставит пересборку (enqueued): строки памяти нет, сводку и интерес пора собрать.
  "memory-forget": { viewports: ["1440"], ai: memoryAi([memoryView(), memoryView({ memory: null, summaryDue: true, interestDue: true })],
    { memoryClear: [{ status: 200, body: { deleted: true, enqueued: true } }] }) },
  "memory-off": { viewports: ["1440", "390"], ai: memoryAi([memoryView({ enabled: false, active: false, memory: null })]) },
  "memory-off-no-consent": { viewports: ["1440"], ai: memoryAi([memoryView({ enabled: false, consentRecorded: false, active: false, memory: null })]) },
  // Защитное: в 274 отзыв выключает память, но если база ответит «включена без согласия» — пауза.
  "memory-paused": { viewports: ["1440", "390"], ai: memoryAi([memoryView({ consentRecorded: false, active: false, memory: null })]) },
  "memory-short": { viewports: ["1440"], ai: memoryAi([memoryView({ messageCount: 12, memory: null, lead: null })]) },
  // 23 сообщения: за окном 3 < 6 — summaryDue false.
  "memory-waiting": { viewports: ["1440"], ai: memoryAi([memoryView({ messageCount: 23, memory: null })]) },
  // Ни интереса, ни сводки — memory NULL (ai_agent_memory_v1 не отдаёт пустой объект).
  "memory-due": { viewports: ["1440"], ai: memoryAi([memoryView({ summaryDue: true, memory: null })]) },
  "memory-failed": { viewports: ["1440"], ai: memoryAi([{ status: 503, body: { error: { code: "unavailable" } } }, memoryView()]) },
  "memory-denied": { viewports: ["1440"], ai: memoryAi([{ status: 403, body: { error: { code: "forbidden" } } }]) },
};
const AI_P3_SECTION = {
  "section-memory-off": { actor: AI_ACTOR, section: "spend", viewports: ["1440", "390"], settings: aiSettings({ memoryEnabled: false }) },
  "section-memory-on": { actor: AI_ACTOR, section: "spend", viewports: ["1440", "390"], settings: aiSettings({ memoryEnabled: true }) },
  "section-memory-no-consent": { actor: AI_ACTOR, section: "spend", viewports: ["1440"],
    settings: aiSettings({ memoryEnabled: false, consent: { recorded: false, at: null, byName: null, textVersion: null } }) },
  // Админ раскрывает «Отозвать согласие» при включённой памяти: последствия для памяти — до кнопки (274).
  "section-consent-revoke": { actor: AI_ACTOR, section: "spend", viewports: ["1440", "390"], settings: aiSettings({ memoryEnabled: true, isAdmin: true }) },
};

// Переключатель «Память о клиенте» вживую: настоящий AiMemoryToggle, а запись —
// синтетическая (базы и server action нет): через 150 мс положение меняется,
// как после revalidatePath, и возвращается «saved». Проверяется то, что ломалось:
// итог «Память включена.» / «Память выключена, сводки удалены.» и фокус
// переживают смену вида; второй запрос — с новым id и новой версией.
const TOGGLE_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AiMemoryToggle } = require("@/components/v3/ai-agent/AiMemoryToggle");
const { btnGhostCls } = require("@/components/ui");
const h = React.createElement;
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [], aiRefs: [], memory: [], refreshes: 0, polls: 0 };
function Section() {
  const [settings, setSettings] = React.useState({ enabled: false, version: 7 });
  React.useEffect(() => { document.documentElement.dataset.hydrated = "true"; }, []);
  const action = async (_previous, form) => {
    window.__harness.actions.push(["memory", form.get("memory_action"), form.get("expected_version"), form.get("request_id")].join(":"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const enabled = form.get("memory_action") === "enable";
    setSettings((current) => ({ enabled, version: current.version + 1 }));
    return { status: "saved", requestId: form.get("request_id") };
  };
  return h("section", { id: "ai-memory", className: "space-y-2", "data-testid": "v3-ai-memory-settings", "data-enabled": String(settings.enabled) },
    h("h3", { className: "t-item text-fg" }, "Память о клиенте"),
    h("p", { className: "t-body-compact text-fg-2" }, settings.enabled ? "включена" : "выключена"),
    h(AiMemoryToggle, { enabled: settings.enabled, consentRecorded: true, version: settings.version,
      requestId: "27400000-0000-4000-8000-000000000071", action, buttonClassName: btnGhostCls }));
}
createRoot(document.getElementById("root")).render(
  h("div", { className: "v3-world", "data-surface": "staff" }, h("main", { className: "mx-auto max-w-3xl p-6" }, h(Section))));
`;

function memoryMetrics() {
  const block = document.querySelector('[data-testid="v3-ai-memory"]');
  const text = (selector) => block?.querySelector(selector)?.textContent.trim() ?? null;
  const rect = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return { top: Math.round(box.top), height: Math.round(box.height), width: Math.round(box.width) }; };
  const summary = block?.querySelector('[data-testid="v3-ai-memory-summary"]');
  const settings = document.querySelector('[data-testid="v3-ai-memory-settings"]');
  return {
    state: block?.dataset.state ?? null,
    open: block ? block.open === true : null,
    hint: text('[data-testid="v3-ai-memory-hint"]'),
    hintVisible: (() => { const hint = block?.querySelector('[data-testid="v3-ai-memory-hint"]'); return hint ? getComputedStyle(hint).display !== "none" : null; })(),
    paused: text('[data-testid="v3-ai-memory-paused"]'),
    retry: [...(block?.querySelectorAll("button") ?? [])].some((button) => button.textContent.trim() === "Повторить"),
    enableLink: !!block?.querySelector('a[href="/v3/ai-agent?section=spend#ai-memory"]'),
    interest: text('[data-testid="v3-ai-memory-interest"]'),
    summaryClamped: summary ? summary.hasAttribute("data-clamped") : null,
    summaryOverflows: summary ? summary.scrollHeight > summary.clientHeight + 1 : null,
    summaryState: text('[data-testid="v3-ai-memory-summary-state"]'),
    lead: text('[data-testid="v3-ai-memory-lead"]'),
    meta: text('[data-testid="v3-ai-memory-meta"]'),
    note: text('[data-testid="v3-ai-memory-note"]'),
    off: text('[data-testid="v3-ai-memory-off"]'),
    confirm: text('[data-testid="v3-ai-memory-confirm"]'),
    failedText: block?.dataset.state === "failed" || block?.dataset.state === "denied" ? block.textContent.trim() : null,
    alert: !!block?.querySelector('[role="alert"]'),
    block: rect(block),
    answer: !!document.querySelector('[data-testid="v3-ai-answer"]'),
    settings: settings ? {
      enabled: settings.dataset.enabled, text: settings.textContent.replace(/\s+/gu, " ").trim(),
      status: settings.querySelector('[data-testid="v3-ai-memory-status"]')?.textContent.trim() ?? null,
      focus: document.activeElement && settings.contains(document.activeElement) ? document.activeElement.textContent.trim() : null,
      buttons: [...settings.querySelectorAll("button, summary")].map((element) => ({ text: element.textContent.trim(), disabled: element.getAttribute("aria-disabled") === "true" || element.disabled === true })),
    } : null,
  };
}

async function aiP3Screenshots() {
  const outIndex = process.argv.indexOf("--ai-agent-p3") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--")
    ? process.argv[outIndex] : join(ROOT, "docs/design/evo-platform/implementation-screenshots/ai-agent-p3"));
  const workDir = join(require("node:os").tmpdir(), "evo-ai-agent-p3-render");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const bundleName = "ai-agent-p3-client.js";
  const css = await compileCss();
  await buildClientBundle(join(workDir, bundleName));
  await buildClientBundle(join(workDir, "ai-agent-p3-toggle.js"), TOGGLE_ENTRY);
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const htmlFor = {};
  const page = (name, title, markup, data) => {
    const htmlPath = join(workDir, `${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>${title} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="${bundleName}"></script></body></html>`,
    ].join(""));
    return htmlPath;
  };
  for (const [name, scenario] of Object.entries(AI_P3_CHAT)) {
    const { actor, chatApp } = await buildAiChatPage(name, scenario);
    const search = `conversation=${WA_CONVERSATION}`;
    const markup = renderToString(shellTree({ actor, pathname: "/v3/inbox", search, body: null, cabinet: null, chatApp }));
    htmlFor[name] = page(`chat-${name}`, "WhatsApp", markup, {
      actor, pathname: "/v3/inbox", search, body: null, cabinet: null, chatApp, rows: [], readAt: WA_READ_AT,
      pulse: { list: "0000000000000002", chat: "0000000000000001" }, older: { messages: [], hasOlder: false }, ai: scenario.ai,
    });
  }
  for (const [name, scenario] of Object.entries(AI_P3_SECTION)) {
    const { actor, search, body } = await buildAiSectionMarkup(name, scenario);
    const markup = renderToString(shellTree({ actor, pathname: "/v3/ai-agent", search, body, cabinet: null }));
    htmlFor[name] = page(name, "ИИ-агент", markup, { actor, pathname: "/v3/ai-agent", search, body, cabinet: null, rows: [], readAt: WA_READ_AT });
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (name, viewportKey) => {
    const context = await browser.newContext({ ...VIEWPORTS[viewportKey], colorScheme: "light" });
    const session = await context.newPage();
    const errors = [];
    session.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    session.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await session.goto(pathToFileURL(htmlFor[name]).href, { waitUntil: "load" });
    await session.evaluate(() => document.fonts.ready);
    await session.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    await session.waitForTimeout(200);
    return { context, page: session, errors };
  };
  const close = async ({ context, page: session, errors }, label) => {
    const harness = await session.evaluate(() => window.__harness);
    const problems = [...errors.filter((message) => !/Failed to load resource|ERR_FILE_NOT_FOUND|#preview|#download/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };
  const shot = async (session, file, { save = true } = {}) => {
    if (save) await session.page.screenshot({ path: join(outDir, file) });
    const metrics = { ...(await session.page.evaluate(aiMetrics)), memory: await session.page.evaluate(memoryMetrics) };
    report({ file, status: metrics.status, overflowX: metrics.overflowX, smallTargets: metrics.smallTargets, memory: metrics.memory });
    check(metrics.overflowX === 0, `${file}: horizontal overflow ${metrics.overflowX}px`);
    check(metrics.textUnder12.length === 0, `${file}: texts under 12px ${metrics.textUnder12.join(", ")}`);
    check(metrics.smallTargets.length === 0, `${file}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
    check(metrics.solidRed <= 1, `${file}: ${metrics.solidRed} solid red controls`);
    if (metrics.window) check(metrics.windowInsideFeed === true, `${file}: the window leaves the feed`);
    if (metrics.window && metrics.composer) check(metrics.window.bottom <= metrics.composer.top + 1, `${file}: the window covers the composer`);
    return metrics;
  };
  const expand = async (session) => {
    await session.page.getByRole("button", { name: "Помочь с ответом — открыть помощника" }).click();
    await session.page.waitForTimeout(300);
  };
  const openMemory = async (session) => {
    await session.page.locator('[data-testid="v3-ai-memory"] > summary').click();
    await session.page.waitForTimeout(120);
  };

  try {
    // Свёрнутое окно память не читает; открытое — читает один раз, блок свёрнут, ответ на месте.
    for (const viewportKey of AI_P3_CHAT["memory-ready"].viewports) {
      const session = await open("memory-ready", viewportKey);
      check((await session.page.evaluate(() => window.__harness.memory.length)) === 0, `memory-ready-${viewportKey}: a collapsed window read memory`);
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
      const collapsed = await shot(session, `window-collapsed-${viewportKey}.png`);
      check(collapsed.memory.state === "ready" && collapsed.memory.open === false, `memory-ready-${viewportKey}: ${JSON.stringify(collapsed.memory)}`);
      check(collapsed.memory.hint === "Бакалавриат по компьютерным наукам в Малайзии, без IELTS, до 6 000 $ в год", `memory-ready-${viewportKey}: hint ${collapsed.memory.hint}`);
      check(collapsed.memory.answer === true, `memory-ready-${viewportKey}: the answer is gone`);
      await openMemory(session);
      const opened = await shot(session, `window-open-${viewportKey}.png`);
      check(opened.memory.open === true && opened.memory.summaryClamped === true && opened.memory.summaryOverflows === true, `memory-ready-${viewportKey}: clamp ${JSON.stringify(opened.memory)}`);
      check(collapsed.memory.hintVisible === true && opened.memory.hintVisible === false, `memory-ready-${viewportKey}: the open block repeats the interest under the title`);
      check(opened.memory.lead === "Аружан · Малайзия · Квалифицирован", `memory-ready-${viewportKey}: lead ${opened.memory.lead}`);
      check(opened.memory.meta === "Сводка по 25 сообщениям · обновлена 14:20", `memory-ready-${viewportKey}: meta ${opened.memory.meta}`);
      await session.page.getByRole("button", { name: "Показать всё" }).click();
      await session.page.waitForTimeout(80);
      const whole = await shot(session, `window-summary-whole-${viewportKey}.png`, { save: viewportKey === "1440" });
      check(whole.memory.summaryClamped === false && whole.memory.summaryOverflows === false, `memory-ready-${viewportKey}: «Показать всё» ${JSON.stringify(whole.memory)}`);
      // Esc сворачивает всё окно; снова открыть — блок свёрнут и читается заново.
      await session.page.keyboard.press("Escape");
      await session.page.waitForTimeout(100);
      await expand(session);
      const again = await session.page.evaluate(memoryMetrics);
      check(again.open === false, `memory-ready-${viewportKey}: reopened block is not collapsed`);
      const harness = await close(session, `memory-ready-${viewportKey}`);
      check(JSON.stringify(harness.memory) === JSON.stringify(["read", "read"]), `memory-ready-${viewportKey}: ${JSON.stringify(harness.memory)}`);
      // Готовый актуальный ответ при повторном открытии не перечитывается (P1); память — перечитывается.
      check(JSON.stringify(harness.actions) === JSON.stringify(["ai-read"]), `memory-ready-${viewportKey}: answer reads ${JSON.stringify(harness.actions)}`);
    }

    // «Забыть сводку»: подтверждение в строке → DELETE с id запроса → перечитать → сводки нет, пересборка уже в очереди (274).
    {
      const session = await open("memory-forget", "1440");
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
      await openMemory(session);
      await session.page.getByRole("button", { name: "Забыть сводку" }).click();
      await session.page.waitForTimeout(80);
      const confirm = await shot(session, "window-forget-confirm-1440.png");
      check(confirm.memory.confirm?.startsWith("Сводка и интерес удалятся. ИИ сразу начнёт собирать их заново.") === true, `forget: confirm ${confirm.memory.confirm}`);
      check(confirm.focus === "Забыть сводку", `forget: focus on the confirm button ${confirm.focus}`);
      await session.page.locator('[data-testid="v3-ai-memory-confirm"] .v3-ai-button').click();
      await session.page.waitForTimeout(400);
      const done = await shot(session, "window-forgotten-1440.png");
      check(done.memory.note === "Сводка и интерес удалены — ИИ собирает их заново." && done.memory.summaryState === "Сводки пока нет — ИИ соберёт её сам.", `forget: ${JSON.stringify(done.memory)}`);
      check(done.memory.interest === "Интереса пока нет — ИИ определит его сам.", `forget: interest ${done.memory.interest}`);
      const harness = await close(session, "memory-forget-1440");
      check(harness.memory.length === 3 && harness.memory[0] === "read" && /^clear:[0-9a-f-]{36}$/u.test(harness.memory[1]) && harness.memory[2] === "read",
        `forget: ${JSON.stringify(harness.memory)}`);
    }

    // Честные состояния (274): выключена (+ «Включить» только при согласии), на паузе без согласия,
    // короткая переписка без карточки, 21–25 сообщений — сводка рано, сводку пора собрать.
    const states = [
      ["memory-off", (m) => m.hint === "Память выключена" && m.off?.startsWith("Память о клиенте выключена.") && m.enableLink && m.lead === "Аружан · Малайзия · Квалифицирован"],
      ["memory-off-no-consent", (m) => m.off?.startsWith("Память о клиенте выключена.") && !m.enableLink && m.off.includes("Сначала администратор записывает согласие на Gemini.")],
      ["memory-paused", (m) => m.state === "paused" && m.hint === "Память на паузе"
        && m.paused === "Память на паузе: без согласия на Gemini сводка и интерес не собираются." && m.interest === null && m.summaryState === null
        && m.lead === "Аружан · Малайзия · Квалифицирован"],
      ["memory-short", (m) => m.summaryState === "ИИ видит всю переписку — сводка не нужна." && m.interest === "Интерес появится после следующего сообщения клиента." && m.lead === "Карточки лида нет."],
      ["memory-waiting", (m) => m.state === "waiting" && m.summaryState === "Сводка появится, когда переписка станет длиннее." && m.hint === "Сводка пока не нужна"],
      ["memory-due", (m) => m.state === "due" && m.summaryState === "Сводки пока нет — ИИ соберёт её сам." && m.hint === "Сводки пока нет"
        && m.interest === "Интерес появится после следующего сообщения клиента."],
    ];
    for (const [name, ok] of states) {
      for (const viewportKey of AI_P3_CHAT[name].viewports) {
        const session = await open(name, viewportKey);
        await expand(session);
        await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
        await openMemory(session);
        const metrics = await shot(session, `window-${name.replace("memory-", "")}-${viewportKey}.png`);
        check(ok(metrics.memory), `${name}-${viewportKey}: ${JSON.stringify(metrics.memory)}`);
        await close(session, `${name}-${viewportKey}`);
      }
    }
    {
      const session = await open("memory-failed", "1440");
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
      await session.page.waitForTimeout(100);
      const failed = await shot(session, "window-failed-1440.png");
      check(failed.memory.state === "failed" && /Не удалось загрузить\s*·\s*Повторить/u.test(failed.memory.failedText ?? "") && failed.memory.answer === true,
        `failed: ${JSON.stringify(failed.memory)}`);
      await session.page.getByRole("button", { name: "Повторить" }).click();
      await session.page.waitForTimeout(250);
      const retried = await session.page.evaluate(memoryMetrics);
      check(retried.state === "ready", `failed: retry ${JSON.stringify(retried)}`);
      const harness = await close(session, "memory-failed-1440");
      check(JSON.stringify(harness.memory) === JSON.stringify(["read", "read"]), `failed: ${JSON.stringify(harness.memory)}`);
    }
    // Окончательный отказ (403): без «Повторить» и без role=alert — повтор не поможет.
    {
      const session = await open("memory-denied", "1440");
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-answer"]');
      await session.page.waitForTimeout(100);
      const denied = await shot(session, "window-denied-1440.png");
      check(denied.memory.state === "denied" && /Память этого чата недоступна\./u.test(denied.memory.failedText ?? "")
        && denied.memory.retry === false && denied.memory.alert === false && denied.memory.answer === true, `denied: ${JSON.stringify(denied.memory)}`);
      const harness = await close(session, "memory-denied-1440");
      check(JSON.stringify(harness.memory) === JSON.stringify(["read"]), `denied: ${JSON.stringify(harness.memory)}`);
    }

    // «Агент и лимит» → «Память о клиенте».
    const sectionChecks = {
      "section-memory-off": (m) => m.settings.enabled === "false" && m.settings.text.includes("выключена")
        && m.settings.text.includes("Сводка длинных переписок и интерес клиента. Тексты уходят в Gemini, фото и файлы — нет.") // пробелы схлопнуты, неразрывный тоже
        && m.settings.buttons.some((button) => button.text === "Включить память" && !button.disabled),
      "section-memory-on": (m) => m.settings.enabled === "true" && m.settings.text.includes("включена")
        && m.settings.text.includes("Сводки всех клиентов удалятся.") && m.settings.buttons.some((button) => button.text === "Выключить и удалить сводки"),
      "section-memory-no-consent": (m) => m.settings.buttons.some((button) => button.text === "Включить память" && button.disabled)
        && m.settings.text.includes("Сначала администратор записывает согласие на Gemini."),
      "section-consent-revoke": (m) => m.revoke?.open === true
        && m.revoke.confirm === "ИИ перестанет готовить ответы. Память о клиенте выключится, сводки всех клиентов удалятся. После нового согласия память нужно включить снова."
        && m.revoke.button === "Отозвать и удалить сводки",
    };
    for (const [name, scenario] of Object.entries(AI_P3_SECTION)) {
      for (const viewportKey of scenario.viewports) {
        const session = await open(name, viewportKey);
        if (name === "section-memory-on") {
          await session.page.locator('[data-testid="v3-ai-memory-disable"] > summary').click();
          await session.page.waitForTimeout(80);
        }
        if (name === "section-consent-revoke") {
          await session.page.locator('[data-testid="v3-ai-consent-line"] summary').click();
          await session.page.waitForTimeout(80);
        }
        await session.page.locator(name === "section-consent-revoke" ? '[data-testid="v3-ai-consent-line"]' : "#ai-memory")
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await session.page.waitForTimeout(80);
        const metrics = await shot(session, `${name}-${viewportKey}.png`);
        const revoke = await session.page.evaluate(() => {
          const details = document.querySelector('[data-testid="v3-ai-consent-line"] details');
          const body = document.querySelector('[data-testid="v3-ai-consent-revoke"]');
          return details ? { open: details.open, confirm: body?.querySelector("p")?.textContent.trim() ?? null,
            button: body?.querySelector("button")?.textContent.trim() ?? null } : null;
        });
        check(sectionChecks[name]({ ...metrics.memory, revoke }), `${name}-${viewportKey}: ${JSON.stringify({ settings: metrics.memory.settings, revoke })}`);
        await close(session, `${name}-${viewportKey}`);
      }
    }

    // Включить → итог и фокус на «Выключить память»; выключить → итог и фокус на «Включить память».
    {
      const togglePath = join(workDir, "section-memory-toggle.html");
      writeFileSync(togglePath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Память о клиенте — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        '<body class="min-h-full"><div id="root"></div><script src="ai-agent-p3-toggle.js"></script></body></html>',
      ].join(""));
      htmlFor["section-memory-toggle"] = togglePath;
      const session = await open("section-memory-toggle", "1440");
      await session.page.getByRole("button", { name: "Включить память" }).click();
      await session.page.waitForSelector('[data-testid="v3-ai-memory-settings"][data-enabled="true"]');
      await session.page.waitForTimeout(80);
      const on = await shot(session, "section-memory-toggled-on-1440.png");
      check(on.memory.settings.status === "Память включена." && on.memory.settings.focus === "Выключить память",
        `toggle on: ${JSON.stringify(on.memory.settings)}`);
      await session.page.locator('[data-testid="v3-ai-memory-disable"] > summary').click();
      await session.page.getByRole("button", { name: "Выключить и удалить сводки" }).click();
      await session.page.waitForSelector('[data-testid="v3-ai-memory-settings"][data-enabled="false"]');
      await session.page.waitForTimeout(80);
      const off = await shot(session, "section-memory-toggled-off-1440.png", { save: false });
      check(off.memory.settings.status === "Память выключена, сводки удалены." && off.memory.settings.focus === "Включить память",
        `toggle off: ${JSON.stringify(off.memory.settings)}`);
      const harness = await close(session, "section-memory-toggle-1440");
      const [first, second] = harness.actions.map((entry) => entry.split(":"));
      check(harness.actions.length === 2 && first[1] === "enable" && first[2] === "7" && second[1] === "disable" && second[2] === "8"
        && first[3] !== second[3], `toggle: requests ${JSON.stringify(harness.actions)}`);
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`ai agent p3 checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, outDir })}\n`);
}

// --- «ИИ-агент» P4: «Автоответчик» — раздел, окно ИИ, подпись в ленте ------------------
// Настройки, журнал, сводка, чаты и тексты ВЫДУМАНЫ (тот же синтетический чат
// «Аружан Примерова»); формы чтений — как у 277 (ветка P4 SQL). Раздел —
// настоящая страница `v3/ai-agent/page.tsx` с подменёнными чтениями (разметка
// сервера); окно ИИ — настоящий клиентский компонент; «Автоответчик в этом
// чате» отвечает синтетика вкладки (fixture.ai.autosend). Ни базы, ни агента,
// ни WhatsApp: ничего не отправляется.
const P4_SEND_SECRET = "a".repeat(24) + "-synthetic-autosend-send-secret";
const AUTOSEND_SETTINGS = {
  schedule: {
    mon: [{ from: "20:00", to: "09:00" }], tue: [{ from: "20:00", to: "09:00" }], wed: [{ from: "20:00", to: "09:00" }],
    thu: [{ from: "20:00", to: "09:00" }], fri: [{ from: "20:00", to: "09:00" }],
    sat: [{ from: "14:00", to: "16:00" }, { from: "20:00", to: "09:00" }], sun: [{ from: "00:00", to: "00:00" }],
  },
  dateOverrides: [{ from: "2026-12-31", to: "2027-01-02", mode: "on" }, { from: "2026-10-25", to: "2026-10-25", mode: "off" }],
  workingDays: [1, 2, 3, 4, 5], timezone: "Asia/Bishkek", delayMinSeconds: 30, delayMaxSeconds: 90,
  limitChatHour: 4, limitChatNight: 8, limitNumberHour: 30,
  phrases: {
    ru: { tomorrow: { text: "Завтра в рабочее время вам позвонит наш руководитель.", confirmed: true },
      day: { text: "{day} в рабочее время вам позвонит наш руководитель.", confirmed: true } },
    ky: { tomorrow: { text: "Эртең иш убактысында биздин жетекчи сизге чалат.", confirmed: false },
      day: { text: "{day} иш убактысында биздин жетекчи сизге чалат.", confirmed: false } },
    en: { tomorrow: { text: "Our manager will call you tomorrow during business hours.", confirmed: false },
      day: { text: "Our manager will call you {day} during business hours.", confirmed: false } },
  },
  disclosureEnabled: true,
  disclosure: {
    ru: { text: "Пишет автоматический помощник EVO — менеджеры сейчас не на связи.", confirmed: false },
    ky: { text: "EVO автоматтык жардамчысы жазып жатат — менеджерлер азыр байланышта эмес.", confirmed: false },
    en: { text: "This is the EVO automatic assistant — our managers are offline right now.", confirmed: false },
  },
  liveTestConversationIds: [],
};
const autosendState = (state = {}, extra = {}) => ({
  settings: { ...AUTOSEND_SETTINGS, ...extra.settings },
  state: {
    enabled: true, shadowMode: true, consentRecorded: true, paused: null,
    window: { inside: false, intervalStart: null, intervalEnd: null, nextStart: "2026-10-06T14:00:00Z" },
    responsible: { membershipId: AI_ACTOR.membershipId, name: "Менеджер продаж (синтетический)" }, enabledAt: "2026-10-04T14:02:00Z",
    sendErrorStreak: 0, geminiErrorStreak: 0, shadowNights: 1, shadowNightsRequired: 3,
    finalPhraseNow: { text: "Завтра в рабочее время вам позвонит наш руководитель.", variant: "tomorrow", callDate: "2026-10-07", day: null, confirmed: true, dayWordsReview: false },
    ...state,
  },
  lastSummary: { id: aiId(840), intervalStart: "2026-10-05T14:00:00Z", intervalEnd: "2026-10-06T03:00:00Z", shadowNight: true, counts: {}, status: "ready" },
  canManage: true, canSend: true, version: 7, ...extra.root,
});
const journalRow = (n, fields) => ({
  id: aiId(700 + n), conversationId: waId(fields.chat ?? 1), clientMessageId: aiId(760 + n), sourceAt: fields.createdAt,
  intervalStart: "2026-10-05T14:00:00Z", intervalEnd: "2026-10-06T03:00:00Z", status: "shadow", mode: "shadow", kind: "answer",
  reasonCode: null, reasonRu: null, language: "ru", citedChunkIds: [], callDate: null, sendAt: null, delaySeconds: null,
  outcomeCode: null, committedAt: null, authorizedAt: null, finishedAt: null, textHidden: false, text: null, qualification: null, ...fields,
});
const JOURNAL = {
  items: [
    journalRow(1, { createdAt: "2026-10-05T21:42:00Z", chat: 4, status: "shadow", kind: "final_phrase", callDate: "2026-10-06", finalReasonCode: "qualified",
      text: "Завтра в рабочее время вам позвонит наш руководитель." }),
    journalRow(2, { createdAt: "2026-10-05T21:31:00Z", chat: 4, status: "shadow",
      text: "Пишет автоматический помощник EVO — менеджеры сейчас не на связи.\nПодготовительный курс английского в Малайзии длится один семестр. Какой у вас сейчас уровень английского и на какой год планируете поступление?" }),
    journalRow(3, { createdAt: "2026-10-05T19:05:00Z", chat: 6, status: "skipped", kind: null, language: null, reasonCode: "stop_word",
      reasonRu: "Стоп-слово обещаний или оплаты" }),
    journalRow(4, { createdAt: "2026-10-05T17:48:00Z", chat: 3, status: "skipped", kind: null, language: null, reasonCode: "staff_active",
      reasonRu: "Сотрудник отвечал или был активен в чате последние 15 минут" }),
    journalRow(5, { createdAt: "2026-10-05T16:20:00Z", chat: 7, status: "shadow", mode: "shadow", textHidden: true }),
    journalRow(6, { createdAt: "2026-10-05T15:12:00Z", chat: 1, status: "skipped", kind: null, language: null, reasonCode: "media_only",
      reasonRu: "В сообщении только медиа" }),
    journalRow(7, { createdAt: "2026-10-05T14:40:00Z", chat: 5, status: "shadow", language: "en",
      text: "The foundation programme takes one semester. Which country and which degree level are you considering?" }),
  ],
  next: null,
};
const JOURNAL_TITLES = { 1: "Аружан Примерова", 3: "Тимур Макетов", 4: "Мадина Условная", 5: "WhatsApp · +996 ••• 90 48 21", 6: "Эльдар Эскизов" };
const SUMMARY = {
  summary: {
    id: aiId(840), intervalStart: "2026-10-05T14:00:00Z", intervalEnd: "2026-10-06T03:00:00Z", shadowNight: true, status: "ready",
    counts: { conversations: 5, considered: 9, answered: 4, finalPhrases: 1, shadow: 5, skipped: 4 },
    items: [
      { conversationId: waId(4), considered: 3, answered: 2, finalPhrase: true, callDate: "2026-10-06", statuses: { shadow: 3 }, reasons: {},
        qualification: { country: "Малайзия", level: "Бакалавриат", timing: "Сентябрь 2027", budget: "До 6 000 $ в год", grade_or_age: "11 класс", city: "Бишкек", call_time: "После 18:00" },
        taskId: null, taskSkipped: false, hidden: false },
      { conversationId: waId(5), considered: 2, answered: 2, finalPhrase: false, callDate: null, statuses: { shadow: 2 }, reasons: {},
        qualification: { country: "Китай", level: "Магистратура" }, taskId: null, taskSkipped: false, hidden: false },
      { conversationId: waId(6), considered: 2, answered: 0, finalPhrase: false, callDate: null, statuses: { skipped: 2 },
        reasons: { stop_word: 1, limit_chat_hour: 1 }, qualification: {}, taskId: null, taskSkipped: false, hidden: false },
      { conversationId: waId(3), considered: 1, answered: 0, finalPhrase: false, callDate: null, statuses: { skipped: 1 },
        reasons: { staff_active: 1 }, qualification: {}, taskId: null, taskSkipped: false, hidden: false },
      { hidden: true, considered: 1, answered: 0, finalPhrase: false, statuses: { skipped: 1 }, reasons: { media_only: 1 } },
    ],
  },
  shadowNights: 1,
};
const AI_P4_SECTION = {
  // Выключен: «Включить автоответчик» — тёмная кнопка, строка первого включения, настройки по умолчанию.
  "section-autosend-off": { viewports: ["1440", "390"], state: autosendState({ enabled: false, responsible: null, enabledAt: null, shadowNights: 0 }) },
  "section-autosend-no-consent": { viewports: ["1440"], state: autosendState({ enabled: false, responsible: null, enabledAt: null, consentRecorded: false, shadowNights: 0 }) },
  // Проверка без отправки: «Отвечает» заперт («Нужно ещё 2 ночи проверки»), отправка выключена на сервере — тихая строка.
  "section-autosend-shadow": { viewports: ["1440", "390"], state: autosendState({
    window: { inside: true, intervalStart: "2026-10-05T14:00:00Z", intervalEnd: "2026-10-06T03:00:00Z", nextStart: "2026-10-06T14:00:00Z" },
  }) },
  // Отвечает, но пауза: WhatsApp не на связи; отправка выключена на сервере — предупреждение.
  "section-autosend-paused": { viewports: ["1440", "390"], state: autosendState({ shadowMode: false, shadowNights: 3,
    paused: { code: "provider_down", byKind: "service", at: "2026-10-05T21:14:00Z", reasonRu: "Сессия WhatsApp не в работе" } },
  { settings: { disclosure: { ...AUTOSEND_SETTINGS.disclosure, ru: { ...AUTOSEND_SETTINGS.disclosure.ru, confirmed: true } } } }) },
  // Отвечает, сервер включён, чат живого теста.
  "section-autosend-live": { viewports: ["1440"], serverOn: true, liveTestTitles: { [waId(1)]: "Аружан Примерова" }, state: autosendState({ shadowMode: false, shadowNights: 4 },
    { settings: { liveTestConversationIds: [waId(1)], disclosure: { ...AUTOSEND_SETTINGS.disclosure, ru: { ...AUTOSEND_SETTINGS.disclosure.ru, confirmed: true } } } }) },
  "section-autosend-journal": { viewports: ["1440", "390"], search: { view: "journal" }, state: autosendState() },
  "section-autosend-journal-skipped": { viewports: ["1440"], search: { view: "journal", status: "skipped" }, state: autosendState(), journalFilter: "skipped" },
  "section-autosend-summary": { viewports: ["1440", "390"], search: { view: "summary" }, state: autosendState() },
  "section-autosend-summary-empty": { viewports: ["1440"], search: { view: "summary" }, state: autosendState(), summary: { summary: null, shadowNights: 0 } },
  // Сотрудник без ai.agent.manage: всё видно, ничего не меняется.
  "section-autosend-read-only": { viewports: ["1440"], state: autosendState({}, { root: { canManage: false } }) },
  // Пауза видна и в других подразделах — строкой со ссылкой на «Автоответчик».
  "section-documents-paused": { viewports: ["1440"], section: "documents", state: autosendState({ shadowMode: false, shadowNights: 3,
    paused: { code: "provider_restricted", byKind: "service", at: "2026-10-05T22:40:00Z", reasonRu: "Сессия WhatsApp не в работе" } }) },
};

async function buildAutosendSectionMarkup(name, scenario = AI_P4_SECTION[name]) {
  process.env.EVO_AI_AGENT_INTERNAL_SECRET = AI_SECRET;
  process.env.EVO_AI_AGENT_AUTOSEND = scenario.serverOn ? "1" : "0";
  process.env.EVO_AI_AGENT_SEND_SECRET = scenario.serverOn ? P4_SEND_SECRET : "";
  stubReads({ actor: AI_ACTOR, rows: ALL_ROWS });
  const source = require(join(ROOT, "src/lib/v3/ai-agent-source.ts"));
  source.readAiSettings = async () => available(normalizeAiSettings, aiSettings());
  source.readAiDocuments = async () => available(normalizeAiDocuments, AI_DOCUMENTS);
  source.readAiRules = async () => available(normalizeAiRules, AI_RULES);
  source.readAiSpend = async () => available(normalizeAiSpend, AI_SPEND);
  source.readAiReview = async () => ({ status: "unavailable" });
  const autosend = require(join(ROOT, "src/lib/v3/ai-agent-autosend.ts"));
  const autosendSource = require(join(ROOT, "src/lib/v3/ai-agent-autosend-source.ts"));
  autosendSource.readAiAutosend = async () => ({ status: "available", data: { ...autosend.normalizeAiAutosendState(scenario.state), liveTestTitles: scenario.liveTestTitles ?? {} } });
  autosendSource.readAiAutosendJournal = async (_actor, input) => {
    const journal = autosend.normalizeAiAutosendJournal({ ...JOURNAL, items: JOURNAL.items.filter((row) => input.filter === "all" || row.status === input.filter) });
    return { status: "available", data: { ...journal, items: journal.items.map((row) => ({
      ...row, conversationTitle: JOURNAL_TITLES[Number(row.conversationId.slice(-3))] ?? null,
    })) } };
  };
  autosendSource.readAiAutosendSummary = async () => {
    const read = autosend.normalizeAiAutosendSummary(scenario.summary ?? SUMMARY);
    return { status: "available", data: read.summary ? { ...read, summary: { ...read.summary, items: read.summary.items.map((item) => ({
      ...item, conversationTitle: item.conversationId ? JOURNAL_TITLES[Number(item.conversationId.slice(-3))] ?? null : null,
    })) } } : read };
  };
  require(join(ROOT, "src/lib/server/ai-agent-route-handlers.ts")).readAiAgentStatus = async () => ({ state: "ready", keyAccepted: true, model: "gemini-3.8-flash", block: null });
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/ai-agent/page.tsx"));
  const search = scenario.section === "documents" ? {} : { section: "autosend", ...scenario.search };
  const element = await Page({ searchParams: Promise.resolve(search) });
  const query = new URLSearchParams(search).toString();
  return { actor: AI_ACTOR, search: query, body: renderToStaticMarkup(withContexts(element, "/v3/ai-agent", query)) };
}

// Ночной диалог: клиент пишет после 20:00, отвечает «Автоответчик» от имени ответственного.
const AUTOREPLY_MESSAGES = [
  ...WA_MESSAGES.slice(0, 5),
  waMessage(10, true, "2026-10-05T15:05:00.000Z", "Здравствуйте! Сколько длится подготовительный курс английского в Малайзии?"),
  waMessage(11, false, "2026-10-05T15:06:10.000Z", "Пишет автоматический помощник EVO — менеджеры сейчас не на связи.\nПодготовительный курс английского длится один семестр. На какой год планируете поступление и какой у вас бюджет?", {
    origin: "autoreply", senderName: "Менеджер продаж (синтетический)", senderIsViewer: true, ack: "READ",
  }),
  waMessage(12, true, "2026-10-05T15:09:00.000Z", "На сентябрь 2027, бюджет до 6 000 $ в год. Хочу поговорить с менеджером."),
  waMessage(13, false, "2026-10-05T15:10:05.000Z", "Завтра в рабочее время вам позвонит наш руководитель.", {
    origin: "autoreply", senderName: "Менеджер продаж (синтетический)", senderIsViewer: true, ack: "DEVICE",
  }),
  waMessage(14, false, "2026-10-06T04:05:00.000Z", "Доброе утро! Это Айгерим из EVO, звоню вам в 10:30 — удобно?", {
    origin: "crm", senderName: "Айгерим Синтетическая", ack: "READ",
  }),
  waMessage(15, true, "2026-10-06T04:20:00.000Z", "Да, удобно, жду звонка."),
];
const autosendChatBody = (chat, serverOn) => ({ status: 200, body: { chat: { enabled: true, mode: "live", paused: false, excluded: false, liveTest: false, handedOff: false, ...chat }, serverOn } });
const autosendAi = (autosend, extra = {}) => ({
  saved: [aiView(aiAnswer())], post: [{ status: 503, body: { error: { code: "agent_unavailable" } } }],
  insert: [{ status: 200, body: { text: "x" } }], autosend, ...extra,
});
const AI_P4_CHAT = {
  // Лента ночью: подпись «Автоответчик», чип в шапке, в окне ИИ — полоса «Автоответчик в этом чате».
  "chat-autoreply": { viewports: ["1440", "390"], chip: true, ai: autosendAi([autosendChatBody({}, true)]) },
  "chat-autosend-shadow": { viewports: ["1440"], chip: false, ai: autosendAi([autosendChatBody({ mode: "shadow" }, false)]) },
  "chat-autosend-paused": { viewports: ["1440"], chip: false, ai: autosendAi([autosendChatBody({ paused: true }, true)]) },
  "chat-autosend-failed": { viewports: ["1440"], chip: false, ai: autosendAi([{ status: 503, body: { error: { code: "unavailable" } } }, autosendChatBody({}, true)]) },
  // Автоответчик выключен в организации: полосы нет, окно как в P3.
  "chat-autosend-off": { viewports: ["1440"], chip: false, ai: autosendAi(undefined) },
};

async function buildAutosendChatPage(name, scenario = AI_P4_CHAT[name]) {
  process.env.EVO_AI_AGENT_INTERNAL_SECRET = AI_SECRET;
  stubReads({ actor: AI_ACTOR, rows: ALL_ROWS, inbox: waView({ chat: { messages: AUTOREPLY_MESSAGES, attempts: [], autoreplyAtNight: scenario.chip,
    latestInboundMessageId: waId(115), hasOlder: true } }) });
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/inbox/page.tsx"));
  const element = await Page({ searchParams: Promise.resolve({ conversation: WA_CONVERSATION }) });
  const { children: inbox, ...main } = element.props;
  return { actor: AI_ACTOR, chatApp: { main, inbox: inbox.props } };
}

// Настройки вживую: настоящая форма, запись — синтетическая (базы и server action нет).
const SETTINGS_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AiAutosendSettingsForm } = require("@/components/v3/ai-agent/AiAutosendSettingsForm");
const { normalizeAiAutosendSettings } = require("@/lib/v3/ai-agent-autosend");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [], aiRefs: [], memory: [], autosend: [], refreshes: 0, polls: 0 };
const action = async (_previous, form) => {
  window.__harness.actions.push(["save", form.get("expected_version"), form.get("request_id"), form.get("settings")].join("|"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { status: "saved", requestId: form.get("request_id") };
};
function Page() {
  React.useEffect(() => { document.documentElement.dataset.hydrated = "true"; }, []);
  return h(AiAutosendSettingsForm, { initial: normalizeAiAutosendSettings(fixture.settings), version: 7, liveTestTitles: {}, liveTestLock: null,
    readOnly: false, requestId: "27700000-0000-4000-8000-000000000071", action });
}
createRoot(document.getElementById("root")).render(
  h("div", { className: "v3-world", "data-surface": "staff" }, h("main", { className: "mx-auto max-w-6xl p-4 sm:p-6" }, h(Page))));
`;

// Режим вживую: настоящий переключатель, запись — синтетическая (разметка раздела в снимках выше статична).
const MODE_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AiAutosendModeSwitch } = require("@/components/v3/ai-agent/AiAutosendModeSwitch");
const h = React.createElement;
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [], aiRefs: [], memory: [], autosend: [], refreshes: 0, polls: 0 };
const action = async (_previous, form) => {
  window.__harness.actions.push(["mode", form.get("mode"), form.get("expected_version")].join("|"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { status: "saved", requestId: form.get("request_id") };
};
function Page() {
  React.useEffect(() => { document.documentElement.dataset.hydrated = "true"; }, []);
  return h("section", { className: "rounded-card border border-border bg-surface px-4 py-5 sm:px-6", "data-testid": "v3-ai-autosend-header", "data-mode": "shadow" },
    h(AiAutosendModeSwitch, { mode: "shadow", lock: null, version: 7, requestId: "27700000-0000-4000-8000-000000000072", action }));
}
createRoot(document.getElementById("root")).render(
  h("div", { className: "v3-world", "data-surface": "staff" }, h("main", { className: "mx-auto max-w-6xl p-4 sm:p-6" }, h(Page))));
`;

function autosendMetrics() {
  const text = (selector) => document.querySelector(selector)?.textContent.replace(/\s+/gu, " ").trim() ?? null;
  const strip = document.querySelector('[data-testid="v3-ai-autosend-chat"]');
  return {
    header: text('[data-testid="v3-ai-autosend-header"]'),
    mode: document.querySelector('[data-testid="v3-ai-autosend-header"]')?.dataset.mode ?? null,
    lock: text('[data-testid="v3-ai-autosend-lock"]'),
    pause: text('[data-testid="v3-ai-autosend-pause-banner"]'),
    serverOff: text('[data-testid="v3-ai-autosend-server-off"]'),
    enable: text('[data-testid="v3-ai-autosend-enable"]'),
    enableDisabled: document.querySelector('[data-testid="v3-ai-autosend-enable"] button')?.getAttribute("aria-disabled") === "true",
    liveDisabled: document.querySelector('[data-testid="v3-ai-autosend-mode"] [data-mode="live"]')?.getAttribute("aria-disabled") === "true",
    liveConfirm: text('[data-testid="v3-ai-autosend-live-confirm"]'),
    focused: document.activeElement?.textContent?.trim() ?? null,
    overnight: [...document.querySelectorAll('[data-testid="v3-ai-autosend-overnight"]')].map((element) => element.textContent.trim()),
    unconfirmed: document.querySelectorAll('[data-testid^="v3-ai-autosend-phrase-"][data-confirmed="false"]').length,
    journal: [...document.querySelectorAll('[data-testid="v3-ai-autosend-journal-row"]')].map((row) => row.dataset.status),
    hiddenText: document.querySelectorAll('[data-testid="v3-ai-autosend-journal-row"] .text-fg-3').length,
    summaryItems: document.querySelectorAll('[data-testid="v3-ai-autosend-summary-item"]').length,
    summaryHidden: document.querySelectorAll('[data-testid="v3-ai-autosend-summary-item"][data-hidden]').length,
    summaryEmpty: text('[data-testid="v3-ai-autosend-summary-empty"]'),
    settingsDisabled: document.querySelector('[data-testid="v3-ai-autosend-settings"] fieldset')?.disabled ?? null,
    saveButton: document.querySelector('[data-testid="v3-ai-autosend-settings"] button[type="submit"]')?.textContent.trim() ?? null,
    saveIdle: document.querySelector('[data-testid="v3-ai-autosend-settings"] button[type="submit"]')?.getAttribute("aria-disabled") === "true",
    settingsStatus: text('[data-testid="v3-ai-autosend-settings-status"]'),
    liveTestLock: text('[data-testid="v3-ai-autosend-live-test-lock"]'),
    liveTestInput: document.querySelector('[data-testid="v3-ai-autosend-live-test"] input[type="url"]') !== null,
    finalReasons: [...document.querySelectorAll('[data-testid="v3-ai-autosend-final-reason"]')].map((element) => element.textContent.trim()),
    issues: [...document.querySelectorAll('[data-testid="v3-ai-autosend-settings"] .text-danger')].map((element) => element.textContent.trim()),
    chip: text('[data-testid="v3-inbox-autoreply-chip"]'),
    autoreplyLabels: [...document.querySelectorAll('[data-testid="v3-inbox-message"][data-origin="autoreply"] time + span')].map((element) => ({ text: element.textContent.trim(), title: element.getAttribute("title") })),
    strip: strip ? { state: strip.dataset.state, text: strip.textContent.replace(/\s+/gu, " ").trim(),
      checked: strip.querySelector('[role="switch"]')?.getAttribute("aria-checked") ?? null } : null,
    // Цели меньше 44 px, кроме флажков внутри подписи-цели высотой ≥ 44 px (WCAG 2.5.8: цель — вся подпись).
    smallTargets: [...document.querySelectorAll("main a, main button, main select, main input:not([type=hidden]), main summary")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || element.closest("[popover]") || element.matches(".v3-ai-mark")) return false;
        if (box.height >= 44) return false;
        const label = element.matches("input[type=checkbox]") ? element.closest("label") : null;
        return !(label && label.getBoundingClientRect().height >= 44);
      })
      .map((element) => element.getAttribute("aria-label") ?? (element.textContent.trim().slice(0, 30) || element.outerHTML.slice(0, 60))),
    solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)"
      && element.getBoundingClientRect().width > 0).map((element) => element.textContent.trim()),
  };
}

async function aiP4Screenshots() {
  const outIndex = process.argv.indexOf("--ai-agent-p4") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--")
    ? process.argv[outIndex] : join(ROOT, "docs/design/evo-platform/implementation-screenshots/ai-agent-p4"));
  const workDir = join(require("node:os").tmpdir(), "evo-ai-agent-p4-render");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const bundleName = "ai-agent-p4-client.js";
  const css = await compileCss();
  await buildClientBundle(join(workDir, bundleName));
  await buildClientBundle(join(workDir, "ai-agent-p4-settings.js"), SETTINGS_ENTRY);
  await buildClientBundle(join(workDir, "ai-agent-p4-mode.js"), MODE_ENTRY);
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const htmlFor = {};
  const page = (name, title, markup, data, script = bundleName) => {
    const htmlPath = join(workDir, `${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>${title} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="${script}"></script></body></html>`,
    ].join(""));
    return htmlPath;
  };
  for (const [name, scenario] of Object.entries(AI_P4_CHAT)) {
    const { actor, chatApp } = await buildAutosendChatPage(name, scenario);
    const search = `conversation=${WA_CONVERSATION}`;
    const markup = renderToString(shellTree({ actor, pathname: "/v3/inbox", search, body: null, cabinet: null, chatApp }));
    htmlFor[name] = page(name, "WhatsApp", markup, {
      actor, pathname: "/v3/inbox", search, body: null, cabinet: null, chatApp, rows: [], readAt: WA_READ_AT,
      pulse: { list: "0000000000000002", chat: "0000000000000001" }, older: { messages: [], hasOlder: false }, ai: scenario.ai,
    });
  }
  for (const [name, scenario] of Object.entries(AI_P4_SECTION)) {
    const { actor, search, body } = await buildAutosendSectionMarkup(name, scenario);
    const markup = renderToString(shellTree({ actor, pathname: "/v3/ai-agent", search, body, cabinet: null }));
    htmlFor[name] = page(name, "ИИ-агент", markup, { actor, pathname: "/v3/ai-agent", search, body, cabinet: null, rows: [], readAt: WA_READ_AT });
  }
  htmlFor["settings-live"] = page("settings-live", "Автоответчик", "", { settings: AUTOSEND_SETTINGS }, "ai-agent-p4-settings.js");
  htmlFor["mode-live"] = page("mode-live", "Автоответчик", "", {}, "ai-agent-p4-mode.js");

  const { chromium } = require("playwright");
  // Русский интерфейс браузера: поля времени — 24 часа, как у сотрудников EVO.
  const browser = await chromium.launch({ args: ["--lang=ru-RU"] });
  const open = async (name, viewportKey) => {
    // Русская локаль браузера: время в полях — 24 часа, как у сотрудников EVO.
    const context = await browser.newContext({ ...VIEWPORTS[viewportKey], colorScheme: "light", locale: "ru-RU" });
    const session = await context.newPage();
    const errors = [];
    session.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    session.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await session.goto(pathToFileURL(htmlFor[name]).href, { waitUntil: "load" });
    await session.evaluate(() => document.fonts.ready);
    await session.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    await session.waitForTimeout(200);
    return { context, page: session, errors };
  };
  const close = async ({ context, page: session, errors }, label) => {
    const harness = await session.evaluate(() => window.__harness);
    const problems = [...errors.filter((message) => !/Failed to load resource|ERR_FILE_NOT_FOUND|#preview|#download/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };
  const shot = async (session, file, { save = true, fullPage = false } = {}) => {
    if (save) await session.page.screenshot({ path: join(outDir, file), fullPage });
    const metrics = { ...(await session.page.evaluate(aiMetrics)), autosend: await session.page.evaluate(autosendMetrics) };
    report({ file, overflowX: metrics.overflowX, autosend: metrics.autosend });
    check(metrics.overflowX === 0, `${file}: horizontal overflow ${metrics.overflowX}px`);
    check(metrics.textUnder12.length === 0, `${file}: texts under 12px ${metrics.textUnder12.join(", ")}`);
    // «Информация для агента» (P2) меряется своим сценарием; здесь — только строка паузы над ней.
    if (!file.startsWith("section-documents-")) check(metrics.autosend.smallTargets.length === 0, `${file}: targets under 44px: ${metrics.autosend.smallTargets.join(", ")}`);
    check(metrics.autosend.solidRed.length <= 1, `${file}: solid red controls ${JSON.stringify(metrics.autosend.solidRed)}`);
    if (metrics.window) check(metrics.windowInsideFeed === true, `${file}: the window leaves the feed`);
    if (metrics.window && metrics.composer) check(metrics.window.bottom <= metrics.composer.top + 1, `${file}: the window covers the composer`);
    return metrics;
  };
  const expand = async (session) => {
    await session.page.getByRole("button", { name: "Помочь с ответом — открыть помощника" }).click();
    await session.page.waitForTimeout(300);
  };

  try {
    // Раздел: каждое состояние шапки, журнал, сводка — разметка сервера.
    const sectionChecks = {
      "section-autosend-off": (m) => m.mode === "off" && m.enable?.includes("Первое включение — «Проверка без отправки»") && !m.enableDisabled
        && m.overnight.includes("→ 09:00 след. дня") && m.overnight.includes("→ 00:00 след. дня") && m.unconfirmed === 4 && m.saveButton === "Сохранить настройки"
        && m.solidRed.length === 0 && m.saveIdle === true
        && m.liveTestLock === "Чаты живого теста можно добавить после 3 ночей проверки без отправки." && !m.liveTestInput,
      "section-autosend-no-consent": (m) => m.enableDisabled && m.enable?.includes("Сначала администратор записывает согласие на Gemini."),
      "section-autosend-shadow": (m) => m.mode === "shadow" && m.lock === "Нужно ещё 2 ночи проверки" && m.liveDisabled
        && m.header?.includes("Ответственный: Менеджер продаж (синтетический)") && m.header?.includes("Сейчас интервал автоответчика — до 6 октября, 09:00")
        && m.serverOff === "Отправка выключена на сервере." && m.pause === null
        && m.liveTestLock === "Чаты живого теста можно добавить после 3 ночей проверки без отправки — нужно ещё 2 ночи." && !m.liveTestInput,
      "section-autosend-paused": (m) => m.mode === "live" && m.pause?.startsWith("Автоответчик на паузе: WhatsApp не на связи · с 6 октября, 03:14")
        && m.pause.includes("Снять паузу") && m.serverOff === "Отправка выключена на сервере — ничего не уйдёт, пока её не включат на сервере.",
      "section-autosend-live": (m) => m.mode === "live" && m.serverOff === null && m.pause === null && m.header?.includes("Отвечает")
        && m.liveTestLock === null && m.liveTestInput,
      "section-autosend-journal": (m) => JSON.stringify(m.journal) === JSON.stringify(["shadow", "shadow", "skipped", "skipped", "shadow", "skipped", "shadow"])
        && m.hiddenText >= 1 && JSON.stringify(m.finalReasons) === JSON.stringify(["Вместо ответа: квалификация собрана"]),
      "section-autosend-journal-skipped": (m) => JSON.stringify(m.journal) === JSON.stringify(["skipped", "skipped", "skipped"]),
      "section-autosend-summary": (m) => m.summaryItems === 5 && m.summaryHidden === 1,
      "section-autosend-summary-empty": (m) => m.summaryEmpty === "Сводок пока нет — первая появится утром после первой ночи.",
      "section-autosend-read-only": (m) => m.settingsDisabled === true && m.saveButton === null && !m.header?.includes("Поставить на паузу"),
      "section-documents-paused": (m) => m.pause?.includes("WhatsApp ограничил номер (ошибка 463 или 475)") && m.pause.includes("Открыть «Автоответчик»"),
    };
    for (const [name, scenario] of Object.entries(AI_P4_SECTION)) {
      for (const viewportKey of scenario.viewports) {
        const session = await open(name, viewportKey);
        const metrics = await shot(session, `${name}-${viewportKey}.png`, { fullPage: viewportKey === "1440" && /off|journal|summary$/u.test(name) });
        check(sectionChecks[name](metrics.autosend), `${name}-${viewportKey}: ${JSON.stringify(metrics.autosend)}`);
        await close(session, `${name}-${viewportKey}`);
      }
    }

    // «Отвечает» (настоящие ответы клиентам) пишет только после подтверждения; «Отмена» — без записи, фокус обратно.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open("mode-live", viewportKey);
      const live = session.page.locator('[data-testid="v3-ai-autosend-mode"] [data-mode="live"]');
      await live.click();
      await session.page.waitForTimeout(150);
      const confirm = await shot(session, `mode-live-confirm-${viewportKey}.png`);
      check(confirm.autosend.liveConfirm?.startsWith("Автоответчик начнёт отвечать клиентам в WhatsApp") && confirm.autosend.focused === "Отвечать клиентам",
        `mode-live-confirm-${viewportKey}: ${JSON.stringify({ c: confirm.autosend.liveConfirm, f: confirm.autosend.focused })}`);
      await session.page.getByRole("button", { name: "Отмена", exact: true }).click();
      await session.page.waitForTimeout(100);
      const cancelled = await session.page.evaluate(autosendMetrics);
      const noWrite = await session.page.evaluate(() => window.__harness.actions.length);
      check(cancelled.liveConfirm === null && cancelled.focused === "Отвечает" && noWrite === 0,
        `mode-live-cancel-${viewportKey}: ${JSON.stringify({ c: cancelled.liveConfirm, f: cancelled.focused, noWrite })}`);
      await live.click();
      await session.page.getByRole("button", { name: "Отвечать клиентам", exact: true }).click();
      await session.page.waitForTimeout(300);
      const harness = await close(session, `mode-live-${viewportKey}`);
      check(JSON.stringify(harness.actions) === JSON.stringify(["mode|live|7"]), `mode-live-write-${viewportKey}: ${JSON.stringify(harness.actions)}`);
    }

    // Настройки вживую: неверная фраза → ошибки до записи; исправить → запись с ожидаемой версией.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open("settings-live", viewportKey);
      const day = session.page.locator('[data-testid="v3-ai-autosend-phrase-ru-day"] textarea');
      await day.fill("Позвоним 12 числа в рабочее время.");
      await session.page.getByRole("button", { name: "Сохранить настройки" }).click();
      await session.page.waitForTimeout(150);
      await day.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await session.page.waitForTimeout(80);
      const invalid = await shot(session, `settings-invalid-${viewportKey}.png`);
      check(invalid.autosend.settingsStatus === "Проверьте отмеченные поля." && invalid.autosend.issues.some((issue) => issue.includes("Без цифр"))
        && invalid.autosend.issues.some((issue) => issue.includes("Ровно одно {day}")), `settings-invalid-${viewportKey}: ${JSON.stringify(invalid.autosend.issues)}`);
      const confirmedAfterEdit = await session.page.locator('[data-testid="v3-ai-autosend-phrase-ru-day"]').getAttribute("data-confirmed");
      check(confirmedAfterEdit === "false", `settings-${viewportKey}: an edited phrase must lose «Проверено»`);
      await day.fill("{day} в рабочее время вам позвонит наш руководитель.");
      await session.page.locator('[data-testid="v3-ai-autosend-phrase-ru-day"] input[type="checkbox"]').check();
      // Та же фраза и отметка — правок нет, «Сохранить» ждёт; меняем паузу перед ответом.
      check((await session.page.getByRole("button", { name: "Сохранить настройки" }).getAttribute("aria-disabled")) === "true", `settings-${viewportKey}: clean form must not save`);
      await session.page.getByRole("spinbutton", { name: "Пауза от, секунд" }).fill("45");
      const dirty = await shot(session, `settings-dirty-${viewportKey}.png`, { save: viewportKey === "1440" });
      check(dirty.autosend.solidRed.length === 1 && dirty.autosend.settingsStatus === "Есть несохранённые изменения.", `settings-dirty-${viewportKey}: ${JSON.stringify(dirty.autosend.solidRed)} ${dirty.autosend.settingsStatus}`);
      await session.page.getByRole("button", { name: "Сохранить настройки" }).click();
      await session.page.waitForTimeout(300);
      const saved = await session.page.evaluate(autosendMetrics);
      const harness = await close(session, `settings-live-${viewportKey}`);
      check(saved.settingsStatus === "Настройки сохранены." || saved.settingsStatus === null, `settings-saved-${viewportKey}: ${saved.settingsStatus}`);
      check(harness.actions.length === 1 && harness.actions[0].startsWith("save|7|"), `settings-saved-${viewportKey}: ${JSON.stringify(harness.actions.map((entry) => entry.slice(0, 60)))}`);
      const sent = JSON.parse(harness.actions[0].split("|").slice(3).join("|"));
      check(sent.phrases.ru.day.text === "{day} в рабочее время вам позвонит наш руководитель." && sent.phrases.ru.day.confirmed === true
        && sent.delayMinSeconds === 45 && !Object.hasOwn(sent, "timezone"), `settings-saved-${viewportKey}: payload ${JSON.stringify(sent).slice(0, 120)}`);
    }

    // Чат: подпись «Автоответчик» с «от имени …», чип в шапке; окно ИИ — полоса и переключатель.
    for (const viewportKey of AI_P4_CHAT["chat-autoreply"].viewports) {
      const session = await open("chat-autoreply", viewportKey);
      const feed = await shot(session, `chat-autoreply-${viewportKey}.png`);
      check(feed.autosend.chip === "Ночью отвечает автоответчик", `chat-${viewportKey}: chip ${feed.autosend.chip}`);
      check(feed.autosend.autoreplyLabels.length === 2 && feed.autosend.autoreplyLabels.every((label) => label.text === "· Автоответчик"
        && label.title === "от имени Менеджер продаж (синтетический)"), `chat-${viewportKey}: labels ${JSON.stringify(feed.autosend.autoreplyLabels)}`);
      check((await session.page.evaluate(() => window.__harness.autosend.length)) === 0, `chat-${viewportKey}: a collapsed window read the autoresponder`);
      await expand(session);
      await session.page.waitForSelector('[data-testid="v3-ai-autosend-chat"]');
      const opened = await shot(session, `window-autosend-on-${viewportKey}.png`);
      check(opened.autosend.strip?.checked === "true" && opened.autosend.strip.text.includes("Ночью отвечает по расписанию."), `chat-${viewportKey}: ${JSON.stringify(opened.autosend.strip)}`);
      await session.page.getByRole("switch", { name: "Автоответчик в этом чате" }).click();
      await session.page.waitForTimeout(300);
      const excluded = await shot(session, `window-autosend-excluded-${viewportKey}.png`, { save: viewportKey === "1440" });
      check(excluded.autosend.strip?.checked === "false" && excluded.autosend.strip.text.includes("Чат исключён — автоответчик сюда не пишет."),
        `chat-${viewportKey}: excluded ${JSON.stringify(excluded.autosend.strip)}`);
      const harness = await close(session, `chat-autoreply-${viewportKey}`);
      check(harness.autosend.length === 2 && harness.autosend[0] === "read" && /^put:true:[0-9a-f-]{36}$/u.test(harness.autosend[1]),
        `chat-${viewportKey}: ${JSON.stringify(harness.autosend)}`);
      check(harness.refreshes >= 1, `chat-${viewportKey}: the header chip is re-read after the switch`);
      check(!harness.actions.some((action) => action.startsWith("send:")), `chat-${viewportKey}: something was sent`);
    }
    const stripStates = [
      ["chat-autosend-shadow", (m) => m.strip?.text.includes("Проверка без отправки — клиенту ничего не уходит.") && m.chip === null],
      ["chat-autosend-paused", (m) => m.strip?.text.includes("Автоответчик на паузе.")],
      ["chat-autosend-off", (m) => m.strip === null],
    ];
    for (const [name, ok] of stripStates) {
      const session = await open(name, "1440");
      await expand(session);
      await session.page.waitForTimeout(250);
      const metrics = await shot(session, `window-${name.replace("chat-", "")}-1440.png`);
      check(ok(metrics.autosend), `${name}: ${JSON.stringify(metrics.autosend.strip)}`);
      await close(session, name);
    }
    {
      const session = await open("chat-autosend-failed", "1440");
      await expand(session);
      await session.page.waitForTimeout(250);
      const failed = await shot(session, "window-autosend-failed-1440.png");
      check(failed.autosend.strip?.state === "failed" && failed.autosend.strip.text.includes("не удалось загрузить"), `failed: ${JSON.stringify(failed.autosend.strip)}`);
      await session.page.locator('[data-testid="v3-ai-autosend-chat"]').getByRole("button", { name: "Повторить" }).click();
      await session.page.waitForTimeout(250);
      const retried = await session.page.evaluate(autosendMetrics);
      check(retried.strip?.state === "on", `failed: retry ${JSON.stringify(retried.strip)}`);
      await close(session, "chat-autosend-failed");
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`ai agent p4 checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, outDir })}\n`);
}

async function json() {
  const out = [];
  for (const name of Object.keys(SCENARIOS)) {
    const { scenario, element } = await buildPage(name);
    out.push({ name, html: renderToStaticMarkup(withContexts(element, pathnameOf(scenario), searchOf(scenario))) });
  }
  process.stdout.write(JSON.stringify(out));
}

if (process.argv.includes("--json")) {
  json().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--ai-agent-p4")) {
  aiP4Screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--ai-agent-p3")) {
  aiP3Screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--ai-agent")) {
  aiScreenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--whatsapp-chat")) {
  whatsappScreenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: conversations-static-render.cjs --json | --screenshots [outDir] [--prefix=split] | --whatsapp-chat [outDir] | --ai-agent [outDir] | --ai-agent-p3 [outDir] | --ai-agent-p4 [outDir]");
  process.exit(2);
}
