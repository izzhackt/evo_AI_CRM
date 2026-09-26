"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в boards-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Оболочка нового облика — Э1.2 плана редизайна 25.09.2026: меню без верхней
 * панели, нижняя панель телефона и лист «Ещё» (AppShellNext.tsx; временное
 * сосуществование до Э1.5, izzhackt/evo_AI_CRM#1061).
 *
 * Рендерит НАСТОЯЩИЙ AppShell (оба облика) для Admin, для просмотра роли
 * «Приёмная» и для приглашённых сотрудников продаж и поступления — с
 * СИНТЕТИЧЕСКИМИ сотрудниками, уведомлениями и данными страниц: они выдуманы
 * для проверки вёрстки и не являются записями EVO. Ключи прав сотрудников —
 * названия прав ролей (аудит доступа 26.09), без людей. Живой Supabase, права
 * сервера, серверные действия и маршрутизатор Next.js этот рендер не проверяет.
 *
 *   node tests/e2e/shell-static-render.cjs --json
 *     → stdout: JSON [{ name, role, look, pathname, html }] — статическая
 *       разметка оболочки в прежнем и новом облике с простым телом (для
 *       tests/v3-shell-next.test.mjs).
 *   node tests/e2e/shell-static-render.cjs --screenshots [outDir]
 *     → страницы «Сегодня», Студенты, доска, Сообщения, Задачи: оболочка —
 *       `renderToString` и `hydrateRoot` настоящими клиентскими компонентами
 *       (бандл esbuild); тело — статическая разметка настоящих экранов из
 *       students/tasks/boards-static-render.cjs --json и CaseChatWorkspace с
 *       синтетической перепиской. Снимки
 *       Playwright Chromium 1440×900, 1280×800, 1920×1080, 390×844, 360×740,
 *       320×568 и сценарии (отделы на 1280×800 и тень у края списка, лист «Ещё»
 *       с «Закрыть» на месте «Ещё», уведомления в верхнем слое, поле ответа и
 *       подписи вкладок при крупном корневом шрифте, рейка при просмотре
 *       роли, одна высота заголовка у всех страниц). «Сегодня» — настоящая
 *       страница `v3/main/page.tsx` с синтетическими читателями очереди
 *       (стартовая у каждой роли, без перенаправлений). Проверки
 *       печатаются JSON-строками; при нарушении — код выхода 1. По умолчанию
 *       outDir — .impeccable/review (не коммитится).
 */

const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOGO = join(ROOT, "public/brand/evo-logo.png");
const LOGO_URL = pathToFileURL(LOGO).href;

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
// Статический импорт логотипа: next/image получает объект как от сборщика.
Module._extensions[".png"] = (module) => {
  module.exports = { src: LOGO_URL, width: 1843, height: 842 };
};
// CSS-модули: имена классов как есть, стили — из самого файла.
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

const routerStub = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

function withContexts(node, pathname, search) {
  return h(AppRouterContext.Provider, { value: routerStub },
    h(PathnameContext.Provider, { value: pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

// --- синтетические сотрудники и уведомления ---------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const BASE_ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "aaaaaaaa-1111-4111-8111-000000000001", organizationId: ORG, platformAccessVersion: 1,
  email: "synthetic@example.invalid", assignments: [], permissionKeys: [],
};
const SALES_KEYS = [
  // Sales Manager (названия прав роли, аудит доступа 26.09)
  "ai.draft.request", "ai.draft.review", "case.read.summary", "case.workflow.read", "client.read",
  "communication.manual.send", "communication.read.full", "communication.read.summary", "contract.draft.manage",
  "contract.evidence.confirm", "document.read.sales", "finance.event.confirm", "finance.first.payment.confirm",
  "finance.read.summary", "lead.read", "lead.sales.owner.assign", "lead.sales.workflow.manage",
  "sales.register.manage", "sales.register.read", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.create",
  // «Продажи — общие разделы»
  "catalog.read", "contract.template.read", "knowledge.read.approved", "organization.read", "reply.snippet.all",
  "reply.snippet.manage", "reply.snippet.sales", "staff.assistant.use", "staff.task.create", "team.chat.general",
  "team.chat.sales", "workflow.contract.read",
];
const ADMISSIONS_KEYS = [
  // Admissions
  "ai.draft.request", "ai.draft.review", "application.manage", "case.lifecycle.change", "case.read.full",
  "case.read.summary", "case.route.manage", "case.update.append", "case.workflow.read", "client.read",
  "communication.manual.send", "communication.read.full", "decision.manage", "decision.read", "document.download",
  "document.extract", "document.manage", "document.read.full", "document.review", "document.upload",
  "finance.read.summary", "finance.stop.create", "lead.read", "notification.create", "post.contract.manage",
  "profile.manage", "profile.read.full", "staff.task.complete", "staff.task.edit", "staff.task.read", "task.assign",
  "task.create", "task.manage", "task.visibility.manage", "visa.manage",
  // «Сопровождение — общие разделы»
  "catalog.read", "company.file.download", "company.file.manage", "company.file.read", "company.file.upload",
  "contract.template.read", "knowledge.read.approved", "organization.read", "reply.snippet.admissions",
  "reply.snippet.all", "reply.snippet.manage", "staff.assistant.use", "staff.task.create", "team.chat.admissions",
  "team.chat.general", "workflow.contract.read",
];
const ACTORS = {
  admin: { ...BASE_ACTOR, displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: null },
  // Admin смотрит интерфейс «Приёмной»: новый облик остаётся (Э1.2), владелец видит меню роли.
  admissions: { ...BASE_ACTOR, displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: "admissions" },
  sales: {
    ...BASE_ACTOR, displayName: "Менеджер продаж (синтетический)", systemRole: "staff", presentationRole: null,
    assignments: [{ label: "Sales Manager" }, { label: "Продажи — общие разделы" }], permissionKeys: SALES_KEYS,
  },
  "admissions-staff": {
    ...BASE_ACTOR, displayName: "Куратор (синтетический)", systemRole: "staff", presentationRole: null,
    assignments: [{ label: "Admissions" }, { label: "Сопровождение — общие разделы" }], permissionKeys: ADMISSIONS_KEYS,
  },
};
// Ожидаемые вкладки (решение владельца 26.09.2026): доступные имена — полные
// имена разделов; видимая подпись «Воронки продаж» короче — «Воронка».
const EXPECTED_TABS = {
  admin: ["Сегодня", "Студенты", "Задачи", "Сообщения", "Ещё"],
  admissions: ["Сегодня", "Студенты", "Задачи", "Сообщения", "Ещё"],
  "admissions-staff": ["Сегодня", "Студенты", "Задачи", "Сообщения", "Ещё"],
  sales: ["Сегодня", "Воронка продаж", "Заявки", "Задачи", "Ещё"],
};
const EXPECTED_TAB_TEXT = { ...EXPECTED_TABS, sales: ["Сегодня", "Воронка", "Заявки", "Задачи", "Ещё"] };

const notificationId = (n) => `ffffffff-3333-4333-8333-${String(n).padStart(12, "0")}`;
const NOTIFICATIONS = {
  unreadCount: "3",
  nextCursor: null,
  items: [
    { id: notificationId(1), kind: "task_assigned", createdAt: "2026-09-26T05:10:00.000Z", readAt: null, href: "/v3/tasks",
      actorDisplayName: "Коллега (синтетический)", subjectTitle: "Проверить анкету (синтетика)", studentDisplayName: null, subjectDueOn: null, subjectDueAt: null },
    { id: notificationId(2), kind: "chat_mention", createdAt: "2026-09-26T04:40:00.000Z", readAt: null, href: "/v3/team-chat",
      actorDisplayName: "Коллега (синтетический)", subjectTitle: null, studentDisplayName: null, subjectDueOn: null, subjectDueAt: null },
    { id: notificationId(3), kind: "case_message", createdAt: "2026-09-25T12:00:00.000Z", readAt: null, href: "/v3/messages",
      actorDisplayName: "Студент (синтетический)", subjectTitle: null, studentDisplayName: "Студент (синтетический)", subjectDueOn: null, subjectDueAt: null },
    { id: notificationId(4), kind: "task_updated", createdAt: "2026-09-24T09:00:00.000Z", readAt: "2026-09-24T10:00:00.000Z", href: "/v3/tasks",
      actorDisplayName: "Коллега (синтетический)", subjectTitle: "Созвон с семьёй (синтетика)", studentDisplayName: null, subjectDueOn: null, subjectDueAt: null },
  ],
};

// --- тела страниц -------------------------------------------------------------
const SLOT = '<div data-harness-slot=""></div>';

function partShell(props, innerHtml) {
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const markup = renderToStaticMarkup(h(PartShell, props, h("div", { "data-harness-slot": "" })));
  return markup.replace(SLOT, innerHtml);
}

/**
 * Стартовая страница — «Сегодня» (Э3), настоящая страница
 * `src/app/(v3)/v3/main/page.tsx`: актёр страницы подменён, очередь собирает
 * настоящий `readTodayQueue` (права роли, независимые чтения) с
 * синтетическими читателями — по паре задач, дел, лидов и переписок, сроки
 * от сегодняшнего дня. Разметку строит сама страница. Перенаправлений у неё
 * нет: «Сегодня» — стартовая страница каждой роли.
 */
function homeReaders(actor) {
  const { dayInOrganizationTimezone } = require(join(ROOT, "src/lib/platform-task-deadline.ts"));
  const { shiftDay } = require(join(ROOT, "src/components/v3/calendar/types.ts"));
  const today = dayInOrganizationTimezone(new Date());
  const day = (offset) => shiftDay(today, offset);
  const me = actor.membershipId;
  const id = (prefix, n) => `${prefix}-${String(n).padStart(12, "0")}`;
  const staffTask = (n, title, dueOn) => ({
    id: id("bbbbbbbb-5555-4555-8555", n), organizationId: ORG, creatorMembershipId: me, creatorDisplayName: actor.displayName,
    assigneeMembershipId: me, assigneeDisplayName: actor.displayName, title, description: null, status: "open", priority: "normal",
    dueOn, dueAt: null, version: "1", sourceMessageId: null, createdAt: "2026-09-20T05:00:00.000Z", updatedAt: "2026-09-24T05:00:00.000Z",
  });
  const caseRow = (n, name, step, due) => ({
    studentCaseId: id("dddddddd-2222-4222-8222", n), studentDisplayName: name, state: "active", admissionsDirection: "CN", targetCountry: null,
    targetDegree: "Бакалавриат", pipelineStage: "documents", pipelineHidden: false, nextAction: step, nextActionDueOn: due,
    dueBand: due < today ? "overdue" : due === today ? "today" : "later", admissionsVersion: "1", currentCuratorMembershipId: me,
    currentCuratorDisplayName: actor.displayName, isMine: true, attentionFlags: [], overdueTaskCount: 0, documents: null,
    updatedAt: "2026-09-24T05:00:00.000000Z", cursor: `due|0|${due}|${id("dddddddd-2222-4222-8222", n)}`,
  });
  const lead = (n, name, action, due, owner) => ({
    id: id("ffffffff-3333-4333-8333", n), name, stageKey: due ? "contacting" : "new", source: "website", nextAction: action,
    nextActionAt: due ? `${due.slice(8)}.${due.slice(5, 7)}` : null, due: due === null ? "none" : due < today ? "overdue" : due === today ? "today" : "later",
    stageAgeDays: 1, latestNote: null, href: `/v3/profile?id=${id("ffffffff-3333-4333-8333", n)}`,
    workflow: {
      leadId: id("ffffffff-3333-4333-8333", n), currentOwnerMembershipId: owner, currentOwnerDisplayName: owner ? actor.displayName : null,
      stageKey: due ? "contacting" : "new", nextActionText: action, nextActionDueDate: due, workflowVersion: "1",
    },
  });
  return {
    async listStaffTasks() {
      return { rows: [staffTask(1, "Подготовить вопросы к планёрке (синтетика)", day(-1)), staffTask(2, "Проверить отчёт недели (синтетика)", today)], nextCursor: null };
    },
    async listCaseTasks() {
      return { rows: [], nextCursor: null };
    },
    async readStudentCaseQueue(_actor, request) {
      const rows = request.view === "mine" ? [caseRow(1, "Студент А (синтетика)", "Собрать документы (синтетика)", today), caseRow(2, "Студент Б (синтетика)", "Отправить анкету (синтетика)", day(3))] : [];
      return { view: request.view, sort: "due", today, rows, nextCursor: null };
    },
    async readLeads(_actor, assignment) {
      return {
        leads: assignment === "mine" ? [lead(1, "Лид А (синтетика)", "Перезвонить (синтетика)", today, me)] : [lead(2, "Лид Б (синтетика)", null, null, null)],
        truncated: false,
      };
    },
    async readChats() {
      return {
        rows: [{ studentCaseId: id("dddddddd-2222-4222-8222", 3), studentDisplayName: "Студент В (синтетика)", lastMessageSnippet: "Добрый день (синтетика)",
          lastMessageAt: `${day(-1)}T08:00:00.000Z`, lastMessageAuthorMembershipId: "aaaaaaaa-1111-4111-8111-000000000099", awaitState: "needs_reply", unread: true }],
        truncated: false,
      };
    },
  };
}

async function homeFixture(role) {
  // Назначения оболочки несут только подпись; права задач читают и область —
  // у синтетических сотрудников она «свои».
  const actor = { ...ACTORS[role], assignments: ACTORS[role].assignments.map((assignment) => ({ scope: { kind: "own", key: null, resourceKind: null }, ...assignment })) };
  const guards = require(join(ROOT, "src/lib/platform-guards.ts"));
  const today = require(join(ROOT, "src/lib/v3/today-source.ts"));
  guards.requireV3PageActor = async () => actor;
  const read = today.readTodayQueue.harnessOriginal ?? today.readTodayQueue;
  today.readTodayQueue = Object.assign((who, options) => read(who, { ...options, readers: homeReaders(actor) }), { harnessOriginal: read });
  const { default: MainPart } = require(join(ROOT, "src/app/(v3)/v3/main/page.tsx"));
  const element = await MainPart({ searchParams: Promise.resolve({}) });
  return { pathname: "/v3/main", search: "", body: renderToStaticMarkup(withContexts(element, "/v3/main", "")) };
}

function spawnJson(script) {
  const output = execFileSync(process.execPath, [join(__dirname, script), "--json"], { maxBuffer: 256 * 1024 * 1024 });
  return new Map(JSON.parse(output).map((item) => [item.name, item.html]));
}

function mainOf(html) {
  const start = html.indexOf("<main");
  const end = html.lastIndexOf("</main>");
  if (start < 0 || end < 0) throw new Error("no <main> in board markup");
  return html.slice(start, end + "</main>".length);
}

/**
 * «Сообщения» — настоящий CaseChatWorkspace в обёртке страницы с синтетической
 * перепиской. Он рендерится на сервере и гидратируется в браузере: поле ответа
 * появляется только на клиенте (черновик из localStorage), поэтому его место
 * меряется после гидратации.
 */
function messagesFixture() {
  const page = readFileSync(join(ROOT, "src/app/(v3)/v3/messages/page.tsx"), "utf8");
  const mainClass = page.match(/<main className="([^"]+)" aria-label="Сообщения">/u)?.[1];
  if (!mainClass) throw new Error("messages page <main> class not found");
  const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;
  const names = ["Студент А (синтетика)", "Студент Б (синтетика)", "Студент В (синтетика)", "Студент Г (синтетика)", "Студент Д (синтетика)", "Студент Е (синтетика)"];
  const rows = names.map((name, index) => ({
    studentCaseId: caseId(index + 1), studentDisplayName: name, lastMessageSnippet: "Добрый день! Документы отправили (синтетика)",
    lastMessageAt: `2026-09-2${6 - (index % 3)}T0${index + 1}:00:00.000Z`, lastMessageAuthorMembershipId: null,
    awaitState: index % 3 === 0 ? "needs_reply" : index % 3 === 1 ? "awaiting_student" : "none", unread: index === 0,
  }));
  const me = BASE_ACTOR.membershipId;
  const messages = Array.from({ length: 14 }, (_, index) => {
    const sequence = 14 - index;
    const mine = sequence % 2 === 0;
    return {
      id: `cccccccc-9999-4999-8999-${String(sequence).padStart(12, "0")}`, sequenceId: String(sequence),
      authorMembershipId: mine ? me : "aaaaaaaa-1111-4111-8111-000000000099", authorName: mine ? "Администратор (синтетический)" : names[0],
      body: mine ? `Проверили документы, всё в порядке. Следующий шаг — перевод диплома (синтетика ${sequence}).` : `Здравствуйте! Отправили скан паспорта, посмотрите, пожалуйста (синтетика ${sequence}).`,
      createdAt: `2026-09-2${sequence > 7 ? 5 : 4}T${String(8 + (sequence % 9)).padStart(2, "0")}:00:00.000Z`,
      quotedMessageId: null, quotedPreview: null, attachmentKind: null, attachmentId: null, attachmentLabel: null,
    };
  });
  return {
    pathname: "/v3/messages", search: `case=${caseId(1)}`, body: null,
    messages: {
      mainClass,
      props: {
        organizationId: ORG, membershipId: me,
        realtimeConfig: { url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" },
        initialThreads: { rows, truncated: false }, initialStudentDisplayName: names[0], selectedCaseId: caseId(1),
        initialPage: { messages, cursor: "14", hasMore: false, thread: { awaitState: "needs_reply", lastMessageAt: messages[0].createdAt, lastMessageSequenceId: "14" }, readSequenceId: "14" },
        initialPageFailure: null,
      },
    },
  };
}

/** WhatsApp (у продаж нет «Сообщений»): настоящий loading.tsx — страница `fill` на высоту окна. */
function whatsappBody() {
  const { default: InboxLoading } = require(join(ROOT, "src/app/(v3)/v3/inbox/loading.tsx"));
  return renderToStaticMarkup(withContexts(h(InboxLoading), "/v3/inbox", ""));
}

// --- оболочка -----------------------------------------------------------------
function shellTree({ actor, notifications, look, pathname, search, body, messages = null }) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const content = messages
    ? h("main", { className: messages.mainClass, "aria-label": "Сообщения" },
      h(require(join(ROOT, "src/components/v3/case-chat/CaseChatThread.tsx")).CaseChatWorkspace, messages.props))
    : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: body } });
  return withContexts(
    h("div", { className: "v3-world", "data-look": look === "next" ? "next" : undefined },
      h(AppShell, { actor, initialNotifications: notifications, ...(look === "next" ? { look: "next" } : {}) }, content)),
    pathname, search);
}

