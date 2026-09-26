"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в tasks-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер «Сегодня» (Э3, 26.09.2026) — стартовой страницы с одной
 * очередью того, что пора сделать.
 *
 * Очередь собирается НАСТОЯЩИМ кодом: `readTodayQueue` (права по ролям,
 * независимые чтения, пределы страниц) с подставленными читателями, затем
 * `buildTodayQueue`; страница — настоящие `PartShell`, `TodayBoardLinks`,
 * `TodayScreen` (строки задач — настоящая `TaskQueueRow`) внутри настоящего
 * `AppShell`. Данные СИНТЕТИЧЕСКИЕ: люди, задачи, лиды и переписки выдуманы
 * для проверки вёрстки и не являются записями EVO. Живой Supabase, права и
 * данные этот рендер не проверяет.
 *
 *   node tests/e2e/today-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка страницы без оболочки
 *       (для tests/v3-today-queue.test.mjs).
 *   node tests/e2e/today-static-render.cjs --screenshots [outDir] [--look=next]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844, Admin ещё 320 (reflow) и во весь рост
 *       (и раздел «Динамика по дням» отчёта
 *       продаж — 1440 и 390 во весь рост); по умолчанию outDir —
 *       .impeccable/review (не коммитится). `--look=next` — предпросмотр
 *       нового облика (Э1.1): имена файлов получают суффикс `-next`.
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

const { readTodayQueue, TodaySourceDenied } = require(join(ROOT, "src/lib/v3/today-source.ts"));
const { buildTodayQueue, todayDateLabel } = require(join(ROOT, "src/lib/v3/today-queue.ts"));
const { TodayBoardLinks, TodayScreen } = require(join(ROOT, "src/components/v3/today/TodayScreen.tsx"));
const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));

// --- синтетические данные ---------------------------------------------------
// «Сейчас» — суббота 26.09.2026, 10:00 по Бишкеку (04:00 UTC).
const NOW = new Date("2026-09-26T04:00:00.000Z");
const TODAY = "2026-09-26";
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const COLLEAGUE = "aaaaaaaa-1111-4111-8111-000000000002";
const NAMES = { [ME]: "Айна Тестова", [COLLEAGUE]: "Бекболот Примеров" };
const staffId = (n) => `bbbbbbbb-5555-4555-8555-${String(n).padStart(12, "0")}`;
const caseTaskId = (n) => `cccccccc-6666-4666-8666-${String(n).padStart(12, "0")}`;
const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;
const leadId = (n) => `ffffffff-3333-4333-8333-${String(n).padStart(12, "0")}`;

function staffTask(n, fields) {
  const assignee = fields.assignee ?? ME;
  return {
    id: staffId(n), organizationId: ORG, creatorMembershipId: ME, creatorDisplayName: NAMES[ME],
    assigneeMembershipId: assignee, assigneeDisplayName: NAMES[assignee], title: fields.title, description: null,
    status: fields.status ?? "open", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null,
    version: "3", sourceMessageId: null, createdAt: "2026-09-20T05:00:00.000Z", updatedAt: "2026-09-24T05:00:00.000Z",
  };
}

function caseTask(n, fields) {
  const assignee = fields.assignee ?? ME;
  const dueOn = fields.dueOn ?? null;
  const dueAt = fields.dueAt ?? null;
  return {
    sortAt: dueAt ?? (dueOn ? `${dueOn}T00:00:00+06:00` : "9999-12-31T00:00:00+00:00"),
    organizationId: ORG, caseTaskId: caseTaskId(n), version: "5", studentCaseId: caseId(fields.caseNo ?? n), studentDisplayName: fields.student,
    caseState: "active", taskType: "follow_up", title: fields.title, status: fields.status ?? "open", priority: "normal",
    dueOn, dueAt, studentVisible: false, assigneeMembershipId: assignee, assigneeDisplayName: NAMES[assignee],
    createdAt: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-24T05:00:00.000Z",
  };
}

const BAND_OF = (step, due) => {
  if (!step) return "no_step";
  if (!due) return "undated";
  if (due < TODAY) return "overdue";
  if (due === TODAY) return "today";
  return due <= "2026-09-27" ? "this_week" : "later";
};

