import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { AMOCRM_TASK_COMPLETE_TILL_MAX } from "../platform-amocrm-task-deadline.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  getPlatformSalesLead,
  type PlatformSalesLeadDetail,
} from "../platform-sales.ts";
import {
  getPlatformStudentCaseHandoffContext,
  type PlatformStudentCaseHandoffContext,
} from "../platform-student-handoff.ts";
import {
  CanonicalAmoCrmMutationError,
  CanonicalAmoCrmProviderError,
  type CanonicalAmoCrmCreateLeadInput,
  type CanonicalAmoCrmCustomField,
  type CanonicalAmoCrmLeadTaskInput,
  type CanonicalAmoCrmPreparedMutation,
  type CanonicalAmoCrmWriteProvider,
} from "./canonical-amocrm-provider.ts";
import {
  type CanonicalAmoCrmCommandRoutingSnapshot,
  type CanonicalAmoCrmResolvedRoleCommandRoute,
} from "./canonical-amocrm-discovery-service.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import {
  createPlatformSupabaseServiceClient,
} from "./platform-supabase-service-client.ts";
import { resolvePlatformAmoCrmRuntime } from "./platform-amocrm-runtime.ts";
import {
  claimPlatformAmoCrmCommand,
  finishPlatformAmoCrmCommand,
  preparePlatformAmoCrmCommand,
  readPlatformAmoCrmCommandForReconciliation,
  readPlatformAmoCrmBindings,
  reconcileUnknownPlatformAmoCrmCommand,
  releasePreparedPlatformAmoCrmCommand,
  type PlatformAmoCrmBindingsSnapshot,
  type PlatformAmoCrmCommandOperationName,
  type PlatformAmoCrmCommandSnapshot,
  type PlatformAmoCrmRpcClient,
  type PlatformAmoCrmWorkflowAuthorization,
} from "./platform-amocrm-command-rpc.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_NOTE_BYTES = 1_000;
const MAX_TASK_BYTES = 1_000;
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 300;

type PlatformAmoCrmActorRole = "admin" | "sales" | "admissions";
type PlatformAmoCrmWorkflowScope =
  | "sales_pre_handoff"
  | "admissions_post_handoff";

export type PlatformAmoCrmSyncStatus =
  | "accepted"
  | "rejected"
  | "unknown"
  | "blocked"
  | "error"
  | "request_conflict";

export type PlatformAmoCrmSyncStep = Readonly<{
  operationName: PlatformAmoCrmCommandOperationName;
  status: PlatformAmoCrmSyncStatus;
  reason: string;
  attemptId: string | null;
}>;

export type PlatformAmoCrmSyncResult = Readonly<{
  status: PlatformAmoCrmSyncStatus;
  reason: string;
  attemptId: string | null;
  steps: readonly PlatformAmoCrmSyncStep[];
}>;

export type ExecutePlatformAmoCrmSalesSyncInput = Readonly<{
  actor: ActivePlatformActor;
  actorRole: "admin" | "sales";
  leadId: string;
  baseRequestId: string;
  noteText: string;
  taskText: string;
  taskCompleteTill: number;
}>;

export type ExecutePlatformAmoCrmAdmissionsSyncInput = Readonly<{
  actor: ActivePlatformActor;
  actorRole: "admin" | "admissions";
  studentCaseId: string;
  baseRequestId: string;
  noteText: string;
  taskText: string;
  taskCompleteTill: number;
}>;

export type ReconcilePlatformAmoCrmSyncAttemptInput = Readonly<{
  actor: ActivePlatformActor;
  actorRole: PlatformAmoCrmActorRole;
  workflowScope: PlatformAmoCrmWorkflowScope;
  leadId: string;
  studentCaseId: string | null;
  attemptId: string;
}>;

export type ReleasePlatformAmoCrmPreparedAttemptInput =
  ReconcilePlatformAmoCrmSyncAttemptInput;

type PlatformAmoCrmProvider = Readonly<
  Pick<
    CanonicalAmoCrmWriteProvider,
    | "prepareCreateContact"
    | "prepareUpdateContact"
    | "prepareCreateLead"
    | "prepareUpdateLead"
    | "prepareLinkContactToLead"
    | "prepareUpdateLeadPipelineStatus"
    | "prepareUpdateLeadResponsibleUser"
    | "prepareCreateLeadNote"
    | "prepareCreateLeadTask"
    | "prepareUpdateLeadTags"
    | "getContactById"
    | "getLeadById"
    | "getLeadContactLinks"
    | "getLeadNoteById"
    | "getTaskById"
  >
>;

export type PlatformAmoCrmCommandServiceDependencies = Readonly<{
  resolveRuntime?: (
    input: Readonly<{
      organizationId: string;
      actorRole: PlatformAmoCrmActorRole;
      correlationId: string;
    }>,
  ) => Promise<Readonly<{
    provider: PlatformAmoCrmProvider;
    routing: CanonicalAmoCrmCommandRoutingSnapshot;
  }>>;
  createStaffRpcClient?: () => PlatformAmoCrmRpcClient | Promise<PlatformAmoCrmRpcClient>;
  createServiceRpcClient?: () => PlatformAmoCrmRpcClient | Promise<PlatformAmoCrmRpcClient>;
  getSalesLead?: typeof getPlatformSalesLead;
  getStudentCaseHandoffContext?: typeof getPlatformStudentCaseHandoffContext;
  readBindings?: typeof readPlatformAmoCrmBindings;
  prepareCommand?: typeof preparePlatformAmoCrmCommand;
  claimCommand?: typeof claimPlatformAmoCrmCommand;
  finishCommand?: typeof finishPlatformAmoCrmCommand;
  reconcileUnknown?: typeof reconcileUnknownPlatformAmoCrmCommand;
  releasePrepared?: typeof releasePreparedPlatformAmoCrmCommand;
  readAttemptForReconcile?: (
    client: PlatformAmoCrmRpcClient,
    input: Readonly<{
      organizationId: string;
      attemptId: string;
    }>,
  ) => Promise<
    Readonly<{
      attempt: PlatformAmoCrmCommandSnapshot;
      payload: Readonly<Record<string, unknown>>;
    }>
  >;
  now?: () => Date;
  workerRef?: () => string;
  visibilityTimeoutSeconds?: number;
}>;