const notificationsFor = (actor) => (actor.presentationRole === null ? NOTIFICATIONS : null);

/** Статическая разметка для модульного теста: обе оболочки, простое тело. */
function jsonScenarios() {
  const out = [];
  const paths = [
    ["home", "/v3/main", ""],
    ["students", "/v3/profile", ""],
    ["calendar", "/v3/calendar", ""],
    ["board", "/v3/pipeline", ""],
    ["admissions-board", "/v3/admissions-pipeline", ""],
  ];
  for (const role of Object.keys(ACTORS)) {
    for (const [page, pathname, search] of paths) {
      for (const look of ["current", "next"]) {
        const actor = ACTORS[role];
        const body = `<main class="px-4 py-8"><h1 class="t-page-title">${page} (синтетика)</h1></main>`;
        out.push({ name: `${page}-${role}-${look}`, role, look, pathname,
          html: renderToStaticMarkup(shellTree({ actor, notifications: notificationsFor(actor), look, pathname, search, body })) });
      }
    }
  }
  return out;
}

// --- CSS ------------------------------------------------------------------------
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

// --- браузерная сборка оболочки ----------------------------------------------
/**
 * Тонкая замена `next/link`: та же разметка `<a>`; обычный щелчок вызывает
 * `onNavigate` (как Link Next.js) и `router.push` из контекста, а `onClick`
 * компонента с `preventDefault()` оставляет всё ему.
 */
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

