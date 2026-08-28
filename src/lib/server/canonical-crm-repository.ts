import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import {
  evoConversations,
  evoLeads,
  evoMessages,
  evoPeople,
  evoSalesAdmissionsHandoffs,
  evoSalesGateEvidence,
  evoStudentCases,
} from "../../db/schema/canonical-crm-core.ts";
import {
  evoBusinessEvents,
  evoCommandReceipts,
} from "../../db/schema/canonical-crm-events.ts";
import {
  evoAdmissionsTasks,
  evoFinanceStopStates,
  evoUniversityApplications,
  evoVisaMilestones,
} from "../../db/schema/canonical-crm-operations.ts";
import {
  CANONICAL_SALES_DUE_FILTERS,
  CANONICAL_SALES_STAGES,
  type CanonicalSalesDueFilter,
  type CanonicalSalesStage,
} from "../canonical-sales-workflow-contract.ts";
import { isFixedRole, type FixedRole } from "../fixed-role-policy.ts";
import { getDatabase } from "./database.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const TASK_DUE_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export { CANONICAL_SALES_DUE_FILTERS, CANONICAL_SALES_STAGES };
export type { CanonicalSalesDueFilter, CanonicalSalesStage };

export const CANONICAL_STUDENT_CASE_STATUSES = [
  "active",
  "paused",
  "closed",
] as const;

export type CanonicalStudentCaseStatus =
  (typeof CANONICAL_STUDENT_CASE_STATUSES)[number];

export type CanonicalReadCursor = Readonly<{
  updatedAt: string;
  id: string;
}>;

export type CanonicalMessageCursor = Readonly<{
  occurredAt: string;
  id: string;
}>;

export type CanonicalStudentCaseQueueRow = Readonly<{
  studentCaseId: string;
  leadId: string;
  personId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: CanonicalStudentCaseStatus;
  assignedRole: FixedRole;
  createdAt: string;
  updatedAt: string;
}>;

export type CanonicalStudentCaseQueuePage = Readonly<{
  rows: readonly CanonicalStudentCaseQueueRow[];
  hasNext: boolean;
  nextCursor: CanonicalReadCursor | null;
}>;

export const CANONICAL_CRM_ERROR_CODES = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "idempotency_conflict",
  "gate_unsatisfied",
  "unavailable",
] as const;

export type CanonicalCrmErrorCode =
  (typeof CANONICAL_CRM_ERROR_CODES)[number];

export class CanonicalCrmRepositoryError extends Error {
  readonly code: CanonicalCrmErrorCode;

  constructor(code: CanonicalCrmErrorCode) {
    super("Canonical CRM operation failed.");
    this.name = "CanonicalCrmRepositoryError";
    this.code = code;
  }
}

export type CanonicalPersonIdentity = Readonly<{
  displayName: string;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
}>;

export type CanonicalLeadSnapshot = Readonly<{
  leadId: string;
  personId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  source: string;
  stage: CanonicalSalesStage;
  ownerRole: FixedRole;
  qualificationSummary: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CanonicalLeadGateEvidenceSnapshot = Readonly<{
  evidenceId: string;
  evidenceType: "contract" | "first_payment";
  decision: "confirmed" | "rejected";
  evidenceReference: string;
  amountMinor: number | null;
  currency: string | null;
  recordedByRole: FixedRole;
  occurredAt: string;
  reason: string | null;
  createdAt: string;
}>;

export type CanonicalLeadGateState = "blocked" | "satisfied" | "overridden";

export type CanonicalLeadGateSnapshot = Readonly<{
  leadId: string;
  state: CanonicalLeadGateState;
  normalHandoffAllowed: boolean;
  exceptionalHandoffAllowed: boolean;
  contractEvidence: CanonicalLeadGateEvidenceSnapshot | null;
  firstPaymentEvidence: CanonicalLeadGateEvidenceSnapshot | null;
  handoff:
    | Readonly<{
        handoffId: string;
        studentCaseId: string;
        isOverride: boolean;
        executedByRole: FixedRole;
        executedAt: string;
      }>
    | null;
  updatedAt: string;
}>;

export type CanonicalSalesLeadQueueRow = CanonicalLeadSnapshot;

export type CanonicalSalesLeadQueuePage = Readonly<{
  rows: readonly CanonicalSalesLeadQueueRow[];
  hasNext: boolean;
  nextCursor: CanonicalReadCursor | null;
}>;

export type CanonicalLeadConversationSummary = Readonly<{
  conversationId: string;
  leadId: string;
  channel: "whatsapp";
  externalConversationId: string | null;
  status: "open" | "closed";
  owningRole: "sales" | "admissions";
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CanonicalConversationMessage = Readonly<{
  messageId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  externalMessageId: string | null;
  body: string;
  authorRole: FixedRole | null;
  occurredAt: string;
  createdAt: string;
}>;

export type CanonicalLeadConversationThread = Readonly<{
  conversation: CanonicalLeadConversationSummary;
  messages: readonly CanonicalConversationMessage[];
  hasNext: boolean;
  nextCursor: CanonicalMessageCursor | null;
}>;

export type CanonicalStudentCaseSnapshot = Readonly<{
  studentCaseId: string;
  leadId: string;
  personId: string;
  displayName: string;
  status: CanonicalStudentCaseStatus;
  assignedRole: FixedRole;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CanonicalAdmissionsStarterTaskSnapshot = Readonly<{
  taskId: string;
  title: string;
  details: string | null;
  status: "open" | "completed" | "cancelled";
  dueAt: string | null;
  createdAt: string;
}>;

export type CanonicalAdmissionsTaskStatus =
  | "open"
  | "completed"
  | "cancelled";

export type CanonicalAdmissionsTaskQueueRow = Readonly<{
  taskId: string;
  studentCaseId: string;
  title: string;
  details: string | null;
  status: CanonicalAdmissionsTaskStatus;
  dueAt: string | null;
  assignedRole: "admissions";
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByRole: "admin" | "admissions" | null;
  closureReason: string | null;
  studentCaseStatus: CanonicalStudentCaseStatus;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type CanonicalAdmissionsTaskQueuePage = Readonly<{
  rows: readonly CanonicalAdmissionsTaskQueueRow[];
  hasNext: boolean;
}>;

export type CanonicalAdmissionsTaskResult = Readonly<{
  taskId: string;
  studentCaseId: string;
  status: CanonicalAdmissionsTaskStatus;
  version: number;
}>;

export const CANONICAL_UNIVERSITY_APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

export type CanonicalUniversityApplicationStatus =
  (typeof CANONICAL_UNIVERSITY_APPLICATION_STATUSES)[number];

export const CANONICAL_VISA_MILESTONE_KINDS = [
  "document_preparation",
  "appointment",
  "submission",
  "biometrics",
  "interview",
  "decision",
] as const;

export type CanonicalVisaMilestoneKind =
  (typeof CANONICAL_VISA_MILESTONE_KINDS)[number];

export const CANONICAL_VISA_MILESTONE_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
] as const;

export type CanonicalVisaMilestoneStatus =
  (typeof CANONICAL_VISA_MILESTONE_STATUSES)[number];

export type CanonicalUniversityApplicationRow = Readonly<{
  applicationId: string;
  studentCaseId: string;
  institutionName: string;
  programName: string;
  targetIntake: string;
  status: CanonicalUniversityApplicationStatus;
  ownerRole: "admissions";
  nextAction: string | null;
  nextActionAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  studentCaseStatus: CanonicalStudentCaseStatus;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type CanonicalUniversityApplicationQueuePage = Readonly<{
  rows: readonly CanonicalUniversityApplicationRow[];
  hasNext: boolean;
  nextCursor: CanonicalReadCursor | null;
}>;

export type CanonicalUniversityApplicationResult = Readonly<{
  applicationId: string;
  studentCaseId: string;
  status: CanonicalUniversityApplicationStatus;
  version: number;
}>;

export type CanonicalVisaMilestoneRow = Readonly<{
  visaMilestoneId: string;
  studentCaseId: string;
  milestoneKind: CanonicalVisaMilestoneKind;
  status: CanonicalVisaMilestoneStatus;
  ownerRole: "admissions";
  nextAction: string | null;
  nextActionAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  blockedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  studentCaseStatus: CanonicalStudentCaseStatus;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type CanonicalVisaMilestoneQueuePage = Readonly<{
  rows: readonly CanonicalVisaMilestoneRow[];
  hasNext: boolean;
  nextCursor: CanonicalReadCursor | null;
}>;

export type CanonicalVisaMilestoneResult = Readonly<{
  visaMilestoneId: string;
  studentCaseId: string;
  milestoneKind: CanonicalVisaMilestoneKind;
  status: CanonicalVisaMilestoneStatus;
  version: number;
}>;

export type CanonicalFinanceStopRow = Readonly<{
  financeStopId: string;
  studentCaseId: string;
  isStopped: boolean;
  reason: string;
  changedByRole: "admin" | "admissions";
  version: number;
  changedAt: string;
  studentCaseStatus: CanonicalStudentCaseStatus;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type CanonicalFinanceStopQueuePage = Readonly<{
  rows: readonly CanonicalFinanceStopRow[];
  hasNext: boolean;
  nextCursor: CanonicalReadCursor | null;
}>;

export type CanonicalFinanceStopResult = Readonly<{
  financeStopId: string;
  studentCaseId: string;
  isStopped: boolean;
  version: number;
}>;

export type CanonicalAdmissionsOperationsSnapshot = Readonly<{
  studentCase: CanonicalStudentCaseSnapshot;
  applications: readonly CanonicalUniversityApplicationRow[];
  visaMilestones: readonly CanonicalVisaMilestoneRow[];
  financeStop: CanonicalFinanceStopRow | null;
}>;

export type CanonicalStudentCaseHandoffSnapshot = Readonly<{
  studentCase: CanonicalStudentCaseSnapshot;
  handoff: Readonly<{
    handoffId: string;
    leadId: string;
    isOverride: boolean;
    overrideReason: string | null;
    executedByRole: FixedRole;
    executedAt: string;
    contractEvidenceId: string | null;
    firstPaymentEvidenceId: string | null;
  }>;
  starterTasks: readonly CanonicalAdmissionsStarterTaskSnapshot[];
}>;

export type CanonicalInboundMessageResult = Readonly<{
  conversationId: string;
  messageId: string;
  leadId: string;
}>;

export type CanonicalSalesGateEvidenceResult = Readonly<{
  evidenceId: string;
  leadId: string;
  evidenceType: "contract" | "first_payment";
  decision: "confirmed" | "rejected";
}>;

export type CanonicalHandoffResult = Readonly<{
  handoffId: string;
  studentCaseId: string;
  leadId: string;
  isOverride: boolean;
}>;

type CommandContext = Readonly<{
  actorRole: FixedRole;
  idempotencyKey: string;
  correlationId: string;
}>;

const CANONICAL_ADMISSIONS_STARTER_TASKS = [
  {
    title: "Проверить унаследованный контекст Sales",
    details:
      "Проверьте qualification summary, последние входящие сообщения и статус handoff перед началом Admissions работы.",
  },
  {
    title: "Подтвердить маршрут обучения и недостающие данные",
    details:
      "Сверьте программу, страну, intake и список недостающих данных, чтобы открыть следующий admissions шаг без догадок.",
  },
  {
    title: "Подготовить первичный план запроса документов",
    details:
      "Зафиксируйте минимальный стартовый план по документам после передачи кейса в Admissions.",
  },
] as const;

function invalidInput(): never {
  throw new CanonicalCrmRepositoryError("invalid_input");
}

function boundedText(
  value: unknown,
  options: Readonly<{ maxLength: number; collapseWhitespace?: boolean }>,
): string {
  if (typeof value !== "string") invalidInput();
  const normalized = options.collapseWhitespace
    ? value.trim().replace(/\s+/g, " ")
    : value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > options.maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    invalidInput();
  }
  return normalized;
}

function optionalBoundedText(
  value: unknown,
  options: Readonly<{ maxLength: number; collapseWhitespace?: boolean }>,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return boundedText(value, options);
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalidInput();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) invalidInput();
  return normalized;
}

function isCanonicalStudentCaseStatus(
  value: unknown,
): value is CanonicalStudentCaseStatus {
  return CANONICAL_STUDENT_CASE_STATUSES.some((status) => status === value);
}

function isCanonicalSalesStage(value: unknown): value is CanonicalSalesStage {
  return CANONICAL_SALES_STAGES.some((stage) => stage === value);
}

function optionalCanonicalSalesStage(
  value: unknown,
): CanonicalSalesStage | undefined {
  if (value === undefined) return undefined;
  if (!isCanonicalSalesStage(value)) invalidInput();
  return value;
}

function canonicalSalesDueFilter(value: unknown): CanonicalSalesDueFilter {
  if (value === undefined) return "all";
  if (!CANONICAL_SALES_DUE_FILTERS.some((filter) => filter === value)) {
    invalidInput();
  }
  return value as CanonicalSalesDueFilter;
}

function optionalCanonicalReadCursor(
  value: unknown,
): CanonicalReadCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidInput();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "id" || keys[1] !== "updatedAt") {
    invalidInput();
  }
  return parseCanonicalReadCursor(record.updatedAt, record.id);
}

function canonicalReadPageSize(value: unknown): number {
  if (value === undefined) return 25;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 50
  ) {
    invalidInput();
  }
  return value as number;
}

function canonicalReadQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalidInput();
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > 120 || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    invalidInput();
  }
  return normalized;
}

function literalLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function canonicalSalesDueCondition(filter: CanonicalSalesDueFilter) {
  switch (filter) {
    case "all":
      return undefined;
    case "scheduled":
      return isNotNull(evoLeads.nextActionAt);
    case "unscheduled":
      return isNull(evoLeads.nextActionAt);
    case "due_today":
      return sql<boolean>`(${evoLeads.nextActionAt} at time zone 'Asia/Bishkek')::date = (now() at time zone 'Asia/Bishkek')::date`;
    case "overdue":
      return sql<boolean>`(${evoLeads.nextActionAt} at time zone 'Asia/Bishkek')::date < (now() at time zone 'Asia/Bishkek')::date`;
  }
}

export function parseCanonicalReadCursor(
  updatedAt: unknown,
  id: unknown,
): CanonicalReadCursor {
  if (typeof updatedAt !== "string") invalidInput();
  const match = ISO_TIMESTAMP_PATTERN.exec(updatedAt);
  if (!match) invalidInput();

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Number(match[7]) > 23 ||
    Number(match[8]) > 59
  ) {
    invalidInput();
  }

  const parsed = new Date(updatedAt);
  if (!Number.isFinite(parsed.getTime())) invalidInput();
  return { updatedAt: parsed.toISOString(), id: uuid(id) };
}

export function parseCanonicalMessageCursor(
  occurredAt: unknown,
  id: unknown,
): CanonicalMessageCursor {
  const cursor = parseCanonicalReadCursor(occurredAt, id);
  return { occurredAt: cursor.updatedAt, id: cursor.id };
}