type ResolvedDependencies = Readonly<{
  resolveRuntime: NonNullable<PlatformAmoCrmCommandServiceDependencies["resolveRuntime"]>;
  createStaffRpcClient: NonNullable<
    PlatformAmoCrmCommandServiceDependencies["createStaffRpcClient"]
  >;
  createServiceRpcClient: NonNullable<
    PlatformAmoCrmCommandServiceDependencies["createServiceRpcClient"]
  >;
  getSalesLead: NonNullable<PlatformAmoCrmCommandServiceDependencies["getSalesLead"]>;
  getStudentCaseHandoffContext: NonNullable<
    PlatformAmoCrmCommandServiceDependencies["getStudentCaseHandoffContext"]
  >;
  readBindings: NonNullable<PlatformAmoCrmCommandServiceDependencies["readBindings"]>;
  prepareCommand: NonNullable<PlatformAmoCrmCommandServiceDependencies["prepareCommand"]>;
  claimCommand: NonNullable<PlatformAmoCrmCommandServiceDependencies["claimCommand"]>;
  finishCommand: NonNullable<PlatformAmoCrmCommandServiceDependencies["finishCommand"]>;
  reconcileUnknown: NonNullable<PlatformAmoCrmCommandServiceDependencies["reconcileUnknown"]>;
  releasePrepared: NonNullable<PlatformAmoCrmCommandServiceDependencies["releasePrepared"]>;
  readAttemptForReconcile: NonNullable<
    PlatformAmoCrmCommandServiceDependencies["readAttemptForReconcile"]
  >;
  now: NonNullable<PlatformAmoCrmCommandServiceDependencies["now"]>;
  workerRef: NonNullable<PlatformAmoCrmCommandServiceDependencies["workerRef"]>;
  visibilityTimeoutSeconds: number;
}>;

type WorkflowContext = Readonly<{
  organizationId: string;
  personId: string;
  workflowLeadId: string;
  studentCaseId: string | null;
  authorization: PlatformAmoCrmWorkflowAuthorization;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

type OperationContext = WorkflowContext &
  Readonly<{
    provider: PlatformAmoCrmProvider;
    routing: CanonicalAmoCrmCommandRoutingSnapshot;
    route: CanonicalAmoCrmResolvedRoleCommandRoute;
    oppositeRoute: CanonicalAmoCrmResolvedRoleCommandRoute;
    noteText: string;
    taskText: string;
    taskCompleteTill: number;
  }>;

type StepExecutionState = Readonly<{
  providerContactId: string | null;
  providerLeadId: string | null;
}>;

type PreparedStep = Readonly<{
  operationName: PlatformAmoCrmCommandOperationName;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
  mutation: CanonicalAmoCrmPreparedMutation;
  targetContactId: string | null;
  targetLeadId: string | null;
  verify: (
    provider: PlatformAmoCrmProvider,
    entityId: string,
  ) => Promise<VerifiedReadback>;
}>;

type InternalStep = PlatformAmoCrmSyncStep &
  Readonly<{
    resultContactId: string | null;
    resultLeadId: string | null;
  }>;

type VerifiedReadback = Readonly<{
  evidence: Readonly<Record<string, unknown>>;
  resultContactId: string | null;
  resultLeadId: string | null;
}>;

class ReadbackMismatchError extends Error {
  constructor() {
    super("amoCRM readback mismatch");
    this.name = "ReadbackMismatchError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("invalid_uuid");
  }
  return value.toLowerCase();
}

function requiredProviderId(value: unknown): string {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof parsed !== "string" || !PROVIDER_ID_PATTERN.test(parsed)) {
    throw new ReadbackMismatchError();
  }
  return parsed;
}

function requiredText(value: unknown, maxBytes: number, errorCode: string): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throw new Error(errorCode);
  }
  return value;
}

function requiredFutureUnix(value: unknown, now: Date): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value > AMOCRM_TASK_COMPLETE_TILL_MAX ||
    value <= Math.floor(now.getTime() / 1_000)
  ) {
    throw new Error("invalid_task_complete_till");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReadbackMismatchError();
  }
  return value as Record<string, unknown>;
}

function collection(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new ReadbackMismatchError();
  return value;
}

function stepId(
  baseRequestId: string,
  operationName: PlatformAmoCrmCommandOperationName,
): string {
  return `${baseRequestId}:${operationName}`;
}

function publicStep(step: InternalStep): PlatformAmoCrmSyncStep {
  return Object.freeze({
    operationName: step.operationName,
    status: step.status,
    reason: step.reason,
    attemptId: step.attemptId,
  });
}

function internalStep(
  operationName: PlatformAmoCrmCommandOperationName,
  status: PlatformAmoCrmSyncStatus,
  reason: string,
  attemptId: string | null,
  resultContactId: string | null = null,
  resultLeadId: string | null = null,
): InternalStep {
  return Object.freeze({
    operationName,
    status,
    reason,
    attemptId,
    resultContactId,
    resultLeadId,
  });
}

function aggregate(steps: readonly InternalStep[]): PlatformAmoCrmSyncResult {
  const last = steps.at(-1);
  return Object.freeze({
    status: last?.status ?? "error",
    reason: last?.reason ?? "empty_flow",
    attemptId: last?.attemptId ?? null,
    steps: Object.freeze(steps.map(publicStep)),
  });
}

function replayStep(attempt: PlatformAmoCrmCommandSnapshot): InternalStep {
  if (attempt.status === "accepted") {
    return internalStep(
      attempt.operationName,
      "accepted",
      "exact_replay",
      attempt.attemptId,
      acceptedResultContactId(attempt),
      acceptedResultLeadId(attempt),
    );
  }
  if (attempt.status === "rejected") {
    return internalStep(
      attempt.operationName,
      "rejected",
      attempt.failureCode ?? "provider_rejected",
      attempt.attemptId,
    );
  }
  if (attempt.status === "unknown") {
    return internalStep(
      attempt.operationName,
      "unknown",
      attempt.failureCode ?? "provider_outcome_unresolved",
      attempt.attemptId,
    );
  }
  return internalStep(
    attempt.operationName,
    attempt.providerDispatchedAt === null ? "blocked" : "unknown",
    attempt.providerDispatchedAt === null
      ? "dispatch_not_started"
      : "dispatch_outcome_unresolved",
    attempt.attemptId,
  );
}

function acceptedResultContactId(attempt: PlatformAmoCrmCommandSnapshot): string | null {
  if (attempt.resultContactId !== null) return attempt.resultContactId;
  if (attempt.operationName === "contact_update") return attempt.targetContactId;
  if (attempt.operationName === "contact_lead_link") return attempt.targetContactId;
  return null;
}

function acceptedResultLeadId(attempt: PlatformAmoCrmCommandSnapshot): string | null {
  if (attempt.resultLeadId !== null) return attempt.resultLeadId;
  if (attempt.operationName === "lead_update") return attempt.targetLeadId;
  if (
    attempt.operationName === "contact_lead_link" ||
    attempt.operationName === "lead_pipeline_status_update" ||
    attempt.operationName === "lead_responsible_update" ||
    attempt.operationName === "lead_note_create" ||
    attempt.operationName === "lead_task_create" ||
    attempt.operationName === "lead_tag_update"
  ) {
    return attempt.targetLeadId;
  }
  return null;
}

