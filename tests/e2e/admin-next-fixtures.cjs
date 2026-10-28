"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Синтетические данные «Нового вида», поток «admin» («Настройки», «Маркетинг», «Финансы», «ИИ-агент»): люди, роли, отделы, запросы на
 * удаление, заявки, расходы, документы и ответы ВЫДУМАНЫ для проверки вёрстки и не являются записями EVO. Данные в форме чтений
 * (`src/lib/**`): их читают настоящие страницы на Node (`admin-next-pages.cjs`) и собирают из них свойства входов для Chromium
 * (`admin-next-static-render.cjs`). Деньги — USD/KGS, имена и номера — вымышленные.
 */
const { ROOT, join } = require("./admin-next-env.cjs");

const id = (head, n) => `${head}-2222-4222-8222-${String(n).padStart(12, "0")}`;
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const actorOf = (fields) => ({
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid",
  assignments: [], permissionKeys: [], displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: null, ...fields,
});
const ADMIN = actorOf({});
const STAFF = actorOf({ systemRole: "staff", displayName: "Сотрудник (синтетический)" });
const PREVIEW = actorOf({ presentationRole: "sales" });

/* ------------------------------------------------------------------ Настройки */

const DEPARTMENTS = [
  { id: id("dddddddd", 1), name: "Продажи", description: "Первый контакт, договор, первый платёж.", status: "active", version: 1, memberCount: 2 },
  { id: id("dddddddd", 2), name: "Сопровождение", description: null, status: "active", version: 1, memberCount: 3 },
  { id: id("dddddddd", 3), name: "Старый отдел", description: "Закрыт в сентябре.", status: "archived", version: 2, memberCount: 0 },
];
const PEOPLE = [
  ["Айна Тестова", "Руководитель сопровождения", 2, ["CN", "MY"]],
  ["Бекболот Примеров", "Менеджер продаж", 1, []],
  ["Камила Вымыслова", "Куратор", 2, ["EU"]],
  ["Данияр Макетов", "Менеджер продаж", 1, []],
  ["Эльмира Формова", "Куратор", 2, ["TR", "AE"]],
];
const MEMBERS = PEOPLE.map(([displayName, jobTitle, department, directions], index) => ({
  membershipId: id("aaaaaaaa", index + 10), displayName, status: index === 3 ? "suspended" : "active", version: 3,
  metadata: { version: 1, departmentId: DEPARTMENTS[department - 1].id, jobTitle, directions },
}));
const REQUESTS = [
  { requestId: id("77777777", 1), operation: "password", displayName: "Новый Сотрудник", status: "completed", createdAt: "2026-10-26T08:00:00.000Z", rejectionCode: null },
  { requestId: id("77777777", 2), operation: "invite", displayName: "Приглашённая Гостья", status: "rejected", createdAt: "2026-10-25T08:00:00.000Z", rejectionCode: "email_in_use" },
  { requestId: id("77777777", 3), operation: "recovery", displayName: "Данияр Макетов", status: "reconciliation_required", createdAt: "2026-10-27T07:30:00.000Z", rejectionCode: null },
];
const STAFF_DATA = { members: MEMBERS, requests: REQUESTS, available: true, departments: DEPARTMENTS };
const ROLES = [
  { id: id("99999999", 1), label: "Admissions", description: "Кураторы поступления", status: "active", version: 1, bundleId: id("99999999", 11), bundleVersion: 1, permissionKeys: ["case.read.full"], draftPermissionKeys: ["case.read.full"], memberCount: 3 },
  { id: id("99999999", 2), label: "Sales Manager", description: "Продажи", status: "active", version: 1, bundleId: id("99999999", 12), bundleVersion: 1, permissionKeys: ["lead.read"], draftPermissionKeys: ["lead.read", "case.read.full"], memberCount: 2 },
  { id: id("99999999", 3), label: "Финансист (черновик)", description: "Отчёты по оплатам", status: "active", version: 1, bundleId: null, bundleVersion: null, permissionKeys: [], draftPermissionKeys: ["lead.read"], memberCount: 0 },
  { id: id("99999999", 4), label: "Прежний куратор", description: null, status: "archived", version: 2, bundleId: id("99999999", 14), bundleVersion: 1, permissionKeys: ["lead.read"], draftPermissionKeys: ["lead.read"], memberCount: 0 },
];
const ROLE_WORKSPACE = {
  schemaVersion: 1,
  permissions: [
    { key: "case.read.full", label: "Читать дело полностью", group: "Поступление", allowedScopes: ["own", "department", "organization"], resourceKinds: [], sensitive: false, systemOnly: false },
    { key: "lead.read", label: "Читать лиды", group: "Продажи", allowedScopes: ["own", "department", "organization"], resourceKinds: [], sensitive: true, systemOnly: false },
  ],
  roles: ROLES,
  members: MEMBERS.map((member, index) => ({
    membershipId: member.membershipId, displayName: member.displayName, systemRole: index === 0 ? "admin" : "staff", accessVersion: 3,
    assignments: index === 0 ? [] : [{ id: id("99999999", 20 + index), roleId: ROLES[index % 2 === 0 ? 0 : 1].id, label: ROLES[index % 2 === 0 ? 0 : 1].label, bundleId: ROLES[0].bundleId, bundleVersion: 1, scope: { kind: "organization", key: null, resourceKind: null } }],
  })),
  departments: DEPARTMENTS.map(({ id: departmentId, name, status }) => ({ id: departmentId, name, status })),
};

