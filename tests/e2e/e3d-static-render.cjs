"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в today-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер среза Э3 (27.09.2026): EVO Docs с вкладками «На проверку ·
 * Исправить · Не хватает · Комплекты · Все» и «Сегодня» с группой «Сроки вузов ·
 * 14 дней».
 *
 * EVO Docs собирает НАСТОЯЩИЙ `buildStudentsQueueScreen` (разбор адреса
 * `parseStudentsQueueParams`, вкладки, таблица дел, таблица комплектов);
 * «Сегодня» — настоящие `readTodayQueue` (права по ролям, пределы страниц) с
 * подставленными читателями, `buildTodayQueue` и `TodayScreen`. Страницы — в
 * настоящих `PartShell` и `AppShell`. Данные СИНТЕТИЧЕСКИЕ: люди, вузы, дела,
 * комплекты и сроки выдуманы для проверки вёрстки и не являются записями EVO.
 * Живой Supabase, права и данные этот рендер не проверяет (права чтения сроков —
 * набор supabase/tests/platform_today_university_deadlines.sql).
 *
 *   node tests/e2e/e3d-static-render.cjs --json [--look=next]
 *     → stdout: JSON [{ name, html }] — разметка сценариев без оболочки
 *       (для tests/v3-e3-docs-deadlines.test.mjs).
 *   node tests/e2e/e3d-static-render.cjs --screenshots [outDir] [--look=next]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844 во весь рост: `e3d-<сценарий>-<ширина>.png`
 *       (с `--look=next` — суффикс `-next`). По умолчанию outDir —
 *       .impeccable/review (не коммитится).
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

const { buildStudentsQueueScreen } = require(join(ROOT, "src/components/v3/students/StudentsQueueScreen.tsx"));
const view = require(join(ROOT, "src/components/v3/students/students-queue-view.ts"));
const { readTodayQueue, todayLinks } = require(join(ROOT, "src/lib/v3/today-source.ts"));
const { buildTodayQueue, todayDateLabel } = require(join(ROOT, "src/lib/v3/today-queue.ts"));
const { TodayBoardLinks, TodayScreen } = require(join(ROOT, "src/components/v3/today/TodayScreen.tsx"));
const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
const { staffRoleKeys } = require("./staff-role-templates.cjs");

const LOOK = process.argv.includes("--look=next") ? "next" : undefined;

// --- синтетические данные ---------------------------------------------------
// «Сейчас» — воскресенье 27.09.2026, 10:00 по Бишкеку (04:00 UTC).
const NOW = new Date("2026-09-27T04:00:00.000Z");
const TODAY = "2026-09-27";
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const COLLEAGUE = "aaaaaaaa-1111-4111-8111-000000000002";
const NAMES = { [ME]: "Айгерим Условная", [COLLEAGUE]: "Эрлан Примеров" };
const caseId = (n) => `cccccccc-3333-4333-8333-${String(n).padStart(12, "0")}`;
const docs = (total, approved, submitted = 0, correctionRequired = 0, rejected = 0) => ({
  total, approved, submitted, correctionRequired, rejected, missing: total - approved - submitted - correctionRequired - rejected,
});

function caseRow(n, fields) {
  const curator = fields.curator === undefined ? ME : fields.curator;
  const updatedAt = `2026-09-${String(26 - (n % 6)).padStart(2, "0")}T0${n % 9}:00:00.000000Z`;
  return {
    studentCaseId: caseId(n), studentDisplayName: fields.name, state: "active", admissionsDirection: fields.direction ?? "CN",
    targetCountry: null, targetDegree: fields.degree ?? "Бакалавриат", pipelineStage: fields.stage ?? "documents", pipelineHidden: false,
    nextAction: fields.step ?? null, nextActionDueOn: null, dueBand: fields.step ? "undated" : "no_step", admissionsVersion: "3",
    currentCuratorMembershipId: curator, currentCuratorDisplayName: curator ? NAMES[curator] : null, isMine: curator === ME,
    attentionFlags: [], needsReply: false, overdueTaskCount: 0, documents: fields.documents, updatedAt,
    cursor: `updated|${updatedAt}|${caseId(n)}`,
  };
}

