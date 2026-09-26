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
 *   node tests/e2e/case-static-render.cjs --screenshots [outDir] [--look=next] [--compare-root=<dir>]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844 в outDir (по умолчанию .impeccable/review,
 *       не коммитится); с `--look=next` — предпросмотр нового облика (Э1.1),
 *       файлы `case-next-*.png`. Страница не гидратируется: окно шага и
 *       раскрытия работают на атрибутах браузера (popover, details).
 *
 *     Снимок делается после загрузки картинок (логотип next/image — lazy) и
 *     шрифтов. Во весь рост меню разделов на время снимка статично: иначе
 *     липкая колонка высотой в экран обрывается на 900 px. Раскрытые разделы
 *     («Настроить», «Данные продажи») снимаются экраном, прокрученным к
 *     разделу, и во весь рост.
 *
 *     Вид лида (`?id=…`, Э4 — позже) рендерится тем же `Profile` без частей
 *     дела (без «Заявок с сайта» — это отдельное чтение): `case-lead-1440.png`.
 *     С `--compare-root=<dir>` (дерево другой ревизии со ссылкой node_modules,
 *     например `git archive origin/main src public/brand`) тот же вид лида
 *     рендерится и из него — `case-lead-main-1440.png`; разметка и пиксели
 *     сравниваются побайтно, отличия разметки названы в выводе.
 */

const { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const compareArg = process.argv.find((arg) => arg.startsWith("--compare-root="));
const COMPARE_ROOT = compareArg ? realpathSync(resolve(compareArg.slice("--compare-root=".length))) : null;

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
    // Модули дерева сравнения берут `@/` из своего дерева, а не из этой ветки.
    const parent = rest[0];
    const root = COMPARE_ROOT && parent?.filename?.startsWith(`${COMPARE_ROOT}/`) ? COMPARE_ROOT : ROOT;
    const base = join(root, "src", request.slice(2));
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
const closureUi = require(join(ROOT, "src/components/v3/closure/Closure.tsx"));
const { ClosedLeadView } = require(join(ROOT, "src/components/v3/closure/ClosedLeadView.tsx"));

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
// Куратор отклонил назначение с причиной; отвечать может только он — Admin видит ответ целиком.
const HANDOFF_DECLINED = {
  ...HANDOFF_PENDING, canRespond: false,
  current: { acknowledgementId: uuid("33333333", 2), decision: "declined", clarification: "Нагрузка выше нормы до конца октября, прошу назначить другого куратора.",
    agreedContactDate: null, createdAt: "2026-09-21T04:00:00.000Z" },
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
  // Полоса «Передача» (Э2): то, что вернуло бы staff_lead_handoff_strip_v1 для этого лида.
  strip: { status: "available", strip: {
    leadId: LEAD_ID, stage: "handed_off", handoff: { completedAt: "2026-08-30T06:00:00.000Z", evidence: "handoff" },
    contract: { confirmed: true, confirmedAt: "2026-08-28T05:00:00.000Z" }, firstPayment: { receivedDate: "2026-08-30" },
    report: { status: "available", record: { id: uuid("12341234", 1), reportMonth: "2026-08-01", saleDate: "2026-08-28", archived: false } },
    curator: { displayName: "Айгүл Осмонова", assignedAt: "2026-08-30T06:05:00.000Z" },
    acceptance: { decision: "accepted", at: "2026-09-21T04:00:00.000Z" },
  } },
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
  // «⋯» у заголовка — «Завершить дело» (246): сервер подсказал право.
  "curator": { actor: CURATOR, profile: profile(), draft: draft({ handoff: { ...HANDOFF_ACCEPTED, canRespond: true } }), sales: null, work: work(),
    closure: { studentCaseId: CASE_ID, state: "active", admissionsVersion: "4", closedAt: null, outcome: null, note: null, closedByName: null, canChange: true } },
  // Admin по делу, связанному с лидом: контакты, доступ к порталу, продажа, оплата, «Данные продажи».
  "admin": { actor: ADMIN, profile: profile({ leadId: LEAD_ID, email: "student@example.invalid", phone: "+996 000 000 001" }),
    draft: draft({ finance: true, contract: true, paidPercent: 40, paid: "600 $", remaining: "900 $", saleConditions: SALE_CONDITIONS,
      studentApplication: { id: uuid("11111111", 1), status: "approved", revision: 1, email: "student@example.invalid", questionnaire: {},
        submittedAt: "2026-08-20T04:00:00.000Z", decidedAt: "2026-08-21T04:00:00.000Z", decisionReason: null, studentCaseId: CASE_ID,
        admissionsDirection: "CN", canonicalLeadId: LEAD_ID } }),
    sales: SALES, work: work({ chat: CHAT.awaiting }) },
  // Admin после отказа куратора: в «Сведениях» — решение и причина отказа (ответить может только куратор).
  "admin-declined": { actor: ADMIN, profile: profile(), draft: draft({ handoff: HANDOFF_DECLINED }), sales: null, work: work() },
  // Строка очереди не прочитана, задачи недоступны, переписка закрыта правами — всё названо, ничего не выдумано.
  "unread": { actor: CURATOR, profile: profile(), draft: draft({ documents: false }), sales: null,
    work: work({ row: null, tasks: { kind: "unavailable" }, chat: { kind: "forbidden" } }) },
  // Закрытое дело: шаг не меняется, задач нет.
  "closed": { actor: CURATOR, profile: profile({ state: "closed" }), draft: draft({ state: "closed" }), sales: null,
    work: work({ row: queueRow({ state: "closed", flags: [] }), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null } }) },
  // Дело завершено с исходом (246): в строке фактов «Закрыто · Поступил · дата · Вернуть в работу».
  "closed-outcome": { actor: CURATOR, profile: profile({ state: "closed" }), draft: draft({ state: "closed" }), sales: null,
    work: work({ row: queueRow({ state: "closed", flags: [] }), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null } }),
    closure: { studentCaseId: CASE_ID, state: "closed", admissionsVersion: "6", closedAt: "2026-09-22T06:30:00.000Z", outcome: "enrolled", note: null,
      closedByName: "Айгүл Осмонова", canChange: true } },
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
    salesDataOpen: false, help: null, closure: item.closure ?? null,
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
// `--look=next`: слой нового облика и его оболочка Э1.2 (меню без верхней панели,
// нижняя панель телефона) — как у Admin с включённым переключателем.
const NEXT_LOOK = process.argv.includes("--look=next");
const NEXT_SHELL = NEXT_LOOK ? { look: "next" } : {};
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

