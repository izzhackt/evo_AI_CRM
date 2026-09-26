"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в students-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер дела студента (`/v3/profile?case=…`, решение владельца
 * 26.09.2026 «сначала работа»).
 *
 * Рендерит НАСТОЯЩУЮ сборку страницы дела — `caseWorkParts` (строка фактов
 * под именем и «Обзор»), `Profile` с вкладками, `PartShell` с возвратом и
 * `AppShell` — с СИНТЕТИЧЕСКИМИ данными: имена, числа и дела выдуманы для
 * проверки вёрстки и не являются записями EVO. Живой Supabase, права и
 * данные этот рендер не проверяет; «Обращения студента» (своё чтение)
 * заменены пустым местом.
 *
 *   node tests/e2e/case-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка сценариев без оболочки
 *       (для tests/v3-case-work.test.mjs).
 *   node tests/e2e/case-static-render.cjs --screenshots [outDir] [--look=next]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844 в outDir (по умолчанию .impeccable/review,
 *       не коммитится); с `--look=next` — предпросмотр нового облика (Э1.1),
 *       файлы `case-next-*.png`. Страница не гидратируется: окно шага и
 *       раскрытия работают на атрибутах браузера (popover, details).
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
// Имя файла обязательно: иначе обобщённая стрелка `<T,>(…)` в .ts читается как JSX.
const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8"), filename), filename);
  };
}
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};
// CSS-модули: имя класса — сам ключ (стили страницы приходят из globals.css и v3.css).
Module._extensions[".css"] = (module) => {
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

const { caseWorkParts } = require(join(ROOT, "src/components/v3/profile/CaseWorkParts.tsx"));
const { Profile } = require(join(ROOT, "src/components/v3/profile/Profile.tsx"));
const { buildV3ProfileHref } = require(join(ROOT, "src/components/v3/profile/types.ts"));
const workView = require(join(ROOT, "src/components/v3/profile/case-work-view.ts"));
const queueView = require(join(ROOT, "src/components/v3/students/students-queue-view.ts"));

// --- синтетические данные ---------------------------------------------------
// «Сегодня» — среда 23.09.2026 по Бишкеку (как в статическом рендере «Студентов»).
const TODAY = "2026-09-23";
const NOW = queueView.bishkekNoon(TODAY);
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER = "aaaaaaaa-1111-4111-8111-000000000002";
const CASE_ID = "cccccccc-2222-4222-8222-000000000001";
const LEAD_ID = "dddddddd-3333-4333-8333-000000000001";
const NAME = "Айдана Сыдыкова";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const RETURN_TO = "/v3/profile?view=mine";

const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const CURATOR = {
  ...ADMIN,
  displayName: "Куратор (синтетический)", systemRole: "staff",
  assignments: [{ label: "Сотрудник поступления", scope: { kind: "own" } }],
  permissionKeys: ["case.read.full", "profile.read.full", "case.route.manage", "case.update.append", "document.read.full",
    "task.create", "task.manage", "staff.task.read", "staff.task.create", "team.chat.admissions"],
};

function task(n, fields) {
  return {
    organizationId: ORG, caseTaskId: uuid("99999999", n), version: "2", studentCaseId: CASE_ID, taskType: "general",
    title: fields.title, status: fields.status ?? "todo", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null,
    studentVisible: false, assigneeMembershipId: fields.assignee ?? ME,
    assigneeDisplayName: fields.assignee === OTHER ? "Эрмек Токтосунов" : "Айгүл Осмонова",
    creatorMembershipId: ME, creatorDisplayName: "Айгүл Осмонова", createdAt: "2026-09-15T04:00:00.000Z", updatedAt: "2026-09-20T04:00:00.000Z",
  };
}

const TASKS = [
  task(1, { title: "Проверить перевод аттестата у нотариуса", dueOn: "2026-09-21" }),
  task(2, { title: "Позвонить семье: список программ в Шанхае и Ханчжоу", dueAt: "2026-09-22T09:00:00+06:00" }),
  task(3, { title: "Отправить мотивационное письмо на вычитку", dueOn: TODAY }),
  task(4, { title: "Заказать справку о несудимости", dueOn: "2026-09-25", assignee: OTHER }),
  task(5, { title: "Собрать медицинскую справку по форме вуза", dueOn: "2026-09-30", status: "blocked" }),
  task(6, { title: "Подготовить заявку на стипендию CSC", dueOn: "2026-10-10" }),
  task(7, { title: "Сверить паспортные данные в анкете", dueOn: null }),
  task(8, { title: "Уточнить у партнёра сроки приёма документов", dueOn: null }),
];

function docItem(n, status) {
  return {
    id: uuid("88888888", n), name: `Документ ${n}`, groupLabel: "Документы", intentKind: "baseline", version: 1, status,
    uploadRequestId: null, metadataRequestId: null, removalRequestId: null, caseLinkTargets: [],
    presence: status === "required" ? "absent" : "present", currentVersionId: status === "required" ? null : uuid("77777777", n),
    downloadReady: false, currentVersionNumber: 1, currentFilename: `document-${n}.pdf`, latestReview: null, reviewRequestId: null,
  };
}
const DOCUMENTS = [{ kind: "active", title: "Документы", items: [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => docItem(n, "approved")), docItem(8, "submitted"), docItem(9, "submitted"),
  docItem(10, "correction_required"), docItem(11, "required"), docItem(12, "required"),
] }];

