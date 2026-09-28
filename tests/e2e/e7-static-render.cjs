"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Э7 плана редизайна (27.09.2026): один диалог «Новая задача», массовые
 * действия, Ctrl+K и окно «?» — снимки настоящих компонентов в Chromium.
 *
 * Страница целиком — оболочка (`AppShell`) и тело — рисуется в
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
 *   node tests/e2e/e7-static-render.cjs --screenshots [outDir]
 *     → снимки `e7-*.png` (1440×900, 1280×800, 390×844); по умолчанию
 *       outDir — .impeccable/review (не коммитится). Проверки печатаются
 *       строкой на снимок; нарушение — код выхода 1. После снимков — пути
 *       клавиатуры, фокуса массовых действий, ключа повтора создания и
 *       черновика при смене дела (1440 и 390).
 */

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
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
const { TaskComposerContextMark } = require("@/components/v3/tasks/task-composer-context");
const h = React.createElement;

const fixture = JSON.parse(document.getElementById("e7-fixture").textContent);
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
  // «case» — сотрудник с задачами по студентам без staff.task.create: у него нет «Создать задачу» оболочки, есть своя кнопка календаря.
  ...(fixture.actor === "case" ? { systemRole: "staff", displayName: "Сотрудник поступления (синтетический)", permissionKeys: ["case.read.full", "task.create", "task.assign"] } : {}),
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
  });
  return h(PartShell, { title: "Студенты", count: built.count, dense: true }, built.content);
}

/**
 * «Календарь» (Э8.8) — синтетические задачи на неделю 21–27.09 (сегодня —
 * чт 24.09, выбранный день адреса — сб 26.09): «week» — задачи со сроком и
 * одна без срока; «empty» — пустая неделя; «undated» — только задачи без
 * срока (одна выполнена); «month» — сентябрь, в одном дне больше трёх задач;
 * «day» — один день с задачами.
 */
function calendarPage() {
  const variant = fixture.calendar ?? "week";
  const view = variant === "month" ? "month" : variant === "day" ? "day" : "week";
  const day = variant === "day" ? TODAY : "2026-09-26";
  const days = gridDays(view, day);
  const task = (n, fields) => ({
    kind: "case", key: "case:" + id("cccccccc", 40 + n), id: id("cccccccc", 40 + n), studentCaseId: id("dddddddd", 40 + n), taskType: "follow_up",
    title: fields.title, details: null, dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, day: fields.day ?? null, minutes: fields.minutes ?? null,
    overdue: fields.overdue ?? false, state: fields.state ?? "open", cancelReason: null, person: fields.person, priority: "normal", studentVisible: false,
    assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], caseState: "active", version: "2",
  });
  const dated = [
    task(1, { title: "Записать на визу X1", person: "Мээрим Жолдошева", dueAt: "2026-09-24T08:30:00.000Z", day: "2026-09-24", minutes: 870 }),
    task(2, { title: "Собрать апостиль на аттестат", person: "Айдана Сыдыкова", dueOn: "2026-09-25", day: "2026-09-25" }),
    task(3, { title: "Согласовать список программ", person: "Тимур Абдылдаев", dueAt: "2026-09-22T05:00:00.000Z", day: "2026-09-22", minutes: 660, overdue: true }),
  ];
  const undated = [
    task(4, { title: "Уточнить у семьи список документов", person: "Асель Бакирова" }),
    task(5, { title: "Проверить перевод аттестата", person: "Данияр Мамытов" }),
    task(6, { title: "Позвонить после консультации", person: "Камила Усенова", state: "done" }),
  ];
  const month = [
    task(11, { title: "Подтвердить подачу в UCSI", person: "Тимур Абдылдаев", dueOn: "2026-09-03", day: "2026-09-03", state: "done" }),
    ...["Перевести паспорт", "Заверить у нотариуса", "Отправить пакет партнёру", "Собрать справку об оплате"].map((title, index) =>
      task(12 + index, { title, person: "Санжар Алиев", dueAt: "2026-09-15T0" + (3 + index) + ":00:00.000Z", day: "2026-09-15", minutes: 540 + index * 60 })),
    ...dated,
    task(20, { title: "Отправить документы в вуз", person: "Камила Усенова", dueOn: "2026-09-30", day: "2026-09-30" }),
  ];
  const tasks = variant === "week" ? [...dated, undated[0]]
    : variant === "undated" ? undated
    : variant === "month" ? month
    : variant === "day" ? dated.filter((row) => row.day === TODAY)
    : [];
  return h(PartShell, { title: "Календарь" }, h(Calendar, {
    initialTaskKey: null, unavailableTarget: null, taskCapabilities: null, view, day, today: TODAY, nowMinutes: 600,
    days, tasks, readAccess: { caseTasks: true, staffTasks: true, tasks: true }, undatedContinuationPage: false,
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

/**
 * Страница дела на телефоне: настоящее дело (CaseWorkParts) в этот рендер не
 * входит — вместо него та же отметка контекста, что ставит страница дела
 * (\`TaskComposerContextMark\` с делом и его исполнителями). «Создать задачу»
 * оболочки берёт из неё дело, которое можно убрать («Без дела»).
 */
function casePage() {
  const row = STUDENTS[2];
  return h(PartShell, { title: row.studentDisplayName },
    h(TaskComposerContextMark, { value: { case: { id: row.studentCaseId, name: row.studentDisplayName },
      caseAssignees: PARTICIPANTS.map(({ membershipId, displayName }) => ({ membershipId, displayName })) } }),
    h("p", { className: "t-body-compact text-fg-2" }, "Синтетическая страница дела: только контекст для диалога задачи."));
}

const pages = { tasks: tasksPage, students: () => studentsPage(fixture.search), calendar: calendarPage, case: casePage };
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: fixture.pathname },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-surface": "staff" },
          h(AppShell, { actor: ACTOR, initialNotifications: null }, pages[fixture.page]()))))));
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
  "calendar-case-only": { page: "calendar", pathname: "/v3/calendar", search: "view=week&date=2026-09-26", actor: "case" },
  "calendar-empty": { page: "calendar", pathname: "/v3/calendar", search: "view=week&date=2026-09-26", calendar: "empty" },
  "calendar-undated": { page: "calendar", pathname: "/v3/calendar", search: "view=week&date=2026-09-26", calendar: "undated" },
  "calendar-month": { page: "calendar", pathname: "/v3/calendar", search: "view=month&date=2026-09-26", calendar: "month" },
  "calendar-day": { page: "calendar", pathname: "/v3/calendar", search: "view=day&date=2026-09-24", calendar: "day" },
  case: { pathname: "/v3/profile", search: `case=cccccccc-2222-4222-8222-${"3".padStart(12, "0")}` },
};