function optionalCanonicalMessageCursor(
  value: unknown,
): CanonicalMessageCursor | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) invalidInput();
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(
      (key) => key !== "occurredAt" && key !== "id",
    )
  ) {
    invalidInput();
  }
  return parseCanonicalMessageCursor(candidate.occurredAt, candidate.id);
}

function fixedRole(value: unknown): FixedRole {
  if (!isFixedRole(value)) invalidInput();
  return value;
}

function actorRole(
  value: unknown,
  allowedRoles: readonly FixedRole[],
): FixedRole {
  const role = fixedRole(value);
  if (!allowedRoles.includes(role)) {
    throw new CanonicalCrmRepositoryError("forbidden");
  }
  return role;
}

function commandKey(value: unknown): string {
  return boundedText(value, { maxLength: 160 });
}

function correlationId(value: unknown): string {
  return boundedText(value, { maxLength: 160 });
}

function source(value: unknown): string {
  return boundedText(value, { maxLength: 80 });
}

function externalIdentifier(value: unknown): string {
  return boundedText(value, { maxLength: 255 });
}

function messageBody(value: unknown): string {
  if (typeof value !== "string") invalidInput();
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 65_535 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) {
    invalidInput();
  }
  return normalized;
}

function isoTimestamp(value: unknown): Date {
  if (typeof value !== "string" || value.length > 40) invalidInput();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalidInput();
  return parsed;
}

function canonicalTaskDueAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) invalidInput();
  const match = TASK_DUE_TIMESTAMP_PATTERN.exec(value);
  if (!match) invalidInput();

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    (match[7] !== undefined && Number(match[7]) > 23) ||
    (match[8] !== undefined && Number(match[8]) > 59)
  ) {
    invalidInput();
  }

  return isoTimestamp(value);
}

function canonicalSalesDeadline(value: unknown): Date {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    invalidInput();
  }
  const parsed = new Date(`${value}T03:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    invalidInput();
  }
  return parsed;
}

function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalidInput();
  return Number(value);
}

function nonNegativeVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidInput();
  return Number(value);
}

function requiredOperationsTimestamp(value: unknown): Date {
  const timestamp = canonicalTaskDueAt(value);
  if (!timestamp) invalidInput();
  return timestamp;
}

function isCanonicalUniversityApplicationStatus(
  value: unknown,
): value is CanonicalUniversityApplicationStatus {
  return CANONICAL_UNIVERSITY_APPLICATION_STATUSES.some(
    (status) => status === value,
  );
}

function canonicalUniversityApplicationTransitionStatus(
  value: unknown,
): Exclude<CanonicalUniversityApplicationStatus, "draft"> {
  if (
    value === "submitted" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "withdrawn"
  ) {
    return value;
  }
  invalidInput();
}

function isCanonicalVisaMilestoneKind(
  value: unknown,
): value is CanonicalVisaMilestoneKind {
  return CANONICAL_VISA_MILESTONE_KINDS.some((kind) => kind === value);
}

function isCanonicalVisaMilestoneStatus(
  value: unknown,
): value is CanonicalVisaMilestoneStatus {
  return CANONICAL_VISA_MILESTONE_STATUSES.some((status) => status === value);
}

function canonicalVisaMilestoneTransitionStatus(
  value: unknown,
): Exclude<CanonicalVisaMilestoneStatus, "pending"> {
  if (
    value === "in_progress" ||
    value === "completed" ||
    value === "blocked"
  ) {
    return value;
  }
  invalidInput();
}

function sha256(value: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const email = boundedText(value, { maxLength: 320 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) invalidInput();
  return email;
}

function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    invalidInput();
  }
  const trimmed = value.trim();
  if (!/^\+[0-9 ()-]+$/.test(trimmed)) invalidInput();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || digits.startsWith("0")) {
    invalidInput();
  }
  return `+${digits}`;
}

export function normalizeCanonicalPersonIdentity(
  input: Readonly<{
    displayName: unknown;
    email?: unknown;
    phone?: unknown;
  }>,
): CanonicalPersonIdentity {
  const identity = {
    displayName: boundedText(input.displayName, {
      maxLength: 200,
      collapseWhitespace: true,
    }),
    normalizedEmail: normalizeEmail(input.email),
    normalizedPhone: normalizePhone(input.phone),
  };
  if (!identity.normalizedEmail && !identity.normalizedPhone) invalidInput();
  return identity;
}

function parseCommandContext(
  input: Readonly<{
    actorRole: unknown;
    idempotencyKey: unknown;
    correlationId: unknown;
  }>,
  allowedRoles: readonly FixedRole[],
): CommandContext {
  return {
    actorRole: actorRole(input.actorRole, allowedRoles),
    idempotencyKey: commandKey(input.idempotencyKey),
    correlationId: correlationId(input.correlationId),
  };
}

type Database = ReturnType<typeof getDatabase>;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type ReceiptReservation =
  | Readonly<{ kind: "new"; receiptId: string }>
  | Readonly<{ kind: "replay"; resultPayload: Record<string, unknown> }>;

async function reserveCommand(
  transaction: DatabaseTransaction,
  input: Readonly<{
    commandName: string;
    context: CommandContext;
    requestHash: string;
  }>,
): Promise<ReceiptReservation> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.context.idempotencyKey}, 0))`,
  );

  const existingReceipts = await transaction
    .select({
      commandName: evoCommandReceipts.commandName,
      requestHash: evoCommandReceipts.requestHash,
      actorRole: evoCommandReceipts.actorRole,
      status: evoCommandReceipts.status,
      resultPayload: evoCommandReceipts.resultPayload,
    })
    .from(evoCommandReceipts)
    .where(eq(evoCommandReceipts.idempotencyKey, input.context.idempotencyKey))
    .limit(2);

  if (existingReceipts.length > 1) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  const [existing] = existingReceipts;
  if (existing) {
    if (
      existing.commandName !== input.commandName ||
      existing.requestHash !== input.requestHash ||
      existing.actorRole !== input.context.actorRole
    ) {
      throw new CanonicalCrmRepositoryError("idempotency_conflict");
    }
    if (existing.status !== "succeeded" || !existing.resultPayload) {
      throw new CanonicalCrmRepositoryError("unavailable");
    }
    return { kind: "replay", resultPayload: existing.resultPayload };
  }

  const receiptId = randomUUID();
  const [inserted] = await transaction
    .insert(evoCommandReceipts)
    .values({
      id: receiptId,
      commandName: input.commandName,
      idempotencyKey: input.context.idempotencyKey,
      requestHash: input.requestHash,
      correlationId: input.context.correlationId,
      actorRole: input.context.actorRole,
      status: "processing",
    })
    .onConflictDoNothing({
      target: evoCommandReceipts.idempotencyKey,
    })
    .returning({ id: evoCommandReceipts.id });

  if (!inserted) throw new CanonicalCrmRepositoryError("unavailable");
  return { kind: "new", receiptId };
}

