"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Э7 плана редизайна (27.09.2026): один диалог «Новая задача», массовые
 * действия, Ctrl+K и окно «?» — снимки настоящих компонентов в Chromium.
 *
 * Страница целиком — оболочка (`AppShell`, оба облика) и тело — рисуется в
 * браузере самим React (бандл esbuild), поэтому работают настоящие
 * `TaskComposerHost`, `CommandPalette`, `KeyboardHelpDialog`, строки выбора и
 * окна массовых действий. Данные СИНТЕТИЧЕСКИЕ: задачи, имена, дела и лиды
 * выдуманы для проверки вёрстки и не являются записями EVO. Серверные
 * действия заменены заглушками в браузере: поиск Ctrl+K отвечает
 * синтетическими студентами и лидами, команды массовых действий отвечают
 * по очереди «сохранено» и отказом — чтобы был виден честный частичный итог.
 * Живой Supabase, права сервера и маршрутизатор Next.js этот рендер не
 * проверяет.
 *
 *   node tests/e2e/e7-static-render.cjs --screenshots [outDir] [--look=next]
 *     → снимки `e7-*.png` (1440×900, 1280×800, 390×844); по умолчанию
 *       outDir — .impeccable/review (не коммитится). Проверки печатаются
 *       строкой на снимок; нарушение — код выхода 1.
 */

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
const LOOK_NEXT = process.argv.includes("--look=next");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;

// --- браузерная точка входа ----------------------------------------------------
const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { PartShell } = require("@/components/v3/PartShell");
const { TasksWorkspace } = require("@/components/v3/tasks/TasksWorkspace");
const { buildTaskQueue, parseTaskQueueFilters } = require("@/lib/v3/task-queue");
const { buildStudentsQueueScreen } = require("@/components/v3/students/StudentsQueueScreen");
const studentsView = require("@/components/v3/students/students-queue-view");
const { Calendar } = require("@/components/v3/calendar/Calendar");
const { gridDays } = require("@/components/v3/calendar/types");
const h = React.createElement;

const fixture = JSON.parse(document.getElementById("e7-fixture").textContent);
const look = fixture.look;
window.__e7 = { pushes: [], calls: [] };
const router = {
  push: (href) => { window.__e7.pushes.push(String(href)); }, replace: (href) => { window.__e7.pushes.push(String(href)); },
  refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};

// --- синтетика -----------------------------------------------------------------
// «Сейчас» — четверг 24.09.2026, 10:00 по Бишкеку.
const NOW = new Date("2026-09-24T04:00:00.000Z");
const TODAY = "2026-09-24";
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const B = "aaaaaaaa-1111-4111-8111-000000000002";
const C = "aaaaaaaa-1111-4111-8111-000000000003";
const NAMES = { [ME]: "Айгүл Осмонова", [B]: "Эрмек Токтосунов", [C]: "Гульнара Асанова" };
const id = (prefix, n) => prefix + "-5555-4555-8555-" + String(n).padStart(12, "0");
const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const PARTICIPANTS = [ME, B, C].map((membershipId) => ({ membershipId, displayName: NAMES[membershipId], role: "admissions" }));