function renderPage(name, { closeDialog = false } = {}) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const back = createElement("a", { href: RETURN_TO, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "Студенты");
  // «⋯» у заголовка — как в page.tsx: дело в работе и сервер подсказал право (246).
  const closure = SCENARIOS[name].closure;
  // Открытые задачи «Обзора» — число для окна «Завершить дело», как в page.tsx.
  const tasks = SCENARIOS[name].work.tasks;
  const openTasks = tasks.kind === "ready" ? tasks.tasks.length : null;
  const action = closure?.state === "active" && closure.canChange
    ? createElement(closureUi.CloseRecordMenu, { kind: "case", subjectId: CASE_ID, subjectName: NAME, expectedVersion: closure.admissionsVersion, openTasks })
    : undefined;
  // Окно «Завершить дело» — то же, что открывает пункт меню; страница не гидратируется, снимок поднимает его `showModal()`.
  const dialog = closeDialog
    ? createElement(closureUi.ClosureDialog, { kind: "case", subjectId: CASE_ID, subjectName: NAME, expectedVersion: "4", openTasks, onClose() {}, onDone() {} })
    : null;
  const page = createElement("div", { className: "v3-world", "data-look": NEXT_LOOK ? "next" : undefined },
    createElement(AppShell, { actor: SCENARIOS[name].actor, initialNotifications: null, ...NEXT_SHELL },
      createElement(PartShell, { title: NAME, count: null, dense: true, back, action }, createElement("div", { className: "space-y-6" }, caseBody(name)))), dialog);
  return renderToStaticMarkup(withContexts(page));
}

// Lead 360 закрытого лида (246), как в page.tsx: имя — заголовок, возврат «К закрытым лидам» над ним
// (пришли из «Закрытых»), строка «Закрыт · причина · дата», «Вернуть в работу» и почему нет контактов.
function renderClosedLeadPage() {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const row = { leadId: LEAD_ID, name: NAME, ownerName: "Эрмек Токтосунов", stageKey: "qualified", workflowVersion: "5",
    closedAt: "2026-09-24T09:15:00.000Z", reason: "other_agency", note: null, closedByName: "Эрмек Токтосунов", canManage: true };
  const back = createElement("a", { href: "/v3/pipeline?view=closed", className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "К закрытым лидам");
  const page = createElement("div", { className: "v3-world", "data-look": NEXT_LOOK ? "next" : undefined },
    createElement(AppShell, { actor: ADMIN, initialNotifications: null, ...NEXT_SHELL },
      createElement(PartShell, { title: row.name, count: null, back },
        createElement("div", { className: "space-y-6" },
          createElement(ClosedLeadView, { row, readOnly: false })))));
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(`id=${LEAD_ID}`) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, page)))));
}

