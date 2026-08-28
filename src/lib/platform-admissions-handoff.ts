import type { PlatformActor } from "./platform-auth";
import {
  PLATFORM_ADMISSIONS_HANDOFF_MODES,
  type PlatformAdmissionsHandoff,
  type PlatformAdmissionsHandoffInheritedContext,
  type PlatformAdmissionsHandoffMode,
  type PlatformAdmissionsHandoffMutationInput,
  type PlatformAdmissionsHandoffMutationReceipt,
  type PlatformAdmissionsHandoffOwnerOption,
  type PlatformAdmissionsHandoffStarterTask,
} from "./platform-admissions-handoff-contract.ts";

export {
  PLATFORM_ADMISSIONS_HANDOFF_MODES,
  PLATFORM_ADMISSIONS_HANDOFF_STATUSES,
} from "./platform-admissions-handoff-contract.ts";
export type {
  PlatformAdmissionsHandoff,
  PlatformAdmissionsHandoffInheritedContext,
  PlatformAdmissionsHandoffMode,
  PlatformAdmissionsHandoffMutationInput,
  PlatformAdmissionsHandoffMutationReceipt,
  PlatformAdmissionsHandoffOwnerOption,
  PlatformAdmissionsHandoffStarterTask,
  PlatformAdmissionsHandoffStatus,
} from "./platform-admissions-handoff-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type PlatformAdmissionsHandoffFailureKind =
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformAdmissionsHandoffDependencies = Readonly<{
  client?: RpcClient;
}>;

export class PlatformAdmissionsHandoffRepositoryError extends Error {
  readonly kind: PlatformAdmissionsHandoffFailureKind;

  constructor(kind: PlatformAdmissionsHandoffFailureKind = "unavailable") {
    super("Platform Admissions handoff is unavailable.");
    this.name = "PlatformAdmissionsHandoffRepositoryError";
    this.kind = kind;
  }
}

function invalid(
  kind: PlatformAdmissionsHandoffFailureKind = "invalid",
): never {
  throw new PlatformAdmissionsHandoffRepositoryError(kind);
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAdmissionsHandoffRepositoryError) throw error;
  throw new PlatformAdmissionsHandoffRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlatformAdmissionsHandoffUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformAdmissionsHandoffUuid(value) ?? invalid();
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return value === undefined ? undefined : parsePlatformAdmissionsHandoffUuid(value) ?? invalid();
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalid();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return value === undefined ? undefined : requiredTimestamp(value);
}

function optionalDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !DATE_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  ) {
    return invalid();
  }
  return value;
}

function requiredText(value: unknown, maximum = 200): string {
  if (typeof value !== "string") return invalid();
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalid();
  }
  return normalized;
}

function optionalText(
  value: unknown,
  maximum = 1000,
): string | null | undefined {
  if (value === null) return null;
  return value === undefined ? undefined : requiredText(value, maximum);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

function handoffMode(value: unknown): PlatformAdmissionsHandoffMode {
  return (PLATFORM_ADMISSIONS_HANDOFF_MODES as readonly string[]).includes(
      String(value),
    )
    ? (value as PlatformAdmissionsHandoffMode)
    : invalid();
}

function optionalHandoffMode(
  value: unknown,
): PlatformAdmissionsHandoffMode | null | undefined {
  if (value === null) return null;
  return value === undefined ? undefined : handoffMode(value);
}

function optionalCaseState(
  value: unknown,
): "active" | "closed" | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (value === "active" || value === "closed") return value;
  return invalid();
}

