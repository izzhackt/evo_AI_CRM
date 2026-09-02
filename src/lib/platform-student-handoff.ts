import type { PlatformActor } from "./platform-auth";
import {
  PLATFORM_SALES_STAGES,
  type PlatformSalesStage,
} from "./platform-sales-contract.ts";

const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform Student handoff data is unavailable.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;
const MAX_ELIGIBLE_ADMISSIONS_OWNERS = 100;
const MAX_HANDOFF_PROVENANCE_ITEMS = 50;
const MAX_HANDOFF_CONVERSATION_ITEMS = 50;
const MAX_HANDOFF_STARTER_TASKS = 20;
const HANDOFF_STARTER_TASK_SOURCE_KEYS = [
  "u6.sales-context-review",
  "u6.study-route-confirmation",
  "u6.document-request-plan",
] as const;

export const PLATFORM_STUDENT_HANDOFF_MODES = [
  "normal",
  "exceptional_override",
] as const;
export type PlatformStudentHandoffMode =
  (typeof PLATFORM_STUDENT_HANDOFF_MODES)[number];

export const PLATFORM_ADMISSIONS_GATE_STATES = [
  "blocked",
  "satisfied",
  "overridden",
] as const;
export type PlatformAdmissionsGateState =
  (typeof PLATFORM_ADMISSIONS_GATE_STATES)[number];

export const PLATFORM_STUDENT_CASE_STATES = [
  "pending",
  "active",
  "closed",
] as const;
export type PlatformStudentCaseState =
  (typeof PLATFORM_STUDENT_CASE_STATES)[number];

export type PlatformEligibleAdmissionsOwner = Readonly<{
  membershipId: string;
  displayName: string;
}>;

export type PlatformLeadAdmissionsGateSnapshot = Readonly<{
  organizationId: string;
  leadId: string;
  contractConfirmed: boolean;
  contractConfirmedByMembershipId: string | null;
  contractConfirmedAt: string | null;
  contractEvidenceReference: string | null;
  firstPaymentAmount: number | null;
  firstPaymentCurrency: string | null;
  firstPaymentDueDate: string | null;
  firstPaymentReceivedDate: string | null;
  firstPaymentConfirmedByMembershipId: string | null;
  firstPaymentConfirmedAt: string | null;
  firstPaymentEvidenceReference: string | null;
  overrideReason: string | null;
  overriddenByMembershipId: string | null;
  overriddenAt: string | null;
  gateState: PlatformAdmissionsGateState;
  normalHandoffAllowed: boolean;
  exceptionalHandoffAllowed: boolean;
  canConfirmContract: boolean;
  canConfirmFirstPayment: boolean;
  canOverrideGate: boolean;
  gateVersion: string;
  updatedAt: string;
}>;

export type PlatformLeadAdmissionsGateAction =
  | "confirm_contract"
  | "confirm_first_payment"
  | "override_gate";

export type PlatformLeadAdmissionsGateMutationInput = Readonly<{
  leadId: string;
  expectedGateVersion: string;
  requestId: string;
  action: PlatformLeadAdmissionsGateAction;
  amount: number | null;
  currency: string | null;
  dueDate: string | null;
  receivedDate: string | null;
  evidenceReference: string | null;
  reason: string | null;
}>;

export type PlatformLeadAdmissionsGateMutationReceipt =
  PlatformLeadAdmissionsGateSnapshot &
  Readonly<{
    requestId: string;
    changedAt: string;
  }>;

export type PlatformLeadAdmissionsHandoffSnapshot = Readonly<{
  organizationId: string;
  leadId: string;
  gateVersion: string;
  gateState: PlatformAdmissionsGateState;
  normalHandoffAllowed: boolean;
  exceptionalHandoffAllowed: boolean;
  canSubmitNormal: boolean;
  canSubmitExceptional: boolean;
  caseId: string | null;
  caseState: PlatformStudentCaseState | null;
  admissionsOwnerMembershipId: string | null;
  admissionsOwnerDisplayName: string | null;
  handoffMode: PlatformStudentHandoffMode | null;
  handoffReason: string | null;
  handedOffAt: string | null;
  starterTaskCount: number;
  eligibleAdmissionsOwners: readonly PlatformEligibleAdmissionsOwner[];
}>;

export type PlatformLeadAdmissionsHandoffInput = Readonly<{
  leadId: string;
  expectedGateVersion: string;
  admissionsOwnerMembershipId: string;
  handoffMode: PlatformStudentHandoffMode;
  reason: string;
  requestId: string;
}>;

export type PlatformLeadAdmissionsHandoffReceipt =
  PlatformLeadAdmissionsHandoffSnapshot &
  Readonly<{
    requestId: string;
    changedAt: string;
  }>;

export type PlatformStudentHandoffSalesContext = Readonly<{
  leadId: string;
  stageKey: PlatformSalesStage;
  sourceKey: string;
  currentOwnerMembershipId: string;
  nextActionText: string | null;
  nextActionDueDate: string | null;
  workflowVersion: string;
}>;

