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
 *   node tests/e2e/case-static-render.cjs --screenshots [outDir] [--compare-root=<dir>]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844 в outDir (по умолчанию .impeccable/review,
 *       не коммитится), файлы `case-*.png`. Страница не гидратируется: окно шага и
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
const { placeMenu } = require(join(ROOT, "src/components/v3/board/menu-position.ts"));

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

// Пункты чек-листа (синтетические названия требований). Решение проверки — у принятых и
// «нужно исправить»: из них лента Student 360 (Э4) берёт события документов с датой проверки.
const DOC_NAMES = ["Паспорт", "Аттестат", "Перевод аттестата", "Фото 3×4", "Свидетельство о рождении", "Сертификат IELTS",
  "Рекомендательное письмо", "Мотивационное письмо", "Медицинская справка", "План обучения", "Справка о несудимости", "Выписка из банка"];
const REVIEWED_AT = { 1: "2026-09-05T05:20:00.000Z", 2: "2026-09-08T08:40:00.000Z", 3: "2026-09-10T06:00:00.000Z", 4: "2026-09-10T06:05:00.000Z",
  5: "2026-09-15T10:30:00.000Z", 6: "2026-09-17T04:15:00.000Z", 7: "2026-09-19T09:00:00.000Z", 10: "2026-09-20T07:45:00.000Z" };
function docItem(n, status) {
  const reviewed = status === "approved" || status === "correction_required";
  return {
    id: uuid("88888888", n), name: DOC_NAMES[n - 1], groupLabel: "Документы", intentKind: "baseline", version: 1, status,
    uploadRequestId: null, metadataRequestId: null, removalRequestId: null, caseLinkTargets: [],
    presence: status === "required" ? "absent" : "present", currentVersionId: status === "required" ? null : uuid("77777777", n),
    downloadReady: false, currentVersionNumber: 1, currentFilename: `document-${n}.pdf`, reviewRequestId: null,
    latestReview: reviewed ? { decision: status, reason: status === "correction_required" ? "Нужна страница с печатью." : null,
      reviewerMembershipId: ME, reviewerDisplayName: "Айгүл Осмонова", reviewedAt: REVIEWED_AT[n] } : null,
  };
}
const DOCUMENTS = [{ kind: "active", title: "Документы", items: [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => docItem(n, "approved")), docItem(8, "submitted"), docItem(9, "submitted"),
  docItem(10, "correction_required"), docItem(11, "required"), docItem(12, "required"),
] }];

// Журнал дела (`staff_student_case_activity`, 132/241) — как его отдал бы readProfileActivity:
// задачи, записи сообщений и документы без времени в ленту не идут (их проверяет тест).
// `href` и `targetId` — как их строит readProfileActivity: у заявки — её id, у переписки — диалог во «Входящих».
function activityEvent(n, transition, targetKind, occurredAt, targetId = CASE_ID) {
  const href = targetKind === "conversation" ? `/v3/inbox?conversation=${targetId}` : `/v3/profile?case=${CASE_ID}&tab=${targetKind}`;
  return { id: uuid("abababab", n), transition, role: "", at: occurredAt ? "синтетика" : null, href, changedFields: [], targetKind, occurredAt, targetId };
}
const HANDOFF_EVENTS = [
  activityEvent(1, "case.curator.set", "overview", "2026-08-30T06:05:00.000Z"),
  activityEvent(2, "lead.admissions.handoff.completed", "overview", "2026-08-30T06:00:00.000Z"),
  activityEvent(3, "case.create", "overview", "2026-08-30T05:59:00.000Z"),
];
const ACTIVITY = { kind: "ready", olderThan: null, events: [
  activityEvent(10, "case.next.action.change", "overview", "2026-09-22T05:10:00.000Z"),
  activityEvent(11, "task.create", "task", "2026-09-21T09:00:00.000Z"),
  activityEvent(12, "case.handoff.acknowledge", "overview", "2026-09-21T04:00:00.000Z"),
  activityEvent(13, "communication.message.record", "conversation", "2026-09-19T12:00:00.000Z", uuid("67676767", 1)),
  // Заявки — `targetId` заявки из APPLICATIONS: строка называет вуз и программу.
  activityEvent(14, "application.status.change", "overview", "2026-09-18T09:30:00.000Z", uuid("66666666", 2)),
  activityEvent(15, "document.version.review", "documents", null),
  activityEvent(16, "application.create", "overview", "2026-09-10T04:20:00.000Z", uuid("66666666", 1)),
  ...HANDOFF_EVENTS,
] };
const ACTIVITY_AWAITING = { kind: "ready", olderThan: null, events: HANDOFF_EVENTS };
const HANDED_OFF_BY = { name: "Эрмек Токтосунов", at: "2026-08-30T06:00:00.000Z" };

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

