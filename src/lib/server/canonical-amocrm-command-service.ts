import "server-only";

import { createHash } from "node:crypto";

import type { EvoAmoCrmOperationName } from "../../db/schema/index.ts";
import type { FixedRole } from "../fixed-role-policy.ts";
import {
  claimCanonicalAmoCrmCommandDispatch,
  CanonicalAmoCrmCommandRepositoryError,
  prepareCanonicalAmoCrmCommand,
  readBlockingCanonicalAmoCrmCommand,
  readCanonicalAmoCrmBindings,
  readCanonicalAmoCrmCommand,
  readCanonicalAmoCrmCommandByIdempotencyKey,
  reconcileUnknownCanonicalAmoCrmCommand,
  settleCanonicalAmoCrmCommand,
  type CanonicalAmoCrmCommandSnapshot,
  type CanonicalAmoCrmWorkflowAuthorization,
  type ReconcileUnknownCanonicalAmoCrmCommandOutcome,
  type SettleCanonicalAmoCrmCommandOutcome,
} from "./canonical-amocrm-command-repository.ts";
import {
  loadCanonicalAmoCrmCommandConfig,
  type CanonicalAmoCrmCommandConfig,
  type CanonicalAmoCrmRoleCommandRoute,
} from "./canonical-amocrm-command-config.ts";
import {
  discoverCanonicalAmoCrmCommandRouting,
  type CanonicalAmoCrmCommandRoutingSnapshot,
  type DiscoverCanonicalAmoCrmCommandRoutingInput,
} from "./canonical-amocrm-discovery-service.ts";
import {
  CanonicalAmoCrmMutationError,
  CanonicalAmoCrmProviderError,
  createCanonicalAmoCrmReadProvider,
  createCanonicalAmoCrmWriteProvider,
  type CanonicalAmoCrmPreparedMutation,
  type CanonicalAmoCrmReadProvider,
  type CanonicalAmoCrmWriteProvider,
} from "./canonical-amocrm-provider.ts";
import {
  CanonicalAmoCrmConfigurationError,
  loadCanonicalAmoCrmProviderConfig,
  type CanonicalAmoCrmProviderConfig,
} from "./canonical-amocrm-provider-config.ts";
import {
  getCanonicalLeadSnapshot,
  getCanonicalStudentCaseHandoffSnapshot,
  type CanonicalLeadSnapshot,
  type CanonicalStudentCaseHandoffSnapshot,
} from "./canonical-crm-repository.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,9}$/u;
const MAX_NOTE_BYTES = 1_000;

type ReadyProviderConfig = Extract<
  CanonicalAmoCrmProviderConfig,
  Readonly<{ status: "ready" }>
>;

export type CanonicalAmoCrmSyncStatus =
  | "accepted"
  | "rejected"
  | "unknown"
  | "blocked"
  | "error"
  | "request_conflict";

export type CanonicalAmoCrmSyncStep = Readonly<{
  operationName: EvoAmoCrmOperationName;
  status: CanonicalAmoCrmSyncStatus;
  reason: string;
  attemptId: string | null;
}>;

export type CanonicalAmoCrmSyncResult = Readonly<{
  status: CanonicalAmoCrmSyncStatus;
  reason: string;
  attemptId: string | null;
  steps: readonly CanonicalAmoCrmSyncStep[];
}>;

export type ExecuteCanonicalAmoCrmSalesSyncInput = Readonly<{
  actorRole: "admin" | "sales";
  leadId: string;
  baseRequestId: string;
  noteText: string;
}>;

export type ExecuteCanonicalAmoCrmAdmissionsSyncInput = Readonly<{
  actorRole: "admin" | "admissions";
  studentCaseId: string;
  baseRequestId: string;
  noteText: string;
}>;

export type ReconcileCanonicalAmoCrmSyncAttemptInput = Readonly<{
  actorRole: FixedRole;
  workflowScope: "sales_pre_handoff" | "admissions_post_handoff";
  leadId: string;
  studentCaseId: string | null;
  attemptId: string;
}>;

type PrepareCommand = typeof prepareCanonicalAmoCrmCommand;
type ClaimDispatch = typeof claimCanonicalAmoCrmCommandDispatch;
type SettleCommand = typeof settleCanonicalAmoCrmCommand;
type ReadCommand = typeof readCanonicalAmoCrmCommand;
type ReconcileUnknown = typeof reconcileUnknownCanonicalAmoCrmCommand;
type ReadCommandByIdempotencyKey = (
  idempotencyKey: string,
  authorization: CanonicalAmoCrmWorkflowAuthorization,
) => Promise<CanonicalAmoCrmCommandSnapshot | null>;

export type CanonicalAmoCrmCommandServiceDependencies = Readonly<{
  loadProviderConfig?: () => CanonicalAmoCrmProviderConfig;
  loadCommandConfig?: () => CanonicalAmoCrmCommandConfig;
  createReadProvider?: (config: ReadyProviderConfig) => CanonicalAmoCrmReadProvider;
  createWriteProvider?: (config: ReadyProviderConfig) => CanonicalAmoCrmWriteProvider;
  discoverRouting?: (
    input: DiscoverCanonicalAmoCrmCommandRoutingInput,
  ) => Promise<CanonicalAmoCrmCommandRoutingSnapshot>;
  getLeadSnapshot?: typeof getCanonicalLeadSnapshot;
  getStudentCaseHandoffSnapshot?: typeof getCanonicalStudentCaseHandoffSnapshot;
  readBlockingCommand?: typeof readBlockingCanonicalAmoCrmCommand;
  readBindings?: typeof readCanonicalAmoCrmBindings;
  prepareCommand?: PrepareCommand;
  claimDispatch?: ClaimDispatch;
  settleCommand?: SettleCommand;
  readCommand?: ReadCommand;
  readCommandByIdempotencyKey?: ReadCommandByIdempotencyKey;
  reconcileUnknown?: ReconcileUnknown;
  now?: () => Date;
}>;

type ResolvedDependencies = Required<CanonicalAmoCrmCommandServiceDependencies>;

type ExpectedEffect = Readonly<Record<string, string | null>>;

type InternalStep = CanonicalAmoCrmSyncStep &
  Readonly<{
    resultContactId: string | null;
    resultLeadId: string | null;
  }>;

type StepExecutionInput = Readonly<{
  accountId: string;
  discoverySnapshotId: string;
  operationName: EvoAmoCrmOperationName;
  personId: string | null;
  leadId: string | null;
  actorRole: "admin" | "sales" | "admissions";
  authorization: CanonicalAmoCrmWorkflowAuthorization;
  targetContactId: string | null;
  targetLeadId: string | null;
  correlationId: string;
  idempotencyKey: string;
  prepared: CanonicalAmoCrmPreparedMutation;
  expected: ExpectedEffect;
  verify: (
    provider: CanonicalAmoCrmWriteProvider,
    mutationEntityId: string,
  ) => Promise<VerifiedReadback>;
}>;

type VerifiedReadback = Readonly<{
  evidence: Readonly<Record<string, unknown>>;
  providerUpdatedAt: string | null;
}>;

type FlowContext = Readonly<{
  dependencies: ResolvedDependencies;
  provider: CanonicalAmoCrmWriteProvider;
  routing: CanonicalAmoCrmCommandRoutingSnapshot;
  actorRole: "admin" | "sales" | "admissions";
  authorization: CanonicalAmoCrmWorkflowAuthorization;
  personId: string;
  leadId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  route: CanonicalAmoCrmCommandRoutingSnapshot["sales"];
  oppositeTag: Readonly<{
    tagId: string | null;
    tagName: string;
  }>;
  baseRequestId: string;
  noteText: string;
}>;

class ReadbackMismatchError extends Error {
  constructor() {
    super("readback_mismatch");
    this.name = "ReadbackMismatchError";
  }
}

function resolveDependencies(
  overrides: CanonicalAmoCrmCommandServiceDependencies = {},
): ResolvedDependencies {
  return Object.freeze({
    loadProviderConfig:
      overrides.loadProviderConfig ?? (() => loadCanonicalAmoCrmProviderConfig()),
    loadCommandConfig:
      overrides.loadCommandConfig ?? (() => loadCanonicalAmoCrmCommandConfig()),
    createReadProvider:
      overrides.createReadProvider ?? createCanonicalAmoCrmReadProvider,
    createWriteProvider:
      overrides.createWriteProvider ?? createCanonicalAmoCrmWriteProvider,
    discoverRouting:
      overrides.discoverRouting ?? discoverCanonicalAmoCrmCommandRouting,
    getLeadSnapshot: overrides.getLeadSnapshot ?? getCanonicalLeadSnapshot,
    getStudentCaseHandoffSnapshot:
      overrides.getStudentCaseHandoffSnapshot ??
      getCanonicalStudentCaseHandoffSnapshot,
    readBlockingCommand:
      overrides.readBlockingCommand ?? readBlockingCanonicalAmoCrmCommand,
    readBindings: overrides.readBindings ?? readCanonicalAmoCrmBindings,
    prepareCommand: overrides.prepareCommand ?? prepareCanonicalAmoCrmCommand,
    claimDispatch:
      overrides.claimDispatch ?? claimCanonicalAmoCrmCommandDispatch,
    settleCommand: overrides.settleCommand ?? settleCanonicalAmoCrmCommand,
    readCommand: overrides.readCommand ?? readCanonicalAmoCrmCommand,
    readCommandByIdempotencyKey:
      overrides.readCommandByIdempotencyKey ??
      readCanonicalAmoCrmCommandByIdempotencyKey,
    reconcileUnknown:
      overrides.reconcileUnknown ?? reconcileUnknownCanonicalAmoCrmCommand,
    now: overrides.now ?? (() => new Date()),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function valueHash(value: string): string {
  return sha256(value);
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("invalid_uuid");
  }
  return value;
}

function noteText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_NOTE_BYTES
  ) {
    throw new Error("invalid_note_text");
  }
  return value;
}

