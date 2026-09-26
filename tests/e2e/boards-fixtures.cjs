"use strict";

/**
 * СИНТЕТИЧЕСКИЕ данные и подмены границ данных и прав для рендера досок
 * (tests/e2e/boards-static-render.cjs). Имена, числа и дела выдуманы для
 * проверки вёрстки и не являются записями EVO. Модуль не зависит от Node:
 * тот же файл собирается в браузерный бандл гидратации (`--hydrate`), чтобы
 * сервер и браузер строили одинаковое дерево.
 */

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "bbbbbbbb-7777-4777-8777-000000000003", organizationId: ORG,
  displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [],
  permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const OWNER_A = "aaaaaaaa-1111-4111-8111-000000000001";
const OWNER_B = "aaaaaaaa-1111-4111-8111-000000000002";
const OWNERS = [
  { membershipId: OWNER_A, displayLabel: "Менеджер Первый" },
  { membershipId: OWNER_B, displayLabel: "Менеджер Второй" },
];
const leadId = (n) => `dddddddd-3333-4333-8333-${String(n).padStart(12, "0")}`;
const caseId = (n) => `cccccccc-2222-4222-8222-${String(n).padStart(12, "0")}`;

// Даты считаются от сегодняшнего дня в Бишкеке, как на сервере. «Сейчас»
// округлено до полудня по Бишкеку: сервер и браузер при гидратации получают
// одни и те же отметки времени.
const DAY = 86_400_000;
const BISHKEK_OFFSET = 6 * 3_600_000;
const NOW = Math.floor((Date.now() + BISHKEK_OFFSET) / DAY) * DAY + 12 * 3_600_000 - BISHKEK_OFFSET;
const bishkekDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(NOW + offsetDays * DAY));
const ago = (days) => new Date(NOW - days * DAY).toISOString();

function lead(n, fields) {
  const { owner = OWNER_A, ...rest } = fields;
  const ownerRow = OWNERS.find((row) => row.membershipId === owner);
  return {
    organizationId: ORG, leadId: leadId(n), clientId: null, clientDisplayName: null, clientEmail: null, clientPhone: null,
    currentOwnerMembershipId: ownerRow ? owner : null, currentOwnerDisplayName: ownerRow?.displayLabel ?? null,
    stageKey: "new", sourceKey: "website", lifecycleState: "open", nextActionText: null, nextActionDueDate: null,
    workflowVersion: "3", isConnected: false, openDuplicateCandidateCount: 0, linkedStudentCaseCount: 0,
    linkedConversationCount: 0, createdAt: ago(20), updatedAt: ago(1), stageEnteredAt: ago(2), latestNote: null,
    ...rest,
  };
}

const SALES_ROWS = [
  lead(1, { clientDisplayName: "Айжан Примерова", stageKey: "new", nextActionText: "Позвонить и уточнить страну", nextActionDueDate: bishkekDate(-2), stageEnteredAt: ago(4) }),
  lead(2, { clientDisplayName: "Тимур Образцов", stageKey: "new", nextActionText: "Отправить подборку программ", nextActionDueDate: bishkekDate(0), stageEnteredAt: ago(1), owner: OWNER_B }),
  lead(3, { clientDisplayName: "Абитуриент с очень длинным двойным именем Нурсултан-Бекмурза Тестов", stageKey: "new", stageEnteredAt: ago(0), owner: null }),
  lead(4, { clientEmail: "parent@example.invalid", stageKey: "contacting", nextActionText: "Написать в WhatsApp после 18:00", nextActionDueDate: bishkekDate(3), stageEnteredAt: ago(6) }),
  lead(5, { clientDisplayName: "Элина Демо", stageKey: "contacting", nextActionText: "Повторный звонок родителям", nextActionDueDate: bishkekDate(-5), stageEnteredAt: ago(12), owner: OWNER_B,
    latestNote: { id: "ffffffff-5555-4555-8555-000000000001", body: "Родители просят сравнить Малайзию и Китай по стоимости. Перезвонить после консультации.", authorDisplayName: "Менеджер Второй", createdAt: ago(1) } }),
  lead(6, { clientDisplayName: "Бекзат Тестов", stageKey: "qualified", nextActionText: "Подготовить договор", nextActionDueDate: bishkekDate(1), stageEnteredAt: ago(3) }),
  lead(7, { clientDisplayName: "Айгерим Условная", stageKey: "qualified", nextActionText: "Дождаться первой оплаты", nextActionDueDate: bishkekDate(0), stageEnteredAt: ago(9) }),
  lead(8, { clientDisplayName: "Данияр Макетов", stageKey: "meeting_scheduled", nextActionText: "Встреча в офисе, взять аттестат", nextActionDueDate: bishkekDate(2), stageEnteredAt: ago(2), owner: OWNER_B }),
  lead(9, { clientDisplayName: "Камила Черновик", stageKey: "meeting_completed", nextActionText: "Отправить итоги встречи", nextActionDueDate: bishkekDate(-1), stageEnteredAt: ago(5) }),
  lead(10, { clientPhone: "+996 000 000 010", stageKey: "meeting_completed", stageEnteredAt: ago(15), owner: null }),
  lead(11, { clientDisplayName: "Руслан Прототипов", stageKey: "potential", nextActionText: "Согласовать дату подписания договора с семьёй", nextActionDueDate: bishkekDate(7), stageEnteredAt: ago(21) }),
  lead(12, { clientDisplayName: "Санжар Эскизов", stageKey: "potential", nextActionText: "Прислать реквизиты для оплаты", nextActionDueDate: bishkekDate(0), stageEnteredAt: ago(8), owner: OWNER_B }),
  // Переданные (производная колонка по доказательству передачи).
  lead(13, { clientDisplayName: "Алина Переданная", stageKey: "qualified", stageEnteredAt: ago(30) }),
  lead(14, { clientDisplayName: "Мээрим Выпускница", stageKey: "qualified", nextActionText: "Передать куратору пакет", nextActionDueDate: bishkekDate(-3), stageEnteredAt: ago(40), owner: OWNER_B }),
];
const HANDED = new Set([leadId(13), leadId(14)]);