function application(n, fields) {
  return {
    organizationId: ORG, universityApplicationId: uuid("66666666", n), version: "1", studentCaseId: CASE_ID, studentDisplayName: NAME,
    targetCountry: "CN", targetDegree: "bachelor", programDirection: null, intake: "2027", institutionName: fields.institution,
    programName: fields.program ?? null, isPrimary: fields.primary ?? false, universityDeadlineOn: fields.deadline ?? null, country: "CN",
    degree: "bachelor", status: fields.status ?? "preparation", latestEvidenceReference: null, createdAt: "2026-09-10T04:00:00.000Z",
    updatedAt: "2026-09-10T04:00:00.000Z", responsibleSalesDisplayName: null, currentCuratorDisplayName: "Айгүл Осмонова",
    documentCount: 0, openDocumentCount: 0, taskCount: 0, openTaskCount: 0, paymentObligationCount: 0,
    outstandingPaymentObligationCount: 0, createdByMembershipId: ME, createdByDisplayName: "Айгүл Осмонова",
  };
}
const APPLICATIONS = [
  application(1, { institution: "Шанхайский университет", program: "Международная торговля", primary: true, deadline: "2026-11-30", status: "preparation" }),
  application(2, { institution: "Чжэцзянский университет", program: "Компьютерные науки", deadline: "2027-01-15", status: "ready" }),
];

function queueRow(fields = {}) {
  const nextAction = fields.step === undefined ? "Собрать апостиль на аттестат" : fields.step;
  const dueOn = nextAction ? fields.due === undefined ? "2026-09-20" : fields.due : null;
  return {
    studentCaseId: CASE_ID, studentDisplayName: NAME, state: fields.state ?? "active", admissionsDirection: "CN",
    targetCountry: "CN", targetDegree: "Бакалавриат", pipelineStage: fields.stage ?? "documents", pipelineHidden: false,
    nextAction, nextActionDueOn: dueOn, dueBand: queueView.caseNextActionBand(nextAction, dueOn, NOW), admissionsVersion: "7",
    currentCuratorMembershipId: ME, currentCuratorDisplayName: "Айгүл Осмонова", isMine: true,
    attentionFlags: fields.flags ?? ["overdue"], overdueTaskCount: 2, documents: null,
    updatedAt: "2026-09-22T04:00:00.000000Z", cursor: `due|0|2026-09-20|${CASE_ID}`,
  };
}

const HANDOFF_PENDING = {
  organizationId: ORG, studentCaseId: CASE_ID, assignmentEventId: uuid("55555555", 1), canRespond: true, current: null,
  requestId: uuid("44444444", 1),
};
const HANDOFF_ACCEPTED = {
  ...HANDOFF_PENDING, canRespond: false,
  current: { acknowledgementId: uuid("33333333", 1), decision: "accepted", clarification: null, agreedContactDate: "2026-09-24", createdAt: "2026-09-21T04:00:00.000Z" },
};

const CHAT = {
  needsReply: { kind: "ready", awaitState: "needs_reply", last: { authorName: NAME, mine: false, text: "Здравствуйте! Нотариус просит оригинал аттестата, можно принести в пятницу?", createdAt: "2026-09-22T08:14:00.000Z" } },
  awaiting: { kind: "ready", awaitState: "awaiting_student", last: { authorName: "Айгүл Осмонова", mine: true, text: "Да, в пятницу подойдёт. Возьмите также копию паспорта.", createdAt: "2026-09-22T09:02:00.000Z" } },
};

function profile(fields = {}) {
  return {
    leadId: fields.leadId ?? null, person: NAME, email: fields.email ?? null, phone: fields.phone ?? null, student: true, stage: null,
    caseStatus: fields.state ?? "active", source: null, qualification: null, arrived: "01.09.2026", nextAction: "Собрать апостиль на аттестат",
    nextActionAt: null, handoff: null, applications: [], visa: [], financeStop: fields.financeStop ?? null, timeline: [],
  };
}