// Дела в работе EVO Docs: на проверке, исправить, не хватает, всё принято, без чек-листа, без доступа к документам нет.
const DOCS_ROWS = [
  caseRow(1, { name: "Алина Образцова", direction: "MY", documents: docs(12, 7, 2, 1, 0) }),
  caseRow(2, { name: "Данияр Макетов", documents: docs(10, 4, 0, 0, 0), step: "Собрать апостиль на аттестат" }),
  caseRow(3, { name: "Нурай Демонстрова", direction: "MY", documents: docs(9, 6, 0, 0, 1), curator: COLLEAGUE }),
  caseRow(4, { name: "Тимур Шаблонов", documents: docs(11, 11) }),
  caseRow(5, { name: "Камила Черновикова", degree: "Магистратура", documents: docs(8, 2, 3, 0, 0), curator: COLLEAGUE }),
  caseRow(6, { name: "Руслан Пробный", direction: "EUROPE", documents: docs(0, 0) }),
  caseRow(7, { name: "Софья Эскизова", documents: docs(12, 9, 0, 0, 0) }),
].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

const COUNTS = {
  view: "active", today: TODAY, total: DOCS_ROWS.length,
  views: { mine: 4, needs_action: 1, active: DOCS_ROWS.length, pending: 0, needs_curator: 0, closed: 3 },
  bands: { overdue: 0, today: 0, this_week: 0, later: 0, undated: 1, no_step: DOCS_ROWS.length - 1 },
  directions: [{ direction: "CN", count: 4 }, { direction: "MY", count: 2 }, { direction: "EUROPE", count: 1 }],
  curators: [{ membershipId: ME, displayName: NAMES[ME], isMe: true, count: 5 }, { membershipId: COLLEAGUE, displayName: NAMES[COLLEAGUE], isMe: false, count: 2 }],
  stages: [{ pipelineStage: "documents", count: DOCS_ROWS.length }],
};

function pkg(n, fields) {
  return {
    studentCaseId: caseId(fields.caseNo), applicationId: `dddddddd-4444-4444-8444-${String(n).padStart(12, "0")}`,
    studentDisplayName: fields.name,
    program: {
      institutionId: `dddddddd-5555-4555-8555-${String(n).padStart(12, "0")}`, publicationId: `dddddddd-6666-4666-8666-${String(n).padStart(12, "0")}`,
      programId: `program-${n}`, intakeId: `dddddddd-7777-4777-8777-${String(n).padStart(12, "0")}`,
      universityTitle: fields.university, programTitle: fields.program, intakeLabel: fields.intake,
    },
    package: {
      packageId: `dddddddd-8888-4888-8888-${String(n).padStart(12, "0")}`, requirementsRevisionId: `dddddddd-9999-4999-8999-${String(n).padStart(12, "0")}`,
      requirementsRevisionVersion: "2", origin: "staff_confirmed", configurationState: "confirmed", packageVersion: "1", previousPackageId: null,
      compositionSha256: "a".repeat(64), submittedAt: fields.at, itemCount: fields.items, isCurrentRequirements: fields.current ?? true, latestReview: null,
    },
  };
}

const PACKAGES = [
  pkg(1, { caseNo: 1, name: "Алина Образцова", university: "Университет Примера", program: "Foundation in Business", intake: "Январь 2027", at: "2026-09-27T02:15:00.000Z", items: 6 }),
  pkg(2, { caseNo: 5, name: "Камила Черновикова", university: "Технический университет Демо", program: "Master of Computer Science", intake: "Февраль 2027", at: "2026-09-25T09:40:00.000Z", items: 9 }),
  pkg(3, { caseNo: 3, name: "Нурай Демонстрова", university: "Школа бизнеса Макет", program: "Bachelor of Accounting", intake: "Март 2027", at: "2026-09-22T05:00:00.000Z", items: 7, current: false }),
];
// Длинная очередь: страницы по 20, новые сверху. Вкладка читает её настоящим `readDocsPackagePages`.
const QUEUE_LONG = Array.from({ length: 70 }, (_, index) => pkg(10 + index, {
  caseNo: (index % 7) + 1, name: DOCS_ROWS[index % 7].studentDisplayName, university: index % 2 ? "Университет Примера" : "Технический университет Демо",
  program: index % 2 ? "Foundation in Business" : "Bachelor of Engineering", intake: "Январь 2027",
  at: new Date(Date.parse("2026-09-27T03:00:00.000Z") - index * 5 * 3600 * 1000).toISOString(), items: 5 + (index % 4),
}));
/** Страницы очереди `application_package_queue_v1` (по 20) из синтетического списка. */
function packagePages(all) {
  return async (cursor) => {
    const start = cursor ? all.findIndex((item) => item.package.packageId === cursor.id) + 1 : 0;
    const items = all.slice(start, start + 20);
    const last = items.at(-1);
    return { ok: true, queue: { protocolVersion: 1, items, nextCursor: start + 20 < all.length ? { createdAt: last.package.submittedAt, id: last.package.packageId } : null } };
  };
}

