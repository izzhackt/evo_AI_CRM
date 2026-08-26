import type { PlatformActor } from "./platform-auth";

const SAFE_CONTRACT_ERROR_MESSAGE =
  "Platform pilot cohort data is unavailable.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

export const PLATFORM_PILOT_CONFIGURATION_STATES = ["active", "paused"] as const;
export const PLATFORM_PILOT_MEMBERSHIP_STATUSES = [
  "outside",
  "included",
  "excluded",
] as const;
export const PLATFORM_PILOT_MEMBERSHIP_BASES = [
  "cutoff_rule",
  "manual_include",
  "manual_exclude",
] as const;
export const PLATFORM_PILOT_MEMBERSHIP_ACTIONS = ["include", "exclude"] as const;
export const PLATFORM_PILOT_HISTORY_ACTIONS = [
  "automatic_include",
  "manual_include",
  "manual_exclude",
] as const;
export const PLATFORM_PILOT_WRITE_TARGETS = [
  "evo_supabase",
  "legacy_crm",
] as const;
export const PLATFORM_PILOT_WRITE_REASON_CODES = [
  "canonical_write_allowed",
  "pilot_membership_required",
  "pilot_membership_excluded",
  "legacy_write_forbidden",
] as const;

export const PLATFORM_PILOT_CONFIGURE_RPC = "configure_pilot_cohort";
export const PLATFORM_PILOT_MEMBERSHIP_RPC =
  "set_student_case_pilot_membership";
export const PLATFORM_PILOT_STAFF_READ_RPC =
  "staff_student_case_pilot_cohort";
export const PLATFORM_PILOT_WRITE_BOUNDARY_RPC =
  "staff_pilot_write_boundary";

export type PlatformPilotConfigurationState =
  (typeof PLATFORM_PILOT_CONFIGURATION_STATES)[number];
export type PlatformPilotMembershipStatus =
  (typeof PLATFORM_PILOT_MEMBERSHIP_STATUSES)[number];
export type PlatformPilotMembershipBasis =
  (typeof PLATFORM_PILOT_MEMBERSHIP_BASES)[number];
export type PlatformPilotMembershipAction =
  (typeof PLATFORM_PILOT_MEMBERSHIP_ACTIONS)[number];
export type PlatformPilotHistoryAction =
  (typeof PLATFORM_PILOT_HISTORY_ACTIONS)[number];
export type PlatformPilotWriteTarget =
  (typeof PLATFORM_PILOT_WRITE_TARGETS)[number];
export type PlatformPilotWriteReasonCode =
  (typeof PLATFORM_PILOT_WRITE_REASON_CODES)[number];
export type PlatformPilotProvenanceScalar = string | number | boolean | null;
export type PlatformPilotProvenance = Readonly<
  Record<string, PlatformPilotProvenanceScalar>
>;

export type PlatformPilotConfiguration = Readonly<{
  configurationId: string;
  version: number;
  state: PlatformPilotConfigurationState;
  cutoffAt: string;
  reason: string;
  provenance: PlatformPilotProvenance;
  changedByMembershipId: string;
  changedByName: string;
  changedAt: string;
}>;

export type PlatformPilotCounts = Readonly<{
  outside: number;
  included: number;
  excluded: number;
  total: number;
}>;

export type PlatformPilotMembershipHistoryEntry = Readonly<{
  eventId: string;
  action: PlatformPilotHistoryAction;
  basis: PlatformPilotMembershipBasis;
  reason: string;
  provenance: PlatformPilotProvenance;
  changedByMembershipId: string;
  changedByName: string;
  changedAt: string;
}>;

export type PlatformPilotWriteBoundary = Readonly<{
  requestedTarget: PlatformPilotWriteTarget;
  allowed: boolean;
  reasonCode: PlatformPilotWriteReasonCode;
  authority: "evo_supabase_only";
  fallbackAllowed: false;
}>;