function caseRow(n, fields) {
  const curator = fields.curator === undefined ? ME : fields.curator;
  const step = fields.step ?? null;
  const due = step ? fields.due ?? null : null;
  const band = BAND_OF(step, due);
  const rank = step === null ? 2 : due === null ? 1 : 0;
  return {
    studentCaseId: caseId(n), studentDisplayName: fields.name, state: fields.state ?? "active",
    admissionsDirection: fields.direction ?? "CN", targetCountry: null, targetDegree: "Бакалавриат",
    pipelineStage: fields.stage ?? "documents", pipelineHidden: false, nextAction: step, nextActionDueOn: due, dueBand: band,
    admissionsVersion: "4", currentCuratorMembershipId: curator, currentCuratorDisplayName: curator ? NAMES[curator] : null,
    isMine: curator === ME, attentionFlags: fields.flags ?? [], overdueTaskCount: fields.overdueTasks ?? 0,
    documents: null, updatedAt: "2026-09-24T05:00:00.000000Z", cursor: `due|${rank}|${due ?? "infinity"}|${caseId(n)}`,
  };
}

function page(view, rows, nextCursor = null) {
  return { view, sort: "due", today: TODAY, rows, nextCursor };
}

function lead(n, fields) {
  const dueDate = fields.due ?? null;
  const due = dueDate === null ? "none" : dueDate < TODAY ? "overdue" : dueDate === TODAY ? "today" : "later";
  const owner = fields.owner === undefined ? ME : fields.owner;
  return {
    id: leadId(n), name: fields.name, stageKey: fields.stage ?? "contacting", source: fields.source ?? "website",
    nextAction: fields.action ?? null, nextActionAt: dueDate ? `${dueDate.slice(8)}.${dueDate.slice(5, 7)}` : null, due,
    stageAgeDays: 2, latestNote: null, href: `/v3/profile?id=${leadId(n)}`,
    workflow: {
      leadId: leadId(n), currentOwnerMembershipId: owner, currentOwnerDisplayName: owner ? NAMES[owner] : null,
      stageKey: fields.stage === "handed_off" ? "qualified" : fields.stage ?? "contacting",
      nextActionText: fields.action ?? null, nextActionDueDate: dueDate, workflowVersion: "7",
    },
  };
}

function chat(n, fields) {
  return {
    studentCaseId: caseId(n), studentDisplayName: fields.name, lastMessageSnippet: "Когда будет готов перевод?",
    lastMessageAt: fields.at, lastMessageAuthorMembershipId: "aaaaaaaa-9999-4999-8999-000000000009",
    awaitState: "needs_reply", unread: true,
  };
}