async function defaultResolveRuntime(input: Readonly<{
  organizationId: string;
  actorRole: PlatformAmoCrmActorRole;
  correlationId: string;
}>): Promise<Readonly<{ provider: PlatformAmoCrmProvider; routing: CanonicalAmoCrmCommandRoutingSnapshot }>> {
  return resolvePlatformAmoCrmRuntime(input);
}

function resolveDependencies(
  overrides: PlatformAmoCrmCommandServiceDependencies,
): ResolvedDependencies {
  return Object.freeze({
    resolveRuntime: overrides.resolveRuntime ?? defaultResolveRuntime,
    createStaffRpcClient:
      overrides.createStaffRpcClient ??
      (async () => {
        const { createSupabaseServerClient } = await import("../supabase/server.ts");
        return (await createSupabaseServerClient()) as unknown as PlatformAmoCrmRpcClient;
      }),
    createServiceRpcClient:
      overrides.createServiceRpcClient ??
      (() =>
        createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig())),
    getSalesLead: overrides.getSalesLead ?? getPlatformSalesLead,
    getStudentCaseHandoffContext:
      overrides.getStudentCaseHandoffContext ?? getPlatformStudentCaseHandoffContext,
    readBindings: overrides.readBindings ?? readPlatformAmoCrmBindings,
    prepareCommand: overrides.prepareCommand ?? preparePlatformAmoCrmCommand,
    claimCommand: overrides.claimCommand ?? claimPlatformAmoCrmCommand,
    finishCommand: overrides.finishCommand ?? finishPlatformAmoCrmCommand,
    reconcileUnknown: overrides.reconcileUnknown ?? reconcileUnknownPlatformAmoCrmCommand,
    releasePrepared:
      overrides.releasePrepared ?? releasePreparedPlatformAmoCrmCommand,
    readAttemptForReconcile:
      overrides.readAttemptForReconcile ??
      readPlatformAmoCrmCommandForReconciliation,
    now: overrides.now ?? (() => new Date()),
    workerRef:
      overrides.workerRef ??
      (() => `platform-amocrm-command-service:${process.pid}:${randomUUID()}`),
    visibilityTimeoutSeconds:
      overrides.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
  });
}

function salesContext(
  actorRole: "admin" | "sales",
  lead: PlatformSalesLeadDetail,
): WorkflowContext {
  if (lead.clientId === null) {
    throw new Error("sales_client_unbound");
  }
  return Object.freeze({
    organizationId: lead.organizationId,
    personId: lead.clientId,
    workflowLeadId: lead.leadId,
    studentCaseId: null,
    authorization: Object.freeze({
      actorRole,
      workflowScope: "sales_pre_handoff",
      workflowLeadId: lead.leadId,
      studentCaseId: null,
    }),
    displayName: lead.clientDisplayName ?? `Lead ${lead.leadId}`,
    email: lead.clientEmail,
    phone: lead.clientPhone,
  });
}

function admissionsContext(
  actorRole: "admin" | "admissions",
  handoff: PlatformStudentCaseHandoffContext,
): WorkflowContext {
  return Object.freeze({
    organizationId: handoff.organizationId,
    personId: handoff.clientContext.clientId,
    workflowLeadId: handoff.leadId,
    studentCaseId: handoff.studentCaseId,
    authorization: Object.freeze({
      actorRole,
      workflowScope: "admissions_post_handoff",
      workflowLeadId: handoff.leadId,
      studentCaseId: handoff.studentCaseId,
    }),
    displayName: handoff.clientContext.displayName,
    email: null,
    phone: null,
  });
}

function routeFor(
  routing: CanonicalAmoCrmCommandRoutingSnapshot,
  workflowScope: PlatformAmoCrmWorkflowScope,
): Readonly<{
  route: CanonicalAmoCrmResolvedRoleCommandRoute;
  oppositeRoute: CanonicalAmoCrmResolvedRoleCommandRoute;
}> {
  if (workflowScope === "sales_pre_handoff") {
    return Object.freeze({
      route: routing.sales,
      oppositeRoute: routing.admissions,
    });
  }
  return Object.freeze({
    route: routing.admissions,
    oppositeRoute: routing.sales,
  });
}

function exactPayload(
  routing: CanonicalAmoCrmCommandRoutingSnapshot,
  mutation: CanonicalAmoCrmPreparedMutation,
  expectedReadback: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    mapping_evidence: Object.freeze({
      discovery_version_id: routing.discoverySnapshotId,
      provider_account_id: routing.providerAccountId,
      snapshot_sha256: routing.snapshotSha256,
    }),
    request: mutation.request,
    request_sha256: mutation.requestSha256,
    body_json: mutation.bodyJson,
    body_sha256: mutation.bodySha256,
    expected_readback: expectedReadback,
  });
}

function customFieldValue(
  fieldId: string,
  value: string | null,
): readonly CanonicalAmoCrmCustomField[] | undefined {
  if (value === null) return undefined;
  return Object.freeze([
    Object.freeze({
      fieldId,
      values: Object.freeze([Object.freeze({ value })]),
    }),
  ]);
}

function mergeCustomFields(
  ...fieldSets: readonly (readonly CanonicalAmoCrmCustomField[] | undefined)[]
): readonly CanonicalAmoCrmCustomField[] | undefined {
  const merged = fieldSets.flatMap((entry) => entry ?? []);
  return merged.length === 0 ? undefined : Object.freeze(merged);
}

function contactReadback(
  value: unknown,
  expected: Readonly<{
    contactId: string;
    name: string;
    phone: string | null;
    email: string | null;
    phoneFieldId: string;
    emailFieldId: string;
  }>,
): VerifiedReadback {
  const response = record(value);
  if (
    requiredProviderId(response.id) !== expected.contactId ||
    response.name !== expected.name ||
    (expected.phone !== null &&
      !customFieldHasValue(response, expected.phoneFieldId, expected.phone)) ||
    (expected.email !== null &&
      !customFieldHasValue(response, expected.emailFieldId, expected.email))
  ) {
    throw new ReadbackMismatchError();
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "contact",
      entity_id: expected.contactId,
      name_sha256: sha256(expected.name),
      phone_sha256: expected.phone === null ? null : sha256(expected.phone),
      email_sha256: expected.email === null ? null : sha256(expected.email),
    }),
    resultContactId: expected.contactId,
    resultLeadId: null,
  });
}

