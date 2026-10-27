"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Синтетические данные вкладок карточки лида и дела («Новый вид», поток «card-tabs»): чек-лист документов, договор и оплата
 * (чтение 189), вузы и подготовки, анкета, журнал, закрытый лид. Имена, суммы и файлы выдуманы для проверки вёрстки и не являются
 * записями EVO; живого Supabase и прав здесь нет. Данные повторяют формы тех, что у прежних стендов вкладок
 * (`case-documents-`, `case-money-`, `case-route-static-render.cjs`): те же поля, другие значения не нужны. Модуль подключает
 * `case-static-render.cjs` (require-hook для .ts/.tsx, подмена `@/`, имена и идентификаторы дела).
 */

const cases = require("./case-static-render.cjs");

const { ORG, uuid, CASE_ID, LEAD_ID, ADMIN, ROOT } = cases;
const ME = ADMIN.membershipId;
const TODAY = "2026-09-23";
const HASH = "a".repeat(64);

// --- документы ---------------------------------------------------------------
const REVIEWER = { reviewerMembershipId: ME, reviewerDisplayName: "Айгүл Осмонова" };
function doc(n, fields) {
  const present = fields.status !== "required";
  const allowed = fields.allowed ?? true;
  return {
    id: uuid("88888888", n), name: fields.name, groupLabel: fields.group ?? "Документы", intentKind: fields.intent ?? "baseline",
    version: 1, status: fields.status,
    uploadRequestId: allowed ? uuid("12000000", n) : null, metadataRequestId: allowed ? uuid("13000000", n) : null,
    removalRequestId: allowed ? uuid("14000000", n) : null, caseLinkTargets: fields.links ?? [],
    presence: present ? "present" : "absent", currentVersionId: present ? uuid("77777777", n) : null,
    downloadReady: present ? fields.ready ?? true : false,
    ...(present ? {
      currentVersionNumber: fields.versionNumber ?? 1, currentFilename: fields.file, currentVersionCreatedAt: fields.at,
      latestReview: fields.review ? { decision: fields.status, reason: fields.review.reason ?? null, ...REVIEWER, reviewedAt: fields.review.at } : null,
      reviewRequestId: allowed && fields.status === "submitted" ? uuid("15000000", n) : null,
    } : {}),
  };
}
const APPLICATION_LINK = { kind: "university_application", id: uuid("66666666", 1), label: "Шанхайский университет · 2027 · основной", linked: true, requestId: uuid("16000000", 1) };

function docChecklist(allowed = true) {
  return [
    { kind: "active", title: "Документы", items: [
      doc(1, { allowed, name: "Паспорт", status: "approved", file: "passport-scan.pdf", at: "2026-09-18T10:58:00.000Z", review: { at: "2026-09-19T04:10:00.000Z" } }),
      doc(2, { allowed, name: "Аттестат", status: "submitted", file: "attestat-s-prilozheniem-v2.pdf", versionNumber: 2, at: "2026-09-21T05:10:00.000Z" }),
      doc(3, { allowed, name: "Перевод аттестата", status: "submitted", ready: false, file: "perevod-attestata.pdf", at: "2026-09-22T03:40:00.000Z" }),
      doc(4, { allowed, name: "Фото 3×4", status: "correction_required", file: "foto.jpg", at: "2026-09-20T08:15:00.000Z",
        review: { reason: "Нужен светлый фон, без очков.", at: "2026-09-21T06:00:00.000Z" } }),
      doc(5, { allowed, name: "Мотивационное письмо", status: "rejected",
        file: "motivatsionnoe-pismo-dlya-postupleniya-na-programmu-mezhdunarodnaya-torgovlya-final-versiya-3.pdf",
        at: "2026-09-22T11:30:00.000Z", review: { reason: "Письмо написано для другого вуза — нужен текст для этой программы.", at: "2026-09-23T05:00:00.000Z" } }),
      doc(6, { allowed, name: "Медицинская справка", status: "required" }),
      doc(7, { allowed, name: "Справка о несудимости", status: "required" }),
    ] },
    { kind: "active", title: "Дополнительные документы", items: [
      doc(8, { allowed, name: "Выписка из банка", group: "Дополнительные документы", intent: "custom", status: "required", links: [APPLICATION_LINK] }),
      doc(9, { allowed, name: "Сертификат IELTS", group: "Дополнительные документы", intent: "custom", status: "approved",
        file: "ielts-6-5.pdf", at: "2025-12-03T08:00:00.000Z", review: { at: "2025-12-04T08:00:00.000Z" } }),
    ] },
    { kind: "removed", title: "Документы", items: [
      { id: uuid("88888888", 20), name: "Справка с места работы родителей", groupLabel: "Документы", intentKind: "custom",
        removedAt: "2026-09-20T09:00:00.000Z", removalReason: "Удаление пункта из активного чек-листа сотрудником",
        versions: [{ id: uuid("77777777", 20), versionNumber: 1, filename: "spravka-roditeli.pdf", submittedBy: "Айгүл Осмонова",
          submittedAt: "2026-09-15T07:30:00.000Z", downloadReady: true }] },
    ] },
  ];
}