const STAFF_TASKS = [
  staffTask(1, { title: "Согласовать шаблон письма о визовом собеседовании", dueAt: "2026-09-26T09:00:00.000Z" }),
  staffTask(2, { title: "Отправить партнёру пакет по весеннему набору", dueOn: "2026-09-24" }),
  staffTask(3, { title: "Собрать отчёт по оплатам за сентябрь для руководителя", dueOn: "2026-09-29" }),
  staffTask(4, { title: "Подготовить вопросы к планёрке" }),
];
const CASE_TASKS = [
  caseTask(1, { title: "Записать на визу X1", student: "Нурай Образцова", dueOn: "2026-09-25", caseNo: 3 }),
  caseTask(2, { title: "Проверить перевод диплома", student: "Тимур Демонстров", dueOn: TODAY, caseNo: 4 }),
  caseTask(3, { title: "Проверить сроки подачи в Варшаве", student: "Камила Вымыслова", dueOn: TODAY, assignee: COLLEAGUE, caseNo: 5 }),
  caseTask(4, { title: "Отправить анкету в UCSI", student: "Тимур Демонстров", dueOn: "2026-09-20", status: "done", caseNo: 4 }),
  caseTask(5, { title: "Уточнить дату прилёта и встречу в аэропорту", student: "Эмиль Пробный", dueAt: "2026-10-03T05:00:00.000Z", caseNo: 6 }),
];
const MINE_ROWS = [
  caseRow(1, { name: "Алина Условная", step: "Собрать апостиль на аттестат", due: "2026-09-23" }),
  caseRow(2, { name: "Данияр Макетов", step: "Позвонить семье о бюджете на обучение", due: TODAY, direction: "MY" }),
  caseRow(3, { name: "Нурай Образцова", stage: "visa" }),
  caseRow(7, { name: "Руслан Черновиков", step: "Отправить пакет документов в UCSI", due: "2026-10-02", direction: "MY" }),
  caseRow(8, { name: "Софья Эскизова", step: "Уточнить у семьи список документов" }),
  caseRow(9, { name: "Арсен Шаблонов", step: "Встретить в аэропорту", due: "2026-10-20", stage: "predeparture" }),
  caseRow(10, { name: "Мадина Пробная", step: "Дождаться решения по заявке", due: "2026-09-30", flags: ["overdue"], stage: "awaiting_decision" }),
];
const ATTENTION_ROWS = [
  caseRow(11, { name: "Ильяс Новиков", state: "pending", stage: "new", flags: ["awaiting_ack"] }),
  caseRow(12, { name: "Жанна Вводная", state: "pending", stage: "new", curator: null, flags: ["needs_curator"] }),
  caseRow(13, { name: "Кирилл Чужой", step: "Проверить перевод", due: "2026-09-20", curator: COLLEAGUE, flags: ["overdue"] }),
];
const MY_LEADS = [
  lead(1, { name: "Асель Проектова", action: "Перезвонить после консультации", due: "2026-09-24" }),
  lead(2, { name: "Максат Пилотный", action: "Отправить договор и счёт", due: TODAY, stage: "qualified" }),
  lead(3, { name: "Гульнара Экспериментова", stage: "new" }),
  lead(4, { name: "Олжас Пробников", action: "Встреча в офисе", due: "2026-10-01", stage: "meeting_scheduled" }),
  lead(5, { name: "Нурлан Переданов", stage: "handed_off", action: null }),
];
const UNASSIGNED = [
  lead(6, { name: "Эльмира Формова", stage: "new", owner: null, source: "website" }),
  lead(7, { name: "Амир Входящий", stage: "new", owner: null, source: "whatsapp" }),
];
const CHATS = [
  chat(3, { name: "Нурай Образцова", at: "2026-09-25T12:00:00.000Z" }),
  chat(14, { name: "Лейла Тестовая", at: "2026-09-22T08:30:00.000Z" }),
];

// --- кто смотрит ------------------------------------------------------------
const actor = (fields) => ({
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid", presentationRole: null,
  ...fields,
});
const own = (label) => [{ id: "99999999-1111-4111-8111-000000000001", roleId: "99999999-1111-4111-8111-000000000002", label, bundleId: "b", bundleVersion: 1, scope: { kind: "own", key: null, resourceKind: null } }];
const ACTORS = {
  admin: actor({ displayName: "Администратор (синтетический)", systemRole: "admin", assignments: [], permissionKeys: [] }),
  admissions: actor({
    displayName: "Куратор (синтетический)", systemRole: "staff", assignments: own("Сотрудник поступления"),
    permissionKeys: ["case.read.full", "profile.read.full", "case.route.manage", "document.read.full", "task.create", "task.manage",
      "staff.task.read", "staff.task.create", "staff.task.complete", "staff.task.edit", "team.chat.admissions", "communication.read.full"],
  }),
  sales: actor({
    displayName: "Менеджер продаж (синтетический)", systemRole: "staff", assignments: own("Sales Manager"),
    permissionKeys: ["lead.read", "lead.sales.workflow.manage", "lead.sales.owner.assign", "sales.register.read", "case.read.summary",
      "staff.task.read", "staff.task.create", "staff.task.complete", "staff.task.edit", "team.chat.sales", "reply.snippet.sales"],
  }),
};

