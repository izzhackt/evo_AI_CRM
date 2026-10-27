"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Задачи» в «Новом виде» (`/v3/tasks`, решение владельца 27.10.2026) — клиентская сборка НАСТОЯЩИХ компонентов
 * (`TasksNext`: шапка, вкладки видов, `DataTable`, фильтры, панель задачи, «Отменить», массовый выбор) на СИНТЕТИЧЕСКИХ
 * данных: имена, задачи и даты выдуманы и не являются записями EVO. Очередь собирает тот же `buildTaskQueue`, что и
 * страница. Адрес в стенде — состояние: `router.push` открывает и закрывает панель задачи и меняет фильтры, как это делает
 * сервер. Серверные действия подменены: рабочая и по студенту «сохранено» записываются как вызов, остальные честно
 * отказывают. Supabase, права и данные этот стенд не проверяет — проверяются вёрстка, токены, адаптив, клавиатура,
 * доступность и путь «строка → панель → действие».
 *
 *   node tests/e2e/tasks-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1).
 *       По умолчанию outDir — .impeccable/review (не коммитится).
 */

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;
const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

// --- синтетические данные (те же, что у tasks-static-render.cjs) -----------------------------------------------
// «Сейчас» — четверг 24.09.2026, 10:00 по Бишкеку (04:00 UTC).
const NOW = "2026-09-24T04:00:00.000Z";
const TODAY = "2026-09-24";
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const COLLEAGUE = "aaaaaaaa-1111-4111-8111-000000000002";
const COLLEAGUE_2 = "aaaaaaaa-1111-4111-8111-000000000003";
const NAMES = { [ME]: "Айгүл Осмонова", [COLLEAGUE]: "Эрмек Токтосунов", [COLLEAGUE_2]: "Гульнара Асанова" };
const staffId = (n) => `bbbbbbbb-5555-4555-8555-${String(n).padStart(12, "0")}`;
const caseTaskId = (n) => `cccccccc-6666-4666-8666-${String(n).padStart(12, "0")}`;
const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;

function staff(n, fields) {
  const assignee = fields.assignee ?? ME;
  const creator = fields.creator ?? ME;
  return {
    id: staffId(n), organizationId: ORG, creatorMembershipId: creator, creatorDisplayName: NAMES[creator],
    assigneeMembershipId: assignee, assigneeDisplayName: NAMES[assignee], title: fields.title,
    description: fields.description ?? null, status: fields.status ?? "open", priority: "normal",
    dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, version: "3", sourceMessageId: fields.fromChat ? staffId(90 + n) : null,
    createdAt: "2026-09-20T05:00:00.000Z", updatedAt: fields.updatedAt ?? `2026-09-2${n % 4}T0${n % 9}:00:00.000Z`,
  };
}

function caseRow(n, fields) {
  const assignee = fields.assignee ?? ME;
  const dueAt = fields.dueAt ?? null;
  const dueOn = fields.dueOn ?? null;
  return {
    sortAt: dueAt ?? (dueOn ? `${dueOn}T00:00:00+06:00` : "9999-12-31T00:00:00+00:00"),
    organizationId: ORG, caseTaskId: caseTaskId(n), version: "5", studentCaseId: caseId(n), studentDisplayName: fields.student,
    caseState: fields.caseState ?? "active", taskType: "follow_up", title: fields.title, status: fields.status ?? "open",
    priority: "normal", dueOn, dueAt, studentVisible: false, assigneeMembershipId: assignee, assigneeDisplayName: NAMES[assignee],
    createdAt: "2026-09-18T05:00:00.000Z", updatedAt: fields.updatedAt ?? `2026-09-2${n % 4}T1${n % 9}:00:00.000Z`,
  };
}