function staff(n, fields) {
  return {
    id: id("bbbbbbbb", n), organizationId: ORG, creatorMembershipId: ME, creatorDisplayName: NAMES[ME],
    assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: NAMES[fields.assignee ?? ME], title: fields.title,
    description: null, status: "open", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null,
    version: "3", sourceMessageId: null, createdAt: "2026-09-20T05:00:00.000Z", updatedAt: "2026-09-2" + (n % 4) + "T05:00:00.000Z",
  };
}
function caseRow(n, fields) {
  return {
    sortAt: fields.dueAt ?? (fields.dueOn ? fields.dueOn + "T00:00:00+06:00" : "9999-12-31T00:00:00+00:00"),
    organizationId: ORG, caseTaskId: id("cccccccc", n), version: "5", studentCaseId: id("dddddddd", n), studentDisplayName: fields.student,
    caseState: "active", taskType: "follow_up", title: fields.title, status: "open", priority: "normal",
    dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, studentVisible: false, assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME],
    createdAt: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-2" + (n % 4) + "T11:00:00.000Z",
  };
}
const STAFF = [
  staff(1, { title: "Отправить партнёру пакет по весеннему набору", dueOn: "2026-09-22" }),
  staff(2, { title: "Согласовать шаблон письма о визовом собеседовании", dueAt: "2026-09-24T09:00:00.000Z" }),
  staff(3, { title: "Собрать отчёт по оплатам за сентябрь для руководителя", dueOn: "2026-09-25" }),
  staff(4, { title: "Подготовить вопросы к планёрке" }),
];
const CASES = [
  caseRow(1, { title: "Подтвердить подачу в UCSI", student: "Тимур Абдылдаев", dueOn: "2026-09-20" }),
  caseRow(2, { title: "Записать на визу X1", student: "Мээрим Жолдошева", dueAt: "2026-09-24T08:30:00.000Z" }),
  caseRow(3, { title: "Перевести паспорт и заверить у нотариуса", student: "Санжар Алиев", dueOn: "2026-09-24" }),
  caseRow(4, { title: "Собрать апостиль на аттестат", student: "Айдана Сыдыкова", dueOn: "2026-09-26" }),
];
const PERMISSIONS = { actorMembershipId: ME, admin: true, preview: false, staffComplete: true, staffEdit: true, caseManage: true, caseAssign: true };

function tasksPage() {
  const filters = parseTaskQueueFilters(() => undefined, { teamView: true });
  const queue = buildTaskQueue({ staff: STAFF, cases: CASES, filters, actorMembershipId: ME, now: NOW, complete: true });
  const props = {
    filters, queue, cutOff: [], day: TODAY, nowIso: NOW.toISOString(), canReadStaffTasks: true, canReadCaseTasks: true, teamView: true,
    createdExcludesCases: false,
    composer: { participants: PARTICIPANTS, actorMembershipId: ME, actor: ACTOR, day: TODAY, staffAllowed: true, caseAllowed: true, initialCase: null, initialCaseAssignees: [] },
    composerKey: "standalone", canCreate: true, urlIntent: null, permissions: PERMISSIONS, selectedKey: null, panel: null,
    ...(look === "next" ? { look: "next" } : {}),
  };
  return h(PartShell, { title: "Задачи", count: queue.rows.length }, h(TasksWorkspace, props));
}

const S = (n) => "cccccccc-2222-4222-8222-" + String(n).padStart(12, "0");
const NOON = studentsView.bishkekNoon(TODAY);
function student(n, fields) {
  const nextAction = fields.step ?? null;
  const nextActionDueOn = nextAction ? fields.due ?? null : null;
  const curator = fields.curator === undefined ? ME : fields.curator;
  return {
    studentCaseId: S(n), studentDisplayName: fields.name, state: fields.state ?? "active", admissionsDirection: fields.direction ?? null,
    targetCountry: null, targetDegree: fields.degree ?? null, pipelineStage: fields.stage ?? "documents", pipelineHidden: false,
    nextAction, nextActionDueOn, dueBand: studentsView.caseNextActionBand(nextAction, nextActionDueOn, NOON),
    admissionsVersion: "3", currentCuratorMembershipId: curator, currentCuratorDisplayName: curator ? NAMES[curator] : null,
    isMine: curator === ME, attentionFlags: fields.flags ?? [], needsReply: false, overdueTaskCount: 0,
    documents: { total: 10, approved: 6, submitted: 1, correctionRequired: 0, rejected: 0, missing: 3 },
    updatedAt: "2026-09-22T05:00:00.000000Z", cursor: "due|0|" + (nextActionDueOn ?? "infinity") + "|" + S(n),
  };
}
const STUDENTS = [
  student(1, { name: "Айдана Сыдыкова", direction: "CN", degree: "Бакалавриат", step: "Собрать апостиль на аттестат", due: "2026-09-21", flags: ["overdue"] }),
  student(2, { name: "Тимур Абдылдаев", direction: "MY", degree: "Магистратура", stage: "ready_to_submit", step: "Подтвердить подачу в UCSI", due: "2026-09-23", curator: B }),
  student(3, { name: "Мээрим Жолдошева", direction: "CN", degree: "Магистратура", stage: "visa", step: "Записать на визу X1", due: TODAY }),
  student(4, { name: "Санжар Алиев", direction: "CN", degree: "Языковые курсы", step: "Перевести паспорт и заверить у нотариуса", due: "2026-09-25", curator: C }),
  student(5, { name: "Камила Усенова", direction: "EUROPE", degree: "Магистратура", stage: "ready_to_submit", step: "Отправить пакет партнёру", due: "2026-09-29" }),
  student(6, { name: "Элиза Каримова", direction: "AE", degree: "Foundation", stage: "new", state: "pending", curator: null, flags: ["needs_curator"] }),
  student(7, { name: "Бекзат Шаршенов", stage: "new", state: "pending", curator: null, flags: ["needs_curator"] }),
  student(8, { name: "Асель Бакирова", direction: "AE", degree: "Магистратура", step: "Уточнить у семьи список документов" }),
  student(9, { name: "Данияр Мамытов", direction: "TR", degree: "Бакалавриат", stage: "new" }),
];