// --- вид лида (`?id=…`): тот же Profile без частей дела ----------------------
// Лид после продажи с передачей в поступление: «Продажи», проверка договора,
// условия продажи — та же часть SalesOverview, что на деле уходит в «Данные продажи».
const LEAD = {
  actor: ADMIN,
  profile: { ...profile({ leadId: LEAD_ID, email: "student@example.invalid", phone: "+996 000 000 001" }),
    student: false, stage: "won", caseStatus: null, source: "Сайт", nextAction: "Передано в поступление" },
  draft: { ...draft({ documents: false, saleConditions: SALE_CONDITIONS }), routeTarget: { leadId: LEAD_ID, studentCaseId: null },
    admissions: null, handoffAcknowledgement: null },
  sales: SALES,
};

// Разметка страницы лида как в page.tsx: «Профиль», ссылка к списку, Profile без caseHeader/caseOverview.
function renderLeadPage(root) {
  const { AppShell } = require(join(root, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(root, "src/components/v3/PartShell.tsx"));
  const { Profile: RootProfile } = require(join(root, "src/components/v3/profile/Profile.tsx"));
  const { buildV3ProfileHref: rootHref } = require(join(root, "src/components/v3/profile/types.ts"));
  const hrefFor = (tab) => rootHref({ leadId: LEAD_ID, studentCaseId: null }, tab);
  const body = createElement("div", { className: "space-y-6" },
    createElement("a", { href: "/v3/profile", className: "inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline" }, "К списку студентов"),
    createElement(RootProfile, {
      profile: LEAD.profile, draft: LEAD.draft, sales: LEAD.sales, actor: LEAD.actor, organizationId: ORG,
      studentPortalCurators: [], studentPortalCuratorsAvailable: true,
      requestIds: { contract: uuid("13131313", 1), firstPayment: uuid("13131313", 2), override: uuid("13131313", 3), handoff: uuid("13131313", 4),
        platformAccess: uuid("13131313", 5), saleConditions: uuid("13131313", 6), prepareLeadCabinet: uuid("13131313", 7),
        wishesCard: uuid("13131313", 8), educationCard: uuid("13131313", 9), conditionsCard: uuid("13131313", 10) },
      noteRequestId: uuid("13131313", 11), notes: { ...NOTES, subject: { leadId: LEAD_ID, studentCaseId: null } },
      notesOlderHref: null, notesLatestHref: null, tab: "overview", hrefFor,
      // «⋯» лида (246), как в page.tsx; дерево сравнения без него (`headerMenu` там не существует).
      headerMenu: root === ROOT ? createElement(closureUi.CloseRecordMenu, { kind: "lead", subjectId: LEAD_ID, subjectName: LEAD.profile.person,
        expectedVersion: LEAD.sales.lead.workflowVersion, blockedReason: null }) : undefined,
    }));
  // Оболочка нового облика (Э1.2) — только у этой ветки: дерево сравнения рендерится, как раньше.
  const page = createElement("div", { className: "v3-world", "data-look": NEXT_LOOK ? "next" : undefined },
    createElement(AppShell, { actor: LEAD.actor, initialNotifications: null, ...(root === ROOT ? NEXT_SHELL : {}) },
      createElement(PartShell, { title: "Профиль", count: null }, body)));
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(`id=${LEAD_ID}&tab=overview`) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, page)))));
}

