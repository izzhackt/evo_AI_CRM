import type { PlatformActor } from "./platform-auth";

const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform finance control data is unavailable.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const PLATFORM_FINANCE_CONTROL_ROLES = ["admin", "sales", "admissions"] as const;
const PLATFORM_OBLIGATION_CATEGORIES = [
  "evo_service_fee",
  "third_party_cost",
] as const;
const PLATFORM_OBLIGATION_STATUSES = [
  "pending",
  "partially_paid",
  "paid",
  "overdue",
] as const;
const PLATFORM_FINANCE_AUDIT_ACTIONS = [
  "finance.obligation.create",
  "finance.payment.record",
  "finance.stop.create",
  "finance.stop.resolve",
] as const;
const PLATFORM_FINANCE_AUDIT_RESOURCE_TYPES = [
  "payment_obligation",
  "payment_event",
  "stop_factor",
] as const;

const CASE_PAYLOAD_KEYS = [
  "organization_id",
  "student_case_id",
  "obligations",
  "history",
] as const;
const OBLIGATION_KEYS = [
  "payment_obligation_id",
  "label",
  "category",
  "amount_minor",
  "currency",
  "due_at",
  "total_paid_minor",
  "total_refunded_minor",
  "outstanding_minor",
  "derived_status",
  "overdue",
  "next_action",
  "payment_confirmation_count",
  "last_payment_at",
  "active_stop_factors",
] as const;
const ACTIVE_STOP_FACTOR_KEYS = [
  "stop_factor_id",
  "reason",
  "blocked_action",
  "next_action",
  "owner_display_name",
  "created_at",
] as const;
const HISTORY_KEYS = [
  "audit_event_id",
  "action",
  "resource_type",
  "resource_id",
  "actor_display_name",
  "reason",
  "created_at",
] as const;
const QUEUE_ROW_KEYS = [
  "organization_id",
  "student_case_id",
  "overdue_obligation_count",
  "outstanding_obligation_count",
  "active_stop_factor_count",
  "blocked_action",
  "stop_reason",
  "stop_next_action",
] as const;

const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_QUEUE_LIMIT = 100;
const MAX_HISTORY_LIMIT = 100;
const MAX_QUEUE_LIMIT = 100;
const MAX_CASE_OBLIGATIONS = 500;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformFinanceControlRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformFinanceControlDependencies = Readonly<{
  client?: PlatformFinanceControlRpcClient;
}>;

export type PlatformFinanceControlQueueOptions = Readonly<{
  limit?: number;
  studentCaseIds?: readonly string[];
}>;

export type PlatformFinanceControlObligationCategory =
  (typeof PLATFORM_OBLIGATION_CATEGORIES)[number];
export type PlatformFinanceControlObligationStatus =
  (typeof PLATFORM_OBLIGATION_STATUSES)[number];
export type PlatformFinanceControlAuditAction =
  (typeof PLATFORM_FINANCE_AUDIT_ACTIONS)[number];
export type PlatformFinanceControlAuditResourceType =
  (typeof PLATFORM_FINANCE_AUDIT_RESOURCE_TYPES)[number];

export type PlatformFinanceControlActiveStopFactor = Readonly<{
  stopFactorId: string;
  reason: string;
  blockedAction: string;
  nextAction: string;
  ownerDisplayName: string;
  createdAt: string;
}>;

export type PlatformFinanceControlObligation = Readonly<{
  paymentObligationId: string;
  label: string;
  category: PlatformFinanceControlObligationCategory;
  amountMinor: number;
  currency: string;
  dueAt: string;
  totalPaidMinor: number;
  totalRefundedMinor: number;
  outstandingMinor: number;
  status: PlatformFinanceControlObligationStatus;
  overdue: boolean;
  nextAction: string;
  paymentConfirmationCount: number;
  lastPaymentAt: string | null;
  activeStopFactors: readonly PlatformFinanceControlActiveStopFactor[];
}>;