const isPhone = (page) => page.viewportSize().width < 768;

/** «Создать задачу» оболочки: на телефоне — в листе «Ещё». */
async function clickShellCreate(page) {
  const link = page.locator('a[href="/v3/tasks?create=staff"]').filter({ visible: true }).first();
  if (!(await link.count())) await page.locator('[data-shell-tab="more"]').click();
  await page.locator('a[href="/v3/tasks?create=staff"]').filter({ visible: true }).first().click();
  await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
}

/** Телефон: отметок нет, пока не нажато «Выбрать»; на компьютере колонка видна сразу. */
async function revealSelect(page) {
  if (!isPhone(page)) return;
  const shown = await page.locator("[data-queue-select]").filter({ visible: true }).count();
  if (shown) throw new Error(`phone shows ${shown} row checkboxes before «Выбрать»`);
  await page.getByTestId("queue-bulk-pick").click();
}

async function selectRows(page, count) {
  await revealSelect(page);
  const boxes = page.locator("[data-queue-select]");
  for (let index = 0; index < count; index += 1) await boxes.nth(index).check();
  await page.waitForSelector('[data-testid="queue-bulk-bar"]');
}

// [имя снимка, страница (или страница по ширине), шаги]
const SHOTS = [
  // «Создать задачу» оболочки с контекстом страницы: на компьютере — «Быстрый
  // просмотр» справа от «Студентов»; на телефоне он — окно поверх страницы, поэтому
  // контекст даёт страница дела (отметка той же формы, что у CaseWorkParts).
  ["e7-composer-shell", (width) => (width === "390" ? "case" : "students"), async (page) => {
    await clickShellCreate(page);
    await page.getByTestId("v3-task-composer-dialog").locator('[data-composer-context="case"] button', { hasText: "Без дела" }).waitFor();
  }],
  // Календарь: своей кнопки у того, у кого есть кнопка оболочки, нет; оболочка открывает диалог с выбранным днём.
  ["e7-composer-calendar", "calendar", async (page) => {
    const own = await page.getByTestId("v3-calendar-new-task").count();
    if (own) throw new Error("the calendar shows its own create button next to the shell one");
    await clickShellCreate(page);
    const due = await page.locator('[data-testid="v3-task-composer-dialog"] input[name="due_on"]').inputValue();
    if (due !== "2026-09-26") throw new Error(`the calendar day is not the default deadline: ${due}`);
  }],
  // Без staff.task.create: своя кнопка календаря; дело обязательно — поиск открыт сразу, без сворачиваемого раздела.
  ["e7-composer-calendar-case-only", "calendar-case-only", async (page) => {
    await page.getByTestId("v3-calendar-new-task").click();
    const dialog = page.getByTestId("v3-task-composer-dialog");
    await dialog.locator('[data-composer-context="case-search"]').waitFor();
    const folds = await dialog.locator("summary").filter({ hasText: /^Студент\/дело/u }).count();
    if (folds) throw new Error("a required case is shown as an optional, foldable section");
  }],
  ["e7-composer-quickadd", "tasks", async (page) => {
    await page.fill('[data-testid="task-quick-add"] input', "Позвонить семье после консультации");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="v3-task-composer-dialog"][open]');
  }],
  // До выбора: на компьютере колонка отметок, на телефоне — только «Выбрать».
  ["e7-select-idle", "tasks", async () => {}],
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
    await revealSelect(page);
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
  // Э8.8 «Календарь»: неделя с задачами (и одной без срока), пустая неделя,
  // только задачи без срока (список раскрыт), месяц и день. На телефоне
  // неделя, месяц и день — список по дням; от 768 px — сетки.
  ["e8-calendar-week", "calendar", async () => {}],
  ["e8-calendar-empty", "calendar-empty", async () => {}],
  ["e8-calendar-undated", "calendar-undated", async (page) => {
    await page.getByRole("button", { name: /^Без срока/u }).click();
  }],
  ["e8-calendar-month", "calendar-month", async () => {}],
  ["e8-calendar-day", "calendar-day", async () => {}],
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
  const selectAll = bar?.querySelector("[data-bulk-select-all]");
  // Главная кнопка диалога задачи — в окне и видна (закреплённый низ, телефон с «Датой» и «Временем»).
  const submit = document.querySelector('[data-testid="v3-task-composer-dialog"][open] button[type="submit"]');
  const submitBox = submit?.getBoundingClientRect();
  // Полоса под строкой действий: от её низа до нижней панели (или края окна) — ничего не просвечивает.
  const dock = document.querySelector("[data-bulk-dock]");
  const tabbar = [...document.querySelectorAll('[data-testid="v3-shell-tabbar"]')].find(visible);
  const floor = tabbar ? tabbar.getBoundingClientRect().top : innerHeight;
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minText: smallest,
    focusInDialog: dialogs.length ? dialogs.some((dialog) => dialog.contains(active)) : null,
    modal: document.querySelector("dialog:modal")?.getAttribute("data-testid") ?? null,
    solidRed: [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && visible(element)).length,
    bulkBar: bar ? bar.textContent.replace(/\s+/gu, " ").trim() : null,
    selectAll: selectAll ? selectAll.innerText.replace(/\s+/gu, " ").trim() : null,
    submitInView: submitBox ? submitBox.top >= 0 && submitBox.bottom <= innerHeight : null,
    dockGap: dock ? Math.round(floor - dock.getBoundingClientRect().bottom) : null,
    phoneBoxes: innerWidth < 640 ? [...document.querySelectorAll("[data-queue-select]")].filter(visible).length : null,
    ...calendarFacts(visible),
    selected: document.querySelectorAll("[data-queue-select]:checked").length,
    calls: window.__e7.calls.length,
  };
}

