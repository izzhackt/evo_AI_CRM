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
 *       куратора по прежней ссылке; у каждой страницы свой h1 и свой пункт
 *       меню, вкладок каналов нет, заголовки обеих страниц — на одной высоте.
 *       По умолчанию outDir — .impeccable/review (не коммитится); файлы
 *       `e5-*.png` (`--prefix=` меняет начало имени). Проверки печатаются
 *       JSON-строками; при нарушении — код выхода 1.
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
  // Куратор (права шаблонов 173): маршрут WhatsApp открыт, пункта в меню нет (правило D «Продаж»).
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
function stubReads({ actor, rows }) {
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
  require(join(ROOT, "src/lib/v3/inbox-source.ts")).readInbox = async () => ({
    view: {
      conversations: [], selected: null, queueCurrentHref: "/v3/inbox", queueNewestHref: null, queueOlderHref: null,
      searchQuery: null, waitingOnly: false, waitingToggleHref: "/v3/inbox?waiting=1", channelState: "not_connected", channelObservedAt: null,
    },
    providerWorkflow: null, amoCrmCommand: null,
  });
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
  // куратора, открывшего прежнюю ссылку (пункта в его меню нет).
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
function shellTree({ actor, pathname, search, body, cabinet }) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const content = cabinet
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
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), ...cssModules.values()].join("\n");
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
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [] };
const router = {
  push: (href) => { window.__harness.pushes.push(href); }, replace: (href) => { window.__harness.pushes.push(href); },
  refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
const content = fixture.cabinet
  ? h(ConversationsMain, fixture.cabinet.main, h(CaseChatWorkspace, fixture.cabinet.workspace))
  : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: fixture.body } });
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: fixture.pathname },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-surface": "staff" },
          h(AppShell, { actor: fixture.actor, initialNotifications: null }, content))))));
hydrateRoot(document.getElementById("root"), tree, {
  onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)),
});
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.hydrated = "true"; }));
`;

async function buildClientBundle(outFile) {
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
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}() { window.__harness.errors.push("server action ${name}"); throw new Error("harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "conversations-client-entry.js", loader: "js" },
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
    // Свой пункт меню подсвечен; у куратора пункта WhatsApp нет — ничего не подсвечено.
    const current = metrics.menu.filter((item) => item.endsWith("*"));
    if (scenario.actor === "admissions" && scenario.page === "inbox") {
      check(current.length === 0 && !metrics.menu.some((item) => item.includes("=/v3/inbox")), `${label}: WhatsApp in the curator menu ${JSON.stringify(metrics.menu)}`);
    } else if (viewportKey !== "390" || scenario.page === "messages") {
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
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: conversations-static-render.cjs --json | --screenshots [outDir] [--prefix=split]");
  process.exit(2);
}