function actorRole(
  value: unknown,
  allowed: readonly ("admin" | "sales" | "admissions")[],
): "admin" | "sales" | "admissions" {
  if (!allowed.includes(value as "admin" | "sales" | "admissions")) {
    throw new Error("forbidden_role");
  }
  return value as "admin" | "sales" | "admissions";
}

function stepId(baseRequestId: string, operationName: EvoAmoCrmOperationName): string {
  return `${baseRequestId}:${operationName}`;
}

function providerId(value: unknown): string {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof parsed !== "string" || !PROVIDER_ID_PATTERN.test(parsed)) {
    throw new ReadbackMismatchError();
  }
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReadbackMismatchError();
  }
  return value as Record<string, unknown>;
}

function collection(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new ReadbackMismatchError();
  }
  return value;
}

function optionalProviderUpdatedAt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const milliseconds =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value * 1_000
      : Number.NaN;
  if (!Number.isFinite(milliseconds)) throw new ReadbackMismatchError();
  return new Date(milliseconds).toISOString();
}

function customFieldHasValue(
  response: Record<string, unknown>,
  fieldId: string,
  expected: string,
): boolean {
  const fields = collection(response.custom_fields_values ?? []);
  return fields.some((fieldValue) => {
    const field = record(fieldValue);
    if (providerId(field.field_id) !== fieldId) return false;
    return collection(field.values).some((entryValue) => {
      const entry = record(entryValue);
      return typeof entry.value === "string" && entry.value === expected;
    });
  });
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
    providerId(response.id) !== expected.contactId ||
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
      entityId: expected.contactId,
      nameSha256: valueHash(expected.name),
      phoneSha256: expected.phone === null ? null : valueHash(expected.phone),
      emailSha256: expected.email === null ? null : valueHash(expected.email),
    }),
    providerUpdatedAt: optionalProviderUpdatedAt(response.updated_at),
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
    tagId?: string | null;
    tagName?: string;
    oppositeTagId?: string | null;
    oppositeTagName?: string;
    unrelatedTagSetSha256?: string;
  }>,
): VerifiedReadback {
  const response = record(value);
  if (providerId(response.id) !== expected.leadId) {
    throw new ReadbackMismatchError();
  }
  if (expected.name !== undefined && response.name !== expected.name) {
    throw new ReadbackMismatchError();
  }
  if (
    expected.pipelineId !== undefined &&
    providerId(response.pipeline_id) !== expected.pipelineId
  ) {
    throw new ReadbackMismatchError();
  }
  if (
    expected.statusId !== undefined &&
    providerId(response.status_id) !== expected.statusId
  ) {
    throw new ReadbackMismatchError();
  }
  if (
    expected.responsibleUserId !== undefined &&
    providerId(response.responsible_user_id) !== expected.responsibleUserId
  ) {
    throw new ReadbackMismatchError();
  }
  let verifiedRoleTagId: string | null = null;
  if (
    expected.tagId !== undefined ||
    expected.tagName !== undefined ||
    expected.oppositeTagId !== undefined ||
    expected.oppositeTagName !== undefined ||
    expected.unrelatedTagSetSha256 !== undefined
  ) {
    if (
      expected.tagId === undefined ||
      expected.tagName === undefined ||
      expected.oppositeTagId === undefined ||
      expected.oppositeTagName === undefined ||
      expected.unrelatedTagSetSha256 === undefined
    ) {
      throw new ReadbackMismatchError();
    }
    const embedded = record(response._embedded ?? {});
    const tags = collection(embedded.tags ?? []);
    const roleTags = tags.filter((value) => {
      const tag = record(value);
      return typeof tag.name === "string" && tag.name === expected.tagName;
    });
    if (
      expected.tagName === expected.oppositeTagName ||
      (expected.tagId !== null &&
        expected.oppositeTagId !== null &&
        expected.tagId === expected.oppositeTagId) ||
      roleTags.length !== 1 ||
      (expected.tagId !== null &&
        providerId(record(roleTags[0]).id) !== expected.tagId) ||
      tags.some((value) => {
        const tag = record(value);
        return (
          tag.name === expected.oppositeTagName ||
          (expected.oppositeTagId !== null &&
            providerId(tag.id) === expected.oppositeTagId)
        );
      }) ||
      unrelatedTagSetSha256(
        response,
        expected.leadId,
        expected.tagId,
        valueHash(expected.tagName),
        expected.oppositeTagId,
        valueHash(expected.oppositeTagName),
      ) !== expected.unrelatedTagSetSha256
    ) {
      throw new ReadbackMismatchError();
    }
    verifiedRoleTagId = providerId(record(roleTags[0]).id);
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead",
      entityId: expected.leadId,
      ...(expected.name === undefined
        ? {}
        : { nameSha256: valueHash(expected.name) }),
      ...(expected.pipelineId === undefined
        ? {}
        : { pipelineId: expected.pipelineId }),
      ...(expected.statusId === undefined ? {} : { statusId: expected.statusId }),
      ...(expected.responsibleUserId === undefined
        ? {}
        : { responsibleUserId: expected.responsibleUserId }),
      ...(expected.tagName === undefined ||
          expected.tagId === undefined ||
          expected.oppositeTagId === undefined ||
          expected.oppositeTagName === undefined ||
          expected.unrelatedTagSetSha256 === undefined
        ? {}
        : {
            tagId: verifiedRoleTagId,
            tagNameSha256: valueHash(expected.tagName),
            oppositeTagId: expected.oppositeTagId,
            oppositeTagNameSha256: valueHash(expected.oppositeTagName),
            unrelatedTagSetSha256: expected.unrelatedTagSetSha256,
          }),
    }),
    providerUpdatedAt: optionalProviderUpdatedAt(response.updated_at),
  });
}

function unrelatedTagSetSha256(
  value: unknown,
  leadId: string,
  roleTagId: string | null,
  roleTagNameSha256: string,
  oppositeTagId: string | null,
  oppositeTagNameSha256: string,
): string {
  const response = record(value);
  if (
    providerId(response.id) !== leadId ||
    roleTagNameSha256 === oppositeTagNameSha256 ||
    (roleTagId !== null &&
      oppositeTagId !== null &&
      roleTagId === oppositeTagId)
  ) {
    throw new ReadbackMismatchError();
  }
  const embedded = record(response._embedded ?? {});
  const seen = new Set<string>();
  const unrelated = collection(embedded.tags ?? [])
    .map((tagValue) => {
      const tag = record(tagValue);
      const id = providerId(tag.id);
      if (seen.has(id) || typeof tag.name !== "string" || tag.name.length === 0) {
        throw new ReadbackMismatchError();
      }
      seen.add(id);
      return Object.freeze({ id, nameSha256: valueHash(tag.name) });
    })
    .filter(
      ({ id, nameSha256 }) =>
        id !== roleTagId &&
        id !== oppositeTagId &&
        nameSha256 !== roleTagNameSha256 &&
        nameSha256 !== oppositeTagNameSha256,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return valueHash(JSON.stringify(unrelated));
}

function mainContactLinkExists(value: unknown, contactId: string): boolean {
  const response = record(value);
  const embedded = record(response._embedded);
  const mainContacts = collection(embedded.links).filter((linkValue) => {
    const link = record(linkValue);
    const metadata = link.metadata;
    return (
      link.to_entity_type === "contacts" &&
      typeof metadata === "object" &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).main_contact === true
    );
  });
  return (
    mainContacts.length === 1 &&
    providerId(record(mainContacts[0]).to_entity_id) === contactId
  );
}

function linkReadback(
  value: unknown,
  leadId: string,
  contactId: string,
): VerifiedReadback {
  if (!mainContactLinkExists(value, contactId)) throw new ReadbackMismatchError();
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead_contact_link",
      leadId,
      contactId,
      mainContact: true,
    }),
    providerUpdatedAt: null,
  });
}

