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
 * не проверяет; гидрации нет — там, где страница открывает окно скриптом,
 * снимок повторяет этот шаг в браузере и говорит об этом.
 *
 *   node tests/e2e/tasks-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка сценариев без оболочки
 *       (для tests/v3-tasks-queue.test.mjs).
 *   node tests/e2e/tasks-static-render.cjs --screenshots [outDir]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844; по умолчанию outDir — .impeccable/review
 *       (не коммитится).
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
      panel: extra.panel ?? null,
    },
  };
}

const PANEL_CASE = CASES[4];
const panelCase = (search) => createElement(TaskDetailPanel, {
  day: TODAY, nowIso: NOW.toISOString(), closeHref: `/v3/tasks${search ? `?${search}` : ""}`,
  data: {
    kind: "case",
    caseId: PANEL_CASE.studentCaseId,
    task: {
      kind: "case", key: `case:${PANEL_CASE.caseTaskId}`, id: PANEL_CASE.caseTaskId, studentCaseId: PANEL_CASE.studentCaseId,
      taskType: "follow_up", title: PANEL_CASE.title, details: null, dueOn: PANEL_CASE.dueOn, dueAt: null, day: PANEL_CASE.dueOn,
      minutes: null, overdue: false, state: "open", cancelReason: null, person: PANEL_CASE.studentDisplayName, priority: "normal",
      studentVisible: false, assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], caseState: "active", version: PANEL_CASE.version,
    },
    assignees: PARTICIPANTS.map(({ membershipId, displayName }) => ({ membershipId, displayName })),
    capabilities: { taskId: PANEL_CASE.caseTaskId, studentCaseId: PANEL_CASE.studentCaseId, canAssign: true, canChangeVisibility: true, canReadCase: true },
  },
});

const SCENARIOS = {
  "mine-default": scenario(""),
  "team-panel": scenario("view=all", { selectedKey: `case:${PANEL_CASE.caseTaskId}`, panel: panelCase("view=all") }),
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

function shell(title, count, body, search) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const page = createElement(
    "div",
    { className: "v3-world" },
    createElement(AppShell, { actor: ACTOR, initialNotifications: null }, createElement(PartShell, { title, count }, body)),
  );
  return renderToStaticMarkup(withContexts(page, title === "Календарь" ? "/v3/calendar" : "/v3/tasks", search));
}

function renderTasksPage(name) {
  const { props, search } = SCENARIOS[name];
  const count = props.queue.complete && (props.canReadStaffTasks || props.canReadCaseTasks) ? props.queue.rows.length : null;
  return shell("Задачи", count, createElement(TasksWorkspace, props), search);
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

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  // [файл страницы, html, [снимок, контекст, во весь рост, шаг в браузере]]
  const pages = [
    ["tasks-mine", renderTasksPage("mine-default"), [
      ["tasks-desktop-1440.png", DESKTOP, false, null],
      ["tasks-desktop-1440-full.png", DESKTOP, true, null],
      ["tasks-desktop-1280.png", LAPTOP, false, null],
      ["tasks-mobile-390.png", PHONE, true, null],
      ["tasks-mobile-filters-390.png", PHONE, false, "filters"],
      ["tasks-result-popover-1440.png", DESKTOP, false, "result"],
    ]],
    ["tasks-panel", renderTasksPage("team-panel"), [
      ["tasks-panel-1440.png", DESKTOP, false, null],
      ["tasks-panel-1280.png", LAPTOP, false, null],
      ["tasks-panel-mobile-390.png", PHONE, false, "modal"],
    ]],
    ["tasks-empty", renderTasksPage("empty-today"), [["tasks-empty-today-1440.png", DESKTOP, false, null]]],
    ["tasks-composer", renderTasksPage("composer"), [["tasks-composer-1440.png", DESKTOP, false, "composer"], ["tasks-composer-390.png", PHONE, false, "composer"]]],
    ["tasks-done", renderTasksPage("done-view"), [["tasks-done-1440.png", DESKTOP, false, null]]],
    ["calendar-week", renderCalendarPage(), [["tasks-calendar-week-1440.png", DESKTOP, true, null]]],
  ];
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, html, shots] of pages) {
      const htmlPath = join(outDir, `${name}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${name} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${html}</body></html>`,
      ].join(""));
      for (const [file, context, fullPage, step] of shots) {
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (step === "result") {
          // Круг задачи по студенту открывает окно «Результат» самим браузером
          // (popovertarget), без скрипта страницы.
          await page.click('[data-kind="case"] button[aria-haspopup="dialog"]');
          await page.evaluate(() => document.querySelector(":popover-open input")?.focus());
        }
        if (step === "filters") {
          // Нет гидрации: повторяем то, что рисует QueueFilterDisclosure при open.
          await page.evaluate(() => {
            const button = document.querySelector('[data-testid="queue-toolbar"] button[aria-controls]');
            button.setAttribute("aria-expanded", "true");
            const content = document.getElementById(button.getAttribute("aria-controls"));
            content.className = content.className.replace(/\bhidden\b/u, "flex");
          });
        }
        if (step === "composer") {
          // Нет гидрации: повторяем эффект TaskComposerModal — showModal().
          await page.evaluate(() => document.querySelector('[data-testid="v3-task-composer-dialog"]').showModal());
        }
        if (step === "modal") {
          // Нет гидрации: повторяем шаг QueueDetailPanel уже 1280 px — showModal().
          await page.evaluate(() => {
            const dialog = document.querySelector('[data-testid="queue-detail-panel"]');
            dialog.close();
            dialog.showModal();
          });
        }
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rowsInViewport: [...document.querySelectorAll("[data-queue-row]")].filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.bottom <= window.innerHeight && rect.top >= 0;
          }).length,
          rowHeight: Math.round(document.querySelector("[data-queue-row]")?.getBoundingClientRect().height ?? 0),
          solidRed: [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)"
            && element.getBoundingClientRect().width > 0).length,
        }));
        await page.screenshot({ path: join(outDir, file), fullPage });
        process.stdout.write(`${file}: ${name} overflow=${metrics.overflow}px rows-in-viewport=${metrics.rowsInViewport} row-height=${metrics.rowHeight}px solid-red=${metrics.solidRed}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}