export type PlatformStudentCasePilotCohort = Readonly<{
  organizationId: string;
  studentCaseId: string;
  membershipStatus: PlatformPilotMembershipStatus;
  membershipBasis: PlatformPilotMembershipBasis | null;
  reason: string | null;
  provenance: PlatformPilotProvenance | null;
  changedByMembershipId: string | null;
  changedByName: string | null;
  changedAt: string | null;
  configuration: PlatformPilotConfiguration | null;
  counts: PlatformPilotCounts;
  history: readonly PlatformPilotMembershipHistoryEntry[];
  writeBoundary: PlatformPilotWriteBoundary;
}>;

export type PlatformPilotConfigurationReceipt = PlatformPilotConfiguration &
  Readonly<{ organizationId: string; requestId: string; replayed: boolean }>;

export type PlatformPilotMembershipReceipt = Readonly<{
  organizationId: string;
  requestId: string;
  studentCaseId: string;
  eventId: string;
  membershipStatus: "included" | "excluded";
  membershipBasis: "manual_include" | "manual_exclude";
  reason: string;
  provenance: PlatformPilotProvenance;
  changedByMembershipId: string;
  changedByName: string;
  changedAt: string;
  replayed: boolean;
}>;

export type PlatformPilotConfigureInput = Readonly<{
  studentCaseId: string;
  cutoffAt: string;
  state: PlatformPilotConfigurationState;
  reason: string;
  requestId: string;
}>;

export type PlatformPilotMembershipInput = Readonly<{
  studentCaseId: string;
  action: PlatformPilotMembershipAction;
  reason: string;
  provenance: PlatformPilotProvenance;
  requestId: string;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformPilotCohortRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      name: string,
      args: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ): PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformPilotCohortDependencies = Readonly<{
  client?: PlatformPilotCohortRpcClient;
}>;

const COHORT_ROW_KEYS = [
  "organization_id",
  "student_case_id",
  "membership_status",
  "membership_basis",
  "reason",
  "provenance",
  "changed_by_membership_id",
  "changed_by_name",
  "changed_at",
  "configuration",
  "counts",
  "history",
  "write_boundary",
] as const;
const CONFIGURATION_KEYS = [
  "configuration_id",
  "version",
  "state",
  "cutoff_at",
  "reason",
  "provenance",
  "changed_by_membership_id",
  "changed_by_name",
  "changed_at",
] as const;
const COUNTS_KEYS = ["outside", "included", "excluded", "total"] as const;
const HISTORY_KEYS = [
  "event_id",
  "action",
  "basis",
  "reason",
  "provenance",
  "changed_by_membership_id",
  "changed_by_name",
  "changed_at",
] as const;
const WRITE_BOUNDARY_KEYS = [
  "requested_target",
  "allowed",
  "reason_code",
  "authority",
  "fallback_allowed",
] as const;
const CONFIGURATION_RECEIPT_KEYS = [
  "organization_id",
  "request_id",
  ...CONFIGURATION_KEYS,
  "replayed",
] as const;
const MEMBERSHIP_RECEIPT_KEYS = [
  "organization_id",
  "request_id",
  "student_case_id",
  "event_id",
  "membership_status",
  "membership_basis",
  "reason",
  "provenance",
  "changed_by_membership_id",
  "changed_by_name",
  "changed_at",
  "replayed",
] as const;

export class PlatformPilotCohortContractError extends Error {
  constructor() {
    super(SAFE_CONTRACT_ERROR_MESSAGE);
    this.name = "PlatformPilotCohortContractError";
  }
}

function invalid(): never {
  throw new PlatformPilotCohortContractError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformPilotCohortContractError) throw error;
  throw new PlatformPilotCohortContractError();
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

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalid();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalid() : normalized;
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) return invalid();
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : requiredText(value, maximum);
}