/** Читатели как у сервера: курсоры, отбор «Мои» у рабочих задач и граница срока у задач по студентам. */
function readers(data) {
  const fail = (key) => { if (data.fail?.includes(key)) throw new Error(`synthetic ${key} failure`); };
  return {
    async listStaffTasks() {
      fail("tasks");
      return { rows: (data.staff ?? []).filter((task) => task.assigneeMembershipId === ME && task.status !== "done"), nextCursor: null };
    },
    async listCaseTasks(_actor, options) {
      fail("tasks");
      const rows = (data.cases ?? []).filter((task) => (task.dueOn ?? task.dueAt?.slice(0, 10) ?? "9999") <= options.dueTo);
      return { rows, nextCursor: null };
    },
    async readStudentCaseQueue(_actor, request) {
      if (data.denied?.includes("students")) throw new TodaySourceDenied();
      if (request.view === "mine") {
        fail("students");
        return page("mine", data.mine ?? [], data.minePartial ? MINE_ROWS.at(-1).cursor : null);
      }
      fail("handoffs");
      return page("needs_action", data.attention ?? []);
    },
    async readLeads(_actor, assignment) {
      fail(assignment === "mine" ? "leads" : "requests");
      return { leads: assignment === "mine" ? data.leads ?? [] : data.unassigned ?? [], truncated: false };
    },
    async readChats() {
      fail("chats");
      return { rows: data.chats ?? [], truncated: false };
    },
  };
}

const SCENARIOS = {
  admin: { actor: "admin", data: { staff: STAFF_TASKS, cases: CASE_TASKS, mine: MINE_ROWS, attention: ATTENTION_ROWS, leads: MY_LEADS, unassigned: UNASSIGNED, chats: CHATS } },
  admissions: { actor: "admissions", data: { staff: STAFF_TASKS.slice(1, 3), cases: CASE_TASKS, mine: MINE_ROWS, attention: ATTENTION_ROWS, chats: CHATS } },
  sales: { actor: "sales", data: { staff: STAFF_TASKS, leads: MY_LEADS, unassigned: UNASSIGNED } },
  // Ошибка задач и неполное чтение студентов: остальные источники видны, числа гасятся только там, куда они пишут.
  partial: { actor: "admissions", data: { staff: STAFF_TASKS, cases: CASE_TASKS, mine: MINE_ROWS.slice(0, 3), minePartial: true, attention: ATTENTION_ROWS, chats: CHATS, fail: ["tasks"] } },
  // Пустой день продаж: всё прочитано, пора делать нечего, ближайший срок — лид на чт 01.10.
  empty: { actor: "sales", data: { staff: [staffTask(9, { title: "Подготовить вопросы к планёрке" })], leads: [MY_LEADS[3]], unassigned: [] } },
  // Пустой день поступления без сроков: главное действие роли.
  "empty-admissions": { actor: "admissions", data: { staff: [], cases: [], mine: [], attention: [], chats: [] } },
};

// --- рендер ------------------------------------------------------------------
const routerStub = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

function withContexts(node, search = "") {
  return createElement(
    AppRouterContext.Provider,
    { value: routerStub },
    createElement(
      PathnameContext.Provider,
      { value: "/v3/main" },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node),
      ),
    ),
  );
}

const BOARDS = {
  admin: [{ label: "Воронка продаж", href: "/v3/pipeline" }, { label: "Воронка поступления", href: "/v3/admissions-pipeline" }],
  admissions: [{ label: "Воронка поступления", href: "/v3/admissions-pipeline" }],
  sales: [{ label: "Воронка продаж", href: "/v3/pipeline" }],
};
const MAIN_ACTION = {
  admin: { label: "Открыть воронку продаж", href: "/v3/pipeline" },
  admissions: { label: "Открыть студентов", href: "/v3/profile" },
  sales: { label: "Открыть воронку продаж", href: "/v3/pipeline" },
};