async function completeCommand(
  transaction: DatabaseTransaction,
  input: Readonly<{
    receiptId: string;
    businessObjectType: string;
    businessObjectId: string;
    resultPayload: Record<string, unknown>;
  }>,
): Promise<void> {
  const [completed] = await transaction
    .update(evoCommandReceipts)
    .set({
      businessObjectType: input.businessObjectType,
      businessObjectId: input.businessObjectId,
      status: "succeeded",
      resultPayload: input.resultPayload,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(evoCommandReceipts.id, input.receiptId))
    .returning({ id: evoCommandReceipts.id });
  if (!completed) throw new CanonicalCrmRepositoryError("unavailable");
}

async function insertBusinessEvent(
  transaction: DatabaseTransaction,
  input: Readonly<{
    context: CommandContext;
    businessObjectType: string;
    businessObjectId: string;
    transition: string;
    fromState?: string | null;
    toState?: string | null;
    reason?: string | null;
    eventSequence?: number;
  }>,
): Promise<string> {
  const eventId = randomUUID();
  await transaction.insert(evoBusinessEvents).values({
    id: eventId,
    actorRole: input.context.actorRole,
    businessObjectType: input.businessObjectType,
    businessObjectId: input.businessObjectId,
    transition: input.transition,
    fromState: input.fromState ?? null,
    toState: input.toState ?? null,
    reason: input.reason ?? null,
    correlationId: input.context.correlationId,
    idempotencyKey: input.context.idempotencyKey,
    eventSequence: input.eventSequence ?? 1,
  });
  return eventId;
}

function resultUuid(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value.toLowerCase();
}

function resultString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function resultBoolean(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function resultPositiveVersion(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return Number(value);
}

function resultTaskStatus(
  payload: Record<string, unknown>,
  key: string,
): CanonicalAdmissionsTaskStatus {
  return databaseTaskStatus(resultString(payload, key));
}

function resultUniversityApplicationStatus(
  payload: Record<string, unknown>,
  key: string,
): CanonicalUniversityApplicationStatus {
  return databaseUniversityApplicationStatus(resultString(payload, key));
}

function resultVisaMilestoneKind(
  payload: Record<string, unknown>,
  key: string,
): CanonicalVisaMilestoneKind {
  return databaseVisaMilestoneKind(resultString(payload, key));
}

function resultVisaMilestoneStatus(
  payload: Record<string, unknown>,
  key: string,
): CanonicalVisaMilestoneStatus {
  return databaseVisaMilestoneStatus(resultString(payload, key));
}

async function runTransaction<T>(
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await getDatabase().transaction(operation);
  } catch (error) {
    if (error instanceof CanonicalCrmRepositoryError) throw error;
    throw new CanonicalCrmRepositoryError("unavailable");
  }
}

function databaseRole(value: string): FixedRole {
  if (!isFixedRole(value)) throw new CanonicalCrmRepositoryError("unavailable");
  return value;
}

function databaseSalesOwnerRole(value: string): "sales" {
  if (value !== "sales") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseSalesStage(value: string): CanonicalSalesStage {
  if (!isCanonicalSalesStage(value)) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseStudentCaseStatus(value: string): CanonicalStudentCaseStatus {
  if (!isCanonicalStudentCaseStatus(value)) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseConversationChannel(value: string): "whatsapp" {
  if (value !== "whatsapp") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseConversationStatus(value: string): "open" | "closed" {
  if (value !== "open" && value !== "closed") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseConversationOwningRole(
  value: string,
): "sales" | "admissions" {
  if (value !== "sales" && value !== "admissions") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseMessageDirection(value: string): "inbound" | "outbound" {
  if (value !== "inbound" && value !== "outbound") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function dateString(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value.toISOString();
}

function optionalDateString(value: Date | null): string | null {
  return value === null ? null : dateString(value);
}

function databaseTaskStatus(
  value: string,
): CanonicalAdmissionsTaskStatus {
  if (value !== "open" && value !== "completed" && value !== "cancelled") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseAdmissionsTaskRole(value: string): "admissions" {
  if (value !== "admissions") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseAdmissionsOperationsRole(value: string): "admissions" {
  if (value !== "admissions") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseAdmissionsOperationsActorRole(
  value: string,
): "admin" | "admissions" {
  if (value !== "admin" && value !== "admissions") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseUniversityApplicationStatus(
  value: string,
): CanonicalUniversityApplicationStatus {
  if (!isCanonicalUniversityApplicationStatus(value)) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseVisaMilestoneKind(
  value: string,
): CanonicalVisaMilestoneKind {
  if (!isCanonicalVisaMilestoneKind(value)) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseVisaMilestoneStatus(
  value: string,
): CanonicalVisaMilestoneStatus {
  if (!isCanonicalVisaMilestoneStatus(value)) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

type UniversityApplicationDatabaseRow = Readonly<{
  applicationId: string;
  studentCaseId: string;
  institutionName: string;
  programName: string;
  targetIntake: string;
  status: string;
  ownerRole: string;
  nextAction: string | null;
  nextActionAt: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  studentCaseStatus: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

function canonicalUniversityApplicationRow(
  row: UniversityApplicationDatabaseRow,
): CanonicalUniversityApplicationRow {
  return {
    ...row,
    status: databaseUniversityApplicationStatus(row.status),
    ownerRole: databaseAdmissionsOperationsRole(row.ownerRole),
    nextActionAt: optionalDateString(row.nextActionAt),
    submittedAt: optionalDateString(row.submittedAt),
    decidedAt: optionalDateString(row.decidedAt),
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
    studentCaseStatus: databaseStudentCaseStatus(row.studentCaseStatus),
  };
}

type VisaMilestoneDatabaseRow = Readonly<{
  visaMilestoneId: string;
  studentCaseId: string;
  milestoneKind: string;
  status: string;
  ownerRole: string;
  nextAction: string | null;
  nextActionAt: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
  blockedReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  studentCaseStatus: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

function canonicalVisaMilestoneRow(
  row: VisaMilestoneDatabaseRow,
): CanonicalVisaMilestoneRow {
  return {
    ...row,
    milestoneKind: databaseVisaMilestoneKind(row.milestoneKind),
    status: databaseVisaMilestoneStatus(row.status),
    ownerRole: databaseAdmissionsOperationsRole(row.ownerRole),
    nextActionAt: optionalDateString(row.nextActionAt),
    dueAt: optionalDateString(row.dueAt),
    completedAt: optionalDateString(row.completedAt),
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
    studentCaseStatus: databaseStudentCaseStatus(row.studentCaseStatus),
  };
}

type FinanceStopDatabaseRow = Readonly<{
  financeStopId: string;
  studentCaseId: string;
  isStopped: boolean;
  reason: string;
  changedByRole: string;
  version: number;
  changedAt: Date;
  studentCaseStatus: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

function canonicalFinanceStopRow(
  row: FinanceStopDatabaseRow,
): CanonicalFinanceStopRow {
  return {
    ...row,
    changedByRole: databaseAdmissionsOperationsActorRole(row.changedByRole),
    changedAt: dateString(row.changedAt),
    studentCaseStatus: databaseStudentCaseStatus(row.studentCaseStatus),
  };
}

function databaseTaskClosedByRole(
  value: string | null,
): "admin" | "admissions" | null {
  if (value !== null && value !== "admin" && value !== "admissions") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function databaseGateState(
  value: string,
): "blocked" | "satisfied" | "overridden" {
  if (value !== "blocked" && value !== "satisfied" && value !== "overridden") {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return value;
}

function isConfirmedEvidence(
  evidence: Pick<CanonicalLeadGateEvidenceSnapshot, "decision"> | null,
): boolean {
  return evidence?.decision === "confirmed";
}

function deriveLeadGateState(input: Readonly<{
  contractEvidence: CanonicalLeadGateEvidenceSnapshot | null;
  firstPaymentEvidence: CanonicalLeadGateEvidenceSnapshot | null;
  handoffIsOverride: boolean;
}>): CanonicalLeadGateState {
  if (input.handoffIsOverride) return "overridden";
  if (
    isConfirmedEvidence(input.contractEvidence) &&
    isConfirmedEvidence(input.firstPaymentEvidence)
  ) {
    return "satisfied";
  }
  return "blocked";
}

async function requireHandedOffStudentCase(
  transaction: DatabaseTransaction,
  studentCaseId: string,
): Promise<void> {
  const [studentCase] = await transaction
    .select({
      leadId: evoStudentCases.leadId,
      status: evoStudentCases.status,
      ownerRole: evoStudentCases.ownerRole,
    })
    .from(evoStudentCases)
    .where(eq(evoStudentCases.id, studentCaseId))
    .limit(1);
  if (!studentCase) throw new CanonicalCrmRepositoryError("not_found");
  databaseAdmissionsTaskRole(studentCase.ownerRole);
  databaseStudentCaseStatus(studentCase.status);

  const [handoff] = await transaction
    .select({
      id: evoSalesAdmissionsHandoffs.id,
      leadStage: evoLeads.stage,
    })
    .from(evoSalesAdmissionsHandoffs)
    .innerJoin(evoLeads, eq(evoLeads.id, evoSalesAdmissionsHandoffs.leadId))
    .where(
      and(
        eq(evoSalesAdmissionsHandoffs.studentCaseId, studentCaseId),
        eq(evoSalesAdmissionsHandoffs.leadId, studentCase.leadId),
      ),
    )
    .limit(1);
  if (!handoff || databaseSalesStage(handoff.leadStage) !== "handed_off") {
    throw new CanonicalCrmRepositoryError("conflict");
  }
}

async function lockActiveHandedOffStudentCase(
  transaction: DatabaseTransaction,
  studentCaseId: string,
): Promise<void> {
  const [studentCase] = await transaction
    .select({
      id: evoStudentCases.id,
      leadId: evoStudentCases.leadId,
      status: evoStudentCases.status,
      ownerRole: evoStudentCases.ownerRole,
    })
    .from(evoStudentCases)
    .where(eq(evoStudentCases.id, studentCaseId))
    .limit(1)
    .for("update");
  if (!studentCase) throw new CanonicalCrmRepositoryError("not_found");
  databaseAdmissionsTaskRole(studentCase.ownerRole);
  if (databaseStudentCaseStatus(studentCase.status) !== "active") {
    throw new CanonicalCrmRepositoryError("conflict");
  }

  const [handoff] = await transaction
    .select({
      id: evoSalesAdmissionsHandoffs.id,
      leadStage: evoLeads.stage,
    })
    .from(evoSalesAdmissionsHandoffs)
    .innerJoin(evoLeads, eq(evoLeads.id, evoSalesAdmissionsHandoffs.leadId))
    .where(
      and(
        eq(evoSalesAdmissionsHandoffs.studentCaseId, studentCaseId),
        eq(evoSalesAdmissionsHandoffs.leadId, studentCase.leadId),
      ),
    )
    .limit(1);
  if (!handoff || databaseSalesStage(handoff.leadStage) !== "handed_off") {
    throw new CanonicalCrmRepositoryError("conflict");
  }
}

async function requireFinanceProgressAllowed(
  transaction: DatabaseTransaction,
  studentCaseId: string,
): Promise<void> {
  const [financeStop] = await transaction
    .select({ isStopped: evoFinanceStopStates.isStopped })
    .from(evoFinanceStopStates)
    .where(eq(evoFinanceStopStates.studentCaseId, studentCaseId))
    .limit(1);
  if (financeStop?.isStopped) {
    throw new CanonicalCrmRepositoryError("gate_unsatisfied");
  }
}

async function selectLatestGateEvidence(
  transaction: DatabaseTransaction,
  leadId: string,
  evidenceType: "contract" | "first_payment",
): Promise<CanonicalLeadGateEvidenceSnapshot | null> {
  const [row] = await transaction
    .select({
      evidenceId: evoSalesGateEvidence.id,
      evidenceType: evoSalesGateEvidence.evidenceType,
      decision: evoSalesGateEvidence.decision,
      evidenceReference: evoSalesGateEvidence.evidenceReference,
      amountMinor: evoSalesGateEvidence.amountMinor,
      currency: evoSalesGateEvidence.currency,
      recordedByRole: evoSalesGateEvidence.recordedByRole,
      occurredAt: evoSalesGateEvidence.occurredAt,
      reason: evoSalesGateEvidence.reason,
      createdAt: evoSalesGateEvidence.createdAt,
    })
    .from(evoSalesGateEvidence)
    .where(
      and(
        eq(evoSalesGateEvidence.leadId, leadId),
        eq(evoSalesGateEvidence.evidenceType, evidenceType),
      ),
    )
    .orderBy(
      desc(evoSalesGateEvidence.occurredAt),
      desc(evoSalesGateEvidence.createdAt),
      desc(evoSalesGateEvidence.id),
    )
    .limit(1);

  if (!row) return null;
  if (
    (row.evidenceType !== "contract" && row.evidenceType !== "first_payment") ||
    (row.decision !== "confirmed" && row.decision !== "rejected")
  ) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }
  return {
    ...row,
    evidenceType: row.evidenceType,
    decision: row.decision,
    recordedByRole: databaseRole(row.recordedByRole),
    occurredAt: dateString(row.occurredAt),
    createdAt: dateString(row.createdAt),
  };
}

async function selectLeadSnapshot(
  transaction: DatabaseTransaction,
  leadId: string,
): Promise<CanonicalLeadSnapshot> {
  const [row] = await transaction
    .select({
      leadId: evoLeads.id,
      personId: evoPeople.id,
      displayName: evoPeople.fullName,
      email: evoPeople.email,
      phone: evoPeople.phoneE164,
      source: evoLeads.source,
      stage: evoLeads.stage,
      ownerRole: evoLeads.ownerRole,
      qualificationSummary: evoLeads.qualificationSummary,
      nextAction: evoLeads.nextAction,
      nextActionAt: evoLeads.nextActionAt,
      version: evoLeads.version,
      createdAt: evoLeads.createdAt,
      updatedAt: evoLeads.updatedAt,
    })
    .from(evoLeads)
    .innerJoin(evoPeople, eq(evoPeople.id, evoLeads.personId))
    .where(eq(evoLeads.id, leadId))
    .limit(1);
  if (!row) throw new CanonicalCrmRepositoryError("not_found");
  return {
    ...row,
    stage: databaseSalesStage(row.stage),
    ownerRole: databaseSalesOwnerRole(row.ownerRole),
    nextActionAt: optionalDateString(row.nextActionAt),
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
  };
}

async function selectStudentCaseSnapshot(
  transaction: DatabaseTransaction,
  studentCaseId: string,
): Promise<CanonicalStudentCaseSnapshot> {
  const [row] = await transaction
    .select({
      studentCaseId: evoStudentCases.id,
      leadId: evoStudentCases.leadId,
      personId: evoStudentCases.personId,
      displayName: evoPeople.fullName,
      status: evoStudentCases.status,
      assignedRole: evoStudentCases.ownerRole,
      version: evoStudentCases.version,
      createdAt: evoStudentCases.createdAt,
      updatedAt: evoStudentCases.updatedAt,
    })
    .from(evoStudentCases)
    .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
    .where(eq(evoStudentCases.id, studentCaseId))
    .limit(1);
  if (!row) throw new CanonicalCrmRepositoryError("not_found");
  return {
    ...row,
    status: databaseStudentCaseStatus(row.status),
    assignedRole: databaseRole(row.assignedRole),
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
  };
}

async function selectLeadGateSnapshot(
  transaction: DatabaseTransaction,
  leadId: string,
): Promise<CanonicalLeadGateSnapshot> {
  const lead = await selectLeadSnapshot(transaction, leadId);
  const [contractEvidence, firstPaymentEvidence, handoffRow] = await Promise.all([
    selectLatestGateEvidence(transaction, leadId, "contract"),
    selectLatestGateEvidence(transaction, leadId, "first_payment"),
    transaction
      .select({
        handoffId: evoSalesAdmissionsHandoffs.id,
        studentCaseId: evoSalesAdmissionsHandoffs.studentCaseId,
        isOverride: evoSalesAdmissionsHandoffs.isOverride,
        executedByRole: evoSalesAdmissionsHandoffs.executedByRole,
        executedAt: evoSalesAdmissionsHandoffs.executedAt,
      })
      .from(evoSalesAdmissionsHandoffs)
      .where(eq(evoSalesAdmissionsHandoffs.leadId, leadId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const state = deriveLeadGateState({
    contractEvidence,
    firstPaymentEvidence,
    handoffIsOverride: handoffRow?.isOverride ?? false,
  });

  return {
    leadId,
    state: databaseGateState(state),
    normalHandoffAllowed: state === "satisfied" && handoffRow === null,
    exceptionalHandoffAllowed: state === "blocked" && handoffRow === null,
    contractEvidence,
    firstPaymentEvidence,
    handoff: handoffRow
      ? {
          ...handoffRow,
          executedByRole: databaseRole(handoffRow.executedByRole),
          executedAt: dateString(handoffRow.executedAt),
        }
      : null,
    updatedAt: lead.updatedAt,
  };
}

async function selectStudentCaseHandoffSnapshot(
  transaction: DatabaseTransaction,
  studentCaseId: string,
): Promise<CanonicalStudentCaseHandoffSnapshot> {
  const studentCase = await selectStudentCaseSnapshot(transaction, studentCaseId);
  const [handoffRow] = await transaction
    .select({
      handoffId: evoSalesAdmissionsHandoffs.id,
      leadId: evoSalesAdmissionsHandoffs.leadId,
      isOverride: evoSalesAdmissionsHandoffs.isOverride,
      overrideReason: evoSalesAdmissionsHandoffs.overrideReason,
      executedByRole: evoSalesAdmissionsHandoffs.executedByRole,
      executedAt: evoSalesAdmissionsHandoffs.executedAt,
      contractEvidenceId: evoSalesAdmissionsHandoffs.contractEvidenceId,
      firstPaymentEvidenceId: evoSalesAdmissionsHandoffs.firstPaymentEvidenceId,
      idempotencyKey: evoSalesAdmissionsHandoffs.idempotencyKey,
    })
    .from(evoSalesAdmissionsHandoffs)
    .where(eq(evoSalesAdmissionsHandoffs.studentCaseId, studentCaseId))
    .limit(1);
  if (!handoffRow) throw new CanonicalCrmRepositoryError("not_found");
  const {
    idempotencyKey: handoffIdempotencyKey,
    ...handoffSnapshot
  } = handoffRow;

  const starterTasks = await transaction
    .select({
      taskId: evoAdmissionsTasks.id,
      title: evoAdmissionsTasks.title,
      details: evoAdmissionsTasks.details,
      status: evoAdmissionsTasks.status,
      dueAt: evoAdmissionsTasks.dueAt,
      createdAt: evoAdmissionsTasks.createdAt,
    })
    .from(evoAdmissionsTasks)
    .innerJoin(
      evoBusinessEvents,
      and(
        eq(evoBusinessEvents.businessObjectType, "task"),
        eq(evoBusinessEvents.businessObjectId, evoAdmissionsTasks.id),
        eq(evoBusinessEvents.transition, "task.created"),
        eq(evoBusinessEvents.idempotencyKey, handoffIdempotencyKey),
      ),
    )
    .where(eq(evoAdmissionsTasks.studentCaseId, studentCaseId))
    .orderBy(evoAdmissionsTasks.createdAt, evoAdmissionsTasks.id);

  if (starterTasks.length !== CANONICAL_ADMISSIONS_STARTER_TASKS.length) {
    throw new CanonicalCrmRepositoryError("unavailable");
  }

  return {
    studentCase,
    handoff: {
      ...handoffSnapshot,
      executedByRole: databaseRole(handoffSnapshot.executedByRole),
      executedAt: dateString(handoffSnapshot.executedAt),
    },
    starterTasks: starterTasks.map((task) => ({
      ...task,
      status: databaseTaskStatus(task.status),
      dueAt: optionalDateString(task.dueAt),
      createdAt: dateString(task.createdAt),
    })),
  };
}

export async function createCanonicalPersonLead(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
    source: string;
  }>,
): Promise<CanonicalLeadSnapshot> {
  const context = parseCommandContext(input, ["admin", "sales"]);
  const identity = normalizeCanonicalPersonIdentity(input);
  const leadSource = source(input.source);
  const requestHash = sha256({
    actorRole: context.actorRole,
    ...identity,
    source: leadSource,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.person_lead.create",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return selectLeadSnapshot(
        transaction,
        resultUuid(reservation.resultPayload, "leadId"),
      );
    }

    const identityCondition =
      identity.normalizedEmail && identity.normalizedPhone
        ? or(
            eq(evoPeople.email, identity.normalizedEmail),
            eq(evoPeople.phoneE164, identity.normalizedPhone),
          )
        : identity.normalizedEmail
          ? eq(evoPeople.email, identity.normalizedEmail)
          : eq(evoPeople.phoneE164, identity.normalizedPhone!);

    let matchingPeople = await transaction
      .select({
        id: evoPeople.id,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoPeople)
      .where(identityCondition)
      .limit(2);

    let personId: string;
    if (matchingPeople.length === 0) {
      const proposedPersonId = randomUUID();
      const [insertedPerson] = await transaction
        .insert(evoPeople)
        .values({
          id: proposedPersonId,
          fullName: identity.displayName,
          email: identity.normalizedEmail,
          phoneE164: identity.normalizedPhone,
        })
        .onConflictDoNothing()
        .returning({ id: evoPeople.id });
      if (insertedPerson) {
        personId = insertedPerson.id;
      } else {
        matchingPeople = await transaction
          .select({
            id: evoPeople.id,
            email: evoPeople.email,
            phone: evoPeople.phoneE164,
          })
          .from(evoPeople)
          .where(identityCondition)
          .limit(2);
        if (matchingPeople.length !== 1) {
          throw new CanonicalCrmRepositoryError("conflict");
        }
        personId = matchingPeople[0]!.id;
      }
    } else {
      if (matchingPeople.length !== 1) {
        throw new CanonicalCrmRepositoryError("conflict");
      }
      const [person] = matchingPeople;
      if (
        !person ||
        (identity.normalizedEmail &&
          person.email &&
          person.email !== identity.normalizedEmail) ||
        (identity.normalizedPhone &&
          person.phone &&
          person.phone !== identity.normalizedPhone)
      ) {
        throw new CanonicalCrmRepositoryError("conflict");
      }
      personId = person.id;

      if (
        (!person.email && identity.normalizedEmail) ||
        (!person.phone && identity.normalizedPhone)
      ) {
        await transaction
          .update(evoPeople)
          .set({
            email: person.email ?? identity.normalizedEmail,
            phoneE164: person.phone ?? identity.normalizedPhone,
            version: sql`${evoPeople.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(evoPeople.id, personId));
      }
    }

    const leadId = randomUUID();
    await transaction.insert(evoLeads).values({
      id: leadId,
      personId,
      source: leadSource,
      stage: "new",
      ownerRole: "sales",
    });
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "lead",
      businessObjectId: leadId,
      transition: "lead.created",
      toState: "new",
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "lead",
      businessObjectId: leadId,
      resultPayload: { leadId },
    });
    return selectLeadSnapshot(transaction, leadId);
  });
}

type ValidatedCanonicalInboundMessage = Readonly<{
  context: CommandContext;
  leadId: string;
  externalConversationId: string;
  externalMessageId: string;
  body: string;
  occurredAt: Date;
  eventSequence: number;
}>;

async function appendCanonicalInboundMessageInTransaction(
  transaction: DatabaseTransaction,
  input: ValidatedCanonicalInboundMessage,
): Promise<CanonicalInboundMessageResult> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`whatsapp:${input.externalConversationId}:${input.externalMessageId}`}, 0))`,
  );

  const [lead] = await transaction
    .select({ id: evoLeads.id })
    .from(evoLeads)
    .where(eq(evoLeads.id, input.leadId))
    .limit(1);
  if (!lead) throw new CanonicalCrmRepositoryError("not_found");

  let [conversation] = await transaction
    .select({ id: evoConversations.id, leadId: evoConversations.leadId })
    .from(evoConversations)
    .where(
      and(
        eq(evoConversations.channel, "whatsapp"),
        eq(
          evoConversations.externalConversationId,
          input.externalConversationId,
        ),
      ),
    )
    .limit(1);

  if (!conversation) {
    const proposedConversationId = randomUUID();
    const [createdConversation] = await transaction
      .insert(evoConversations)
      .values({
        id: proposedConversationId,
        leadId: input.leadId,
        channel: "whatsapp",
        externalConversationId: input.externalConversationId,
        status: "open",
        owningRole: "sales",
      })
      .onConflictDoNothing()
      .returning({
        id: evoConversations.id,
        leadId: evoConversations.leadId,
      });
    conversation = createdConversation;
    if (!conversation) {
      [conversation] = await transaction
        .select({ id: evoConversations.id, leadId: evoConversations.leadId })
        .from(evoConversations)
        .where(
          and(
            eq(evoConversations.channel, "whatsapp"),
            eq(
              evoConversations.externalConversationId,
              input.externalConversationId,
            ),
          ),
        )
        .limit(1);
    }
  }
  if (!conversation) throw new CanonicalCrmRepositoryError("unavailable");
  if (conversation.leadId !== input.leadId) {
    throw new CanonicalCrmRepositoryError("conflict");
  }

  const [duplicateMessage] = await transaction
    .select({
      id: evoMessages.id,
      body: evoMessages.body,
      occurredAt: evoMessages.occurredAt,
    })
    .from(evoMessages)
    .where(
      and(
        eq(evoMessages.conversationId, conversation.id),
        eq(evoMessages.externalMessageId, input.externalMessageId),
      ),
    )
    .limit(1);

  let messageId: string;
  if (duplicateMessage) {
    if (
      duplicateMessage.body !== input.body ||
      duplicateMessage.occurredAt.getTime() !== input.occurredAt.getTime()
    ) {
      throw new CanonicalCrmRepositoryError("conflict");
    }
    messageId = duplicateMessage.id;
  } else {
    messageId = randomUUID();
    await transaction.insert(evoMessages).values({
      id: messageId,
      conversationId: conversation.id,
      direction: "inbound",
      externalMessageId: input.externalMessageId,
      body: input.body,
      authorRole: null,
      occurredAt: input.occurredAt,
      correlationId: input.context.correlationId,
      idempotencyKey: input.context.idempotencyKey,
    });

    const occurredAtIso = input.occurredAt.toISOString();
    // Inbound activity advances queue recency without invalidating an
    // operator's optimistic workflow version.
    const [refreshedConversation] = await transaction
      .update(evoConversations)
      .set({
        updatedAt: sql`greatest(${evoConversations.updatedAt}, ${occurredAtIso}::timestamptz)`,
      })
      .where(eq(evoConversations.id, conversation.id))
      .returning({ id: evoConversations.id });
    const [refreshedLead] = await transaction
      .update(evoLeads)
      .set({
        updatedAt: sql`greatest(${evoLeads.updatedAt}, ${occurredAtIso}::timestamptz)`,
      })
      .where(eq(evoLeads.id, input.leadId))
      .returning({ id: evoLeads.id });
    if (!refreshedConversation || !refreshedLead) {
      throw new CanonicalCrmRepositoryError("unavailable");
    }

    await insertBusinessEvent(transaction, {
      context: input.context,
      businessObjectType: "message",
      businessObjectId: messageId,
      transition: "message.received",
      toState: "received",
      eventSequence: input.eventSequence,
    });
  }

  return {
    conversationId: conversation.id,
    messageId,
    leadId: input.leadId,
  };
}

export async function receiveCanonicalWhatsAppInbound(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    displayName: string;
    phone: string;
    externalConversationId: string;
    externalMessageId: string;
    body: string;
    occurredAt: string;
  }>,
): Promise<CanonicalInboundMessageResult> {
  const context = parseCommandContext(input, ["admin", "sales"]);
  const identity = normalizeCanonicalPersonIdentity({
    displayName: input.displayName,
    phone: input.phone,
  });
  const phone = identity.normalizedPhone;
  if (!phone) invalidInput();
  const externalConversationId = externalIdentifier(
    input.externalConversationId,
  );
  const externalMessageId = externalIdentifier(input.externalMessageId);
  const body = messageBody(input.body);
  const occurredAt = isoTimestamp(input.occurredAt);
  const requestHash = sha256({
    actorRole: context.actorRole,
    ...identity,
    channel: "whatsapp",
    externalConversationId,
    externalMessageId,
    body,
    occurredAt: occurredAt.toISOString(),
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.whatsapp_inbound.receive",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        conversationId: resultUuid(
          reservation.resultPayload,
          "conversationId",
        ),
        messageId: resultUuid(reservation.resultPayload, "messageId"),
        leadId: resultUuid(reservation.resultPayload, "leadId"),
      };
    }

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`whatsapp-phone:${phone}`}, 0))`,
    );

    let people = await transaction
      .select({ id: evoPeople.id })
      .from(evoPeople)
      .where(eq(evoPeople.phoneE164, phone))
      .limit(2);
    let personId: string;
    if (people.length === 0) {
      const [createdPerson] = await transaction
        .insert(evoPeople)
        .values({
          id: randomUUID(),
          fullName: identity.displayName,
          phoneE164: phone,
        })
        .onConflictDoNothing()
        .returning({ id: evoPeople.id });
      if (createdPerson) {
        personId = createdPerson.id;
      } else {
        people = await transaction
          .select({ id: evoPeople.id })
          .from(evoPeople)
          .where(eq(evoPeople.phoneE164, phone))
          .limit(2);
        if (people.length !== 1) {
          throw new CanonicalCrmRepositoryError("conflict");
        }
        personId = people[0]!.id;
      }
    } else {
      if (people.length !== 1) {
        throw new CanonicalCrmRepositoryError("conflict");
      }
      personId = people[0]!.id;
    }

    const whatsappLeads = await transaction
      .select({ id: evoLeads.id })
      .from(evoLeads)
      .where(
        and(eq(evoLeads.personId, personId), eq(evoLeads.source, "whatsapp")),
      )
      .limit(2);
    if (whatsappLeads.length > 1) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    let leadId: string;
    let messageEventSequence = 1;
    const [existingLead] = whatsappLeads;
    if (existingLead) {
      leadId = existingLead.id;
    } else {
      leadId = randomUUID();
      await transaction.insert(evoLeads).values({
        id: leadId,
        personId,
        source: "whatsapp",
        stage: "new",
        ownerRole: "sales",
      });
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "lead",
        businessObjectId: leadId,
        transition: "lead.created",
        toState: "new",
        eventSequence: 1,
      });
      messageEventSequence = 2;
    }

    const result = await appendCanonicalInboundMessageInTransaction(
      transaction,
      {
        context,
        leadId,
        externalConversationId,
        externalMessageId,
        body,
        occurredAt,
        eventSequence: messageEventSequence,
      },
    );
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "message",
      businessObjectId: result.messageId,
      resultPayload: result,
    });
    return result;
  });
}

export async function appendCanonicalInboundMessage(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    leadId: string;
    channel: "whatsapp";
    externalConversationId: string;
    externalMessageId: string;
    body: string;
    occurredAt: string;
  }>,
): Promise<CanonicalInboundMessageResult> {
  const context = parseCommandContext(input, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  if (input.channel !== "whatsapp") invalidInput();
  const externalConversationId = externalIdentifier(
    input.externalConversationId,
  );
  const externalMessageId = externalIdentifier(input.externalMessageId);
  const body = messageBody(input.body);
  const occurredAt = isoTimestamp(input.occurredAt);
  const requestHash = sha256({
    actorRole: context.actorRole,
    leadId,
    channel: input.channel,
    externalConversationId,
    externalMessageId,
    body,
    occurredAt: occurredAt.toISOString(),
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.inbound_message.append",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        conversationId: resultUuid(
          reservation.resultPayload,
          "conversationId",
        ),
        messageId: resultUuid(reservation.resultPayload, "messageId"),
        leadId: resultUuid(reservation.resultPayload, "leadId"),
      };
    }

    const result = await appendCanonicalInboundMessageInTransaction(
      transaction,
      {
        context,
        leadId,
        externalConversationId,
        externalMessageId,
        body,
        occurredAt,
        eventSequence: 1,
      },
    );
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "message",
      businessObjectId: result.messageId,
      resultPayload: result,
    });
    return result;
  });
}

export async function updateCanonicalSalesLeadWorkflow(
  contextInput: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
  }>,
  input: Readonly<{
    leadId: string;
    expectedVersion: number;
    stage: CanonicalSalesStage;
    qualificationSummary?: string | null;
    nextAction?: string | null;
    nextActionAt?: string | null;
    reason?: string | null;
  }>,
): Promise<CanonicalLeadSnapshot> {
  const context = parseCommandContext(contextInput, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const stage = optionalCanonicalSalesStage(input.stage);
  if (!stage || stage === "handed_off") invalidInput();

  const qualificationSummary = optionalBoundedText(
    input.qualificationSummary,
    { maxLength: 2_000, collapseWhitespace: true },
  );
  if (
    (stage === "qualified" || stage === "handoff_ready") &&
    !qualificationSummary
  ) {
    invalidInput();
  }

  const suppliedReason = optionalBoundedText(input.reason, {
    maxLength: 2_000,
    collapseWhitespace: true,
  });
  let nextAction: string | null;
  let nextActionAt: Date | null;
  let reason: string | null;
  if (stage === "disqualified") {
    if (!suppliedReason) invalidInput();
    nextAction = null;
    nextActionAt = null;
    reason = suppliedReason;
  } else {
    if (suppliedReason) invalidInput();
    nextAction = boundedText(input.nextAction, {
      maxLength: 500,
      collapseWhitespace: true,
    });
    nextActionAt = canonicalSalesDeadline(input.nextActionAt);
    reason = null;
  }

  const requestHash = sha256({
    actorRole: context.actorRole,
    leadId,
    expectedVersion,
    stage,
    qualificationSummary,
    nextAction,
    nextActionAt: nextActionAt?.toISOString() ?? null,
    reason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.sales_lead.workflow_update",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return selectLeadSnapshot(
        transaction,
        resultUuid(reservation.resultPayload, "leadId"),
      );
    }

    const [lead] = await transaction
      .select({
        id: evoLeads.id,
        stage: evoLeads.stage,
        ownerRole: evoLeads.ownerRole,
        qualificationSummary: evoLeads.qualificationSummary,
        nextAction: evoLeads.nextAction,
        nextActionAt: evoLeads.nextActionAt,
        version: evoLeads.version,
      })
      .from(evoLeads)
      .where(eq(evoLeads.id, leadId))
      .limit(1)
      .for("update");
    if (!lead) throw new CanonicalCrmRepositoryError("not_found");
    const fromStage = databaseSalesStage(lead.stage);
    databaseSalesOwnerRole(lead.ownerRole);
    if (fromStage === "handed_off" || lead.version !== expectedVersion) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const unchanged =
      fromStage === stage &&
      lead.qualificationSummary === qualificationSummary &&
      lead.nextAction === nextAction &&
      (lead.nextActionAt?.getTime() ?? null) ===
        (nextActionAt?.getTime() ?? null);
    if (unchanged) {
      const result = await selectLeadSnapshot(transaction, leadId);
      await completeCommand(transaction, {
        receiptId: reservation.receiptId,
        businessObjectType: "lead",
        businessObjectId: leadId,
        resultPayload: { leadId },
      });
      return result;
    }

    const [updated] = await transaction
      .update(evoLeads)
      .set({
        stage,
        qualificationSummary,
        nextAction,
        nextActionAt,
        version: sql`${evoLeads.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(evoLeads.id, leadId),
          eq(evoLeads.ownerRole, "sales"),
          eq(evoLeads.version, expectedVersion),
        ),
      )
      .returning({ id: evoLeads.id });
    if (!updated) throw new CanonicalCrmRepositoryError("conflict");

    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "lead",
      businessObjectId: leadId,
      transition: "sales_lead.workflow_updated",
      fromState: fromStage,
      toState: stage,
      reason,
    });
    const result = await selectLeadSnapshot(transaction, leadId);
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "lead",
      businessObjectId: leadId,
      resultPayload: { leadId },
    });
    return result;
  });
}

export async function recordCanonicalSalesGateEvidence(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    leadId: string;
    evidenceType: "contract" | "first_payment";
    decision: "confirmed" | "rejected";
    evidenceReference: string;
    amountMinor?: number | null;
    currency?: string | null;
    occurredAt: string;
    reason?: string | null;
  }>,
): Promise<CanonicalSalesGateEvidenceResult> {
  const context = parseCommandContext(input, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  if (input.evidenceType !== "contract" && input.evidenceType !== "first_payment") {
    invalidInput();
  }
  if (input.decision !== "confirmed" && input.decision !== "rejected") {
    invalidInput();
  }
  const evidenceReference = externalIdentifier(input.evidenceReference);
  const occurredAt = isoTimestamp(input.occurredAt);
  const reason = optionalBoundedText(input.reason, { maxLength: 2_000 });
  if (input.decision === "rejected" && !reason) invalidInput();

  let amountMinor: number | null = null;
  let currency: string | null = null;
  if (input.evidenceType === "first_payment") {
    if (!Number.isSafeInteger(input.amountMinor) || Number(input.amountMinor) <= 0) {
      invalidInput();
    }
    if (typeof input.currency !== "string" || !CURRENCY_PATTERN.test(input.currency)) {
      invalidInput();
    }
    amountMinor = Number(input.amountMinor);
    currency = input.currency;
  } else if (input.amountMinor != null || input.currency != null) {
    invalidInput();
  }

  const requestHash = sha256({
    actorRole: context.actorRole,
    leadId,
    evidenceType: input.evidenceType,
    decision: input.decision,
    evidenceReference,
    amountMinor,
    currency,
    occurredAt: occurredAt.toISOString(),
    reason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.sales_gate_evidence.record",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      const evidenceType = resultString(
        reservation.resultPayload,
        "evidenceType",
      );
      const decision = resultString(reservation.resultPayload, "decision");
      if (
        (evidenceType !== "contract" && evidenceType !== "first_payment") ||
        (decision !== "confirmed" && decision !== "rejected")
      ) {
        throw new CanonicalCrmRepositoryError("unavailable");
      }
      return {
        evidenceId: resultUuid(reservation.resultPayload, "evidenceId"),
        leadId: resultUuid(reservation.resultPayload, "leadId"),
        evidenceType,
        decision,
      };
    }

    const [lead] = await transaction
      .select({ id: evoLeads.id, stage: evoLeads.stage })
      .from(evoLeads)
      .where(eq(evoLeads.id, leadId))
      .limit(1)
      .for("update");
    if (!lead) throw new CanonicalCrmRepositoryError("not_found");
    if (lead.stage === "disqualified" || lead.stage === "handed_off") {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const evidenceId = randomUUID();
    await transaction.insert(evoSalesGateEvidence).values({
      id: evidenceId,
      leadId,
      evidenceType: input.evidenceType,
      decision: input.decision,
      evidenceReference,
      amountMinor,
      currency,
      recordedByRole: context.actorRole,
      occurredAt,
      reason,
      correlationId: context.correlationId,
      idempotencyKey: context.idempotencyKey,
    });
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "gate_evidence",
      businessObjectId: evidenceId,
      transition: `sales_gate.${input.evidenceType}.${input.decision}`,
      toState: input.decision,
      reason,
    });
    const result = {
      evidenceId,
      leadId,
      evidenceType: input.evidenceType,
      decision: input.decision,
    };
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "gate_evidence",
      businessObjectId: evidenceId,
      resultPayload: result,
    });
    return result;
  });
}

export async function handoffCanonicalLeadToAdmissions(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    leadId: string;
    expectedVersion: number;
    adminOverride?: Readonly<{ reason: string }> | null;
  }>,
): Promise<CanonicalHandoffResult> {
  const context = parseCommandContext(input, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  if (input.adminOverride && context.actorRole !== "admin") {
    throw new CanonicalCrmRepositoryError("forbidden");
  }
  let overrideReason: string | null = null;
  if (input.adminOverride) {
    overrideReason = boundedText(input.adminOverride.reason, {
      maxLength: 2_000,
    });
  }
  const isOverride = overrideReason !== null;
  const requestHash = sha256({
    actorRole: context.actorRole,
    leadId,
    expectedVersion,
    isOverride,
    overrideReason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.sales_admissions.handoff",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        handoffId: resultUuid(reservation.resultPayload, "handoffId"),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        leadId: resultUuid(reservation.resultPayload, "leadId"),
        isOverride: resultBoolean(reservation.resultPayload, "isOverride"),
      };
    }

    const [lead] = await transaction
      .select({
        id: evoLeads.id,
        personId: evoLeads.personId,
        stage: evoLeads.stage,
        version: evoLeads.version,
      })
      .from(evoLeads)
      .where(eq(evoLeads.id, leadId))
      .limit(1)
      .for("update");
    if (!lead) throw new CanonicalCrmRepositoryError("not_found");
    if (
      lead.version !== expectedVersion ||
      (lead.stage !== "qualified" && lead.stage !== "handoff_ready")
    ) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const [existingHandoff] = await transaction
      .select({
        id: evoSalesAdmissionsHandoffs.id,
        studentCaseId: evoSalesAdmissionsHandoffs.studentCaseId,
        isOverride: evoSalesAdmissionsHandoffs.isOverride,
      })
      .from(evoSalesAdmissionsHandoffs)
      .where(eq(evoSalesAdmissionsHandoffs.leadId, leadId))
      .limit(1);
    if (existingHandoff) {
      const result = {
        handoffId: existingHandoff.id,
        studentCaseId: existingHandoff.studentCaseId,
        leadId,
        isOverride: existingHandoff.isOverride,
      };
      await completeCommand(transaction, {
        receiptId: reservation.receiptId,
        businessObjectType: "handoff",
        businessObjectId: existingHandoff.id,
        resultPayload: result,
      });
      return result;
    }

    let contractEvidenceId: string | null = null;
    let firstPaymentEvidenceId: string | null = null;
    if (!isOverride) {
      const [contractEvidence] = await transaction
        .select({
          id: evoSalesGateEvidence.id,
          decision: evoSalesGateEvidence.decision,
        })
        .from(evoSalesGateEvidence)
        .where(
          and(
            eq(evoSalesGateEvidence.leadId, leadId),
            eq(evoSalesGateEvidence.evidenceType, "contract"),
          ),
        )
        .orderBy(
          desc(evoSalesGateEvidence.occurredAt),
          desc(evoSalesGateEvidence.createdAt),
          desc(evoSalesGateEvidence.id),
        )
        .limit(1);
      const [firstPaymentEvidence] = await transaction
        .select({
          id: evoSalesGateEvidence.id,
          decision: evoSalesGateEvidence.decision,
        })
        .from(evoSalesGateEvidence)
        .where(
          and(
            eq(evoSalesGateEvidence.leadId, leadId),
            eq(evoSalesGateEvidence.evidenceType, "first_payment"),
          ),
        )
        .orderBy(
          desc(evoSalesGateEvidence.occurredAt),
          desc(evoSalesGateEvidence.createdAt),
          desc(evoSalesGateEvidence.id),
        )
        .limit(1);
      if (
        contractEvidence?.decision !== "confirmed" ||
        firstPaymentEvidence?.decision !== "confirmed"
      ) {
        throw new CanonicalCrmRepositoryError("gate_unsatisfied");
      }
      contractEvidenceId = contractEvidence.id;
      firstPaymentEvidenceId = firstPaymentEvidence.id;
    }

    let [studentCase] = await transaction
      .select({
        id: evoStudentCases.id,
        status: evoStudentCases.status,
        version: evoStudentCases.version,
      })
      .from(evoStudentCases)
      .where(eq(evoStudentCases.leadId, leadId))
      .limit(1)
      .for("update");
    let studentCaseCreated = false;
    let studentCaseActivatedFromStatus: CanonicalStudentCaseStatus | null =
      null;
    if (!studentCase) {
      [studentCase] = await transaction
        .insert(evoStudentCases)
        .values({
          id: randomUUID(),
          personId: lead.personId,
          leadId,
          status: "active",
          ownerRole: "admissions",
        })
        .returning({
          id: evoStudentCases.id,
          status: evoStudentCases.status,
          version: evoStudentCases.version,
        });
      studentCaseCreated = true;
    } else {
      const currentCaseStatus = databaseStudentCaseStatus(studentCase.status);
      if (currentCaseStatus !== "active") {
        studentCaseActivatedFromStatus = currentCaseStatus;
        [studentCase] = await transaction
          .update(evoStudentCases)
          .set({
            status: "active",
            version: sql`${evoStudentCases.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(evoStudentCases.id, studentCase.id),
              eq(evoStudentCases.version, studentCase.version),
            ),
          )
          .returning({
            id: evoStudentCases.id,
            status: evoStudentCases.status,
            version: evoStudentCases.version,
          });
      }
    }
    if (!studentCase) throw new CanonicalCrmRepositoryError("unavailable");

    let eventSequence = 1;
    if (studentCaseCreated) {
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "student_case",
        businessObjectId: studentCase.id,
        transition: "student_case.created",
        toState: "active",
        eventSequence,
      });
      eventSequence += 1;
    }
    if (studentCaseActivatedFromStatus) {
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "student_case",
        businessObjectId: studentCase.id,
        transition: "student_case.activated",
        fromState: studentCaseActivatedFromStatus,
        toState: "active",
        eventSequence,
      });
      eventSequence += 1;
    }

    const starterTasks = await transaction
      .insert(evoAdmissionsTasks)
      .values(
        CANONICAL_ADMISSIONS_STARTER_TASKS.map((task) => ({
          id: randomUUID(),
          studentCaseId: studentCase.id,
          title: task.title,
          details: task.details,
          status: "open",
          assignedRole: "admissions",
        })),
      )
      .returning({ id: evoAdmissionsTasks.id });
    if (starterTasks.length !== CANONICAL_ADMISSIONS_STARTER_TASKS.length) {
      throw new CanonicalCrmRepositoryError("unavailable");
    }
    for (const task of starterTasks) {
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "task",
        businessObjectId: task.id,
        transition: "task.created",
        toState: "open",
        eventSequence,
      });
      eventSequence += 1;
    }

    const visaMilestones = await transaction
      .insert(evoVisaMilestones)
      .values(
        CANONICAL_VISA_MILESTONE_KINDS.map((milestoneKind) => ({
          id: randomUUID(),
          studentCaseId: studentCase.id,
          milestoneKind,
          status: "pending",
          ownerRole: "admissions",
        })),
      )
      .returning({ id: evoVisaMilestones.id });
    if (visaMilestones.length !== CANONICAL_VISA_MILESTONE_KINDS.length) {
      throw new CanonicalCrmRepositoryError("unavailable");
    }
    for (const visaMilestone of visaMilestones) {
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "visa_milestone",
        businessObjectId: visaMilestone.id,
        transition: "visa_milestone.created",
        toState: "pending",
        eventSequence,
      });
      eventSequence += 1;
    }

    const handoffId = randomUUID();
    await transaction.insert(evoSalesAdmissionsHandoffs).values({
      id: handoffId,
      leadId,
      studentCaseId: studentCase.id,
      contractEvidenceId,
      firstPaymentEvidenceId,
      isOverride,
      overrideReason,
      executedByRole: context.actorRole,
      correlationId: context.correlationId,
      idempotencyKey: context.idempotencyKey,
    });
    await transaction
      .update(evoLeads)
      .set({
        stage: "handed_off",
        nextAction: null,
        nextActionAt: null,
        version: sql`${evoLeads.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(evoLeads.id, leadId));
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "handoff",
      businessObjectId: handoffId,
      transition: isOverride
        ? "sales_admissions.handoff_override"
        : "sales_admissions.handed_off",
      fromState: lead.stage,
      toState: "handed_off",
      reason: overrideReason,
      eventSequence,
    });
    const result = {
      handoffId,
      studentCaseId: studentCase.id,
      leadId,
      isOverride,
    };
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "handoff",
      businessObjectId: handoffId,
      resultPayload: result,
    });
    return result;
  });
}

export async function createCanonicalAdmissionsTask(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    studentCaseId: string;
    title: string;
    details?: string | null;
    dueAt?: string | null;
  }>,
): Promise<CanonicalAdmissionsTaskResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const studentCaseId = uuid(input.studentCaseId);
  const title = boundedText(input.title, {
    maxLength: 200,
    collapseWhitespace: true,
  });
  const details = optionalBoundedText(input.details, { maxLength: 2_000 });
  const dueAt = canonicalTaskDueAt(input.dueAt);
  const requestHash = sha256({
    actorRole: context.actorRole,
    studentCaseId,
    title,
    details,
    dueAt: dueAt?.toISOString() ?? null,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.admissions_task.create",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        taskId: resultUuid(reservation.resultPayload, "taskId"),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        status: resultTaskStatus(reservation.resultPayload, "status"),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    await lockActiveHandedOffStudentCase(transaction, studentCaseId);
    const [task] = await transaction
      .insert(evoAdmissionsTasks)
      .values({
        id: randomUUID(),
        studentCaseId,
        title,
        details,
        status: "open",
        assignedRole: "admissions",
        dueAt,
      })
      .returning({
        id: evoAdmissionsTasks.id,
        studentCaseId: evoAdmissionsTasks.studentCaseId,
        status: evoAdmissionsTasks.status,
        version: evoAdmissionsTasks.version,
      });
    if (!task) throw new CanonicalCrmRepositoryError("unavailable");

    const result = {
      taskId: task.id,
      studentCaseId: task.studentCaseId,
      status: databaseTaskStatus(task.status),
      version: task.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "task",
      businessObjectId: task.id,
      transition: "task.created",
      toState: "open",
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "task",
      businessObjectId: task.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function transitionCanonicalAdmissionsTask(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    taskId: string;
    expectedVersion: number;
    toStatus: "completed" | "cancelled";
    reason?: string | null;
  }>,
): Promise<CanonicalAdmissionsTaskResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const taskId = uuid(input.taskId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  if (input.toStatus !== "completed" && input.toStatus !== "cancelled") {
    invalidInput();
  }
  const reason = optionalBoundedText(input.reason, { maxLength: 2_000 });
  if (
    (input.toStatus === "cancelled" && reason === null) ||
    (input.toStatus === "completed" && reason !== null)
  ) {
    invalidInput();
  }
  const requestHash = sha256({
    actorRole: context.actorRole,
    taskId,
    expectedVersion,
    toStatus: input.toStatus,
    reason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.admissions_task.transition",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        taskId: resultUuid(reservation.resultPayload, "taskId"),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        status: resultTaskStatus(reservation.resultPayload, "status"),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    const [taskPointer] = await transaction
      .select({ studentCaseId: evoAdmissionsTasks.studentCaseId })
      .from(evoAdmissionsTasks)
      .where(eq(evoAdmissionsTasks.id, taskId))
      .limit(1);
    if (!taskPointer) throw new CanonicalCrmRepositoryError("not_found");
    await lockActiveHandedOffStudentCase(
      transaction,
      taskPointer.studentCaseId,
    );

    const [currentTask] = await transaction
      .select({
        studentCaseId: evoAdmissionsTasks.studentCaseId,
        status: evoAdmissionsTasks.status,
        version: evoAdmissionsTasks.version,
      })
      .from(evoAdmissionsTasks)
      .where(eq(evoAdmissionsTasks.id, taskId))
      .limit(1)
      .for("update");
    if (!currentTask) throw new CanonicalCrmRepositoryError("not_found");
    if (
      currentTask.studentCaseId !== taskPointer.studentCaseId ||
      databaseTaskStatus(currentTask.status) !== "open" ||
      currentTask.version !== expectedVersion
    ) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const closedAt = new Date();
    const [task] = await transaction
      .update(evoAdmissionsTasks)
      .set({
        status: input.toStatus,
        closedAt,
        closedByRole: context.actorRole,
        closureReason: reason,
        version: sql`${evoAdmissionsTasks.version} + 1`,
        updatedAt: closedAt,
      })
      .where(
        and(
          eq(evoAdmissionsTasks.id, taskId),
          eq(evoAdmissionsTasks.status, "open"),
          eq(evoAdmissionsTasks.version, expectedVersion),
        ),
      )
      .returning({
        id: evoAdmissionsTasks.id,
        studentCaseId: evoAdmissionsTasks.studentCaseId,
        status: evoAdmissionsTasks.status,
        version: evoAdmissionsTasks.version,
      });
    if (!task) throw new CanonicalCrmRepositoryError("conflict");

    const result = {
      taskId: task.id,
      studentCaseId: task.studentCaseId,
      status: databaseTaskStatus(task.status),
      version: task.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "task",
      businessObjectId: task.id,
      transition:
        input.toStatus === "completed" ? "task.completed" : "task.cancelled",
      fromState: "open",
      toState: input.toStatus,
      reason,
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "task",
      businessObjectId: task.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function createCanonicalUniversityApplication(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    studentCaseId: string;
    institutionName: string;
    programName: string;
    targetIntake: string;
    nextAction: string;
    nextActionAt: string;
  }>,
): Promise<CanonicalUniversityApplicationResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const studentCaseId = uuid(input.studentCaseId);
  const institutionName = boundedText(input.institutionName, {
    maxLength: 200,
    collapseWhitespace: true,
  });
  const programName = boundedText(input.programName, {
    maxLength: 200,
    collapseWhitespace: true,
  });
  const targetIntake = boundedText(input.targetIntake, {
    maxLength: 100,
    collapseWhitespace: true,
  });
  const nextAction = boundedText(input.nextAction, {
    maxLength: 500,
    collapseWhitespace: true,
  });
  const nextActionAt = requiredOperationsTimestamp(input.nextActionAt);
  const requestHash = sha256({
    actorRole: context.actorRole,
    studentCaseId,
    institutionName,
    programName,
    targetIntake,
    nextAction,
    nextActionAt: nextActionAt.toISOString(),
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.university_application.create",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        applicationId: resultUuid(
          reservation.resultPayload,
          "applicationId",
        ),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        status: resultUniversityApplicationStatus(
          reservation.resultPayload,
          "status",
        ),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    await lockActiveHandedOffStudentCase(transaction, studentCaseId);
    const [existing] = await transaction
      .select({ id: evoUniversityApplications.id })
      .from(evoUniversityApplications)
      .where(
        and(
          eq(evoUniversityApplications.studentCaseId, studentCaseId),
          eq(evoUniversityApplications.institutionName, institutionName),
          eq(evoUniversityApplications.programName, programName),
          eq(evoUniversityApplications.targetIntake, targetIntake),
        ),
      )
      .limit(1);
    if (existing) throw new CanonicalCrmRepositoryError("conflict");

    const [application] = await transaction
      .insert(evoUniversityApplications)
      .values({
        id: randomUUID(),
        studentCaseId,
        institutionName,
        programName,
        targetIntake,
        status: "draft",
        ownerRole: "admissions",
        nextAction,
        nextActionAt,
      })
      .returning({
        id: evoUniversityApplications.id,
        studentCaseId: evoUniversityApplications.studentCaseId,
        status: evoUniversityApplications.status,
        version: evoUniversityApplications.version,
      });
    if (!application) throw new CanonicalCrmRepositoryError("unavailable");

    const result = {
      applicationId: application.id,
      studentCaseId: application.studentCaseId,
      status: databaseUniversityApplicationStatus(application.status),
      version: application.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "application",
      businessObjectId: application.id,
      transition: "application.created",
      toState: "draft",
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "application",
      businessObjectId: application.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function updateCanonicalUniversityApplication(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    applicationId: string;
    expectedVersion: number;
    nextAction: string;
    nextActionAt: string;
  }>,
): Promise<CanonicalUniversityApplicationResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const applicationId = uuid(input.applicationId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const nextAction = boundedText(input.nextAction, {
    maxLength: 500,
    collapseWhitespace: true,
  });
  const nextActionAt = requiredOperationsTimestamp(input.nextActionAt);
  const requestHash = sha256({
    actorRole: context.actorRole,
    applicationId,
    expectedVersion,
    nextAction,
    nextActionAt: nextActionAt.toISOString(),
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.university_application.update",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        applicationId: resultUuid(
          reservation.resultPayload,
          "applicationId",
        ),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        status: resultUniversityApplicationStatus(
          reservation.resultPayload,
          "status",
        ),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    const [candidate] = await transaction
      .select({ studentCaseId: evoUniversityApplications.studentCaseId })
      .from(evoUniversityApplications)
      .where(eq(evoUniversityApplications.id, applicationId))
      .limit(1);
    if (!candidate) throw new CanonicalCrmRepositoryError("not_found");
    await lockActiveHandedOffStudentCase(
      transaction,
      candidate.studentCaseId,
    );
    const [current] = await transaction
      .select({
        studentCaseId: evoUniversityApplications.studentCaseId,
        status: evoUniversityApplications.status,
        version: evoUniversityApplications.version,
      })
      .from(evoUniversityApplications)
      .where(eq(evoUniversityApplications.id, applicationId))
      .limit(1)
      .for("update");
    if (!current) throw new CanonicalCrmRepositoryError("not_found");
    const currentStatus = databaseUniversityApplicationStatus(current.status);
    if (
      current.version !== expectedVersion ||
      (currentStatus !== "draft" && currentStatus !== "submitted")
    ) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const [application] = await transaction
      .update(evoUniversityApplications)
      .set({
        nextAction,
        nextActionAt,
        version: sql`${evoUniversityApplications.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(evoUniversityApplications.id, applicationId),
          eq(evoUniversityApplications.version, expectedVersion),
          or(
            eq(evoUniversityApplications.status, "draft"),
            eq(evoUniversityApplications.status, "submitted"),
          ),
        ),
      )
      .returning({
        id: evoUniversityApplications.id,
        studentCaseId: evoUniversityApplications.studentCaseId,
        status: evoUniversityApplications.status,
        version: evoUniversityApplications.version,
      });
    if (!application) throw new CanonicalCrmRepositoryError("conflict");

    const result = {
      applicationId: application.id,
      studentCaseId: application.studentCaseId,
      status: databaseUniversityApplicationStatus(application.status),
      version: application.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "application",
      businessObjectId: application.id,
      transition: "application.next_action_updated",
      fromState: currentStatus,
      toState: currentStatus,
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "application",
      businessObjectId: application.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function transitionCanonicalUniversityApplication(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    applicationId: string;
    expectedVersion: number;
    toStatus: Exclude<CanonicalUniversityApplicationStatus, "draft">;
    reason?: string | null;
  }>,
): Promise<CanonicalUniversityApplicationResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const applicationId = uuid(input.applicationId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const toStatus = canonicalUniversityApplicationTransitionStatus(
    input.toStatus,
  );
  const reason = optionalBoundedText(input.reason, { maxLength: 2_000 });
  const needsReason = toStatus === "rejected" || toStatus === "withdrawn";
  if ((needsReason && reason === null) || (!needsReason && reason !== null)) {
    invalidInput();
  }
  const requestHash = sha256({
    actorRole: context.actorRole,
    applicationId,
    expectedVersion,
    toStatus,
    reason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.university_application.transition",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        applicationId: resultUuid(
          reservation.resultPayload,
          "applicationId",
        ),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        status: resultUniversityApplicationStatus(
          reservation.resultPayload,
          "status",
        ),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    const [candidate] = await transaction
      .select({ studentCaseId: evoUniversityApplications.studentCaseId })
      .from(evoUniversityApplications)
      .where(eq(evoUniversityApplications.id, applicationId))
      .limit(1);
    if (!candidate) throw new CanonicalCrmRepositoryError("not_found");
    await lockActiveHandedOffStudentCase(
      transaction,
      candidate.studentCaseId,
    );
    const [current] = await transaction
      .select({
        studentCaseId: evoUniversityApplications.studentCaseId,
        status: evoUniversityApplications.status,
        version: evoUniversityApplications.version,
      })
      .from(evoUniversityApplications)
      .where(eq(evoUniversityApplications.id, applicationId))
      .limit(1)
      .for("update");
    if (!current) throw new CanonicalCrmRepositoryError("not_found");
    const currentStatus = databaseUniversityApplicationStatus(current.status);
    const transitionAllowed =
      (currentStatus === "draft" &&
        (toStatus === "submitted" || toStatus === "withdrawn")) ||
      (currentStatus === "submitted" &&
        (toStatus === "accepted" ||
          toStatus === "rejected" ||
          toStatus === "withdrawn"));
    if (current.version !== expectedVersion || !transitionAllowed) {
      throw new CanonicalCrmRepositoryError("conflict");
    }
    if (toStatus === "submitted") {
      await requireFinanceProgressAllowed(transaction, current.studentCaseId);
    }

    const now = new Date();
    const [application] = await transaction
      .update(evoUniversityApplications)
      .set({
        status: toStatus,
        ...(toStatus === "submitted" ? { submittedAt: now } : {}),
        ...(toStatus === "accepted" ||
        toStatus === "rejected" ||
        toStatus === "withdrawn"
          ? {
              decidedAt: now,
              decisionReason: reason,
              nextAction: null,
              nextActionAt: null,
            }
          : {}),
        version: sql`${evoUniversityApplications.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(evoUniversityApplications.id, applicationId),
          eq(evoUniversityApplications.version, expectedVersion),
          eq(evoUniversityApplications.status, currentStatus),
        ),
      )
      .returning({
        id: evoUniversityApplications.id,
        studentCaseId: evoUniversityApplications.studentCaseId,
        status: evoUniversityApplications.status,
        version: evoUniversityApplications.version,
      });
    if (!application) throw new CanonicalCrmRepositoryError("conflict");

    const result = {
      applicationId: application.id,
      studentCaseId: application.studentCaseId,
      status: databaseUniversityApplicationStatus(application.status),
      version: application.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "application",
      businessObjectId: application.id,
      transition: `application.${toStatus}`,
      fromState: currentStatus,
      toState: toStatus,
      reason,
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "application",
      businessObjectId: application.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function transitionCanonicalVisaMilestone(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    visaMilestoneId: string;
    expectedVersion: number;
    toStatus: Exclude<CanonicalVisaMilestoneStatus, "pending">;
    reason?: string | null;
    nextAction?: string | null;
    nextActionAt?: string | null;
    dueAt?: string | null;
  }>,
): Promise<CanonicalVisaMilestoneResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const visaMilestoneId = uuid(input.visaMilestoneId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const toStatus = canonicalVisaMilestoneTransitionStatus(input.toStatus);
  const reason = optionalBoundedText(input.reason, { maxLength: 2_000 });
  const nextAction = optionalBoundedText(input.nextAction, {
    maxLength: 500,
    collapseWhitespace: true,
  });
  const nextActionAt = canonicalTaskDueAt(input.nextActionAt);
  const dueAt = canonicalTaskDueAt(input.dueAt);
  if (
    (toStatus === "blocked" && reason === null) ||
    (toStatus !== "blocked" && reason !== null) ||
    (nextActionAt !== null && nextAction === null) ||
    (toStatus === "completed" &&
      (nextAction !== null || nextActionAt !== null))
  ) {
    invalidInput();
  }
  const requestHash = sha256({
    actorRole: context.actorRole,
    visaMilestoneId,
    expectedVersion,
    toStatus,
    reason,
    nextAction,
    nextActionAt: nextActionAt?.toISOString() ?? null,
    dueAt: dueAt?.toISOString() ?? null,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.visa_milestone.transition",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        visaMilestoneId: resultUuid(
          reservation.resultPayload,
          "visaMilestoneId",
        ),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        milestoneKind: resultVisaMilestoneKind(
          reservation.resultPayload,
          "milestoneKind",
        ),
        status: resultVisaMilestoneStatus(
          reservation.resultPayload,
          "status",
        ),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    const [candidate] = await transaction
      .select({ studentCaseId: evoVisaMilestones.studentCaseId })
      .from(evoVisaMilestones)
      .where(eq(evoVisaMilestones.id, visaMilestoneId))
      .limit(1);
    if (!candidate) throw new CanonicalCrmRepositoryError("not_found");
    await lockActiveHandedOffStudentCase(
      transaction,
      candidate.studentCaseId,
    );
    const [current] = await transaction
      .select({
        studentCaseId: evoVisaMilestones.studentCaseId,
        milestoneKind: evoVisaMilestones.milestoneKind,
        status: evoVisaMilestones.status,
        version: evoVisaMilestones.version,
      })
      .from(evoVisaMilestones)
      .where(eq(evoVisaMilestones.id, visaMilestoneId))
      .limit(1)
      .for("update");
    if (!current) throw new CanonicalCrmRepositoryError("not_found");
    const currentStatus = databaseVisaMilestoneStatus(current.status);
    const milestoneKind = databaseVisaMilestoneKind(current.milestoneKind);
    const transitionAllowed =
      (currentStatus === "pending" &&
        (toStatus === "in_progress" || toStatus === "blocked")) ||
      (currentStatus === "in_progress" &&
        (toStatus === "completed" || toStatus === "blocked")) ||
      (currentStatus === "blocked" && toStatus === "in_progress");
    if (current.version !== expectedVersion || !transitionAllowed) {
      throw new CanonicalCrmRepositoryError("conflict");
    }
    if (
      milestoneKind === "submission" &&
      (toStatus === "in_progress" || toStatus === "completed")
    ) {
      await requireFinanceProgressAllowed(transaction, current.studentCaseId);
    }

    const now = new Date();
    const [visaMilestone] = await transaction
      .update(evoVisaMilestones)
      .set({
        status: toStatus,
        ownerRole: "admissions",
        nextAction: toStatus === "completed" ? null : nextAction,
        nextActionAt: toStatus === "completed" ? null : nextActionAt,
        dueAt,
        completedAt: toStatus === "completed" ? now : null,
        blockedReason: toStatus === "blocked" ? reason : null,
        version: sql`${evoVisaMilestones.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(evoVisaMilestones.id, visaMilestoneId),
          eq(evoVisaMilestones.version, expectedVersion),
          eq(evoVisaMilestones.status, currentStatus),
        ),
      )
      .returning({
        id: evoVisaMilestones.id,
        studentCaseId: evoVisaMilestones.studentCaseId,
        milestoneKind: evoVisaMilestones.milestoneKind,
        status: evoVisaMilestones.status,
        version: evoVisaMilestones.version,
      });
    if (!visaMilestone) throw new CanonicalCrmRepositoryError("conflict");

    const result = {
      visaMilestoneId: visaMilestone.id,
      studentCaseId: visaMilestone.studentCaseId,
      milestoneKind: databaseVisaMilestoneKind(
        visaMilestone.milestoneKind,
      ),
      status: databaseVisaMilestoneStatus(visaMilestone.status),
      version: visaMilestone.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "visa_milestone",
      businessObjectId: visaMilestone.id,
      transition: `visa_milestone.${toStatus}`,
      fromState: currentStatus,
      toState: toStatus,
      reason,
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "visa_milestone",
      businessObjectId: visaMilestone.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function assertCanonicalFinanceStop(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    studentCaseId: string;
    expectedVersion: number;
    reason: string;
  }>,
): Promise<CanonicalFinanceStopResult> {
  const context = parseCommandContext(input, ["admin", "admissions"]);
  const studentCaseId = uuid(input.studentCaseId);
  const expectedVersion = nonNegativeVersion(input.expectedVersion);
  const reason = boundedText(input.reason, { maxLength: 2_000 });
  const requestHash = sha256({
    actorRole: context.actorRole,
    studentCaseId,
    expectedVersion,
    reason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.finance_stop.assert",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        financeStopId: resultUuid(
          reservation.resultPayload,
          "financeStopId",
        ),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        isStopped: resultBoolean(reservation.resultPayload, "isStopped"),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    await lockActiveHandedOffStudentCase(transaction, studentCaseId);
    const [current] = await transaction
      .select({
        id: evoFinanceStopStates.id,
        isStopped: evoFinanceStopStates.isStopped,
        version: evoFinanceStopStates.version,
      })
      .from(evoFinanceStopStates)
      .where(eq(evoFinanceStopStates.studentCaseId, studentCaseId))
      .limit(1)
      .for("update");
    if (
      (current &&
        (current.version !== expectedVersion || current.isStopped)) ||
      (!current && expectedVersion !== 0)
    ) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const now = new Date();
    const [financeStop] = current
      ? await transaction
          .update(evoFinanceStopStates)
          .set({
            isStopped: true,
            reason,
            changedByRole: context.actorRole,
            version: sql`${evoFinanceStopStates.version} + 1`,
            changedAt: now,
          })
          .where(
            and(
              eq(evoFinanceStopStates.id, current.id),
              eq(evoFinanceStopStates.version, expectedVersion),
              eq(evoFinanceStopStates.isStopped, false),
            ),
          )
          .returning({
            id: evoFinanceStopStates.id,
            studentCaseId: evoFinanceStopStates.studentCaseId,
            isStopped: evoFinanceStopStates.isStopped,
            version: evoFinanceStopStates.version,
          })
      : await transaction
          .insert(evoFinanceStopStates)
          .values({
            id: randomUUID(),
            studentCaseId,
            isStopped: true,
            reason,
            changedByRole: context.actorRole,
            changedAt: now,
          })
          .returning({
            id: evoFinanceStopStates.id,
            studentCaseId: evoFinanceStopStates.studentCaseId,
            isStopped: evoFinanceStopStates.isStopped,
            version: evoFinanceStopStates.version,
          });
    if (!financeStop) throw new CanonicalCrmRepositoryError("conflict");

    const result = {
      financeStopId: financeStop.id,
      studentCaseId: financeStop.studentCaseId,
      isStopped: financeStop.isStopped,
      version: financeStop.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "finance_stop",
      businessObjectId: financeStop.id,
      transition: "finance_stop.asserted",
      fromState: current ? "released" : null,
      toState: "stopped",
      reason,
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "finance_stop",
      businessObjectId: financeStop.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function releaseCanonicalFinanceStop(
  input: Readonly<{
    actorRole: FixedRole;
    idempotencyKey: string;
    correlationId: string;
    financeStopId: string;
    expectedVersion: number;
    reason: string;
  }>,
): Promise<CanonicalFinanceStopResult> {
  const context = parseCommandContext(input, ["admin"]);
  const financeStopId = uuid(input.financeStopId);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const reason = boundedText(input.reason, { maxLength: 2_000 });
  const requestHash = sha256({
    actorRole: context.actorRole,
    financeStopId,
    expectedVersion,
    reason,
  });

  return runTransaction(async (transaction) => {
    const reservation = await reserveCommand(transaction, {
      commandName: "canonical.finance_stop.release",
      context,
      requestHash,
    });
    if (reservation.kind === "replay") {
      return {
        financeStopId: resultUuid(
          reservation.resultPayload,
          "financeStopId",
        ),
        studentCaseId: resultUuid(
          reservation.resultPayload,
          "studentCaseId",
        ),
        isStopped: resultBoolean(reservation.resultPayload, "isStopped"),
        version: resultPositiveVersion(reservation.resultPayload, "version"),
      };
    }

    const [candidate] = await transaction
      .select({ studentCaseId: evoFinanceStopStates.studentCaseId })
      .from(evoFinanceStopStates)
      .where(eq(evoFinanceStopStates.id, financeStopId))
      .limit(1);
    if (!candidate) throw new CanonicalCrmRepositoryError("not_found");
    await lockActiveHandedOffStudentCase(
      transaction,
      candidate.studentCaseId,
    );
    const [current] = await transaction
      .select({
        studentCaseId: evoFinanceStopStates.studentCaseId,
        isStopped: evoFinanceStopStates.isStopped,
        version: evoFinanceStopStates.version,
      })
      .from(evoFinanceStopStates)
      .where(eq(evoFinanceStopStates.id, financeStopId))
      .limit(1)
      .for("update");
    if (!current) throw new CanonicalCrmRepositoryError("not_found");
    if (current.version !== expectedVersion || !current.isStopped) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const [financeStop] = await transaction
      .update(evoFinanceStopStates)
      .set({
        isStopped: false,
        reason,
        changedByRole: context.actorRole,
        version: sql`${evoFinanceStopStates.version} + 1`,
        changedAt: new Date(),
      })
      .where(
        and(
          eq(evoFinanceStopStates.id, financeStopId),
          eq(evoFinanceStopStates.version, expectedVersion),
          eq(evoFinanceStopStates.isStopped, true),
        ),
      )
      .returning({
        id: evoFinanceStopStates.id,
        studentCaseId: evoFinanceStopStates.studentCaseId,
        isStopped: evoFinanceStopStates.isStopped,
        version: evoFinanceStopStates.version,
      });
    if (!financeStop) throw new CanonicalCrmRepositoryError("conflict");

    const result = {
      financeStopId: financeStop.id,
      studentCaseId: financeStop.studentCaseId,
      isStopped: financeStop.isStopped,
      version: financeStop.version,
    };
    await insertBusinessEvent(transaction, {
      context,
      businessObjectType: "finance_stop",
      businessObjectId: financeStop.id,
      transition: "finance_stop.released",
      fromState: "stopped",
      toState: "released",
      reason,
    });
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "finance_stop",
      businessObjectId: financeStop.id,
      resultPayload: result,
    });
    return result;
  });
}

export async function getCanonicalLeadSnapshot(
  input: Readonly<{ actorRole: FixedRole; leadId: string }>,
): Promise<CanonicalLeadSnapshot> {
  actorRole(input.actorRole, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  return runTransaction((transaction) =>
    selectLeadSnapshot(transaction, leadId),
  );
}

export async function getCanonicalLeadGateSnapshot(
  input: Readonly<{ actorRole: FixedRole; leadId: string }>,
): Promise<CanonicalLeadGateSnapshot> {
  actorRole(input.actorRole, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  return runTransaction((transaction) =>
    selectLeadGateSnapshot(transaction, leadId),
  );
}

export async function getCanonicalStudentCaseSnapshot(
  input: Readonly<{ actorRole: FixedRole; studentCaseId: string }>,
): Promise<CanonicalStudentCaseSnapshot> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const studentCaseId = uuid(input.studentCaseId);
  return runTransaction((transaction) =>
    selectStudentCaseSnapshot(transaction, studentCaseId),
  );
}

export async function getCanonicalStudentCaseHandoffSnapshot(
  input: Readonly<{ actorRole: FixedRole; studentCaseId: string }>,
): Promise<CanonicalStudentCaseHandoffSnapshot> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const studentCaseId = uuid(input.studentCaseId);
  return runTransaction((transaction) =>
    selectStudentCaseHandoffSnapshot(transaction, studentCaseId),
  );
}

export async function getCanonicalAdmissionsOperationsSnapshot(
  input: Readonly<{ actorRole: FixedRole; studentCaseId: string }>,
): Promise<CanonicalAdmissionsOperationsSnapshot> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const studentCaseId = uuid(input.studentCaseId);

  return runTransaction(async (transaction) => {
    await requireHandedOffStudentCase(transaction, studentCaseId);
    const studentCase = await selectStudentCaseSnapshot(
      transaction,
      studentCaseId,
    );
    const applicationRows = await transaction
      .select({
        applicationId: evoUniversityApplications.id,
        studentCaseId: evoUniversityApplications.studentCaseId,
        institutionName: evoUniversityApplications.institutionName,
        programName: evoUniversityApplications.programName,
        targetIntake: evoUniversityApplications.targetIntake,
        status: evoUniversityApplications.status,
        ownerRole: evoUniversityApplications.ownerRole,
        nextAction: evoUniversityApplications.nextAction,
        nextActionAt: evoUniversityApplications.nextActionAt,
        submittedAt: evoUniversityApplications.submittedAt,
        decidedAt: evoUniversityApplications.decidedAt,
        decisionReason: evoUniversityApplications.decisionReason,
        version: evoUniversityApplications.version,
        createdAt: evoUniversityApplications.createdAt,
        updatedAt: evoUniversityApplications.updatedAt,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoUniversityApplications)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoUniversityApplications.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .where(eq(evoUniversityApplications.studentCaseId, studentCaseId))
      .orderBy(
        desc(evoUniversityApplications.updatedAt),
        desc(evoUniversityApplications.id),
      );
    const visaRows = await transaction
      .select({
        visaMilestoneId: evoVisaMilestones.id,
        studentCaseId: evoVisaMilestones.studentCaseId,
        milestoneKind: evoVisaMilestones.milestoneKind,
        status: evoVisaMilestones.status,
        ownerRole: evoVisaMilestones.ownerRole,
        nextAction: evoVisaMilestones.nextAction,
        nextActionAt: evoVisaMilestones.nextActionAt,
        dueAt: evoVisaMilestones.dueAt,
        completedAt: evoVisaMilestones.completedAt,
        blockedReason: evoVisaMilestones.blockedReason,
        version: evoVisaMilestones.version,
        createdAt: evoVisaMilestones.createdAt,
        updatedAt: evoVisaMilestones.updatedAt,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoVisaMilestones)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoVisaMilestones.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .where(eq(evoVisaMilestones.studentCaseId, studentCaseId));
    if (visaRows.length !== CANONICAL_VISA_MILESTONE_KINDS.length) {
      throw new CanonicalCrmRepositoryError("unavailable");
    }
    const financeRows = await transaction
      .select({
        financeStopId: evoFinanceStopStates.id,
        studentCaseId: evoFinanceStopStates.studentCaseId,
        isStopped: evoFinanceStopStates.isStopped,
        reason: evoFinanceStopStates.reason,
        changedByRole: evoFinanceStopStates.changedByRole,
        version: evoFinanceStopStates.version,
        changedAt: evoFinanceStopStates.changedAt,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoFinanceStopStates)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoFinanceStopStates.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .where(eq(evoFinanceStopStates.studentCaseId, studentCaseId))
      .limit(2);
    if (financeRows.length > 1) {
      throw new CanonicalCrmRepositoryError("unavailable");
    }

    const visaMilestones = visaRows
      .map(canonicalVisaMilestoneRow)
      .sort(
        (left, right) =>
          CANONICAL_VISA_MILESTONE_KINDS.indexOf(left.milestoneKind) -
          CANONICAL_VISA_MILESTONE_KINDS.indexOf(right.milestoneKind),
      );
    return {
      studentCase,
      applications: applicationRows.map(canonicalUniversityApplicationRow),
      visaMilestones,
      financeStop: financeRows[0]
        ? canonicalFinanceStopRow(financeRows[0])
        : null,
    };
  });
}

export async function listCanonicalUniversityApplications(
  input: Readonly<{
    actorRole: FixedRole;
    cursor?: CanonicalReadCursor;
    pageSize?: number;
  }>,
): Promise<CanonicalUniversityApplicationQueuePage> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const cursor = optionalCanonicalReadCursor(input.cursor);
  const pageSize = canonicalReadPageSize(input.pageSize);

  return runTransaction(async (transaction) => {
    const cursorDate = cursor ? new Date(cursor.updatedAt) : undefined;
    const result = await transaction
      .select({
        applicationId: evoUniversityApplications.id,
        studentCaseId: evoUniversityApplications.studentCaseId,
        institutionName: evoUniversityApplications.institutionName,
        programName: evoUniversityApplications.programName,
        targetIntake: evoUniversityApplications.targetIntake,
        status: evoUniversityApplications.status,
        ownerRole: evoUniversityApplications.ownerRole,
        nextAction: evoUniversityApplications.nextAction,
        nextActionAt: evoUniversityApplications.nextActionAt,
        submittedAt: evoUniversityApplications.submittedAt,
        decidedAt: evoUniversityApplications.decidedAt,
        decisionReason: evoUniversityApplications.decisionReason,
        version: evoUniversityApplications.version,
        createdAt: evoUniversityApplications.createdAt,
        updatedAt: evoUniversityApplications.updatedAt,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoUniversityApplications)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoUniversityApplications.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .innerJoin(
        evoSalesAdmissionsHandoffs,
        eq(
          evoSalesAdmissionsHandoffs.studentCaseId,
          evoStudentCases.id,
        ),
      )
      .innerJoin(
        evoLeads,
        eq(evoLeads.id, evoSalesAdmissionsHandoffs.leadId),
      )
      .where(
        and(
          eq(evoStudentCases.status, "active"),
          eq(evoLeads.stage, "handed_off"),
          cursorDate
            ? or(
                lt(evoUniversityApplications.updatedAt, cursorDate),
                and(
                  eq(evoUniversityApplications.updatedAt, cursorDate),
                  lt(evoUniversityApplications.id, cursor!.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(evoUniversityApplications.updatedAt),
        desc(evoUniversityApplications.id),
      )
      .limit(pageSize + 1);
    const hasNext = result.length > pageSize;
    const rows = result
      .slice(0, pageSize)
      .map(canonicalUniversityApplicationRow);
    const lastRow = rows.at(-1);
    return {
      rows,
      hasNext,
      nextCursor:
        hasNext && lastRow
          ? { updatedAt: lastRow.updatedAt, id: lastRow.applicationId }
          : null,
    };
  });
}

export async function listCanonicalVisaMilestones(
  input: Readonly<{
    actorRole: FixedRole;
    cursor?: CanonicalReadCursor;
    pageSize?: number;
  }>,
): Promise<CanonicalVisaMilestoneQueuePage> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const cursor = optionalCanonicalReadCursor(input.cursor);
  const pageSize = canonicalReadPageSize(input.pageSize);

  return runTransaction(async (transaction) => {
    const cursorDate = cursor ? new Date(cursor.updatedAt) : undefined;
    const result = await transaction
      .select({
        visaMilestoneId: evoVisaMilestones.id,
        studentCaseId: evoVisaMilestones.studentCaseId,
        milestoneKind: evoVisaMilestones.milestoneKind,
        status: evoVisaMilestones.status,
        ownerRole: evoVisaMilestones.ownerRole,
        nextAction: evoVisaMilestones.nextAction,
        nextActionAt: evoVisaMilestones.nextActionAt,
        dueAt: evoVisaMilestones.dueAt,
        completedAt: evoVisaMilestones.completedAt,
        blockedReason: evoVisaMilestones.blockedReason,
        version: evoVisaMilestones.version,
        createdAt: evoVisaMilestones.createdAt,
        updatedAt: evoVisaMilestones.updatedAt,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoVisaMilestones)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoVisaMilestones.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .innerJoin(
        evoSalesAdmissionsHandoffs,
        eq(
          evoSalesAdmissionsHandoffs.studentCaseId,
          evoStudentCases.id,
        ),
      )
      .innerJoin(
        evoLeads,
        eq(evoLeads.id, evoSalesAdmissionsHandoffs.leadId),
      )
      .where(
        and(
          eq(evoStudentCases.status, "active"),
          eq(evoLeads.stage, "handed_off"),
          cursorDate
            ? or(
                lt(evoVisaMilestones.updatedAt, cursorDate),
                and(
                  eq(evoVisaMilestones.updatedAt, cursorDate),
                  lt(evoVisaMilestones.id, cursor!.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(evoVisaMilestones.updatedAt), desc(evoVisaMilestones.id))
      .limit(pageSize + 1);
    const hasNext = result.length > pageSize;
    const rows = result.slice(0, pageSize).map(canonicalVisaMilestoneRow);
    const lastRow = rows.at(-1);
    return {
      rows,
      hasNext,
      nextCursor:
        hasNext && lastRow
          ? { updatedAt: lastRow.updatedAt, id: lastRow.visaMilestoneId }
          : null,
    };
  });
}

export async function listCanonicalFinanceStops(
  input: Readonly<{
    actorRole: FixedRole;
    cursor?: CanonicalReadCursor;
    pageSize?: number;
  }>,
): Promise<CanonicalFinanceStopQueuePage> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const cursor = optionalCanonicalReadCursor(input.cursor);
  const pageSize = canonicalReadPageSize(input.pageSize);

  return runTransaction(async (transaction) => {
    const cursorDate = cursor ? new Date(cursor.updatedAt) : undefined;
    const result = await transaction
      .select({
        financeStopId: evoFinanceStopStates.id,
        studentCaseId: evoFinanceStopStates.studentCaseId,
        isStopped: evoFinanceStopStates.isStopped,
        reason: evoFinanceStopStates.reason,
        changedByRole: evoFinanceStopStates.changedByRole,
        version: evoFinanceStopStates.version,
        changedAt: evoFinanceStopStates.changedAt,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoFinanceStopStates)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoFinanceStopStates.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .innerJoin(
        evoSalesAdmissionsHandoffs,
        eq(
          evoSalesAdmissionsHandoffs.studentCaseId,
          evoStudentCases.id,
        ),
      )
      .innerJoin(
        evoLeads,
        eq(evoLeads.id, evoSalesAdmissionsHandoffs.leadId),
      )
      .where(
        and(
          eq(evoStudentCases.status, "active"),
          eq(evoLeads.stage, "handed_off"),
          cursorDate
            ? or(
                lt(evoFinanceStopStates.changedAt, cursorDate),
                and(
                  eq(evoFinanceStopStates.changedAt, cursorDate),
                  lt(evoFinanceStopStates.id, cursor!.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(evoFinanceStopStates.changedAt),
        desc(evoFinanceStopStates.id),
      )
      .limit(pageSize + 1);
    const hasNext = result.length > pageSize;
    const rows = result.slice(0, pageSize).map(canonicalFinanceStopRow);
    const lastRow = rows.at(-1);
    return {
      rows,
      hasNext,
      nextCursor:
        hasNext && lastRow
          ? { updatedAt: lastRow.changedAt, id: lastRow.financeStopId }
          : null,
    };
  });
}

export async function listCanonicalLeadConversations(
  input: Readonly<{ actorRole: FixedRole; leadId: string }>,
): Promise<readonly CanonicalLeadConversationSummary[]> {
  actorRole(input.actorRole, ["admin", "sales"]);
  const leadId = uuid(input.leadId);

  return runTransaction(async (transaction) => {
    const [lead] = await transaction
      .select({ id: evoLeads.id })
      .from(evoLeads)
      .where(eq(evoLeads.id, leadId))
      .limit(1);
    if (!lead) throw new CanonicalCrmRepositoryError("not_found");

    const rows = await transaction
      .select({
        conversationId: evoConversations.id,
        leadId: evoConversations.leadId,
        channel: evoConversations.channel,
        externalConversationId: evoConversations.externalConversationId,
        status: evoConversations.status,
        owningRole: evoConversations.owningRole,
        version: evoConversations.version,
        createdAt: evoConversations.createdAt,
        updatedAt: evoConversations.updatedAt,
      })
      .from(evoConversations)
      .where(eq(evoConversations.leadId, leadId))
      .orderBy(desc(evoConversations.updatedAt), desc(evoConversations.id))
      .limit(50);

    return rows.map((row) => ({
      ...row,
      channel: databaseConversationChannel(row.channel),
      status: databaseConversationStatus(row.status),
      owningRole: databaseConversationOwningRole(row.owningRole),
      createdAt: dateString(row.createdAt),
      updatedAt: dateString(row.updatedAt),
    }));
  });
}

export async function getCanonicalLeadConversationThread(
  input: Readonly<{
    actorRole: FixedRole;
    leadId: string;
    conversationId: string;
    cursor?: CanonicalMessageCursor | null;
    pageSize?: number;
  }>,
): Promise<CanonicalLeadConversationThread> {
  actorRole(input.actorRole, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  const conversationId = uuid(input.conversationId);
  const cursor = optionalCanonicalMessageCursor(input.cursor);
  const pageSize = canonicalReadPageSize(input.pageSize);

  return runTransaction(async (transaction) => {
    const [conversationRow] = await transaction
      .select({
        conversationId: evoConversations.id,
        leadId: evoConversations.leadId,
        channel: evoConversations.channel,
        externalConversationId: evoConversations.externalConversationId,
        status: evoConversations.status,
        owningRole: evoConversations.owningRole,
        version: evoConversations.version,
        createdAt: evoConversations.createdAt,
        updatedAt: evoConversations.updatedAt,
      })
      .from(evoConversations)
      .where(
        and(
          eq(evoConversations.id, conversationId),
          eq(evoConversations.leadId, leadId),
        ),
      )
      .limit(1);
    if (!conversationRow) {
      throw new CanonicalCrmRepositoryError("not_found");
    }

    const cursorDate = cursor ? new Date(cursor.occurredAt) : undefined;
    const result = await transaction
      .select({
        messageId: evoMessages.id,
        conversationId: evoMessages.conversationId,
        direction: evoMessages.direction,
        externalMessageId: evoMessages.externalMessageId,
        body: evoMessages.body,
        authorRole: evoMessages.authorRole,
        occurredAt: evoMessages.occurredAt,
        createdAt: evoMessages.createdAt,
      })
      .from(evoMessages)
      .where(
        and(
          eq(evoMessages.conversationId, conversationId),
          cursorDate
            ? or(
                lt(evoMessages.occurredAt, cursorDate),
                and(
                  eq(evoMessages.occurredAt, cursorDate),
                  lt(evoMessages.id, cursor!.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(evoMessages.occurredAt), desc(evoMessages.id))
      .limit(pageSize + 1);

    const hasNext = result.length > pageSize;
    const messages = result.slice(0, pageSize).map((row) => {
      const direction = databaseMessageDirection(row.direction);
      const normalizedAuthorRole =
        row.authorRole === null ? null : databaseRole(row.authorRole);
      if (
        (direction === "inbound" && normalizedAuthorRole !== null) ||
        (direction === "outbound" && normalizedAuthorRole === null)
      ) {
        throw new CanonicalCrmRepositoryError("unavailable");
      }
      return {
        ...row,
        direction,
        authorRole: normalizedAuthorRole,
        occurredAt: dateString(row.occurredAt),
        createdAt: dateString(row.createdAt),
      };
    });
    const lastMessage = messages.at(-1);

    return {
      conversation: {
        ...conversationRow,
        channel: databaseConversationChannel(conversationRow.channel),
        status: databaseConversationStatus(conversationRow.status),
        owningRole: databaseConversationOwningRole(
          conversationRow.owningRole,
        ),
        createdAt: dateString(conversationRow.createdAt),
        updatedAt: dateString(conversationRow.updatedAt),
      },
      messages,
      hasNext,
      nextCursor:
        hasNext && lastMessage
          ? { occurredAt: lastMessage.occurredAt, id: lastMessage.messageId }
          : null,
    };
  });
}

export async function listCanonicalAdmissionsTasks(
  input: Readonly<{
    actorRole: FixedRole;
    studentCaseId?: string;
    pageSize?: number;
  }>,
): Promise<CanonicalAdmissionsTaskQueuePage> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const studentCaseId =
    input.studentCaseId === undefined ? undefined : uuid(input.studentCaseId);
  const pageSize = canonicalReadPageSize(input.pageSize);

  return runTransaction(async (transaction) => {
    const result = await transaction
      .select({
        taskId: evoAdmissionsTasks.id,
        studentCaseId: evoAdmissionsTasks.studentCaseId,
        title: evoAdmissionsTasks.title,
        details: evoAdmissionsTasks.details,
        status: evoAdmissionsTasks.status,
        dueAt: evoAdmissionsTasks.dueAt,
        assignedRole: evoAdmissionsTasks.assignedRole,
        version: evoAdmissionsTasks.version,
        createdAt: evoAdmissionsTasks.createdAt,
        updatedAt: evoAdmissionsTasks.updatedAt,
        closedAt: evoAdmissionsTasks.closedAt,
        closedByRole: evoAdmissionsTasks.closedByRole,
        closureReason: evoAdmissionsTasks.closureReason,
        studentCaseStatus: evoStudentCases.status,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
      })
      .from(evoAdmissionsTasks)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoAdmissionsTasks.studentCaseId),
      )
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .where(
        studentCaseId
          ? eq(evoAdmissionsTasks.studentCaseId, studentCaseId)
          : undefined,
      )
      .orderBy(desc(evoAdmissionsTasks.createdAt), desc(evoAdmissionsTasks.id))
      .limit(pageSize + 1);

    const hasNext = result.length > pageSize;
    const rows = result.slice(0, pageSize).map((row) => ({
      ...row,
      status: databaseTaskStatus(row.status),
      dueAt: optionalDateString(row.dueAt),
      assignedRole: databaseAdmissionsTaskRole(row.assignedRole),
      createdAt: dateString(row.createdAt),
      updatedAt: dateString(row.updatedAt),
      closedAt: optionalDateString(row.closedAt),
      closedByRole: databaseTaskClosedByRole(row.closedByRole),
      studentCaseStatus: databaseStudentCaseStatus(row.studentCaseStatus),
    }));
    return { rows, hasNext };
  });
}

export async function listCanonicalStudentCases(
  input: Readonly<{
    actorRole: FixedRole;
    cursor?: CanonicalReadCursor;
    status?: CanonicalStudentCaseStatus;
    pageSize?: number;
    query?: string;
  }>,
): Promise<CanonicalStudentCaseQueuePage> {
  actorRole(input.actorRole, ["admin", "admissions"]);
  const cursor = optionalCanonicalReadCursor(input.cursor);
  const pageSize = canonicalReadPageSize(input.pageSize);
  const query = canonicalReadQuery(input.query);
  if (
    input.status !== undefined &&
    !isCanonicalStudentCaseStatus(input.status)
  ) {
    invalidInput();
  }

  return runTransaction(async (transaction) => {
    const cursorDate = cursor ? new Date(cursor.updatedAt) : undefined;
    const searchPattern = query ? literalLikePattern(query) : undefined;
    const result = await transaction
      .select({
        studentCaseId: evoStudentCases.id,
        leadId: evoStudentCases.leadId,
        personId: evoStudentCases.personId,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
        status: evoStudentCases.status,
        assignedRole: evoStudentCases.ownerRole,
        createdAt: evoStudentCases.createdAt,
        updatedAt: evoStudentCases.updatedAt,
      })
      .from(evoStudentCases)
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .where(
        and(
          input.status ? eq(evoStudentCases.status, input.status) : undefined,
          cursorDate
            ? or(
                lt(evoStudentCases.updatedAt, cursorDate),
                and(
                  eq(evoStudentCases.updatedAt, cursorDate),
                  lt(evoStudentCases.id, cursor!.id),
                ),
              )
            : undefined,
          searchPattern
            ? or(
                ilike(evoPeople.fullName, searchPattern),
                ilike(evoPeople.email, searchPattern),
                ilike(evoPeople.phoneE164, searchPattern),
                ilike(evoPeople.id, searchPattern),
                ilike(evoStudentCases.id, searchPattern),
                ilike(evoStudentCases.leadId, searchPattern),
              )
            : undefined,
        ),
      )
      .orderBy(desc(evoStudentCases.updatedAt), desc(evoStudentCases.id))
      .limit(pageSize + 1);

    const hasNext = result.length > pageSize;
    const rows = result.slice(0, pageSize).map((row) => ({
      ...row,
      status: databaseStudentCaseStatus(row.status),
      assignedRole: databaseRole(row.assignedRole),
      createdAt: dateString(row.createdAt),
      updatedAt: dateString(row.updatedAt),
    }));
    const lastRow = rows.at(-1);
    return {
      rows,
      hasNext,
      nextCursor:
        hasNext && lastRow
          ? { updatedAt: lastRow.updatedAt, id: lastRow.studentCaseId }
          : null,
    };
  });
}

export async function listCanonicalSalesLeads(
  input: Readonly<{
    actorRole: FixedRole;
    cursor?: CanonicalReadCursor;
    stage?: CanonicalSalesStage;
    due?: CanonicalSalesDueFilter;
    pageSize?: number;
    query?: string;
  }>,
): Promise<CanonicalSalesLeadQueuePage> {
  actorRole(input.actorRole, ["admin", "sales"]);
  const cursor = optionalCanonicalReadCursor(input.cursor);
  const stage = optionalCanonicalSalesStage(input.stage);
  const due = canonicalSalesDueFilter(input.due);
  const pageSize = canonicalReadPageSize(input.pageSize);
  const query = canonicalReadQuery(input.query);

  return runTransaction(async (transaction) => {
    const cursorDate = cursor ? new Date(cursor.updatedAt) : undefined;
    const searchPattern = query ? literalLikePattern(query) : undefined;
    const result = await transaction
      .select({
        leadId: evoLeads.id,
        personId: evoPeople.id,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
        source: evoLeads.source,
        stage: evoLeads.stage,
        ownerRole: evoLeads.ownerRole,
        qualificationSummary: evoLeads.qualificationSummary,
        nextAction: evoLeads.nextAction,
        nextActionAt: evoLeads.nextActionAt,
        version: evoLeads.version,
        createdAt: evoLeads.createdAt,
        updatedAt: evoLeads.updatedAt,
      })
      .from(evoLeads)
      .innerJoin(evoPeople, eq(evoPeople.id, evoLeads.personId))
      .where(
        and(
          stage ? eq(evoLeads.stage, stage) : undefined,
          canonicalSalesDueCondition(due),
          cursorDate
            ? or(
                lt(evoLeads.updatedAt, cursorDate),
                and(
                  eq(evoLeads.updatedAt, cursorDate),
                  lt(evoLeads.id, cursor!.id),
                ),
              )
            : undefined,
          searchPattern
            ? or(
                ilike(evoPeople.fullName, searchPattern),
                ilike(evoPeople.email, searchPattern),
                ilike(evoPeople.phoneE164, searchPattern),
                ilike(evoPeople.id, searchPattern),
                ilike(evoLeads.id, searchPattern),
              )
            : undefined,
        ),
      )
      .orderBy(desc(evoLeads.updatedAt), desc(evoLeads.id))
      .limit(pageSize + 1);

    const hasNext = result.length > pageSize;
    const rows = result.slice(0, pageSize).map((row) => ({
      ...row,
      stage: databaseSalesStage(row.stage),
      ownerRole: databaseSalesOwnerRole(row.ownerRole),
      nextActionAt: optionalDateString(row.nextActionAt),
      createdAt: dateString(row.createdAt),
      updatedAt: dateString(row.updatedAt),
    }));
    const lastRow = rows.at(-1);
    return {
      rows,
      hasNext,
      nextCursor:
        hasNext && lastRow
          ? { updatedAt: lastRow.updatedAt, id: lastRow.leadId }
          : null,
    };
  });
}