const OUTCOMES = [
  { requestId: "99999999-5555-4555-8555-000000000001", note: "Первый вариант отправлен руководителю, вернули с правками по срокам.", author: NAMES[COLLEAGUE], createdAt: "2026-09-22T09:15:00.000Z" },
  { requestId: "99999999-5555-4555-8555-000000000002", note: "Список документов сверен с памяткой посольства.", author: NAMES[ME], createdAt: "2026-09-23T11:40:00.000Z" },
];
const STAFF = [
  staff(1, { title: "Отправить партнёру пакет по весеннему набору", dueOn: "2026-09-22", fromChat: true }),
  { ...staff(2, { title: "Согласовать шаблон письма о визовом собеседовании", dueAt: "2026-09-24T09:00:00.000Z", description: "Проверить формулировки про сроки и список документов." }), outcomes: OUTCOMES },
  staff(3, { title: "Собрать отчёт по оплатам за сентябрь для руководителя", dueOn: "2026-09-25" }),
  staff(4, { title: "Обновить памятку по нострификации для команды поступления и продаж — длинное название, чтобы проверить обрезку", dueOn: "2026-09-27", status: "blocked" }),
  staff(5, { title: "Разобрать входящие заявки с сайта за выходные", dueOn: "2026-10-02", assignee: COLLEAGUE }),
  staff(6, { title: "Подготовить вопросы к планёрке" }),
  staff(7, { title: "Проверить договор с агентом в Малайзии", dueOn: "2026-09-21", assignee: COLLEAGUE }),
  staff(8, { title: "Закрыть заявки без ответа за август", status: "done", dueOn: "2026-09-19", updatedAt: "2026-09-23T12:00:00.000Z" }),
  staff(21, { title: "Перезвонить клиенту", dueOn: "2026-09-23" }),
  staff(22, { title: "Перезвонить клиенту: недозвон", dueAt: "2026-09-24T09:30:00.000Z" }),
];
const CASES = [
  caseRow(1, { title: "Подтвердить подачу в UCSI", student: "Тимур Абдылдаев", dueOn: "2026-09-20" }),
  caseRow(2, { title: "Записать на визу X1", student: "Мээрим Жолдошева", dueAt: "2026-09-24T08:30:00.000Z" }),
  caseRow(3, { title: "Перевести паспорт и заверить у нотариуса", student: "Санжар Алиев", dueOn: "2026-09-24" }),
  caseRow(4, { title: "Собрать апостиль на аттестат", student: "Айдана Сыдыкова", dueOn: "2026-09-25", assignee: COLLEAGUE }),
  caseRow(5, { title: "Согласовать с семьёй список программ в Польше и Чехии", student: "Нурсултан Бекмурзаевич Джумабаев-Осмоналиев", dueOn: "2026-09-26" }),
  caseRow(6, { title: "Дождаться решения Bilkent", student: "Азамат Исаков", dueOn: "2026-10-15" }),
  caseRow(7, { title: "Уточнить дату прилёта и встречу в аэропорту", student: "Руслан Турдубаев", dueAt: "2026-10-01T05:00:00.000Z", status: "in_progress" }),
  caseRow(8, { title: "Первичная консультация с семьёй", student: "Данияр Мамытов" }),
  caseRow(9, { title: "Проверить перевод диплома", student: "Камила Усенова", dueOn: "2026-09-23", assignee: COLLEAGUE_2 }),
  caseRow(10, { title: "Выдать итоговые документы", student: "Алина Ким", caseState: "closed", status: "done", dueOn: "2026-09-10", updatedAt: "2026-09-22T09:00:00.000Z" }),
];
// 30 открытых рабочих задач — таблица в 25 строк рисует две страницы.
const MANY = Array.from({ length: 30 }, (_, index) => staff(100 + index, { title: `Синтетическая задача ${String(index + 1).padStart(2, "0")}`, dueOn: `2026-10-${String(1 + (index % 28)).padStart(2, "0")}` }));
const PARTICIPANTS = [ME, COLLEAGUE, COLLEAGUE_2].map((membershipId) => ({ membershipId, displayName: NAMES[membershipId], role: "admissions" }));
const LEADS = {
  [`staff:${staffId(21)}`]: { leadId: "ffffffff-7777-4777-8777-000000000021", name: "Айдар Условный", href: "/v3/profile?id=ffffffff-7777-4777-8777-000000000021" },
  [`staff:${staffId(22)}`]: { leadId: "ffffffff-7777-4777-8777-000000000022", name: "Номер ••••4521", href: "/v3/profile?id=ffffffff-7777-4777-8777-000000000022" },
};
const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid", assignments: [], permissionKeys: [],
  displayName: "Администратор Синтетический", systemRole: "admin", presentationRole: null,
};
const PERMISSIONS = { actorMembershipId: ME, admin: true, preview: false, staffComplete: true, staffEdit: true, caseManage: true, caseAssign: true };
const BASE_OPTIONS = {
  complete: true, cutOff: [], dial: { status: "ready", mapped: true }, leads: LEADS, canReadStaff: true, canReadCase: true, teamView: true,
  canCreate: true, permissions: PERMISSIONS, lead: null, leadTasks: null, message: null, urlIntent: null, failure: null,
};
const fixture = (search, options = {}, data = {}) => ({
  search, now: NOW, today: TODAY, actor: ADMIN, staff: STAFF, cases: CASES, participants: PARTICIPANTS, me: ME,
  options: { ...BASE_OPTIONS, ...options }, ...data,
});

// --- браузерная сборка ------------------------------------------------------------------------------------------
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
    if (event.defaultPrevented) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;

const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { TasksNext } = require("@/components/v3/tasks/next/TasksNext");
const { TasksNextFailure } = require("@/components/v3/tasks/next/TasksNextFailure");
const { buildTaskQueue, parseTaskQueueFilters, taskQueueParams } = require("@/lib/v3/task-queue");
const { queueHref } = require("@/components/v3/queue/queue-url");
const { staffSheetData, caseSheetData } = require("@/components/v3/tasks/next/task-sheet-data");
const h = React.createElement;
const fx = JSON.parse(document.getElementById("fixture").textContent);
const o = fx.options;
window.__harness = { pushes: [], calls: [], history: [fx.search] };