function customFieldHasValue(
  response: Record<string, unknown>,
  fieldId: string,
  expected: string,
): boolean {
  return collection(response.custom_fields_values ?? []).some((fieldValue) => {
    const field = record(fieldValue);
    if (requiredProviderId(field.field_id) !== fieldId) return false;
    return collection(field.values).some((entryValue) => {
      const entry = record(entryValue);
      return entry.value === expected;
    });
  });
}

function leadReadback(
  value: unknown,
  expected: Readonly<{
    leadId: string;
    name?: string;
    pipelineId?: string;
    statusId?: string;
    responsibleUserId?: string;
    tagName?: string;
    oppositeTagName?: string;
  }>,
): VerifiedReadback {
  const response = record(value);
  if (requiredProviderId(response.id) !== expected.leadId) {
    throw new ReadbackMismatchError();
  }
  if (expected.name !== undefined && response.name !== expected.name) {
    throw new ReadbackMismatchError();
  }
  if (
    expected.pipelineId !== undefined &&
    requiredProviderId(response.pipeline_id) !== expected.pipelineId
  ) {
    throw new ReadbackMismatchError();
  }
  if (
    expected.statusId !== undefined &&
    requiredProviderId(response.status_id) !== expected.statusId
  ) {
    throw new ReadbackMismatchError();
  }
  if (
    expected.responsibleUserId !== undefined &&
    requiredProviderId(response.responsible_user_id) !== expected.responsibleUserId
  ) {
    throw new ReadbackMismatchError();
  }
  if (expected.tagName !== undefined || expected.oppositeTagName !== undefined) {
    const tags = collection(record(response._embedded ?? {}).tags ?? []);
    const names = tags.map((tag) => {
      const row = record(tag);
      if (typeof row.name !== "string") throw new ReadbackMismatchError();
      return row.name;
    });
    if (
      expected.tagName !== undefined &&
      names.filter((name) => name === expected.tagName).length !== 1
    ) {
      throw new ReadbackMismatchError();
    }
    if (
      expected.oppositeTagName !== undefined &&
      names.some((name) => name === expected.oppositeTagName)
    ) {
      throw new ReadbackMismatchError();
    }
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead",
      entity_id: expected.leadId,
      name_sha256:
        expected.name === undefined ? null : sha256(expected.name),
      pipeline_id: expected.pipelineId ?? null,
      status_id: expected.statusId ?? null,
      responsible_user_id: expected.responsibleUserId ?? null,
      tag_name: expected.tagName ?? null,
    }),
    resultContactId: null,
    resultLeadId: expected.leadId,
  });
}

function linkReadback(
  value: unknown,
  expectedLeadId: string,
  expectedContactId: string,
): VerifiedReadback {
  const links = collection(record(record(value)._embedded).links);
  const matched = links.filter((entry) => {
    const link = record(entry);
    const metadata = record(link.metadata ?? {});
    return (
      link.to_entity_type === "contacts" &&
      metadata.main_contact === true &&
      requiredProviderId(link.to_entity_id) === expectedContactId
    );
  });
  if (matched.length !== 1) throw new ReadbackMismatchError();
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead_contact_link",
      lead_id: expectedLeadId,
      contact_id: expectedContactId,
      main_contact: true,
    }),
    resultContactId: expectedContactId,
    resultLeadId: expectedLeadId,
  });
}

function noteReadback(
  value: unknown,
  expectedLeadId: string,
  expectedNoteId: string,
  expectedText: string,
): VerifiedReadback {
  const response = record(value);
  if (
    requiredProviderId(response.id) !== expectedNoteId ||
    response.note_type !== "common" ||
    record(response.params ?? {}).text !== expectedText
  ) {
    throw new ReadbackMismatchError();
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead_note",
      entity_id: expectedNoteId,
      lead_id: expectedLeadId,
      text_sha256: sha256(expectedText),
    }),
    resultContactId: null,
    resultLeadId: expectedLeadId,
  });
}

function taskReadback(
  value: unknown,
  expectedLeadId: string,
  expectedTaskId: string,
  expectedTask: Readonly<{ text: string; completeTill: number }>,
): VerifiedReadback {
  const response = record(value);
  if (
    requiredProviderId(response.id) !== expectedTaskId ||
    response.entity_type !== "leads" ||
    requiredProviderId(response.entity_id) !== expectedLeadId ||
    response.text !== expectedTask.text ||
    response.complete_till !== expectedTask.completeTill
  ) {
    throw new ReadbackMismatchError();
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead_task",
      entity_id: expectedTaskId,
      lead_id: expectedLeadId,
      text_sha256: sha256(expectedTask.text),
      complete_till: expectedTask.completeTill,
    }),
    resultContactId: null,
    resultLeadId: expectedLeadId,
  });
}

function acceptedStepFor(
  operationName: PlatformAmoCrmCommandOperationName,
  attemptId: string,
  verified: VerifiedReadback,
  reason = "accepted",
): InternalStep {
  return internalStep(
    operationName,
    "accepted",
    reason,
    attemptId,
    verified.resultContactId,
    verified.resultLeadId,
  );
}