const PROVIDERS = {
  production: { waha: { display: "not_configured", sessionStatus: undefined, observedAt: null }, gemini: "not_configured", amo: { status: "blocked", reason: "configuration_missing" } },
  blocked: { waha: { display: "blocked", sessionStatus: "SCAN_QR_CODE", observedAt: "2026-10-27T08:15:00.000Z" }, gemini: "configured_not_verified", amo: { status: "blocked", reason: "token_unavailable" } },
  wazzup: { wazzup: { channelState: "active", observedAt: "2026-10-27T08:58:00.000Z", intakeEnabled: true }, waha: { display: "not_configured", sessionStatus: undefined, observedAt: null }, gemini: "configured_not_verified", amo: { status: "blocked", reason: "configuration_missing" } },
};
const WAZZUP_TRANSPORT = {
  activeTransport: "wazzup", canReply: false, replyMode: "receive_only",
  channel: { transport: "whatsapp", state: "active", observedAt: "2026-10-27T08:58:00.000Z", last4: "4821" }, lastInboundAt: "2026-10-27T08:41:00.000Z",
};
const JOURNAL_EVENTS = [
  { kind: "event", id: id("77777777", 11), transition: "task.create", objectType: "case_task", objectId: id("88888888", 1), role: "Staff", at: "27.10 14:15", reason: null, profileHref: null },
  { kind: "event", id: id("77777777", 12), transition: "task.change", objectType: "case_task", objectId: id("88888888", 1), role: "Staff", at: "27.10 13:40", reason: null, profileHref: `/v3/profile?case=${id("dddddddd", 41)}` },
  { kind: "page", snapshotCreatedAt: "2026-10-27T09:00:00.000Z", snapshotId: id("77777777", 90), cursorCreatedAt: "2026-10-27T08:00:00.000Z", cursorId: id("77777777", 12) },
];
/** Страница журнала, где у каждого события действие, которого код ещё не знает (база пишет их раньше, чем приложение их называет): названных строк нет, курсор есть. */
const JOURNAL_UNNAMED = [
  { kind: "event", id: id("77777777", 21), transition: "future.action.alpha", objectType: "case_task", objectId: id("88888888", 2), role: "Staff", at: "27.10 12:05", reason: null, profileHref: null },
  { kind: "event", id: id("77777777", 22), transition: "future.action.beta", objectType: "case_task", objectId: id("88888888", 3), role: "Service", at: "27.10 11:40", reason: null, profileHref: null },
  JOURNAL_EVENTS[2],
];
const JOURNAL_FACETS = { objectTypes: [{ key: "case_task", count: 2 }, { key: "student_case", count: 5 }] };
const GATES = { handoffs: 12, overrides: 1, financeStops: 2, evidence: 9, documents: 4 };

const delRow = (n, fields) => ({
  id: id("66666666", n), kind: "applicant", status: "pending", mode: "automatic", displayName: `Заявитель ${n}`, email: `person${n}@example.invalid`,
  studentCaseId: null, requestedAt: "2026-10-20T08:00:00.000Z", dueAt: "2026-11-19T08:00:00.000Z", overdue: false, processingStartedAt: null,
  completedAt: null, confirmationEmailStatus: null, applicationSubmitted: false, ...fields,
});
const DELETION_ROWS = [
  delRow(1, {}),
  delRow(2, { kind: "student", mode: "manual", displayName: "Студентка Вымышленная", studentCaseId: id("dddddddd", 41), requestedAt: "2026-09-20T08:00:00.000Z", dueAt: "2026-10-20T08:00:00.000Z", overdue: true, applicationSubmitted: null }),
  delRow(3, { status: "completed", completedAt: "2026-10-22T08:00:00.000Z", confirmationEmailStatus: "sent" }),
];
const detail = (row, fields) => ({
  ...row, reasons: [], otherTables: [], counts: { application: 1, profile: 1, consultations: 0, favourites: 3, tests: 2, journal: 4 },
  login: "active", authLog: null, manualNote: null, processingStartedBy: null, completedBy: null, ...fields,
});
const DELETION_DETAIL_AUTO = detail(DELETION_ROWS[0], {});
const DELETION_DETAIL_MANUAL = detail(DELETION_ROWS[1], { reasons: ["case", "payment"], otherTables: ["case_notes"] });
// Тот же ручной запрос, когда технический администратор уже отключил вход: кнопка «Отметить выполненным» доступна (сценарии Esc и щелчка мимо).
const DELETION_DETAIL_MANUAL_OFF = { ...DELETION_DETAIL_MANUAL, login: "disabled" };