export type PlatformStudentHandoffClientContext = Readonly<{
  clientId: string;
  displayName: string;
}>;

export type PlatformStudentHandoffProvenance = Readonly<{
  provenanceId: string;
  subjectType: "lead" | "client";
  sourceSystem: string;
  evidenceType: string;
  observedAt: string;
  importedAt: string | null;
  sourceRef: string | null;
}>;

export type PlatformStudentHandoffConversation = Readonly<{
  conversationId: string;
  subject: string;
  queue: "sales" | "curator";
  status: "open" | "closed";
  updatedAt: string;
}>;

export type PlatformStudentHandoffStarterTask = Readonly<{
  taskId: string;
  sourceKey: string;
  title: string;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  status: "open" | "in_progress" | "blocked" | "done" | "cancelled";
}>;

export type PlatformStudentCaseHandoffContext = Readonly<{
  organizationId: string;
  leadId: string;
  studentCaseId: string;
  caseState: PlatformStudentCaseState;
  handoffMode: PlatformStudentHandoffMode;
  handoffState: "completed";
  handoffReason: string;
  handoffSource: "canonical_sales";
  handedOffAt: string;
  actorMembershipId: string;
  actorDisplayName: string;
  admissionsOwnerMembershipId: string;
  admissionsOwnerDisplayName: string;
  gateVersion: string;
  gateState: PlatformAdmissionsGateState;
  workflowVersion: string;
  salesContext: PlatformStudentHandoffSalesContext;
  clientContext: PlatformStudentHandoffClientContext;
  provenance: readonly PlatformStudentHandoffProvenance[];
  conversationLinks: readonly PlatformStudentHandoffConversation[];
  starterTasks: readonly PlatformStudentHandoffStarterTask[];
}>;

export type PlatformStudentHandoffErrorReason =
  | "invalid"
  | "forbidden"
  | "gate_blocked"
  | "stale"
  | "request_conflict"
  | "unavailable";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformStudentHandoffRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformStudentHandoffDependencies = Readonly<{
  client?: PlatformStudentHandoffRpcClient;
}>;

export class PlatformStudentHandoffRepositoryError extends Error {
  readonly reason: PlatformStudentHandoffErrorReason;

  constructor(reason: PlatformStudentHandoffErrorReason = "unavailable") {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformStudentHandoffRepositoryError";
    this.reason = reason;
  }
}

const GATE_ROW_KEYS = [
  "organization_id",
  "lead_id",
  "contract_confirmed",
  "contract_confirmed_by_membership_id",
  "contract_confirmed_at",
  "contract_evidence_reference",
  "first_payment_amount",
  "first_payment_currency",
  "first_payment_due_date",
  "first_payment_received_date",
  "first_payment_confirmed_by_membership_id",
  "first_payment_confirmed_at",
  "first_payment_evidence_reference",
  "override_reason",
  "overridden_by_membership_id",
  "overridden_at",
  "gate_state",
  "normal_handoff_allowed",
  "exceptional_handoff_allowed",
  "can_confirm_contract",
  "can_confirm_first_payment",
  "can_override_gate",
  "gate_version",
  "updated_at",
] as const;

const HANDOFF_ROW_KEYS = [
  "organization_id",
  "lead_id",
  "gate_version",
  "gate_state",
  "normal_handoff_allowed",
  "exceptional_handoff_allowed",
  "can_submit_normal",
  "can_submit_exceptional",
  "case_id",
  "case_state",
  "admissions_owner_membership_id",
  "admissions_owner_display_name",
  "handoff_mode",
  "handoff_reason",
  "handed_off_at",
  "starter_task_count",
  "eligible_admissions_owners",
] as const;

const STUDENT_CONTEXT_ROW_KEYS = [
  "organization_id",
  "lead_id",
  "student_case_id",
  "case_state",
  "handoff_mode",
  "handoff_state",
  "handoff_reason",
  "handoff_source",
  "handed_off_at",
  "actor_membership_id",
  "actor_display_name",
  "admissions_owner_membership_id",
  "admissions_owner_display_name",
  "gate_version",
  "gate_state",
  "workflow_version",
  "sales_context",
  "client_context",
  "provenance",
  "conversation_links",
  "starter_tasks",
] as const;

const GATE_MUTATION_INPUT_KEYS = [
  "leadId",
  "expectedGateVersion",
  "requestId",
  "action",
  "amount",
  "currency",
  "dueDate",
  "receivedDate",
  "evidenceReference",
  "reason",
] as const;

const HANDOFF_MUTATION_INPUT_KEYS = [
  "leadId",
  "expectedGateVersion",
  "admissionsOwnerMembershipId",
  "handoffMode",
  "reason",
  "requestId",
] as const;

function failure(reason: PlatformStudentHandoffErrorReason): never {
  throw new PlatformStudentHandoffRepositoryError(reason);
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformStudentHandoffRepositoryError) throw error;
  return failure("unavailable");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function requireExactRecord(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, expected)) {
    return failure("unavailable");
  }
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
): Values[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return failure("unavailable");
  }
  return value as Values[number];
}