async function prepareStep(
  context: OperationContext,
  state: StepExecutionState,
  baseRequestId: string,
  operationName: PlatformAmoCrmCommandOperationName,
): Promise<PreparedStep> {
  const requestId = stepId(baseRequestId, operationName);
  const contactId = state.providerContactId;
  const leadId = state.providerLeadId;

  if (operationName === "contact_create") {
    const mutation = context.provider.prepareCreateContact({
      requestId,
      name: context.displayName,
      customFieldsValues: mergeCustomFields(
        customFieldValue(context.routing.contactCustomFields.phoneFieldId, context.phone),
        customFieldValue(context.routing.contactCustomFields.emailFieldId, context.email),
      ),
    });
    const expected = Object.freeze({
      contact_id: null,
      name: context.displayName,
      phone: context.phone,
      email: context.email,
      phone_field_id: context.routing.contactCustomFields.phoneFieldId,
      email_field_id: context.routing.contactCustomFields.emailFieldId,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: null,
      verify: async (provider, entityId) =>
        contactReadback(await provider.getContactById(entityId), {
          contactId: entityId,
          name: context.displayName,
          phone: context.phone,
          email: context.email,
          phoneFieldId: context.routing.contactCustomFields.phoneFieldId,
          emailFieldId: context.routing.contactCustomFields.emailFieldId,
        }),
    });
  }

  if (operationName === "contact_update") {
    if (contactId === null) throw new Error("missing_contact_binding");
    const mutation = context.provider.prepareUpdateContact({
      requestId,
      contactId,
      name: context.displayName,
      customFieldsValues: mergeCustomFields(
        customFieldValue(context.routing.contactCustomFields.phoneFieldId, context.phone),
        customFieldValue(context.routing.contactCustomFields.emailFieldId, context.email),
      ),
    });
    const expected = Object.freeze({
      contact_id: contactId,
      name: context.displayName,
      phone: context.phone,
      email: context.email,
      phone_field_id: context.routing.contactCustomFields.phoneFieldId,
      email_field_id: context.routing.contactCustomFields.emailFieldId,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: contactId,
      targetLeadId: null,
      verify: async (provider, entityId) =>
        contactReadback(await provider.getContactById(entityId), {
          contactId,
          name: context.displayName,
          phone: context.phone,
          email: context.email,
          phoneFieldId: context.routing.contactCustomFields.phoneFieldId,
          emailFieldId: context.routing.contactCustomFields.emailFieldId,
        }),
    });
  }

  if (operationName === "lead_create") {
    const leadInput: CanonicalAmoCrmCreateLeadInput = {
      requestId,
      name: context.displayName,
      pipelineId: context.route.pipelineId,
      statusId: context.route.statusId,
      responsibleUserId: context.route.responsibleUserId,
    };
    const mutation = context.provider.prepareCreateLead(leadInput);
    const expected = Object.freeze({
      lead_id: null,
      name: context.displayName,
      pipeline_id: context.route.pipelineId,
      status_id: context.route.statusId,
      responsible_user_id: context.route.responsibleUserId,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: null,
      verify: async (provider, entityId) =>
        leadReadback(await provider.getLeadById(entityId), {
          leadId: entityId,
          name: context.displayName,
        }),
    });
  }

  if (operationName === "lead_update") {
    if (leadId === null) throw new Error("missing_lead_binding");
    const mutation = context.provider.prepareUpdateLead({
      requestId,
      leadId,
      name: context.displayName,
    });
    const expected = Object.freeze({
      lead_id: leadId,
      name: context.displayName,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: leadId,
      verify: async (provider) =>
        leadReadback(await provider.getLeadById(leadId), {
          leadId,
          name: context.displayName,
        }),
    });
  }

  if (operationName === "contact_lead_link") {
    if (contactId === null || leadId === null) {
      throw new Error("missing_link_binding");
    }
    const mutation = context.provider.prepareLinkContactToLead({
      requestId,
      contactId,
      leadId,
    });
    const expected = Object.freeze({
      lead_id: leadId,
      contact_id: contactId,
      main_contact: true,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: contactId,
      targetLeadId: leadId,
      verify: async (provider) =>
        linkReadback(
          await provider.getLeadContactLinks(leadId, contactId),
          leadId,
          contactId,
        ),
    });
  }

  if (leadId === null) throw new Error("missing_lead_binding");

  if (operationName === "lead_pipeline_status_update") {
    const mutation = context.provider.prepareUpdateLeadPipelineStatus({
      requestId,
      leadId,
      pipelineId: context.route.pipelineId,
      statusId: context.route.statusId,
    });
    const expected = Object.freeze({
      lead_id: leadId,
      pipeline_id: context.route.pipelineId,
      status_id: context.route.statusId,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: leadId,
      verify: async (provider) =>
        leadReadback(await provider.getLeadById(leadId), {
          leadId,
          pipelineId: context.route.pipelineId,
          statusId: context.route.statusId,
        }),
    });
  }

  if (operationName === "lead_responsible_update") {
    const mutation = context.provider.prepareUpdateLeadResponsibleUser({
      requestId,
      leadId,
      responsibleUserId: context.route.responsibleUserId,
    });
    const expected = Object.freeze({
      lead_id: leadId,
      responsible_user_id: context.route.responsibleUserId,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: leadId,
      verify: async (provider) =>
        leadReadback(await provider.getLeadById(leadId), {
          leadId,
          responsibleUserId: context.route.responsibleUserId,
        }),
    });
  }

  if (operationName === "lead_note_create") {
    const mutation = context.provider.prepareCreateLeadNote({
      requestId,
      leadId,
      text: context.noteText,
    });
    const expected = Object.freeze({
      lead_id: leadId,
      text_sha256: sha256(context.noteText),
      text: context.noteText,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: leadId,
      verify: async (provider, entityId) =>
        noteReadback(
          await provider.getLeadNoteById(leadId, entityId),
          leadId,
          entityId,
          context.noteText,
        ),
    });
  }

  if (operationName === "lead_task_create") {
    const taskInput: CanonicalAmoCrmLeadTaskInput = Object.freeze({
      requestId,
      leadId,
      text: context.taskText,
      completeTill: context.taskCompleteTill,
      responsibleUserId: context.route.responsibleUserId,
    });
    const mutation = context.provider.prepareCreateLeadTask(taskInput);
    const expected = Object.freeze({
      lead_id: leadId,
      text: context.taskText,
      complete_till: context.taskCompleteTill,
    });
    return Object.freeze({
      operationName,
      idempotencyKey: requestId,
      payload: exactPayload(context.routing, mutation, expected),
      mutation,
      targetContactId: null,
      targetLeadId: leadId,
      verify: async (provider, entityId) =>
        taskReadback(
          await provider.getTaskById(leadId, entityId),
          leadId,
          entityId,
          Object.freeze({
            text: context.taskText,
            completeTill: context.taskCompleteTill,
          }),
        ),
    });
  }

  const mutation = context.provider.prepareUpdateLeadTags({
    requestId,
    leadId,
    add: Object.freeze([
      context.route.tagId === null
        ? Object.freeze({ name: context.route.tagName })
        : Object.freeze({ id: context.route.tagId }),
    ]),
  });
  const expected = Object.freeze({
    lead_id: leadId,
    tag_name: context.route.tagName,
    opposite_tag_name: context.oppositeRoute.tagName,
  });
  return Object.freeze({
    operationName: "lead_tag_update",
    idempotencyKey: requestId,
    payload: exactPayload(context.routing, mutation, expected),
    mutation,
    targetContactId: null,
    targetLeadId: leadId,
    verify: async (provider) =>
      leadReadback(await provider.getLeadById(leadId), {
        leadId,
        tagName: context.route.tagName,
        oppositeTagName: context.oppositeRoute.tagName,
      }),
  });
}

async function verifyPreparedStep(
  prepared: PreparedStep,
  provider: PlatformAmoCrmProvider,
  entityId: string,
): Promise<VerifiedReadback> {
  return await prepared.verify(provider, entityId);
}


function mutationOutcome(error: unknown): "accepted" | "unknown" | "rejected" {
  if (error instanceof ReadbackMismatchError) return "unknown";
  if (error instanceof CanonicalAmoCrmMutationError) return error.outcome;
  if (error instanceof CanonicalAmoCrmProviderError) return "unknown";
  return "unknown";
}

