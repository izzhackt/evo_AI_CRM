"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в students-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер «Задач» (одна очередь по срокам, 25.09.2026) и недели
 * «Календаря».
 *
 * Рендерит НАСТОЯЩЕЕ дерево компонентов (TasksWorkspace с примитивами очереди,
 * TaskQueueList/TaskQueueRow, TaskQuickAdd с диалогом создания, TaskDetailPanel
 * на QueueDetailPanel; для снимков — ещё AppShell и PartShell; для календаря —
 * Calendar) с СИНТЕТИЧЕСКИМИ данными: задачи, имена и даты выдуманы для
 * проверки вёрстки и не являются записями EVO. Очередь собирает тот же
 * `buildTaskQueue`, что и страница. Живой Supabase, права и данные этот рендер
 * не проверяет.
 *
 *   node tests/e2e/tasks-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — серверная разметка сценариев без
 *       оболочки (для tests/v3-tasks-queue.test.mjs).
 *   node tests/e2e/tasks-static-render.cjs --screenshots [outDir]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844; по умолчанию outDir — .impeccable/review
 *       (не коммитится). Тело «Задач» в браузере отрисовывает сам React —
 *       те же компоненты, собранные esbuild: эффекты работают по-настоящему
 *       (панель поднимается в модальный режим, выбранная строка прокручивается
 *       в окно, диалог создания открывается по адресу), а «Фильтры» и круг
 *       задачи нажимаются мышью. Серверные действия заменены заглушками,
 *       которые отказывают: снимок ничего не сохраняет. AppShell остаётся
 *       серверной разметкой без скриптов.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

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
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};
// CSS-модули календаря: имена классов как есть, стили — из самого файла.
const cssModules = [];
Module._extensions[".css"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  cssModules.push(source);
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

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const { TasksWorkspace } = require(join(ROOT, "src/components/v3/tasks/TasksWorkspace.tsx"));
const { TaskDetailPanel } = require(join(ROOT, "src/components/v3/tasks/TaskDetailPanel.tsx"));
const { buildTaskQueue, parseTaskQueueFilters } = require(join(ROOT, "src/lib/v3/task-queue.ts"));

// --- синтетические данные ---------------------------------------------------
// «Сейчас» — четверг 24.09.2026, 10:00 по Бишкеку (04:00 UTC).
const NOW = new Date("2026-09-24T04:00:00.000Z");
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

const STAFF = [
  staff(1, { title: "Отправить партнёру пакет по весеннему набору", dueOn: "2026-09-22", fromChat: true }),
  staff(2, { title: "Согласовать шаблон письма о визовом собеседовании", dueAt: "2026-09-24T09:00:00.000Z", description: "Проверить формулировки про сроки и список документов." }),
  staff(3, { title: "Собрать отчёт по оплатам за сентябрь для руководителя", dueOn: "2026-09-25" }),
  staff(4, { title: "Обновить памятку по нострификации для команды поступления и продаж — длинное название, чтобы проверить обрезку одной строкой", dueOn: "2026-09-27", status: "blocked" }),
  staff(5, { title: "Разобрать входящие заявки с сайта за выходные", dueOn: "2026-10-02", assignee: COLLEAGUE }),
  staff(6, { title: "Подготовить вопросы к планёрке", status: "open" }),
  staff(7, { title: "Проверить договор с агентом в Малайзии", dueOn: "2026-09-21", assignee: COLLEAGUE, creator: ME }),
  staff(8, { title: "Закрыть заявки без ответа за август", status: "done", dueOn: "2026-09-19", updatedAt: "2026-09-23T12:00:00.000Z" }),
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

const PARTICIPANTS = [ME, COLLEAGUE, COLLEAGUE_2].map((membershipId) => ({ membershipId, displayName: NAMES[membershipId], role: "admissions" }));
const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const PERMISSIONS = {
  actorMembershipId: ME, admin: true, preview: false, staffComplete: true, staffEdit: true, caseManage: true, caseAssign: true,
};

function scenario(search, extra = {}) {
  const params = new URLSearchParams(search);
  const filters = parseTaskQueueFilters((key) => params.get(key) ?? undefined, { teamView: true });
  const staffRows = STAFF.filter((task) => filters.view !== "mine" || task.assigneeMembershipId === ME)
    .filter((task) => filters.view !== "created" || task.creatorMembershipId === ME)
    .filter((task) => (filters.state === "done") === (task.status === "done" || task.status === "cancelled"));
  const caseRows = filters.view === "created" ? [] : CASES;
  const queue = buildTaskQueue({
    staff: filters.type === "case" ? [] : staffRows, cases: filters.type === "staff" ? [] : caseRows,
    filters, actorMembershipId: ME, now: NOW, complete: extra.complete ?? true,
  });
  return {
    search,
    props: {
      filters, queue, day: TODAY, nowIso: NOW.toISOString(), canReadStaffTasks: true, canReadCaseTasks: true, teamView: true,
      createdExcludesCases: filters.view === "created" && filters.type !== "staff",
      composer: {
        participants: PARTICIPANTS, actorMembershipId: ME, actor: ACTOR, day: TODAY, staffAllowed: true, caseAllowed: true,
        initialCase: null, initialCaseAssignees: [],
      },
      composerKey: "standalone", canCreate: true, urlIntent: null, permissions: PERMISSIONS,
      selectedKey: extra.selectedKey ?? null,
      panel: extra.panel ? createElement(TaskDetailPanel, extra.panel) : null,
    },
    // Свойства панели без React-элемента: браузерная сборка создаёт её сама.
    panelProps: extra.panel ?? null,
  };
}

// Панель задачи по студенту: строка «На этой неделе» ниже первого экрана —
// при открытии страницы с ?task= её прокручивает в окно сам список.
const PANEL_CASE = CASES[4];
const panelCase = (search) => ({
  day: TODAY, nowIso: NOW.toISOString(), closeHref: `/v3/tasks${search ? `?${search}` : ""}`,
  data: {
    kind: "case",
    caseId: PANEL_CASE.studentCaseId,
    task: {
      kind: "case", key: `case:${PANEL_CASE.caseTaskId}`, id: PANEL_CASE.caseTaskId, studentCaseId: PANEL_CASE.studentCaseId,
      taskType: "follow_up", title: PANEL_CASE.title, details: "Семья выбирает между двумя странами: нужен общий список программ со сроками подачи и стоимостью.",
      dueOn: PANEL_CASE.dueOn, dueAt: null, day: PANEL_CASE.dueOn,
      minutes: null, overdue: false, state: "open", cancelReason: null, person: PANEL_CASE.studentDisplayName, priority: "normal",
      studentVisible: false, assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], caseState: "active", version: PANEL_CASE.version,
    },
    assignees: PARTICIPANTS.map(({ membershipId, displayName }) => ({ membershipId, displayName })),
    capabilities: { taskId: PANEL_CASE.caseTaskId, studentCaseId: PANEL_CASE.studentCaseId, canAssign: true, canChangeVisibility: true, canReadCase: true },
  },
});

// Панель рабочей задачи: описание и прежние результаты (задачу уже завершали
// с заметкой и вернули в работу) — порядок «Описание → Результаты».
const PANEL_STAFF = STAFF[1];
const panelStaff = (search) => ({
  day: TODAY, nowIso: NOW.toISOString(), closeHref: `/v3/tasks${search ? `?${search}` : ""}`,
  data: {
    kind: "staff", task: PANEL_STAFF, participants: PARTICIPANTS,
    extra: {
      leadHref: null, sourceHref: null, sourceUnavailable: false, outcomesUnavailable: false,
      outcomes: [
        { requestId: "99999999-5555-4555-8555-000000000001", note: "Первый вариант отправлен руководителю, вернули с правками по срокам.", author: NAMES[COLLEAGUE], createdAt: "2026-09-22T09:15:00.000Z" },
        { requestId: "99999999-5555-4555-8555-000000000002", note: "Список документов сверен с памяткой посольства.", author: NAMES[ME], createdAt: "2026-09-23T11:40:00.000Z" },
      ],
    },
  },
});

const SCENARIOS = {
  "mine-default": scenario(""),
  "team-view": scenario("view=all"),
  "team-panel": scenario("view=all", { selectedKey: `case:${PANEL_CASE.caseTaskId}`, panel: panelCase("view=all") }),
  "team-panel-staff": scenario("view=all", { selectedKey: `staff:${PANEL_STAFF.id}`, panel: panelStaff("view=all") }),
  "team-case-filter": scenario("view=all&type=case&due=overdue"),
  "created-view": scenario("view=created"),
  "done-view": scenario("status=done"),
  "empty-today": (() => {
    const base = scenario("due=today&q=Несуществующая");
    return { ...base, props: { ...base.props, filters: { ...base.props.filters, query: "" }, queue: { ...base.props.queue, rows: [], bands: [] } } };
  })(),
  incomplete: scenario("", { complete: false }),
  // Диалог создания открыт адресом (как кнопкой «Создать задачу» верхней панели).
  composer: (() => {
    const base = scenario("");
    return { ...base, props: { ...base.props, urlIntent: "staff" } };
  })(),
  "no-queue-access": (() => {
    const base = scenario("");
    return { ...base, props: { ...base.props, canReadStaffTasks: false, canReadCaseTasks: false, teamView: false } };
  })(),
};

// --- рендер ------------------------------------------------------------------
const routerStub = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

function withContexts(node, pathname, search) {
  const searchParams = new URLSearchParams(search);
  return createElement(
    AppRouterContext.Provider,
    { value: routerStub },
    createElement(
      PathnameContext.Provider,
      { value: pathname },
      createElement(
        SearchParamsContext.Provider,
        { value: searchParams },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node),
      ),
    ),
  );
}