const DOCS_QUEUE_ACTOR = { admin: true, coverage: true };

function docsScenario(search, { packages = { kind: "ready", queue: { protocolVersion: 1, items: PACKAGES, nextCursor: null } }, rows = DOCS_ROWS, counts = COUNTS } = {}) {
  const parse = view.parseStudentsQueueParams(Object.fromEntries(new URLSearchParams(search)), "docs", DOCS_QUEUE_ACTOR);
  if (parse.kind !== "ok") throw new Error(`scenario ${search}: ${parse.kind}`);
  return {
    kind: "docs",
    search,
    input: {
      params: parse.params, invalid: false,
      read: { page: { view: "active", sort: "updated", today: TODAY, rows, nextCursor: null }, counts, forbidden: false },
      actor: DOCS_QUEUE_ACTOR, openTasks: null, handoff: null, closure: null, coverage: null, today: TODAY,
      curatorNames: Object.entries(NAMES).map(([membershipId, displayName]) => ({ membershipId, displayName })),
      editor: { admin: true, preview: false, routeManage: true, broadScope: true }, recordScopes: [], createTask: true,
      requestIds: { nextStep: "99999999-6666-4666-8666-000000000001", coverage: "99999999-6666-4666-8666-000000000002" },
      look: LOOK, packages,
    },
  };
}

// --- «Сегодня»: сроки вузов ---------------------------------------------------
function deadline(n, fields) {
  const applicationId = `eeeeeeee-7777-4777-8777-${String(n).padStart(12, "0")}`;
  const kind = fields.kind ?? "application";
  return {
    sourceKey: `${kind === "application" ? "application" : "visa"}:${applicationId}:${kind}`, deadlineKind: kind, applicationId,
    studentCaseId: caseId(fields.caseNo), studentDisplayName: fields.student, universityName: fields.university,
    programName: fields.program ?? "", status: kind === "application" ? fields.status ?? "preparation" : null, deadline: fields.day,
  };
}

const DEADLINES = [
  // Прошёл 3 дня назад, заявление всё ещё «готово»: вверху группы, красным «прошёл», работа дня.
  deadline(6, { caseNo: 5, student: "Камила Черновикова", university: "Технический университет Демо", program: "Master of Computer Science", day: "2026-09-24", status: "ready" }),
  deadline(1, { caseNo: 1, student: "Алина Образцова", university: "Университет Примера", program: "Foundation in Business", day: TODAY }),
  deadline(2, { caseNo: 2, student: "Данияр Макетов", university: "Технический университет Демо", program: "Bachelor of Engineering", day: "2026-09-29", status: "ready" }),
  deadline(3, { caseNo: 7, student: "Софья Эскизова", university: "Школа бизнеса Макет", day: "2026-10-06" }),
  deadline(4, { caseNo: 3, student: "Нурай Демонстрова", university: "Университет Примера", program: "Diploma in Nursing", day: "2026-10-11" }),
  // Срок паспорта в окне — другой вид срока: в «Сроки вузов» не входит.
  deadline(5, { caseNo: 4, student: "Тимур Шаблонов", university: "Документы для поездки", kind: "passport_expiry", day: "2026-10-01" }),
];

function studentRow(n, fields) {
  const due = fields.due ?? null;
  const band = !fields.step ? "no_step" : !due ? "undated" : due < TODAY ? "overdue" : due === TODAY ? "today" : "later";
  const rank = !fields.step ? 2 : !due ? 1 : 0;
  return {
    ...caseRow(n, { name: fields.name, documents: null, step: fields.step }),
    nextAction: fields.step ?? null, nextActionDueOn: fields.step ? due : null, dueBand: band, attentionFlags: fields.flags ?? [],
    cursor: `due|${rank}|${due ?? "infinity"}|${caseId(n)}`,
  };
}

const MINE = [
  studentRow(2, { name: "Данияр Макетов", step: "Собрать апостиль на аттестат", due: "2026-09-25" }),
  studentRow(7, { name: "Софья Эскизова", step: "Позвонить семье о бюджете на обучение", due: TODAY }),
  studentRow(4, { name: "Тимур Шаблонов", step: "Отправить мотивационное письмо на проверку", due: "2026-10-02" }),
];

const TODAY_ACTORS = {
  admissions: {
    authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002", membershipId: ME, organizationId: ORG,
    platformAccessVersion: 1, email: "synthetic@example.invalid", presentationRole: null, displayName: "Куратор (синтетический)", systemRole: "staff",
    assignments: [{ id: "99999999-1111-4111-8111-000000000001", roleId: "99999999-1111-4111-8111-000000000002", label: "Admissions", bundleId: "b", bundleVersion: 1, scope: { kind: "own", key: null, resourceKind: null } }],
    permissionKeys: staffRoleKeys("admissions"),
  },
};