async function compileCss(root = ROOT) {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(root, "src/app/globals.css");
  const result = await postcss([tailwind({ base: root, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(root, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

function writeHtml(path, title, css, markup) {
  writeFileSync(path, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
    `<body class="min-h-full">${markup}</body></html>`,
  ].join(""));
}

// Снимок только после того, как видно всё: шрифты и картинки (логотип next/image грузится lazy
// и событие load не ждёт его). Картинка без пикселей — ошибка снимка, а не пустое место.
async function settle(page) {
  await page.waitForLoadState("networkidle");
  const broken = await page.evaluate(async () => {
    await document.fonts.ready;
    // Только видимые: скрытая копия логотипа (lazy) в оболочке нового облика не грузится, и её decode() не завершится.
    const images = [...document.images].filter((image) => image.checkVisibility());
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
    return images.filter((image) => !(image.complete && image.naturalWidth > 0)).map((image) => image.alt || image.src);
  });
  if (broken.length) throw new Error(`images not loaded: ${broken.join(", ")}`);
}

// Только на время снимка во весь рост: меню разделов (липкое, высотой в экран) — обычная колонка во всю высоту.
const STATIC_NAV = 'nav[aria-label="Разделы"] { position: static !important; height: auto !important; }';

async function scrollToTop(page, selector) {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`no ${target}`);
    window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 16), behavior: "instant" });
  }, selector);
}

// Клавиатурный фокус: Tab делает последний ввод клавиатурным, фокус на цели — с видимой рамкой (:focus-visible).
async function keyboardFocus(page, selector) {
  await page.keyboard.press("Tab");
  await page.focus(selector);
  const visible = await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);
  if (!visible) throw new Error(`focus ring not visible on ${selector}`);
}

/**
 * Отличия разметки этой ветки от дерева сравнения: вставки (`+…`) и место,
 * где совпадение не восстановилось. Пусто — разметка побайтно та же.
 */