function renderWorkspace(name) {
  const { props, search } = SCENARIOS[name];
  return renderToStaticMarkup(withContexts(createElement(TasksWorkspace, props), "/v3/tasks", search));
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
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), ...cssModules].join("\n");
}

function appShell(content, pathname, search) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const page = createElement(
    "div",
    { className: "v3-world" },
    createElement(AppShell, { actor: ACTOR, initialNotifications: null }, content),
  );
  return renderToStaticMarkup(withContexts(page, pathname, search));
}

function shell(title, count, body, search) {
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  return appShell(createElement(PartShell, { title, count }, body), title === "Календарь" ? "/v3/calendar" : "/v3/tasks", search);
}

/** Контейнер тела «Задач»: браузерная сборка отрисовывает в нём TasksWorkspace заново. */
const CLIENT_ROOT_ID = "queue-client-root";
const FIXTURE_ID = "queue-client-fixture";

function renderTasksPage(name) {
  const { props, search } = SCENARIOS[name];
  const count = props.queue.complete && (props.canReadStaffTasks || props.canReadCaseTasks) ? props.queue.rows.length : null;
  return shell("Задачи", count, createElement("div", { id: CLIENT_ROOT_ID }, createElement(TasksWorkspace, props)), search);
}

/** Данные сценария для браузера: те же свойства, панель — свойствами, не элементом. */
function clientFixture(name) {
  const { props, search, panelProps } = SCENARIOS[name];
  return JSON.stringify({ search, props: { ...props, panel: null }, panel: panelProps }).replaceAll("<", "\\u003c");
}