function requiredGateState(value: unknown): "blocked" | "satisfied" | "overridden" {
  if (value === "blocked" || value === "satisfied" || value === "overridden") {
    return value;
  }
  return invalid();
}

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function readTextEntry(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const value = single(form, key);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function readPositiveIntegerEntry(form: FormData, key: string): number | null {
  const value = single(form, key);
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireActor(actor: PlatformActor): Readonly<{
  organizationId: string;
  membershipId: string;
  platformRole: "admin" | "sales";
}> {
  const organizationId = parsePlatformAdmissionsHandoffUuid(actor.organizationId);
  const membershipId = parsePlatformAdmissionsHandoffUuid(actor.membershipId);
  if (
    organizationId === null ||
    membershipId === null ||
    (actor.platformRole !== "admin" && actor.platformRole !== "sales")
  ) {
    return invalid("forbidden");
  }
  return {
    organizationId,
    membershipId,
    platformRole: actor.platformRole,
  };
}

function requireReadActor(actor: PlatformActor): Readonly<{
  organizationId: string;
  membershipId: string;
  platformRole: "admin" | "admissions";
}> {
  const organizationId = parsePlatformAdmissionsHandoffUuid(actor.organizationId);
  const membershipId = parsePlatformAdmissionsHandoffUuid(actor.membershipId);
  if (
    organizationId === null ||
    membershipId === null ||
    (actor.platformRole !== "admin" && actor.platformRole !== "admissions")
  ) {
    return invalid("forbidden");
  }
  return {
    organizationId,
    membershipId,
    platformRole: actor.platformRole,
  };
}

async function getPlatformClient(): Promise<RpcClient> {
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

function normalizeOwnerOption(value: unknown): PlatformAdmissionsHandoffOwnerOption {
  if (!isRecord(value)) return invalid();
  return Object.freeze({
    membershipId: requiredUuid(value.membership_id),
    displayName: requiredText(value.display_name, 200),
  });
}

function normalizeEligibleOwners(value: unknown): readonly PlatformAdmissionsHandoffOwnerOption[] {
  if (!Array.isArray(value)) return invalid();
  const items = value.map((item) => normalizeOwnerOption(item));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.membershipId)) return invalid();
    seen.add(item.membershipId);
  }
  return Object.freeze(items);
}

function normalizeStarterTask(value: unknown): PlatformAdmissionsHandoffStarterTask {
  if (!isRecord(value)) return invalid();
  return Object.freeze({
    taskId: requiredUuid(value.task_id),
    sourceKey: requiredText(value.source_key, 128),
    title: requiredText(value.title, 200),
    assigneeMembershipId: requiredUuid(value.assignee_membership_id),
    assigneeDisplayName: requiredText(value.assignee_display_name, 200),
    priority: requiredText(value.priority, 32),
    dueAt: optionalTimestamp(value.due_at) ?? null,
    status: requiredText(value.status, 32),
  });
}

function normalizeStarterTasks(value: unknown): readonly PlatformAdmissionsHandoffStarterTask[] {
  if (!Array.isArray(value)) return invalid();
  const items = value.map((item) => normalizeStarterTask(item));
  if (items.length !== 3) return invalid();
  const seenTaskIds = new Set<string>();
  const seenSourceKeys = new Set<string>();
  for (const item of items) {
    if (seenTaskIds.has(item.taskId) || seenSourceKeys.has(item.sourceKey)) return invalid();
    seenTaskIds.add(item.taskId);
    seenSourceKeys.add(item.sourceKey);
  }
  for (const expectedSourceKey of [
    "u6.sales-context-review",
    "u6.study-route-confirmation",
    "u6.document-request-plan",
  ]) {
    if (!seenSourceKeys.has(expectedSourceKey)) return invalid();
  }
  return Object.freeze(items);
}

function normalizeProvenance(value: unknown): PlatformAdmissionsHandoffInheritedContext["provenance"] {
  if (!Array.isArray(value) || value.length > 50) return invalid();
  const seen = new Set<string>();
  const items = value.map((item) => {
    if (!isRecord(item)) return invalid();
    const provenanceId = requiredUuid(item.provenance_id);
    const subjectType = item.subject_type === "lead" || item.subject_type === "client"
      ? item.subject_type
      : invalid();
    const importedAt = optionalTimestamp(item.imported_at);
    const sourceReference = optionalText(item.source_ref, 1024);
    if (importedAt === undefined || sourceReference === undefined) return invalid();
    if (seen.has(provenanceId)) return invalid();
    seen.add(provenanceId);
    return Object.freeze({
      provenanceId,
      subjectType,
      sourceSystem: requiredText(item.source_system, 64),
      evidenceType: requiredText(item.evidence_type, 64),
      observedAt: requiredTimestamp(item.observed_at),
      importedAt,
      sourceReference,
    });
  });
  return Object.freeze(items);
}