// --- договор и оплата (чтение 189) ---------------------------------------------
function tranche(n, fields) {
  return { id: uuid("71717171", n), label: fields.label, amountMinor: fields.amount, currency: fields.currency ?? "USD", dueOn: fields.dueOn ?? null,
    totalPaidMinor: fields.paid ?? "0", outstandingMinor: fields.outstanding ?? fields.amount };
}
function payment(n, fields) {
  return { id: uuid("72727272", n), obligationId: uuid("71717171", fields.tranche), amountMinor: fields.amount, currency: fields.currency ?? "USD",
    occurredOn: fields.on, actorDisplayName: "Айгүл Осмонова", eventType: fields.refund ? "refund" : "payment",
    receipts: fields.receipt ? [{ id: uuid("73737373", n), originalFilename: `receipt-${n}.pdf`, uploadedAt: `${fields.on}T06:00:00.000Z` }] : [] };
}
const CONTRACT_FILE = { id: uuid("74747474", 2), originalFilename: "dogovor-sydykova-2026.pdf", uploadedAt: "2026-09-18T10:40:00.000Z", uploadedByDisplayName: "Эрмек Токтосунов" };
const CONTRACT_OLD = { id: uuid("74747474", 1), originalFilename: "dogovor-sydykova-chernovik.pdf", uploadedAt: "2026-08-28T05:10:00.000Z", uploadedByDisplayName: "Эрмек Токтосунов" };
function agreement(fields = {}) {
  return {
    organizationId: ORG, studentCaseId: CASE_ID, costMinor: fields.costMinor === undefined ? "150000" : fields.costMinor,
    costCurrency: fields.costCurrency === undefined ? "USD" : fields.costCurrency, contractCurrent: fields.contract ?? null, contractHistory: fields.history ?? [],
    tranches: fields.tranches ?? [], trancheSumMinor: fields.trancheSum ?? "0", costMismatch: false, payments: fields.payments ?? [],
    paidMinor: fields.paidMinor ?? "0", remainingMinor: fields.remainingMinor === undefined ? "150000" : fields.remainingMinor,
    currencyMismatch: fields.currencyMismatch ?? false, canWrite: true,
  };
}
const AGREEMENTS = {
  empty: agreement(),
  same: agreement({
    contract: CONTRACT_FILE, history: [CONTRACT_OLD], trancheSum: "150000", paidMinor: "60000", remainingMinor: "90000",
    tranches: [tranche(1, { label: "Первый платёж", amount: "60000", dueOn: "2026-09-01", paid: "60000", outstanding: "0" }),
      tranche(2, { label: "Второй платёж — после оффера", amount: "90000", dueOn: "2026-09-20" })],
    payments: [payment(2, { tranche: 1, amount: "20000", on: "2026-09-12" }), payment(1, { tranche: 1, amount: "40000", on: "2026-08-30", receipt: true })],
  }),
  cross: agreement({
    contract: CONTRACT_FILE, currencyMismatch: true, trancheSum: "5060000", paidMinor: "3060000", remainingMinor: null,
    tranches: [tranche(1, { label: "Услуги EVO — первая часть", amount: "60000", dueOn: "2026-09-01", paid: "60000", outstanding: "0" }),
      tranche(2, { label: "Услуги EVO — вторая часть (сомы)", amount: "5000000", currency: "KGS", dueOn: "2026-10-15", paid: "3000000", outstanding: "2000000" })],
    payments: [payment(3, { tranche: 2, amount: "500000", currency: "KGS", on: "2026-09-21", refund: true }),
      payment(2, { tranche: 2, amount: "3500000", currency: "KGS", on: "2026-09-19", receipt: true }),
      payment(1, { tranche: 1, amount: "60000", on: "2026-08-30", receipt: true })],
  }),
};