/** Загрузка — настоящий `loading.tsx` страницы внутри AppShell. */
function renderTasksLoadingPage() {
  const { default: TasksLoading } = require(join(ROOT, "src/app/(v3)/v3/tasks/loading.tsx"));
  return appShell(createElement(TasksLoading), "/v3/tasks", "");
}

/** Ошибка чтения — тот же QueueError и текст, что у page.tsx при сбое чтения задач. */
function renderTasksErrorPage() {
  const { QueueError } = require(join(ROOT, "src/components/v3/queue/QueueStates.tsx"));
  return shell("Задачи", undefined, createElement(QueueError, { text: "Не удалось загрузить задачи и доступных сотрудников.", retryHref: "/v3/tasks" }), "");
}

function renderCalendarPage() {
  const { Calendar } = require(join(ROOT, "src/components/v3/calendar/Calendar.tsx"));
  const { gridDays } = require(join(ROOT, "src/components/v3/calendar/types.ts"));
  const days = gridDays("week", TODAY);
  const task = (n, fields) => ({
    kind: "case", key: `case:${caseTaskId(40 + n)}`, id: caseTaskId(40 + n), studentCaseId: caseId(40 + n), taskType: "follow_up",
    title: fields.title, details: null, dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, day: fields.day, minutes: fields.minutes ?? null,
    overdue: false, state: "open", cancelReason: null, person: fields.person, priority: "normal", studentVisible: false,
    assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], caseState: "active", version: "2",
  });
  const tasks = [
    task(1, { title: "Записать на визу X1", person: "Мээрим Жолдошева", dueAt: "2026-09-24T08:30:00.000Z", day: "2026-09-24", minutes: 870 }),
    task(2, { title: "Собрать апостиль на аттестат", person: "Айдана Сыдыкова", dueOn: "2026-09-25", day: "2026-09-25" }),
    task(3, { title: "Согласовать список программ", person: "Нурсултан Джумабаев", dueAt: "2026-09-22T05:00:00.000Z", day: "2026-09-22", minutes: 660 }),
  ];
  const body = createElement(Calendar, {
    initialTaskKey: null, unavailableTarget: null, taskCapabilities: null, view: "week", day: TODAY, today: TODAY, nowMinutes: 600,
    days, tasks, readAccess: { caseTasks: true, staffTasks: true, tasks: true, applicationDeadlines: false }, undatedContinuationPage: false, undatedNextHref: null,
    undatedCount: 0, undatedCursor: null, cases: [], casesHaveMore: false, assignees: [], actorMembershipId: ME, actor: ACTOR,
    createRequestId: "99999999-6666-4666-8666-000000000001", taskRequestIds: Object.fromEntries(tasks.map((item) => [item.key, {
      change: "99999999-6666-4666-8666-000000000002", complete: "99999999-6666-4666-8666-000000000003", cancel: "99999999-6666-4666-8666-000000000004",
    }])), basePath: "/v3/calendar",
  });
  return shell("Календарь", undefined, body, "view=week");
}