function normalizeConversations(
  value: unknown,
): PlatformAdmissionsHandoffInheritedContext["conversations"] {
  if (!Array.isArray(value) || value.length > 50) return invalid();
  const seen = new Set<string>();
  const items = value.map((item) => {
    if (!isRecord(item)) return invalid();
    const conversationId = requiredUuid(item.conversation_id);
    if (seen.has(conversationId)) return invalid();
    seen.add(conversationId);
    return Object.freeze({
      conversationId,
      subject: requiredText(item.subject, 1000),
      queue: requiredText(item.queue, 32),
      status: requiredText(item.status, 32),
      updatedAt: requiredTimestamp(item.updated_at),
    });
  });
  return Object.freeze(items);
}

function normalizeInheritedContext(
  value: Record<string, unknown>,
  leadId: string,
  ownerMembershipId: string,
): PlatformAdmissionsHandoffInheritedContext {
  if (!isRecord(value.sales_context) || !isRecord(value.client_context)) {
    return invalid();
  }
  const salesContext = value.sales_context;
  const clientContext = value.client_context;
  const salesLeadId = requiredUuid(salesContext.lead_id);
  const responsibleSalesMembershipId = requiredUuid(
    salesContext.current_owner_membership_id,
  );
  const nextAction = optionalText(salesContext.next_action_text, 1000);
  const nextActionDueDate = optionalDate(salesContext.next_action_due_date);
  const workflowVersion = positiveInteger(value.workflow_version);
  if (
    salesLeadId !== leadId ||
    positiveInteger(salesContext.workflow_version) !== workflowVersion ||
    nextAction === undefined ||
    nextActionDueDate === undefined
  ) {
    return invalid();
  }
  const starterTasks = normalizeStarterTasks(value.starter_tasks);
  if (starterTasks.some((task) => task.assigneeMembershipId !== ownerMembershipId)) {
    return invalid();
  }
  return Object.freeze({
    actorMembershipId: requiredUuid(value.actor_membership_id),
    actorDisplayName: requiredText(value.actor_display_name, 200),
    workflowVersion,
    sales: Object.freeze({
      stageKey: requiredText(salesContext.stage_key, 128),
      sourceKey: requiredText(salesContext.source_key, 128),
      responsibleSalesMembershipId,
      nextAction,
      nextActionDueDate,
    }),
    client: Object.freeze({
      clientId: requiredUuid(clientContext.client_id),
      displayName: requiredText(clientContext.display_name, 200),
    }),
    provenance: normalizeProvenance(value.provenance),
    conversations: normalizeConversations(value.conversation_links),
  });
}

