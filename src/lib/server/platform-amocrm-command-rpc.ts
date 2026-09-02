import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const SAFE_ERROR_MESSAGE = "Platform amoCRM command runtime is unavailable.";

export const PLATFORM_AMOCRM_COMMAND_OPERATION_NAMES = [
  "contact_create",
  "contact_update",
  "lead_create",
  "lead_update",
  "contact_lead_link",
  "lead_pipeline_status_update",
  "lead_responsible_update",
  "lead_note_create",
  "lead_task_create",
  "lead_tag_update",
] as const;

export type PlatformAmoCrmCommandOperationName =
  (typeof PLATFORM_AMOCRM_COMMAND_OPERATION_NAMES)[number];

export type PlatformAmoCrmActorRole = "admin" | "sales" | "admissions";

export type PlatformAmoCrmWorkflowScope =
  | "sales_pre_handoff"
  | "admissions_post_handoff";

export type PlatformAmoCrmCommandStatus =
  | "prepared"
  | "accepted"
  | "unknown"
  | "rejected";

type PlatformAmoCrmRpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type PlatformAmoCrmRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<PlatformAmoCrmRpcResponse>;
  }>;
}>;

export class PlatformAmoCrmCommandRpcError extends Error {
  constructor() {
    super(SAFE_ERROR_MESSAGE);
    this.name = "PlatformAmoCrmCommandRpcError";
  }
}

export type PlatformAmoCrmWorkflowAuthorization = Readonly<{
  actorRole: PlatformAmoCrmActorRole;
  workflowScope: PlatformAmoCrmWorkflowScope;
  workflowLeadId: string;
  studentCaseId: string | null;
}>;

export type PlatformAmoCrmCommandSnapshot = Readonly<{
  attemptId: string;
  commandReceiptId: string;
  organizationId: string;
  idempotencyKey: string;
  operationName: PlatformAmoCrmCommandOperationName;
  actorRole: PlatformAmoCrmActorRole;
  workflowScope: PlatformAmoCrmWorkflowScope;
  workflowLeadId: string;
  studentCaseId: string | null;
  personId: string | null;
  leadId: string | null;
  targetContactId: string | null;
  targetLeadId: string | null;
  status: PlatformAmoCrmCommandStatus;
  providerDispatchedAt: string | null;
  resultContactId: string | null;
  resultLeadId: string | null;
  failureCode: string | null;
}>;

export type PlatformAmoCrmBindingsSnapshot = Readonly<{
  contactId: string | null;
  leadId: string | null;
}>;

export type PreparePlatformAmoCrmCommandInput = Readonly<{
  organizationId: string;
  authorization: PlatformAmoCrmWorkflowAuthorization;
  personId: string | null;
  leadId: string | null;
  operationName: PlatformAmoCrmCommandOperationName;
  idempotencyKey: string;
  targetContactId: string | null;
  targetLeadId: string | null;
  payload: Readonly<Record<string, unknown>>;
}>;

export type ReadPlatformAmoCrmBindingsInput = Readonly<{
  organizationId: string;
  authorization: PlatformAmoCrmWorkflowAuthorization;
  personId: string | null;
  leadId: string | null;
}>;

export type ReadPlatformBlockingAmoCrmCommandInput =
  Readonly<ReadPlatformAmoCrmBindingsInput>;

export type ClaimPlatformAmoCrmCommandInput = Readonly<{
  organizationId: string;
  attemptId: string;
  requestId: string;
  workerRef: string;
  visibilityTimeoutSeconds: number;
}>;

export type FinishPlatformAmoCrmCommandInput = Readonly<{
  organizationId: string;
  attemptId: string;
  requestId: string;
  outcome: "accepted" | "unknown" | "rejected";
  providerRequestId: string | null;
  providerHttpStatus: number | null;
  providerReadback: Readonly<Record<string, unknown>> | null;
  providerRespondedAt: string | null;
  resultContactId: string | null;
  resultLeadId: string | null;
  failureCode: string | null;
}>;

export type ReconcileUnknownPlatformAmoCrmCommandInput = Readonly<{
  organizationId: string;
  attemptId: string;
  requestId: string;
  outcome: "accepted" | "unchanged";
  providerReadback: Readonly<Record<string, unknown>> | null;
  providerReadbackAt: string | null;
  providerRespondedAt: string | null;
  resultContactId: string | null;
  resultLeadId: string | null;
  failureCode: string | null;
}>;