function todayReaders(data) {
  const fail = (key) => { if (data.fail?.includes(key)) throw new Error(`synthetic ${key} failure`); };
  let deadlinePages = 0;
  return {
    async listStaffTasks() { return { rows: [], nextCursor: null }; },
    async listCaseTasks() { return { rows: [], nextCursor: null }; },
    async readStudentCaseQueue(_actor, request) {
      return { view: request.view, sort: "due", today: TODAY, rows: request.view === "mine" ? data.mine ?? [] : [], nextCursor: null };
    },
    async readLeads() { return { leads: [], truncated: false }; },
    async readChats() { return { rows: [], truncated: false }; },
    async readDeadlines(_actor, options) {
      fail("deadlines");
      deadlinePages += 1;
      const rows = (data.deadlines ?? []).filter((row) => row.deadline >= options.from && row.deadline <= options.to);
      // Неполное чтение: у каждой страницы есть продолжение — после 3 страниц чтение останавливается.
      return { rows: data.endless ? rows.slice(deadlinePages - 1, deadlinePages) : rows, nextCursor: data.endless ? { deadline: TODAY, sourceKey: rows[0].sourceKey } : null };
    },
  };
}

const TODAY_SCENARIOS = {
  // Куратор: свои шаги и сроки вузов по своим делам.
  "today-deadlines": { data: { mine: MINE, deadlines: DEADLINES } },
  // Пустой день и пустое полное чтение сроков: одна пустота — «На сегодня всё» и слова о сроках под ним.
  "today-deadlines-empty": { data: { mine: [], deadlines: [] } },
  // Пустое полное чтение сроков рядом с другими группами: своя группа со словами.
  "today-deadlines-empty-queue": { data: { mine: MINE, deadlines: [] } },
  // Неполное чтение сроков: строки есть, числа нет, строка над очередью говорит почему.
  "today-deadlines-partial": { data: { mine: MINE, deadlines: DEADLINES, endless: true } },
  // Сбой чтения сроков: на месте, «Повторить»; остальная очередь видна.
  "today-deadlines-error": { data: { mine: MINE, deadlines: DEADLINES, fail: ["deadlines"] } },
};

const DOCS_SCENARIOS = {
  "docs-review": docsScenario("section=docs"),
  "docs-missing": docsScenario("section=docs&view=missing"),
  // «Все»: у дела без чек-листа полосы нет — прежняя строка «Чек-лист не собран».
  "docs-all": docsScenario("section=docs&view=all"),
  "docs-packages": docsScenario("section=docs&view=packages"),
  // Очередь в 3 страницы и ещё продолжение: 60 строк, числа нет, строка ведёт на доску.
  "docs-packages-more": docsScenario("section=docs&view=packages", { packages: () => view.readDocsPackagePages(packagePages(QUEUE_LONG)) }),
  // Очередь в 2 страницы (25): прочитана целиком — число есть, строки на доску нет.
  "docs-packages-pages": docsScenario("section=docs&view=packages", { packages: () => view.readDocsPackagePages(packagePages(QUEUE_LONG.slice(0, 25))) }),
  "docs-packages-error": docsScenario("section=docs&view=packages", { packages: { kind: "error" } }),
  // Учётная запись без очереди комплектов (нет document.read.full или просмотр роли): вкладки нет.
  "docs-no-packages": docsScenario("section=docs", { packages: { kind: "hidden" } }),
  // Всё загружено: «Не хватает» — честный ноль полного чтения.
  "docs-missing-empty": docsScenario("section=docs&view=missing", { rows: DOCS_ROWS.filter((row) => row.documents.missing === 0 || row.documents.total === 0), counts: { ...COUNTS, views: { ...COUNTS.views, active: 2 } } }),
};