// «Сервер»: те же фильтры, очередь и панель, что у страницы, но по данным стенда.
const sheetCache = new Map();
function serve(search) {
  const params = new URLSearchParams(search);
  const filters = parseTaskQueueFilters((key) => params.get(key) ?? undefined, { teamView: o.teamView });
  const now = new Date(fx.now);
  const staffRows = fx.staff.filter((t) => filters.view !== "mine" || t.assigneeMembershipId === fx.me)
    .filter((t) => filters.view !== "created" || t.creatorMembershipId === fx.me)
    .filter((t) => (filters.state === "done") === (t.status === "done" || t.status === "cancelled"));
  const caseRows = filters.view === "created" ? [] : fx.cases;
  const queue = buildTaskQueue({
    staff: filters.type === "case" ? [] : staffRows, cases: filters.type === "staff" ? [] : caseRows,
    filters, actorMembershipId: fx.me, now, complete: o.complete,
  });
  const listParams = taskQueueParams(filters);
  const taskId = params.get("task");
  let sheet = null;
  if (sheetCache.has(search)) sheet = sheetCache.get(search);
  else if (taskId && params.get("kind") !== "case") {
    const task = fx.staff.find((t) => t.id === taskId);
    const lead = o.leads[ "staff:" + taskId ];
    if (task) sheet = staffSheetData({ task, participants: fx.participants, day: fx.today, nowIso: fx.now, leadId: lead ? lead.leadId : null,
      lead: lead ? { ...lead, mapped: true } : null, sourceHref: null, sourceUnavailable: false, outcomes: task.outcomes ?? [] });
  } else if (taskId) {
    const row = fx.cases.find((c) => c.caseTaskId === taskId);
    if (row) sheet = caseSheetData({
      task: { kind: "case", key: "case:" + row.caseTaskId, id: row.caseTaskId, studentCaseId: row.studentCaseId, taskType: "follow_up", title: row.title,
        details: "Семья выбирает между двумя странами: нужен общий список программ со сроками подачи и стоимостью.", dueOn: row.dueOn, dueAt: row.dueAt,
        day: row.dueOn, minutes: null, overdue: false, state: row.status, cancelReason: null, person: row.studentDisplayName, priority: "normal",
        studentVisible: false, assigneeMembershipId: row.assigneeMembershipId, assigneeDisplayName: row.assigneeDisplayName, caseState: row.caseState, version: row.version },
      caseId: row.studentCaseId, assignees: fx.participants.map((p) => ({ membershipId: p.membershipId, displayName: p.displayName })),
      capabilities: { taskId: row.caseTaskId, studentCaseId: row.studentCaseId, canAssign: true, canChangeVisibility: true, canReadCase: true },
      day: fx.today, nowIso: fx.now });
  }
  sheetCache.set(search, sheet);
  const canRead = o.canReadStaff || o.canReadCase;
  return {
    filters, queue, cutOff: o.cutOff, day: fx.today, nowIso: fx.now, canReadStaffTasks: o.canReadStaff, canReadCaseTasks: o.canReadCase,
    teamView: o.teamView, createdExcludesCases: filters.view === "created" && filters.type !== "staff",
    composer: { participants: fx.participants, actorMembershipId: fx.me, actor: fx.actor, day: fx.today, staffAllowed: true, caseAllowed: true, initialCase: null, initialCaseAssignees: [] },
    composerKey: o.message ? o.message.id : "standalone", canCreate: o.canCreate, urlIntent: o.urlIntent, permissions: o.permissions,
    taskLeads: o.canReadStaff ? o.leads : null, dial: o.dial, count: canRead && queue.complete && !o.canReadStaff && !o.teamView ? queue.rows.length : null,
    sheet, closeHref: queueHref("/v3/tasks", listParams), moveOpen: params.get("move") === "1",
    sourceMessage: o.message, sourceLead: o.lead, leadTasks: o.leadTasks,
  };
}