function providerFailureCode(error: unknown): string {
  if (error instanceof ReadbackMismatchError) return "provider_readback_mismatch";
  if (error instanceof CanonicalAmoCrmProviderError) return error.code;
  return "internal_error";
}

function operationSequence(
  bindings: PlatformAmoCrmBindingsSnapshot,
  workflowScope: PlatformAmoCrmWorkflowScope,
): readonly PlatformAmoCrmCommandOperationName[] {
  if (workflowScope === "admissions_post_handoff") {
    if (bindings.contactId === null) {
      throw new Error("provider_contact_mapping_missing");
    }
    if (bindings.leadId === null) {
      throw new Error("provider_lead_mapping_missing");
    }
  }

  return Object.freeze([
    bindings.contactId === null ? "contact_create" : "contact_update",
    bindings.leadId === null ? "lead_create" : "lead_update",
    "contact_lead_link",
    "lead_pipeline_status_update",
    "lead_responsible_update",
    "lead_note_create",
    "lead_task_create",
    "lead_tag_update",
  ]);
}

function canonicalTargetsForOperation(
  context: WorkflowContext,
  operationName: PlatformAmoCrmCommandOperationName,
): Readonly<{ personId: string | null; leadId: string | null }> {
  if (operationName === "contact_create" || operationName === "contact_update") {
    return Object.freeze({ personId: context.personId, leadId: null });
  }
  if (operationName === "contact_lead_link") {
    return Object.freeze({
      personId: context.personId,
      leadId: context.workflowLeadId,
    });
  }
  return Object.freeze({ personId: null, leadId: context.workflowLeadId });
}

function nextStateFromStep(
  state: StepExecutionState,
  step: InternalStep,
): StepExecutionState {
  return Object.freeze({
    providerContactId: step.resultContactId ?? state.providerContactId,
    providerLeadId: step.resultLeadId ?? state.providerLeadId,
  });
}

async function executeSequence(
  input: Readonly<{
    context: OperationContext;
    baseRequestId: string;
    bindings: PlatformAmoCrmBindingsSnapshot;
  }>,
  dependencies: ResolvedDependencies,
): Promise<PlatformAmoCrmSyncResult> {
  const staffClient = await dependencies.createStaffRpcClient();
  const serviceClient = await dependencies.createServiceRpcClient();
  const steps: InternalStep[] = [];
  let state: StepExecutionState = Object.freeze({
    providerContactId: input.bindings.contactId,
    providerLeadId: input.bindings.leadId,
  });

  for (const operationName of operationSequence(
    input.bindings,
    input.context.authorization.workflowScope,
  )) {
    const prepared = await prepareStep(
      input.context,
      state,
      input.baseRequestId,
      operationName,
    );
    const canonicalTargets = canonicalTargetsForOperation(
      input.context,
      operationName,
    );
    const preparedResult = await dependencies.prepareCommand(staffClient, {
      organizationId: input.context.organizationId,
      authorization: input.context.authorization,
      personId: canonicalTargets.personId,
      leadId: canonicalTargets.leadId,
      operationName,
      idempotencyKey: prepared.idempotencyKey,
      targetContactId: prepared.targetContactId,
      targetLeadId: prepared.targetLeadId,
      payload: prepared.payload,
    });
    if (preparedResult.kind === "replay") {
      const replayed = replayStep(preparedResult.attempt);
      steps.push(replayed);
      state = nextStateFromStep(state, replayed);
      if (replayed.status !== "accepted") return aggregate(steps);
      continue;
    }
    const claimed = await dependencies.claimCommand(serviceClient, {
      organizationId: input.context.organizationId,
      attemptId: preparedResult.attempt.attemptId,
      requestId: input.baseRequestId,
      workerRef: dependencies.workerRef(),
      visibilityTimeoutSeconds: dependencies.visibilityTimeoutSeconds,
    });
    if (claimed.kind !== "claimed") {
      const replayed = replayStep(claimed.attempt);
      steps.push(replayed);
      state = nextStateFromStep(state, replayed);
      return aggregate(steps);
    }
    let mutationResponse: Readonly<{
      status: number;
      providerRequestId: string | null;
    }> | null = null;
    try {
      const mutation = await prepared.mutation.dispatch();
      mutationResponse = mutation.response;
      const verified = await verifyPreparedStep(
        prepared,
        input.context.provider,
        mutation.entityId,
      );
      const settled = await dependencies.finishCommand(serviceClient, {
        organizationId: input.context.organizationId,
        attemptId: claimed.attempt.attemptId,
        requestId: input.baseRequestId,
        outcome: "accepted",
        providerRequestId: mutation.response.providerRequestId,
        providerHttpStatus: mutation.response.status,
        providerReadback: verified.evidence,
        providerRespondedAt: dependencies.now().toISOString(),
        resultContactId: verified.resultContactId,
        resultLeadId: verified.resultLeadId,
        failureCode: null,
      });
      const accepted = acceptedStepFor(
        operationName,
        settled.attempt.attemptId,
        verified,
        settled.kind === "replay" ? "exact_replay" : "accepted",
      );
      steps.push(accepted);
      state = nextStateFromStep(state, accepted);
    } catch (error) {
      const providerResponse =
        error instanceof CanonicalAmoCrmMutationError ? error.response : null;
      const respondedAt =
        mutationResponse !== null || providerResponse !== null
          ? dependencies.now().toISOString()
          : null;
      const settled = await dependencies.finishCommand(serviceClient, {
        organizationId: input.context.organizationId,
        attemptId: claimed.attempt.attemptId,
        requestId: input.baseRequestId,
        outcome: mutationOutcome(error),
        providerRequestId:
          providerResponse?.providerRequestId ??
          mutationResponse?.providerRequestId ??
          null,
        providerHttpStatus:
          providerResponse?.status ?? mutationResponse?.status ?? null,
        providerReadback: null,
        providerRespondedAt: respondedAt,
        resultContactId: null,
        resultLeadId: null,
        failureCode: providerFailureCode(error),
      });
      steps.push(replayStep(settled.attempt));
      return aggregate(steps);
    }
  }

  return aggregate(steps);
}