function draft(fields = {}) {
  return {
    access: { documents: fields.documents ?? true, finance: fields.finance ?? false, studentProfile: true, contract: fields.contract ?? false },
    routeTarget: { leadId: null, studentCaseId: CASE_ID }, responsible: "Айгүл Осмонова", provider: null, person: [], study: [],
    profileFields: null, studentApplication: fields.studentApplication ?? null, profileFieldSources: [], documents: fields.documents === false ? [] : DOCUMENTS,
    otherFiles: [], budget: null, currency: null, payments: [], paid: fields.paid ?? null, remaining: fields.remaining ?? null,
    paidPercent: fields.paidPercent ?? null,
    admissions: {
      studentCaseId: CASE_ID, caseState: fields.state ?? "active", isCabinetCase: false, direction: "CN", applications: APPLICATIONS,
      visa: null, finance: null,
      requestIds: { createApplication: uuid("22222222", 1), applications: {}, applicationDetails: {}, createStops: {}, resolveStops: {}, partnerDetails: {}, changeStatus: {} },
    },
    contract: null, handoffAcknowledgement: fields.handoff ?? HANDOFF_ACCEPTED, salesHandoffAcknowledgement: null,
    saleConditions: fields.saleConditions ?? null, leadCabinetCase: null, contractSignedAt: null,
  };
}

const SALE_CONDITIONS = {
  leadId: LEAD_ID, organizationId: ORG, revision: 3, serviceLabel: "Поступление в Китай «под ключ»", signingDate: "2026-08-28",
  serviceCostRaw: "1500", serviceCostMinor: 150000, serviceCostCurrency: "USD", paidRaw: "600", paidMinor: 60000, paidCurrency: "USD",
  paymentNote: "Вторая часть — после оффера.", wishesCountries: "Китай", wishesStudyFields: "Экономика, IT", wishesEducationLevel: "Бакалавриат",
  wishesIntakeYear: "2027", wishesIntakeSeason: "Осень", wishesUniversities: "Шанхайский университет", educationCurrent: "11 класс",
  educationGrade: "4,6", educationMarks: "", educationEnglish: "IELTS 6.0", educationCertificates: "", conditionsBudgetRaw: "8000",
  conditionsBudgetMinor: 800000, conditionsBudgetCurrency: "USD", conditionsBudgetPeriod: "year", conditionsScholarship: "Нужна частичная",
  conditionsNote: "", updatedByMembershipId: OTHER, updatedAt: "2026-08-28T05:00:00.000Z", linkedSalesRegister: null,
};
const SALES = {
  lead: { leadId: LEAD_ID, currentOwnerMembershipId: OTHER, currentOwnerDisplayName: "Эрмек Токтосунов", stageKey: "won",
    nextActionText: "Передано в поступление", nextActionDueDate: null, workflowVersion: "5" },
  gate: {
    organizationId: ORG, leadId: LEAD_ID, contractConfirmed: true, contractConfirmedByMembershipId: OTHER, contractConfirmedAt: "2026-08-28T05:00:00.000Z",
    contractEvidenceReference: "Договор № 0000 (синтетический)", firstPaymentAmount: 600, firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-01",
    firstPaymentReceivedDate: "2026-08-30", firstPaymentConfirmedByMembershipId: OTHER, firstPaymentConfirmedAt: "2026-08-30T05:00:00.000Z",
    firstPaymentEvidenceReference: "Платёж 0000 (синтетический)", overrideReason: null, overriddenByMembershipId: null, overriddenAt: null,
    gateState: "passed", normalHandoffAllowed: true, exceptionalHandoffAllowed: false, canConfirmContract: false, canConfirmFirstPayment: false,
    canOverrideGate: false, gateVersion: "4", updatedAt: "2026-08-30T05:00:00.000Z",
  },
  handoff: { caseId: CASE_ID, canOpenCase: true },
  linkedConversations: [],
};

const NOTES = {
  subject: { leadId: null, studentCaseId: CASE_ID },
  rows: [
    { body: "Семья просит держать в курсе по стипендии: решение о бюджете после ответа CSC.", authorDisplayName: "Айгүл Осмонова", createdAt: "2026-09-19T06:30:00.000Z" },
    { body: "Аттестат на руках, апостиль делаем через партнёра.", authorDisplayName: "Эрмек Токтосунов", createdAt: "2026-09-12T10:10:00.000Z" },
  ],
};