function obligation(n, fields) {
  return { paymentObligationId: uuid("71717171", n), label: fields.label, category: "evo_service_fee", amountMinor: fields.amount, currency: "USD",
    dueAt: fields.dueAt ?? null, totalPaidMinor: fields.paid ?? 0, totalRefundedMinor: 0, outstandingMinor: fields.amount - (fields.paid ?? 0),
    status: fields.status ?? "pending", overdue: fields.overdue ?? false, nextAction: fields.nextAction ?? null, paymentConfirmationCount: 0,
    lastPaymentAt: fields.lastPaymentAt ?? null, activeStopFactors: fields.stops ?? [] };
}
const STOP = { stopFactorId: uuid("75757575", 1), version: "1", reason: "Второй платёж просрочен — подачу в вуз не начинаем до оплаты.",
  blockedAction: "application_submission", nextAction: "Связаться с семьёй до 25.09", ownerDisplayName: "Айгүл Осмонова", createdAt: "2026-09-21T05:00:00.000Z" };
function financeControl(stops) {
  return { organizationId: ORG, studentCaseId: CASE_ID, history: [], obligations: [
    obligation(1, { label: "Первый платёж", amount: 60000, paid: 60000, status: "paid", lastPaymentAt: "2026-09-12T08:00:00.000Z" }),
    obligation(2, { label: "Второй платёж — после оффера", amount: 90000, dueAt: "2026-09-20T18:00:00.000Z", overdue: true, status: "overdue", stops: stops ? [STOP] : [] }),
  ] };
}
function contractWorkspace(admin) {
  return { organizationId: ORG, studentCaseId: CASE_ID, actorRole: admin ? "admin" : "admissions", canManageTemplates: admin, canGenerateContract: true,
    canReviewContract: admin, canManagePostContract: true, canReviewReport: admin, reviewedSources: [], templates: [], drafts: [], items: [], reports: [] };
}
const HANDOFF_CTX = {
  organizationId: ORG, leadId: LEAD_ID, studentCaseId: CASE_ID, caseState: "active", handoffMode: "normal", handoffState: "completed",
  handoffReason: "Договор и первый платёж подтверждены (синтетика).", handoffSource: "canonical_sales", handedOffAt: "2026-08-30T06:00:00.000Z",
  actorMembershipId: ME, actorDisplayName: "Эрмек Токтосунов", admissionsOwnerMembershipId: ME, admissionsOwnerDisplayName: "Айгүл Осмонова",
  gateVersion: "4", gateState: "passed", workflowVersion: "5", salesContext: { stageKey: "qualified", sourceKey: "website" },
  clientContext: { clientId: uuid("77777777", 1) }, provenance: [], conversationLinks: [],
  starterTasks: [{ taskId: uuid("78787878", 1), title: "Первый звонок семье", assigneeDisplayName: "Айгүл Осмонова", status: "done" }],
};