// --- рендер ------------------------------------------------------------------
const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function withContexts(node, pathname, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

/** EVO Docs — как `profile/page.tsx`: `PartShell` «EVO Docs» с числом вкладки и тихой ссылкой Admin. */
async function docsPage(name) {
  const item = DOCS_SCENARIOS[name];
  const packages = typeof item.input.packages === "function" ? await item.input.packages() : item.input.packages;
  const built = buildStudentsQueueScreen({ ...item.input, packages });
  const action = createElement("a", { href: "/v3/universities", className: "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" }, "Университеты и бланки");
  return { node: createElement(PartShell, { title: "EVO Docs", count: built.count, action, dense: true }, createElement("div", { className: "space-y-6" }, built.content)), pathname: "/v3/profile", search: item.search };
}

/** «Сегодня» — как `main/page.tsx`: `PartShell` с датой, доски в шапке (`todayLinks`), `TodayScreen`. */
async function todayPage(name) {
  const who = TODAY_ACTORS.admissions;
  const { access, reads } = await readTodayQueue(who, { now: NOW, readers: todayReaders(TODAY_SCENARIOS[name].data) });
  const queue = buildTodayQueue(reads, NOW);
  const { boards, mainAction } = todayLinks(who, access, { canReadReport: false });
  const has = (key) => who.permissionKeys.includes(key);
  const permissions = {
    actorMembershipId: ME, admin: false, preview: false, staffComplete: has("staff.task.complete"), staffEdit: has("staff.task.edit"),
    caseManage: has("task.manage"), caseAssign: has("task.assign"),
  };
  const node = createElement(PartShell, {
    title: "Сегодня", testId: "v3-operational-dashboard",
    meta: createElement("time", { dateTime: queue.today }, todayDateLabel(queue.today)),
    action: createElement(TodayBoardLinks, { links: boards }),
  }, createElement(TodayScreen, { queue, nowIso: NOW.toISOString(), permissions, mainAction }));
  return { node, pathname: "/v3/main", search: "" };
}

const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002", membershipId: ME, organizationId: ORG,
  displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [], permissionKeys: [],
  email: "synthetic@example.invalid", presentationRole: null,
};

async function build(name) {
  return DOCS_SCENARIOS[name] ? docsPage(name) : todayPage(name);
}

async function renderFullPage(name) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { node, pathname, search } = await build(name);
  const who = DOCS_SCENARIOS[name] ? ADMIN : TODAY_ACTORS.admissions;
  const page = createElement("div", { className: "v3-world", "data-look": LOOK },
    createElement(AppShell, { actor: who, initialNotifications: null, ...(LOOK ? { look: LOOK } : {}) }, node));
  return renderToStaticMarkup(withContexts(page, pathname, search));
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

/** Снимки: основные сценарии — на трёх ширинах, остальные состояния — на 1440 и 390. */
const SHOTS = {
  "docs-review": ["1440", "1280", "390"],
  "docs-missing": ["1440", "1280", "390"],
  "docs-packages": ["1440", "1280", "390"],
  "docs-packages-more": ["1440", "390"],
  "docs-packages-pages": ["1440"],
  "docs-missing-empty": ["1440"],
  "today-deadlines": ["1440", "1280", "390"],
  "today-deadlines-empty": ["1440", "1280", "390"],
  "today-deadlines-empty-queue": ["1440", "390"],
  "today-deadlines-partial": ["1440", "390"],
  "today-deadlines-error": ["1440"],
};

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const suffix = LOOK ? "-next" : "";
  const CONTEXTS = {
    1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, widths] of Object.entries(SHOTS)) {
      const html = await renderFullPage(name);
      const htmlPath = join(outDir, `e3d-${name}${suffix}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Э3 — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${html}</body></html>`,
      ].join(""));
      for (const width of widths) {
        const file = `e3d-${name}-${width}${suffix}.png`;
        const browserContext = await browser.newContext(CONTEXTS[width]);
        const tab = await browserContext.newPage();
        const errors = [];
        tab.on("pageerror", (error) => errors.push(error.message));
        await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await tab.evaluate(() => document.fonts.ready);
        await tab.waitForFunction(() => [...document.images].every((image) => image.complete || image.getClientRects().length === 0));
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await tab.evaluate(() => {
          const main = document.querySelector("main");
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
          const rows = [...document.querySelectorAll("[data-queue-row]")];
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            h1: document.querySelectorAll("h1").length,
            rows: rows.length,
            rowHeight: rows.length ? Math.round(Math.min(...rows.map((row) => row.getBoundingClientRect().height))) : null,
            textUnder12: small,
            tinyTargets: targets,
            solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)"
              && element.getBoundingClientRect().width > 0).length,
            progressBars: document.querySelectorAll("main .v3-progress").length,
          };
        });
        await tab.screenshot({ path: join(outDir, file), fullPage: true });
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
  for (const name of [...Object.keys(DOCS_SCENARIOS), ...Object.keys(TODAY_SCENARIOS)]) {
    const { node, pathname, search } = await build(name);
    out.push({ name, html: renderToStaticMarkup(withContexts(node, pathname, search)) });
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
  console.error("usage: e3d-static-render.cjs --json | --screenshots [outDir] [--look=next]");
  process.exit(2);
}