/** Та же сборка, что у `main/page.tsx`: `PartShell` с датой, доски в шапке, `TodayScreen`. */
async function buildPage(name) {
  const scenario = SCENARIOS[name];
  const who = ACTORS[scenario.actor];
  const { reads } = await readTodayQueue(who, { now: NOW, readers: readers(scenario.data) });
  const queue = buildTodayQueue(reads, NOW);
  const admin = who.systemRole === "admin";
  const has = (key) => admin || who.permissionKeys.includes(key);
  const permissions = {
    actorMembershipId: ME, admin, preview: false, staffComplete: has("staff.task.complete"), staffEdit: has("staff.task.edit"),
    caseManage: has("task.manage"), caseAssign: has("task.assign"),
  };
  const node = createElement(PartShell, {
    title: "Сегодня",
    testId: "v3-operational-dashboard",
    meta: createElement("time", { dateTime: queue.today }, todayDateLabel(queue.today)),
    action: createElement(TodayBoardLinks, { links: BOARDS[scenario.actor] }),
  }, createElement(TodayScreen, { queue, nowIso: NOW.toISOString(), permissions, mainAction: MAIN_ACTION[scenario.actor] }));
  return { who, node };
}

/**
 * Раздел «Динамика по дням» «Отчёта продаж» (графики и воронка ушли сюда со
 * стартовой страницы): настоящий `SalesDynamics` с синтетической когортой и
 * воронкой по определению доски (`salesBoardFunnel`: переданный лид —
 * «Переданы»). Записи отчёта этот рендер не читает — вместо них строка-заглушка.
 */
