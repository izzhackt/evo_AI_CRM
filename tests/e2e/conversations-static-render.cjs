"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в shell-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Переписки» — Э5 плана редизайна 25.09.2026: один пункт меню, каналы
 * «Кабинет студента» и WhatsApp, очереди с числами, шапка переписки с
 * видимым переключателем состояния, шаблоны ответа в поле ответа и
 * следующая переписка в пустой правой части.
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
 *   node tests/e2e/conversations-static-render.cjs --screenshots [outDir] [--look=next]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844: список со
 *       следующей перепиской, переписка с переключателем, открытый выбор
 *       шаблона (кнопкой и «/»), «Все ответы даны», WhatsApp у Admin и у
 *       продаж. По умолчанию outDir — .impeccable/review (не коммитится);
 *       файлы `e5-*.png`, с `--look=next` — суффикс `-next`. Проверки
 *       печатаются JSON-строками; при нарушении — код выхода 1.
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
  // Приглашённый сотрудник продаж (права шаблонов 173): каналов у него — только WhatsApp.
  sales: {
    ...BASE_ACTOR, displayName: "Менеджер продаж (синтетический)", systemRole: "staff", presentationRole: null,
    assignments: [{ label: "Sales Manager", scope: { kind: "own", key: null, resourceKind: null } }], permissionKeys: staffRoleKeys("sales-manager"),
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
function stubReads({ actor, rows, look }) {
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
  require(join(ROOT, "src/lib/v3/look-preview.ts")).readLookPreview = async () => look === "next";
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
  // WhatsApp не подключён: оба канала у Admin, только WhatsApp — у продаж.
  whatsapp: { actor: "admin", page: "inbox", search: {}, rows: ALL_ROWS },
  "whatsapp-sales": { actor: "sales", page: "inbox", search: {}, rows: ALL_ROWS },
};

const pathnameOf = (scenario) => (scenario.page === "messages" ? "/v3/messages" : "/v3/inbox");
const searchOf = (scenario) => new URLSearchParams(scenario.search).toString();

/** Дерево страницы: для «Кабинета студента» — разметка и пропсы для гидратации. */
async function buildPage(name, look) {
  const scenario = SCENARIOS[name];
  const actor = ACTORS[scenario.actor];
  stubReads({ actor, rows: scenario.rows, look });
  const file = scenario.page === "messages" ? "src/app/(v3)/v3/messages/page.tsx" : "src/app/(v3)/v3/inbox/page.tsx";
  const { default: Page } = require(join(ROOT, file));
  const element = await Page({ searchParams: Promise.resolve(scenario.search) });
  if (scenario.page === "messages") {
    const { title, channels, threadOpen, children: workspace } = element.props;
    return { actor, scenario, element, cabinet: { main: { title, channels, threadOpen }, workspace: workspace.props } };
  }
  return { actor, scenario, element, cabinet: null };
}

// --- оболочка -------------------------------------------------------------------
function shellTree({ actor, look, pathname, search, body, cabinet }) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const content = cabinet
    ? h(require(join(ROOT, "src/components/v3/case-chat/CabinetConversationsMain.tsx")).CabinetConversationsMain, cabinet.main,
      h(require(join(ROOT, "src/components/v3/case-chat/CaseChatThread.tsx")).CaseChatWorkspace, cabinet.workspace))
    : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: body } });
  return withContexts(
    h("div", { className: "v3-world", "data-look": look === "next" ? "next" : undefined },
      h(AppShell, { actor, initialNotifications: null, ...(look === "next" ? { look: "next" } : {}) }, content)),
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
const { CabinetConversationsMain } = require("@/components/v3/case-chat/CabinetConversationsMain");
const { CaseChatWorkspace } = require("@/components/v3/case-chat/CaseChatThread");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [] };
const router = {
  push: (href) => { window.__harness.pushes.push(href); }, replace: (href) => { window.__harness.pushes.push(href); },
  refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
const content = fixture.cabinet
  ? h(CabinetConversationsMain, fixture.cabinet.main, h(CaseChatWorkspace, fixture.cabinet.workspace))
  : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: fixture.body } });
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: fixture.pathname },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-look": fixture.look === "next" ? "next" : undefined },
          h(AppShell, { actor: fixture.actor, initialNotifications: null, ...(fixture.look === "next" ? { look: "next" } : {}) }, content))))));