function exactInput(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, expected)) {
    return failure("invalid");
  }
  return value;
}

export function parsePlatformStudentHandoffUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformStudentHandoffUuid(value) ?? failure("unavailable");
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function inputUuid(value: unknown): string {
  return parsePlatformStudentHandoffUuid(value) ?? failure("invalid");
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : failure("unavailable");
}

function requiredText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return failure("unavailable");
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return failure("unavailable");
  }
  return normalized;
}

function optionalText(value: unknown, maximumLength: number): string | null {
  return value === null ? null : requiredText(value, maximumLength);
}

function inputText(value: unknown, maximumLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return failure("invalid");
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return failure("invalid");
  }
  return normalized;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function optionalDate(value: unknown): string | null {
  return value === null ? null : parseDate(value) ?? failure("unavailable");
}

function inputDate(value: unknown): string | null {
  if (value === null) return null;
  return parseDate(value) ?? failure("invalid");
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return failure("unavailable");
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function postgresBigint(value: unknown, allowZero = false): string {
  const raw = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value
      : "";
  if (!/^\d+$/.test(raw)) return failure("unavailable");
  const normalized = raw.replace(/^0+(?=\d)/, "");
  if ((!allowZero && normalized === "0") || normalized.length > 19) {
    return failure("unavailable");
  }
  if (
    normalized.length === POSTGRES_BIGINT_MAX.length &&
    normalized > POSTGRES_BIGINT_MAX
  ) {
    return failure("unavailable");
  }
  return normalized;
}

function inputBigint(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return failure("invalid");
  }
  if (
    value.length > POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value > POSTGRES_BIGINT_MAX)
  ) {
    return failure("invalid");
  }
  return value;
}

function nonNegativeCount(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    return failure("unavailable");
  }
  return parsed;
}

function moneyAmount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    return failure("unavailable");
  }
  const raw = String(value);
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw)) {
    return failure("unavailable");
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999999999999.99) {
    return failure("unavailable");
  }
  return parsed;
}

function optionalCurrency(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    return failure("unavailable");
  }
  return value;
}

function inputMoneyAmount(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(value)) ||
    value <= 0 ||
    value > 999999999999.99
  ) {
    return failure("invalid");
  }
  return value;
}

function requestUuid(value: unknown): string {
  const parsed = inputUuid(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed)) {
    return failure("invalid");
  }
  return parsed;
}

function requireActor(
  actor: PlatformActor,
  roles: readonly ("admin" | "sales" | "admissions")[],
): string {
  const organizationId = inputUuid(actor.organizationId);
  inputUuid(actor.membershipId);
  inputUuid(actor.profileId);
  inputUuid(actor.authUserId);
  if (!roles.includes(actor.authorityRole)) return failure("forbidden");
  return organizationId;
}

function gateState(value: unknown): PlatformAdmissionsGateState {
  return oneOf(value, PLATFORM_ADMISSIONS_GATE_STATES);
}

function handoffMode(value: unknown): PlatformStudentHandoffMode {
  return oneOf(value, PLATFORM_STUDENT_HANDOFF_MODES);
}

function caseState(value: unknown): PlatformStudentCaseState {
  return oneOf(value, PLATFORM_STUDENT_CASE_STATES);
}

function normalizeEligibleOwners(
  value: unknown,
): readonly PlatformEligibleAdmissionsOwner[] {
  if (!Array.isArray(value) || value.length > MAX_ELIGIBLE_ADMISSIONS_OWNERS) {
    return failure("unavailable");
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((item) => {
    const row = requireExactRecord(item, ["membership_id", "display_name"]);
    const membershipId = requiredUuid(row.membership_id);
    if (seen.has(membershipId)) return failure("unavailable");
    seen.add(membershipId);
    return Object.freeze({
      membershipId,
      displayName: requiredText(row.display_name, 200),
    });
  }));
}