const REPORT_LINK = (key, configured) => ({
  status: "available",
  link: { reportKey: key, configured, reportId: configured ? "abcdefgh12" : null, pageId: configured ? "pg01" : null, version: configured ? 3 : 0, updatedAt: configured ? "2026-10-27T09:32:00.000000+00:00" : null },
});

/** Настройки телефонии в форме чтения (`normalizeTelephonyOverview`, как в `platform-telephony-settings-ui.test.mjs`). */
function telephonyRead() {
  const { normalizeTelephonyOverview } = require(join(ROOT, "src/lib/v3/telephony-settings.ts"));
  const A = id("20000000", 2), B = id("20000000", 3);
  const overview = normalizeTelephonyOverview({
    schemaVersion: 1, organizationId: ORG, now: "2026-10-27T09:00:00.000Z",
    settings: {
      version: 3, updatedAt: null,
      flags: { projectionEnabled: true, uiEnabled: true, dialEnabled: false, missedTaskEnabled: false, unknownLeadEnabled: false, backfillEnabled: false, outboundPaused: false },
      hours: { timezone: "Asia/Bishkek", workingDays: [1, 2, 3, 4, 5, 6], workFrom: "10:00", workTo: "20:00", callbackWorkMinutes: 15 },
      escalationMembershipId: null,
      dial: { prefixes: ["+996"], limitUserDay: 150, limitUserGapSeconds: 5, limitOrgHour: 60, limitOrgDay: 400 },
      ceilings: { leadsHour: 10, leadsDay: 40, tasksHour: 30, tasksDay: 120 },
    },
    escalation: null,
    health: {
      status: "ok", now: "2026-10-27T09:00:00.000Z", flags: { projection_enabled: true, outbound_paused: false, backfill_enabled: false },
      directory: { active: 3, inactive: 1, unmapped: 2, last_seen_at: null },
      schedule: {
        retry_run_at: null, settle_run_at: null, users_sync_run_at: null, users_sync_success_at: null, reconcile_run_at: null, reconcile_success_at: null,
        reconcile_cursor_at: null, reconcile_lag_seconds: null, reconcile_daily_run_at: null, reconcile_daily_success_at: null, backfill_run_at: null,
        backfill_cursor_at: null, backfill_done_at: null, probe_run_at: null, probe_success_at: null,
      },
      pbx: { last_ok_at: null, last_error_at: null, last_error_code: null, facts: null },
      last_event_at: null, internal_calls_total: 0, evidence: { window_hours: 24, received: 0, rejected: 0, incomplete: 0 },
      automation_stop: { stopped_at: null, code: null }, summaries: {}, divergence: { window_hours: 24, reconciled_calls: 0, calls: 0 }, work: {},
    },
    extensions: [
      { id: id("50000000", 1), login: "u901", extension: "901", name: "Пользователь ВАТС 1", active: true, membershipId: A, membershipName: "Менеджер А", lastSeenAt: null, legsWithoutStaff: 0 },
      { id: id("50000000", 2), login: "u902", extension: "902", name: "Пользователь ВАТС 2", active: true, membershipId: null, membershipName: null, lastSeenAt: null, legsWithoutStaff: 3 },
    ],
    staff: [{ membershipId: A, name: "Менеджер А", canManage: true }, { membershipId: B, name: "Менеджер Б", canManage: false }],
  });
  return { status: "ready", overview, server: { ingestEnabled: true, crmKey: "configured", crmKeyRotating: false, pbx: "ready" }, inboundUrl: "https://crm.example.invalid/api/v2/telephony/inbound" };
}

/* ------------------------------------------------------------------ Маркетинг */