const FIXTURE_ID = "shell-fixture";
const CLIENT_ENTRY = `
const React = require("react");
const { hydrateRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { CaseChatWorkspace } = require("@/components/v3/case-chat/CaseChatThread");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], recoverable: [], errors: [] };
const router = {
  push: (href) => { window.__harness.pushes.push(href); }, replace: (href) => { window.__harness.pushes.push(href); },
  refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: fixture.pathname },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-look": fixture.look === "next" ? "next" : undefined },
          h(AppShell, { actor: fixture.actor, initialNotifications: fixture.notifications, ...(fixture.look === "next" ? { look: "next" } : {}) },
            fixture.messages
              ? h("main", { className: fixture.messages.mainClass, "aria-label": "Сообщения" }, h(CaseChatWorkspace, fixture.messages.props))
              : h("div", { "data-harness-body": "", style: { display: "contents" }, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: fixture.body } })))))));
hydrateRoot(document.getElementById("root"), tree, {
  onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)),
});
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.hydrated = "true"; }));
`;

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  const notificationStub = `
const page = ${JSON.stringify(NOTIFICATIONS)};
export async function loadStaffNotificationsAction() { return { ok: true, page }; }
export async function markStaffNotificationReadAction() { return { ok: true }; }
export async function markAllStaffNotificationsReadAction() { return { ok: true }; }`;
  // «Сообщения»: чтения отвечают той же синтетической перепиской, отправка
  // честно недоступна — снимок ничего не пишет.
  const caseChatStub = `
const fixture = () => JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent).messages.props;
export async function readCaseChatPageAction() { return { status: "ready", page: fixture().initialPage }; }
export async function loadStaffCaseChatThreadsAction() { return { status: "ready", list: fixture().initialThreads }; }
export async function markCaseChatReadAction() { return { status: "saved", requestId: null }; }
export async function postCaseChatMessageAction() { return { status: "unavailable", requestId: null }; }
export async function setCaseChatAwaitAction() { return { status: "unavailable", requestId: null }; }`;
  const plugin = {
    name: "shell-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({
        contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`,
        loader: "js",
      }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({
        contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });",
        loader: "js",
      }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия: уведомления отвечают синтетической страницей,
      // остальные честно отказывают.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        if (args.path.endsWith("staff-notification-actions.ts")) return { contents: notificationStub, loader: "ts" };
        if (args.path.endsWith("platform-case-chat-actions.ts")) return { contents: caseChatStub, loader: "ts" };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}() { window.__harness.errors.push("server action ${name}"); throw new Error("shell harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "shell-client-entry.js", loader: "js" },
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } };" },
    plugins: [plugin],
    logLevel: "error",
  });
}

// --- измерения в браузере -------------------------------------------------------
function shellMetrics() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const rect = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), height: Math.round(box.height) };
  };
  const shell = document.querySelector('[data-testid="v3-shell"]');
  const tabbar = document.querySelector('[data-testid="v3-shell-tabbar"]');
  const topbar = document.querySelector('[data-testid="v3-shell-topbar"]');
  const menu = document.querySelector("[data-shell-menu]");
  const logout = document.querySelector('[data-testid="staff-logout"]');
  const main = [...document.querySelectorAll("main")].find(visible);
  const composer = main ? [...main.querySelectorAll("textarea")].find(visible) : null;
  const tabs = tabbar && visible(tabbar) ? [...tabbar.querySelectorAll(":scope > ul > li > a, :scope > ul > li > button")] : [];
  const chrome = [menu, tabbar, topbar].filter(visible);
  const texts = chrome.flatMap((root) => [...root.querySelectorAll("*")])
    .filter((element) => visible(element) && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  const targets = chrome.flatMap((root) => [...root.querySelectorAll("a, button")]).filter(visible);
  const oldTopBar = [...document.querySelectorAll('[data-testid="v3-shell"] > div > div')].find((element) => element.className.includes("md:min-h-16") && visible(element));
  const tabbarTop = tabbar && visible(tabbar) ? tabbar.getBoundingClientRect().top : window.innerHeight;
  const heading = [...document.querySelectorAll("[data-shell-content] h1")].find(visible);
  const logo = [...document.querySelectorAll("[data-shell-menu] nav img")].find(visible);
  const lineCount = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].filter((box) => box.width > 0).map((box) => Math.round(box.top))).size;
  };
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    look: shell?.dataset.shellLook ?? "current",
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    oldTopBar: Boolean(oldTopBar),
    topRow: visible(topbar) ? rect(topbar) : null,
    sidebar: visible(menu) ? rect(menu) : null,
    tabbar: tabs.length ? {
      slots: tabs.length,
      labels: tabs.map((tab) => tab.querySelector(":scope > span:last-child").textContent.trim()),
      // Доступное имя вкладки-ссылки: aria-label или подпись; у «Ещё» — подпись.
      names: tabs.map((tab) => (tab.tagName === "A" ? tab.getAttribute("aria-label") : null) ?? tab.querySelector(":scope > span:last-child").textContent.trim()),
      // Подпись в одну строку, без переноса внутри слова.
      multiLine: tabs.filter((tab) => lineCount(tab.querySelector(":scope > span:last-child")) !== 1).map((tab) => tab.textContent.trim()),
      // Один ряд иконок: верх «пилюль» у всех вкладок одинаков и отстоит от верхней границы панели.
      pillTops: [...new Set(tabs.map((tab) => Math.round(tab.querySelector(":scope > span:first-child").getBoundingClientRect().top - tabbar.getBoundingClientRect().top)))],
      current: tabs.filter((tab) => tab.getAttribute("aria-current") === "page").map((tab) => tab.querySelector(":scope > span:last-child").textContent.trim()),
      badge: tabbar.querySelector('[data-shell-tab="more"] span[aria-hidden="true"]')?.textContent ?? null,
      rect: rect(tabbar),
      minTargetHeight: Math.min(...tabs.map((tab) => Math.round(tab.getBoundingClientRect().height))),
      minTargetWidth: Math.min(...tabs.map((tab) => Math.round(tab.getBoundingClientRect().width))),
      // Вкладка целиком внутри панели высотой --shell-tabbar: подпись в две строки не вылезает вниз.
      listHeight: Math.round(tabbar.querySelector(":scope > ul").getBoundingClientRect().height),
      labelsClipped: tabs.filter((tab) => {
        const list = tabbar.querySelector(":scope > ul").getBoundingClientRect();
        const box = tab.getBoundingClientRect();
        return box.top < list.top - 0.5 || box.bottom > list.bottom + 0.5 || tab.scrollHeight > tab.clientHeight + 1
          || [...tab.querySelectorAll("span")].some((span) => span.scrollWidth > span.clientWidth + 1 || span.scrollHeight > span.clientHeight + 1);
      }).map((tab) => tab.textContent.trim()),
    } : null,
    logout: visible(logout) ? { ...rect(logout), inViewport: logout.getBoundingClientRect().top >= 0 && logout.getBoundingClientRect().bottom <= window.innerHeight } : null,
    mainTop: main ? rect(main).top : null,
    headingTop: heading ? Math.round(heading.getBoundingClientRect().top) : null,
    headingCenter: heading ? Math.round(heading.getBoundingClientRect().top + heading.getBoundingClientRect().height / 2) : null,
    logoCenter: logo ? Math.round(logo.getBoundingClientRect().top + logo.getBoundingClientRect().height / 2) : null,
    mainBottom: main ? rect(main).bottom : null,
    // Низ `main` при прокрутке страницы до конца (телефон, обычный поток).
    mainBottomAtEnd: main ? Math.round(main.getBoundingClientRect().bottom - Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY)) : null,
    composer: composer ? { bottom: Math.round(composer.getBoundingClientRect().bottom), limit: Math.round(tabbarTop), above: composer.getBoundingClientRect().bottom <= tabbarTop + 0.5 } : null,
    minFontPx: texts.length ? Math.min(...texts.map((element) => parseFloat(getComputedStyle(element).fontSize))) : null,
    smallTargets: targets.filter((element) => {
      const box = element.getBoundingClientRect();
      return box.height < 44 || box.width < 44;
    }).map((element) => element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)),
    solidRedInChrome: targets.filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
  };
}

// --- снимки и сценарии -------------------------------------------------------------
const VIEWPORTS = {
  "1440": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  "1280": { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  "1920": { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  "390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "360": { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  // Перекомпоновка на 320 px (WCAG 1.4.10, план редизайна: телефон 393 и 320).
  "320": { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const PHONE = new Set(["390", "360", "320"]);

async function pageFixtures() {
  const students = spawnJson("students-static-render.cjs");
  const tasks = spawnJson("tasks-static-render.cjs");
  const boards = spawnJson("boards-static-render.cjs");
  const messages = messagesFixture();
  const whatsapp = whatsappBody();
  const studentsFor = { admin: "admin-active", admissions: "curator-mine", "admissions-staff": "curator-mine", sales: "sales" };
  const fixtures = {
    home: (role) => homes[role],
    students: (role) => ({
      pathname: "/v3/profile", search: "",
      body: partShell({ title: "Студенты", dense: role !== "sales" }, students.get(studentsFor[role])),
    }),
    // Доска роли: продажи и Admin — «Воронка продаж», поступление — «Воронка поступления».
    board: (role) => role === "admissions" || role === "admissions-staff"
      ? { pathname: "/v3/admissions-pipeline", search: "", body: mainOf(boards.get("admissions")) }
      : { pathname: "/v3/pipeline", search: "", body: mainOf(boards.get("sales")) },
    // Переписка роли: у продаж нет «Сообщений» — их страница на высоту окна WhatsApp.
    messages: (role) => role === "sales"
      ? { pathname: "/v3/inbox", search: "", body: whatsapp }
      : messages,
    tasks: () => ({ pathname: "/v3/tasks", search: "", body: partShell({ title: "Задачи" }, tasks.get("mine-default")) }),
  };
  // «Сегодня» — настоящая страница, без перенаправлений: стартовая у каждой роли.
  const homes = {};
  for (const role of Object.keys(ACTORS)) homes[role] = await homeFixture(role);
  return fixtures;
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundleName = "shell-client.js";
  const fixtures = await pageFixtures();
  const css = await compileCss();
  await buildClientBundle(join(outDir, bundleName));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

  const writePage = (name, role, look, fixture) => {
    const actor = ACTORS[role];
    const notifications = notificationsFor(actor);
    const markup = renderToString(shellTree({ actor, notifications, look, ...fixture }));
    const data = JSON.stringify({ actor, notifications, look, ...fixture }).replaceAll("<", "\\u003c");
    const htmlPath = join(outDir, `shell-${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>Оболочка — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${data}</script><script src="${bundleName}"></script></body></html>`,
    ].join(""));
    return htmlPath;
  };

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (htmlPath, viewportKey, options = {}) => {
    const context = await browser.newContext({ ...VIEWPORTS[viewportKey], reducedMotion: options.reducedMotion ?? "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    if (options.rootFontSize) await page.addStyleTag({ content: `html { font-size: ${options.rootFontSize}px !important; }` });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    await page.waitForTimeout(50);
    // Телефон: Chrome запоминает ширину первой (частичной) раскладки при
    // разборе HTML и расширяет по ней окно раскладки до следующего изменения
    // окна (на 320 px — 331 px, и у прежнего облика с тем же телом). Ширина
    // первой раскладки пишется в отчёт, а проверки и снимок — по устоявшейся
    // раскладке: окно на 1 px шире и обратно, масштаб страницы снова 1.
    let firstLayoutWidth = null;
    if (PHONE.has(viewportKey)) {
      firstLayoutWidth = await page.evaluate(() => window.innerWidth);
      const { width, height } = VIEWPORTS[viewportKey].viewport;
      await page.setViewportSize({ width: width + 1, height });
      await page.waitForTimeout(50);
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await cdp.detach();
      await page.waitForTimeout(50);
      const settled = await page.evaluate(() => ({ width: window.innerWidth, scale: window.visualViewport.scale, visual: window.visualViewport.width }));
      if (settled.width !== width || settled.scale !== 1 || settled.visual !== width) throw new Error(`${htmlPath} ${viewportKey}: viewport did not settle ${JSON.stringify(settled)}`);
    }
    return { context, page, errors, firstLayoutWidth };
  };
  const finish = async ({ context, page, errors }, label) => {
    const harness = await page.evaluate(() => window.__harness);
    const problems = [...errors, ...harness.recoverable.map((message) => `recoverable: ${message}`)];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };

  try {
    const roles = ["admin", "admissions", "sales"];
    const pages = ["home", "students", "board", "messages", "tasks"];
    const htmlFor = {};
    for (const pageKey of pages) {
      for (const role of [...roles, "admissions-staff"]) {
        htmlFor[`${pageKey}-${role}`] = writePage(`${pageKey}-${role}`, role, "next", fixtures[pageKey](role));
      }
    }
    htmlFor["home-admin-current"] = writePage("home-admin-current", "admin", "current", fixtures.home("admin"));

    // 1. Все страницы × роли × окна.
    const headingTops = {};
    for (const pageKey of pages) {
      for (const role of roles) {
        for (const viewportKey of Object.keys(VIEWPORTS)) {
          const file = `shell-${pageKey}-${role}-${viewportKey}.png`;
          const session = await open(htmlFor[`${pageKey}-${role}`], viewportKey);
          const metrics = await session.page.evaluate(shellMetrics);
          await session.page.screenshot({ path: join(outDir, file) });
          await finish(session, file);
          report({ file, page: pageKey, role, firstLayoutWidth: session.firstLayoutWidth, ...metrics });
          const label = `${file}`;
          // Заголовок страницы: одна высота у всех страниц окна (кроме доски в рейке — там нет логотипа).
          if (metrics.headingTop !== null) (headingTops[viewportKey] ??= []).push({ file, top: metrics.headingTop });
          if (metrics.logoCenter !== null && metrics.headingCenter !== null) {
            check(Math.abs(metrics.logoCenter - metrics.headingCenter) <= 2, `${label}: page title centre ${metrics.headingCenter} vs logo centre ${metrics.logoCenter}`);
          }
          check(metrics.look === "next", `${label}: new shell not rendered`);
          check(metrics.overflowX === 0, `${label}: horizontal overflow ${metrics.overflowX}px`);
          check(!metrics.oldTopBar, `${label}: old top bar is visible`);
          check(metrics.minFontPx === null || metrics.minFontPx >= 12, `${label}: shell text ${metrics.minFontPx}px`);
          check(metrics.smallTargets.length === 0, `${label}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
          check(metrics.solidRedInChrome === 0, `${label}: solid red in the shell`);
          if (PHONE.has(viewportKey)) {
            check(metrics.tabbar !== null, `${label}: no tab bar on the phone`);
            check(metrics.sidebar === null, `${label}: sidebar visible on the phone`);
            if (metrics.tabbar) {
              check(metrics.tabbar.slots <= 5, `${label}: ${metrics.tabbar.slots} tab slots`);
              check(JSON.stringify(metrics.tabbar.names) === JSON.stringify(EXPECTED_TABS[role]), `${label}: tabs ${metrics.tabbar.names.join(" · ")}`);
              check(JSON.stringify(metrics.tabbar.labels) === JSON.stringify(EXPECTED_TAB_TEXT[role]), `${label}: tab text ${metrics.tabbar.labels.join(" · ")}`);
              check(metrics.tabbar.minTargetHeight >= 44 && metrics.tabbar.minTargetWidth >= 44, `${label}: tab target ${metrics.tabbar.minTargetWidth}×${metrics.tabbar.minTargetHeight}`);
              check(metrics.tabbar.labelsClipped.length === 0, `${label}: clipped tab labels ${metrics.tabbar.labelsClipped.join(", ")}`);
              check(metrics.tabbar.multiLine.length === 0, `${label}: tab labels on two lines: ${metrics.tabbar.multiLine.join(", ")}`);
              check(metrics.tabbar.pillTops.length === 1 && metrics.tabbar.pillTops[0] >= 4, `${label}: tab icons not on one row ${metrics.tabbar.pillTops.join(", ")}`);
              check(metrics.tabbar.current.length <= 1, `${label}: several current tabs`);
            }
            check(metrics.topRow !== null && metrics.topRow.height <= 56, `${label}: phone top ${metrics.topRow?.height}px`);
          } else {
            check(metrics.tabbar === null, `${label}: tab bar on the desktop`);
            check(metrics.logout?.inViewport === true, `${label}: «Выйти» outside the viewport`);
            check(metrics.mainTop !== null && metrics.mainTop < 40, `${label}: content starts at ${metrics.mainTop}px (top bar left?)`);
          }
          if (metrics.composer) check(metrics.composer.above, `${label}: composer ${metrics.composer.bottom} below ${metrics.composer.limit}`);
          // WhatsApp продаж — страница `fill`: от 768 px высоту окна даёт колонка
          // оболочки (`isFillRoute`), `main` доходит до низа окна; на телефоне —
          // обычный поток (аудит 26.09, #1064), конец страницы — над панелью вкладок
          // (1 px — её верхняя граница, она ложится на нижний отступ `main`, py-6).
          const whatsappPage = pageKey === "messages" && role === "sales";
          if (pageKey === "messages" && !(whatsappPage && PHONE.has(viewportKey))) check(metrics.overflowY <= 0, `${label}: window page scrolls ${metrics.overflowY}px`);
          if (whatsappPage && !PHONE.has(viewportKey)) check(metrics.mainBottom === VIEWPORTS[viewportKey].viewport.height, `${label}: WhatsApp main ends at ${metrics.mainBottom}, not at the window bottom`);
          if (whatsappPage && PHONE.has(viewportKey)) check(metrics.tabbar !== null && metrics.mainBottomAtEnd <= metrics.tabbar.rect.top + 1, `${label}: WhatsApp page end ${metrics.mainBottomAtEnd} under the tab bar ${metrics.tabbar?.rect.top}`);
        }
      }
    }
    for (const [viewportKey, tops] of Object.entries(headingTops)) {
      const values = [...new Set(tops.map((entry) => entry.top))];
      report({ journey: "page-top", viewport: viewportKey, tops: values });
      check(values.length === 1, `page top at ${viewportKey}: title tops differ ${tops.map((entry) => `${entry.file}=${entry.top}`).join(", ")}`);
    }

    // 1б. Приглашённый сотрудник поступления (права, не просмотр роли): вкладки те же.
    for (const viewportKey of ["390", "1440"]) {
      const file = `shell-students-admissions-staff-${viewportKey}.png`;
      const session = await open(htmlFor["students-admissions-staff"], viewportKey);
      const metrics = await session.page.evaluate(shellMetrics);
      await session.page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ file, page: "students", role: "admissions-staff", ...metrics });
      if (PHONE.has(viewportKey)) check(JSON.stringify(metrics.tabbar?.labels) === JSON.stringify(EXPECTED_TABS["admissions-staff"]), `${file}: tabs ${metrics.tabbar?.labels.join(" · ")}`);
      check(metrics.overflowX === 0, `${file}: horizontal overflow`);
    }

    // 1в. Прежний облик для сравнения («до»).
    for (const viewportKey of ["1440", "390", "320"]) {
      const file = `shell-current-home-admin-${viewportKey}.png`;
      const session = await open(htmlFor["home-admin-current"], viewportKey);
      const metrics = await session.page.evaluate(shellMetrics);
      await session.page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ file, page: "home", role: "admin", firstLayoutWidth: session.firstLayoutWidth, ...metrics });
      check(metrics.look === "current" && metrics.tabbar === null, `${file}: current look changed`);
    }

    // 2. 1280×800, Admin: отделы открываются по одному (кроме отдела текущей
    //    страницы), у края длинного списка — тень внутрь, «Выйти» всегда в окне.
    for (const pageKey of ["home", "students"]) {
      const session = await open(htmlFor[`${pageKey}-admin`], "1280");
      const { page } = session;
      const groupsOpen = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-shell-menu] nav button[aria-expanded]")]
        .map((button) => [button.textContent.trim(), button.getAttribute("aria-expanded") === "true"])));
      const initial = await groupsOpen();
      for (const label of ["Продажи", "Поступление"]) {
        const group = page.locator("[data-shell-menu] nav button[aria-expanded]", { hasText: label });
        if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
      }
      await page.waitForTimeout(250);
      const edgeState = () => page.evaluate(() => {
        const scroller = document.querySelector("[data-shell-scroll]");
        const logout = document.querySelector('[data-testid="staff-logout"]').getBoundingClientRect();
        return {
          listScrolls: scroller.scrollHeight > scroller.clientHeight + 1,
          moreAbove: scroller.hasAttribute("data-more-above"),
          moreBelow: scroller.hasAttribute("data-more-below"),
          shadow: getComputedStyle(scroller).boxShadow,
          logoutInViewport: logout.top >= 0 && logout.bottom <= window.innerHeight,
          tasksVisible: (() => {
            const tasks = [...scroller.querySelectorAll("a")].find((link) => link.textContent.trim() === "Задачи");
            if (!tasks) return false;
            const box = tasks.getBoundingClientRect();
            const view = scroller.getBoundingClientRect();
            return box.top >= view.top && box.bottom <= view.bottom;
          })(),
        };
      });
      const expanded = { initial, after: await groupsOpen(), ...(await edgeState()) };
      const file = `shell-${pageKey}-admin-1280-expanded.png`;
      await page.screenshot({ path: join(outDir, file) });
      // Список прокручен до конца: тень сверху, снизу её нет.
      await page.evaluate(() => { const scroller = document.querySelector("[data-shell-scroll]"); scroller.scrollTop = scroller.scrollHeight; });
      await page.waitForTimeout(100);
      const scrolled = await edgeState();
      if (pageKey === "home") await page.screenshot({ path: join(outDir, "shell-home-admin-1280-expanded-scrolled.png") });
      await finish(session, file);
      report({ journey: "groups-1280", file, ...expanded, scrolled });
      check(expanded.logoutInViewport && scrolled.logoutInViewport, `${file}: «Выйти» outside the viewport`);
      if (pageKey === "home") {
        // Текущая страница вне отделов: открыт только последний открытый отдел.
        check(!initial["Продажи"] && !initial["Поступление"], `${file}: groups open on «Сегодня» ${JSON.stringify(initial)}`);
        check(!expanded.after["Продажи"] && expanded.after["Поступление"], `${file}: groups are not single-open ${JSON.stringify(expanded.after)}`);
      } else {
        // «Студенты» в «Поступлении»: отдел текущей страницы остаётся открытым.
        check(initial["Поступление"] && expanded.after["Продажи"] && expanded.after["Поступление"], `${file}: current group closed ${JSON.stringify(expanded.after)}`);
      }
      check(expanded.moreBelow === expanded.listScrolls && !expanded.moreAbove, `${file}: scroll cue ${JSON.stringify(expanded)}`);
      if (expanded.listScrolls) {
        check(expanded.shadow.includes("inset"), `${file}: no cue at the clipped edge`);
        check(scrolled.moreAbove && !scrolled.moreBelow && scrolled.tasksVisible, `${file}: after scrolling ${JSON.stringify(scrolled)}`);
      }
    }

    // 3. Телефон: лист «Ещё» — диалог, фокус заперт, Escape и «Закрыть» возвращают фокус.
    for (const [role, viewportKey] of [["admin", "390"], ["sales", "360"], ["admissions", "390"], ["admin", "320"]]) {
      const session = await open(htmlFor[`home-${role}`], viewportKey);
      const { page } = session;
      const more = page.locator('[data-shell-tab="more"]');
      const moreBox = await more.boundingBox();
      await more.click();
      await page.waitForSelector('[data-shell-menu][role="dialog"]');
      const focusOnOpen = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
      await page.waitForTimeout(250);
      const opened = await page.evaluate(() => {
        const dialog = document.querySelector("[data-shell-menu]");
        const box = dialog.getBoundingClientRect();
        const heading = document.getElementById(dialog.getAttribute("aria-labelledby"));
        return {
          role: dialog.getAttribute("role"), modal: dialog.getAttribute("aria-modal"), label: heading?.textContent ?? null,
          focusInside: dialog.contains(document.activeElement), focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30),
          covers: box.top <= 0 && box.bottom >= window.innerHeight - 1 && box.left <= 0 && box.right >= window.innerWidth - 1,
          inert: ['[data-testid="v3-shell-tabbar"]', '[data-testid="v3-shell-topbar"]'].map((selector) => document.querySelector(selector).inert),
          contentInert: document.querySelector("[data-shell-content]").parentElement.inert,
          moreExpanded: document.querySelector('[data-shell-tab="more"]').getAttribute("aria-expanded"),
          logoutInViewport: (() => { const r = document.querySelector('[data-testid="staff-logout"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })(),
          items: [...dialog.querySelectorAll("a, button")].filter((element) => element.getBoundingClientRect().height > 0).map((element) => element.getAttribute("aria-label") ?? element.textContent.trim()),
          animation: getComputedStyle(dialog.querySelector("[data-shell-menu-body]")).animationName,
          htmlOverflow: document.documentElement.style.overflow,
          // «Закрыть» — внутри диалога, на месте «Ещё» у нижнего края.
          close: (() => {
            const button = dialog.querySelector('[data-shell-tab="close"]');
            if (!button) return null;
            const r = button.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), inside: dialog.contains(button) };
          })(),
          sheetTabs: [...dialog.querySelectorAll('[data-testid="v3-shell-sheet-tabbar"] li > *')].map((element) => element.getAttribute("aria-label") ?? element.textContent.trim()),
        };
      });
      const file = `shell-sheet-${role}-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      // Tab по кругу: фокус не уходит со листа.
      const count = await page.evaluate(() => [...document.querySelectorAll("[data-shell-menu] a[href], [data-shell-menu] button:not([disabled])")].filter((element) => element.getClientRects().length > 0).length);
      let escaped = 0;
      for (let step = 0; step < count + 2; step += 1) {
        await page.keyboard.press("Tab");
        if (!(await page.evaluate(() => document.querySelector("[data-shell-menu]").contains(document.activeElement)))) escaped += 1;
      }
      await page.keyboard.press("Shift+Tab");
      const backInside = await page.evaluate(() => document.querySelector("[data-shell-menu]").contains(document.activeElement));
      await page.keyboard.press("Escape");
      const closed = await page.evaluate(() => ({
        role: document.querySelector("[data-shell-menu]").getAttribute("role"),
        hidden: getComputedStyle(document.querySelector("[data-shell-menu]")).display === "none",
        focusOnMore: document.activeElement === document.querySelector('[data-shell-tab="more"]'),
        moreExpanded: document.querySelector('[data-shell-tab="more"]').getAttribute("aria-expanded"),
        htmlOverflow: document.documentElement.style.overflow,
      }));
      // «Закрыть» тоже возвращает фокус.
      await more.click();
      await page.getByRole("button", { name: "Закрыть меню" }).click();
      const closedByButton = await page.evaluate(() => document.activeElement === document.querySelector('[data-shell-tab="more"]'));
      // Вкладка в листе ведёт в раздел и закрывает лист.
      await more.click();
      const firstTab = await page.evaluate(() => document.querySelector('[data-testid="v3-shell-sheet-tabbar"] a[data-shell-tab]')?.getAttribute("href") ?? null);
      await page.locator('[data-testid="v3-shell-sheet-tabbar"] a[data-shell-tab]').first().click();
      const afterTab = await page.evaluate(() => ({ pushes: window.__harness.pushes, sheet: document.querySelector("[data-shell-menu]").getAttribute("role") }));
      await finish(session, file);
      report({ journey: "sheet", file, role, moreBox, focusOnOpen, opened, tabCycle: { count, escaped, backInside }, closed, closedByButton, firstTab, afterTab });
      check(opened.close?.inside && moreBox && Math.abs(opened.close.x - moreBox.x) <= 1 && Math.abs(opened.close.y - moreBox.y) <= 1
        && Math.abs(opened.close.width - moreBox.width) <= 1, `${file}: «Закрыть» is not where «Ещё» was (${JSON.stringify(opened.close)} vs ${JSON.stringify(moreBox)})`);
      check(JSON.stringify(opened.sheetTabs) === JSON.stringify([...EXPECTED_TABS[role].slice(0, -1), "Закрыть меню"]), `${file}: sheet tab bar ${opened.sheetTabs.join(" · ")}`);
      check(afterTab.sheet === null && afterTab.pushes.at(-1) === firstTab, `${file}: a tab in the sheet did not navigate and close it`);
      check(opened.role === "dialog" && opened.modal === "true" && opened.label === "Меню", `${file}: sheet is not a labelled modal dialog`);
      check(opened.focusInside && focusOnOpen === "Закрыть меню", `${file}: focus not moved into the sheet (${focusOnOpen})`);
      check(opened.covers, `${file}: sheet does not cover the page`);
      check(opened.inert.every(Boolean) && opened.contentInert, `${file}: page under the sheet is not inert`);
      check(opened.logoutInViewport, `${file}: «Выйти» not visible in the sheet`);
      check(opened.items.includes("Выйти"), `${file}: no «Выйти» in the sheet`);
      if (role === "admissions") check(opened.items.includes("Выйти из просмотра"), `${file}: no preview exit in the sheet`);
      else check(opened.items.some((item) => item.startsWith("Уведомления")), `${file}: no notifications in the sheet`);
      if (role === "admin") check(opened.items.includes("Создать задачу"), `${file}: no «Создать задачу» in the sheet`);
      check(opened.animation === "v3-shell-sheet-in", `${file}: sheet entrance animation missing (${opened.animation})`);
      check(escaped === 0 && backInside, `${file}: focus left the sheet (${escaped})`);
      check(closed.role === null && closed.hidden && closed.focusOnMore && closed.moreExpanded === "false" && closed.htmlOverflow === "", `${file}: Escape did not close the sheet cleanly`);
      check(closedByButton, `${file}: «Закрыть» did not return focus to «Ещё»`);
    }

    // 3б. prefers-reduced-motion: лист без движения.
    {
      const session = await open(htmlFor["home-admin"], "390", { reducedMotion: "reduce" });
      await session.page.locator('[data-shell-tab="more"]').click();
      const animation = await session.page.evaluate(() => getComputedStyle(document.querySelector("[data-shell-menu] [data-shell-menu-body]")).animationName);
      await finish(session, "reduced-motion");
      report({ journey: "reduced-motion", animation });
      check(animation === "none", `reduced motion: sheet still animates (${animation})`);
    }

    // 3в. Лист: «Создать задачу» закрывает лист и ведёт к форме задачи.
    {
      const session = await open(htmlFor["home-admin"], "390");
      await session.page.locator('[data-shell-tab="more"]').click();
      await session.page.getByRole("link", { name: "Создать задачу" }).click();
      const state = await session.page.evaluate(() => ({ pushes: window.__harness.pushes, sheet: document.querySelector("[data-shell-menu]").getAttribute("role") }));
      await finish(session, "sheet-create-task");
      report({ journey: "sheet-create-task", ...state });
      check(state.sheet === null && /^\/v3\/tasks\?create=staff&open=[0-9a-f-]{36}$/u.test(state.pushes[0] ?? ""), "sheet: «Создать задачу» did not close the sheet and open the task form");
    }

    // 4. Уведомления в верхнем слое: 1440 справа от меню, телефон — в листе.
    for (const [viewportKey, fromSheet] of [["1440", false], ["390", true]]) {
      const session = await open(htmlFor["home-admin"], viewportKey);
      const { page } = session;
      if (fromSheet) await page.locator('[data-shell-tab="more"]').click();
      await page.locator("[data-shell-menu] button[aria-label^='Уведомления']").click();
      await page.waitForSelector("section[aria-label='Уведомления сотрудников']:popover-open");
      await page.waitForTimeout(100);
      const panel = await page.evaluate(() => {
        const element = document.querySelector("section[aria-label='Уведомления сотрудников']");
        const box = element.getBoundingClientRect();
        const menu = document.querySelector("[data-shell-menu]").getBoundingClientRect();
        return {
          topLayer: element.matches(":popover-open"),
          rect: { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom) },
          insideViewport: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
          rightOfSidebar: box.left >= menu.right - 1,
          rows: element.querySelectorAll("li").length,
        };
      });
      const file = `shell-notifications-admin-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      await page.keyboard.press("Escape");
      const afterEscape = await page.evaluate(() => ({
        panelOpen: Boolean(document.querySelector("section[aria-label='Уведомления сотрудников']")),
        focus: document.activeElement?.getAttribute("aria-label") ?? null,
        sheetOpen: document.querySelector("[data-shell-menu]").getAttribute("role") === "dialog",
      }));
      await finish(session, file);
      report({ journey: "notifications", file, panel, afterEscape });
      check(panel.topLayer && panel.insideViewport && panel.rows > 0, `${file}: notifications panel not in the top layer or outside the viewport`);
      if (!fromSheet) check(panel.rightOfSidebar, `${file}: panel covers the sidebar`);
      check(!afterEscape.panelOpen && (afterEscape.focus ?? "").startsWith("Уведомления"), `${file}: Escape did not close the panel back to the bell`);
      if (fromSheet) check(afterEscape.sheetOpen, `${file}: Escape closed the sheet together with the panel`);
    }

    // 5. Поле ответа над панелью вкладок: 390×844 и крупный корневой шрифт.
    //    Подписи вкладок при крупном корневом шрифте — в одну строку, иконки в один ряд.
    for (const [pageKey, role, viewportKey, rootFontSize] of [
      ["messages", "admin", "390", 20], ["messages", "admissions", "360", 24], ["messages", "admin", "320", 20], ["messages", "admin", "1280", 20],
      ["home", "sales", "360", 24], ["home", "sales", "320", 24], ["home", "admin", "320", 24],
    ]) {
      const session = await open(htmlFor[`${pageKey}-${role}`], viewportKey, { rootFontSize });
      const metrics = await session.page.evaluate(shellMetrics);
      const file = `shell-${pageKey}-${role}-${viewportKey}-root${rootFontSize}.png`;
      await session.page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ journey: "root-font", file, rootFontSize, ...metrics });
      if (pageKey === "messages") {
        check(metrics.composer?.above === true, `${file}: composer under the tab bar (${JSON.stringify(metrics.composer)})`);
        check(metrics.overflowY <= 0, `${file}: page scrolls ${metrics.overflowY}px`);
      }
      check(metrics.overflowX === 0, `${file}: horizontal overflow`);
      if (metrics.tabbar) {
        check(metrics.tabbar.multiLine.length === 0, `${file}: tab labels on two lines: ${metrics.tabbar.multiLine.join(", ")}`);
        check(metrics.tabbar.pillTops.length === 1 && metrics.tabbar.pillTops[0] >= 4, `${file}: tab icons not on one row ${metrics.tabbar.pillTops.join(", ")}`);
        check(metrics.tabbar.labelsClipped.length === 0, `${file}: clipped tab labels ${metrics.tabbar.labelsClipped.join(", ")}`);
      }
    }

    // 6. Доска, 1280: рейка 64 px, при просмотре роли видна подпись роли; подпись при фокусе.
    {
      const session = await open(htmlFor["board-admissions"], "1280");
      const { page } = session;
      const rail = await page.evaluate(() => {
        const menu = document.querySelector("[data-shell-menu]");
        const caption = [...menu.querySelectorAll('[data-testid="preview-active"] p')].find((element) => getComputedStyle(element).display !== "none" && element.getBoundingClientRect().height > 0 && !element.className.includes("sr-only"));
        const logout = document.querySelector('[data-testid="staff-logout"]').getBoundingClientRect();
        return { width: Math.round(menu.getBoundingClientRect().width), caption: caption?.textContent ?? null,
          captionFits: caption ? caption.scrollWidth <= caption.clientWidth + 1 : null,
          logoutInViewport: logout.top >= 0 && logout.bottom <= window.innerHeight };
      });
      await page.locator('[data-testid="preview-role-admin"]').focus();
      const tip = await page.evaluate(() => [...document.querySelectorAll("[data-shell-menu] span[aria-hidden='true'].fixed")].find((element) => getComputedStyle(element).display !== "none")?.textContent ?? null);
      const file = "shell-board-admissions-1280-rail.png";
      await page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ journey: "rail-preview-1280", file, rail, tip });
      check(rail.width === 64, `${file}: rail ${rail.width}px`);
      check(rail.caption === "Приёмная" && rail.captionFits, `${file}: no visible role caption in the rail`);
      check(tip === "Выйти из просмотра", `${file}: focus hint ${tip}`);
      check(rail.logoutInViewport, `${file}: «Выйти» outside the viewport in the rail`);
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`shell checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(jsonScenarios()));
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: shell-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