function normalizeGateSnapshotRecord(
  row: Record<string, unknown>,
  organizationId: string,
  leadId: string,
): PlatformLeadAdmissionsGateSnapshot {
  if (
    requiredUuid(row.organization_id) !== organizationId ||
    requiredUuid(row.lead_id) !== leadId
  ) {
    return failure("unavailable");
  }
  const contractConfirmed = requiredBoolean(row.contract_confirmed);
  const contractConfirmedByMembershipId = optionalUuid(
    row.contract_confirmed_by_membership_id,
  );
  const contractConfirmedAt = optionalTimestamp(row.contract_confirmed_at);
  const contractEvidenceReference = optionalText(
    row.contract_evidence_reference,
    2048,
  );
  const firstPaymentAmount = moneyAmount(row.first_payment_amount);
  const firstPaymentCurrency = optionalCurrency(row.first_payment_currency);
  const firstPaymentDueDate = optionalDate(row.first_payment_due_date);
  const firstPaymentReceivedDate = optionalDate(
    row.first_payment_received_date,
  );
  const firstPaymentConfirmedByMembershipId = optionalUuid(
    row.first_payment_confirmed_by_membership_id,
  );
  const firstPaymentConfirmedAt = optionalTimestamp(
    row.first_payment_confirmed_at,
  );
  const firstPaymentEvidenceReference = optionalText(
    row.first_payment_evidence_reference,
    2048,
  );
  const overrideReason = optionalText(row.override_reason, 1000);
  const overriddenByMembershipId = optionalUuid(
    row.overridden_by_membership_id,
  );
  const overriddenAt = optionalTimestamp(row.overridden_at);
  const normalizedGateState = gateState(row.gate_state);
  const normalHandoffAllowed = requiredBoolean(row.normal_handoff_allowed);
  const exceptionalHandoffAllowed = requiredBoolean(
    row.exceptional_handoff_allowed,
  );

  const contractFactComplete = contractConfirmed
    ? contractConfirmedByMembershipId !== null &&
      contractConfirmedAt !== null &&
      contractEvidenceReference !== null
    : contractConfirmedByMembershipId === null &&
      contractConfirmedAt === null &&
      contractEvidenceReference === null;
  const expectationComplete = firstPaymentAmount === null
    ? firstPaymentCurrency === null && firstPaymentDueDate === null
    : contractConfirmed &&
      firstPaymentCurrency !== null &&
      firstPaymentDueDate !== null;
  const paymentFactComplete = firstPaymentReceivedDate === null
    ? firstPaymentConfirmedByMembershipId === null &&
      firstPaymentConfirmedAt === null &&
      firstPaymentEvidenceReference === null
    : contractConfirmed &&
      firstPaymentAmount !== null &&
      firstPaymentCurrency !== null &&
      firstPaymentDueDate !== null &&
      firstPaymentConfirmedByMembershipId !== null &&
      firstPaymentConfirmedAt !== null &&
      firstPaymentEvidenceReference !== null;
  const overrideFactComplete = overrideReason === null
    ? overriddenByMembershipId === null && overriddenAt === null
    : overriddenByMembershipId !== null && overriddenAt !== null;
  const validState =
    (normalizedGateState === "satisfied" &&
      contractConfirmed && firstPaymentConfirmedAt !== null) ||
    (normalizedGateState === "overridden" &&
      overriddenAt !== null && firstPaymentConfirmedAt === null) ||
    (normalizedGateState === "blocked" &&
      overriddenAt === null && firstPaymentConfirmedAt === null);
  if (
    !contractFactComplete ||
    !expectationComplete ||
    !paymentFactComplete ||
    !overrideFactComplete ||
    !validState ||
    normalHandoffAllowed !== (normalizedGateState === "satisfied") ||
    exceptionalHandoffAllowed !== (normalizedGateState === "overridden")
  ) {
    return failure("unavailable");
  }

  return Object.freeze({
    organizationId,
    leadId,
    contractConfirmed,
    contractConfirmedByMembershipId,
    contractConfirmedAt,
    contractEvidenceReference,
    firstPaymentAmount,
    firstPaymentCurrency,
    firstPaymentDueDate,
    firstPaymentReceivedDate,
    firstPaymentConfirmedByMembershipId,
    firstPaymentConfirmedAt,
    firstPaymentEvidenceReference,
    overrideReason,
    overriddenByMembershipId,
    overriddenAt,
    gateState: normalizedGateState,
    normalHandoffAllowed,
    exceptionalHandoffAllowed,
    canConfirmContract: requiredBoolean(row.can_confirm_contract),
    canConfirmFirstPayment: requiredBoolean(row.can_confirm_first_payment),
    canOverrideGate: requiredBoolean(row.can_override_gate),
    gateVersion: postgresBigint(row.gate_version),
    updatedAt: requiredTimestamp(row.updated_at),
  });
}

export function normalizePlatformLeadAdmissionsGateSnapshot(
  value: unknown,
  expectedOrganizationId: string,
  expectedLeadId: string,
): PlatformLeadAdmissionsGateSnapshot {
  const organizationId = inputUuid(expectedOrganizationId);
  const leadId = inputUuid(expectedLeadId);
  return normalizeGateSnapshotRecord(
    requireExactRecord(value, GATE_ROW_KEYS),
    organizationId,
    leadId,
  );
}