async function resolveSalesContext(
  input: ExecutePlatformAmoCrmSalesSyncInput,
  dependencies: ResolvedDependencies,
): Promise<OperationContext> {
  const leadId = requiredUuid(input.leadId);
  const lead = await dependencies.getSalesLead(input.actor, leadId);
  if (lead === null) throw new Error("sales_lead_unavailable");
  const noteText = requiredText(input.noteText, MAX_NOTE_BYTES, "invalid_note_text");
  const taskText = requiredText(input.taskText, MAX_TASK_BYTES, "invalid_task_text");
  const taskCompleteTill = requiredFutureUnix(input.taskCompleteTill, dependencies.now());
  const baseContext = salesContext(input.actorRole, lead);
  const runtime = await dependencies.resolveRuntime({
    organizationId: baseContext.organizationId,
    actorRole: input.actorRole,
    correlationId: input.baseRequestId,
  });
  const route = routeFor(runtime.routing, "sales_pre_handoff");
  return Object.freeze({
    ...baseContext,
    provider: runtime.provider,
    routing: runtime.routing,
    route: route.route,
    oppositeRoute: route.oppositeRoute,
    noteText,
    taskText,
    taskCompleteTill,
  });
}

async function resolveAdmissionsContext(
  input: ExecutePlatformAmoCrmAdmissionsSyncInput,
  dependencies: ResolvedDependencies,
): Promise<OperationContext> {
  const studentCaseId = requiredUuid(input.studentCaseId);
  const handoff = await dependencies.getStudentCaseHandoffContext(
    input.actor,
    studentCaseId,
  );
  if (handoff === null) throw new Error("student_case_handoff_unavailable");
  const noteText = requiredText(input.noteText, MAX_NOTE_BYTES, "invalid_note_text");
  const taskText = requiredText(input.taskText, MAX_TASK_BYTES, "invalid_task_text");
  const taskCompleteTill = requiredFutureUnix(input.taskCompleteTill, dependencies.now());
  const baseContext = admissionsContext(input.actorRole, handoff);
  const runtime = await dependencies.resolveRuntime({
    organizationId: baseContext.organizationId,
    actorRole: input.actorRole,
    correlationId: input.baseRequestId,
  });
  const route = routeFor(runtime.routing, "admissions_post_handoff");
  return Object.freeze({
    ...baseContext,
    provider: runtime.provider,
    routing: runtime.routing,
    route: route.route,
    oppositeRoute: route.oppositeRoute,
    noteText,
    taskText,
    taskCompleteTill,
  });
}

function errorResult(reason: string): PlatformAmoCrmSyncResult {
  const status: PlatformAmoCrmSyncStatus =
    reason === "sales_lead_unavailable" ||
    reason === "student_case_handoff_unavailable" ||
    reason.startsWith("provider_")
      ? "blocked"
      : reason === "request_conflict"
        ? "request_conflict"
        : "error";
  return Object.freeze({
    status,
    reason,
    attemptId: null,
    steps: Object.freeze([]),
  });
}

export async function executePlatformAmoCrmSalesSync(
  input: ExecutePlatformAmoCrmSalesSyncInput,
  dependencyOverrides: PlatformAmoCrmCommandServiceDependencies = {},
): Promise<PlatformAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  try {
    const context = await resolveSalesContext(input, dependencies);
    const staffClient = await dependencies.createStaffRpcClient();
    const bindings = await dependencies.readBindings(staffClient, {
      organizationId: context.organizationId,
      authorization: context.authorization,
      personId: context.personId,
      leadId: context.workflowLeadId,
    });
    return await executeSequence(
      {
        context,
        baseRequestId: requiredUuid(input.baseRequestId),
        bindings,
      },
      dependencies,
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "amocrm_service_unavailable");
  }
}

export async function executePlatformAmoCrmAdmissionsSync(
  input: ExecutePlatformAmoCrmAdmissionsSyncInput,
  dependencyOverrides: PlatformAmoCrmCommandServiceDependencies = {},
): Promise<PlatformAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  try {
    const context = await resolveAdmissionsContext(input, dependencies);
    const staffClient = await dependencies.createStaffRpcClient();
    const bindings = await dependencies.readBindings(staffClient, {
      organizationId: context.organizationId,
      authorization: context.authorization,
      personId: context.personId,
      leadId: context.workflowLeadId,
    });
    return await executeSequence(
      {
        context,
        baseRequestId: requiredUuid(input.baseRequestId),
        bindings,
      },
      dependencies,
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "amocrm_service_unavailable");
  }
}

function supportedAutomaticReconcile(
  attempt: PlatformAmoCrmCommandSnapshot,
): boolean {
  if (attempt.status !== "unknown") return true;
  return (
    attempt.operationName === "contact_update" ||
    attempt.operationName === "lead_update" ||
    attempt.operationName === "contact_lead_link" ||
    attempt.operationName === "lead_pipeline_status_update" ||
    attempt.operationName === "lead_responsible_update" ||
    attempt.operationName === "lead_tag_update"
  );
}

function requiredExpectedText(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  if (typeof value[key] !== "string") throw new ReadbackMismatchError();
  return value[key] as string;
}

function optionalExpectedText(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const entry = value[key];
  if (entry === null || entry === undefined) return null;
  if (typeof entry !== "string") throw new ReadbackMismatchError();
  return entry;
}

async function reconcileVerifiedReadback(
  attempt: PlatformAmoCrmCommandSnapshot,
  expectedReadback: Readonly<Record<string, unknown>>,
  context: OperationContext,
): Promise<VerifiedReadback> {
  if (attempt.operationName === "contact_update") {
    const contactId = attempt.targetContactId ?? (() => { throw new ReadbackMismatchError(); })();
    return contactReadback(await context.provider.getContactById(contactId), {
      contactId,
      name: requiredExpectedText(expectedReadback, "name"),
      phone: optionalExpectedText(expectedReadback, "phone"),
      email: optionalExpectedText(expectedReadback, "email"),
      phoneFieldId: requiredExpectedText(expectedReadback, "phone_field_id"),
      emailFieldId: requiredExpectedText(expectedReadback, "email_field_id"),
    });
  }
  if (attempt.operationName === "lead_update") {
    const leadId = attempt.targetLeadId ?? (() => { throw new ReadbackMismatchError(); })();
    return leadReadback(await context.provider.getLeadById(leadId), {
      leadId,
      name: requiredExpectedText(expectedReadback, "name"),
    });
  }
  if (attempt.operationName === "contact_lead_link") {
    const leadId = attempt.targetLeadId ?? (() => { throw new ReadbackMismatchError(); })();
    const contactId = attempt.targetContactId ?? (() => { throw new ReadbackMismatchError(); })();
    return linkReadback(
      await context.provider.getLeadContactLinks(leadId, contactId),
      leadId,
      contactId,
    );
  }
  if (attempt.operationName === "lead_pipeline_status_update") {
    const leadId = attempt.targetLeadId ?? (() => { throw new ReadbackMismatchError(); })();
    return leadReadback(await context.provider.getLeadById(leadId), {
      leadId,
      pipelineId: requiredExpectedText(expectedReadback, "pipeline_id"),
      statusId: requiredExpectedText(expectedReadback, "status_id"),
    });
  }
  if (attempt.operationName === "lead_responsible_update") {
    const leadId = attempt.targetLeadId ?? (() => { throw new ReadbackMismatchError(); })();
    return leadReadback(await context.provider.getLeadById(leadId), {
      leadId,
      responsibleUserId: requiredExpectedText(expectedReadback, "responsible_user_id"),
    });
  }
  const leadId = attempt.targetLeadId ?? (() => { throw new ReadbackMismatchError(); })();
  return leadReadback(await context.provider.getLeadById(leadId), {
    leadId,
    tagName: requiredExpectedText(expectedReadback, "tag_name"),
    oppositeTagName: requiredExpectedText(expectedReadback, "opposite_tag_name"),
  });
}