export type PlatformFinanceControlHistoryEntry = Readonly<{
  auditEventId: string;
  action: PlatformFinanceControlAuditAction;
  resourceType: PlatformFinanceControlAuditResourceType;
  resourceId: string;
  actorDisplayName: string | null;
  reason: string | null;
  createdAt: string;
}>;

export type PlatformCaseFinanceControl = Readonly<{
  organizationId: string;
  studentCaseId: string;
  obligations: readonly PlatformFinanceControlObligation[];
  history: readonly PlatformFinanceControlHistoryEntry[];
}>;

export type PlatformFinanceControlQueueRow = Readonly<{
  organizationId: string;
  studentCaseId: string;
  overdueObligationCount: number;
  outstandingObligationCount: number;
  activeStopFactorCount: number;
  blockedAction: string | null;
  stopReason: string | null;
  stopNextAction: string | null;
}>;

export class PlatformFinanceControlRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformFinanceControlRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformFinanceControlRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformFinanceControlRepositoryError) throw error;
  throw new PlatformFinanceControlRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : requiredText(value, maximum);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function nonNegativeSafeInteger(value: unknown): number {
  const numeric =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isSafeInteger(numeric) ||
    numeric < 0
  ) {
    return invalidShape();
  }
  return numeric;
}

function normalizedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    return invalidShape();
  }
  return value;
}

function normalizedStudentCaseIds(
  value: readonly string[] | undefined,
): readonly string[] | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > MAX_QUEUE_LIMIT) {
    return invalidShape();
  }
  const normalized = value.map(requiredUuid);
  if (new Set(normalized).size !== normalized.length) return invalidShape();
  return Object.freeze(normalized);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidShape();
  }
  return value as T[number];
}

function unwrapSingleObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return value[0];
  }
  return invalidShape();
}

function requireActorOrganization(actor: PlatformActor): string {
  oneOf(actor.platformRole, PLATFORM_FINANCE_CONTROL_ROLES);
  return requiredUuid(actor.organizationId);
}

function normalizeActiveStopFactor(
  value: unknown,
): PlatformFinanceControlActiveStopFactor {
  if (!isRecord(value) || !hasExactKeys(value, ACTIVE_STOP_FACTOR_KEYS)) {
    return invalidShape();
  }
  return Object.freeze({
    stopFactorId: requiredUuid(value.stop_factor_id),
    reason: requiredText(value.reason, 1_000),
    blockedAction: requiredText(value.blocked_action, 200),
    nextAction: requiredText(value.next_action, 1_000),
    ownerDisplayName: requiredText(value.owner_display_name, 200),
    createdAt: requiredTimestamp(value.created_at),
  });
}

function normalizeObligation(value: unknown): PlatformFinanceControlObligation {
  if (!isRecord(value) || !hasExactKeys(value, OBLIGATION_KEYS)) {
    return invalidShape();
  }
  const amountMinor = nonNegativeSafeInteger(value.amount_minor);
  const totalPaidMinor = nonNegativeSafeInteger(value.total_paid_minor);
  const totalRefundedMinor = nonNegativeSafeInteger(value.total_refunded_minor);
  const outstandingMinor = nonNegativeSafeInteger(value.outstanding_minor);
  const status = oneOf(value.derived_status, PLATFORM_OBLIGATION_STATUSES);
  const overdue = typeof value.overdue === "boolean"
    ? value.overdue
    : invalidShape();
  const paymentConfirmationCount = nonNegativeSafeInteger(
    value.payment_confirmation_count,
  );
  const lastPaymentAt = optionalTimestamp(value.last_payment_at);

  if (
    totalRefundedMinor > totalPaidMinor ||
    outstandingMinor !== amountMinor - totalPaidMinor + totalRefundedMinor ||
    overdue !== (status === "overdue") ||
    (status === "paid" && outstandingMinor !== 0) ||
    (status !== "paid" && outstandingMinor === 0) ||
    (status === "partially_paid" && totalPaidMinor - totalRefundedMinor <= 0) ||
    (paymentConfirmationCount === 0 &&
      (totalPaidMinor !== 0 || lastPaymentAt !== null)) ||
    (paymentConfirmationCount > 0 &&
      (totalPaidMinor === 0 || lastPaymentAt === null))
  ) {
    return invalidShape();
  }

  if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
    return invalidShape();
  }
  if (!Array.isArray(value.active_stop_factors)) return invalidShape();
  const seenStopFactors = new Set<string>();
  const activeStopFactors = Object.freeze(value.active_stop_factors.map((row) => {
    const stopFactor = normalizeActiveStopFactor(row);
    if (seenStopFactors.has(stopFactor.stopFactorId)) return invalidShape();
    seenStopFactors.add(stopFactor.stopFactorId);
    return stopFactor;
  }));

  return Object.freeze({
    paymentObligationId: requiredUuid(value.payment_obligation_id),
    label: requiredText(value.label, 500),
    category: oneOf(value.category, PLATFORM_OBLIGATION_CATEGORIES),
    amountMinor,
    currency: value.currency,
    dueAt: requiredTimestamp(value.due_at),
    totalPaidMinor,
    totalRefundedMinor,
    outstandingMinor,
    status,
    overdue,
    nextAction: requiredText(value.next_action, 1_000),
    paymentConfirmationCount,
    lastPaymentAt,
    activeStopFactors,
  });
}