function normalizeHandoffSnapshotRecord(
  row: Record<string, unknown>,
  organizationId: string,
  leadId: string,
): PlatformLeadAdmissionsHandoffSnapshot {
  if (
    requiredUuid(row.organization_id) !== organizationId ||
    requiredUuid(row.lead_id) !== leadId
  ) {
    return failure("unavailable");
  }
  const normalizedGateState = gateState(row.gate_state);
  const normalHandoffAllowed = requiredBoolean(row.normal_handoff_allowed);
  const exceptionalHandoffAllowed = requiredBoolean(
    row.exceptional_handoff_allowed,
  );
  const caseId = optionalUuid(row.case_id);
  const normalizedCaseState = row.case_state === null
    ? null
    : caseState(row.case_state);
  const admissionsOwnerMembershipId = optionalUuid(
    row.admissions_owner_membership_id,
  );
  const admissionsOwnerDisplayName = optionalText(
    row.admissions_owner_display_name,
    200,
  );
  const normalizedHandoffMode = row.handoff_mode === null
    ? null
    : handoffMode(row.handoff_mode);
  const handoffReason = optionalText(row.handoff_reason, 1000);
  const handedOffAt = optionalTimestamp(row.handed_off_at);
  const starterTaskCount = nonNegativeCount(row.starter_task_count);
  const canSubmitNormal = requiredBoolean(row.can_submit_normal);
  const canSubmitExceptional = requiredBoolean(row.can_submit_exceptional);
  const handoffPresence = [
    normalizedCaseState,
    admissionsOwnerMembershipId,
    admissionsOwnerDisplayName,
    normalizedHandoffMode,
    handoffReason,
    handedOffAt,
  ];
  if (
    normalHandoffAllowed !== (normalizedGateState === "satisfied") ||
    exceptionalHandoffAllowed !== (normalizedGateState === "overridden") ||
    (caseId === null &&
      (handoffPresence.some((item) => item !== null) ||
        starterTaskCount !== 0)) ||
    (caseId !== null &&
      (handoffPresence.some((item) => item === null) ||
        canSubmitNormal ||
        canSubmitExceptional)) ||
    (canSubmitNormal && normalizedGateState !== "satisfied") ||
    (canSubmitExceptional && normalizedGateState !== "overridden")
  ) {
    return failure("unavailable");
  }

  return Object.freeze({
    organizationId,
    leadId,
    gateVersion: postgresBigint(row.gate_version),
    gateState: normalizedGateState,
    normalHandoffAllowed,
    exceptionalHandoffAllowed,
    canSubmitNormal,
    canSubmitExceptional,
    caseId,
    caseState: normalizedCaseState,
    admissionsOwnerMembershipId,
    admissionsOwnerDisplayName,
    handoffMode: normalizedHandoffMode,
    handoffReason,
    handedOffAt,
    starterTaskCount,
    eligibleAdmissionsOwners: normalizeEligibleOwners(
      row.eligible_admissions_owners,
    ),
  });
}

export function normalizePlatformLeadAdmissionsHandoffSnapshot(
  value: unknown,
  expectedOrganizationId: string,
  expectedLeadId: string,
): PlatformLeadAdmissionsHandoffSnapshot {
  const organizationId = inputUuid(expectedOrganizationId);
  const leadId = inputUuid(expectedLeadId);
  return normalizeHandoffSnapshotRecord(
    requireExactRecord(value, HANDOFF_ROW_KEYS),
    organizationId,
    leadId,
  );
}

function normalizeSalesContext(
  value: unknown,
  expectedLeadId: string,
  expectedWorkflowVersion: string,
): PlatformStudentHandoffSalesContext {
  const row = requireExactRecord(value, [
    "lead_id",
    "stage_key",
    "source_key",
    "current_owner_membership_id",
    "next_action_text",
    "next_action_due_date",
    "workflow_version",
  ]);
  const leadId = requiredUuid(row.lead_id);
  const workflowVersion = postgresBigint(row.workflow_version);
  if (
    leadId !== expectedLeadId ||
    workflowVersion !== expectedWorkflowVersion ||
    typeof row.source_key !== "string" ||
    !WORKFLOW_KEY_PATTERN.test(row.source_key)
  ) {
    return failure("unavailable");
  }
  const currentOwnerMembershipId = requiredUuid(
    row.current_owner_membership_id,
  );
  return Object.freeze({
    leadId,
    stageKey: oneOf(row.stage_key, PLATFORM_SALES_STAGES),
    sourceKey: row.source_key,
    currentOwnerMembershipId,
    nextActionText: optionalText(row.next_action_text, 500),
    nextActionDueDate: optionalDate(row.next_action_due_date),
    workflowVersion,
  });
}

function normalizeClientContext(
  value: unknown,
): PlatformStudentHandoffClientContext {
  const row = requireExactRecord(value, ["client_id", "display_name"]);
  return Object.freeze({
    clientId: requiredUuid(row.client_id),
    displayName: requiredText(row.display_name, 200),
  });
}

function normalizeBoundedArray<T>(
  value: unknown,
  maximum: number,
  normalizer: (item: unknown) => T,
  identity: (item: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return failure("unavailable");
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((raw) => {
    const item = normalizer(raw);
    const id = identity(item);
    if (seen.has(id)) return failure("unavailable");
    seen.add(id);
    return item;
  }));
}