function noteReadback(
  value: unknown,
  leadId: string,
  noteId: string,
  expectedText: string,
): VerifiedReadback {
  const response = record(value);
  const params = record(response.params ?? {});
  if (
    providerId(response.id) !== noteId ||
    providerId(response.entity_id) !== leadId ||
    params.text !== expectedText
  ) {
    throw new ReadbackMismatchError();
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "lead_note",
      entityId: noteId,
      leadId,
      textSha256: valueHash(expectedText),
    }),
    providerUpdatedAt: optionalProviderUpdatedAt(response.updated_at),
  });
}

function publicStep(step: InternalStep): CanonicalAmoCrmSyncStep {
  return Object.freeze({
    operationName: step.operationName,
    status: step.status,
    reason: step.reason,
    attemptId: step.attemptId,
  });
}

function internalStep(
  operationName: EvoAmoCrmOperationName,
  status: CanonicalAmoCrmSyncStatus,
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

function aggregate(
  status: CanonicalAmoCrmSyncStatus,
  reason: string,
  steps: readonly CanonicalAmoCrmSyncStep[],
): CanonicalAmoCrmSyncResult {
  return Object.freeze({
    status,
    reason,
    attemptId: steps.at(-1)?.attemptId ?? null,
    steps: Object.freeze([...steps]),
  });
}

function terminalAggregate(steps: readonly InternalStep[]): CanonicalAmoCrmSyncResult {
  const terminal = steps.at(-1);
  if (!terminal) return aggregate("error", "empty_sync", []);
  return aggregate(
    terminal.status,
    terminal.reason,
    steps.map(publicStep),
  );
}

function repositoryErrorCode(error: unknown): string | null {
  if (error instanceof CanonicalAmoCrmCommandRepositoryError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name ===
      "CanonicalAmoCrmCommandRepositoryError" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

function replayStep(attempt: CanonicalAmoCrmCommandSnapshot): InternalStep {
  if (attempt.status === "accepted") {
    return internalStep(
      attempt.operationName,
      "accepted",
      "exact_replay",
      attempt.attemptId,
      attempt.resultContactId,
      attempt.resultLeadId,
    );
  }
  if (attempt.status === "prepared") {
    return internalStep(
      attempt.operationName,
      attempt.providerDispatchedAt === null ? "blocked" : "unknown",
      attempt.providerDispatchedAt === null
        ? "dispatch_not_started"
        : "dispatch_outcome_unresolved",
      attempt.attemptId,
    );
  }
  return internalStep(
    attempt.operationName,
    attempt.status,
    attempt.failureCode ?? `stored_${attempt.status}`,
    attempt.attemptId,
    attempt.resultContactId,
    attempt.resultLeadId,
  );
}

function acceptedResultIds(
  input: StepExecutionInput,
  mutationEntityId: string,
): Readonly<{ resultContactId: string | null; resultLeadId: string | null }> {
  if (input.operationName === "contact_create") {
    return Object.freeze({ resultContactId: mutationEntityId, resultLeadId: null });
  }
  if (input.operationName === "contact_update") {
    return Object.freeze({
      resultContactId: input.targetContactId,
      resultLeadId: null,
    });
  }
  if (input.operationName === "lead_create") {
    return Object.freeze({ resultContactId: null, resultLeadId: mutationEntityId });
  }
  if (input.operationName === "contact_lead_link") {
    return Object.freeze({
      resultContactId: input.targetContactId,
      resultLeadId: input.targetLeadId,
    });
  }
  return Object.freeze({ resultContactId: null, resultLeadId: input.targetLeadId });
}

function responseTime(
  dependencies: ResolvedDependencies,
  notBefore: string | null = null,
): string {
  const value = dependencies.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("invalid_clock");
  }
  if (notBefore === null) return value.toISOString();
  const floor = new Date(notBefore);
  if (!Number.isFinite(floor.getTime())) throw new Error("invalid_clock");
  // PostgreSQL retains sub-millisecond precision that is lost when the
  // dispatch snapshot crosses the JavaScript ISO boundary. Advancing the
  // serialized floor by one millisecond guarantees the provider outcome is
  // never stored before the real database dispatch instant.
  return new Date(Math.max(value.getTime(), floor.getTime() + 1)).toISOString();
}

async function settleProviderFailure(
  input: StepExecutionInput,
  attemptId: string,
  providerDispatchedAt: string | null,
  error: unknown,
  dependencies: ResolvedDependencies,
): Promise<InternalStep> {
  const mutationError =
    error instanceof CanonicalAmoCrmMutationError ? error : null;
  const status =
    mutationError?.outcome === "rejected" && mutationError.response !== null
      ? "rejected"
      : "unknown";
  const failureCode =
    error instanceof CanonicalAmoCrmProviderError
      ? error.code
      : error instanceof Error && error.message === "readback_mismatch"
        ? "readback_mismatch"
        : "provider_result_unknown";
  const occurredAt = responseTime(dependencies, providerDispatchedAt);
  const outcome: SettleCanonicalAmoCrmCommandOutcome =
    status === "rejected"
      ? Object.freeze({
          status: "rejected" as const,
          providerHttpStatus: mutationError!.response!.status,
          providerRequestId: mutationError!.response!.providerRequestId,
          providerRespondedAt: occurredAt,
          failureCode,
        })
      : Object.freeze({
          status: "unknown" as const,
          ...(mutationError?.response === null || mutationError?.response === undefined
            ? {}
            : {
                providerHttpStatus: mutationError.response.status,
                providerRequestId: mutationError.response.providerRequestId,
                providerRespondedAt: occurredAt,
              }),
          failureCode,
        });
  const settled = await dependencies.settleCommand(
    attemptId,
    input.authorization,
    outcome,
  );
  return replayStep(settled.attempt);
}

async function executePreparedStep(
  rawInput: StepExecutionInput,
  dependencies: ResolvedDependencies,
  provider: CanonicalAmoCrmWriteProvider,
): Promise<InternalStep | Readonly<{ status: "binding_conflict" }>> {
  const input = Object.freeze({ ...rawInput });
  const providerRequestMetadata = Object.freeze({
    version: 1,
    request: input.prepared.request,
    bodySha256: input.prepared.bodySha256,
    expected: input.expected,
    discoverySnapshotId: input.discoverySnapshotId,
  });
  let preparedResult: Awaited<ReturnType<PrepareCommand>>;
  try {
    preparedResult = await dependencies.prepareCommand({
      accountId: input.accountId,
      operationName: input.operationName,
      personId: input.personId,
      leadId: input.leadId,
      actorRole: input.actorRole,
      authorization: input.authorization,
      targetContactId: input.targetContactId,
      targetLeadId: input.targetLeadId,
      providerRequestMetadata,
      providerRequestSha256: input.prepared.requestSha256,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    const code = repositoryErrorCode(error);
    if (code === "binding_conflict") return Object.freeze({ status: "binding_conflict" });
    return internalStep(
      input.operationName,
      code === "idempotency_conflict" ? "request_conflict" : code === "forbidden" ? "blocked" : "error",
      code ?? "command_prepare_failed",
      null,
    );
  }

  if (preparedResult.attempt.status !== "prepared") {
    return replayStep(preparedResult.attempt);
  }

  let claim: Awaited<ReturnType<ClaimDispatch>>;
  try {
    claim = await dependencies.claimDispatch(
      preparedResult.attempt.attemptId,
      input.authorization,
    );
  } catch (error) {
    const code = repositoryErrorCode(error);
    return internalStep(
      input.operationName,
      code === "forbidden" ? "blocked" : "error",
      code ?? "dispatch_claim_failed",
      preparedResult.attempt.attemptId,
    );
  }
  if (claim.kind === "blocked") {
    return internalStep(
      input.operationName,
      claim.reason === "dispatch_already_claimed" ? "unknown" : "blocked",
      claim.reason,
      claim.attempt.attemptId,
    );
  }
  if (claim.attempt.status !== "prepared") return replayStep(claim.attempt);

  let mutation;
  try {
    mutation = await input.prepared.dispatch();
  } catch (error) {
    try {
      return await settleProviderFailure(
        input,
        claim.attempt.attemptId,
        claim.attempt.providerDispatchedAt,
        error,
        dependencies,
      );
    } catch (settlementError) {
      return internalStep(
        input.operationName,
        "unknown",
        repositoryErrorCode(settlementError) ??
          "provider_outcome_persistence_unresolved",
        claim.attempt.attemptId,
      );
    }
  }

  let verified: VerifiedReadback;
  try {
    verified = await input.verify(provider, mutation.entityId);
  } catch (error) {
    try {
      const occurredAt = responseTime(
        dependencies,
        claim.attempt.providerDispatchedAt,
      );
      const settled = await dependencies.settleCommand(
        claim.attempt.attemptId,
        input.authorization,
        {
          status: "unknown",
          providerHttpStatus: mutation.response.status,
          providerRequestId: mutation.response.providerRequestId,
          providerRespondedAt: occurredAt,
          failureCode:
            error instanceof ReadbackMismatchError
              ? "readback_mismatch"
              : "provider_readback_failed",
        },
      );
      return replayStep(settled.attempt);
    } catch (settlementError) {
      return internalStep(
        input.operationName,
        "unknown",
        repositoryErrorCode(settlementError) ??
          "provider_outcome_persistence_unresolved",
        claim.attempt.attemptId,
      );
    }
  }

  const occurredAt = responseTime(
    dependencies,
    claim.attempt.providerDispatchedAt,
  );
  const ids = acceptedResultIds(input, mutation.entityId);
  try {
    const settled = await dependencies.settleCommand(
      claim.attempt.attemptId,
      input.authorization,
      {
        status: "accepted",
        providerHttpStatus: mutation.response.status,
        providerRequestId: mutation.response.providerRequestId,
        providerRespondedAt: occurredAt,
        providerReadback: verified.evidence,
        providerReadbackAt: occurredAt,
        resultContactId: ids.resultContactId,
        resultLeadId: ids.resultLeadId,
        providerUpdatedAt: verified.providerUpdatedAt,
      },
    );
    return replayStep(settled.attempt);
  } catch (error) {
    return internalStep(
      input.operationName,
      "unknown",
      repositoryErrorCode(error) ??
        "provider_outcome_persistence_unresolved",
      claim.attempt.attemptId,
    );
  }
}

function contactFields(context: FlowContext) {
  return Object.freeze(
    [
      context.phone === null
        ? null
        : Object.freeze({
            fieldId: context.routing.contactCustomFields.phoneFieldId,
            values: Object.freeze([Object.freeze({ value: context.phone, enumCode: "WORK" })]),
          }),
      context.email === null
        ? null
        : Object.freeze({
            fieldId: context.routing.contactCustomFields.emailFieldId,
            values: Object.freeze([Object.freeze({ value: context.email, enumCode: "WORK" })]),
          }),
    ].filter((value) => value !== null),
  );
}

function contactExpected(context: FlowContext): ExpectedEffect {
  return Object.freeze({
    entity: "contact",
    nameSha256: valueHash(context.displayName),
    phoneSha256: context.phone === null ? null : valueHash(context.phone),
    emailSha256: context.email === null ? null : valueHash(context.email),
    phoneFieldId: context.routing.contactCustomFields.phoneFieldId,
    emailFieldId: context.routing.contactCustomFields.emailFieldId,
  });
}

async function executeContactUpsert(context: FlowContext): Promise<InternalStep> {
  const createId = stepId(context.baseRequestId, "contact_create");
  const createPrepared = context.provider.prepareCreateContact({
    requestId: createId,
    name: context.displayName,
    customFieldsValues: contactFields(context),
  });
  const created = await executePreparedStep(
    {
      accountId: context.routing.canonicalAccountId,
      discoverySnapshotId: context.routing.discoverySnapshotId,
      operationName: "contact_create",
      personId: context.personId,
      leadId: null,
      actorRole: context.actorRole,
      authorization: context.authorization,
      targetContactId: null,
      targetLeadId: null,
      correlationId: context.baseRequestId,
      idempotencyKey: createId,
      prepared: createPrepared,
      expected: contactExpected(context),
      verify: async (provider, entityId) =>
        contactReadback(await provider.getContactById(entityId), {
          contactId: entityId,
          name: context.displayName,
          phone: context.phone,
          email: context.email,
          phoneFieldId: context.routing.contactCustomFields.phoneFieldId,
          emailFieldId: context.routing.contactCustomFields.emailFieldId,
        }),
    },
    context.dependencies,
    context.provider,
  );
  if ("operationName" in created) return created;

  const bindings = await context.dependencies.readBindings({
    accountId: context.routing.canonicalAccountId,
    authorization: context.authorization,
    personId: context.personId,
    leadId: context.leadId,
  });
  if (bindings.contactId === null) {
    return internalStep("contact_update", "blocked", "contact_binding_missing", null);
  }
  const updateId = stepId(context.baseRequestId, "contact_update");
  const updatePrepared = context.provider.prepareUpdateContact({
    requestId: updateId,
    contactId: bindings.contactId,
    name: context.displayName,
    customFieldsValues: contactFields(context),
  });
  const updated = await executePreparedStep(
    {
      accountId: context.routing.canonicalAccountId,
      discoverySnapshotId: context.routing.discoverySnapshotId,
      operationName: "contact_update",
      personId: context.personId,
      leadId: null,
      actorRole: context.actorRole,
      authorization: context.authorization,
      targetContactId: bindings.contactId,
      targetLeadId: null,
      correlationId: context.baseRequestId,
      idempotencyKey: updateId,
      prepared: updatePrepared,
      expected: Object.freeze({
        ...contactExpected(context),
        contactId: bindings.contactId,
      }),
      verify: async (provider) =>
        contactReadback(await provider.getContactById(bindings.contactId as string), {
          contactId: bindings.contactId as string,
          name: context.displayName,
          phone: context.phone,
          email: context.email,
          phoneFieldId: context.routing.contactCustomFields.phoneFieldId,
          emailFieldId: context.routing.contactCustomFields.emailFieldId,
        }),
    },
    context.dependencies,
    context.provider,
  );
  return "operationName" in updated
    ? updated
    : internalStep("contact_update", "error", "unexpected_binding_conflict", null);
}

function leadExpected(context: FlowContext): ExpectedEffect {
  return Object.freeze({
    entity: "lead",
    nameSha256: valueHash(context.displayName),
  });
}

async function executeLeadUpsert(context: FlowContext): Promise<InternalStep> {
  const createId = stepId(context.baseRequestId, "lead_create");
  const createPrepared = context.provider.prepareCreateLead({
    requestId: createId,
    name: context.displayName,
    pipelineId: context.route.pipelineId,
    statusId: context.route.statusId,
    responsibleUserId: context.route.responsibleUserId,
  });
  const created = await executePreparedStep(
    {
      accountId: context.routing.canonicalAccountId,
      discoverySnapshotId: context.routing.discoverySnapshotId,
      operationName: "lead_create",
      personId: null,
      leadId: context.leadId,
      actorRole: context.actorRole,
      authorization: context.authorization,
      targetContactId: null,
      targetLeadId: null,
      correlationId: context.baseRequestId,
      idempotencyKey: createId,
      prepared: createPrepared,
      expected: Object.freeze({
        ...leadExpected(context),
        pipelineId: context.route.pipelineId,
        statusId: context.route.statusId,
        responsibleUserId: context.route.responsibleUserId,
      }),
      verify: async (provider, entityId) =>
        leadReadback(await provider.getLeadById(entityId), {
          leadId: entityId,
          name: context.displayName,
          pipelineId: context.route.pipelineId,
          statusId: context.route.statusId,
          responsibleUserId: context.route.responsibleUserId,
        }),
    },
    context.dependencies,
    context.provider,
  );
  if ("operationName" in created) return created;

  const bindings = await context.dependencies.readBindings({
    accountId: context.routing.canonicalAccountId,
    authorization: context.authorization,
    personId: context.personId,
    leadId: context.leadId,
  });
  if (bindings.leadId === null) {
    return internalStep("lead_update", "blocked", "lead_binding_missing", null);
  }
  const updateId = stepId(context.baseRequestId, "lead_update");
  const updatePrepared = context.provider.prepareUpdateLead({
    requestId: updateId,
    leadId: bindings.leadId,
    name: context.displayName,
  });
  const updated = await executePreparedStep(
    {
      accountId: context.routing.canonicalAccountId,
      discoverySnapshotId: context.routing.discoverySnapshotId,
      operationName: "lead_update",
      personId: null,
      leadId: context.leadId,
      actorRole: context.actorRole,
      authorization: context.authorization,
      targetContactId: null,
      targetLeadId: bindings.leadId,
      correlationId: context.baseRequestId,
      idempotencyKey: updateId,
      prepared: updatePrepared,
      expected: Object.freeze({ ...leadExpected(context), leadId: bindings.leadId }),
      verify: async (provider) =>
        leadReadback(await provider.getLeadById(bindings.leadId as string), {
          leadId: bindings.leadId as string,
          name: context.displayName,
        }),
    },
    context.dependencies,
    context.provider,
  );
  return "operationName" in updated
    ? updated
    : internalStep("lead_update", "error", "unexpected_binding_conflict", null);
}

async function executeLink(
  context: FlowContext,
  contactId: string,
  leadId: string,
): Promise<InternalStep> {
  const requestId = stepId(context.baseRequestId, "contact_lead_link");
  try {
    const stored = await context.dependencies.readCommandByIdempotencyKey(
      requestId,
      context.authorization,
    );
    if (stored !== null) return replayStep(stored);
  } catch (error) {
    const code = repositoryErrorCode(error);
    return internalStep(
      "contact_lead_link",
      code === "forbidden" ? "blocked" : "error",
      code ?? "link_replay_lookup_failed",
      null,
    );
  }
  try {
    if (
      mainContactLinkExists(
        await context.provider.getLeadLinks(leadId),
        contactId,
      )
    ) {
      return internalStep(
        "contact_lead_link",
        "accepted",
        "already_linked",
        null,
        contactId,
        leadId,
      );
    }
  } catch {
    return internalStep(
      "contact_lead_link",
      "error",
      "link_readback_failed",
      null,
    );
  }
  const prepared = context.provider.prepareLinkContactToLead({
    requestId,
    contactId,
    leadId,
  });
  const result = await executePreparedStep(
    {
      accountId: context.routing.canonicalAccountId,
      discoverySnapshotId: context.routing.discoverySnapshotId,
      operationName: "contact_lead_link",
      personId: context.personId,
      leadId: context.leadId,
      actorRole: context.actorRole,
      authorization: context.authorization,
      targetContactId: contactId,
      targetLeadId: leadId,
      correlationId: context.baseRequestId,
      idempotencyKey: requestId,
      prepared,
      expected: Object.freeze({ entity: "lead_contact_link", contactId, leadId }),
      verify: async (provider) =>
        linkReadback(await provider.getLeadLinks(leadId), leadId, contactId),
    },
    context.dependencies,
    context.provider,
  );
  return "operationName" in result
    ? result
    : internalStep("contact_lead_link", "error", "unexpected_binding_conflict", null);
}

async function executeLeadEffect(
  context: FlowContext,
  operationName:
    | "lead_pipeline_status_update"
    | "lead_responsible_update"
    | "lead_note_create"
    | "lead_tag_update",
  providerLeadId: string,
): Promise<InternalStep> {
  const requestId = stepId(context.baseRequestId, operationName);
  let prepared: CanonicalAmoCrmPreparedMutation;
  let expected: ExpectedEffect;
  let verify: StepExecutionInput["verify"];
  if (operationName === "lead_pipeline_status_update") {
    prepared = context.provider.prepareUpdateLeadPipelineStatus({
      requestId,
      leadId: providerLeadId,
      pipelineId: context.route.pipelineId,
      statusId: context.route.statusId,
    });
    expected = Object.freeze({
      entity: "lead",
      leadId: providerLeadId,
      pipelineId: context.route.pipelineId,
      statusId: context.route.statusId,
    });
    verify = async (provider) =>
      leadReadback(await provider.getLeadById(providerLeadId), {
        leadId: providerLeadId,
        pipelineId: context.route.pipelineId,
        statusId: context.route.statusId,
      });
  } else if (operationName === "lead_responsible_update") {
    prepared = context.provider.prepareUpdateLeadResponsibleUser({
      requestId,
      leadId: providerLeadId,
      responsibleUserId: context.route.responsibleUserId,
    });
    expected = Object.freeze({
      entity: "lead",
      leadId: providerLeadId,
      responsibleUserId: context.route.responsibleUserId,
    });
    verify = async (provider) =>
      leadReadback(await provider.getLeadById(providerLeadId), {
        leadId: providerLeadId,
        responsibleUserId: context.route.responsibleUserId,
      });
  } else if (operationName === "lead_note_create") {
    prepared = context.provider.prepareCreateLeadNote({
      requestId,
      leadId: providerLeadId,
      text: context.noteText,
    });
    expected = Object.freeze({
      entity: "lead_note",
      leadId: providerLeadId,
      textSha256: valueHash(context.noteText),
    });
    verify = async (provider, entityId) =>
      noteReadback(
        await provider.getLeadNoteById(providerLeadId, entityId),
        providerLeadId,
        entityId,
        context.noteText,
      );
  } else {
    let preservedUnrelatedTagSetSha256: string;
    try {
      preservedUnrelatedTagSetSha256 = unrelatedTagSetSha256(
        await context.provider.getLeadById(providerLeadId),
        providerLeadId,
        context.route.tagId,
        valueHash(context.route.tagName),
        context.oppositeTag.tagId,
        valueHash(context.oppositeTag.tagName),
      );
    } catch {
      return internalStep(
        "lead_tag_update",
        "error",
        "tag_baseline_read_failed",
        null,
      );
    }
    prepared = context.provider.prepareUpdateLeadTags({
      requestId,
      leadId: providerLeadId,
      add: Object.freeze([
        context.route.tagId === null
          ? Object.freeze({ name: context.route.tagName })
          : Object.freeze({ id: context.route.tagId }),
      ]),
      ...(context.oppositeTag.tagId === null
        ? {}
        : {
            remove: Object.freeze([
              Object.freeze({ id: context.oppositeTag.tagId }),
            ]),
          }),
    });
    expected = Object.freeze({
      entity: "lead",
      leadId: providerLeadId,
      tagId: context.route.tagId,
      tagNameSha256: valueHash(context.route.tagName),
      oppositeTagId: context.oppositeTag.tagId,
      oppositeTagNameSha256: valueHash(context.oppositeTag.tagName),
      unrelatedTagSetSha256: preservedUnrelatedTagSetSha256,
    });
    verify = async (provider) =>
      leadReadback(await provider.getLeadById(providerLeadId), {
        leadId: providerLeadId,
        tagId: context.route.tagId,
        tagName: context.route.tagName,
        oppositeTagId: context.oppositeTag.tagId,
        oppositeTagName: context.oppositeTag.tagName,
        unrelatedTagSetSha256: preservedUnrelatedTagSetSha256,
      });
  }
  const result = await executePreparedStep(
    {
      accountId: context.routing.canonicalAccountId,
      discoverySnapshotId: context.routing.discoverySnapshotId,
      operationName,
      personId: null,
      leadId: context.leadId,
      actorRole: context.actorRole,
      authorization: context.authorization,
      targetContactId: null,
      targetLeadId: providerLeadId,
      correlationId: context.baseRequestId,
      idempotencyKey: requestId,
      prepared,
      expected,
      verify,
    },
    context.dependencies,
    context.provider,
  );
  return "operationName" in result
    ? result
    : internalStep(operationName, "error", "unexpected_binding_conflict", null);
}

function terminal(step: InternalStep): boolean {
  return step.status !== "accepted";
}

function storedRequestMatchesCurrentContext(
  attempt: CanonicalAmoCrmCommandSnapshot,
  context: Readonly<{
    actorRole: "admin" | "sales" | "admissions";
    displayName: string;
    email: string | null;
    phone: string | null;
    noteText: string;
    route: CanonicalAmoCrmRoleCommandRoute;
    oppositeTagName: string;
  }>,
): boolean {
  if (attempt.actorRole !== context.actorRole) return false;
  let expected: Record<string, string | null>;
  try {
    expected = storedExpectedEffect(attempt);
  } catch {
    return false;
  }
  if (
    attempt.operationName === "contact_create" ||
    attempt.operationName === "contact_update"
  ) {
    return (
      expected.nameSha256 === valueHash(context.displayName) &&
      expected.phoneSha256 ===
        (context.phone === null ? null : valueHash(context.phone)) &&
      expected.emailSha256 ===
        (context.email === null ? null : valueHash(context.email))
    );
  }
  if (
    attempt.operationName === "lead_create" ||
    attempt.operationName === "lead_update"
  ) {
    return (
      expected.nameSha256 === valueHash(context.displayName) &&
      (attempt.operationName !== "lead_create" ||
        (expected.pipelineId === context.route.pipelineId &&
          expected.statusId === context.route.statusId &&
          expected.responsibleUserId === context.route.responsibleUserId))
    );
  }
  if (attempt.operationName === "lead_pipeline_status_update") {
    return (
      expected.pipelineId === context.route.pipelineId &&
      expected.statusId === context.route.statusId
    );
  }
  if (attempt.operationName === "lead_responsible_update") {
    return expected.responsibleUserId === context.route.responsibleUserId;
  }
  if (attempt.operationName === "lead_note_create") {
    return expected.textSha256 === valueHash(context.noteText);
  }
  if (attempt.operationName === "lead_tag_update") {
    return (
      expected.tagNameSha256 === valueHash(context.route.tagName) &&
      expected.oppositeTagNameSha256 === valueHash(context.oppositeTagName)
    );
  }
  return true;
}

async function preflightStoredFlow(
  dependencies: ResolvedDependencies,
  input: Readonly<{
    authorization: CanonicalAmoCrmWorkflowAuthorization;
    actorRole: "admin" | "sales" | "admissions";
    baseRequestId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    noteText: string;
    route: CanonicalAmoCrmRoleCommandRoute;
    oppositeTagName: string;
  }>,
): Promise<CanonicalAmoCrmSyncResult | null> {
  const read = async (operationName: EvoAmoCrmOperationName) =>
    dependencies.readCommandByIdempotencyKey(
      stepId(input.baseRequestId, operationName),
      input.authorization,
    );
  let contactCreate: CanonicalAmoCrmCommandSnapshot | null;
  let contactUpdate: CanonicalAmoCrmCommandSnapshot | null;
  let leadCreate: CanonicalAmoCrmCommandSnapshot | null;
  let leadUpdate: CanonicalAmoCrmCommandSnapshot | null;
  let remaining: readonly (CanonicalAmoCrmCommandSnapshot | null)[];
  try {
    contactCreate = await read("contact_create");
    contactUpdate =
      contactCreate === null ? await read("contact_update") : null;
    leadCreate = await read("lead_create");
    leadUpdate = leadCreate === null ? await read("lead_update") : null;
    remaining = await Promise.all([
      read("contact_lead_link"),
      read("lead_pipeline_status_update"),
      read("lead_responsible_update"),
      read("lead_note_create"),
      read("lead_tag_update"),
    ]);
  } catch (error) {
    const code = repositoryErrorCode(error);
    return aggregate(
      code === "forbidden" ? "blocked" : "error",
      code ?? "stored_flow_lookup_failed",
      [],
    );
  }
  if (
    (contactCreate !== null && contactUpdate !== null) ||
    (leadCreate !== null && leadUpdate !== null)
  ) {
    return aggregate("error", "stored_flow_conflict", []);
  }
  const contact = contactCreate ?? contactUpdate;
  const lead = leadCreate ?? leadUpdate;
  const [link, pipeline, responsible, note, tag] = remaining;
  const later = [pipeline, responsible, note, tag] as const;
  const ordered: InternalStep[] = [];
  const storedContext = {
    actorRole: input.actorRole,
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    noteText: input.noteText,
    route: input.route,
    oppositeTagName: input.oppositeTagName,
  };
  const appendStored = (
    attempt: CanonicalAmoCrmCommandSnapshot,
  ): CanonicalAmoCrmSyncResult | null => {
    if (!storedRequestMatchesCurrentContext(attempt, storedContext)) {
      const conflict = internalStep(
        attempt.operationName,
        "request_conflict",
        "idempotency_conflict",
        attempt.attemptId,
      );
      ordered.push(conflict);
      return terminalAggregate(ordered);
    }
    const step = replayStep(attempt);
    ordered.push(step);
    if (terminal(step)) return terminalAggregate(ordered);
    return null;
  };

  if (contact === null) return null;
  const contactTerminal = appendStored(contact);
  if (contactTerminal !== null) return contactTerminal;
  if (lead === null) return null;
  const leadTerminal = appendStored(lead);
  if (leadTerminal !== null) return leadTerminal;

  if (link === null) {
    if (!later.some((attempt) => attempt !== null)) return null;
    ordered.push(
      internalStep(
        "contact_lead_link",
        "accepted",
        "already_linked",
        null,
        contact.resultContactId,
        lead.resultLeadId,
      ),
    );
  } else {
    const linkTerminal = appendStored(link);
    if (linkTerminal !== null) return linkTerminal;
  }

  for (const attempt of later) {
    if (attempt === null) return null;
    const laterTerminal = appendStored(attempt);
    if (laterTerminal !== null) return laterTerminal;
  }
  return aggregate("accepted", "exact_replay", ordered.map(publicStep));
}

async function preflightBlockingFlow(
  dependencies: ResolvedDependencies,
  input: Readonly<{
    authorization: CanonicalAmoCrmWorkflowAuthorization;
    personId: string;
    leadId: string;
  }>,
): Promise<CanonicalAmoCrmSyncResult | null> {
  let attempt: CanonicalAmoCrmCommandSnapshot | null;
  try {
    attempt = await dependencies.readBlockingCommand(input);
  } catch (error) {
    const code = repositoryErrorCode(error);
    return aggregate(
      code === "forbidden" || code === "not_found" ? "blocked" : "error",
      code ?? "blocking_attempt_lookup_failed",
      [],
    );
  }
  if (attempt === null) return null;
  const step = replayStep(attempt);
  return aggregate(step.status, step.reason, [publicStep(step)]);
}

async function executeFlow(context: FlowContext): Promise<CanonicalAmoCrmSyncResult> {
  const steps: InternalStep[] = [];
  const contact = await executeContactUpsert(context);
  steps.push(contact);
  if (terminal(contact) || contact.resultContactId === null) return terminalAggregate(steps);

  const lead = await executeLeadUpsert(context);
  steps.push(lead);
  if (terminal(lead) || lead.resultLeadId === null) return terminalAggregate(steps);

  const link = await executeLink(
    context,
    contact.resultContactId,
    lead.resultLeadId,
  );
  steps.push(link);
  if (terminal(link)) return terminalAggregate(steps);

  for (const operationName of [
    "lead_pipeline_status_update",
    "lead_responsible_update",
    "lead_note_create",
    "lead_tag_update",
  ] as const) {
    const step = await executeLeadEffect(
      context,
      operationName,
      lead.resultLeadId,
    );
    steps.push(step);
    if (terminal(step)) return terminalAggregate(steps);
  }
  return aggregate("accepted", "all_effects_verified", steps.map(publicStep));
}

function configurationResult(error: unknown): CanonicalAmoCrmSyncResult {
  if (
    error instanceof CanonicalAmoCrmConfigurationError ||
    (error instanceof Error && error.name === "CanonicalAmoCrmCommandConfigurationError")
  ) {
    return aggregate("blocked", "provider_configuration_invalid", []);
  }
  if (error instanceof Error) {
    if (error.message === "forbidden_role") {
      return aggregate("blocked", "role_forbidden", []);
    }
    if (error.message === "invalid_note_text") {
      return aggregate("blocked", "note_text_invalid", []);
    }
    if (error.message === "invalid_uuid") {
      return aggregate("blocked", "request_invalid", []);
    }
  }
  return aggregate("error", "sync_initialization_failed", []);
}

async function initializeProviders(
  dependencies: ResolvedDependencies,
  correlationId: string,
  currentCommandConfig?: CanonicalAmoCrmCommandConfig,
): Promise<
  | Readonly<{
      status: "ready";
      routing: CanonicalAmoCrmCommandRoutingSnapshot;
      provider: CanonicalAmoCrmWriteProvider;
    }>
  | Readonly<{ status: "blocked"; result: CanonicalAmoCrmSyncResult }>
> {
  let providerConfig: CanonicalAmoCrmProviderConfig;
  let commandConfig: CanonicalAmoCrmCommandConfig;
  try {
    providerConfig = dependencies.loadProviderConfig();
    commandConfig = currentCommandConfig ?? dependencies.loadCommandConfig();
  } catch (error) {
    return Object.freeze({ status: "blocked", result: configurationResult(error) });
  }
  if (providerConfig.status !== "ready") {
    return Object.freeze({
      status: "blocked",
      result: aggregate("blocked", providerConfig.reason, []),
    });
  }
  try {
    const readProvider = dependencies.createReadProvider(providerConfig);
    const provider = dependencies.createWriteProvider(providerConfig);
    const routing = await dependencies.discoverRouting({
      providerConfig,
      commandConfig,
      provider: readProvider,
      correlationId,
    });
    return Object.freeze({ status: "ready", routing, provider });
  } catch {
    return Object.freeze({
      status: "blocked",
      result: aggregate("blocked", "provider_discovery_failed", []),
    });
  }
}

export async function executeCanonicalAmoCrmSalesSync(
  input: ExecuteCanonicalAmoCrmSalesSyncInput,
  dependencyOverrides: CanonicalAmoCrmCommandServiceDependencies = {},
): Promise<CanonicalAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  let role: "admin" | "sales";
  let leadId: string;
  let requestId: string;
  let note: string;
  try {
    role = actorRole(input.actorRole, ["admin", "sales"]) as "admin" | "sales";
    leadId = uuid(input.leadId);
    requestId = uuid(input.baseRequestId);
    note = noteText(input.noteText);
  } catch (error) {
    return configurationResult(error);
  }

  let lead: CanonicalLeadSnapshot;
  try {
    lead = await dependencies.getLeadSnapshot({ actorRole: role, leadId });
  } catch {
    return aggregate("blocked", "sales_lead_unavailable", []);
  }
  if (lead.stage === "handed_off" || lead.ownerRole !== "sales") {
    return aggregate("blocked", "sales_phase_not_active", []);
  }
  const authorization: CanonicalAmoCrmWorkflowAuthorization = Object.freeze({
    actorRole: role,
    workflowScope: "sales_pre_handoff",
    workflowLeadId: lead.leadId,
    studentCaseId: null,
  });
  let commandConfig: CanonicalAmoCrmCommandConfig;
  try {
    commandConfig = dependencies.loadCommandConfig();
  } catch (error) {
    return configurationResult(error);
  }
  const stored = await preflightStoredFlow(dependencies, {
    authorization,
    actorRole: role,
    baseRequestId: requestId,
    displayName: lead.displayName,
    email: lead.email,
    phone: lead.phone,
    noteText: note,
    route: commandConfig.sales,
    oppositeTagName: commandConfig.admissions.tagName,
  });
  if (stored !== null) return stored;
  const blocking = await preflightBlockingFlow(dependencies, {
    authorization,
    personId: lead.personId,
    leadId: lead.leadId,
  });
  if (blocking !== null) return blocking;
  const providers = await initializeProviders(dependencies, requestId, commandConfig);
  if (providers.status === "blocked") return providers.result;
  return executeFlow({
    dependencies,
    provider: providers.provider,
    routing: providers.routing,
    actorRole: role,
    authorization,
    personId: lead.personId,
    leadId: lead.leadId,
    displayName: lead.displayName,
    email: lead.email,
    phone: lead.phone,
    route: providers.routing.sales,
    oppositeTag: providers.routing.admissions,
    baseRequestId: requestId,
    noteText: note,
  });
}

export async function executeCanonicalAmoCrmAdmissionsSync(
  input: ExecuteCanonicalAmoCrmAdmissionsSyncInput,
  dependencyOverrides: CanonicalAmoCrmCommandServiceDependencies = {},
): Promise<CanonicalAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  let role: "admin" | "admissions";
  let studentCaseId: string;
  let requestId: string;
  let note: string;
  try {
    role = actorRole(input.actorRole, ["admin", "admissions"]) as
      | "admin"
      | "admissions";
    studentCaseId = uuid(input.studentCaseId);
    requestId = uuid(input.baseRequestId);
    note = noteText(input.noteText);
  } catch (error) {
    return configurationResult(error);
  }

  let handoff: CanonicalStudentCaseHandoffSnapshot;
  try {
    handoff = await dependencies.getStudentCaseHandoffSnapshot({
      actorRole: role,
      studentCaseId,
    });
  } catch {
    return aggregate("blocked", "admissions_case_unavailable", []);
  }
  const studentCase = handoff.studentCase;
  if (studentCase.status !== "active" || studentCase.assignedRole !== "admissions") {
    return aggregate("blocked", "admissions_phase_not_active", []);
  }
  const authorization: CanonicalAmoCrmWorkflowAuthorization = Object.freeze({
    actorRole: role,
    workflowScope: "admissions_post_handoff",
    workflowLeadId: studentCase.leadId,
    studentCaseId: studentCase.studentCaseId,
  });
  let commandConfig: CanonicalAmoCrmCommandConfig;
  try {
    commandConfig = dependencies.loadCommandConfig();
  } catch (error) {
    return configurationResult(error);
  }
  const stored = await preflightStoredFlow(dependencies, {
    authorization,
    actorRole: role,
    baseRequestId: requestId,
    displayName: studentCase.displayName,
    email: null,
    phone: null,
    noteText: note,
    route: commandConfig.admissions,
    oppositeTagName: commandConfig.sales.tagName,
  });
  if (stored !== null) return stored;
  const blocking = await preflightBlockingFlow(dependencies, {
    authorization,
    personId: studentCase.personId,
    leadId: studentCase.leadId,
  });
  if (blocking !== null) return blocking;
  const providers = await initializeProviders(dependencies, requestId, commandConfig);
  if (providers.status === "blocked") return providers.result;
  const bindings = await dependencies.readBindings({
    accountId: providers.routing.canonicalAccountId,
    authorization,
    personId: studentCase.personId,
    leadId: studentCase.leadId,
  });
  if (bindings.contactId === null || bindings.leadId === null) {
    return aggregate("blocked", "admissions_bindings_missing", []);
  }
  return executeFlow({
    dependencies,
    provider: providers.provider,
    routing: providers.routing,
    actorRole: role,
    authorization,
    personId: studentCase.personId,
    leadId: studentCase.leadId,
    displayName: studentCase.displayName,
    email: null,
    phone: null,
    route: providers.routing.admissions,
    oppositeTag: providers.routing.sales,
    baseRequestId: requestId,
    noteText: note,
  });
}

function storedExpectedEffect(
  attempt: CanonicalAmoCrmCommandSnapshot,
): Record<string, string | null> {
  const metadata = record(attempt.providerRequestMetadata);
  const expected = record(metadata.expected);
  const entries = Object.entries(expected);
  if (entries.length === 0 || entries.length > 32) {
    throw new ReadbackMismatchError();
  }
  const result: Record<string, string | null> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string" && value !== null) {
      throw new ReadbackMismatchError();
    }
    result[key] = value;
  }
  return result;
}