function provenance(value: unknown): PlatformPilotProvenance {
  if (!isRecord(value)) return invalid();
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 16) return invalid();
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).length > 4_096) return invalid();
  const normalized: Record<string, PlatformPilotProvenanceScalar> = {};
  for (const [key, item] of entries) {
    if (
      !/^[a-z][a-z0-9_.-]{0,63}$/.test(key) ||
      /(^|[_.-])(token|secret|password|api[_-]?key|authorization|cookie)([_.-]|$)/i.test(key) ||
      !(
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) ||
      (typeof item === "number" && !Number.isFinite(item)) ||
      new TextEncoder().encode(JSON.stringify(item)).length > 1_024 ||
      (typeof item === "string" && CONTROL_CHARACTER_PATTERN.test(item))
    ) return invalid();
    normalized[key] = item;
  }
  const source = normalized.source;
  if (
    typeof source !== "string" ||
    source !== source.trim() ||
    source.length < 1 ||
    source.length > 128
  ) return invalid();
  return Object.freeze(normalized);
}

function optionalProvenance(value: unknown): PlatformPilotProvenance | null {
  return value === null ? null : provenance(value);
}

function provenanceMatches(
  left: PlatformPilotProvenance,
  right: PlatformPilotProvenance,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) return invalid();
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return invalid();
  return value as number;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return invalid();
  return value as number;
}

function exactEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return invalid();
  return value as T;
}

function configuration(value: unknown): PlatformPilotConfiguration {
  if (!isRecord(value) || !hasExactKeys(value, CONFIGURATION_KEYS)) return invalid();
  return Object.freeze({
    configurationId: uuid(value.configuration_id),
    version: positiveInteger(value.version),
    state: exactEnum(value.state, PLATFORM_PILOT_CONFIGURATION_STATES),
    cutoffAt: timestamp(value.cutoff_at),
    reason: requiredText(value.reason, 1_000),
    provenance: provenance(value.provenance),
    changedByMembershipId: uuid(value.changed_by_membership_id),
    changedByName: requiredText(value.changed_by_name, 200),
    changedAt: timestamp(value.changed_at),
  });
}

function counts(value: unknown): PlatformPilotCounts {
  if (!isRecord(value) || !hasExactKeys(value, COUNTS_KEYS)) return invalid();
  const normalized = Object.freeze({
    outside: nonNegativeInteger(value.outside),
    included: nonNegativeInteger(value.included),
    excluded: nonNegativeInteger(value.excluded),
    total: nonNegativeInteger(value.total),
  });
  if (normalized.outside + normalized.included + normalized.excluded !== normalized.total) {
    return invalid();
  }
  return normalized;
}

function historyEntry(value: unknown): PlatformPilotMembershipHistoryEntry {
  if (!isRecord(value) || !hasExactKeys(value, HISTORY_KEYS)) return invalid();
  const action = exactEnum(value.action, PLATFORM_PILOT_HISTORY_ACTIONS);
  const basis = exactEnum(value.basis, PLATFORM_PILOT_MEMBERSHIP_BASES);
  if (
    (action === "automatic_include" && basis !== "cutoff_rule") ||
    (action === "manual_include" && basis !== "manual_include") ||
    (action === "manual_exclude" && basis !== "manual_exclude")
  ) return invalid();
  return Object.freeze({
    eventId: uuid(value.event_id),
    action,
    basis,
    reason: requiredText(value.reason, 1_000),
    provenance: provenance(value.provenance),
    changedByMembershipId: uuid(value.changed_by_membership_id),
    changedByName: requiredText(value.changed_by_name, 200),
    changedAt: timestamp(value.changed_at),
  });
}

export function normalizePlatformPilotWriteBoundary(
  value: unknown,
  expectedTarget?: PlatformPilotWriteTarget,
): PlatformPilotWriteBoundary {
  if (!isRecord(value) || !hasExactKeys(value, WRITE_BOUNDARY_KEYS)) return invalid();
  const requestedTarget = exactEnum(value.requested_target, PLATFORM_PILOT_WRITE_TARGETS);
  if (expectedTarget !== undefined && requestedTarget !== expectedTarget) return invalid();
  if (
    typeof value.allowed !== "boolean" ||
    value.authority !== "evo_supabase_only" ||
    value.fallback_allowed !== false
  ) return invalid();
  const reasonCode = exactEnum(value.reason_code, PLATFORM_PILOT_WRITE_REASON_CODES);
  if (
    (requestedTarget === "legacy_crm" &&
      (value.allowed !== false || reasonCode !== "legacy_write_forbidden")) ||
    (requestedTarget === "evo_supabase" &&
      ((value.allowed === true && reasonCode !== "canonical_write_allowed") ||
        (value.allowed === false &&
          !["pilot_membership_required", "pilot_membership_excluded"].includes(reasonCode))))
  ) return invalid();
  return Object.freeze({
    requestedTarget,
    allowed: value.allowed,
    reasonCode,
    authority: "evo_supabase_only",
    fallbackAllowed: false,
  });
}