/**
 * «Календарь» (Э8.8): цели нажатия меньше 44 px на листе календаря, все
 * сплошные красные заливки (кнопки и ссылки — отдельно; «сегодня» — маленькая
 * заливка), строка пустого периода, «Без срока», выбранный день и вид (сетка
 * или список телефона). Функция уходит в браузер вместе с `probe`.
 */
function calendarFacts(visible) {
  const root = document.querySelector("[data-calendar-root]");
  if (!root || document.querySelector("dialog:modal")) return {};
  const RED = "rgb(215, 2, 23)";
  const targets = [...root.querySelectorAll("a, button, summary, select, input:not([type=hidden])")].filter(visible);
  const small = targets.filter((element) => {
    const box = element.getBoundingClientRect();
    return box.height < 44 || box.width < 44;
  }).map((element) => (element.textContent || element.getAttribute("aria-label") || element.tagName).replace(/\s+/gu, " ").trim().slice(0, 24));
  const reds = [...document.querySelectorAll("*")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === RED);
  const list = root.querySelector("[data-calendar-day-list]");
  return {
    calTargets: targets.length,
    calSmallTargets: small.length ? small.join("|") : 0,
    redFills: reds.length,
    redActions: reds.filter((element) => element.matches("a, button")).length,
    emptyLine: root.querySelector("[data-calendar-empty-period]")?.textContent ?? "-",
    undated: [...root.querySelectorAll("section[aria-label='Задачи без срока'] button[aria-expanded]")].map((element) => element.textContent.trim())[0] ?? "-",
    selectedDay: [...root.querySelectorAll("[data-calendar-selected-day]")].filter(visible).length,
    createDay: root.querySelector("[data-calendar-create-day]")?.textContent ?? "-",
    phoneList: list && visible(list) ? [...list.children].map((item) => item.firstElementChild?.textContent.replace(/\s+/gu, " ").trim().slice(0, 28)).join(" / ") : "-",
    grid: [...root.querySelectorAll("[role=group][aria-label^='Сетка']")].some(visible),
  };
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundle = "e7-client.js";
  await buildClientBundle(join(outDir, bundle));
  const css = await compileCss();
  for (const [name, config] of Object.entries(PAGES)) {
    const fixture = JSON.stringify({ page: config.page ?? name, pathname: config.pathname, search: config.search, actor: config.actor ?? "admin", calendar: config.calendar ?? null }).replaceAll("<", "\\u003c");
    writeFileSync(join(outDir, `e7-${name}.html`), [
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
    for (const [shot, pageFor, step] of SHOTS) {
      for (const [width, context] of VIEWPORTS) {
        const file = `${shot}-${width}.png`;
        const pageName = typeof pageFor === "function" ? pageFor(width) : pageFor;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(pathToFileURL(join(outDir, `e7-${pageName}.html`)).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector("html[data-rendered]", { state: "attached", timeout: 15_000 });
        try {
          await step(page);
        } catch (error) {
          failures.push(`${file}: step failed: ${error.message.split("\n")[0]}`);
        }
        await page.waitForTimeout(300);
        const facts = await page.evaluate(`(${probe.toString().replace("...calendarFacts(visible),", `...(${calendarFacts.toString()})(visible),`)})()`);
        if (facts.overflow > 0) failures.push(`${file}: horizontal overflow ${facts.overflow}px`);
        if (facts.minText < 12) failures.push(`${file}: text smaller than 12px (${facts.minText}px)`);
        if (facts.focusInDialog === false) failures.push(`${file}: focus is outside the open dialog`);
        if (facts.submitInView === false) failures.push(`${file}: «Создать задачу» is outside the viewport`);
        if (facts.selectAll !== null && !/ · \d+$/u.test(facts.selectAll)) failures.push(`${file}: «Выбрать все» reads «${facts.selectAll}»`);
        if (shot === "e7-select-idle" && facts.phoneBoxes) failures.push(`${file}: ${facts.phoneBoxes} checkboxes before «Выбрать»`);
        if (shot.startsWith("e8-calendar")) {
          if (facts.calSmallTargets) failures.push(`${file}: calendar targets under 44px: ${facts.calSmallTargets}`);
          if (facts.redActions > 1) failures.push(`${file}: ${facts.redActions} solid red actions`);
          const phone = width === "390";
          // Выбранный день отмечен в шапке недели, клетке месяца и строке списка; у дня и у телефона без задач со сроком отметки нет — день называет строка «Срок новой задачи».
          const marks = shot === "e8-calendar-day" || (phone && ["e8-calendar-empty", "e8-calendar-undated"].includes(shot)) ? 0 : 1;
          if (facts.selectedDay !== marks) failures.push(`${file}: selected day marks: ${facts.selectedDay}, expected ${marks}`);
          if (phone === facts.grid) failures.push(`${file}: ${phone ? "phone shows the grid" : "desktop hides the grid"}`);
          if (shot === "e8-calendar-empty" && facts.emptyLine !== "На этой неделе задач со сроком нет.") failures.push(`${file}: empty line «${facts.emptyLine}»`);
          if (shot === "e8-calendar-undated" && (facts.emptyLine === "-" || facts.undated !== "Без срока — 2")) failures.push(`${file}: undated-only reads «${facts.emptyLine}» / «${facts.undated}»`);
          if (shot === "e8-calendar-week" && (facts.emptyLine !== "-" || facts.undated !== "Без срока — 1")) failures.push(`${file}: dated week reads «${facts.emptyLine}» / «${facts.undated}»`);
          if (shot === "e8-calendar-empty" && facts.undated !== "-") failures.push(`${file}: «Без срока» without open undated tasks`);
        }
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
  await page.goto(pathToFileURL(join(outDir, `e7-tasks.html`)).href, { waitUntil: "load" });
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
  await bulkFocusProbe(browser, outDir, expect);
}

/**
 * Полный успех массового действия с клавиатуры: выбор пустеет, строка
 * действий уходит вместе с кнопкой — фокус после «Готово» встаёт на
 * отправленную строку списка, а не на `body`. Частичный отказ оставляет
 * строку действий — фокус возвращается на её кнопку.
 */
async function bulkFocusProbe(browser, outDir, expect) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(outDir, `e7-tasks.html`)).href, { waitUntil: "load" });
  await page.waitForSelector("html[data-rendered]", { state: "attached" });
  const row = page.locator('[data-kind="staff"][data-queue-row]').first();
  const key = await row.getAttribute("data-queue-row");
  await row.locator("[data-queue-select]").focus();
  await page.keyboard.press("Space");
  await page.getByTestId("task-bulk-reschedule-trigger").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("task-bulk-reschedule");
  await dialog.waitFor();
  // Срок по умолчанию — «Завтра»; отправка — кнопкой формы.
  await dialog.locator('button[type="submit"]').focus();
  await page.keyboard.press("Enter");
  await dialog.locator("[data-bulk-result]").waitFor();
  const onDone = await page.evaluate(() => document.activeElement?.textContent ?? null);
  expect("the result focuses «Готово»", onDone === "Готово", { onDone });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    row: document.activeElement?.closest("[data-queue-row]")?.getAttribute("data-queue-row") ?? null,
    bar: Boolean(document.querySelector('[data-testid="queue-bulk-bar"]')),
  }));
  expect("full success: the bar is gone and focus is on the sent row, not body", !after.bar && after.row === key && after.tag !== "BODY", { after, key });
  // Частичный отказ: две строки, вторая отвечает отказом — строка действий остаётся, фокус — на её кнопке.
  const rows = page.locator('[data-kind="staff"][data-queue-row] [data-queue-select]');
  await rows.nth(0).check();
  await rows.nth(1).check();
  await page.getByTestId("task-bulk-reschedule-trigger").click();
  await dialog.locator('button[type="submit"]').click();
  await dialog.locator("[data-bulk-result]").waitFor();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const partial = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? null);
  expect("partial failure: focus returns to the action button", partial === "task-bulk-reschedule-trigger", { partial });
  process.stdout.write(`bulk focus: full success → row ${after.row === key ? "ok" : "MISSING"}, partial → ${partial}\n`);
  await context.close();
  await retryKeyProbe(browser, outDir, expect);
}