const basis = (utm, referrer, staff) => ({ utm, referrer, staff, corrected: 0, unknown: 0 });
const channelRow = (channel, leads, rest = {}) => ({
  channel, leads, qualified: Math.round(leads * 0.6), handedOff: Math.round(leads * 0.3), contract: Math.round(leads * 0.2), contractLinked: 0,
  paid: Math.round(leads * 0.15), paidWithoutAmount: 0, aiAssistant: 0, paidAmounts: leads ? [{ currency: "USD", amountMinor: String(leads * 40000), count: Math.round(leads * 0.15) }] : [],
  basis: basis(Math.round(leads / 2), 0, Math.round(leads / 2)), ...rest,
});
const OVERVIEW = {
  organizationId: ORG, from: "2026-10-01", to: "2026-10-27",
  cohort: {
    total: 48, openCount: 31, cabinetForms: 4, sourceKeys: { website: 10, whatsapp_manual: 20 }, repeatSubmissions: 3,
    totals: { leads: 48, qualified: 28, handedOff: 14, contract: 9, contractLinked: 1, paid: 7, paidWithoutAmount: 1 },
    channels: [channelRow("instagram_ads", 18), channelRow("instagram", 7), channelRow("website_search", 9, { aiAssistant: 2 }), channelRow("referral", 4), channelRow("other", 2), channelRow("unknown", 8, { basis: { utm: 0, referrer: 0, staff: 0, corrected: 0, unknown: 8 }, paidAmounts: [] })],
  },
  sales: {
    total: 9,
    channels: [
      { channel: "instagram_ads", contracts: 4, linkedManually: 0, amountMissing: 0, amounts: [{ currency: "USD", amountMinor: "640000", count: 4 }] },
      { channel: "website_search", contracts: 2, linkedManually: 1, amountMissing: 1, amounts: [{ currency: "USD", amountMinor: "180000", count: 1 }] },
      { channel: "without_lead", contracts: 3, linkedManually: 0, amountMissing: 0, amounts: [{ currency: "KGS", amountMinor: "9000000", count: 3 }] },
    ],
    reconciliation: { byChannelPlusWithoutLead: 9, reportSales: 9, difference: 0, matches: true },
  },
  spend: {
    insidePeriod: [
      { id: id("55555555", 1), periodStart: "2026-10-01", periodEnd: "2026-10-15", amountMinor: "120000", currency: "USD", campaign: "Малайзия, бакалавриат", note: "Meta Ads", createdAt: "2026-10-16T08:00:00.000Z" },
    ],
    insideTotals: [{ currency: "USD", amountMinor: "120000" }],
    partiallyOverlapping: [
      { id: id("55555555", 2), periodStart: "2026-09-25", periodEnd: "2026-10-05", amountMinor: "50000", currency: "USD", campaign: null, note: null, createdAt: "2026-10-06T08:00:00.000Z" },
    ],
  },
};
const lead = (n, fields) => ({
  leadId: id("44444444", n), name: `Лид Вымышленный ${n}`, phone: `+996 555 00${n}0 0${n}`, createdAt: `2026-10-2${n % 8}T0${n % 9}:15:00.000Z`, sourceKey: n % 2 ? "whatsapp_manual" : "website",
  channel: n % 3 === 0 ? "unknown" : "instagram_ads", basis: n % 3 === 0 ? "unknown" : "utm", corrected: false, aiAssistant: false,
  campaign: n % 3 === 0 ? null : "Малайзия, бакалавриат", landingPath: n % 3 === 0 ? null : "/malaysia", stage: "contacting", lifecycleState: "open",
  contractSignedOn: null, contractLinkedManually: false, paid: null, owner: { membershipId: ME, name: "Менеджер А" }, ...fields,
});
const LEADS = [
  lead(1, {}), lead(2, { stage: "handed_off", contractSignedOn: "2026-10-20", paid: { amountMinor: "150000", currency: "USD", source: "case" } }),
  lead(3, { owner: null }), lead(4, { stage: "closed", lifecycleState: "disqualified" }),
  lead(5, { name: null, phone: null, contractSignedOn: "2026-10-22", contractLinkedManually: true, paid: { amountMinor: null, currency: null, source: "gate" } }),
  lead(6, { channel: "unknown", basis: "unknown", campaign: null, landingPath: null }),
];
const LEADS_PAGE = { organizationId: ORG, from: "2026-10-01", to: "2026-10-27", total: 48, hasMore: true, nextCursor: { createdAt: "2026-10-21T04:15:00.000Z", id: LEADS[5].leadId }, rows: LEADS };

module.exports = {
  ORG, ME, ADMIN, STAFF, PREVIEW, id,
  settings: { DEPARTMENTS, MEMBERS, REQUESTS, STAFF_DATA, ROLES, ROLE_WORKSPACE, PROVIDERS, WAZZUP_TRANSPORT, JOURNAL_EVENTS, JOURNAL_UNNAMED, JOURNAL_FACETS, GATES, DELETION_ROWS, DELETION_DETAIL_AUTO, DELETION_DETAIL_MANUAL, DELETION_DETAIL_MANUAL_OFF, REPORT_LINK, telephonyRead },
  marketing: { OVERVIEW, LEADS_PAGE },
};