function studentsPage(search) {
  const query = Object.fromEntries(new URLSearchParams(search));
  const parse = studentsView.parseStudentsQueueParams(query, "queue", { admin: true, coverage: true });
  const params = parse.params;
  const rows = STUDENTS.filter((row) => params.view === "needs_curator" ? row.attentionFlags.includes("needs_curator") : true);
  const counts = null;
  const built = buildStudentsQueueScreen({
    params, invalid: false,
    read: { page: { view: params.view, sort: "due", today: TODAY, rows, nextCursor: null }, counts, forbidden: false },
    actor: { admin: true, coverage: true }, openTasks: params.open ? { kind: "ready", tasks: [] } : null, handoff: null, closure: null,
    coverage: null, today: TODAY, curatorNames: [ME, B, C].map((membershipId) => ({ membershipId, displayName: NAMES[membershipId] })),
    editor: { admin: true, preview: false, routeManage: true, broadScope: true }, recordScopes: [], createTask: true,
    requestIds: { nextStep: "99999999-6666-4666-8666-000000000001", coverage: "99999999-6666-4666-8666-000000000002" },
    ...(look === "next" ? { look: "next" } : {}),
  });
  return h(PartShell, { title: "Студенты", count: built.count, dense: true }, built.content);
}

function calendarPage() {
  const day = "2026-09-26";
  const days = gridDays("week", day);
  const task = (n, fields) => ({
    kind: "case", key: "case:" + id("cccccccc", 40 + n), id: id("cccccccc", 40 + n), studentCaseId: id("dddddddd", 40 + n), taskType: "follow_up",
    title: fields.title, details: null, dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, day: fields.day, minutes: fields.minutes ?? null,
    overdue: false, state: "open", cancelReason: null, person: fields.person, priority: "normal", studentVisible: false,
    assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], caseState: "active", version: "2",
  });
  const tasks = [
    task(1, { title: "Записать на визу X1", person: "Мээрим Жолдошева", dueAt: "2026-09-24T08:30:00.000Z", day: "2026-09-24", minutes: 870 }),
    task(2, { title: "Собрать апостиль на аттестат", person: "Айдана Сыдыкова", dueOn: "2026-09-25", day: "2026-09-25" }),
  ];
  return h(PartShell, { title: "Календарь" }, h(Calendar, {
    initialTaskKey: null, unavailableTarget: null, taskCapabilities: null, view: "week", day, today: TODAY, nowMinutes: 600,
    days, tasks, readAccess: { caseTasks: true, staffTasks: true, tasks: true, applicationDeadlines: false }, undatedContinuationPage: false,
    undatedNextHref: null, undatedCursor: null,
    cases: STUDENTS.slice(0, 5).map((row) => ({ id: row.studentCaseId, name: row.studentDisplayName })), casesHaveMore: false,
    assignees: [], actorMembershipId: ME, actor: ACTOR, taskRequestIds: {}, basePath: "/v3/calendar",
  }));
}