function requiredExpected(
  expected: Readonly<Record<string, string | null>>,
  key: string,
): string {
  const value = expected[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ReadbackMismatchError();
  }
  return value;
}

function optionalExpectedProviderId(
  expected: Readonly<Record<string, string | null>>,
  key: string,
): string | null {
  const value = expected[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new ReadbackMismatchError();
  }
  return providerId(value);
}

function optionalExpectedHash(
  expected: Readonly<Record<string, string | null>>,
  key: string,
): string | null {
  const value = expected[key];
  if (value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new ReadbackMismatchError();
  }
  return value;
}

function customFieldHasHash(
  response: Record<string, unknown>,
  fieldId: string,
  expectedHash: string,
): boolean {
  return collection(response.custom_fields_values ?? []).some((fieldValue) => {
    const field = record(fieldValue);
    if (providerId(field.field_id) !== fieldId) return false;
    return collection(field.values).some((entryValue) => {
      const entry = record(entryValue);
      return typeof entry.value === "string" && valueHash(entry.value) === expectedHash;
    });
  });
}

function storedContactReadback(
  value: unknown,
  contactId: string,
  expected: Readonly<Record<string, string | null>>,
): VerifiedReadback {
  const response = record(value);
  const nameHash = optionalExpectedHash(expected, "nameSha256");
  const phoneHash = optionalExpectedHash(expected, "phoneSha256");
  const emailHash = optionalExpectedHash(expected, "emailSha256");
  const phoneFieldId = requiredExpected(expected, "phoneFieldId");
  const emailFieldId = requiredExpected(expected, "emailFieldId");
  if (
    providerId(response.id) !== contactId ||
    nameHash === null ||
    typeof response.name !== "string" ||
    valueHash(response.name) !== nameHash ||
    (phoneHash !== null &&
      !customFieldHasHash(response, phoneFieldId, phoneHash)) ||
    (emailHash !== null &&
      !customFieldHasHash(response, emailFieldId, emailHash))
  ) {
    throw new ReadbackMismatchError();
  }
  return Object.freeze({
    evidence: Object.freeze({
      entity: "contact",
      entityId: contactId,
      nameSha256: nameHash,
      phoneSha256: phoneHash,
      emailSha256: emailHash,
    }),
    providerUpdatedAt: optionalProviderUpdatedAt(response.updated_at),
  });
}