/**
 * Ключ повтора создания (`request_id`): ответ «не подтверждено» — задача могла
 * сохраниться, поэтому повтор обязан прийти с ТЕМ ЖЕ ключом (иначе вторая
 * задача). Новый ключ — только после `request_conflict`. Заглушки отвечают так
 * же, как настоящие действия: `unavailable` — с присланным ключом; у задачи по
 * делу `request_conflict` — с новым случайным (failureState), у рабочей — с
 * присланным (failed). Рабочая задача — из «Задач», задача по делу — из
 * календаря («Студент/дело» → дело), как в найденном ревью случае.
 */
async function retryKeyProbe(browser, outDir, expect) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const submitReady = () => page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="v3-task-composer-dialog"][open] button[type="submit"]');
    return button && !button.disabled;
  });
  const stub = () => page.evaluate(() => {
    window.__keys = { staff: [], case: [] };
    const answers = ["unavailable", "unavailable", "request_conflict", "unavailable"];
    window.__e7Actions.mutateStaffTaskAction = async (_previous, form) => {
      window.__keys.staff.push(form.get("request_id"));
      const status = answers[Math.min(window.__keys.staff.length - 1, answers.length - 1)];
      return { status, requestId: form.get("request_id"), taskId: null, version: null };
    };
    window.__e7Actions.createPlatformAdmissionsTaskAction = async (_previous, form) => {
      window.__keys.case.push(form.get("request_id"));
      const status = answers[Math.min(window.__keys.case.length - 1, answers.length - 1)];
      return { status, requestId: status === "request_conflict" ? crypto.randomUUID() : form.get("request_id"), caseTaskId: null, version: null, changedAt: null };
    };
  });
  const attempts = async (kind) => {
    const dialog = page.getByTestId("v3-task-composer-dialog");
    const notes = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await submitReady();
      await dialog.locator('button[type="submit"]').click();
      await page.waitForFunction(([name, count]) => window.__keys[name].length === count, [kind, attempt]);
      await submitReady();
      notes.push((await dialog.locator('p[role="alert"]').last().textContent())?.trim() ?? "");
    }
    return { keys: await page.evaluate((name) => window.__keys[name], kind), notes };
  };
  const check = (label, { keys, notes }) => {
    expect(`${label}: «не подтверждено» is shown`, notes[0] === "Сохранение пока не подтверждено. Повторите отправку.", { notes });
    expect(`${label}: a retry after «не подтверждено» sends the same request_id`, keys.length === 4 && keys[0] === keys[1] && keys[1] === keys[2], { keys });
    expect(`${label}: only request_conflict gives the next attempt a new request_id`, keys[3] !== keys[2] && /^[0-9a-f-]{36}$/u.test(keys[3] ?? ""), { keys });
    return keys.length === 4 && keys[0] === keys[1] && keys[1] === keys[2] && keys[3] !== keys[2];
  };

  await page.goto(pathToFileURL(join(outDir, `e7-tasks.html`)).href, { waitUntil: "load" });
  await page.waitForSelector("html[data-rendered]", { state: "attached" });
  await stub();
  await clickShellCreate(page);
  await page.getByTestId("v3-task-composer-dialog").locator('input[name="title"]').fill("Проверить повтор без подтверждения");
  const staff = check("staff task", await attempts("staff"));

  await page.goto(pathToFileURL(join(outDir, `e7-calendar.html`)).href, { waitUntil: "load" });
  await page.waitForSelector("html[data-rendered]", { state: "attached" });
  await stub();
  await clickShellCreate(page);
  const dialog = page.getByTestId("v3-task-composer-dialog");
  await dialog.locator("summary").filter({ hasText: /^Студент\/дело/u }).click();
  await dialog.getByRole("combobox", { name: "Студент", exact: true }).selectOption({ index: 1 });
  await dialog.locator('input[name="title"]').fill("Проверить повтор задачи по делу");
  const caseTask = check("calendar case task", await attempts("case"));
  process.stdout.write(`retry key: staff ${staff ? "same key on retry, new after conflict" : "FAILED"}; calendar case ${caseTask ? "same key on retry, new after conflict" : "FAILED"}\n`);
  await context.close();
  for (const width of [1440, 390]) await draftProbe(browser, outDir, expect, width);
}