export function normalizePlatformStudentCasePilotCohort(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
  historyLimit = DEFAULT_HISTORY_LIMIT,
): PlatformStudentCasePilotCohort {
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_HISTORY_LIMIT) {
    return invalid();
  }
  if (!isRecord(value) || !hasExactKeys(value, COHORT_ROW_KEYS)) return invalid();
  const organizationId = uuid(value.organization_id);
  const studentCaseId = uuid(value.student_case_id);
  if (
    organizationId !== uuid(expectedOrganizationId) ||
    studentCaseId !== uuid(expectedStudentCaseId)
  ) return invalid();

  const membershipStatus = exactEnum(
    value.membership_status,
    PLATFORM_PILOT_MEMBERSHIP_STATUSES,
  );
  const membershipBasis = value.membership_basis === null
    ? null
    : exactEnum(value.membership_basis, PLATFORM_PILOT_MEMBERSHIP_BASES);
  const reason = optionalText(value.reason, 1_000);
  const parsedProvenance = optionalProvenance(value.provenance);
  const changedByMembershipId = value.changed_by_membership_id === null
    ? null
    : uuid(value.changed_by_membership_id);
  const changedByName = optionalText(value.changed_by_name, 200);
  const changedAt = optionalTimestamp(value.changed_at);
  const currentFields = [
    membershipBasis,
    reason,
    parsedProvenance,
    changedByMembershipId,
    changedByName,
    changedAt,
  ];
  if (
    (membershipStatus === "outside" && currentFields.some((item) => item !== null)) ||
    (membershipStatus !== "outside" && currentFields.some((item) => item === null)) ||
    (membershipStatus === "included" &&
      membershipBasis !== "cutoff_rule" && membershipBasis !== "manual_include") ||
    (membershipStatus === "excluded" && membershipBasis !== "manual_exclude")
  ) return invalid();

  if (!Array.isArray(value.history) || value.history.length > historyLimit) return invalid();
  const seenEventIds = new Set<string>();
  let priorChangedAt = Number.POSITIVE_INFINITY;
  const history = value.history.map((entry) => {
    const normalized = historyEntry(entry);
    const changedAtEpoch = Date.parse(normalized.changedAt);
    if (seenEventIds.has(normalized.eventId) || changedAtEpoch > priorChangedAt) return invalid();
    seenEventIds.add(normalized.eventId);
    priorChangedAt = changedAtEpoch;
    return normalized;
  });
  const normalizedConfiguration = value.configuration === null
    ? null
    : configuration(value.configuration);
  const currentHistory = history[0] ?? null;
  if (
    (membershipStatus === "outside" && history.length !== 0) ||
    (membershipStatus !== "outside" &&
      (normalizedConfiguration === null || currentHistory === null)) ||
    (currentHistory !== null &&
      (currentHistory.basis !== membershipBasis ||
        currentHistory.reason !== reason ||
        parsedProvenance === null ||
        !provenanceMatches(currentHistory.provenance, parsedProvenance) ||
        currentHistory.changedByMembershipId !== changedByMembershipId ||
        currentHistory.changedByName !== changedByName ||
        Date.parse(currentHistory.changedAt) !== Date.parse(changedAt ?? "")))
  ) return invalid();
  const normalizedCounts = counts(value.counts);
  if (normalizedCounts[membershipStatus] < 1) return invalid();
  const writeBoundary = normalizePlatformPilotWriteBoundary(
    value.write_boundary,
    "evo_supabase",
  );
  if (
    (membershipStatus === "included" && !writeBoundary.allowed) ||
    (membershipStatus !== "included" && writeBoundary.allowed)
  ) return invalid();

  return Object.freeze({
    organizationId,
    studentCaseId,
    membershipStatus,
    membershipBasis,
    reason,
    provenance: parsedProvenance,
    changedByMembershipId,
    changedByName,
    changedAt,
    configuration: normalizedConfiguration,
    counts: normalizedCounts,
    history: Object.freeze(history),
    writeBoundary,
  });
}