function invalid(): never {
  throw new PlatformAmoCrmCommandRpcError();
}

function normalizedUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function providerId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) return null;
  return value;
}

function safeText(value: unknown, maximum: number): string | null {
  if (
    value === null ||
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return null;
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function workflowAuthorization(
  value: PlatformAmoCrmWorkflowAuthorization,
): Readonly<Record<string, string | null>> {
  const workflowLeadId = normalizedUuid(value.workflowLeadId);
  if (workflowLeadId === null) invalid();
  if (
    value.actorRole !== "admin" &&
    value.actorRole !== "sales" &&
    value.actorRole !== "admissions"
  ) {
    invalid();
  }
  if (
    value.workflowScope !== "sales_pre_handoff" &&
    value.workflowScope !== "admissions_post_handoff"
  ) {
    invalid();
  }
  const studentCaseId =
    value.studentCaseId === null ? null : normalizedUuid(value.studentCaseId);
  if (
    (value.workflowScope === "sales_pre_handoff" && studentCaseId !== null) ||
    (value.workflowScope === "admissions_post_handoff" && studentCaseId === null)
  ) {
    invalid();
  }
  return Object.freeze({
    actor_role: value.actorRole,
    workflow_scope: value.workflowScope,
    workflow_lead_id: workflowLeadId,
    student_case_id: studentCaseId,
  });
}

function payloadJson(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return record(value) ?? invalid();
}

function parseSnapshot(value: unknown): PlatformAmoCrmCommandSnapshot {
  const row = record(value) ?? invalid();
  const operationName = row.operation_name;
  const actorRole = row.actor_role;
  const workflowScope = row.workflow_scope;
  const status = row.status;
  if (
    !PLATFORM_AMOCRM_COMMAND_OPERATION_NAMES.includes(
      operationName as PlatformAmoCrmCommandOperationName,
    ) ||
    (actorRole !== "admin" && actorRole !== "sales" && actorRole !== "admissions") ||
    (workflowScope !== "sales_pre_handoff" &&
      workflowScope !== "admissions_post_handoff") ||
    (status !== "prepared" &&
      status !== "accepted" &&
      status !== "unknown" &&
      status !== "rejected")
  ) {
    invalid();
  }
  return Object.freeze({
    attemptId: normalizedUuid(row.attempt_id) ?? invalid(),
    commandReceiptId: normalizedUuid(row.command_receipt_id) ?? invalid(),
    organizationId: normalizedUuid(row.organization_id) ?? invalid(),
    idempotencyKey: safeText(row.idempotency_key, 200) ?? invalid(),
    operationName: operationName as PlatformAmoCrmCommandOperationName,
    actorRole: actorRole as PlatformAmoCrmActorRole,
    workflowScope: workflowScope as PlatformAmoCrmWorkflowScope,
    workflowLeadId: normalizedUuid(row.workflow_lead_id) ?? invalid(),
    studentCaseId:
      row.student_case_id === null ? null : normalizedUuid(row.student_case_id) ?? invalid(),
    personId: row.person_id === null ? null : normalizedUuid(row.person_id) ?? invalid(),
    leadId: row.lead_id === null ? null : normalizedUuid(row.lead_id) ?? invalid(),
    targetContactId:
      row.target_contact_id === null ? null : providerId(row.target_contact_id) ?? invalid(),
    targetLeadId:
      row.target_lead_id === null ? null : providerId(row.target_lead_id) ?? invalid(),
    status: status as PlatformAmoCrmCommandStatus,
    providerDispatchedAt:
      row.provider_dispatched_at === null
        ? null
        : safeText(row.provider_dispatched_at, 64) ?? invalid(),
    resultContactId:
      row.result_contact_id === null ? null : providerId(row.result_contact_id) ?? invalid(),
    resultLeadId:
      row.result_lead_id === null ? null : providerId(row.result_lead_id) ?? invalid(),
    failureCode: row.failure_code === null ? null : safeText(row.failure_code, 64) ?? invalid(),
  });
}

function parseBindingsSnapshot(value: unknown): PlatformAmoCrmBindingsSnapshot {
  const row = record(value) ?? invalid();
  return Object.freeze({
    contactId: row.contact_id === null ? null : providerId(row.contact_id) ?? invalid(),
    leadId: row.lead_id === null ? null : providerId(row.lead_id) ?? invalid(),
  });
}

async function rpc(
  client: PlatformAmoCrmRpcClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
  options?: Readonly<{ get?: boolean }>,
): Promise<unknown> {
  let response: PlatformAmoCrmRpcResponse;
  try {
    response = await client.schema("platform").rpc(name, args, options);
  } catch {
    invalid();
  }
  if (response.error !== null) invalid();
  return response.data;
}

export async function preparePlatformAmoCrmCommand(
  client: PlatformAmoCrmRpcClient,
  input: PreparePlatformAmoCrmCommandInput,
): Promise<Readonly<{ kind: "prepared" | "replay"; attempt: PlatformAmoCrmCommandSnapshot }>> {
  const row = record(
    await rpc(client, "prepare_amocrm_command", {
      p_organization_id: normalizedUuid(input.organizationId) ?? invalid(),
      p_authorization: workflowAuthorization(input.authorization),
      p_person_id: input.personId === null ? null : normalizedUuid(input.personId) ?? invalid(),
      p_lead_id: input.leadId === null ? null : normalizedUuid(input.leadId) ?? invalid(),
      p_operation_name: input.operationName,
      p_idempotency_key: safeText(input.idempotencyKey, 200) ?? invalid(),
      p_target_contact_id:
        input.targetContactId === null ? null : providerId(input.targetContactId) ?? invalid(),
      p_target_lead_id:
        input.targetLeadId === null ? null : providerId(input.targetLeadId) ?? invalid(),
      p_payload: payloadJson(input.payload),
    }),
  ) ?? invalid();
  const kind = row.kind;
  if (kind !== "prepared" && kind !== "replay") invalid();
  return Object.freeze({ kind, attempt: parseSnapshot(row.attempt) });
}

export async function readPlatformAmoCrmBindings(
  client: PlatformAmoCrmRpcClient,
  input: ReadPlatformAmoCrmBindingsInput,
): Promise<PlatformAmoCrmBindingsSnapshot> {
  return parseBindingsSnapshot(
    await rpc(client, "read_staff_amocrm_bindings", {
      p_organization_id: normalizedUuid(input.organizationId) ?? invalid(),
      p_authorization: workflowAuthorization(input.authorization),
      p_person_id: input.personId === null ? null : normalizedUuid(input.personId) ?? invalid(),
      p_lead_id: input.leadId === null ? null : normalizedUuid(input.leadId) ?? invalid(),
    }),
  );
}

export async function readPlatformBlockingAmoCrmCommand(
  client: PlatformAmoCrmRpcClient,
  input: ReadPlatformBlockingAmoCrmCommandInput,
): Promise<PlatformAmoCrmCommandSnapshot | null> {
  const data = await rpc(client, "read_staff_blocking_amocrm_command", {
    p_organization_id: normalizedUuid(input.organizationId) ?? invalid(),
    p_authorization: workflowAuthorization(input.authorization),
    p_person_id: input.personId === null ? null : normalizedUuid(input.personId) ?? invalid(),
    p_lead_id: input.leadId === null ? null : normalizedUuid(input.leadId) ?? invalid(),
  });
  return data === null ? null : parseSnapshot(data);
}

export async function claimPlatformAmoCrmCommand(
  client: PlatformAmoCrmRpcClient,
  input: ClaimPlatformAmoCrmCommandInput,
): Promise<
  Readonly<{
    kind: "claimed" | "replay" | "blocked";
    attempt: PlatformAmoCrmCommandSnapshot;
    reason: "dispatch_already_claimed" | null;
  }>
> {
  const row = record(
    await rpc(client, "claim_amocrm_command", {
      p_organization_id: normalizedUuid(input.organizationId) ?? invalid(),
      p_attempt_id: normalizedUuid(input.attemptId) ?? invalid(),
      p_request_id: normalizedUuid(input.requestId) ?? invalid(),
      p_worker_ref: safeText(input.workerRef, 200) ?? invalid(),
      p_visibility_timeout_seconds:
        integer(input.visibilityTimeoutSeconds, 1, 3600) ?? invalid(),
    }),
  ) ?? invalid();
  const kind = row.kind;
  const reason = row.reason;
  if (
    (kind !== "claimed" && kind !== "replay" && kind !== "blocked") ||
    (reason !== null && reason !== "dispatch_already_claimed")
  ) {
    invalid();
  }
  return Object.freeze({ kind, attempt: parseSnapshot(row.attempt), reason });
}

export async function finishPlatformAmoCrmCommand(
  client: PlatformAmoCrmRpcClient,
  input: FinishPlatformAmoCrmCommandInput,
): Promise<Readonly<{ kind: "settled" | "replay"; attempt: PlatformAmoCrmCommandSnapshot }>> {
  const row = record(
    await rpc(client, "finish_amocrm_command", {
      p_organization_id: normalizedUuid(input.organizationId) ?? invalid(),
      p_attempt_id: normalizedUuid(input.attemptId) ?? invalid(),
      p_request_id: normalizedUuid(input.requestId) ?? invalid(),
      p_outcome: input.outcome,
      p_provider_request_id:
        input.providerRequestId === null ? null : safeText(input.providerRequestId, 200) ?? invalid(),
      p_provider_http_status:
        input.providerHttpStatus === null ? null : integer(input.providerHttpStatus, 100, 599) ?? invalid(),
      p_provider_readback:
        input.providerReadback === null ? null : payloadJson(input.providerReadback),
      p_provider_responded_at:
        input.providerRespondedAt === null ? null : safeText(input.providerRespondedAt, 64) ?? invalid(),
      p_result_contact_id:
        input.resultContactId === null ? null : providerId(input.resultContactId) ?? invalid(),
      p_result_lead_id:
        input.resultLeadId === null ? null : providerId(input.resultLeadId) ?? invalid(),
      p_failure_code:
        input.failureCode === null ? null : safeText(input.failureCode, 64) ?? invalid(),
    }),
  ) ?? invalid();
  const kind = row.kind;
  if (kind !== "settled" && kind !== "replay") invalid();
  return Object.freeze({ kind, attempt: parseSnapshot(row.attempt) });
}

export async function reconcileUnknownPlatformAmoCrmCommand(
  client: PlatformAmoCrmRpcClient,
  input: ReconcileUnknownPlatformAmoCrmCommandInput,
): Promise<
  Readonly<{
    kind: "reconciled" | "unchanged" | "replay";
    attempt: PlatformAmoCrmCommandSnapshot;
  }>
> {
  const row = record(
    await rpc(client, "reconcile_unknown_amocrm_command", {
      p_organization_id: normalizedUuid(input.organizationId) ?? invalid(),
      p_attempt_id: normalizedUuid(input.attemptId) ?? invalid(),
      p_request_id: normalizedUuid(input.requestId) ?? invalid(),
      p_outcome: input.outcome,
      p_provider_readback:
        input.providerReadback === null ? null : payloadJson(input.providerReadback),
      p_provider_readback_at:
        input.providerReadbackAt === null ? null : safeText(input.providerReadbackAt, 64) ?? invalid(),
      p_provider_responded_at:
        input.providerRespondedAt === null ? null : safeText(input.providerRespondedAt, 64) ?? invalid(),
      p_result_contact_id:
        input.resultContactId === null ? null : providerId(input.resultContactId) ?? invalid(),
      p_result_lead_id:
        input.resultLeadId === null ? null : providerId(input.resultLeadId) ?? invalid(),
      p_failure_code:
        input.failureCode === null ? null : safeText(input.failureCode, 64) ?? invalid(),
    }),
  ) ?? invalid();
  const kind = row.kind;
  if (kind !== "reconciled" && kind !== "unchanged" && kind !== "replay") {
    invalid();
  }
  return Object.freeze({ kind, attempt: parseSnapshot(row.attempt) });
}

export async function readPlatformAmoCrmCommandForReconciliation(
  client: PlatformAmoCrmRpcClient,
  input: Readonly<{ organizationId: string; attemptId: string }>,
): Promise<
  Readonly<{
    attempt: PlatformAmoCrmCommandSnapshot;
    payload: Readonly<Record<string, unknown>>;
  }>
> {
  const organizationId = normalizedUuid(input.organizationId) ?? invalid();
  const attemptId = normalizedUuid(input.attemptId) ?? invalid();
  const row = record(
    await rpc(client, "read_amocrm_command_for_reconciliation", {
      p_organization_id: organizationId,
      p_attempt_id: attemptId,
    }),
  ) ?? invalid();
  const attempt = parseSnapshot(row);
  const payload = record(row.payload) ?? invalid();
  if (
    attempt.organizationId !== organizationId ||
    attempt.attemptId !== attemptId
  ) {
    invalid();
  }
  return Object.freeze({ attempt, payload });
}