function work(fields = {}) {
  return {
    row: fields.row === undefined ? queueRow() : fields.row,
    tasks: fields.tasks ?? { kind: "ready", tasks: workView.caseOpenTasks(TASKS, NAME, "active"), assignees: [{ membershipId: ME, displayName: "Айгүл Осмонова" }] },
    chat: fields.chat ?? CHAT.needsReply,
    needsCurator: false, deletionRequested: fields.deletionRequested ?? false, today: TODAY, nowIso: NOW.toISOString(),
  };
}

const SCENARIOS = {
  // Куратор открывает переданное ему дело: «Принять дело» — единственная красная кнопка.
  "curator-accept": { actor: CURATOR, profile: profile(), draft: draft({ handoff: HANDOFF_PENDING }), sales: null,
    work: work({ row: queueRow({ flags: ["overdue", "awaiting_ack"] }) }) },
  // Куратор в своём деле после принятия: шаг просрочен, задачи, переписка ждёт ответа.
  "curator": { actor: CURATOR, profile: profile(), draft: draft({ handoff: { ...HANDOFF_ACCEPTED, canRespond: true } }), sales: null, work: work() },
  // Admin по делу, связанному с лидом: контакты, доступ к порталу, продажа, оплата, «Данные продажи».
  "admin": { actor: ADMIN, profile: profile({ leadId: LEAD_ID, email: "student@example.invalid", phone: "+996 000 000 001" }),
    draft: draft({ finance: true, contract: true, paidPercent: 40, paid: "600 $", remaining: "900 $", saleConditions: SALE_CONDITIONS,
      studentApplication: { id: uuid("11111111", 1), status: "approved", revision: 1, email: "student@example.invalid", questionnaire: {},
        submittedAt: "2026-08-20T04:00:00.000Z", decidedAt: "2026-08-21T04:00:00.000Z", decisionReason: null, studentCaseId: CASE_ID,
        admissionsDirection: "CN", canonicalLeadId: LEAD_ID } }),
    sales: SALES, work: work({ chat: CHAT.awaiting }) },
  // Строка очереди не прочитана, задачи недоступны, переписка закрыта правами — всё названо, ничего не выдумано.
  "unread": { actor: CURATOR, profile: profile(), draft: draft({ documents: false }), sales: null,
    work: work({ row: null, tasks: { kind: "unavailable" }, chat: { kind: "forbidden" } }) },
  // Закрытое дело: шаг не меняется, задач нет.
  "closed": { actor: CURATOR, profile: profile({ state: "closed" }), draft: draft({ state: "closed" }), sales: null,
    work: work({ row: queueRow({ state: "closed", flags: [] }), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null } }) },
};

function buildParts(name) {
  const item = SCENARIOS[name];
  const hrefFor = (tab) => `${buildV3ProfileHref({ leadId: null, studentCaseId: CASE_ID }, tab)}&returnTo=${encodeURIComponent(RETURN_TO)}`;
  const editor = { admin: item.actor.systemRole === "admin", preview: false, routeManage: item.actor.permissionKeys.includes("case.route.manage"), broadScope: false };
  const parts = caseWorkParts({
    actor: item.actor, profile: item.profile, draft: item.draft, sales: item.sales, work: item.work,
    stepAccess: item.work.row ? queueView.nextStepAccess(editor, item.work.row, []) : { kind: "read_only", reason: null },
    requestIds: {
      contract: uuid("12121212", 1), firstPayment: uuid("12121212", 2), override: uuid("12121212", 3), handoff: uuid("12121212", 4),
      platformAccess: uuid("12121212", 5), saleConditions: uuid("12121212", 6), prepareLeadCabinet: uuid("12121212", 7),
      wishesCard: uuid("12121212", 8), educationCard: uuid("12121212", 9), conditionsCard: uuid("12121212", 10),
      step: uuid("12121212", 11), assignCurator: uuid("12121212", 12), portal: uuid("12121212", 13), note: uuid("12121212", 14),
    },
    notes: NOTES, notesOlderHref: null, notesLatestHref: null, curators: [], curatorsAvailable: true, hrefFor,
    salesDataOpen: false, help: null,
  });
  return { item, parts, hrefFor };
}

function caseBody(name) {
  const { item, parts, hrefFor } = buildParts(name);
  return createElement(Profile, {
    profile: item.profile, draft: item.draft, sales: item.sales, actor: item.actor, organizationId: ORG,
    studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds: { contract: "", firstPayment: "", override: "", handoff: "", platformAccess: "", saleConditions: "", prepareLeadCabinet: "", wishesCard: "", educationCard: "", conditionsCard: "" },
    noteRequestId: uuid("12121212", 15), notes: NOTES, notesOlderHref: null, notesLatestHref: null,
    tab: "overview", hrefFor, caseHeader: parts.header, caseOverview: parts.overview,
  });
}