export function normalizePlatformPilotConfigurationReceipt(
  value: unknown,
  expected: Readonly<{
    actor: PlatformActor;
    requestId: string;
    cutoffAt: string;
    state: PlatformPilotConfigurationState;
    reason: string;
  }>,
): PlatformPilotConfigurationReceipt {
  if (!isRecord(value) || !hasExactKeys(value, CONFIGURATION_RECEIPT_KEYS)) {
    return invalid();
  }
  if (typeof value.replayed !== "boolean") return invalid();
  const normalizedConfiguration = configuration({
    configuration_id: value.configuration_id,
    version: value.version,
    state: value.state,
    cutoff_at: value.cutoff_at,
    reason: value.reason,
    provenance: value.provenance,
    changed_by_membership_id: value.changed_by_membership_id,
    changed_by_name: value.changed_by_name,
    changed_at: value.changed_at,
  });
  const organizationId = uuid(value.organization_id);
  const requestId = uuid(value.request_id);
  if (
    organizationId !== uuid(expected.actor.organizationId) ||
    requestId !== uuid(expected.requestId) ||
    Date.parse(normalizedConfiguration.cutoffAt) !== Date.parse(timestamp(expected.cutoffAt)) ||
    normalizedConfiguration.state !== expected.state ||
    normalizedConfiguration.reason !== requiredText(expected.reason, 1_000) ||
    normalizedConfiguration.changedByMembershipId !== uuid(expected.actor.membershipId)
  ) return invalid();
  return Object.freeze({
    organizationId,
    requestId,
    ...normalizedConfiguration,
    replayed: value.replayed,
  });
}

export function normalizePlatformPilotMembershipReceipt(
  value: unknown,
  expected: Readonly<{
    actor: PlatformActor;
    requestId: string;
    studentCaseId: string;
    action: PlatformPilotMembershipAction;
    reason: string;
    provenance: PlatformPilotProvenance;
  }>,
): PlatformPilotMembershipReceipt {
  if (!isRecord(value) || !hasExactKeys(value, MEMBERSHIP_RECEIPT_KEYS)) {
    return invalid();
  }
  if (typeof value.replayed !== "boolean") return invalid();
  const membershipStatus = exactEnum(value.membership_status, ["included", "excluded"] as const);
  const membershipBasis = exactEnum(
    value.membership_basis,
    ["manual_include", "manual_exclude"] as const,
  );
  const expectedStatus = expected.action === "include" ? "included" : "excluded";
  const expectedBasis = expected.action === "include" ? "manual_include" : "manual_exclude";
  const normalized = Object.freeze({
    organizationId: uuid(value.organization_id),
    requestId: uuid(value.request_id),
    studentCaseId: uuid(value.student_case_id),
    eventId: uuid(value.event_id),
    membershipStatus,
    membershipBasis,
    reason: requiredText(value.reason, 1_000),
    provenance: provenance(value.provenance),
    changedByMembershipId: uuid(value.changed_by_membership_id),
    changedByName: requiredText(value.changed_by_name, 200),
    changedAt: timestamp(value.changed_at),
    replayed: value.replayed,
  });
  if (
    normalized.organizationId !== uuid(expected.actor.organizationId) ||
    normalized.requestId !== uuid(expected.requestId) ||
    normalized.studentCaseId !== uuid(expected.studentCaseId) ||
    normalized.changedByMembershipId !== uuid(expected.actor.membershipId) ||
    normalized.membershipStatus !== expectedStatus ||
    normalized.membershipBasis !== expectedBasis ||
    normalized.reason !== requiredText(expected.reason, 1_000) ||
    !provenanceMatches(normalized.provenance, provenance(expected.provenance))
  ) return invalid();
  return normalized;
}