// --- ответы заглушек серверных действий ------------------------------------------
let turn = 0;
const alternate = (saved, failed) => (++turn % 2 === 1 ? saved : failed);
window.__e7Actions = {
  searchCommandPaletteAction: async (query) => {
    window.__e7.calls.push("search:" + query);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const students = [
      { id: S(1), label: "Айдана Сыдыкова", meta: "Бакалавриат", href: "/v3/profile?case=" + S(1) },
      { id: S(2), label: "Айбек Турсунов", meta: "Магистратура · ожидает начала", href: "/v3/profile?case=" + S(2) },
    ];
    const leads = [{ id: id("dddddddd", 90), label: "Айжан Примерова", meta: null, href: "/v3/profile?id=" + id("dddddddd", 90) }];
    return { status: "ready", query, students: { status: "ready", rows: students, more: false }, leads: { status: "ready", rows: leads, more: false } };
  },
  readTaskComposerAssigneesAction: async () => ({ status: "ready", participants: PARTICIPANTS }),
  readTaskCaseAssigneesAction: async () => ({ status: "ready", assignees: PARTICIPANTS.map(({ membershipId, displayName }) => ({ membershipId, displayName })) }),
  searchTaskCasesAction: async () => ({ status: "ready", rows: STUDENTS.slice(0, 5).map((row) => ({ id: row.studentCaseId, name: row.studentDisplayName })), nextCursor: null }),
  mutateStaffTaskAction: async (_previous, form) => {
    window.__e7.calls.push("staff:" + form.get("task_id") + ":" + form.get("expected_version") + ":" + form.get("due_on") + form.get("due_at"));
    return alternate({ status: "saved", requestId: form.get("request_id"), taskId: form.get("task_id"), version: "4" },
      { status: "stale", requestId: form.get("request_id"), taskId: null, version: null });
  },
  changePlatformAdmissionsTaskAction: async (_previous, form) => {
    window.__e7.calls.push("case:" + form.get("case_task_id") + ":" + form.get("expected_version") + ":" + form.get("reason"));
    return alternate({ status: "saved", requestId: form.get("request_id"), caseTaskId: form.get("case_task_id"), version: "6", changedAt: NOW.toISOString() },
      { status: "forbidden", requestId: form.get("request_id"), caseTaskId: null, version: null, changedAt: null });
  },
  assignCaseCuratorAction: async (_previous, form) => {
    window.__e7.calls.push("curator:" + form.get("student_case_id"));
    return alternate({ status: "saved", requestId: form.get("request_id") }, { status: "stale", requestId: form.get("request_id") });
  },
  saveCaseNextActionAction: async (_previous, form) => {
    window.__e7.calls.push("step:" + form.get("student_case_id") + ":" + form.get("expected_version") + ":" + form.get("next_action_due_on"));
    return alternate({ status: "saved", requestId: "x", message: "ok", receipt: null }, { status: "stale", requestId: form.get("request_id"), message: "stale", receipt: null });
  },
  loadStaffNotificationsAction: async () => ({ ok: true, page: { items: [], unreadCount: "0", nextCursor: null } }),
};

const pages = { tasks: tasksPage, students: () => studentsPage(fixture.search), calendar: calendarPage };
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: fixture.pathname },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-look": look === "next" ? "next" : undefined },
          h(AppShell, { actor: ACTOR, initialNotifications: null, ...(look === "next" ? { look: "next" } : {}) }, pages[fixture.page]()))))));