async function resolveAuthorizedAttemptWorkflowContext(
  input: ReconcilePlatformAmoCrmSyncAttemptInput,
  dependencies: ResolvedDependencies,
): Promise<WorkflowContext> {
  const leadId = requiredUuid(input.leadId);
  const context =
    input.workflowScope === "sales_pre_handoff"
      ? await (async () => {
          if (input.actorRole !== "admin" && input.actorRole !== "sales") {
            throw new Error("forbidden_role");
          }
          const lead = await dependencies.getSalesLead(input.actor, leadId);
          if (lead === null) throw new Error("sales_lead_unavailable");
          return salesContext(input.actorRole, lead);
        })()
      : await (async () => {
          if (input.actorRole !== "admin" && input.actorRole !== "admissions") {
            throw new Error("forbidden_role");
          }
          const studentCaseId = requiredUuid(input.studentCaseId);
          const handoff = await dependencies.getStudentCaseHandoffContext(
            input.actor,
            studentCaseId,
          );
          if (handoff === null) throw new Error("student_case_handoff_unavailable");
          return admissionsContext(input.actorRole, handoff);
        })();
  if (context.workflowLeadId !== leadId) {
    throw new Error("amocrm_reconciliation_context_mismatch");
  }
  return context;
}

function assertAttemptWorkflowContext(
  attempt: PlatformAmoCrmCommandSnapshot,
  context: WorkflowContext,
): void {
  const canonicalTargets = canonicalTargetsForOperation(
    context,
    attempt.operationName,
  );
  if (
    attempt.organizationId !== context.organizationId ||
    attempt.workflowScope !== context.authorization.workflowScope ||
    attempt.workflowLeadId !== context.workflowLeadId ||
    attempt.studentCaseId !== context.studentCaseId ||
    attempt.personId !== canonicalTargets.personId ||
    attempt.leadId !== canonicalTargets.leadId
  ) {
    throw new Error("amocrm_reconciliation_context_mismatch");
  }
}

export async function reconcilePlatformAmoCrmSyncAttempt(
  input: ReconcilePlatformAmoCrmSyncAttemptInput,
  dependencyOverrides: PlatformAmoCrmCommandServiceDependencies = {},
): Promise<PlatformAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  try {
    const attemptId = requiredUuid(input.attemptId);
    const baseContext = await resolveAuthorizedAttemptWorkflowContext(
      input,
      dependencies,
    );
    const serviceClient = await dependencies.createServiceRpcClient();
    const { attempt, payload } = await dependencies.readAttemptForReconcile(
      serviceClient,
      {
        organizationId: baseContext.organizationId,
        attemptId,
      },
    );
    assertAttemptWorkflowContext(attempt, baseContext);
    if (attempt.status !== "unknown") {
      return aggregate([replayStep(attempt)]);
    }
    if (!supportedAutomaticReconcile(attempt)) {
      const settled = await dependencies.reconcileUnknown(serviceClient, {
        organizationId: baseContext.organizationId,
        attemptId,
        requestId: attemptId,
        outcome: "unchanged",
        providerReadback: null,
        providerReadbackAt: null,
        providerRespondedAt: null,
        resultContactId: null,
        resultLeadId: null,
        failureCode: "manual_reconciliation_required",
      });
      return aggregate([replayStep(settled.attempt)]);
    }
    const runtime = await dependencies.resolveRuntime({
      organizationId: baseContext.organizationId,
      actorRole: input.actorRole,
      correlationId: attemptId,
    });
    const route = routeFor(runtime.routing, input.workflowScope);
    const context = Object.freeze({
      ...baseContext,
      provider: runtime.provider,
      routing: runtime.routing,
      route: route.route,
      oppositeRoute: route.oppositeRoute,
      noteText: "",
      taskText: "",
      taskCompleteTill: Math.floor(dependencies.now().getTime() / 1_000) + 60,
    } satisfies OperationContext);
    const staffClient = await dependencies.createStaffRpcClient();
    await dependencies.readBindings(staffClient, {
      organizationId: context.organizationId,
      authorization: context.authorization,
      personId: context.personId,
      leadId: context.workflowLeadId,
    });
    const expectedReadback = record(payload.expected_readback ?? {});
    const verified = await reconcileVerifiedReadback(
      attempt,
      expectedReadback,
      context,
    );
    const reconciledAt = dependencies.now().toISOString();
    const reconciled = await dependencies.reconcileUnknown(serviceClient, {
      organizationId: context.organizationId,
      attemptId,
      requestId: attemptId,
      outcome: "accepted",
      providerReadback: verified.evidence,
      providerReadbackAt: reconciledAt,
      providerRespondedAt: reconciledAt,
      resultContactId: verified.resultContactId,
      resultLeadId: verified.resultLeadId,
      failureCode: null,
    });
    return aggregate([
      acceptedStepFor(
        reconciled.attempt.operationName,
        reconciled.attempt.attemptId,
        verified,
        reconciled.kind === "replay" ? "exact_replay" : "accepted",
      ),
    ]);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "amocrm_service_unavailable");
  }
}

export async function releasePlatformAmoCrmPreparedAttempt(
  input: ReleasePlatformAmoCrmPreparedAttemptInput,
  dependencyOverrides: PlatformAmoCrmCommandServiceDependencies = {},
): Promise<PlatformAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  try {
    const attemptId = requiredUuid(input.attemptId);
    const context = await resolveAuthorizedAttemptWorkflowContext(
      input,
      dependencies,
    );
    const staffClient = await dependencies.createStaffRpcClient();
    const released = await dependencies.releasePrepared(staffClient, {
      organizationId: context.organizationId,
      authorization: context.authorization,
      personId: context.personId,
      leadId: context.workflowLeadId,
      attemptId,
      requestId: attemptId,
    });
    assertAttemptWorkflowContext(released.attempt, context);
    return aggregate([replayStep(released.attempt)]);
  } catch (error) {
    return errorResult(
      error instanceof Error ? error.message : "amocrm_service_unavailable",
    );
  }
}