// Настоящий объём: 34 лида в «Новом», колонка прокручивается внутри себя.
const FIRST = ["Айжан", "Тимур", "Элина", "Бекзат", "Айгерим", "Данияр", "Камила", "Руслан", "Санжар", "Мээрим", "Нурлан", "Асель"];
const LAST = ["Примерова", "Образцов", "Демо", "Тестов", "Условная", "Макетов", "Черновик", "Прототипов", "Эскизов", "Синтетический"];
const ACTIONS = ["Позвонить и уточнить страну", "Отправить подборку программ", "Написать в WhatsApp", "Повторный звонок родителям", "Подготовить договор", null];
const VOLUME_STAGES = [["new", 34], ["contacting", 10], ["qualified", 6], ["meeting_scheduled", 4], ["meeting_completed", 3], ["potential", 3]];
const VOLUME_ROWS = [
  ...VOLUME_STAGES.flatMap(([stageKey, total], stageIndex) => Array.from({ length: total }, (_, index) => {
    const n = 100 + stageIndex * 40 + index;
    const action = ACTIONS[n % ACTIONS.length];
    const dueOffset = [-3, 0, 2, -1, 5][n % 5];
    return lead(n, {
      clientDisplayName: `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`,
      stageKey,
      nextActionText: action,
      nextActionDueDate: action ? bishkekDate(dueOffset) : null,
      stageEnteredAt: ago(n % 17),
      owner: n % 3 === 0 ? OWNER_B : n % 3 === 1 ? OWNER_A : null,
    });
  })),
  ...SALES_ROWS.slice(12),
];

const CURATOR_A = "aaaaaaaa-1111-4111-8111-000000000011";
const CURATOR_B = "aaaaaaaa-1111-4111-8111-000000000012";
function row(n, fields) {
  return {
    studentCaseId: caseId(n), studentDisplayName: "", targetCountry: null, primaryInstitutionName: null,
    currentCuratorMembershipId: CURATOR_A, currentCuratorDisplayName: "Куратор Один", pipelineStage: "new",
    awaitingAck: false, overdue: false, needsReply: false, ...fields,
  };
}
const CURATOR_TWO = { currentCuratorMembershipId: CURATOR_B, currentCuratorDisplayName: "Куратор Два" };
const ADMISSIONS_ROWS = [
  row(1, { studentDisplayName: "Айжан Примерова", targetCountry: "CN", primaryInstitutionName: "Пекинский университет языка и культуры", pipelineStage: "new", awaitingAck: true }),
  row(2, { studentDisplayName: "Тимур Образцов", targetCountry: "MY", pipelineStage: "new", ...CURATOR_TWO }),
  row(3, { studentDisplayName: "Нурсултан-Бекмурза Тестов с длинным именем", targetCountry: "CN", primaryInstitutionName: "Шанхайский университет", pipelineStage: "shortlist", overdue: true }),
  row(4, { studentDisplayName: "Элина Демо", targetCountry: "AE", pipelineStage: "documents", needsReply: true, ...CURATOR_TWO }),
  row(5, { studentDisplayName: "Бекзат Тестов", targetCountry: "TR", primaryInstitutionName: "Bilkent University", pipelineStage: "documents" }),
  row(6, { studentDisplayName: "Айгерим Условная", targetCountry: "MY", primaryInstitutionName: "UCSI University", pipelineStage: "ready_to_submit", overdue: true, needsReply: true }),
  row(7, { studentDisplayName: "Данияр Макетов", targetCountry: "CN", pipelineStage: "awaiting_decision" }),
  row(8, { studentDisplayName: "Камила Черновик", targetCountry: "CN", primaryInstitutionName: "Уханьский университет", pipelineStage: "confirmed", ...CURATOR_TWO }),
  row(9, { studentDisplayName: "Руслан Прототипов", targetCountry: "MY", pipelineStage: "visa", overdue: true }),
  row(10, { studentDisplayName: "Санжар Эскизов", targetCountry: "CN", pipelineStage: "visa", awaitingAck: true }),
  row(11, { studentDisplayName: "Мээрим Выпускница", targetCountry: "AE", pipelineStage: "predeparture" }),
  row(12, { studentDisplayName: "Алина Переданная", targetCountry: "TR", pipelineStage: "arrived", ...CURATOR_TWO }),
];