function App() {
  const [search, setSearch] = React.useState(fx.search);
  const router = React.useMemo(() => ({
    // Ответ сервера приходит не мгновенно: панель открывается после обращения, а не в тот же такт, что нажатие.
    push(href) {
      window.__harness.pushes.push(href);
      setTimeout(() => { const next = new URL(href, "https://crm.invalid").search.slice(1); window.__harness.history.push(next); setSearch(next); }, 60);
    },
    // «Назад» браузера: предыдущий адрес и прежняя (закэшированная) выдача сервера.
    back() { const { history } = window.__harness; if (history.length > 1) { history.pop(); setSearch(history[history.length - 1]); } },
    replace() {}, refresh() { window.__harness.calls.push("refresh"); }, forward() {}, prefetch() {}, hmrRefresh() {},
  }), []);
  window.__harness.back = router.back;
  const body = o.failure ? h(TasksNextFailure, o.failure) : h(TasksNext, serve(search));
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: "/v3/tasks" },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
            h(AppShell, { actor: fx.actor, initialNotifications: null, nextUi: { enabled: true } }, body))))));
}
createRoot(document.getElementById("root")).render(h(App));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "tasks-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия: команды задач «сохраняют» и записывают вызов, остальные честно отказывают.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        const saved = {
          mutateStaffTaskAction: "{ status: \"saved\", requestId: \"static\", taskId: null, version: \"9\" }",
          changePlatformAdmissionsTaskAction: "{ status: \"saved\", requestId: \"static\", caseTaskId: null, version: \"9\", changedAt: null }",
        };
        if (args.path.endsWith("ui-next-actions.ts")) return { contents: "export async function setNextUiAction() {}", loader: "ts" };
        return {
          contents: names.map((name) => saved[name]
            ? `export async function ${name}(state, form) { window.__harness.calls.push([${JSON.stringify(name)}, Object.fromEntries(form.entries())]); return ${saved[name]}; }`
            : `export async function ${name}() { throw new Error("tasks-next harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "tasks-next-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

function writePage(outDir, name, css, data) {
  const path = join(outDir, `${name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Задачи, новый вид (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="fixture">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="tasks-next-bundle.js"></script></body></html>`);
  return path;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--screenshots")) throw new Error("usage: node tests/e2e/tasks-next-static-render.cjs --screenshots [outDir]");
  const next = args[args.indexOf("--screenshots") + 1];
  const outDir = resolve(next && !next.startsWith("--") ? next : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await buildBundle(join(outDir, "tasks-next-bundle.js"));
  const css = await compileCss();
  const pages = {
    list: writePage(outDir, "tasks-next-list", css, fixture("")),
    team: writePage(outDir, "tasks-next-team", css, fixture("view=all")),
    done: writePage(outDir, "tasks-next-done", css, fixture("status=done")),
    overdue: writePage(outDir, "tasks-next-overdue", css, fixture("due=overdue")),
    query: writePage(outDir, "tasks-next-query", css, fixture("q=Тимур")),
    empty: writePage(outDir, "tasks-next-empty", css, fixture("due=today&type=staff", {}, { staff: [], cases: [] })),
    many: writePage(outDir, "tasks-next-many", css, fixture("", {}, { staff: MANY, cases: [] })),
    incomplete: writePage(outDir, "tasks-next-incomplete", css, fixture("", { complete: false })),
    none: writePage(outDir, "tasks-next-none", css, fixture("", { canReadStaff: false, canReadCase: false, teamView: false })),
    lead: writePage(outDir, "tasks-next-lead", css, fixture("lead=ffffffff-7777-4777-8777-000000000021", {
      lead: { leadId: "ffffffff-7777-4777-8777-000000000021", clientDisplayName: "Айдар Условный", nextActionText: "Позвонить после выходных", nextActionDueDate: "2026-09-28", canOpenPipeline: true },
      leadTasks: { rows: [{ id: staffId(21), title: "Перезвонить клиенту", status: "open" }, { id: staffId(22), title: "Перезвонить клиенту: недозвон", status: "blocked" }], truncated: false },
    })),
    message: writePage(outDir, "tasks-next-message", css, fixture("message=11111111-2222-4222-8222-000000000001&channel=sales&create=staff", {
      message: { id: "11111111-2222-4222-8222-000000000001", channelKey: "sales", authorName: "Эрмек Токтосунов", body: "Нужно до пятницы собрать у семьи копии аттестата и перевод — напомните, кто делает." },
      urlIntent: "staff",
    })),
    failure: writePage(outDir, "tasks-next-failure", css, fixture("", { failure: { text: "Не удалось загрузить задачи и доступных сотрудников.", retryHref: "/v3/tasks" } })),
  };
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  const results = [];
  let failed = false;
  const report = (check, ok, detail) => {
    results.push({ check, ok, detail });
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };
  async function open(htmlPath, key, reducedMotion = "reduce") {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state/u.test(message.text())) errors.push(message.text()); });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const overlay = async (page, key, name, selector) => {
    const result = await page.evaluate((query) => {
      const element = document.querySelector(query);
      if (!element) return { found: false };
      const background = getComputedStyle(element).backgroundColor;
      return { found: true, insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), background, opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background) };
    }, selector);
    report(`${key}: ${name} inside world and opaque`, result.found && result.insideWorld && result.opaque, result);
  };
  const rowOf = (page, key, title) => (key === "m390"
    ? page.locator("[data-slot=data-table-cards] > li").filter({ hasText: title }).first()
    : page.locator("tbody tr").filter({ hasText: title }).first());
  const pushes = (page) => page.evaluate(() => window.__harness.pushes);
  const calls = (page) => page.evaluate(() => window.__harness.calls);

  // 1. Страница списка на трёх ширинах: без горизонтальной прокрутки, цели ≥ 44 px, axe, консоль, шапка по правилам оболочки.
  for (const key of ["d1440", "d1280", "m390"]) {
    for (const name of ["list", "team"]) {
      const { context, page, errors } = await open(pages[name], key);
      await shot(page, `${name}-${key}`, { fullPage: true });
      if (name === "list") await shot(page, `${name}-${key}-first`);
      report(`${name} ${key}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      const small = await page.evaluate(() => {
        const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
        // Название задачи — ссылка с накладкой на всю ячейку (как в прежней строке); «?» увеличивает зону псевдоэлементом.
        return [...document.querySelectorAll("[data-testid=v3-tasks-next] a, [data-testid=v3-tasks-next] button, [data-testid=v3-tasks-next] input:not([type=checkbox]), [data-testid=v3-tasks-next] [role=combobox]")]
          .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [data-queue-open], [role=switch], [role=checkbox]") && !element.closest("[data-slot=data-table-cards] dl, tbody td:first-child .md\\:pointer-fine\\:flex"))
          .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height), w: Math.round(element.getBoundingClientRect().width) }))
          .filter((box) => box.h < 44);
      });
      report(`${name} ${key}: targets >= 44px`, small.length === 0, small);
      const axe = await new AxeBuilder({ page }).include("[data-testid=v3-tasks-next]").analyze();
      report(`${name} ${key}: axe`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
      // Длинное название и длинное имя студента не расширяют карточки телефона и не дают таблице горизонтальной прокрутки.
      const fit = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("[data-slot=data-table-cards] > li")].filter((card) => card.getClientRects().length > 0);
        const region = document.querySelector("[role=region][aria-label=Задачи]");
        const overflowing = region && region.getClientRects().length > 0 ? region.scrollWidth - region.clientWidth : 0;
        return { cards: cards.length, wide: cards.filter((card) => card.getBoundingClientRect().right > window.innerWidth - 8).length, overflowing };
      });
      report(`${name} ${key}: cards inside the viewport, table without horizontal scroll`, fit.wide === 0 && fit.overflowing <= 0, fit);
      const header = await page.evaluate(() => {
        const main = document.querySelector("[data-testid=v3-tasks-next]");
        const probe = document.createElement("div");
        probe.style.paddingTop = "var(--shell-page-top)";
        main.append(probe);
        const expected = getComputedStyle(probe).paddingTop;
        probe.remove();
        return { matches: main.matches(":has(> div:first-child > div:first-child > h1.t-page-title)"), paddingTop: getComputedStyle(main).paddingTop, expected, h1: main.querySelector("h1").textContent.trim() };
      });
      report(`${name} ${key}: header matches shell rules`, header.matches && header.paddingTop === header.expected && header.h1.startsWith("Задачи"), header);
      const redButtons = await page.evaluate(() => [...document.querySelectorAll("[data-testid=v3-tasks-next] a, [data-testid=v3-tasks-next] button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && element.getBoundingClientRect().width > 0).map((element) => element.textContent.trim()));
      report(`${name} ${key}: one red button (Новая задача)`, redButtons.length === 1 && redButtons[0] === "Новая задача", redButtons);
      report(`${name} ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  }

  // 2. Панель задачи: строка → панель → Esc (фокус возвращается), задача по студенту → «Результат», перенос, «Закрыть».
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open(pages.list, key);
    const staffTitle = "Согласовать шаблон письма";
    const row = rowOf(page, key, staffTitle);
    // Нажатие в свободное место строки (не на ссылку/кнопку): строка таблицы или кнопка-накладка карточки.
    if (key === "m390") await row.locator("> button").click({ position: { x: 8, y: 8 } }); else await row.locator("td").nth(1).click();
    await page.getByRole("dialog").waitFor();
    report(`${key}: row opens the panel by address`, (await pushes(page)).at(-1)?.includes(`task=${staffId(2)}`) === true, await pushes(page));
    await overlay(page, key, "sheet", "[data-slot=sheet-content]");
    await shot(page, `sheet-staff-${key}`);
    const facts = await page.locator("[data-testid=v3-task-detail-panel]").innerText();
    report(`${key}: staff panel shows due, assignee, result form, description, outcomes`, /Срок/u.test(facts) && /Исполнитель/u.test(facts) && /Результат/u.test(facts) && /Проверить формулировки/u.test(facts) && /сверен с памяткой/u.test(facts), facts.slice(0, 200));
    report(`${key}: panel focus inside`, await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest("[role=dialog]"))), null);
    // Подтверждение в панели — тёмная нейтральная кнопка, как в окне массовых действий; красная на странице одна («Новая задача»).
    const confirmColor = await page.getByRole("dialog").getByRole("button", { name: "Завершить", exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor);
    const reds = await page.evaluate(() => [...document.querySelectorAll("button, a")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && element.getBoundingClientRect().width > 0).map((element) => element.textContent.trim()));
    report(`${key}: panel confirm is dark neutral, the page keeps one red button`, confirmColor !== "rgb(215, 2, 23)" && confirmColor.match(/\d+/g).slice(0, 3).every((value) => Number(value) < 80) && reds.length === 1 && reds[0] === "Новая задача", { confirmColor, reds });
    // Завершение рабочей задачи из панели: то же действие, версия и результат.
    await page.getByRole("dialog").getByRole("textbox", { name: "Результат", exact: true }).fill("Согласовано с руководителем");
    await page.getByRole("dialog").getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByText("Задача завершена.").waitFor();
    const done = (await calls(page)).find((call) => Array.isArray(call) && call[0] === "mutateStaffTaskAction");
    report(`${key}: panel completes with the existing action`, Boolean(done) && done[1].operation === "status" && done[1].status === "done" && done[1].completion_note === "Согласовано с руководителем" && done[1].expected_version === "3", done);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    report(`${key}: panel closed by Esc and the address returns to the list`, (await pushes(page)).at(-1) === "/v3/tasks", await pushes(page));
    report(`${key}: focus returns to the row after Esc`, await page.evaluate(() => { const active = document.activeElement; return Boolean(active && (active.closest("tr, li")?.textContent ?? "").includes("Согласовать шаблон письма")); }), await page.evaluate(() => document.activeElement?.tagName));

    // Задача по студенту: круг открывает панель, без результата не завершается.
    const caseTitle = "Записать на визу X1";
    await rowOf(page, key, caseTitle).getByRole("button", { name: `Завершить с результатом: ${caseTitle}`, exact: true }).click();
    await page.getByRole("dialog").waitFor();
    report(`${key}: case circle opens the panel with the result field`, (await pushes(page)).at(-1)?.includes(`kind=case`) === true && (await page.getByRole("dialog").getByRole("textbox", { name: "Результат", exact: true }).count()) === 1, await pushes(page));
    await shot(page, `sheet-case-${key}`);
    await page.getByRole("dialog").getByRole("button", { name: "Завершить", exact: true }).click();
    report(`${key}: case task needs a result (nothing is sent without it)`, !(await calls(page)).some((call) => Array.isArray(call) && call[0] === "changePlatformAdmissionsTaskAction"), await calls(page));
    await page.getByRole("dialog").getByRole("textbox", { name: "Результат", exact: true }).fill("Записали на 12 октября");
    await page.getByRole("dialog").getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByText("Задача завершена.").waitFor();
    const caseCall = (await calls(page)).find((call) => Array.isArray(call) && call[0] === "changePlatformAdmissionsTaskAction");
    report(`${key}: case task completes with the result as reason`, Boolean(caseCall) && caseCall[1].status === "done" && caseCall[1].reason === "Записали на 12 октября", caseCall);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });

    // «Перенести или передать»: пункт меню строки открывает панель с раскрытым разделом.
    if (key === "d1280") {
      await rowOf(page, key, "Подготовить вопросы к планёрке").getByRole("button", { name: /^Действия/u }).click();
      await page.getByRole("menu").waitFor();
      await overlay(page, key, "row menu", "[data-slot=dropdown-menu-content]");
      await shot(page, `row-menu-${key}`);
      const items = await page.getByRole("menuitem").allTextContents();
      report(`${key}: row menu offers postpone and transfer`, items.includes("Перенести на завтра") && items.includes("Передать…"), items);
      await page.getByRole("menuitem", { name: "Передать…" }).click();
      await page.getByRole("dialog").waitFor();
      report(`${key}: transfer opens the move section`, await page.locator("details[open] summary").filter({ hasText: "Перенести или передать" }).count() === 1, null);
      await shot(page, `sheet-move-${key}`);
      await page.getByRole("combobox", { name: "Исполнитель" }).click();
      await page.getByRole("listbox").waitFor();
      await overlay(page, key, "assignee select", "[data-slot=select-content]");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Закрыть" }).first().click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      report(`${key}: focus returns after the close button`, await page.evaluate(() => Boolean(document.activeElement && document.activeElement !== document.body)), await page.evaluate(() => document.activeElement?.tagName));
    }
    report(`${key}: panel flow console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 3. Быстрое завершение на месте с «Отменить», фильтры, поиск, массовый выбор, меню «⋯»: 1280 и 390.
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open(pages.list, key);
    const title = "Подготовить вопросы к планёрке";
    await rowOf(page, key, title).getByRole("button", { name: `Завершить: ${title}`, exact: true }).click();
    await page.waitForSelector('[data-testid="v3-undo-toasts"]:popover-open [data-undo-row]');
    report(`${key}: circle completes in place and offers undo`, (await calls(page)).some((call) => Array.isArray(call) && call[0] === "mutateStaffTaskAction" && call[1].status === "done") && (await rowOf(page, key, title).count()) === 1, await calls(page));
    await shot(page, `undo-${key}`);
    await page.getByRole("button", { name: "Отменить" }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="v3-undo-toasts"]:popover-open [data-undo-row]'));
    const undo = (await calls(page)).filter((call) => Array.isArray(call) && call[0] === "mutateStaffTaskAction").at(-1);
    report(`${key}: undo sends the previous status`, undo[1].status === "open", undo);
    await page.waitForTimeout(300);
    const undoFocus = await page.evaluate((rowKey) => {
      const active = document.activeElement;
      return { circle: Boolean(active?.matches('button[aria-label^="Завершить"]')), shown: Boolean(active && active.getClientRects().length > 0), row: active?.closest("[data-queue-row]")?.getAttribute("data-queue-row") === rowKey, tag: active?.tagName };
    }, `staff:${staffId(6)}`);
    report(`${key}: focus returns to the visible completion circle after undo`, undoFocus.circle && undoFocus.shown && undoFocus.row, undoFocus);

    // Общий поиск таблицы ищет по названию и по студенту.
    await page.getByRole("searchbox").fill("Тимур");
    const found = key === "m390" ? await page.locator("[data-slot=data-table-cards] > li").count() : await page.locator("tbody tr").count();
    report(`${key}: global search finds a task by student name`, found === 1, found);
    await shot(page, `search-${key}`);
    await page.getByRole("searchbox").fill("");

    // Фильтры — ссылки на адрес: «Срок → Просрочено».
    await page.locator("[data-slot=dropdown-menu-trigger]", { hasText: "Срок" }).click();
    await page.getByRole("menu").waitFor();
    await overlay(page, key, "filter menu", "[data-slot=dropdown-menu-content]");
    await shot(page, `filter-menu-${key}`);
    await page.getByRole("menuitem", { name: "Просрочено" }).click();
    await page.locator("[data-slot=dropdown-menu-trigger]", { hasText: "Срок: Просрочено" }).waitFor();
    const filterPush = (await pushes(page)).at(-1);
    report(`${key}: filter is an address change`, filterPush === "/v3/tasks?due=overdue", filterPush);
    const overdueRows = key === "m390" ? await page.locator("[data-slot=data-table-cards] > li").allInnerTexts() : await page.locator("tbody tr").allInnerTexts();
    report(`${key}: overdue filter keeps only overdue tasks`, overdueRows.length > 0 && overdueRows.every((text) => /прошёл/u.test(text)), overdueRows.map((text) => text.slice(0, 60)));
    await shot(page, `filtered-${key}`);
    report(`${key}: reset link appears`, (await page.getByRole("link", { name: "Сбросить" }).count()) === 1, null);

    // Массовый выбор: «Выбрать» показывает отметки и строку действий.
    await page.getByRole("link", { name: "Сбросить" }).click();
    await page.getByRole("link", { name: "Сбросить" }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Выбрать" }).click();
    const boxes = page.getByRole("checkbox");
    report(`${key}: select reveals checkboxes`, (await boxes.count()) > 3, await boxes.count());
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByTestId("queue-bulk-bar").waitFor();
    await shot(page, `bulk-${key}`);
    const bar = page.getByTestId("queue-bulk-bar");
    report(`${key}: bulk bar offers complete and reschedule`, (await bar.getByRole("button", { name: /^Завершить/u }).count()) === 1 && (await bar.getByRole("button", { name: /^Перенести срок/u }).count()) === 1, await bar.innerText());
    await page.getByRole("button", { name: "Отмена" }).first().click();
    report(`${key}: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 4. «Позвонить» у задачи-перезвона, клавиши очереди и прилипшая шапка: строки при прокрутке под неё не заходят.
  {
    const { context, page } = await open(pages.list, "d1280");
    const covered = await page.evaluate(() => {
      const region = document.querySelector("[role=region][aria-label=Задачи]");
      const head = region.querySelector("th").getBoundingClientRect();
      const leaks = [];
      // Каждая ссылка и кнопка строки, зашедшая под шапку, должна быть под ней, а не поверх: проверяем при разной прокрутке.
      for (let offset = 0; offset <= 420; offset += 23) {
        region.scrollTop = offset;
        for (const element of region.querySelectorAll("tbody a, tbody button")) {
          const box = element.getBoundingClientRect();
          const left = Math.max(box.left, head.left), right = Math.min(box.right, head.right);
          const top = Math.max(box.top, head.top), bottom = Math.min(box.bottom, head.bottom);
          if (right - left < 2 || bottom - top < 2 || getComputedStyle(element).visibility === "hidden") continue;
          const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          if (!hit || !hit.closest("th")) leaks.push([offset, (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 20)]);
        }
      }
      region.scrollTop = 0;
      return leaks;
    });
    report("d1280: sticky header stays above scrolled rows", covered.length === 0, covered);
    const callRow = rowOf(page, "d1280", "Перезвонить клиенту: недозвон");
    report("d1280: callback row names the client and offers dial", (await callRow.getByText("Номер ••••4521").count()) >= 1 && (await callRow.locator("button[aria-label*='Позвонить'], button[title*='Позвонить']").count()) >= 1, await callRow.innerText());
    await shot(page, "callback-d1280");
    await page.locator("[data-queue-open]").first().focus();
    await page.keyboard.press("j");
    report("d1280: j moves to the next task title", await page.evaluate(() => document.activeElement?.matches("[data-queue-open]") && document.activeElement.textContent.length > 0), await page.evaluate(() => document.activeElement?.textContent));
    await context.close();
  }

  // 5. Состояния страницы: завершённые, поиск из адреса, пусто, неполное чтение, нет права, лид, сообщение, ошибка.
  const states = [
    ["done", "Завершённые", (page) => page.locator("[data-slot=dropdown-menu-trigger]", { hasText: "Состояние: Завершённые" }).count()],
    ["query", "Поиск из адреса", (page) => page.getByRole("link", { name: /Убрать поиск: Тимур/u }).count()],
    ["empty", "Пусто", (page) => page.getByText("Открытых рабочих задач нет").or(page.getByText("На сегодня задач нет")).count()],
    ["incomplete", "Неполное чтение", (page) => page.getByText("Показаны не все задачи, числа скрыты.").count()],
    ["none", "Нет права", (page) => page.getByText("В вашей роли нет права на просмотр задач.").count()],
    ["lead", "Задачи по лиду", (page) => page.getByRole("heading", { name: "Связанные рабочие задачи" }).count()],
    ["message", "Из сообщения", (page) => page.getByRole("heading", { name: /^Задача из сообщения/u }).count()],
    ["failure", "Ошибка чтения", (page) => page.getByRole("alert").getByText("Не удалось загрузить задачи").count()],
  ];
  for (const [name, label, probe] of states) {
    for (const key of ["d1440", "m390"]) {
      const { context, page, errors } = await open(pages[name], key);
      if (name === "message") await page.getByRole("dialog").waitFor().catch(() => {});
      await shot(page, `state-${name}-${key}`, { fullPage: name !== "message" });
      report(`${label} ${key}: expected content`, (await probe(page)) >= 1, null);
      if (name !== "message") {
        const axe = await new AxeBuilder({ page }).include("[data-testid=v3-tasks-next]").analyze();
        report(`${label} ${key}: axe`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
        report(`${label} ${key}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), null);
      }
      report(`${label} ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  }

  // 6. Закрытие панели: заголовок и данные не мигают пустыми (200 мс на анимацию).
  {
    const { context, page } = await open(pages.list, "d1280", "no-preference");
    await rowOf(page, "d1280", "Согласовать шаблон письма").locator("td").nth(1).click();
    await page.getByRole("dialog").waitFor();
    const samples = await page.evaluate(async () => {
      const taken = [];
      const sample = () => {
        const panel = document.querySelector("[data-slot=sheet-content]");
        if (panel) taken.push([panel.querySelector("[data-slot=sheet-title]").textContent, Boolean(panel.querySelector("[data-slot=key-facts]")), panel.getAttribute("data-state")]);
      };
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      for (let i = 0; i < 12; i += 1) { sample(); await new Promise((done) => setTimeout(done, 25)); }
      return taken;
    });
    const closing = samples.filter((row) => row[2] === "closed");
    report("d1280: panel keeps the task while closing", closing.length > 0 && closing.every(([title, facts]) => title.startsWith("Согласовать шаблон письма") && facts), samples);
    await context.close();
  }

  // 7. Массовый выбор считает только строки, которые таблица показывает: поиск и страницы не расширяют «все на странице».
  const ticked = (page) => page.getByTestId("queue-bulk-bar").innerText();
  const taskCalls = async (page) => (await calls(page)).filter((call) => Array.isArray(call) && (call[0] === "mutateStaffTaskAction" || call[0] === "changePlatformAdmissionsTaskAction"));
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open(pages.list, key);
    const hiddenTitle = "Отправить партнёру пакет по весеннему набору";
    const shownTitle = "Подтвердить подачу в UCSI";
    await page.getByRole("button", { name: "Выбрать", exact: true }).click();
    await rowOf(page, key, hiddenTitle).getByRole("checkbox").check();
    await page.getByRole("searchbox").fill("Тимур");
    await rowOf(page, key, shownTitle).getByRole("checkbox").check();
    await page.getByTestId("queue-bulk-bar").waitFor();
    const afterSearch = await ticked(page);
    report(`${key}: a task hidden by the search leaves the selection`, /Выбрано\s*1\s+задача/u.test(afterSearch) && (await page.locator("[data-bulk-select-all]").count()) === 0, afterSearch);
    await page.getByTestId("task-bulk-complete-trigger").click();
    await page.getByTestId("task-bulk-complete").getByRole("textbox", { name: "Результат" }).fill("Подано");
    report(`${key}: bulk complete dialog counts only the visible task`, /Изменим:\s*1\s+задача/u.test(await page.getByTestId("task-bulk-complete").innerText()), null);
    await page.getByTestId("task-bulk-complete").getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByTestId("task-bulk-complete").getByRole("button", { name: "Готово" }).waitFor();
    const sent = await taskCalls(page);
    report(`${key}: bulk complete after a search sends only the visible task`, sent.length === 1 && JSON.stringify(sent[0]).includes(caseTaskId(1)) && !JSON.stringify(sent).includes(staffId(1)), sent);
    await shot(page, `bulk-search-${key}`);
    await context.close();
    const second = await open(pages.list, key);
    await second.page.getByRole("button", { name: "Выбрать", exact: true }).click();
    await second.page.getByRole("searchbox").fill("Перезвонить");
    const matching = key === "m390" ? await second.page.locator("[data-slot=data-table-cards] > li").count() : await second.page.locator("tbody tr").count();
    await rowOf(second.page, key, "Перезвонить клиенту:").getByRole("checkbox").check();
    const all = second.page.locator("[data-bulk-select-all]");
    report(`${key}: select-all offers the rows the search shows`, matching === 2 && (await all.innerText()).replace(/\s+/gu, "").endsWith(`·${matching}`), await all.innerText());
    await all.click();
    report(`${key}: select-all after a search picks only the visible rows`, new RegExp(`Выбрано\\s*${matching}\\s+задачи`, "u").test(await ticked(second.page)), await ticked(second.page));
    report(`${key}: console clean (bulk and search)`, errors.length === 0 && second.errors.length === 0, [...errors, ...second.errors]);
    await second.context.close();
  }
  {
    // Больше 25 задач: «все на странице» — это 25 строк страницы, а не 30; на другой странице выбор не считается.
    const { context, page } = await open(pages.many, "d1280");
    await page.getByRole("button", { name: "Выбрать", exact: true }).click();
    await page.getByRole("checkbox").first().check();
    const all = page.locator("[data-bulk-select-all]");
    const label = (await all.innerText()).replace(/\s+/gu, "");
    await all.click();
    const ticksOnPage = await page.getByRole("checkbox").evaluateAll((boxes) => boxes.filter((box) => box.checked).length);
    report("d1280: select-all on a 30-task list picks the 25 rows of the page", label.endsWith("·25") && /Выбрано\s*25/u.test(await ticked(page)) && ticksOnPage === 25, { label, ticksOnPage });
    await page.getByRole("button", { name: "Следующая страница" }).click();
    await page.getByTestId("queue-bulk-bar").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    report("d1280: selection from another page is not carried into this page", (await page.getByTestId("queue-bulk-bar").count()) === 0, null);
    await context.close();
  }

  // 8. Клавиши очереди и фокус работают с видимым вариантом строки (таблица и карточки рисуют одно и то же).
  for (const key of ["d1280", "m390"]) {
    const { context, page } = await open(pages.list, key);
    const group = key === "m390" ? "[data-slot=data-table-cards]" : "tbody";
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(key === "m390" ? "j" : "k");
    const landed = await page.evaluate((scope) => {
      const links = [...document.querySelectorAll(`${scope} [data-queue-open]`)];
      const active = document.activeElement;
      return { index: links.indexOf(active), count: links.length, shown: Boolean(active && active.getClientRects().length > 0), hiddenCopies: document.querySelectorAll("[data-queue-row]").length - links.length };
    }, group);
    report(`${key}: ${key === "m390" ? "j" : "k"} first lands on the ${key === "m390" ? "first" : "last"} visible task`, landed.shown && landed.index === (key === "m390" ? 0 : landed.count - 1) && landed.hiddenCopies > 0, landed);
    await context.close();
  }

  // 9. «Назад» после закрытия панели возвращает панель, а клавиши очереди после закрытия работают.
  {
    const { context, page } = await open(pages.list, "d1280");
    await rowOf(page, "d1280", "Согласовать шаблон письма").locator("td").nth(1).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForFunction(() => window.__harness.history.at(-1) === "");
    await page.evaluate(() => window.__harness.back());
    await page.getByRole("dialog").waitFor({ timeout: 3000 }).catch(() => {});
    report("d1280: browser Back after closing reopens the panel of the address", (await page.getByRole("dialog").count()) === 1, await page.evaluate(() => window.__harness.history));
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await page.waitForFunction(() => window.__harness.history.at(-1) === "", null, { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("j");
    report("d1280: queue keys work after the panel is closed again", await page.evaluate(() => Boolean(document.activeElement?.matches("[data-queue-open]"))), await page.evaluate(() => document.activeElement?.tagName));
    await context.close();
  }

  // 10. Честные числа: неполное чтение не называет общее число страниц; полное — называет.
  for (const key of ["d1440", "m390"]) {
    const partial = await open(pages.incomplete, key);
    const partialText = await partial.page.locator("[data-slot=data-table-pagination]").first().innerText();
    report(`${key}: incomplete read prints no total in the pagination`, /^1–\d+\s*$/u.test(partialText.split("\n")[0]) && !/из\s*\d+/u.test(partialText), partialText);
    await partial.context.close();
    const whole = await open(pages.list, key);
    const wholeText = await whole.page.locator("[data-slot=data-table-pagination]").first().innerText();
    report(`${key}: complete read keeps the total`, /1–\d+ из \d+/u.test(wholeText), wholeText);
    await whole.context.close();
  }

  // 11. Срок: подпись «срок» не повторяется после даты; дата и слово — в одной строке и в таблице, и в карточке.
  {
    const { context, page } = await open(pages.done, "d1440");
    const cells = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
    report("d1440: completed view shows the date only, the column already says Срок", cells.length > 0 && cells.every((text) => !/срок/iu.test(text)), cells);
    await context.close();
    const phone = await open(pages.done, "m390");
    const cards = await phone.page.locator("[data-slot=data-table-cards] dd").allInnerTexts();
    report("m390: completed card shows the date only", cards.length > 0 && cards.every((text) => !/срок/iu.test(text)), cards);
    await phone.context.close();
  }
  for (const [name, key] of [["list", "d1440"], ["team", "d1280"], ["list", "m390"], ["team", "m390"]]) {
    const { context, page } = await open(pages[name], key);
    const lines = await page.evaluate(() => [...document.querySelectorAll("time")].filter((time) => time.getClientRects().length > 0 && time.closest("td, dd")).map((time) => {
      const word = time.parentElement.querySelector(".v3-due");
      const box = time.getBoundingClientRect();
      const other = word?.getBoundingClientRect();
      return { text: time.textContent, same: !other || Math.abs((box.top + box.bottom) / 2 - (other.top + other.bottom) / 2) <= 4, height: Math.round(time.parentElement.getBoundingClientRect().height) };
    }));
    report(`${name} ${key}: date and due word share one line`, lines.length > 0 && lines.every((line) => line.same) && new Set(lines.map((line) => line.height)).size === 1, lines.filter((line) => !line.same).slice(0, 3));
    await shot(page, `due-${name}-${key}`);
    await context.close();
  }

  await browser.close();
  writeFileSync(join(outDir, "tasks-next-checks.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ total: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length }));
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