function normalizeProvenanceItem(
  value: unknown,
): PlatformStudentHandoffProvenance {
  const row = requireExactRecord(value, [
    "provenance_id",
    "subject_type",
    "source_system",
    "evidence_type",
    "observed_at",
    "imported_at",
    "source_ref",
  ]);
  const sourceSystem = requiredText(row.source_system, 64);
  const evidenceType = requiredText(row.evidence_type, 64);
  if (
    !WORKFLOW_KEY_PATTERN.test(sourceSystem) ||
    !WORKFLOW_KEY_PATTERN.test(evidenceType)
  ) {
    return failure("unavailable");
  }
  return Object.freeze({
    provenanceId: requiredUuid(row.provenance_id),
    subjectType: oneOf(row.subject_type, ["lead", "client"] as const),
    sourceSystem,
    evidenceType,
    observedAt: requiredTimestamp(row.observed_at),
    importedAt: optionalTimestamp(row.imported_at),
    sourceRef: optionalText(row.source_ref, 1024),
  });
}

function normalizeConversationItem(
  value: unknown,
): PlatformStudentHandoffConversation {
  const row = requireExactRecord(value, [
    "conversation_id",
    "subject",
    "queue",
    "status",
    "updated_at",
  ]);
  return Object.freeze({
    conversationId: requiredUuid(row.conversation_id),
    subject: requiredText(row.subject, 500),
    queue: oneOf(row.queue, ["sales", "curator"] as const),
    status: oneOf(row.status, ["open", "closed"] as const),
    updatedAt: requiredTimestamp(row.updated_at),
  });
}

function normalizeStarterTaskItem(
  value: unknown,
): PlatformStudentHandoffStarterTask {
  const row = requireExactRecord(value, [
    "task_id",
    "source_key",
    "title",
    "assignee_membership_id",
    "assignee_display_name",
    "priority",
    "due_at",
    "status",
  ]);
  const sourceKey = requiredText(row.source_key, 128);
  if (!WORKFLOW_KEY_PATTERN.test(sourceKey) || !sourceKey.startsWith("u6.")) {
    return failure("unavailable");
  }
  return Object.freeze({
    taskId: requiredUuid(row.task_id),
    sourceKey,
    title: requiredText(row.title, 500),
    assigneeMembershipId: requiredUuid(row.assignee_membership_id),
    assigneeDisplayName: requiredText(row.assignee_display_name, 200),
    priority: oneOf(
      row.priority,
      ["low", "normal", "high", "urgent"] as const,
    ),
    dueAt: optionalTimestamp(row.due_at),
    status: oneOf(
      row.status,
      ["open", "in_progress", "blocked", "done", "cancelled"] as const,
    ),
  });
}

export function normalizePlatformStudentCaseHandoffContext(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
): PlatformStudentCaseHandoffContext {
  const organizationId = inputUuid(expectedOrganizationId);
  const studentCaseId = inputUuid(expectedStudentCaseId);
  const row = requireExactRecord(value, STUDENT_CONTEXT_ROW_KEYS);
  if (
    requiredUuid(row.organization_id) !== organizationId ||
    requiredUuid(row.student_case_id) !== studentCaseId
  ) {
    return failure("unavailable");
  }
  const leadId = requiredUuid(row.lead_id);
  const workflowVersion = postgresBigint(row.workflow_version);
  const normalizedCaseState = caseState(row.case_state);
  const normalizedHandoffMode = handoffMode(row.handoff_mode);
  const normalizedGateState = gateState(row.gate_state);
  if (normalizedCaseState === "pending") return failure("unavailable");
  if (
    (normalizedHandoffMode === "normal" &&
      normalizedGateState !== "satisfied") ||
    (normalizedHandoffMode === "exceptional_override" &&
      normalizedGateState !== "overridden")
  ) {
    return failure("unavailable");
  }
  const admissionsOwnerMembershipId = requiredUuid(
    row.admissions_owner_membership_id,
  );
  const salesContext = normalizeSalesContext(
    row.sales_context,
    leadId,
    workflowVersion,
  );
  if (salesContext.stageKey !== "qualified") return failure("unavailable");
  const starterTasks = normalizeBoundedArray(
    row.starter_tasks,
    MAX_HANDOFF_STARTER_TASKS,
    normalizeStarterTaskItem,
    (item) => item.taskId,
  );
  if (
    starterTasks.length !== 3 ||
    HANDOFF_STARTER_TASK_SOURCE_KEYS.some(
      (sourceKey) => !starterTasks.some((task) => task.sourceKey === sourceKey),
    )
  ) {
    return failure("unavailable");
  }
  return Object.freeze({
    organizationId,
    leadId,
    studentCaseId,
    caseState: normalizedCaseState,
    handoffMode: normalizedHandoffMode,
    handoffState: oneOf(row.handoff_state, ["completed"] as const),
    handoffReason: requiredText(row.handoff_reason, 1000),
    handoffSource: oneOf(row.handoff_source, ["canonical_sales"] as const),
    handedOffAt: requiredTimestamp(row.handed_off_at),
    actorMembershipId: requiredUuid(row.actor_membership_id),
    actorDisplayName: requiredText(row.actor_display_name, 200),
    admissionsOwnerMembershipId,
    admissionsOwnerDisplayName: requiredText(
      row.admissions_owner_display_name,
      200,
    ),
    gateVersion: postgresBigint(row.gate_version),
    gateState: normalizedGateState,
    workflowVersion,
    salesContext,
    clientContext: normalizeClientContext(row.client_context),
    provenance: normalizeBoundedArray(
      row.provenance,
      MAX_HANDOFF_PROVENANCE_ITEMS,
      normalizeProvenanceItem,
      (item) => item.provenanceId,
    ),
    conversationLinks: normalizeBoundedArray(
      row.conversation_links,
      MAX_HANDOFF_CONVERSATION_ITEMS,
      normalizeConversationItem,
      (item) => item.conversationId,
    ),
    starterTasks,
  });
}