function storedLeadReadback(
  value: unknown,
  leadId: string,
  expected: Readonly<Record<string, string | null>>,
  operationName: EvoAmoCrmOperationName,
): VerifiedReadback {
  const response = record(value);
  if (providerId(response.id) !== leadId) throw new ReadbackMismatchError();
  const evidence: Record<string, unknown> = { entity: "lead", entityId: leadId };
  if (operationName === "lead_update") {
    const expectedHash = optionalExpectedHash(expected, "nameSha256");
    if (
      expectedHash === null ||
      typeof response.name !== "string" ||
      valueHash(response.name) !== expectedHash
    ) {
      throw new ReadbackMismatchError();
    }
    evidence.nameSha256 = expectedHash;
  } else if (operationName === "lead_pipeline_status_update") {
    const pipelineId = requiredExpected(expected, "pipelineId");
    const statusId = requiredExpected(expected, "statusId");
    if (
      providerId(response.pipeline_id) !== pipelineId ||
      providerId(response.status_id) !== statusId
    ) {
      throw new ReadbackMismatchError();
    }
    evidence.pipelineId = pipelineId;
    evidence.statusId = statusId;
  } else if (operationName === "lead_responsible_update") {
    const responsibleUserId = requiredExpected(expected, "responsibleUserId");
    if (providerId(response.responsible_user_id) !== responsibleUserId) {
      throw new ReadbackMismatchError();
    }
    evidence.responsibleUserId = responsibleUserId;
  } else if (operationName === "lead_tag_update") {
    const expectedHash = optionalExpectedHash(expected, "tagNameSha256");
    const oppositeExpectedHash = optionalExpectedHash(
      expected,
      "oppositeTagNameSha256",
    );
    const tagId = optionalExpectedProviderId(expected, "tagId");
    const oppositeTagId = optionalExpectedProviderId(expected, "oppositeTagId");
    const unrelatedTagSetHash = optionalExpectedHash(
      expected,
      "unrelatedTagSetSha256",
    );
    const embedded = record(response._embedded ?? {});
    const tags = collection(embedded.tags ?? []);
    const roleTags = tags.filter((tagValue) => {
      const tag = record(tagValue);
      return (
        typeof tag.name === "string" &&
        valueHash(tag.name) === expectedHash
      );
    });
    if (
      expectedHash === null ||
      oppositeExpectedHash === null ||
      unrelatedTagSetHash === null ||
      expectedHash === oppositeExpectedHash ||
      (tagId !== null &&
        oppositeTagId !== null &&
        tagId === oppositeTagId) ||
      roleTags.length !== 1 ||
      (tagId !== null && providerId(record(roleTags[0]).id) !== tagId) ||
      tags.some((tagValue) => {
        const tag = record(tagValue);
        return (
          (typeof tag.name === "string" &&
            valueHash(tag.name) === oppositeExpectedHash) ||
          (oppositeTagId !== null && providerId(tag.id) === oppositeTagId)
        );
      }) ||
      unrelatedTagSetSha256(
        response,
        leadId,
        tagId,
        expectedHash,
        oppositeTagId,
        oppositeExpectedHash,
      ) !==
        unrelatedTagSetHash
    ) {
      throw new ReadbackMismatchError();
    }
    evidence.tagId = providerId(record(roleTags[0]).id);
    evidence.tagNameSha256 = expectedHash;
    evidence.oppositeTagId = oppositeTagId;
    evidence.oppositeTagNameSha256 = oppositeExpectedHash;
    evidence.unrelatedTagSetSha256 = unrelatedTagSetHash;
  } else {
    throw new ReadbackMismatchError();
  }
  return Object.freeze({
    evidence: Object.freeze(evidence),
    providerUpdatedAt: optionalProviderUpdatedAt(response.updated_at),
  });
}