// --- вузы и подготовки ---------------------------------------------------------
function application(n, fields) {
  return {
    organizationId: ORG, universityApplicationId: uuid("66666666", n), version: "3", studentCaseId: CASE_ID, studentDisplayName: "Айдана Сыдыкова",
    targetCountry: "CN", targetDegree: "bachelor", programDirection: null, intake: "2027", institutionName: fields.institution,
    programName: fields.program ?? null, isPrimary: fields.primary ?? false, universityDeadlineOn: fields.deadline ?? null,
    country: fields.country ?? "CN", degree: fields.degree ?? "bachelor", status: fields.status ?? "preparation",
    latestEvidenceReference: fields.evidence ?? null, createdAt: "2026-09-10T04:00:00.000Z", updatedAt: "2026-09-18T04:00:00.000Z",
    responsibleSalesDisplayName: null, currentCuratorDisplayName: "Айгүл Осмонова", documentCount: 0, openDocumentCount: 0, taskCount: 0,
    openTaskCount: 0, paymentObligationCount: 0, outstandingPaymentObligationCount: 0, createdByMembershipId: ME,
    createdByDisplayName: fields.addedBy === undefined ? "Айгүл Осмонова" : fields.addedBy,
  };
}
function preparation(n, fields) {
  const programId = `program-${n}`;
  const intakeId = uuid("12345678", n);
  return {
    applicationId: uuid("66666666", n), studentCaseId: CASE_ID, institutionId: uuid("45454545", n), programId, intakeId, publicationId: uuid("56565656", n),
    publicationVersion: 3, catalogLevel: "bachelor", applicationDegree: "bachelor", selectedAt: "2026-09-12T04:00:00.000Z",
    deadlineStateAtSelection: "confirmed", applicationStatus: fields.status ?? "preparation", applicationVersion: "3",
    content: { name: fields.institution, country: "CN", city: fields.city ?? "Шанхай", overview: "Синтетическое описание.", websiteUrl: "https://example.invalid",
      sourceUrl: "https://example.invalid/source", verifiedOn: "2026-09-01", notes: "", photoKey: null,
      programs: [{ id: programId, title: fields.program, level: "bachelor", duration: "4 года", language: "английский", summary: "Синтетика.",
        sourceUrl: "https://example.invalid/program",
        intakes: [{ id: intakeId, label: "Осень 2027", startDate: null, startMonth: "2027-09", applicationDeadline: fields.deadline ?? null, deadlineTime: null,
          timezone: "Asia/Shanghai", status: "open", note: "", sourceUrl: "https://example.invalid/intake", verifiedOn: "2026-09-01" }] }] },
  };
}
const ROUTE = {
  applications: [
    application(1, { institution: "Шанхайский университет", program: "Международная торговля", primary: true }),
    application(2, { institution: "Университет Малайи", program: "Компьютерные науки", country: "MY", status: "submitted", deadline: "2026-09-30", evidence: "Номер заявления 0000 (синтетика)" }),
    application(3, { institution: "Чжэцзянский университет", program: "Экономика", status: "offer", deadline: "2026-08-15" }),
    application(4, { institution: "Университет Фудань", program: "Финансы", status: "ready", deadline: "2026-09-18", addedBy: null }),
  ],
  preparations: [preparation(1, { institution: "Шанхайский университет", program: "Международная торговля", deadline: "2026-11-30" })],
  partner: [{ applicationId: uuid("66666666", 3), version: "4", partnerContact: "Партнёр «Синтетика»", externalLink: "https://example.invalid/offer",
    decisionReference: "Оффер № 0000", decisionNote: null }],
  packets: { files: [{ slotId: "slot-1", versionId: uuid("77777777", 1), name: "Паспорт", sha256: HASH, versionNo: "1", sizeBytes: 480000, mimeType: "application/pdf" }],
    generatedExports: [], packets: [], workspaceRevision: HASH, maxArchiveBytes: 52428800 },
};

// --- анкета --------------------------------------------------------------------
const QUESTIONNAIRE = {
  schemaVersion: 1, requestId: uuid("11111111", 5), firstName: "Айдана", lastName: "Сыдыкова", phone: "+996 000 000 001", destinationCountries: ["CN", "MY"],
  intakeSeason: "autumn", intakeYear: 2027, educationLevel: "high_school", averageGrade: 4.6, gradeScale: "5", studyFields: ["Информатика и IT", "Экономика и финансы"],
  studyLevels: ["bachelor"], nationality: "KG", english: { mode: "exam", exam: "ielts", score: "6.0" }, tuitionBudget: "5000_10000", fundingSource: "family",
  consent: true, consentVersion: "2026-09",
};
const STUDENT_APPLICATION = { id: uuid("11111111", 1), status: "approved", revision: 1, email: "student@example.invalid", questionnaire: QUESTIONNAIRE,
  submittedAt: "2026-08-20T04:00:00.000Z", decidedAt: "2026-08-21T04:00:00.000Z", decisionReason: null, studentCaseId: CASE_ID, admissionsDirection: "CN", canonicalLeadId: LEAD_ID };