const queueItems = (count) => Array.from({ length: count }, (_, index) => ({ id: `q-${index}` }));

/**
 * Какой набор лидов читает доска (обычный или объёмный `sales-volume`) и
 * подтверждает ли подменённое серверное действие сохранение решения (только
 * в браузерной гидратации: там проверяется панель после обновления).
 */
const state = { salesRows: SALES_ROWS, saveSucceeds: false, versions: new Map(), closed: new Map() };

// «Закрытые лиды» (246): три закрытых раньше и те, что закрыты в сценарии.
// Закрытый лид, как в RPC доски (lifecycle_state = 'open'), с доски уходит.
const CLOSED_BEFORE = [
  { leadId: leadId(20), name: "Нурлан Закрытов", ownerName: "Менеджер Первый", stageKey: "contacting", workflowVersion: "4",
    closedAt: ago(2), reason: "no_response", note: null, closedByName: "Менеджер Первый", canManage: true },
  { leadId: leadId(21), name: "Асель Отказова", ownerName: "Менеджер Второй", stageKey: "qualified", workflowVersion: "6",
    closedAt: ago(5), reason: "other", note: "Решила поступать через родственников в Казани", closedByName: "Менеджер Второй", canManage: true },
  { leadId: leadId(22), name: "Эркин Дубликатов", ownerName: null, stageKey: "new", workflowVersion: "2",
    closedAt: ago(9), reason: "duplicate", note: null, closedByName: "Администратор (синтетический)", canManage: true },
];
function closedRows() {
  const now = [...state.closed.entries()].map(([id, closure]) => {
    const one = state.salesRows.find((row) => row.leadId === id);
    return { leadId: id, name: one?.clientDisplayName ?? null, ownerName: one?.currentOwnerDisplayName ?? null,
      stageKey: one?.stageKey ?? "new", workflowVersion: one?.workflowVersion ?? "1", closedByName: ACTOR.displayName, canManage: true, ...closure };
  });
  return [...now.reverse(), ...CLOSED_BEFORE];
}
// Сохранённое решение, как на сервере, поднимает версию лида: следующее
// чтение доски её отдаёт, и форма пересоздаётся с новой версией.
const withVersion = (one) => (state.versions.has(one.leadId) ? { ...one, ...state.versions.get(one.leadId) } : one);
// Срок, как у RPC доски: переданного лида фильтр не исключает — он тоже
// приходит в чтении и попадает в свёрнутую колонку «Переданы».
function matchesDue(one, dueFilter) {
  const today = bishkekDate(0);
  if (dueFilter === "overdue") return one.nextActionDueDate !== null && one.nextActionDueDate < today;
  if (dueFilter === "due_today") return one.nextActionDueDate === today;
  if (dueFilter === "unscheduled") return one.nextActionDueDate === null;
  return true;
}
function selectSalesRows(kind) {
  state.salesRows = kind === "volume" ? VOLUME_ROWS : SALES_ROWS;
}
function setSaveSucceeds(value) {
  state.saveSucceeds = value;
}