// Куратор попросил уточнить у Sales, дело всё ещё ждёт приёма: ответ — в «Сведениях», «Принять дело» — у заголовка.
const HANDOFF_CLARIFIED = {
  ...HANDOFF_PENDING,
  current: { acknowledgementId: uuid("33333333", 3), decision: "clarification_requested", clarification: "Уточните, оплачен ли перевод аттестата.",
    agreedContactDate: null, createdAt: "2026-09-22T04:00:00.000Z" },
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
    profileFields: null, studentApplication: fields.studentApplication ?? null, profileFieldSources: [],
    documents: fields.documents === false ? [] : fields.documentGroups ?? DOCUMENTS,
    otherFiles: [], budget: null, currency: null, payments: [], paid: fields.paid ?? null, remaining: fields.remaining ?? null,
    paidPercent: fields.paidPercent ?? null,
    admissions: {
      studentCaseId: CASE_ID, caseState: fields.state ?? "active", isCabinetCase: false, direction: "CN", applications: APPLICATIONS,
      visa: null, finance: null,
      requestIds: { createApplication: uuid("22222222", 1), applications: {}, applicationDetails: {}, createStops: {}, resolveStops: {}, partnerDetails: {}, changeStatus: {} },
    },
    contract: null, handoffAcknowledgement: fields.handoff ?? HANDOFF_ACCEPTED, salesHandoffAcknowledgement: null,
    saleConditions: fields.saleConditions ?? null, leadCabinetCase: null, contractSignedAt: null,
    handedOffBy: fields.handedOffBy === undefined ? HANDED_OFF_BY : fields.handedOffBy,
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
    leadId: LEAD_ID, stage: "handed_off",
    handoff: { completedAt: "2026-08-30T06:00:00.000Z", evidence: "handoff", acceptanceRecordable: true },
    contract: { confirmed: true, confirmedAt: "2026-08-28T05:00:00.000Z" }, firstPayment: { receivedDate: "2026-08-30" },
    report: { status: "available", record: { id: uuid("12341234", 1), reportMonth: "2026-08-01", saleDate: "2026-08-28", archived: false,
      hasContractNumber: true, paid: { minor: 60000, currency: "USD" } } },
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
    activity: fields.activity ?? ACTIVITY,
    needsCurator: false, deletionRequested: fields.deletionRequested ?? false, today: TODAY, nowIso: NOW.toISOString(),
  };
}

// Закрытое дело: в журнале — «Состояние дела изменено» в момент закрытия.
const CLOSED_ACTIVITY = { ...ACTIVITY, events: [activityEvent(20, "case.lifecycle.change", "overview", "2026-09-22T06:30:00.000Z"), ...ACTIVITY.events] };

const SCENARIOS = {
  // Куратор открывает переданное ему дело: «Принять дело» — единственная красная кнопка.
  "curator-accept": { actor: CURATOR, profile: profile(), draft: draft({ handoff: HANDOFF_PENDING }), sales: null,
    work: work({ row: queueRow({ flags: ["overdue", "awaiting_ack"] }), activity: ACTIVITY_AWAITING }) },
  // Куратор уже ответил «Нужно уточнить»: дело по-прежнему ждёт приёма, ответ виден на странице.
  "curator-clarified": { actor: CURATOR, profile: profile(), draft: draft({ handoff: HANDOFF_CLARIFIED }), sales: null,
    work: work({ row: queueRow({ flags: ["overdue", "awaiting_ack"] }), activity: ACTIVITY_AWAITING }) },
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
    // Журнал длиннее страницы: на месте среза — строка со ссылкой на «Историю».
    sales: SALES, work: work({ chat: CHAT.awaiting, activity: { ...ACTIVITY, olderThan: "2026-08-30T05:59:00.000Z" } }),
    // «⋯» Admin: «Доступ к порталу» и «Завершить дело…» (сервер подсказал право).
    closure: { studentCaseId: CASE_ID, state: "active", admissionsVersion: "4", closedAt: null, outcome: null, note: null, closedByName: null, canChange: true } },
  // Admin после отказа куратора: в «Сведениях» — решение и причина отказа (ответить может только куратор).
  "admin-declined": { actor: ADMIN, profile: profile(), draft: draft({ handoff: HANDOFF_DECLINED }), sales: null,
    work: work({ activity: ACTIVITY_AWAITING }) },
  // Дело ждёт куратора: у того, кто назначает кураторов, «Назначить куратора» — прежняя форма в шапке.
  "needs-curator": { actor: ADMIN, profile: profile(), draft: { ...draft({ handoff: null }), responsible: null }, sales: null,
    work: { ...work({ row: queueRow({ flags: ["needs_curator"] }), activity: ACTIVITY_AWAITING }), needsCurator: true } },
  // Просмотр роли Admin: ничего не пишет — ни «Принять дело», ни задачи, ни заметки, даже если снимок ждёт ответа.
  "preview-awaiting": { actor: { ...ADMIN, presentationRole: "admissions" }, profile: profile(), draft: draft({ handoff: HANDOFF_PENDING }), sales: null,
    work: work({ row: queueRow({ flags: ["awaiting_ack"] }), activity: ACTIVITY_AWAITING }) },
  // Строка очереди не прочитана, задачи недоступны, переписка закрыта правами — всё названо, ничего не выдумано.
  // Журнал дела не прочитан: лента — заметки и строка о пробеле; дело не из продаж — «Передал» нет.
  "unread": { actor: CURATOR, profile: profile(), draft: draft({ documents: false, handedOffBy: null }), sales: null,
    work: work({ row: null, tasks: { kind: "unavailable" }, chat: { kind: "forbidden" }, activity: { kind: "unavailable" } }) },
  // Только что принятое дело без записей: журнал прочитан и пуст, заметок нет, в чек-листе ничего не проверено,
  // переписки нет — лента говорит «Заметок и событий пока нет.», а не рисует пустой список.
  "fresh": { actor: CURATOR, profile: profile(), draft: draft({ documentGroups: [{ kind: "active", title: "Документы", items: [docItem(1, "required"), docItem(2, "required")] }] }),
    sales: null, notes: { ...NOTES, rows: [] },
    work: work({ row: queueRow({ stage: "new", flags: [], due: null }), tasks: { kind: "ready", tasks: [], assignees: [] },
      chat: { kind: "ready", awaitState: "none", last: null }, activity: { kind: "ready", olderThan: null, events: [] } }) },
  // Более ранняя страница заметок: в ленте только заметки, событий нет (они — на первой странице).
  "notes-page": { actor: CURATOR, profile: profile(), draft: draft(), sales: null, work: work(),
    notesLatestHref: `/v3/profile?case=${CASE_ID}&tab=overview` },
  // Закрытое дело: шаг не меняется, задач нет.
  "closed": { actor: CURATOR, profile: profile({ state: "closed" }), draft: draft({ state: "closed" }), sales: null,
    work: work({ row: queueRow({ state: "closed", flags: [] }), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null },
      activity: CLOSED_ACTIVITY }) },
  // Дело завершено с исходом (246): в строке фактов «Закрыто · Поступил · дата · Вернуть в работу».
  "closed-outcome": { actor: CURATOR, profile: profile({ state: "closed" }), draft: draft({ state: "closed" }), sales: null,
    work: work({ row: queueRow({ state: "closed", flags: [] }), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null },
      activity: CLOSED_ACTIVITY }),
    closure: { studentCaseId: CASE_ID, state: "closed", admissionsVersion: "6", closedAt: "2026-09-22T06:30:00.000Z", outcome: "enrolled", note: null,
      closedByName: "Айгүл Осмонова", canChange: true } },
};