function normalizeGateMutationInput(
  value: PlatformLeadAdmissionsGateMutationInput,
): PlatformLeadAdmissionsGateMutationInput {
  const row = exactInput(value, GATE_MUTATION_INPUT_KEYS);
  const action = oneOfInput(row.action, [
    "confirm_contract",
    "confirm_first_payment",
    "override_gate",
  ] as const);
  const amount = inputMoneyAmount(row.amount);
  const currency = row.currency === null
    ? null
    : typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)
      ? row.currency
      : failure("invalid");
  const dueDate = inputDate(row.dueDate);
  const receivedDate = inputDate(row.receivedDate);
  const evidenceReference = inputText(row.evidenceReference, 2048);
  const reason = inputText(row.reason, 1000);
  if (
    (action === "confirm_contract" &&
      (amount === null ||
        currency === null ||
        dueDate === null ||
        receivedDate !== null ||
        evidenceReference === null)) ||
    (action === "confirm_first_payment" &&
      (amount !== null ||
        currency !== null ||
        dueDate !== null ||
        receivedDate === null ||
        evidenceReference === null)) ||
    (action === "override_gate" &&
      (amount !== null ||
        currency !== null ||
        dueDate !== null ||
        receivedDate !== null ||
        evidenceReference !== null ||
        reason === null))
  ) {
    return failure("invalid");
  }
  return Object.freeze({
    leadId: inputUuid(row.leadId),
    expectedGateVersion: inputBigint(row.expectedGateVersion),
    requestId: requestUuid(row.requestId),
    action,
    amount,
    currency,
    dueDate,
    receivedDate,
    evidenceReference,
    reason,
  });
}

function oneOfInput<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
): Values[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return failure("invalid");
  }
  return value as Values[number];
}

function normalizeHandoffMutationInput(
  value: PlatformLeadAdmissionsHandoffInput,
): PlatformLeadAdmissionsHandoffInput {
  const row = exactInput(value, HANDOFF_MUTATION_INPUT_KEYS);
  const reason = inputText(row.reason, 1000);
  if (reason === null) return failure("invalid");
  return Object.freeze({
    leadId: inputUuid(row.leadId),
    expectedGateVersion: inputBigint(row.expectedGateVersion),
    admissionsOwnerMembershipId: inputUuid(row.admissionsOwnerMembershipId),
    handoffMode: oneOfInput(row.handoffMode, PLATFORM_STUDENT_HANDOFF_MODES),
    reason,
    requestId: requestUuid(row.requestId),
  });
}

function rpcErrorReason(error: unknown): PlatformStudentHandoffErrorReason {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string"
    ? error.message.toLowerCase()
    : "";
  if (code === "22023") return "invalid";
  if (code === "42501") return "forbidden";
  if (code === "23505") return "request_conflict";
  if (code === "PT409") {
    if (
      /gate_(?:incomplete|handoff_blocked)|contract_required/.test(message)
    ) {
      return "gate_blocked";
    }
    return "stale";
  }
  return "unavailable";
}

async function getPlatformClient(): Promise<PlatformStudentHandoffRpcClient> {
  if (typeof window !== "undefined") return failure("unavailable");
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as PlatformStudentHandoffRpcClient;
}

function oneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return failure("unavailable");
  }
  return data[0];
}