/**
 * Набранное не теряется при смене дела (ревью bf378717, `composer-draft.ts`).
 * Прежний диалог при выборе дела после ввода или при «Без дела» сохранял
 * название под прежним ключом и ставил в поле черновик нового ключа — пусто
 * или старый текст; обязательное название останавливало отправку. Здесь в
 * хранилище заранее лежат старые черновики: у выбираемого дела, у другого дела
 * и у рабочей задачи. Пути: сценарий `supabase-staff-auth.spec.ts` шаг в шаг
 * (название → «Студент/дело» → дело → «Приоритет» → отправка) — кнопкой
 * оболочки и своей кнопкой календаря (без staff.task.create); дело → ввод →
 * другое дело → то же дело; страница дела: ввод → «Без дела». В каждом —
 * название на месте, `checkValidity()` истина и команда создания вызвана с
 * нужным делом (или без дела) и тем же названием.
 */
async function draftProbe(browser, outDir, expect, width) {
  const PREFIX = "evo-task-composer-draft:";
  const caseId = (n) => "cccccccc-2222-4222-8222-" + String(n).padStart(12, "0");
  const PICKED = caseId(1);
  const OTHER = caseId(2);
  const PAGE_CASE = caseId(3);
  const OWN = { title: "Старый черновик этого дела", description: "" };
  const FOREIGN = { title: "Черновик другого дела", description: "" };
  const GENERAL = { title: "Старый черновик рабочей задачи", description: "Старое описание" };
  const phone = width < 768;
  const label = (journey) => `draft ${width}: ${journey}`;
  const viewport = phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

  const open = async (pageName, drafts) => {
    const context = await browser.newContext(viewport);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(outDir, `e7-${pageName}.html`)).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-rendered]", { state: "attached" });
    await page.evaluate(([prefix, seed]) => {
      localStorage.clear();
      for (const [key, draft] of Object.entries(seed)) localStorage.setItem(prefix + key, JSON.stringify(draft));
      window.__created = [];
      window.__e7Actions.createPlatformAdmissionsTaskAction = async (_previous, form) => {
        window.__created.push({ command: "create_case_task", ...Object.fromEntries(form.entries()) });
        return { status: "saved", requestId: form.get("request_id"), caseTaskId: "cccccccc-9999-4999-8999-000000000001", version: "1", changedAt: new Date().toISOString() };
      };
      window.__e7Actions.mutateStaffTaskAction = async (_previous, form) => {
        window.__created.push({ command: "mutate_staff_task", ...Object.fromEntries(form.entries()) });
        return { status: "saved", requestId: form.get("request_id"), taskId: "bbbbbbbb-9999-4999-8999-000000000001", version: "1" };
      };
    }, [PREFIX, drafts]);
    return { context, page, errors };
  };
  const facts = (page) => page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="v3-task-composer-dialog"][open]');
    const form = dialog?.querySelector("form");
    return {
      title: dialog?.querySelector('input[name="title"]')?.value ?? null,
      description: dialog?.querySelector("textarea")?.value ?? null,
      valid: form ? form.checkValidity() : null,
      mode: form?.getAttribute("data-composer-mode") ?? null,
    };
  });
  const stored = (page) => page.evaluate((prefix) => Object.fromEntries(Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix)).map((key) => [key.slice(prefix.length), JSON.parse(localStorage.getItem(key))])), PREFIX);
  const submitReady = (page) => page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="v3-task-composer-dialog"][open] button[type="submit"]');
    return button && !button.disabled;
  });
  const submit = async (page) => {
    const dialog = page.getByTestId("v3-task-composer-dialog");
    await submitReady(page);
    await dialog.locator('button[type="submit"]').click();
    await dialog.getByRole("status").filter({ hasText: "Задача создана." }).waitFor({ timeout: 5_000 });
    return page.evaluate(() => window.__created);
  };
  const expectTyped = async (page, journey, typed, mode) => {
    const now = await facts(page);
    expect(label(`${journey}: the typed title survives`), now.title === typed, now);
    expect(label(`${journey}: the form passes the browser's validity check`), now.valid === true, now);
    expect(label(`${journey}: composer mode is ${mode}`), now.mode === mode, now);
    return now;
  };
  const ran = [];
  const run = async (journey, body) => {
    ran.push(journey);
    try { await body(); } catch (error) { expect(label(`${journey}: step failed`), false, { error: error.message.split("\n")[0] }); }
  };

  // (1) Сценарий supabase-staff-auth.spec.ts шаг в шаг: «Создать задачу» оболочки
  // (или своя кнопка календаря) → название → «Студент/дело» → дело → «Приоритет» → отправка.
  // Чистое хранилище — как у живого сценария в новом браузере (там прежний диалог давал пустое название);
  // со старыми черновиками — прежний диалог ставил в поле чужой текст и отправлял его.
  const seeds = [["fresh storage", {}], ["stale drafts", { [`case:${PICKED}`]: OWN, [`case:${OTHER}`]: FOREIGN }]];
  for (const [pageName, entry, [seedName, seed]] of [["calendar", "shell"], ["calendar-case-only", "calendar button"]].flatMap(([name, button]) => seeds.map((pair) => [name, button, pair]))) {
    await run(`type → pick case (spec order, ${entry}, ${seedName})`, async () => {
      const journey = `type → pick case (spec order, ${entry}, ${seedName})`;
      const { context, page, errors } = await open(pageName, seed);
      // Как в сценарии: первая видимая из кнопки оболочки и своей кнопки календаря; на телефоне кнопка оболочки — в листе «Ещё».
      const entryButton = page.locator('a[href="/v3/tasks?create=staff"], [data-testid="v3-calendar-new-task"]').filter({ visible: true });
      if (await entryButton.count()) await entryButton.first().click();
      else await clickShellCreate(page);
      const dialog = page.getByTestId("v3-task-composer-dialog");
      await dialog.waitFor();
      const ownButton = await page.getByTestId("v3-calendar-new-task").count();
      expect(label(`${journey}: the entry is the expected button`), entry === "shell" ? ownButton === 0 : ownButton === 1, { ownButton });
      const typed = "Синтетическая задача: проверить перевод аттестата";
      await dialog.locator('input[name="title"]').fill(typed);
      const caseSection = dialog.locator("summary").filter({ hasText: /^Студент\/дело/u });
      if (await caseSection.count()) await caseSection.click();
      await dialog.getByRole("combobox", { name: "Студент", exact: true }).selectOption(PICKED);
      const picked = await dialog.locator('[name="student_case_id"]').inputValue();
      expect(label(`${journey}: the case is selected`), picked === PICKED, { picked });
      await expectTyped(page, journey, typed, "case");
      const kind = await dialog.locator('input[name="deadline_kind"]').inputValue();
      const due = await dialog.locator('input[name="due_on"]').inputValue();
      expect(label(`${journey}: all-day deadline on the calendar day`), kind === "all_day" && due === "2026-09-26", { kind, due });
      await dialog.locator("summary").filter({ hasText: /^Приоритет/u }).click();
      await dialog.locator('select[name="priority"]').selectOption("high");
      if (entry !== "shell") {
        const visibility = await dialog.locator('select[name="student_visible"]').count();
        expect(label(`${journey}: no visibility selector without task.visibility.manage`), visibility === 0, { visibility });
      }
      await expectTyped(page, journey, typed, "case");
      const created = await submit(page);
      const call = created[0] ?? {};
      expect(label(`${journey}: create_case_task is invoked once with the case and the typed title`),
        created.length === 1 && call.command === "create_case_task" && call.student_case_id === PICKED && call.title === typed
          && call.priority === "high" && call.due_on === "2026-09-26" && (entry === "shell" || call.student_visible === "false"), { created });
      const after = await stored(page);
      expect(label(`${journey}: drafts after save: the case draft is cleared, the other case's draft is untouched, none leaked`),
        !(`case:${PICKED}` in after) && !("general" in after) && JSON.stringify(after[`case:${OTHER}`]) === JSON.stringify(seed[`case:${OTHER}`]), { after });
      if (errors.length) expect(label(`${journey}: no page errors`), false, { errors });
      await context.close();
    });
  }

  // (2) Дело → ввод: пустые поля получают черновик ЭТОГО дела (не другого); набранное
  // переживает переход на другое дело и обратно.
  await run("pick case → type", async () => {
    const journey = "pick case → type";
    const { context, page, errors } = await open("calendar", { [`case:${PICKED}`]: OWN, [`case:${OTHER}`]: FOREIGN });
    await clickShellCreate(page);
    const dialog = page.getByTestId("v3-task-composer-dialog");
    const empty = await facts(page);
    expect(label(`${journey}: the menu entry opens empty (no general draft)`), empty.title === "", empty);
    await dialog.locator("summary").filter({ hasText: /^Студент\/дело/u }).click();
    const student = dialog.getByRole("combobox", { name: "Студент", exact: true });
    await student.selectOption(PICKED);
    await page.waitForFunction((own) => document.querySelector('[data-testid="v3-task-composer-dialog"][open] input[name="title"]')?.value === own, OWN.title, { timeout: 2_000 }).catch(() => {});
    const restored = await facts(page);
    expect(label(`${journey}: an empty form takes this case's own draft`), restored.title === OWN.title, restored);
    const typed = "Синтетическая задача: записать на собеседование";
    await dialog.locator('input[name="title"]').fill(typed);
    await expectTyped(page, journey, typed, "case");
    await student.selectOption(OTHER);
    await page.waitForTimeout(100);
    const switched = await facts(page);
    expect(label(`${journey}: another case's draft never replaces typed text`), switched.title === typed, switched);
    await student.selectOption(PICKED);
    await page.waitForTimeout(100);
    await expectTyped(page, journey, typed, "case");
    const created = await submit(page);
    const call = created[0] ?? {};
    expect(label(`${journey}: create_case_task is invoked with the picked case and the typed title`),
      created.length === 1 && call.command === "create_case_task" && call.student_case_id === PICKED && call.title === typed, { created });
    if (errors.length) expect(label(`${journey}: no page errors`), false, { errors });
    await context.close();
  });

  // (3) Страница дела: ввод → «Без дела». У рабочей задачи лежит старый черновик с описанием.
  await run("type → «Без дела»", async () => {
    const journey = "type → «Без дела»";
    const { context, page, errors } = await open("case", { general: GENERAL, [`case:${OTHER}`]: FOREIGN });
    await clickShellCreate(page);
    const dialog = page.getByTestId("v3-task-composer-dialog");
    const typed = "Синтетическая задача: подготовить договор";
    await dialog.locator('input[name="title"]').fill(typed);
    await expectTyped(page, journey, typed, "case");
    await dialog.locator('[data-composer-context="case"] button', { hasText: "Без дела" }).click();
    await page.waitForTimeout(100);
    const detached = await expectTyped(page, journey, typed, "staff");
    expect(label(`${journey}: the stale general description does not appear`), detached.description === "", detached);
    const midway = await stored(page);
    expect(label(`${journey}: the typed text moved to the general key; the page case key is empty`),
      midway.general?.title === typed && midway.general?.description === "" && !(`case:${PAGE_CASE}` in midway), { midway });
    const created = await submit(page);
    const call = created[0] ?? {};
    expect(label(`${journey}: mutate_staff_task create is invoked with the typed title and no case or source`),
      created.length === 1 && call.command === "mutate_staff_task" && call.operation === "create" && call.title === typed
        && call.description === "" && call.source_lead_id === "" && call.source_message_id === "" && !("student_case_id" in call), { created });
    const after = await stored(page);
    expect(label(`${journey}: drafts after save: general cleared, the other case's draft untouched`),
      !("general" in after) && JSON.stringify(after[`case:${OTHER}`]) === JSON.stringify(FOREIGN), { after });
    if (errors.length) expect(label(`${journey}: no page errors`), false, { errors });
    await context.close();
  });
  process.stdout.write(`draft ${width}: ran ${ran.join("; ")} — a failed check is listed under «E7 harness failures»\n`);
}

if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: e7-static-render.cjs --screenshots [outDir]");
  process.exit(2);
}