export function normalizePlatformAdmissionsHandoff(
  value: unknown,
  expectedOrganizationId?: string,
  actorRole?: "admin" | "sales",
): PlatformAdmissionsHandoff {
  if (!isRecord(value)) return invalid();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalid();
  }
  const leadId = requiredUuid(value.lead_id);
  const gateVersion = positiveInteger(value.gate_version);
  const gateState = requiredGateState(value.gate_state);
  const normalHandoffAllowed =
    typeof value.normal_handoff_allowed === "boolean"
      ? value.normal_handoff_allowed
      : invalid();
  const exceptionalHandoffAllowed =
    typeof value.exceptional_handoff_allowed === "boolean"
      ? value.exceptional_handoff_allowed
      : invalid();
  if (normalHandoffAllowed === exceptionalHandoffAllowed) {
    if (normalHandoffAllowed || gateState !== "blocked") return invalid();
  }
  if (normalHandoffAllowed !== (gateState === "satisfied")) return invalid();
  if (exceptionalHandoffAllowed !== (gateState === "overridden")) return invalid();

  const caseId = optionalUuid(value.case_id);
  const caseState = optionalCaseState(value.case_state);
  const admissionsOwnerMembershipId = optionalUuid(
    value.admissions_owner_membership_id,
  );
  const admissionsOwnerDisplayName = optionalText(
    value.admissions_owner_display_name,
    200,
  );
  const mode = optionalHandoffMode(value.handoff_mode);
  const reason = optionalText(value.handoff_reason, 1000);
  const handedOffAt = optionalTimestamp(value.handed_off_at);
  const starterTaskCount = nonNegativeInteger(value.starter_task_count);
  const owners = normalizeEligibleOwners(value.eligible_admissions_owners);
  const canSubmitNormalValue =
    typeof value.can_submit_normal === "boolean"
      ? value.can_submit_normal
      : undefined;
  const canSubmitExceptionalValue =
    typeof value.can_submit_exceptional === "boolean"
      ? value.can_submit_exceptional
      : undefined;

  const completed =
    caseId !== undefined &&
    caseState !== undefined &&
    admissionsOwnerMembershipId !== undefined &&
    admissionsOwnerDisplayName !== undefined &&
    mode !== undefined &&
    reason !== undefined &&
    handedOffAt !== undefined;

  if (!completed) return invalid();

  if (caseId === null) {
    if (
      caseState !== null ||
      admissionsOwnerMembershipId !== null ||
      admissionsOwnerDisplayName !== null ||
      mode !== null ||
      reason !== null ||
      handedOffAt !== null ||
      starterTaskCount !== 0
    ) {
      return invalid();
    }
  } else {
    if (
      caseState === null ||
      admissionsOwnerMembershipId === null ||
      admissionsOwnerDisplayName === null ||
      mode === null ||
      reason === null ||
      handedOffAt === null ||
      starterTaskCount !== 3
    ) {
      return invalid();
    }
  }

  const canSubmitNormal =
    canSubmitNormalValue ?? (
      caseId === null &&
      normalHandoffAllowed &&
      gateState === "satisfied"
    );
  const canSubmitExceptional =
    canSubmitExceptionalValue ?? (
      caseId === null &&
      exceptionalHandoffAllowed &&
      gateState === "overridden" &&
      actorRole === "admin"
    );
  if (
    actorRole === "sales" &&
    canSubmitExceptional
  ) {
    return invalid();
  }
  if (
    actorRole === "sales" &&
    canSubmitNormal &&
    gateState !== "satisfied"
  ) {
    return invalid();
  }
  if (canSubmitNormal && canSubmitExceptional) return invalid();
  const status =
    caseId !== null ? "completed" : canSubmitNormal || canSubmitExceptional
      ? "ready"
      : "blocked";

  return Object.freeze({
    organizationId,
    leadId,
    gateVersion,
    gateState,
    normalHandoffAllowed,
    exceptionalHandoffAllowed,
    canSubmitNormal,
    canSubmitExceptional,
    status,
    caseId,
    caseState,
    admissionsOwnerMembershipId,
    admissionsOwnerDisplayName,
    handoffMode: mode ?? null,
    handoffReason: reason ?? null,
    handedOffAt: handedOffAt ?? null,
    starterTaskCount,
    starterTasks: Object.freeze([]),
    inheritedContext: null,
    eligibleAdmissionsOwners: owners,
  });
}