async function verifyStoredUnknownEffect(
  provider: CanonicalAmoCrmWriteProvider,
  attempt: CanonicalAmoCrmCommandSnapshot,
): Promise<VerifiedReadback | null> {
  const expected = storedExpectedEffect(attempt);
  if (attempt.operationName === "contact_update") {
    if (attempt.targetContactId === null) throw new ReadbackMismatchError();
    return storedContactReadback(
      await provider.getContactById(attempt.targetContactId),
      attempt.targetContactId,
      expected,
    );
  }
  if (attempt.operationName === "contact_lead_link") {
    if (attempt.targetContactId === null || attempt.targetLeadId === null) {
      throw new ReadbackMismatchError();
    }
    return linkReadback(
      await provider.getLeadLinks(attempt.targetLeadId),
      attempt.targetLeadId,
      attempt.targetContactId,
    );
  }
  if (
    attempt.operationName === "lead_update" ||
    attempt.operationName === "lead_pipeline_status_update" ||
    attempt.operationName === "lead_responsible_update" ||
    attempt.operationName === "lead_tag_update"
  ) {
    if (attempt.targetLeadId === null) throw new ReadbackMismatchError();
    return storedLeadReadback(
      await provider.getLeadById(attempt.targetLeadId),
      attempt.targetLeadId,
      expected,
      attempt.operationName,
    );
  }
  // Create and note commands do not persist a provider result ID while their
  // outcome is unknown. A fuzzy search would risk accepting another entity.
  return null;
}