// --- рендер ------------------------------------------------------------------
const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const SEARCH = `case=${CASE_ID}&tab=overview&returnTo=${encodeURIComponent(RETURN_TO)}`;

function withContexts(node) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(SEARCH) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

function renderWorkspace(name) {
  return renderToStaticMarkup(withContexts(caseBody(name)));
}

function renderPage(name) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const back = createElement("a", { href: RETURN_TO, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "Студенты");
  const page = createElement("div", { className: "v3-world", "data-look": process.argv.includes("--look=next") ? "next" : undefined },
    createElement(AppShell, { actor: SCENARIOS[name].actor, initialNotifications: null },
      createElement(PartShell, { title: NAME, count: null, dense: true, back }, createElement("div", { className: "space-y-6" }, caseBody(name)))));
  return renderToStaticMarkup(withContexts(page));
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

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const look = process.argv.includes("--look=next") ? "case-next" : "case";
  const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const REFLOW = { viewport: { width: 320, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  // [сценарий, [снимок, контекст, во весь рост, действие]]
  const pages = [
    ["curator-accept", [["1440", DESKTOP, false, null], ["1440-full", DESKTOP, true, null], ["1280", LAPTOP, false, null], ["390", PHONE, false, null], ["390-full", PHONE, true, null]]],
    ["curator", [["1440", DESKTOP, false, null], ["1440-full", DESKTOP, true, null], ["1280", LAPTOP, false, null], ["390", PHONE, false, null], ["320-full", REFLOW, true, null], ["step-1440", DESKTOP, false, "step"], ["step-390", PHONE, false, "step"]]],
    ["admin", [["1440", DESKTOP, false, null], ["1440-full", DESKTOP, true, null], ["1280", LAPTOP, false, null], ["390-full", PHONE, true, null], ["portal-1440", DESKTOP, true, "portal"], ["sales-1440", DESKTOP, true, "sales"]]],
    ["unread", [["1440", DESKTOP, false, null]]],
    ["closed", [["1440", DESKTOP, false, null]]],
  ];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, shots] of pages) {
      const htmlPath = join(outDir, `${look}-${name}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Дело студента — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${renderPage(name)}</body></html>`,
      ].join(""));
      for (const [suffix, context, fullPage, step] of shots) {
        const file = `${look}-${name}-${suffix}.png`;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (step === "step") await page.click('[data-testid="v3-case-next-step"] button');
        // Раскрытие «Настроить» — клиентская кнопка; страница не гидратируется, поэтому снимок открывает её область сам.
        if (step === "portal") await page.evaluate(() => { document.querySelector('[data-testid="v3-case-portal"] [data-case-disclosure]').hidden = false; });
        if (step === "sales") await page.click('[data-testid="v3-case-sales-data"] > summary');
        if (step) await page.waitForTimeout(300);
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => {
          const top = (selector) => {
            const element = document.querySelector(selector);
            return element ? Math.round(element.getBoundingClientRect().top + window.scrollY) : null;
          };
          const overview = document.querySelector('[data-testid="v3-case-overview"]');
          const firstTask = document.querySelector('[data-testid="v3-case-tasks"] [data-queue-row]');
          return {
            pageHeight: document.documentElement.scrollHeight,
            overviewHeight: overview ? Math.round(overview.getBoundingClientRect().height) : null,
            h1: top("main h1"),
            facts: top('[data-testid="v3-case-header"] dl'),
            step: top('[data-testid="v3-case-next-step"]'),
            nextHeading: top("#case-next-title"),
            firstTaskBottom: firstTask ? Math.round(firstTask.getBoundingClientRect().bottom + window.scrollY) : null,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            // Видно на странице: содержимое свёрнутого <details> и закрытого окна не считается.
            solidRed: [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility()
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
            smallText: [...document.querySelectorAll("main *")].filter((element) => element.checkVisibility()
              && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
              && parseFloat(getComputedStyle(element).fontSize) < 12).length,
            smallTargets: [...document.querySelectorAll("main a, main button, main summary")].filter((element) => {
              const box = element.getBoundingClientRect();
              return element.checkVisibility() && box.height < 24;
            }).length,
            popoverOpen: [...document.querySelectorAll("[popover]")].some((element) => element.matches(":popover-open")),
          };
        });
        await page.screenshot({ path: join(outDir, file), fullPage });
        const facts = Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ");
        process.stdout.write(`${file}: ${facts}\n`);
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
  console.error("usage: case-static-render.cjs --json | --screenshots [outDir] [--look=next]");
  process.exit(2);
}