function normalizeHistoryEntry(
  value: unknown,
): PlatformFinanceControlHistoryEntry {
  if (!isRecord(value) || !hasExactKeys(value, HISTORY_KEYS)) {
    return invalidShape();
  }
  const action = oneOf(value.action, PLATFORM_FINANCE_AUDIT_ACTIONS);
  const resourceType = oneOf(
    value.resource_type,
    PLATFORM_FINANCE_AUDIT_RESOURCE_TYPES,
  );
  if (
    (action === "finance.obligation.create" &&
      resourceType !== "payment_obligation") ||
    (action === "finance.payment.record" && resourceType !== "payment_event") ||
    ((action === "finance.stop.create" || action === "finance.stop.resolve") &&
      resourceType !== "stop_factor")
  ) {
    return invalidShape();
  }
  return Object.freeze({
    auditEventId: requiredUuid(value.audit_event_id),
    action,
    resourceType,
    resourceId: requiredUuid(value.resource_id),
    actorDisplayName: optionalText(value.actor_display_name, 200),
    reason: optionalText(value.reason, 1_000),
    createdAt: requiredTimestamp(value.created_at),
  });
}

export function normalizePlatformCaseFinanceControl(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
  historyLimit = DEFAULT_HISTORY_LIMIT,
): PlatformCaseFinanceControl {
  const payload = unwrapSingleObject(value);
  if (!hasExactKeys(payload, CASE_PAYLOAD_KEYS)) return invalidShape();
  const organizationId = requiredUuid(payload.organization_id);
  const studentCaseId = requiredUuid(payload.student_case_id);
  if (
    organizationId !== requiredUuid(expectedOrganizationId) ||
    studentCaseId !== requiredUuid(expectedStudentCaseId)
  ) {
    return invalidShape();
  }
  const boundedHistoryLimit = normalizedLimit(
    historyLimit,
    DEFAULT_HISTORY_LIMIT,
    MAX_HISTORY_LIMIT,
  );
  if (
    !Array.isArray(payload.obligations) ||
    payload.obligations.length > MAX_CASE_OBLIGATIONS ||
    !Array.isArray(payload.history) ||
    payload.history.length > boundedHistoryLimit
  ) {
    return invalidShape();
  }

  const seenObligations = new Set<string>();
  const obligations = Object.freeze(payload.obligations.map((row) => {
    const obligation = normalizeObligation(row);
    if (seenObligations.has(obligation.paymentObligationId)) {
      return invalidShape();
    }
    seenObligations.add(obligation.paymentObligationId);
    return obligation;
  }));
  const seenHistory = new Set<string>();
  const history = Object.freeze(payload.history.map((row) => {
    const entry = normalizeHistoryEntry(row);
    if (seenHistory.has(entry.auditEventId)) return invalidShape();
    seenHistory.add(entry.auditEventId);
    return entry;
  }));

  return Object.freeze({ organizationId, studentCaseId, obligations, history });
}