function buildReportDynamics() {
  const { SalesDynamics } = require(join(ROOT, "src/components/v3/SalesDynamics.tsx"));
  const { salesBoardFunnel } = require(join(ROOT, "src/lib/v3/sales-board-funnel.ts"));
  const { salesDynamicsCarry, salesDynamicsHref } = require(join(ROOT, "src/lib/sales-register-navigation.ts"));
  const { FUNNEL_STEP, leadStage } = require(join(ROOT, "src/lib/v3/wording.ts"));
  const title = (key) => { const word = leadStage(key); return word.charAt(0).toUpperCase() + word.slice(1); };
  const stages = ["new", "contacting", "qualified", "meeting_scheduled", "meeting_completed", "potential"]
    .map((key) => ({ key, title: title(key), gate: key === "qualified", terminal: false }))
    .concat([{ key: "handed_off", title: FUNNEL_STEP.handed, gate: false, terminal: true }]);
  const board = [...MY_LEADS, ...UNASSIGNED];
  const query = { view: "sales", year: "2026", month: "9", period: "week" };
  const periods = [["today", "Сегодня"], ["yesterday", "Вчера"], ["week", "Неделя"], ["month", "Месяц"], ["custom", "Период"]];
  const days = ["20.09", "21.09", "22.09", "23.09", "24.09", "25.09", "26.09"];
  const dynamics = createElement(SalesDynamics, {
    id: "sales-dynamics",
    open: true,
    choices: periods.map(([key, label]) => ({ key, title: label, href: salesDynamicsHref(query, { key }), active: key === "week" })),
    range: null,
    periodText: "20–26 сентября",
    formAction: "/v3/main#sales-dynamics",
    carry: salesDynamicsCarry(query),
    retryHref: salesDynamicsHref(query, { key: "week" }),
    read: {
      dashboard: {
        figures: {
          counts: { leads: 12, qualified: 5, handed: 2 },
          metrics: [
            { label: FUNNEL_STEP.leads, value: 12, insteadOfDelta: null },
            { label: FUNNEL_STEP.qualified, value: 5, insteadOfDelta: null },
            { label: FUNNEL_STEP.handed, value: 2, insteadOfDelta: null },
          ],
          stages: [],
        },
        trend: {
          label: "20–26 сентября",
          ticks: days,
          series: [
            { label: FUNNEL_STEP.leads, values: [1, 3, 0, 2, 4, 1, 1], emphasis: "primary" },
            { label: FUNNEL_STEP.qualified, values: [0, 1, 0, 1, 2, 1, 0], emphasis: "secondary" },
            { label: FUNNEL_STEP.handed, values: [0, 0, 0, 1, 0, 1, 0], emphasis: "secondary" },
          ],
        },
      },
      funnel: salesBoardFunnel({ leads: board, truncated: false }, stages),
    },
  });
  return createElement("main", { className: "mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6" },
    createElement("h1", { className: "t-page-title text-fg" }, "Отчёт продаж"),
    createElement("p", { className: "mt-6 border-y border-border py-6 t-body-compact text-fg-3" }, "Записи отчёта в этом рендере не читаются."),
    dynamics);
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
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

async function renderFullPage(name, look) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { who, node } = name === "report-dynamics" ? { who: ACTORS.sales, node: buildReportDynamics() } : await buildPage(name);
  const page = createElement(
    "div",
    // `--look=next` — предпросмотр нового облика (Э1.1), как у Admin с включённым переключателем.
    { className: "v3-world", "data-look": look === "next" ? "next" : undefined },
    createElement(AppShell, { actor: who, initialNotifications: null }, node),
  );
  // Отчёт — `/v3/main?view=sales`: меню подсвечивает «Отчёт продаж», а не «Сегодня».
  return renderToStaticMarkup(withContexts(page, name === "report-dynamics" ? "view=sales&period=week" : ""));
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const look = process.argv.includes("--look=next") ? "next" : "current";
  const suffix = look === "next" ? "-next" : "";
  const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const widths = [["1440", DESKTOP], ["1280", LAPTOP], ["390", PHONE]];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const name of [...Object.keys(SCENARIOS), "report-dynamics"]) {
      const html = await renderFullPage(name, look);
      const htmlPath = join(outDir, `today-${name}${suffix}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Сегодня — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${html}</body></html>`,
      ].join(""));
      const shots = name === "report-dynamics"
        ? [[`today-${name}-1440${suffix}.png`, DESKTOP, true], [`today-${name}-390${suffix}.png`, PHONE, true]]
        : [...widths.map(([width, context]) => [`today-${name}-${width}${suffix}.png`, context, false]),
          ...(name === "admin" ? [[`today-${name}-1440-full${suffix}.png`, DESKTOP, true], [`today-${name}-390-full${suffix}.png`, PHONE, true],
            // Reflow 320 CSS px (WCAG 1.4.10): без горизонтальной прокрутки.
            [`today-${name}-320${suffix}.png`, { ...PHONE, viewport: { width: 320, height: 700 } }, false]] : [])];
      for (const [file, context, fullPage] of shots) {
        const browserContext = await browser.newContext(context);
        const tab = await browserContext.newPage();
        const errors = [];
        tab.on("pageerror", (error) => errors.push(error.message));
        await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await tab.evaluate(() => document.fonts.ready);
        // Логотип оболочки — картинка с диска: снимок после её загрузки.
        await tab.waitForFunction(() => [...document.images].every((image) => image.complete));
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await tab.evaluate(() => {
          const main = document.querySelector('[data-testid="v3-operational-dashboard"]') ?? document.querySelector("main");
          const firstBand = main?.querySelector("section h2");
          const rows = [...document.querySelectorAll("[data-queue-row]")];
          const small = [...main.querySelectorAll("*")].filter((element) => {
            if (!element.childNodes.length || ![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) return false;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return box.width > 0 && style.visibility !== "hidden" && parseFloat(style.fontSize) < 12;
          }).length;
          const targets = [...main.querySelectorAll("a, button")].filter((element) => {
            const box = element.getBoundingClientRect();
            if (box.width === 0 || element.closest("[popover]")) return false;
            return box.height < 24 && box.width < 24;
          }).length;
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            h1: document.querySelectorAll("h1").length,
            firstBandTop: firstBand ? Math.round(firstBand.getBoundingClientRect().top) : null,
            rowsInViewport: rows.filter((row) => { const box = row.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }).length,
            rowHeight: rows.length ? Math.round(Math.min(...rows.map((row) => row.getBoundingClientRect().height))) : null,
            textUnder12: small,
            tinyTargets: targets,
            solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)"
              && element.getBoundingClientRect().width > 0).length,
          };
        });
        await tab.screenshot({ path: join(outDir, file), fullPage });
        const facts = Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ");
        process.stdout.write(`${file}: ${facts}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function json() {
  const out = [];
  for (const name of Object.keys(SCENARIOS)) {
    const { node } = await buildPage(name);
    out.push({ name, html: renderToStaticMarkup(withContexts(node)) });
  }
  out.push({ name: "report-dynamics", html: renderToStaticMarkup(withContexts(buildReportDynamics())) });
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
  console.error("usage: today-static-render.cjs --json | --screenshots [outDir] [--look=next]");
  process.exit(2);
}