hydrateRoot(document.getElementById("root"), tree, {
  onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)),
});
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.hydrated = "true"; }));
`;

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  // Чтения отвечают той же синтетикой через настоящий composeCaseChatQueue.
  // Отправка честно недоступна. Смену состояния заглушка только записывает и
  // подтверждает (базы нет — ничего не пишется), чтобы проверить, что
  // переключатель зовёт прежнюю команду с нужным состоянием и обновляет список.
  const caseChatStub = `
import { composeCaseChatQueue } from "@/components/v3/case-chat/case-chat-queue";
const fixture = () => JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
export async function readCaseChatPageAction() { return { status: "ready", page: fixture().cabinet.workspace.initialPage }; }
export async function loadStaffCaseChatThreadsAction(query, queue) {
  window.__harness.actions.push("load:" + queue);
  const needle = (query || "").trim().toLocaleLowerCase("ru");
  const rows = fixture().rows.filter((item) => !needle || item.studentDisplayName.toLocaleLowerCase("ru").includes(needle));
  return { status: "ready", read: composeCaseChatQueue({ all: { rows, truncated: false } }, queue, fixture().readAt) };
}
export async function markCaseChatReadAction() { return { status: "saved", requestId: null }; }
export async function postCaseChatMessageAction() { window.__harness.actions.push("post"); return { status: "unavailable", requestId: null }; }
export async function setCaseChatAwaitAction(_previous, form) {
  window.__harness.actions.push("await:" + form.get("state") + ":" + form.get("case_id"));
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
  // Содержимое закрытого <details> (меню «⋯» сообщения) не показано — его цели не меряются.
  const targets = main ? [...main.querySelectorAll("a, button, select, textarea, input:not([type=hidden])")]
    .filter((element) => visible(element) && !element.closest("details:not([open]) > :not(summary)")) : [];
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
    menuConversations: nav.filter((link) => link.textContent.trim() === "Переписки" || link.getAttribute("aria-label") === "Переписки").map((link) => `${link.getAttribute("href")}${link.getAttribute("aria-current") ? "*" : ""}`),
    menuRetired: nav.filter((link) => ["Сообщения", "WhatsApp"].includes(link.textContent.trim())).length,
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
  const look = process.argv.includes("--look=next") ? "next" : "current";
  const suffix = look === "next" ? "-next" : "";
  const bundleName = "e5-conversations-client.js";
  const css = await compileCss();
  await buildClientBundle(join(outDir, bundleName));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

  const htmlFor = {};
  for (const name of Object.keys(SCENARIOS)) {
    const { actor, scenario, element, cabinet } = await buildPage(name, look);
    const pathname = pathnameOf(scenario);
    const search = searchOf(scenario);
    const body = cabinet ? null : renderToStaticMarkup(withContexts(element, pathname, search));
    const markup = renderToString(shellTree({ actor, look, pathname, search, body, cabinet }));
    const data = JSON.stringify({ actor, look, pathname, search, body, cabinet, rows: scenario.rows, readAt: READ_AT }).replaceAll("<", "\\u003c");
    const htmlPath = join(outDir, `e5-${name}${suffix}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>Переписки — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
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
  const common = (label, metrics, viewportKey) => {
    check(metrics.overflowX === 0, `${label}: horizontal overflow ${metrics.overflowX}px`);
    check(metrics.h1.length === 1 && metrics.h1[0] === "Переписки", `${label}: h1 ${JSON.stringify(metrics.h1)}`);
    check(metrics.textUnder12 === 0, `${label}: ${metrics.textUnder12} texts under 12px`);
    check(metrics.smallTargets.length === 0, `${label}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
    check(metrics.solidRed <= 1, `${label}: ${metrics.solidRed} solid red controls`);
    check(metrics.menuRetired === 0, `${label}: «Сообщения»/«WhatsApp» still in the menu`);
    if (viewportKey !== "390") check(metrics.menuConversations.length === 1, `${label}: «Переписки» menu item ${JSON.stringify(metrics.menuConversations)}`);
  };

  try {
    for (const name of Object.keys(SCENARIOS)) {
      for (const viewportKey of Object.keys(VIEWPORTS)) {
        if ((name === "all" || name === "answered-awaiting") && viewportKey === "1280") continue;
        const file = `e5-${name}-${viewportKey}${suffix}.png`;
        const session = await open(htmlFor[name], viewportKey);
        const metrics = await session.page.evaluate(pageMetrics);
        await session.page.screenshot({ path: join(outDir, file) });
        await finish(session, file);
        report({ file, ...metrics });
        common(file, metrics, viewportKey);
        if (SCENARIOS[name].page === "messages") {
          check(metrics.overflowY <= 0, `${file}: page scrolls ${metrics.overflowY}px`);
          if (viewportKey !== "390" || name !== "thread") check(metrics.queues.length === 3, `${file}: queues ${metrics.queues.join(" · ")}`);
        }
        if (name === "cabinet") {
          check(JSON.stringify(metrics.queues) === JSON.stringify(["Нужен ответ3*", "Ждём студента2", "Все"]), `${file}: queue counts ${metrics.queues.join(" · ")}`);
          check(JSON.stringify(metrics.rows) === JSON.stringify(["Нурай Образцова", "Лейла Тестовая", "Данияр Макетов"]), `${file}: not oldest first ${metrics.rows.join(", ")}`);
          if (viewportKey !== "390") check(metrics.next === "Следующий: Нурай Образцова — ждёт 2 днОткрыть", `${file}: next pane «${metrics.next}»`);
          check(JSON.stringify(metrics.channels) === JSON.stringify(["Кабинет студента*", "WhatsApp"]), `${file}: channels ${metrics.channels.join(" · ")}`);
        }
        if (name === "answered" && viewportKey !== "390") check(metrics.next === "" && metrics.listEmpty === "Все ответы даны.Показать все переписки", `${file}: list «${metrics.listEmpty}», pane «${metrics.next}»`);
        if (name === "answered-awaiting" && viewportKey !== "390") check(metrics.next === "Все ответы даны", `${file}: pane «${metrics.next}»`);
        if (name === "thread") {
          check(JSON.stringify(metrics.awaitControl) === JSON.stringify(["Нужен ответ*", "Ждём студента", "Не требуется"]), `${file}: await control ${metrics.awaitControl.join(" · ")}`);
          check(metrics.facts === "Китай · Документы", `${file}: facts «${metrics.facts}»`);
          check(metrics.composer?.inViewport === true, `${file}: composer ${JSON.stringify(metrics.composer)}`);
          check(metrics.solidRed === 1, `${file}: ${metrics.solidRed} solid red controls (only «Отправить»)`);
        }
        if (name === "whatsapp") check(JSON.stringify(metrics.channels) === JSON.stringify(["Кабинет студента", "WhatsApp*"]), `${file}: channels ${metrics.channels.join(" · ")}`);
        if (name === "whatsapp-sales") {
          check(JSON.stringify(metrics.channels) === JSON.stringify(["WhatsApp*"]), `${file}: channels ${metrics.channels.join(" · ")}`);
          if (viewportKey !== "390") check(JSON.stringify(metrics.menuConversations) === JSON.stringify(["/v3/inbox*"]), `${file}: sales menu ${metrics.menuConversations}`);
        }
      }
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
      const file = `e5-thread-picker-${via === "slash" ? "slash-" : ""}${viewportKey}${suffix}.png`;
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
    // уходит с делом открытой переписки, выбранное меняется, список перечитан.
    {
      const session = await open(htmlFor.thread, "1440");
      const { page } = session;
      await page.evaluate(() => { window.__harness.actions.length = 0; });
      await page.locator('[data-testid="case-chat-await-control"] button', { hasText: "Ждём студента" }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="case-chat-await-control"] button[aria-pressed="true"]')?.textContent === "Ждём студента");
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => ({
        pressed: [...document.querySelectorAll('[data-testid="case-chat-await-control"] button')].filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent),
        actions: window.__harness.actions,
      }));
      const file = `e5-thread-await-1440${suffix}.png`;
      await page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ journey: "await", file, after });
      check(after.actions[0] === `await:awaiting_student:${caseId(1)}`, `${file}: command ${JSON.stringify(after.actions)}`);
      check(after.actions.some((action) => action.startsWith("load:")), `${file}: list not re-read after the change`);
      check(JSON.stringify(after.pressed) === JSON.stringify(["Ждём студента"]), `${file}: pressed ${after.pressed}`);
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
  for (const look of ["current", "next"]) {
    for (const name of Object.keys(SCENARIOS)) {
      const { scenario, element } = await buildPage(name, look);
      out.push({ name: `${name}${look === "next" ? "-next" : ""}`, html: renderToStaticMarkup(withContexts(element, pathnameOf(scenario), searchOf(scenario))) });
    }
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
  console.error("usage: conversations-static-render.cjs --json | --screenshots [outDir] [--look=next]");
  process.exit(2);
}