function normalizeStudentCaseAdmissionsHandoffContext(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformAdmissionsHandoff {
  if (!isRecord(value)) return invalid();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalid();
  }
  const leadId = requiredUuid(value.lead_id);
  const caseId = requiredUuid(value.student_case_id);
  const caseState = optionalCaseState(value.case_state);
  const mode = handoffMode(value.handoff_mode);
  const state = requiredText(value.handoff_state, 32);
  const source = requiredText(value.handoff_source, 32);
  const reason = requiredText(value.handoff_reason, 1000);
  const handedOffAt = requiredTimestamp(value.handed_off_at);
  const admissionsOwnerMembershipId = requiredUuid(value.admissions_owner_membership_id);
  const admissionsOwnerDisplayName = requiredText(
    value.admissions_owner_display_name,
    200,
  );
  const gateVersion = positiveInteger(value.gate_version);
  const gateState = requiredGateState(value.gate_state);
  const starterTasks = normalizeStarterTasks(value.starter_tasks);
  const inheritedContext = normalizeInheritedContext(
    value,
    leadId,
    admissionsOwnerMembershipId,
  );
  if (
    state !== "completed" ||
    source !== "canonical_sales" ||
    (caseState !== "active" && caseState !== "closed")
  ) {
    return invalid();
  }

  return Object.freeze({
    organizationId,
    leadId,
    gateVersion,
    gateState,
    normalHandoffAllowed: gateState === "satisfied",
    exceptionalHandoffAllowed: gateState === "overridden",
    canSubmitNormal: false,
    canSubmitExceptional: false,
    status: "completed",
    caseId,
    caseState,
    admissionsOwnerMembershipId,
    admissionsOwnerDisplayName,
    handoffMode: mode,
    handoffReason: reason,
    handedOffAt,
    starterTaskCount: starterTasks.length,
    starterTasks,
    inheritedContext,
    eligibleAdmissionsOwners: Object.freeze([]),
  });
}

export function parsePlatformAdmissionsHandoffFormData(
  form: FormData,
): PlatformAdmissionsHandoffMutationInput | null {
  const leadId = parsePlatformAdmissionsHandoffUuid(single(form, "lead_id"));
  const expectedGateVersion = readPositiveIntegerEntry(form, "expected_gate_version");
  const admissionsOwnerMembershipId = parsePlatformAdmissionsHandoffUuid(
    single(form, "admissions_owner_membership_id"),
  );
  const modeEntry = single(form, "handoff_mode");
  const reason = readTextEntry(form, "reason", 1, 1000);
  const requestId = parsePlatformAdmissionsHandoffUuid(single(form, "request_id"));
  if (
    leadId === null ||
    expectedGateVersion === null ||
    admissionsOwnerMembershipId === null ||
    typeof modeEntry !== "string" ||
    reason === null ||
    requestId === null
  ) {
    return null;
  }
  const handoffMode = (PLATFORM_ADMISSIONS_HANDOFF_MODES as readonly string[]).includes(
      modeEntry,
    )
    ? (modeEntry as PlatformAdmissionsHandoffMode)
    : null;
  if (handoffMode === null) return null;
  return Object.freeze({
    leadId,
    expectedGateVersion,
    admissionsOwnerMembershipId,
    handoffMode,
    reason,
    requestId,
  });
}

function validateMutationInput(
  value: PlatformAdmissionsHandoffMutationInput,
): PlatformAdmissionsHandoffMutationInput {
  const leadId = parsePlatformAdmissionsHandoffUuid(value.leadId);
  const admissionsOwnerMembershipId = parsePlatformAdmissionsHandoffUuid(
    value.admissionsOwnerMembershipId,
  );
  const requestId = parsePlatformAdmissionsHandoffUuid(value.requestId);
  const expectedGateVersion =
    Number.isSafeInteger(value.expectedGateVersion) && value.expectedGateVersion > 0
      ? value.expectedGateVersion
      : invalid();
  const mode = (PLATFORM_ADMISSIONS_HANDOFF_MODES as readonly string[]).includes(
      value.handoffMode,
    )
    ? value.handoffMode
    : invalid();
  const reason = requiredText(value.reason, 1000);
  if (
    leadId === null ||
    admissionsOwnerMembershipId === null ||
    requestId === null
  ) {
    return invalid();
  }
  return Object.freeze({
    leadId,
    expectedGateVersion,
    admissionsOwnerMembershipId,
    handoffMode: mode,
    reason,
    requestId,
  });
}