function markupDifferences(ours, theirs) {
  const out = [];
  let i = 0;
  let j = 0;
  while ((i < ours.length || j < theirs.length) && out.length < 5) {
    if (ours[i] === theirs[j]) { i += 1; j += 1; continue; }
    const resume = ours.indexOf(theirs.slice(j, j + 40), i);
    if (j >= theirs.length || resume < 0) {
      out.push(`at ${i}: ours ${JSON.stringify(ours.slice(i, i + 60))} theirs ${JSON.stringify(theirs.slice(j, j + 60))}`);
      break;
    }
    out.push(`+${JSON.stringify(ours.slice(i, resume))}`);
    i = resume;
  }
  return out;
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
  const SIZES = { 1440: DESKTOP, 1280: LAPTOP, 390: PHONE, 320: REFLOW };
  // Снимок: `ширина[-full]` — экран или во весь рост; `do` — действие до снимка; `at` — прокрутить экран к разделу.
  const shot = (suffix, extra = {}) => {
    const [width, full] = suffix.replace(/^[a-z-]+-(?=\d)/u, "").split("-");
    return { suffix, context: SIZES[width], full: full === "full", ...extra };
  };
  const PORTAL = { do: "portal", at: '[data-testid="v3-case-portal"]' };
  const SALES = { do: "sales", at: '[data-testid="v3-case-sales-data"]' };
  const CASE_PAGES = [
    ["curator-accept", ["1440", "1440-full", "1280", "390", "390-full"].map((suffix) => shot(suffix))],
    ["curator", [
      ...["1440", "1440-full", "1280", "390", "320-full"].map((suffix) => shot(suffix)),
      ...["step-1440", "step-1280", "step-390"].map((suffix) => shot(suffix, { do: "step" })),
      shot("focus-1440", { do: "focus", focus: '[data-testid="v3-case-next-step"] button' }),
      shot("focus-task-1440", { do: "focus", focus: '[data-testid="v3-case-tasks"] button[aria-label^="Завершить"]' }),
      shot("focus-tab-1440", { do: "focus", focus: 'nav[aria-label="Разделы профиля"] a[aria-current="page"]' }),
    ]],
    ["admin", [
      ...["1440", "1440-full", "1280", "390-full"].map((suffix) => shot(suffix)),
      ...["portal-1440", "portal-1280", "portal-1280-full", "portal-390", "portal-390-full"].map((suffix) => shot(suffix, PORTAL)),
      ...["sales-1440", "sales-1440-full", "sales-1280", "sales-1280-full", "sales-390", "sales-390-full"].map((suffix) => shot(suffix, SALES)),
    ]],
    ["admin-declined", ["1440", "390-full"].map((suffix) => shot(suffix))],
    ["unread", ["1440", "1280", "390", "390-full"].map((suffix) => shot(suffix))],
    ["closed", ["1440", "1280", "390", "390-full"].map((suffix) => shot(suffix))],
  ];
  const css = await compileCss();
  const pages = CASE_PAGES.map(([name, shots]) => {
    const htmlPath = join(outDir, `${look}-${name}.html`);
    writeHtml(htmlPath, "Дело студента", css, renderPage(name));
    return { name, htmlPath, shots };
  });
  // Вид лида этой ветки и, если дано, дерева сравнения — те же данные, тот же снимок.
  const leadShots = ["1440", "1440-full"].map((suffix) => shot(suffix));
  const leadMarkup = renderLeadPage(ROOT);
  pages.push({ name: "lead", htmlPath: join(outDir, `${look}-lead.html`), shots: leadShots });
  writeHtml(pages.at(-1).htmlPath, "Профиль", css, leadMarkup);
  // Закрытие (246): окно «Завершить дело», дело с исходом, закрытый Lead 360 — файлы `close-*.png`
  // (новый облик — `close-next-*.png`).
  {
    const close = look === "case" ? "close" : "close-next";
    const dialogPage = { name: `${close}-case-360`, prefix: null, htmlPath: join(outDir, `${close}-case-360.html`),
      shots: [shot("1440"), shot("dialog-1440", { do: "close-dialog" }), shot("dialog-390", { do: "close-dialog" })] };
    writeHtml(dialogPage.htmlPath, "Дело студента", css, renderPage("curator", { closeDialog: true }));
    const closedPage = { name: `${close}-case-360-closed`, prefix: null, htmlPath: join(outDir, `${close}-case-360-closed.html`),
      shots: [shot("1440"), shot("390"), shot("focus-1440", { do: "focus", focus: '[data-testid="v3-case-closed-line"] button' })] };
    writeHtml(closedPage.htmlPath, "Дело студента", css, renderPage("closed-outcome"));
    const leadPage = { name: `${close}-lead-360`, prefix: null, htmlPath: join(outDir, `${close}-lead-360.html`), shots: [shot("1440"), shot("390")] };
    writeHtml(leadPage.htmlPath, "Профиль", css, leadMarkup);
    const leadClosedPage = { name: `${close}-lead-360-closed`, prefix: null, htmlPath: join(outDir, `${close}-lead-360-closed.html`),
      shots: [shot("1440"), shot("390")] };
    writeHtml(leadClosedPage.htmlPath, "Профиль", css, renderClosedLeadPage());
    pages.push(dialogPage, closedPage, leadPage, leadClosedPage);
  }
  let compareMarkup = null;
  if (COMPARE_ROOT) {
    compareMarkup = renderLeadPage(COMPARE_ROOT);
    pages.push({ name: "lead-main", htmlPath: join(outDir, `${look}-lead-main.html`), shots: leadShots });
    writeHtml(pages.at(-1).htmlPath, "Профиль", await compileCss(COMPARE_ROOT), compareMarkup);
  }
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const captured = new Map();
  try {
    // `--only=имя,имя` — снять только эти страницы (например, `--only=close-case-360,close-lead-360`).
    const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",") ?? null;
    for (const { name, htmlPath, shots, prefix = look } of pages.filter((one) => only === null || only.includes(one.name))) {
      for (const { suffix, context, full, do: action, at, focus } of shots) {
        const file = prefix === null ? `${name}-${suffix}.png` : `${prefix}-${name}-${suffix}.png`;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await settle(page);
        if (action === "step") await page.click('[data-testid="v3-case-next-step"] button');
        // Раскрытие «Настроить» — клиентская кнопка; страница не гидратируется, поэтому снимок открывает её область сам
        // (как сделал бы клик: область видна, кнопка называет обратное действие и `aria-expanded`).
        if (action === "portal") {
          await page.evaluate(() => {
            const region = document.querySelector('[data-testid="v3-case-portal"] [data-case-disclosure]');
            const toggle = document.querySelector(`[aria-controls="${CSS.escape(region.id)}"]`);
            region.hidden = false;
            toggle.setAttribute("aria-expanded", "true");
            toggle.textContent = "Свернуть";
          });
        }
        if (action === "sales") await page.click('[data-testid="v3-case-sales-data"] > summary');
        if (action === "close-dialog") {
          // Окно в верхнем слое, исход «Поступил» выбран — как после щелчка по «Завершить дело…».
          await page.evaluate(() => {
            const dialog = document.querySelector('[data-testid="v3-close-case-dialog"]');
            dialog.showModal();
            dialog.querySelector('input[value="enrolled"]').checked = true;
          });
        }
        if (action === "focus") await keyboardFocus(page, focus);
        if (full) {
          await page.addStyleTag({ content: STATIC_NAV });
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        } else if (at) {
          await scrollToTop(page, at);
        }
        if (action) await page.waitForTimeout(300);
        await settle(page);
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => {
          const top = (selector) => {
            const element = document.querySelector(selector);
            return element ? Math.round(element.getBoundingClientRect().top + window.scrollY) : null;
          };
          const overview = document.querySelector('[data-testid="v3-case-overview"]');
          const firstTask = document.querySelector('[data-testid="v3-case-tasks"] [data-queue-row]');
          const nav = document.querySelector('nav[aria-label="Разделы"]');
          const popover = [...document.querySelectorAll("[popover]")].find((element) => element.matches(":popover-open"));
          const facts = document.querySelector('[data-testid="v3-case-facts"]');
          const box = (element) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return `${Math.round(rect.left)},${Math.round(rect.top + window.scrollY)}→${Math.round(rect.right)},${Math.round(rect.bottom + window.scrollY)}`;
          };
          return {
            pageHeight: document.documentElement.scrollHeight,
            scrollY: Math.round(window.scrollY),
            navHeight: nav ? Math.round(nav.getBoundingClientRect().height) : null,
            overviewHeight: overview ? Math.round(overview.getBoundingClientRect().height) : null,
            h1: top("main h1"),
            facts: top('[data-testid="v3-case-header"] dl'),
            step: top('[data-testid="v3-case-next-step"]'),
            nextHeading: top("#case-next-title"),
            factsColumn: box(facts),
            firstTaskBottom: firstTask ? Math.round(firstTask.getBoundingClientRect().bottom + window.scrollY) : null,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            // Видно на странице: содержимое свёрнутого <details> и закрытого окна не считается.
            solidRed: [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility()
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
            smallText: [...document.querySelectorAll("main *")].filter((element) => element.checkVisibility()
              && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
              && parseFloat(getComputedStyle(element).fontSize) < 12).length,
            smallTargets: [...document.querySelectorAll("main a, main button, main summary")].filter((element) => {
              const rect = element.getBoundingClientRect();
              return element.checkVisibility() && rect.height < 24;
            }).length,
            popoverOpen: Boolean(popover),
            popoverTopLayer: popover ? popover.matches(":popover-open") && getComputedStyle(popover).position === "fixed" : null,
            popoverBox: box(popover),
            // «Вернуть в работу» закрытого дела: рамка фокуса (outline наружу) не ложится на строку закрытия над кнопкой.
            closedRingGap: (() => {
              const button = document.activeElement;
              const run = button?.closest('[data-testid="v3-case-closed-line"]')?.querySelector("p");
              if (!run || button === document.body) return null;
              const style = getComputedStyle(button);
              return Math.round(button.getBoundingClientRect().top - parseFloat(style.outlineOffset) - parseFloat(style.outlineWidth) - run.getBoundingClientRect().bottom);
            })(),
            focused: document.activeElement && document.activeElement !== document.body
              ? `${document.activeElement.tagName.toLowerCase()}:${(document.activeElement.getAttribute("aria-label") ?? document.activeElement.textContent).trim().slice(0, 40)}` : null,
          };
        });
        const buffer = await page.screenshot({ path: join(outDir, file), fullPage: full });
        captured.set(`${name}-${suffix}`, buffer);
        const facts = Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ");
        process.stdout.write(`${file}: ${facts}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (compareMarkup !== null) {
    const same = (suffix) => captured.get(`lead-${suffix}`)?.equals(captured.get(`lead-main-${suffix}`) ?? Buffer.alloc(0)) ?? false;
    // Путь к файлу логотипа у деревьев разный; сравнивается остальная разметка. Отличия названы.
    const differences = markupDifferences(leadMarkup, compareMarkup.replaceAll(pathToFileURL(COMPARE_ROOT).href, pathToFileURL(ROOT).href));
    process.stdout.write(`lead view vs ${COMPARE_ROOT}: markup ${differences.length ? `differs: ${differences.join(" ")}` : "identical"}; `
      + `pixels 1440 ${same("1440") ? "identical" : "DIFFERENT"}, 1440-full ${same("1440-full") ? "identical" : "DIFFERENT"}\n`);
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
  console.error("usage: case-static-render.cjs --json | --screenshots [outDir] [--look=next] [--only=page,…]");
  process.exit(2);
}