export async function getPlatformLeadAdmissionsGate(
  actor: PlatformActor,
  leadId: string,
  dependencies: PlatformStudentHandoffDependencies = {},
): Promise<PlatformLeadAdmissionsGateSnapshot> {
  try {
    const organizationId = requireActor(actor, ["admin", "sales"]);
    const normalizedLeadId = inputUuid(leadId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_lead_admissions_gate",
      { p_lead_id: normalizedLeadId },
      { get: true },
    );
    if (response.error) return failure(rpcErrorReason(response.error));
    return normalizeGateSnapshotRecord(
      requireExactRecord(oneRow(response.data), GATE_ROW_KEYS),
      organizationId,
      normalizedLeadId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function mutatePlatformLeadAdmissionsGate(
  actor: PlatformActor,
  input: PlatformLeadAdmissionsGateMutationInput,
  dependencies: PlatformStudentHandoffDependencies = {},
): Promise<PlatformLeadAdmissionsGateMutationReceipt> {
  try {
    const organizationId = requireActor(actor, ["admin", "sales"]);
    const normalizedInput = normalizeGateMutationInput(input);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "mutate_lead_admissions_gate",
      {
        p_lead_id: normalizedInput.leadId,
        p_expected_gate_version: normalizedInput.expectedGateVersion,
        p_request_id: normalizedInput.requestId,
        p_action: normalizedInput.action,
        p_amount: normalizedInput.amount,
        p_currency: normalizedInput.currency,
        p_due_date: normalizedInput.dueDate,
        p_received_date: normalizedInput.receivedDate,
        p_evidence_reference: normalizedInput.evidenceReference,
        p_reason: normalizedInput.reason,
      },
    );
    if (response.error) return failure(rpcErrorReason(response.error));
    const row = requireExactRecord(response.data, [
      "request_id",
      ...GATE_ROW_KEYS,
      "changed_at",
    ]);
    if (requiredUuid(row.request_id) !== normalizedInput.requestId) {
      return failure("unavailable");
    }
    const snapshot = normalizeGateSnapshotRecord(
        requireExactRecord(
          Object.fromEntries(GATE_ROW_KEYS.map((key) => [key, row[key]])),
          GATE_ROW_KEYS,
        ),
        organizationId,
        normalizedInput.leadId,
      );
    const changedAt = requiredTimestamp(row.changed_at);
    if (snapshot.updatedAt !== changedAt) return failure("unavailable");
    return Object.freeze({
      ...snapshot,
      requestId: normalizedInput.requestId,
      changedAt,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformLeadAdmissionsHandoff(
  actor: PlatformActor,
  leadId: string,
  dependencies: PlatformStudentHandoffDependencies = {},
): Promise<PlatformLeadAdmissionsHandoffSnapshot> {
  try {
    const organizationId = requireActor(actor, ["admin", "sales"]);
    const normalizedLeadId = inputUuid(leadId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_lead_admissions_handoff",
      { p_lead_id: normalizedLeadId },
      { get: true },
    );
    if (response.error) return failure(rpcErrorReason(response.error));
    return normalizeHandoffSnapshotRecord(
      requireExactRecord(oneRow(response.data), HANDOFF_ROW_KEYS),
      organizationId,
      normalizedLeadId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function handoffPlatformLeadToAdmissions(
  actor: PlatformActor,
  input: PlatformLeadAdmissionsHandoffInput,
  dependencies: PlatformStudentHandoffDependencies = {},
): Promise<PlatformLeadAdmissionsHandoffReceipt> {
  try {
    const organizationId = requireActor(actor, ["admin", "sales"]);
    const normalizedInput = normalizeHandoffMutationInput(input);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "handoff_lead_to_admissions",
      {
        p_lead_id: normalizedInput.leadId,
        p_expected_gate_version: normalizedInput.expectedGateVersion,
        p_admissions_owner_membership_id:
          normalizedInput.admissionsOwnerMembershipId,
        p_handoff_mode: normalizedInput.handoffMode,
        p_reason: normalizedInput.reason,
        p_request_id: normalizedInput.requestId,
      },
    );
    if (response.error) return failure(rpcErrorReason(response.error));
    const row = requireExactRecord(response.data, [
      ...HANDOFF_ROW_KEYS,
      "request_id",
      "changed_at",
    ]);
    if (requiredUuid(row.request_id) !== normalizedInput.requestId) {
      return failure("unavailable");
    }
    const snapshot = normalizeHandoffSnapshotRecord(
        requireExactRecord(
          Object.fromEntries(HANDOFF_ROW_KEYS.map((key) => [key, row[key]])),
          HANDOFF_ROW_KEYS,
        ),
        organizationId,
        normalizedInput.leadId,
      );
    const changedAt = requiredTimestamp(row.changed_at);
    if (
      snapshot.caseId === null ||
      snapshot.caseState !== "active" ||
      snapshot.admissionsOwnerMembershipId !==
        normalizedInput.admissionsOwnerMembershipId ||
      snapshot.handoffMode !== normalizedInput.handoffMode ||
      snapshot.handoffReason !== normalizedInput.reason ||
      snapshot.handedOffAt !== changedAt ||
      snapshot.gateVersion !== normalizedInput.expectedGateVersion
    ) {
      return failure("unavailable");
    }
    return Object.freeze({
      ...snapshot,
      requestId: normalizedInput.requestId,
      changedAt,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformStudentCaseHandoffContext(
  actor: PlatformActor,
  studentCaseId: string,
  dependencies: PlatformStudentHandoffDependencies = {},
): Promise<PlatformStudentCaseHandoffContext> {
  try {
    const organizationId = requireActor(actor, ["admin", "admissions"]);
    const normalizedStudentCaseId = inputUuid(studentCaseId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_student_case_handoff_context",
      { p_student_case_id: normalizedStudentCaseId },
      { get: true },
    );
    if (response.error) return failure(rpcErrorReason(response.error));
    return normalizePlatformStudentCaseHandoffContext(
      requireExactRecord(oneRow(response.data), STUDENT_CONTEXT_ROW_KEYS),
      organizationId,
      normalizedStudentCaseId,
    );
  } catch (error) {
    return failClosed(error);
  }
}