function normalizeError(error: unknown): PlatformAdmissionsHandoffFailureKind | null {
  const message = (
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : ""
  ).toLowerCase();
  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : "";
  if (message.includes("request_id_conflict")) return "request_conflict";
  if (
    message.includes("version_conflict") ||
    message.includes("already_completed_conflict") ||
    message.includes("existing_case_conflict") ||
    message.includes("case_conflict") ||
    message.includes("scope_conflict") ||
    message.includes("gate_incomplete") ||
    message.includes("stale") ||
    code === "PT409" ||
    code === "23505"
  ) {
    return "stale";
  }
  if (
    message.includes("not_found_or_forbidden") ||
    message.includes("forbidden") ||
    message.includes("same-organization") ||
    message.includes("active curator") ||
    message.includes("active responsible sales") ||
    code === "42501"
  ) {
    return "forbidden";
  }
  if (
    message.includes("invalid") ||
    message.includes("required") ||
    message.includes("blocked") ||
    message.includes("closed case") ||
    code === "22023" ||
    code === "23514"
  ) {
    return "invalid";
  }
  return null;
}

export async function getPlatformAdmissionsHandoff(
  actor: PlatformActor,
  leadId: string,
  dependencies: PlatformAdmissionsHandoffDependencies = {},
): Promise<PlatformAdmissionsHandoff | null> {
  try {
    const authority = requireActor(actor);
    const normalizedLeadId = parsePlatformAdmissionsHandoffUuid(leadId);
    if (normalizedLeadId === null) return null;
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc(
        "staff_lead_admissions_handoff",
        { p_lead_id: normalizedLeadId },
        { get: true },
      );
    if (response.error || !Array.isArray(response.data)) return invalid();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalid();
    const handoff = normalizePlatformAdmissionsHandoff(
      response.data[0],
      authority.organizationId,
      authority.platformRole,
    );
    return handoff.leadId === normalizedLeadId ? handoff : invalid();
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformStudentCaseAdmissionsHandoff(
  actor: PlatformActor,
  studentCaseId: string,
  dependencies: PlatformAdmissionsHandoffDependencies = {},
): Promise<PlatformAdmissionsHandoff | null> {
  try {
    const authority = requireReadActor(actor);
    const normalizedStudentCaseId = parsePlatformAdmissionsHandoffUuid(studentCaseId);
    if (normalizedStudentCaseId === null) return null;
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc(
        "staff_student_case_handoff_context",
        { p_student_case_id: normalizedStudentCaseId },
        { get: true },
      );
    if (response.error || !Array.isArray(response.data)) return invalid();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalid();
    return normalizeStudentCaseAdmissionsHandoffContext(
      response.data[0],
      authority.organizationId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function mutatePlatformAdmissionsHandoff(
  actor: PlatformActor,
  input: PlatformAdmissionsHandoffMutationInput,
  dependencies: PlatformAdmissionsHandoffDependencies = {},
): Promise<PlatformAdmissionsHandoffMutationReceipt> {
  try {
    const authority = requireActor(actor);
    const validatedInput = validateMutationInput(input);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("handoff_lead_to_admissions", {
        p_lead_id: validatedInput.leadId,
        p_expected_gate_version: validatedInput.expectedGateVersion,
        p_admissions_owner_membership_id: validatedInput.admissionsOwnerMembershipId,
        p_handoff_mode: validatedInput.handoffMode,
        p_reason: validatedInput.reason,
        p_request_id: validatedInput.requestId,
      });
    if (response.error) {
      const kind = normalizeError(response.error);
      if (kind) return invalid(kind);
      return invalid("unavailable");
    }
    if (!isRecord(response.data)) return invalid();
    const handoff = normalizePlatformAdmissionsHandoff(
      response.data,
      authority.organizationId,
      authority.platformRole,
    );
    const changedAt = requiredTimestamp(response.data.changed_at);
    const requestId = requiredUuid(response.data.request_id);
    if (
      handoff.leadId !== validatedInput.leadId ||
      requestId !== validatedInput.requestId ||
      handoff.admissionsOwnerMembershipId !== validatedInput.admissionsOwnerMembershipId ||
      handoff.handoffMode !== validatedInput.handoffMode ||
      handoff.gateVersion !== validatedInput.expectedGateVersion
    ) {
      return invalid();
    }
    return Object.freeze({
      ...handoff,
      requestId,
      changedAt,
    });
  } catch (error) {
    const kind = normalizeError(error);
    if (kind) return invalid(kind);
    return failClosed(error);
  }
}