function buildParts(name) {
  const item = SCENARIOS[name];
  const hrefFor = (tab) => `${buildV3ProfileHref({ leadId: null, studentCaseId: CASE_ID }, tab)}&returnTo=${encodeURIComponent(RETURN_TO)}`;
  // Как `nextStepEditor` страницы: просмотр роли — Admin с ролью просмотра, он шаг не правит.
  const preview = item.actor.systemRole === "admin" && item.actor.presentationRole !== null;
  const editor = { admin: item.actor.systemRole === "admin" && !preview, preview, routeManage: item.actor.permissionKeys.includes("case.route.manage"), broadScope: false };
  const parts = caseWorkParts({
    actor: item.actor, profile: item.profile, draft: item.draft, sales: item.sales, work: item.work,
    stepAccess: item.work.row ? queueView.nextStepAccess(editor, item.work.row, []) : { kind: "read_only", reason: null },
    requestIds: {
      contract: uuid("12121212", 1), firstPayment: uuid("12121212", 2), override: uuid("12121212", 3), handoff: uuid("12121212", 4),
      platformAccess: uuid("12121212", 5), saleConditions: uuid("12121212", 6), prepareLeadCabinet: uuid("12121212", 7),
      wishesCard: uuid("12121212", 8), educationCard: uuid("12121212", 9), conditionsCard: uuid("12121212", 10),
      step: uuid("12121212", 11), assignCurator: uuid("12121212", 12), portal: uuid("12121212", 13), note: uuid("12121212", 14),
    },
    notes: item.notes ?? NOTES, notesOlderHref: null, notesLatestHref: item.notesLatestHref ?? null, curators: [], curatorsAvailable: true, hrefFor,
    salesDataOpen: false, help: null, closure: item.closure ?? null,
  });
  return { item, parts, hrefFor };
}