function normalizedHistoryLimit(value: unknown): number {
  const limit = value ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_HISTORY_LIMIT) {
    return invalid();
  }
  return limit as number;
}

function requireActor(actor: PlatformActor, admin = false): PlatformActor {
  uuid(actor.organizationId);
  uuid(actor.membershipId);
  if (admin && actor.platformRole !== "admin") return invalid();
  return actor;
}

async function getClient(
  dependencies: PlatformPilotCohortDependencies,
): Promise<PlatformPilotCohortRpcClient> {
  if (dependencies.client) return dependencies.client;
  const { createSupabaseServerClient } = await import("./supabase/server");
  return (await createSupabaseServerClient()) as unknown as PlatformPilotCohortRpcClient;
}

function exactlyOneRow(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) return invalid();
  return value[0];
}

export async function getPlatformStudentCasePilotCohort(
  actor: PlatformActor,
  studentCaseId: string,
  historyLimit = DEFAULT_HISTORY_LIMIT,
  dependencies: PlatformPilotCohortDependencies = {},
): Promise<PlatformStudentCasePilotCohort> {
  try {
    requireActor(actor);
    const normalizedStudentCaseId = uuid(studentCaseId);
    const normalizedLimit = normalizedHistoryLimit(historyLimit);
    const client = await getClient(dependencies);
    const response = await client.schema("platform").rpc(
      PLATFORM_PILOT_STAFF_READ_RPC,
      {
        p_organization_id: uuid(actor.organizationId),
        p_student_case_id: normalizedStudentCaseId,
        p_history_limit: normalizedLimit,
      },
      { get: true },
    );
    if (response.error) return invalid();
    return normalizePlatformStudentCasePilotCohort(
      exactlyOneRow(response.data),
      actor.organizationId,
      normalizedStudentCaseId,
      normalizedLimit,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformPilotWriteBoundary(
  actor: PlatformActor,
  studentCaseId: string,
  target: PlatformPilotWriteTarget,
  dependencies: PlatformPilotCohortDependencies = {},
): Promise<PlatformPilotWriteBoundary> {
  try {
    requireActor(actor);
    const normalizedStudentCaseId = uuid(studentCaseId);
    const normalizedTarget = exactEnum(target, PLATFORM_PILOT_WRITE_TARGETS);
    const client = await getClient(dependencies);
    const response = await client.schema("platform").rpc(
      PLATFORM_PILOT_WRITE_BOUNDARY_RPC,
      {
        p_organization_id: uuid(actor.organizationId),
        p_student_case_id: normalizedStudentCaseId,
        p_target: normalizedTarget,
      },
      { get: true },
    );
    if (response.error) return invalid();
    return normalizePlatformPilotWriteBoundary(
      exactlyOneRow(response.data),
      normalizedTarget,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export function buildPlatformPilotConfigurationRpcArgs(
  actor: PlatformActor,
  input: PlatformPilotConfigureInput,
) {
  requireActor(actor, true);
  uuid(input.studentCaseId);
  return {
    p_organization_id: uuid(actor.organizationId),
    p_cutoff_at: timestamp(input.cutoffAt),
    p_state: exactEnum(input.state, PLATFORM_PILOT_CONFIGURATION_STATES),
    p_reason: requiredText(input.reason, 1_000),
    p_request_id: uuid(input.requestId),
  };
}

export function buildPlatformPilotMembershipRpcArgs(
  actor: PlatformActor,
  input: PlatformPilotMembershipInput,
) {
  requireActor(actor, true);
  return {
    p_organization_id: uuid(actor.organizationId),
    p_student_case_id: uuid(input.studentCaseId),
    p_membership_action: exactEnum(input.action, PLATFORM_PILOT_MEMBERSHIP_ACTIONS),
    p_reason: requiredText(input.reason, 1_000),
    p_provenance: provenance(input.provenance),
    p_request_id: uuid(input.requestId),
  };
}

export async function configurePlatformPilotCohort(
  actor: PlatformActor,
  input: PlatformPilotConfigureInput,
  dependencies: PlatformPilotCohortDependencies = {},
): Promise<PlatformPilotConfigurationReceipt> {
  try {
    const args = buildPlatformPilotConfigurationRpcArgs(actor, input);
    const client = await getClient(dependencies);
    const response = await client.schema("platform").rpc(
      PLATFORM_PILOT_CONFIGURE_RPC,
      args,
    );
    if (response.error) return invalid();
    return normalizePlatformPilotConfigurationReceipt(response.data, {
      actor,
      requestId: input.requestId,
      cutoffAt: input.cutoffAt,
      state: input.state,
      reason: input.reason,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function setPlatformStudentCasePilotMembership(
  actor: PlatformActor,
  input: PlatformPilotMembershipInput,
  dependencies: PlatformPilotCohortDependencies = {},
): Promise<PlatformPilotMembershipReceipt> {
  try {
    const args = buildPlatformPilotMembershipRpcArgs(actor, input);
    const client = await getClient(dependencies);
    const response = await client.schema("platform").rpc(
      PLATFORM_PILOT_MEMBERSHIP_RPC,
      args,
    );
    if (response.error) return invalid();
    return normalizePlatformPilotMembershipReceipt(response.data, {
      actor,
      requestId: input.requestId,
      studentCaseId: input.studentCaseId,
      action: input.action,
      reason: input.reason,
      provenance: input.provenance,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function reconcilePlatformPilotMutation<T>(
  invoke: () => PromiseLike<T>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await invoke();
    } catch {
      // The database may commit before its HTTP response is lost. Retrying the
      // exact request ID lets the immutable receipt reconcile that outcome.
    }
  }
  return null;
}

function formKeysAreExact(form: FormData, expected: readonly string[]): boolean {
  const keys = [...form.keys()].filter((key) => !key.startsWith("$ACTION_"));
  return keys.length === expected.length &&
    new Set(keys).size === keys.length &&
    expected.every((key) => keys.includes(key));
}

function formText(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim();
}

function boundedFormText(
  form: FormData,
  key: string,
  maximum: number,
): string | null {
  const value = formText(form, key);
  if (
    value === null ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) return null;
  return value;
}

function formUuid(form: FormData, key: string): string | null {
  try {
    return uuid(formText(form, key));
  } catch {
    return null;
  }
}

export function parsePlatformPilotConfigurationForm(
  form: FormData,
): PlatformPilotConfigureInput | null {
  if (!formKeysAreExact(form, [
    "student_case_id",
    "cutoff_at",
    "state",
    "reason",
    "request_id",
  ])) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const requestId = formUuid(form, "request_id");
  const cutoffAtInput = formText(form, "cutoff_at");
  const stateInput = formText(form, "state");
  const reason = boundedFormText(form, "reason", 1_000);
  if (!studentCaseId || !requestId || !cutoffAtInput || !stateInput || !reason) return null;
  let cutoffAt: string;
  let state: PlatformPilotConfigurationState;
  try {
    cutoffAt = timestamp(cutoffAtInput);
    state = exactEnum(stateInput, PLATFORM_PILOT_CONFIGURATION_STATES);
  } catch {
    return null;
  }
  return Object.freeze({ studentCaseId, cutoffAt, state, reason, requestId });
}

export function parsePlatformPilotMembershipForm(
  form: FormData,
): PlatformPilotMembershipInput | null {
  if (!formKeysAreExact(form, [
    "student_case_id",
    "membership_action",
    "reason",
    "provenance",
    "request_id",
  ])) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const requestId = formUuid(form, "request_id");
  const actionInput = formText(form, "membership_action");
  const reason = boundedFormText(form, "reason", 1_000);
  const provenanceReference = boundedFormText(form, "provenance", 500);
  if (!studentCaseId || !requestId || !actionInput || !reason || !provenanceReference) return null;
  let action: PlatformPilotMembershipAction;
  try {
    action = exactEnum(actionInput, PLATFORM_PILOT_MEMBERSHIP_ACTIONS);
  } catch {
    return null;
  }
  return Object.freeze({
    studentCaseId,
    action,
    reason,
    provenance: Object.freeze({
      source: "staff_manual_decision",
      reference: provenanceReference,
    }),
    requestId,
  });
}