// --- браузерная сборка тела «Задач» -------------------------------------------
// Точка входа: те же TasksWorkspace и TaskDetailPanel, те же контексты
// маршрутизатора, что у серверного рендера выше. Навигация — заглушка (ссылки
// не уходят со страницы).
const CLIENT_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { TasksWorkspace } from "../../src/components/v3/tasks/TasksWorkspace";
import { TaskDetailPanel } from "../../src/components/v3/tasks/TaskDetailPanel";

const fixture = JSON.parse(document.getElementById("${FIXTURE_ID}").textContent);
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const panel = fixture.panel ? createElement(TaskDetailPanel, fixture.panel) : null;
createRoot(document.getElementById("${CLIENT_ROOT_ID}")).render(
  createElement(AppRouterContext.Provider, { value: router },
    createElement(PathnameContext.Provider, { value: "/v3/tasks" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
        createElement(TasksWorkspace, { ...fixture.props, panel })))),
);
// Два кадра: React зафиксировал дерево и выполнил эффекты (показ панели, прокрутка к строке).
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.clientRendered = "1"; }));
`;

/**
 * Серверные действия и server-only в браузере не нужны: заглушки отказывают,
 * CSS-модули — имена как есть. Фильтры esbuild — регулярные выражения Go:
 * без флага `u`.
 */
const browserStubs = {
  name: "tasks-static-render-stubs",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /\.module\.css$/ }, () => ({
      contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });",
      loader: "js",
    }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
      const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
      return {
        contents: names.map((name) => `export async function ${name}() { throw new Error("static render: server action ${name} is not available"); }`).join("\n"),
        loader: "ts",
      };
    });
  },
};

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: __dirname, sourcefile: "tasks-client-entry.js", loader: "js" },
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" },
    plugins: [browserStubs],
    logLevel: "error",
  });
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundleName = "tasks-client.js";
  await buildClientBundle(join(outDir, bundleName));
  const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  // [файл страницы, html, сценарий для браузера или null, [снимок, контекст, во весь рост, действие]]
  const pages = [
    ["tasks-mine", renderTasksPage("mine-default"), "mine-default", [
      ["tasks-desktop-1440.png", DESKTOP, false, null],
      ["tasks-desktop-1440-full.png", DESKTOP, true, null],
      ["tasks-desktop-1920.png", { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, false, null],
      ["tasks-desktop-1280.png", LAPTOP, false, null],
      ["tasks-mobile-390.png", PHONE, true, null],
      ["tasks-mobile-filters-390.png", PHONE, false, "filters"],
      ["tasks-result-popover-1440.png", DESKTOP, false, "result"],
    ]],
    ["tasks-team", renderTasksPage("team-view"), "team-view", [
      ["tasks-team-1440.png", DESKTOP, false, null],
      ["tasks-team-mobile-390.png", PHONE, false, null],
    ]],
    ["tasks-panel", renderTasksPage("team-panel"), "team-panel", [
      ["tasks-panel-1440.png", DESKTOP, false, null],
      ["tasks-panel-1280.png", LAPTOP, false, null],
      ["tasks-panel-mobile-390.png", PHONE, false, null],
    ]],
    ["tasks-panel-staff", renderTasksPage("team-panel-staff"), "team-panel-staff", [
      ["tasks-panel-staff-1440.png", DESKTOP, false, null],
    ]],
    ["tasks-empty", renderTasksPage("empty-today"), "empty-today", [["tasks-empty-today-1440.png", DESKTOP, false, null]]],
    ["tasks-composer", renderTasksPage("composer"), "composer", [
      ["tasks-composer-1440.png", DESKTOP, false, "disclosures"],
      ["tasks-composer-390.png", PHONE, false, "date"],
    ]],
    ["tasks-done", renderTasksPage("done-view"), "done-view", [["tasks-done-1440.png", DESKTOP, false, null]]],
    ["tasks-loading", renderTasksLoadingPage(), null, [["tasks-loading-1440.png", DESKTOP, false, null]]],
    ["tasks-error", renderTasksErrorPage(), null, [["tasks-error-1440.png", DESKTOP, false, null]]],
    ["calendar-week", renderCalendarPage(), null, [["tasks-calendar-week-1440.png", DESKTOP, true, null]]],
  ];
  // CSS собирается после рендера страниц: CSS-модули календаря загружаются вместе с его компонентами.
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, html, clientScenario, shots] of pages) {
      const htmlPath = join(outDir, `${name}.html`);
      const client = clientScenario
        ? `<script type="application/json" id="${FIXTURE_ID}">${clientFixture(clientScenario)}</script><script src="${bundleName}"></script>`
        : "";
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${name} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${html}${client}</body></html>`,
      ].join(""));
      for (const [file, context, fullPage, step] of shots) {
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (clientScenario) await page.waitForSelector("html[data-client-rendered]", { state: "attached", timeout: 10_000 });
        if (step === "result") {
          // Круг задачи по студенту открывает окно «Результат» (popovertarget).
          await page.click('[data-kind="case"] button[aria-haspopup="dialog"]');
          await page.evaluate(() => document.querySelector(":popover-open input")?.focus());
        }
        if (step === "filters") {
          await page.click('[data-testid="queue-toolbar"] button[aria-controls]');
        }
        if (step === "disclosures") {
          // Раскрыть «Описание и приоритет» щелчком — видно рисованную стрелку в обоих положениях.
          await page.click('[data-testid="v3-task-composer-dialog"] summary:has-text("Описание и приоритет")');
        }
        if (step === "date") {
          // «Дата…» раскрывает день и время «по Бишкеку» — подсказка часового пояса живёт только здесь.
          await page.click('[data-testid="v3-task-composer-dialog"] button:has-text("Дата…")');
        }
        // Цвета состояний меняются с переходом 150 мс (v3.css): снимок — после него.
        if (step) await page.waitForTimeout(400);
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => {
          const selected = document.querySelector('[data-queue-row] [aria-current="true"]')?.closest("[data-queue-row]");
          const rect = selected?.getBoundingClientRect();
          const filterButton = document.querySelector('[data-testid="queue-toolbar"] button[aria-controls]');
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            rowsInViewport: [...document.querySelectorAll("[data-queue-row]")].filter((row) => {
              const box = row.getBoundingClientRect();
              return box.bottom <= window.innerHeight && box.top >= 0;
            }).length,
            rowHeight: Math.round(document.querySelector("[data-queue-row]")?.getBoundingClientRect().height ?? 0),
            selectedInView: rect ? rect.top >= 0 && rect.bottom <= window.innerHeight : null,
            selectedBackground: selected ? getComputedStyle(selected).backgroundColor : null,
            panelModal: document.querySelector('[data-testid="queue-detail-panel"]')?.matches(":modal") ?? null,
            filtersExpanded: filterButton && filterButton.offsetParent !== null ? filterButton.getAttribute("aria-expanded") : null,
            solidRed: [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)"
              && element.getBoundingClientRect().width > 0).length,
          };
        });
        await page.screenshot({ path: join(outDir, file), fullPage });
        const facts = Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ");
        process.stdout.write(`${file}: ${name} ${facts}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.keys(SCENARIOS).map((name) => ({ name, html: renderWorkspace(name) }))));
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: tasks-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