/** Тело страницы дела (`Profile` с шапкой и «Обзором») и действия у заголовка — как в page.tsx. */
function caseBody(name, tab = "overview") {
  const { item, parts, hrefFor } = buildParts(name);
  return { actions: parts.actions, body: createElement(Profile, {
    profile: item.profile, draft: item.draft, sales: item.sales, actor: item.actor, organizationId: ORG,
    studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds: { contract: "", firstPayment: "", override: "", handoff: "", platformAccess: "", saleConditions: "", prepareLeadCabinet: "", wishesCard: "", educationCard: "", conditionsCard: "" },
    noteRequestId: uuid("12121212", 15), notes: NOTES, notesOlderHref: null, notesLatestHref: null,
    tab, hrefFor, caseHeader: parts.header, caseOverview: parts.overview,
  }) };
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

// Разметка сценария: действия у заголовка (`data-testid="v3-case-actions"`), затем тело страницы.
function renderWorkspace(name, tab) {
  const { actions, body } = caseBody(name, tab);
  return renderToStaticMarkup(withContexts(createElement("div", null, actions, body)));
}

function renderPage(name, { closeDialog = false } = {}) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const back = createElement("a", { href: RETURN_TO, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "Студенты");
  // Действия у заголовка — как в page.tsx: `caseWorkParts(...).actions` (главное действие, «Написать»,
  // «Задача по делу», «⋯» с «Доступом к порталу» и «Завершить дело»).
  const { actions, body } = caseBody(name);
  // Открытые задачи «Обзора» — число для окна «Завершить дело», как в page.tsx.
  const tasks = SCENARIOS[name].work.tasks;
  const openTasks = tasks.kind === "ready" ? tasks.tasks.length : null;
  // Окно «Завершить дело» — то же, что открывает пункт меню; страница не гидратируется, снимок поднимает его `showModal()`.
  const dialog = closeDialog
    ? createElement(closureUi.ClosureDialog, { kind: "case", subjectId: CASE_ID, subjectName: NAME, expectedVersion: "4", openTasks, onClose() {}, onDone() {} })
    : null;
  const page = createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: SCENARIOS[name].actor, initialNotifications: null },
      createElement(PartShell, { title: NAME, count: null, dense: true, back, action: actions }, createElement("div", { className: "space-y-6" }, body))), dialog);
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
  const page = createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: ADMIN, initialNotifications: null },
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
  const page = createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: LEAD.actor, initialNotifications: null },
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
    // Только видимые: скрытая копия логотипа (lazy) в оболочке не грузится, и её decode() не завершится.
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
  const filePrefix = "case";
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
  // `--f3` — Student 360 (Э4): состояния дела, файлы `f3-<состояние>-<ширина>.png`;
  // «accept» — открытая панель «Принять дело».
  if (process.argv.includes("--f3")) {
    const F3 = [
      ["awaiting", "curator-accept", [...["1440", "1440-full", "1280", "1280-full", "390", "390-full"].map((suffix) => shot(suffix)),
        ...["accept-1440", "accept-390"].map((suffix) => shot(suffix, { do: "accept" }))]],
      // Review 27.09 (голова 5e0d0e95): ответ «Нужно уточнить» сохранён, дело всё ещё ждёт приёма.
      ["clarified", "curator-clarified", ["1440", "390-full"].map((suffix) => shot(suffix))],
      ["active", "curator", ["1440", "1440-full", "1280", "1280-full", "390", "390-full"].map((suffix) => shot(suffix))],
      ["closed", "closed-outcome", ["1440", "1440-full", "1280", "390", "390-full"].map((suffix) => shot(suffix))],
      // Review 27.09: Admin со всеми фактами (контакты, оплата, портал, продажа), открытые «⋯» и группы правки;
      // лента — строка о непрочитанном журнале, пустая, раскрытое «Показать ещё»; просмотр роли.
      ["admin", "admin", [...["1440", "1440-full", "1280-full", "390-full"].map((suffix) => shot(suffix)),
        shot("menu-1440", { do: "menu" }), shot("menu-390", { do: "menu" }),
        shot("portal-1440", PORTAL), shot("sales-1440-full", SALES),
        shot("more-1440-full", { do: "more" }), shot("more-1440", { do: "more", at: '[data-testid="v3-case-feed-more"]' })]],
      ["feed-unread", "unread", ["1440", "390-full"].map((suffix) => shot(suffix))],
      ["feed-empty", "fresh", ["1440", "390-full"].map((suffix) => shot(suffix))],
      ["preview", "preview-awaiting", ["1440", "1440-full", "390"].map((suffix) => shot(suffix))],
    ];
    const f3Pages = F3.map(([state, scenario, shots]) => {
      const htmlPath = join(outDir, `f3-${state}.html`);
      writeHtml(htmlPath, "Дело студента", css, renderPage(scenario));
      return { name: `f3-${state}`, prefix: null, htmlPath, shots };
    });
    return capture(f3Pages, outDir, filePrefix, null, null);
  }
  const pages = CASE_PAGES.map(([name, shots]) => {
    const htmlPath = join(outDir, `${filePrefix}-${name}.html`);
    writeHtml(htmlPath, "Дело студента", css, renderPage(name));
    return { name, htmlPath, shots };
  });
  // Вид лида этой ветки и, если дано, дерева сравнения — те же данные, тот же снимок.
  const leadShots = ["1440", "1440-full"].map((suffix) => shot(suffix));
  const leadMarkup = renderLeadPage(ROOT);
  pages.push({ name: "lead", htmlPath: join(outDir, `${filePrefix}-lead.html`), shots: leadShots });
  writeHtml(pages.at(-1).htmlPath, "Профиль", css, leadMarkup);
  // Закрытие (246): окно «Завершить дело», дело с исходом, закрытый Lead 360 — файлы `close-*.png`.
  {
    const close = "close";
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
    pages.push({ name: "lead-main", htmlPath: join(outDir, `${filePrefix}-lead-main.html`), shots: leadShots });
    writeHtml(pages.at(-1).htmlPath, "Профиль", await compileCss(COMPARE_ROOT), compareMarkup);
  }
  return capture(pages, outDir, filePrefix, compareMarkup, leadMarkup);
}