// --- подмена границ данных и прав --------------------------------------------
const STUBS = {
  "@/lib/platform-guards": {
    requireV3PageActor: async () => ACTOR,
    requirePlatformStaffActor: async () => ACTOR,
  },
  "@/lib/platform-sales": {
    // Поиск RPC здесь — подстрока по имени, контакту и действию: достаточно,
    // чтобы показать доску с пустыми этапами.
    listPlatformSalesLeads: async (actor, options = {}) => ({
      rows: (options.query
        ? state.salesRows.filter((one) => [one.clientDisplayName, one.clientEmail, one.clientPhone, one.nextActionText]
          .some((value) => value?.toLocaleLowerCase("ru-RU").includes(options.query.toLocaleLowerCase("ru-RU"))))
        : state.salesRows).filter((one) => !state.closed.has(one.leadId) && matchesDue(one, options.dueFilter ?? "all")).map(withVersion),
      hasNext: false,
      nextCursor: null,
    }),
    listPlatformSalesOwnerOptions: async () => ({ rows: OWNERS, hasNext: false, nextCursor: null }),
    // Та же форма, что у настоящего координатора: чтение доски и сотрудников.
    readPlatformSalesPipeline: async (actor, readers) => ({
      board: await readers.board(actor), ownerOptions: await readers.owners(actor), canCreateLead: true,
    }),
  },
  "@/lib/v3/sales-handoff-source": { readCompletedSalesHandoffs: async () => HANDED },
  "@/lib/platform-sales-actions": {
    updatePlatformSalesWorkflowAction: async (previous, form) => {
      if (!state.saveSucceeds) return previous;
      const version = String(Number(form.get("expected_version")) + 1);
      const cleared = form.get("clear_next_action") === "true";
      state.versions.set(String(form.get("lead_id")), {
        workflowVersion: version,
        stageKey: String(form.get("stage_key")),
        nextActionText: cleared ? null : String(form.get("next_action_text") || "") || null,
        nextActionDueDate: cleared ? null : String(form.get("next_action_due_date") || "") || null,
      });
      return { ...previous, status: "saved", version, changedAt: new Date().toISOString() };
    },
  },
  "@/lib/platform-manual-lead-actions": { createManualLeadAction: async (previous) => previous },
  // «Закрыть лид» / «Вернуть в работу»: подменённое действие записывает
  // закрытие в состояние сценария и отвечает квитанцией, как сервер.
  "@/lib/platform-closure-actions": {
    leadClosureAction: async (previous, form) => {
      const id = String(form.get("lead_id"));
      const closed = form.get("closed") === "true";
      const changedAt = new Date(NOW).toISOString();
      const reason = closed ? String(form.get("reason")) : null;
      const note = closed ? String(form.get("note") || "") || null : null;
      if (closed) state.closed.set(id, { reason, note, closedAt: changedAt });
      else state.closed.delete(id);
      return { status: "saved", requestId: globalThis.crypto.randomUUID(), message: closed ? "Лид закрыт." : "Лид снова в работе.",
        receipt: { leadId: id, lifecycle: closed ? "closed" : "open", reason, note, workflowVersion: String(form.get("expected_version")), changedAt } };
    },
    caseClosureAction: async (previous) => ({ ...previous, status: "unavailable", message: "Не удалось подтвердить. Повторите: повтор не выполнит действие дважды." }),
  },
  "@/lib/platform-closure": {
    parseClosedLeadsCursor: (value) => (typeof value === "string" && value !== "" ? value : null),
    readClosedLeads: async () => ({ rows: closedRows(), nextCursor: null }),
  },
  "@/lib/platform-admissions-pipeline": {
    readAdmissionsPipelineBoard: async () => ({ rows: ADMISSIONS_ROWS, truncated: false }),
  },
  "@/lib/platform-admissions-pipeline-actions": { moveCasePipelineAction: async () => ({ status: "saved" }) },
  "@/lib/portal/application-documents-actions": {
    readStaffApplicationDocumentSubmissionQueueAction: async () => ({ ok: true, page: { protocolVersion: 1, items: queueItems(20), nextCursor: { sortAt: "2026-09-20T10:00:00Z", id: "x" } } }),
  },
  "@/lib/portal/application-packages-actions": {
    readStaffApplicationPackageQueueAction: async () => ({ ok: true, queue: { protocolVersion: 1, items: queueItems(3), nextCursor: null } }),
  },
  "@/lib/server/student-portal-curator-options": {
    listStudentPortalActiveCurators: async () => [
      { membershipId: CURATOR_A, displayName: "Куратор Один" },
      { membershipId: CURATOR_B, displayName: "Куратор Два" },
    ],
  },
  // Очереди документов рендерятся только в своих видах, не на доске.
  "@/components/portal/applicationPackages/PackageQueue": { PackageQueue: () => null },
  "@/components/v3/admissions/ProgramDocumentQueue": { ProgramDocumentQueue: () => null },
};

/**
 * Предсказуемые UUID для `randomUUID()` страницы: сервер и браузер при
 * гидратации получают одну и ту же последовательность и одинаковую разметку.
 */
function syntheticUuids() {
  let next = 0;
  return () => `99999999-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`;
}

module.exports = { ACTOR, STUBS, leadId, caseId, selectSalesRows, setSaveSucceeds, syntheticUuids };