function profileField(key, value, state, proposals = []) {
  return { key, value, state, reviewedAt: state === "confirmed" ? "2026-09-10T05:00:00.000Z" : null, sourceDocumentVersionId: null, sourcePage: null, proposals };
}
function profileFields({ canReview = true, canExport = true } = {}) {
  const { PROFILE_FIELDS } = require(`${ROOT}/src/lib/student-profile-fields.ts`);
  const proposal = { id: uuid("31313131", 1), value: "AA 0000000", sourceDocumentVersionId: null, sourcePage: 2, sourceSnippet: "Synthetic passport page", confidence: 0.82,
    createdAt: "2026-09-11T05:00:00.000Z", status: "pending" };
  const known = {
    student_first_name: ["Айдана", "confirmed"], student_last_name: ["Сыдыкова", "confirmed"], date_of_birth: ["2008-04-12", "confirmed"],
    nationality: ["Кыргызстан", "confirmed"], passport_number: [null, "needs_review", [proposal]], mobile_phone: ["+996 000 000 001", "needs_review"],
    student_email: ["student@example.invalid", "conflict"],
  };
  // Снимок несёт все поля анкеты (форма проверки читает каждое по ключу); неизвестные - пустые и ждут проверки.
  return { studentCaseId: CASE_ID, profile: { id: uuid("11111111", 9), revision: 3 }, canInitialize: true, canReview, canExport,
    fields: PROFILE_FIELDS.map((field) => profileField(field.key, ...(known[field.key] ?? [null, "needs_review"]))) };
}

// --- журнал ----------------------------------------------------------------------
function event(n, transition, kind, at, targetId = CASE_ID) {
  const href = kind === "conversation" ? `/v3/inbox?conversation=${targetId}` : `/v3/profile?case=${CASE_ID}&tab=${kind}`;
  return { id: uuid("abababab", n), transition, role: n % 3 === 0 ? "admissions" : "", at: null, href, changedFields: n === 10 ? ["title", "due_on"] : [], targetKind: kind, occurredAt: at, targetId };
}
const TIMELINE = [
  event(10, "case.next.action.change", "overview", "2026-09-22T05:10:00.000Z"), event(11, "task.create", "task", "2026-09-21T09:00:00.000Z"),
  event(12, "case.handoff.acknowledge", "overview", "2026-09-21T04:00:00.000Z"), event(13, "communication.message.record", "conversation", "2026-09-19T12:00:00.000Z", uuid("67676767", 1)),
  event(14, "application.status.change", "overview", "2026-09-18T09:30:00.000Z", uuid("66666666", 2)), event(15, "document.version.review", "documents", "2026-09-17T08:00:00.000Z"),
  event(16, "application.create", "overview", "2026-09-10T04:20:00.000Z", uuid("66666666", 1)), event(1, "case.curator.set", "overview", "2026-08-30T06:05:00.000Z"),
  event(2, "lead.admissions.handoff.completed", "overview", "2026-08-30T06:00:00.000Z"), event(3, "case.create", "overview", "2026-08-30T05:59:00.000Z"),
  event(17, "task.create", "task", "2026-08-29T09:00:00.000Z"), event(18, "task.create", "task", "2026-08-28T09:00:00.000Z"),
];

// --- закрытый лид ----------------------------------------------------------------
const CLOSED_LEAD = { leadId: LEAD_ID, name: "Алина Закрытая", ownerName: "Санжар Эскизов", stageKey: "contacting", workflowVersion: "6",
  closedAt: "2026-09-20T05:00:00.000Z", reason: "no_response", note: null, closedByName: "Санжар Эскизов", canManage: true };

module.exports = { ...cases, ME, TODAY, docChecklist, AGREEMENTS, financeControl, contractWorkspace, HANDOFF_CTX, STOP, ROUTE, STUDENT_APPLICATION,
  profileFields, TIMELINE, CLOSED_LEAD };