async function capture(pages, outDir, filePrefix, compareMarkup, leadMarkup) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const captured = new Map();
  try {
    // `--only=имя,имя` — снять только эти страницы (например, `--only=close-case-360,close-lead-360`).
    const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",") ?? null;
    for (const { name, htmlPath, shots, prefix = filePrefix } of pages.filter((one) => only === null || only.includes(one.name))) {
      for (const { suffix, context, full, do: action, at, focus } of shots) {
        const file = prefix === null ? `${name}-${suffix}.png` : `${prefix}-${name}-${suffix}.png`;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await settle(page);
        if (action === "step") await page.click('[data-testid="v3-case-next-step"] button');
        // «Доступ к порталу» (Э4) — свёрнутая группа `<details>` под «Сведениями»: раскрывается щелчком по строке.
        if (action === "portal") await page.click('[data-testid="v3-case-portal"] > summary');
        if (action === "sales") await page.click('[data-testid="v3-case-sales-data"] > summary');
        // Панель «Принять дело» (Э4): модальный <dialog> верхнего слоя — как после щелчка по главному действию.
        if (action === "accept") {
          await page.evaluate(() => {
            const dialog = document.querySelector('[data-testid="v3-case-accept-drawer"]');
            dialog.showModal();
            dialog.querySelector('[aria-pressed="true"]')?.focus();
          });
        }
        // «⋯» у заголовка: встроенный popover открывается щелчком и без гидратации; место — те же правила
        // `placeMenu`, что у TopLayerMenu (снизу, по правому краю кнопки).
        if (action === "menu") {
          await page.click('[data-testid="v3-case-actions"] button[popovertarget]');
          const boxes = await page.evaluate(() => {
            const menu = document.querySelector('[data-testid="v3-case-actions-menu"]');
            const rect = document.querySelector('[data-testid="v3-case-actions"] button[popovertarget]').getBoundingClientRect();
            return { trigger: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
              menu: { width: menu.offsetWidth, height: menu.scrollHeight }, viewport: { width: window.innerWidth, height: window.innerHeight } };
          });
          const position = placeMenu(boxes.trigger, boxes.menu, boxes.viewport, "bottom-end");
          await page.evaluate((at) => {
            const menu = document.querySelector('[data-testid="v3-case-actions-menu"]');
            Object.assign(menu.style, { top: `${at.top}px`, left: `${at.left}px`, maxHeight: `${at.maxHeight}px` });
          }, position);
        }
        // «Показать ещё» ленты: то же, что делает FeedMore после щелчка (страница не гидратируется) — скрытые
        // строки открыты, кнопка ушла, фокус с клавиатуры — на первой открытой строке. Само поведение
        // проверяет `--drawer` в браузере с настоящим React.
        if (action === "more") {
          await page.evaluate(() => {
            const box = document.querySelector('[data-testid="v3-case-feed-more"]');
            box.querySelector("ol").hidden = false;
            box.querySelector("button").remove();
          });
          await keyboardFocus(page, '[data-testid="v3-case-feed-more"] ol > [tabindex="-1"]');
        }
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
            tasksHeading: top("#case-tasks-title"),
            feedHeading: top("#case-feed-title"),
            modalOpen: [...document.querySelectorAll("dialog")].some((dialog) => dialog.matches(":modal")),
            factsColumn: box(facts),
            firstTaskBottom: firstTask ? Math.round(firstTask.getBoundingClientRect().bottom + window.scrollY) : null,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            // Видимые элементы шире окна вне своих горизонтальных прокруток (полоса вкладок прокручивается сама).
            wideElements: [...document.querySelectorAll("body *")].filter((element) => element.checkVisibility()
              && !element.closest(".overflow-x-auto") && element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length,
            // Видно на странице: содержимое свёрнутого <details> и закрытого окна не считается.
            solidRed: [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility()
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
            solidRedNames: [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility()
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim().slice(0, 24)).join("|"),
            // Любая видимая сплошная красная заливка, не только кнопки: слово срока «сегодня» (DueWord) тоже.
            solidRedFills: [...document.querySelectorAll("body *")].filter((element) => element.checkVisibility()
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => `${element.tagName.toLowerCase()}:${element.textContent.trim().slice(0, 16)}`).join("|"),
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
        // Переполнение, которое снимок застал при первой вёрстке, пересчитывается после одной новой вёрстки
        // (тело скрыто и возвращено) — review 27.09: при 320 px эмуляция телефона Chromium с полосой
        // прокрутки 10 px (globals.css) и `body { min-width: 320px }` первой вёрсткой даёт 331 px.
        if (metrics.overflow !== 0) {
          metrics.overflowAfterRelayout = await page.evaluate(() => {
            const root = document.documentElement;
            const previous = document.body.style.display;
            document.body.style.display = "none";
            void root.offsetWidth;
            document.body.style.display = previous;
            void root.offsetWidth;
            return root.scrollWidth - root.clientWidth;
          });
        }
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

// --- `--drawer`: панель «Принять дело» (Э4) в браузере с настоящим React -------------
// Бандл esbuild с настоящими `CaseAcceptDrawer` и `ProfileHandoffAcknowledgement`
// (как стенд Э7); серверное действие ответа — заглушка в браузере, она записывает
// поля формы, отвечает «сохранено» с новым ключом запроса и, как перечитанная
// страница, кладёт в снимок то, что вернёт чтение 130 после команды 182/249:
// - «Нужно уточнить» — дело в работе у того же куратора, ответ — в снимке;
// - «Принять дело» — ответ в снимке, ждать ответа дело перестаёт;
// - «Отклонить» — назначение снято, дело снова ждёт куратора: у снимка нет
//   назначения и текущего ответа, ответить больше нельзя (`assignmentEventId`
//   и `current` — null, `canRespond` — false).
// Кнопку с панелью страница рисует по тому же `studentsHandoffPending`, что и
// `caseWorkParts`. Проверки печатаются; нарушение — код выхода 1.
const DRAWER_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { CaseAcceptDrawer } = require("@/components/v3/profile/CaseAcceptDrawer");
const { CaseTaskList } = require("@/components/v3/profile/CaseTaskList");
const { FeedMore } = require("@/components/v3/profile/FeedMore");
const { FeedEvent, FeedNote } = require("@/components/v3/profile/FeedRow");
const { studentsHandoffPending } = require("@/components/v3/students/students-queue-view");
const h = React.createElement;
window.__s360 = { calls: [], refreshes: 0 };
const router = { refresh() { window.__s360.refreshes += 1; }, push() {}, replace() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
const fixture = JSON.parse(document.getElementById("s360-fixture").textContent);
const snapshot = fixture.snapshot;
function Page() {
  const [current, setCurrent] = React.useState(snapshot);
  window.__s360.answered = (fields, acknowledgementId) => {
    setCurrent((previous) => fields.decision === "declined"
      ? { ...previous, assignmentEventId: null, canRespond: false, current: null }
      : { ...previous, current: { acknowledgementId, decision: fields.decision,
        clarification: fields.clarification || null, agreedContactDate: fields.agreed_contact_date || null, createdAt: "2026-09-27T06:00:00.000Z" } });
  };
  const pending = studentsHandoffPending(current);
  return h("main", { className: "p-6 space-y-6" },
    h("h2", { id: "case-tasks-title", tabIndex: -1, "data-queue-heading": "", className: "t-section" }, "Задачи"),
    pending ? h(CaseAcceptDrawer, { name: "Синтетический студент", snapshot: current, context: fixture.context })
      : h("p", { "data-testid": "s360-after" }, current.assignmentEventId === null ? "Дело ждёт куратора" : "Дело принято"),
    // «Показать ещё» задач и ленты (review Э4): фокус переходит на первую открытую строку.
    h("section", { "data-testid": "s360-tasks" }, h(CaseTaskList, { tasks: fixture.tasks, permissions: fixture.permissions, nowIso: fixture.nowIso })),
    h("section", { "data-testid": "s360-feed" },
      h("ol", null, h(FeedEvent, { text: "Следующий шаг изменён", at: "2026-09-22T05:10:00.000Z", label: "22.09 11:10", href: "#case-header" })),
      h(FeedMore, { count: 2, start: 2, testId: "s360-feed-more" },
        h(FeedNote, { body: "Синтетическая заметка", author: "Сотрудник", at: "2026-09-12T10:10:00.000Z", label: "12.09 16:10", focusTarget: true }),
        h(FeedEvent, { text: "Дело заведено", at: "2026-08-30T05:59:00.000Z", label: "30.08 11:59" }))));
}
createRoot(document.getElementById("root")).render(h(AppRouterContext.Provider, { value: router }, h("div", { className: "v3-world" }, h(Page))));
`;

// Id ответа и новый ключ запроса заглушки: префикс + номер вызова (синтетика).
const DRAWER_ACK = "33333333-5555-4555-8555-00000000000";
const DRAWER_REQUEST = "44444444-5555-4555-8555-00000000000";

async function drawerCheck() {
  const esbuild = require("esbuild");
  const outIndex = process.argv.indexOf("--drawer") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const plugin = {
    name: "s360-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия — заглушки: ответ на передачу записывает поля и отвечает «сохранено»
      // с новым ключом запроса (как `respondToHandoffAction`) и id ответа по номеру вызова.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => name === "respondToHandoffAction"
            ? `export async function ${name}(previous, form) { const fields = Object.fromEntries(form.entries()); const n = window.__s360.calls.push(fields); `
              + `const acknowledgementId = "${DRAWER_ACK}" + n; window.__s360.answered(fields, acknowledgementId); `
              + `return { status: "saved", requestId: "${DRAWER_REQUEST}" + n, acknowledgementId, submittedContext: null }; }`
            : `export async function ${name}() { throw new Error("s360 harness: ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  const bundle = join(outDir, "f3-drawer-client.js");
  await esbuild.build({
    stdin: { contents: DRAWER_ENTRY, resolveDir: ROOT, sourcefile: "s360-drawer-entry.js", loader: "js" },
    bundle: true, outfile: bundle, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [plugin], logLevel: "error",
  });
  const htmlPath = join(outDir, "f3-drawer.html");
  writeFileSync(htmlPath, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Принять дело — синтетические данные</title><style>${await compileCss()}</style></head>`,
    `<body class="min-h-full"><div id="root"></div><script type="application/json" id="s360-fixture">${JSON.stringify({
      snapshot: HANDOFF_PENDING,
      // Контекст панели — как его собирает caseWorkParts из уже прочитанного (синтетика).
      context: { handedOffBy: { ...HANDED_OFF_BY, label: workView.caseMomentLabel(HANDED_OFF_BY.at, TODAY) }, direction: "Китай",
        step: "Собрать апостиль на аттестат", sale: null },
      tasks: workView.caseOpenTasks(TASKS, NAME, "active"), nowIso: NOW.toISOString(),
      permissions: { actorMembershipId: ME, admin: false, preview: false, staffComplete: false, staffEdit: false, caseManage: true, caseAssign: false },
    })}</script><script src="f3-drawer-client.js"></script></body></html>`,
  ].join(""));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const check = (ok, what) => { process.stdout.write(`${ok ? "ok" : "FAIL"} — ${what}\n`); if (!ok) failures.push(what); };
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      const trigger = page.getByTestId("v3-case-primary");
      await trigger.waitFor();
      const state = () => page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="v3-case-accept-drawer"]');
        const active = document.activeElement;
        return { modal: dialog ? dialog.matches(":modal") : null, focused: active === document.body ? "body" : active ? `${active.tagName.toLowerCase()}:${active.textContent.trim()}` : null,
          pressed: [...document.querySelectorAll('[aria-pressed="true"]')].map((element) => element.textContent.trim()) };
      });
      const w = viewport.width;
      await trigger.click();
      let now = await state();
      check(now.modal === true && now.focused === "button:Принять дело" && now.pressed.join() === "Принять дело", `${w}: «Принять дело» opens the modal panel, focus on the chosen decision`);
      const contextText = await page.getByTestId("v3-case-accept-context").innerText();
      check(/Передал\s+Эрмек Токтосунов · 30\.08 12:00\s+Направление\s+Китай\s+Что дальше\s+Собрать апостиль на аттестат\s+Текущий ответ\s+Ожидает ответа куратора/u.test(contextText)
        && await page.getByTestId("v3-case-accept-context").evaluate((element) => element.compareDocumentPosition(document.querySelector('[role="group"][aria-label="Решение"]')) & Node.DOCUMENT_POSITION_FOLLOWING),
        `${w}: the panel shows the handoff context above the choices (who handed off and when, direction, step, current answer)`);
      await page.screenshot({ path: join(outDir, `f3-drawer-open-${w}.png`) });
      await page.keyboard.press("Escape");
      now = await state();
      check(now.modal === false && now.focused === "button:Принять дело", `${w}: Esc closes the panel and returns focus to the button`);
      await trigger.click();
      await page.getByRole("button", { name: "Нужно уточнить" }).click();
      now = await state();
      check(now.pressed.join() === "Нужно уточнить" && await page.getByLabel("Что нужно уточнить у Sales").isVisible(), `${w}: switching the decision keeps the panel and shows its field`);
      await page.getByRole("button", { name: "Отмена" }).click();
      now = await state();
      check(now.modal === false && now.focused === "button:Принять дело", `${w}: «Отмена» closes the panel and returns focus`);
      // Review 27.09 (голова 5e0d0e95): «Нужно уточнить» дело не принимает, оно в работе у того же куратора.
      // Панель остаётся открытой: «Ответ сохранён.» видно, подтверждение — «Уже сохранено», «Текущий ответ» —
      // новый, фокус — на выбранном решении в панели; Esc закрывает, фокус — на «Принять дело».
      const clarify = async (index) => {
        await trigger.click();
        await page.getByRole("button", { name: "Нужно уточнить", exact: true }).click();
        await page.getByLabel("Что нужно уточнить у Sales").fill("Уточните, оплачен ли перевод аттестата.");
        await page.getByRole("button", { name: "Сохранить уточнение", exact: true }).click();
        // Ждём вызова заглушки, не «Уже сохранено»: закрытая панель должна дать названную ошибку, а не тайм-аут.
        await page.waitForFunction((count) => window.__s360.calls.length === count, index + 1, { timeout: 5000 });
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => {
          const dialog = document.querySelector('[data-testid="v3-case-accept-drawer"]');
          const status = dialog?.querySelector('[role="status"]');
          const submitButton = dialog?.querySelector('button[type="submit"]');
          return { trigger: document.querySelector('[data-testid="v3-case-primary"]') !== null, inside: dialog?.contains(document.activeElement) ?? false,
            status: status && status.checkVisibility() ? status.textContent.trim() : null,
            submit: submitButton ? `${submitButton.textContent.trim()}:${submitButton.disabled ? "disabled" : "enabled"}` : null };
        });
        now = await state();
        check(now.modal === true && after.trigger && after.status === "Ответ сохранён." && after.submit === "Уже сохранено:disabled",
          `${w}: saving «Нужно уточнить» keeps the panel open with a visible «Ответ сохранён.» and «Уже сохранено» (${after.status}; ${after.submit})`);
        check(after.inside && now.focused === "button:Нужно уточнить" && now.pressed.join() === "Нужно уточнить",
          `${w}: after «Нужно уточнить» focus stays in the panel, on the chosen decision (${now.focused})`);
        const answerText = await page.getByTestId("v3-case-accept-context").innerText();
        check(answerText.replace(/\s+/gu, " ").includes("Текущий ответ Нужно уточнение от Sales Уточните, оплачен ли перевод аттестата."),
          `${w}: the panel's «Текущий ответ» is the saved clarification`);
        const calls = await page.evaluate(() => window.__s360.calls);
        const call = calls[index] ?? {};
        check(calls.length === index + 1 && call.decision === "clarification_requested" && call.clarification === "Уточните, оплачен ли перевод аттестата."
          && call.student_case_id === HANDOFF_PENDING.studentCaseId && call.assignment_event_id === HANDOFF_PENDING.assignmentEventId
          && call.request_id === HANDOFF_PENDING.requestId && call.expected_acknowledgement_id === "",
        `${w}: «Сохранить уточнение» sends the answer command once with the snapshot's ids and request id`);
        await page.screenshot({ path: join(outDir, `f3-drawer-clarified-${w}.png`) });
        await page.keyboard.press("Escape");
        now = await state();
        check(now.modal === false && now.focused === "button:Принять дело", `${w}: the case still awaits acceptance — Esc returns focus to «Принять дело»`);
      };
      await clarify(0);
      // После уточнения — приём: тот же вызов с новым ключом запроса и id ответа-уточнения.
      await trigger.click();
      await page.getByRole("button", { name: "Принять дело" }).last().click();
      await page.getByRole("button", { name: "Подтвердить приём" }).click();
      await page.getByText("Дело принято").waitFor();
      await page.waitForTimeout(100);
      let calls = await page.evaluate(() => window.__s360.calls);
      let call = calls[1] ?? {};
      check(calls.length === 2 && call.decision === "accepted" && call.student_case_id === HANDOFF_PENDING.studentCaseId && call.assignment_event_id === HANDOFF_PENDING.assignmentEventId
        && call.request_id === `${DRAWER_REQUEST}1` && call.expected_acknowledgement_id === `${DRAWER_ACK}1`,
      `${w}: confirm sends the same answer command once with the snapshot's ids, the fresh request id and the previous answer id`);
      now = await state();
      check(now.modal === null && now.focused === "h2:Задачи", `${w}: after «Принять дело» the panel is gone and focus lands on «Задачи», not the page (${now.focused})`);
      // Review 27.09 (голова 82d023c9): «Отклонить» снимает назначение (182/249): дело снова ждёт куратора,
      // чтение 130 больше не даёт ответить. Перечитанная страница убирает кнопку вместе с открытой
      // панелью, и фокус переходит на заголовок «Задачи», а не падает на страницу.
      await page.reload({ waitUntil: "load" });
      await trigger.waitFor();
      await trigger.click();
      await page.getByRole("button", { name: "Отклонить", exact: true }).click();
      await page.getByLabel("Причина отклонения").fill("Нагрузка выше нормы до конца октября.");
      await page.waitForTimeout(250); // переход цвета выбранного решения — 150 мс
      await page.screenshot({ path: join(outDir, `f3-drawer-decline-${w}.png`) });
      await page.getByRole("button", { name: "Отклонить назначение", exact: true }).click();
      await page.waitForFunction(() => window.__s360.calls.length === 1, null, { timeout: 5000 });
      await page.waitForTimeout(150);
      calls = await page.evaluate(() => window.__s360.calls);
      call = calls[0] ?? {};
      check(calls.length === 1 && call.decision === "declined" && call.clarification === "Нагрузка выше нормы до конца октября."
        && call.student_case_id === HANDOFF_PENDING.studentCaseId && call.assignment_event_id === HANDOFF_PENDING.assignmentEventId
        && call.request_id === HANDOFF_PENDING.requestId && call.expected_acknowledgement_id === "",
      `${w}: «Отклонить назначение» sends the answer command once with the snapshot's ids and request id`);
      const declined = await page.evaluate(() => ({ trigger: document.querySelector('[data-testid="v3-case-primary"]') !== null,
        after: document.querySelector('[data-testid="s360-after"]')?.textContent ?? null }));
      now = await state();
      check(now.modal === null && !declined.trigger && declined.after === "Дело ждёт куратора",
        `${w}: after «Отклонить» the case awaits a curator — the button and its open panel are gone (${declined.after})`);
      check(now.focused === "h2:Задачи", `${w}: after «Отклонить» focus lands on the «Задачи» heading, not the page (${now.focused})`);
      // «Показать ещё» с клавиатуры: кнопка уходит, фокус — на первой открытой строке, а не на странице.
      const focusAfter = async (section) => {
        await page.getByTestId(section).getByRole("button", { name: /^Показать ещё/u }).focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(50);
        return page.evaluate((id) => {
          const active = document.activeElement;
          return { gone: !document.querySelector(`[data-testid="${id}"] button`)?.textContent.startsWith("Показать ещё"),
            where: active === document.body ? "body" : `${active.tagName.toLowerCase()}:${active.getAttribute("data-feed") ?? active.textContent.trim().slice(0, 40)}`,
            ring: active.matches(":focus-visible") };
        }, section);
      };
      const tasksMore = await focusAfter("s360-tasks");
      check(tasksMore.where === "a:Сверить паспортные данные в анкете" && tasksMore.ring, `${w}: tasks «Показать ещё» moves focus to the first revealed task (${tasksMore.where})`);
      const feedMore = await focusAfter("s360-feed");
      const revealed = await page.getByTestId("s360-feed-more").locator("ol > li").count();
      check(feedMore.gone && feedMore.where === "li:note" && feedMore.ring && revealed === 2 && await page.getByText("Синтетическая заметка").isVisible(),
        `${w}: feed «Показать ещё» reveals the rows and moves focus to the first one (${feedMore.where})`);
      check(errors.length === 0, `${w}: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) process.exit(1);
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.keys(SCENARIOS).map((name) => ({ name, html: renderWorkspace(name) }))));
} else if (process.argv.includes("--drawer")) {
  drawerCheck().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: case-static-render.cjs --json | --screenshots [outDir] [--only=page,…] [--f3] | --drawer [outDir]");
  process.exit(2);
}