function reconciledResultIds(
  attempt: CanonicalAmoCrmCommandSnapshot,
): Readonly<{ resultContactId: string | null; resultLeadId: string | null }> {
  if (attempt.operationName === "contact_update") {
    return Object.freeze({
      resultContactId: attempt.targetContactId,
      resultLeadId: null,
    });
  }
  if (attempt.operationName === "contact_lead_link") {
    return Object.freeze({
      resultContactId: attempt.targetContactId,
      resultLeadId: attempt.targetLeadId,
    });
  }
  return Object.freeze({ resultContactId: null, resultLeadId: attempt.targetLeadId });
}

async function leaveUnknownAfterReconciliation(
  dependencies: ResolvedDependencies,
  attempt: CanonicalAmoCrmCommandSnapshot,
  authorization: CanonicalAmoCrmWorkflowAuthorization,
  reason: string,
): Promise<CanonicalAmoCrmSyncResult> {
  try {
    const result = await dependencies.reconcileUnknown(
      attempt.attemptId,
      authorization,
      { status: "still_unknown", failureCode: reason },
    );
    return aggregate(
      "unknown",
      reason,
      [
        internalStep(
          result.attempt.operationName,
          "unknown",
          reason,
          result.attempt.attemptId,
        ),
      ].map(publicStep),
    );
  } catch (error) {
    return aggregate(
      "error",
      repositoryErrorCode(error) ?? "reconciliation_persistence_failed",
      [
        publicStep(
          internalStep(
            attempt.operationName,
            "error",
            "reconciliation_persistence_failed",
            attempt.attemptId,
          ),
        ),
      ],
    );
  }
}