export function normalizePlatformFinanceControlQueueRow(
  value: unknown,
  expectedOrganizationId: string,
): PlatformFinanceControlQueueRow {
  if (!isRecord(value) || !hasExactKeys(value, QUEUE_ROW_KEYS)) {
    return invalidShape();
  }
  const organizationId = requiredUuid(value.organization_id);
  if (organizationId !== requiredUuid(expectedOrganizationId)) {
    return invalidShape();
  }
  const overdueObligationCount = nonNegativeSafeInteger(
    value.overdue_obligation_count,
  );
  const outstandingObligationCount = nonNegativeSafeInteger(
    value.outstanding_obligation_count,
  );
  const activeStopFactorCount = nonNegativeSafeInteger(
    value.active_stop_factor_count,
  );
  if (overdueObligationCount > outstandingObligationCount) {
    return invalidShape();
  }

  const blockedAction = optionalText(value.blocked_action, 200);
  const stopReason = optionalText(value.stop_reason, 1_000);
  const stopNextAction = optionalText(value.stop_next_action, 1_000);
  const stopFields = [blockedAction, stopReason, stopNextAction];
  if (
    (activeStopFactorCount === 0 && stopFields.some((field) => field !== null)) ||
    (activeStopFactorCount > 0 && stopFields.some((field) => field === null))
  ) {
    return invalidShape();
  }

  return Object.freeze({
    organizationId,
    studentCaseId: requiredUuid(value.student_case_id),
    overdueObligationCount,
    outstandingObligationCount,
    activeStopFactorCount,
    blockedAction,
    stopReason,
    stopNextAction,
  });
}

async function getPlatformClient(): Promise<PlatformFinanceControlRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export async function getPlatformCaseFinanceControl(
  actor: PlatformActor,
  studentCaseId: string,
  limit?: number,
  dependencies: PlatformFinanceControlDependencies = {},
): Promise<PlatformCaseFinanceControl> {
  try {
    const organizationId = requireActorOrganization(actor);
    const normalizedStudentCaseId = requiredUuid(studentCaseId);
    const historyLimit = normalizedLimit(
      limit,
      DEFAULT_HISTORY_LIMIT,
      MAX_HISTORY_LIMIT,
    );
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_case_finance_control",
      {
        p_student_case_id: normalizedStudentCaseId,
        p_history_limit: historyLimit,
      },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizePlatformCaseFinanceControl(
      response.data,
      organizationId,
      normalizedStudentCaseId,
      historyLimit,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformFinanceControlQueue(
  actor: PlatformActor,
  options: PlatformFinanceControlQueueOptions = {},
  dependencies: PlatformFinanceControlDependencies = {},
): Promise<readonly PlatformFinanceControlQueueRow[]> {
  try {
    const organizationId = requireActorOrganization(actor);
    const studentCaseIds = normalizedStudentCaseIds(options.studentCaseIds);
    const queueLimit = normalizedLimit(
      options.limit,
      studentCaseIds?.length ?? DEFAULT_QUEUE_LIMIT,
      MAX_QUEUE_LIMIT,
    );
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_finance_control_queue",
      {
        p_limit: queueLimit,
        p_student_case_ids: studentCaseIds,
      },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > queueLimit
    ) {
      return invalidShape();
    }
    const requestedStudentCaseIds = studentCaseIds === null
      ? null
      : new Set(studentCaseIds);
    const seenStudentCases = new Set<string>();
    return Object.freeze(response.data.map((value) => {
      const row = normalizePlatformFinanceControlQueueRow(value, organizationId);
      if (
        requestedStudentCaseIds !== null &&
        !requestedStudentCaseIds.has(row.studentCaseId)
      ) {
        return invalidShape();
      }
      if (seenStudentCases.has(row.studentCaseId)) return invalidShape();
      seenStudentCases.add(row.studentCaseId);
      return row;
    }));
  } catch (error) {
    return failClosed(error);
  }
}