createRoot(document.getElementById("root")).render(tree);
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.rendered = "1"; }));
`;

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
    router.push(href);
  } });
}
module.exports = Link;
module.exports.default = Link;
module.exports.__esModule = true;
`;

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "e7-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({
        contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });",
        loader: "js",
      }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия: ответ заглушки из `window.__e7Actions`, иначе — честный отказ.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}(...args) { const stub = window.__e7Actions && window.__e7Actions[${JSON.stringify(name)}]; if (stub) return stub(...args); throw new Error("e7 harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "e7-client-entry.js", loader: "js" },
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: "var process = globalThis.process || { env: {} };" },
    plugins: [plugin],
    logLevel: "error",
  });
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
  return [
    ...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"),
    readFileSync(join(ROOT, "src/components/v3/calendar/CalendarPanel.module.css"), "utf8"),
  ].join("\n");
}

// --- сценарии -------------------------------------------------------------------
const PAGES = {
  tasks: { pathname: "/v3/tasks", search: "" },
  students: { pathname: "/v3/profile", search: `view=active&open=cccccccc-2222-4222-8222-${"3".padStart(12, "0")}` },
  "students-plain": { page: "students", pathname: "/v3/profile", search: "view=active" },
  calendar: { pathname: "/v3/calendar", search: "view=week&date=2026-09-26" },
};

const isPhone = (page) => page.viewportSize().width < 768;

/** «Создать задачу» оболочки: на телефоне нового облика — в листе «Ещё». */
async function clickShellCreate(page) {
  const link = page.locator('a[href="/v3/tasks?create=staff"]').filter({ visible: true }).first();
  if (!(await link.count())) await page.locator('[data-shell-tab="more"]').click();
  await page.locator('a[href="/v3/tasks?create=staff"]').filter({ visible: true }).first().click();
  await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
}

async function selectRows(page, count) {
  const boxes = page.locator("[data-queue-select]");
  for (let index = 0; index < count; index += 1) await boxes.nth(index).check();
  await page.waitForSelector('[data-testid="queue-bulk-bar"]');
}

// [имя снимка, страница, шаги]
const SHOTS = [
  ["e7-composer-shell", "students", async (page) => {
    // Телефон: «Быстрый просмотр» — окно поверх страницы; дело открывает его «+ Задача» (тот же диалог оболочки).
    if (isPhone(page)) {
      await page.getByTestId("queue-detail-panel").locator("a", { hasText: "+ Задача" }).click();
      await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
    } else await clickShellCreate(page);
  }],
  ["e7-composer-calendar", "calendar", async (page) => {
    await page.getByTestId("v3-calendar-new-task").click();
    await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
  }],
  ["e7-composer-quickadd", "tasks", async (page) => {
    await page.fill('[data-testid="task-quick-add"] input', "Позвонить семье после консультации");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
  }],
  ["e7-bulk-tasks", "tasks", async (page) => { await selectRows(page, 3); }],
  ["e7-bulk-tasks-dialog", "tasks", async (page) => {
    await selectRows(page, 3);
    await page.getByTestId("task-bulk-reschedule-trigger").click();
    await page.waitForSelector('[data-testid="task-bulk-reschedule"][open]');
    await page.getByTestId("task-bulk-reschedule").locator("input:not([type=date])").last().fill("Семья перенесла встречу");
  }],
  ["e7-bulk-tasks-result", "tasks", async (page) => {
    await selectRows(page, 3);
    await page.getByTestId("task-bulk-reschedule-trigger").click();
    const dialog = page.getByTestId("task-bulk-reschedule");
    await dialog.locator("input:not([type=date])").last().fill("Семья перенесла встречу");
    await dialog.locator('button[type="submit"]').click();
    await dialog.locator("[data-bulk-result]").waitFor();
  }],
  ["e7-bulk-students", "students-plain", async (page) => { await selectRows(page, 4); }],
  ["e7-bulk-students-curator", "students-plain", async (page) => {
    await page.locator('[data-student-case-id$="000000000006"] [data-queue-select]').check();
    await page.locator('[data-student-case-id$="000000000007"] [data-queue-select]').check();
    await page.locator('[data-student-case-id$="000000000001"] [data-queue-select]').check();
    await page.getByTestId("students-bulk-curator-trigger").click();
    const dialog = page.getByTestId("students-bulk-curator");
    await dialog.locator("select").selectOption({ index: 2 });
    await dialog.locator("textarea").fill("Куратор направления ушёл в отпуск");
    await dialog.locator('summary').click();
  }],
  ["e7-bulk-students-result", "students-plain", async (page) => {
    await selectRows(page, 4);
    await page.getByTestId("students-bulk-step-due-trigger").click();
    const dialog = page.getByTestId("students-bulk-step-due");
    await dialog.locator('button[type="submit"]').click();
    await dialog.locator("[data-bulk-result]").waitFor();
  }],
  ["e7-palette", "tasks", async (page) => {
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[data-testid="v3-command-palette"][open]');
    await page.keyboard.type("Ай");
    await page.waitForSelector('[data-palette-option^="student:"]');
  }],
  ["e7-palette-empty", "calendar", async (page) => {
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[data-testid="v3-command-palette"][open]');
  }],
  ["e7-help", "calendar", async (page) => {
    await page.locator("body").press("?");
    await page.waitForSelector('[data-testid="v3-keyboard-help"][open]');
  }],
  // На телефоне кнопки «?» нет (клавиатуры тоже) — окно открывают клавишей только для проверки состава.
  ["e7-queue-help", "tasks", async (page) => {
    await page.locator("body").press("?");
    await page.waitForSelector("#queue-keyboard-help:popover-open");
  }],
];