export async function reconcileCanonicalAmoCrmSyncAttempt(
  input: ReconcileCanonicalAmoCrmSyncAttemptInput,
  dependencyOverrides: CanonicalAmoCrmCommandServiceDependencies = {},
): Promise<CanonicalAmoCrmSyncResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  let role: "admin" | "sales" | "admissions";
  let leadId: string;
  let studentCaseId: string | null;
  let attemptId: string;
  let authorization: CanonicalAmoCrmWorkflowAuthorization;
  try {
    leadId = uuid(input.leadId);
    attemptId = uuid(input.attemptId);
    if (input.workflowScope === "sales_pre_handoff") {
      role = actorRole(input.actorRole, ["admin", "sales"]);
      if (input.studentCaseId !== null) throw new Error("invalid_uuid");
      studentCaseId = null;
    } else if (input.workflowScope === "admissions_post_handoff") {
      role = actorRole(input.actorRole, ["admin", "admissions"]);
      studentCaseId = uuid(input.studentCaseId);
    } else {
      throw new Error("invalid_uuid");
    }
    authorization = Object.freeze({
      actorRole: role,
      workflowScope: input.workflowScope,
      workflowLeadId: leadId,
      studentCaseId,
    });
  } catch (error) {
    return configurationResult(error);
  }

  let attempt: CanonicalAmoCrmCommandSnapshot;
  try {
    attempt = await dependencies.readCommand(attemptId, authorization);
  } catch (error) {
    const code = repositoryErrorCode(error);
    return aggregate(
      code === "forbidden" || code === "not_found" ? "blocked" : "error",
      code ?? "reconciliation_attempt_unavailable",
      [],
    );
  }
  const claimedPrepared =
    attempt.status === "prepared" && attempt.providerDispatchedAt !== null;
  if (attempt.status !== "unknown" && !claimedPrepared) {
    const step = replayStep(attempt);
    return aggregate(step.status, step.reason, [publicStep(step)]);
  }

  const providers = await initializeProviders(dependencies, attempt.correlationId);
  if (providers.status === "blocked") {
    return aggregate(providers.result.status, providers.result.reason, [
      publicStep(
        internalStep(
          attempt.operationName,
          providers.result.status,
          providers.result.reason,
          attempt.attemptId,
        ),
      ),
    ]);
  }
  if (providers.routing.canonicalAccountId !== attempt.accountId) {
    return aggregate("blocked", "provider_account_mismatch", [
      publicStep(
        internalStep(
          attempt.operationName,
          "blocked",
          "provider_account_mismatch",
          attempt.attemptId,
        ),
      ),
    ]);
  }

  let verified: VerifiedReadback | null;
  try {
    verified = await verifyStoredUnknownEffect(providers.provider, attempt);
  } catch (error) {
    return leaveUnknownAfterReconciliation(
      dependencies,
      attempt,
      authorization,
      error instanceof ReadbackMismatchError
        ? "reconciliation_readback_mismatch"
        : "reconciliation_readback_failed",
    );
  }
  if (verified === null) {
    return leaveUnknownAfterReconciliation(
      dependencies,
      attempt,
      authorization,
      "reconciliation_target_unavailable",
    );
  }

  const reconciledAt = responseTime(
    dependencies,
    attempt.providerDispatchedAt,
  );
  const ids = reconciledResultIds(attempt);
  const outcome: ReconcileUnknownCanonicalAmoCrmCommandOutcome = Object.freeze({
    status: "accepted",
    providerHttpStatus:
      attempt.providerHttpStatus !== null &&
      attempt.providerHttpStatus >= 200 &&
      attempt.providerHttpStatus <= 299
        ? attempt.providerHttpStatus
        : 200,
    providerRequestId: attempt.providerRequestId,
    providerRespondedAt: attempt.providerRespondedAt ?? reconciledAt,
    providerReadback: verified.evidence,
    providerReadbackAt: reconciledAt,
    resultContactId: ids.resultContactId,
    resultLeadId: ids.resultLeadId,
    providerUpdatedAt: verified.providerUpdatedAt,
  });
  try {
    const result = await dependencies.reconcileUnknown(
      attempt.attemptId,
      authorization,
      outcome,
    );
    const step = internalStep(
      result.attempt.operationName,
      "accepted",
      "reconciled_effect_verified",
      result.attempt.attemptId,
      result.attempt.resultContactId,
      result.attempt.resultLeadId,
    );
    return aggregate("accepted", "reconciled_effect_verified", [publicStep(step)]);
  } catch (error) {
    return aggregate(
      "error",
      repositoryErrorCode(error) ?? "reconciliation_persistence_failed",
      [
        publicStep(
          internalStep(
            attempt.operationName,
            "error",
            "reconciliation_persistence_failed",
            attempt.attemptId,
          ),
        ),
      ],
    );
  }
}