/** Проверки на каждом снимке: прокрутки вбок нет, текст не мельче 12 px, фокус — в открытом окне. */
function probe() {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  // Окна верхнего слоя: модальные — фокус обязан быть внутри; всплывающая подсказка «?» очереди его не забирает.
  const layers = [...document.querySelectorAll("dialog[open], :popover-open")].filter(visible);
  const dialogs = [...document.querySelectorAll("dialog:modal")].filter(visible);
  const roots = layers.length ? layers : [document.body];
  const texts = roots.flatMap((root) => [...root.querySelectorAll("*")])
    .filter((element) => visible(element) && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  const smallest = texts.reduce((min, element) => Math.min(min, parseFloat(getComputedStyle(element).fontSize)), 99);
  const active = document.activeElement;
  const bar = document.querySelector('[data-testid="queue-bulk-bar"]');
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minText: smallest,
    focusInDialog: dialogs.length ? dialogs.some((dialog) => dialog.contains(active)) : null,
    modal: document.querySelector("dialog:modal")?.getAttribute("data-testid") ?? null,
    solidRed: [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && visible(element)).length,
    bulkBar: bar ? bar.textContent.replace(/\s+/gu, " ").trim() : null,
    selected: document.querySelectorAll("[data-queue-select]:checked").length,
    calls: window.__e7.calls.length,
  };
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundle = LOOK_NEXT ? "e7-next-client.js" : "e7-client.js";
  await buildClientBundle(join(outDir, bundle));
  const css = await compileCss();
  const look = LOOK_NEXT ? "next" : "current";
  for (const [name, config] of Object.entries(PAGES)) {
    const fixture = JSON.stringify({ page: config.page ?? name, pathname: config.pathname, search: config.search, look }).replaceAll("<", "\\u003c");
    writeFileSync(join(outDir, `e7-${LOOK_NEXT ? "next-" : ""}${name}.html`), [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>E7 ${name} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root"></div><script type="application/json" id="e7-fixture">${fixture}</script><script src="${bundle}"></script></body></html>`,
    ].join(""));
  }
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const VIEWPORTS = [
    ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
    ["1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
    ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ];
  const failures = [];
  try {
    for (const [shot, pageName, step] of SHOTS) {
      for (const [width, context] of VIEWPORTS) {
        const file = `${shot.replace(/^e7-/u, LOOK_NEXT ? "e7-next-" : "e7-")}-${width}.png`;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(pathToFileURL(join(outDir, `e7-${LOOK_NEXT ? "next-" : ""}${pageName}.html`)).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector("html[data-rendered]", { state: "attached", timeout: 15_000 });
        try {
          await step(page);
        } catch (error) {
          failures.push(`${file}: step failed: ${error.message.split("\n")[0]}`);
        }
        await page.waitForTimeout(300);
        const facts = await page.evaluate(probe);
        if (facts.overflow > 0) failures.push(`${file}: horizontal overflow ${facts.overflow}px`);
        if (facts.minText < 12) failures.push(`${file}: text smaller than 12px (${facts.minText}px)`);
        if (facts.focusInDialog === false) failures.push(`${file}: focus is outside the open dialog`);
        const real = errors.filter((message) => !/server action .* is not available/u.test(message));
        if (real.length) failures.push(`${file}: browser errors: ${real.join(" | ")}`);
        await page.screenshot({ path: join(outDir, file), fullPage: false });
        process.stdout.write(`${file}: ${Object.entries(facts).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ")}\n`);
        await browserContext.close();
      }
    }
    await keyboardProbe(browser, outDir, failures);
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`E7 harness failures:\n${failures.join("\n")}`);
    process.exit(1);
  }
}

/**
 * Клавиатура и фокус без мыши: Ctrl+K открывает окно, Tab не выводит фокус,
 * ↓ и Enter переходят, Esc закрывает и возвращает фокус; «x» отмечает строку
 * с фокусом; «Создать задачу» из Ctrl+K открывает тот же диалог.
 */
async function keyboardProbe(browser, outDir, failures) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(outDir, `e7-${LOOK_NEXT ? "next-" : ""}tasks.html`)).href, { waitUntil: "load" });
  await page.waitForSelector("html[data-rendered]", { state: "attached" });
  const expect = (label, ok, facts) => { if (!ok) failures.push(`keyboard: ${label}: ${JSON.stringify(facts)}`); };
  const firstRow = page.locator("[data-queue-row] [data-queue-open]").first();
  await firstRow.focus();
  await page.keyboard.press("x");
  expect("x marks the focused row", await page.locator("[data-queue-select]:checked").count() === 1, {});
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  expect("j then x marks the next row", await page.locator("[data-queue-select]:checked").count() === 2, {});
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[data-testid="v3-command-palette"][open]');
  const inInput = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  expect("Ctrl+K focuses the search field", inInput === "v3-command-palette-input", { inInput });
  await page.keyboard.press("Tab");
  const afterTab = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  expect("Tab keeps focus inside the palette", afterTab === "v3-command-palette-input", { afterTab });
  await page.keyboard.type("созд");
  const active = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="v3-command-palette-input"]');
    return document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.getAttribute("data-palette-option") ?? null;
  });
  expect("typing selects «Создать задачу»", active === "action:create-task", { active });
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
  const composerFocus = await page.evaluate(() => document.activeElement?.getAttribute("name"));
  expect("Enter opens the same composer with focus on the title", composerFocus === "title", { composerFocus });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const back = await page.evaluate(() => document.activeElement?.closest("[data-queue-row]")?.getAttribute("data-queue-row") ?? document.activeElement?.tagName);
  expect("Esc closes the composer and returns focus to the row", typeof back === "string" && back.includes(":"), { back });
  await page.keyboard.press("Control+k");
  await page.keyboard.type("кален");
  await page.keyboard.press("Enter");
  const pushes = await page.evaluate(() => window.__e7.pushes);
  expect("Enter on a destination navigates there", pushes.at(-1) === "/v3/calendar", { pushes });
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => document.querySelector('[data-testid="v3-command-palette"]')?.open);
  expect("Esc closes the palette", closed === false, { closed });
  process.stdout.write(`keyboard: x, j+x, Ctrl+K, Tab trap, «созд»+Enter → composer, Esc → row, «кален»+Enter → /v3/calendar, Esc ok\n`);
  await context.close();
}

if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: e7-static-render.cjs --screenshots [outDir] [--look=next]");
  process.exit(2);
}
