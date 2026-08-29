import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import {
  EVO_AMOCRM_OPERATION_NAMES,
  evoAmoCrmAccounts,
  evoAmoCrmContactBindings,
  evoAmoCrmLeadBindings,
  evoAmoCrmOperationAttempts,
  evoCommandReceipts,
  evoLeads,
  evoSalesAdmissionsHandoffs,
  evoStudentCases,
  type EvoAmoCrmOperationName,
} from "../../db/schema/index.ts";
import { getDatabase } from "./database.ts";

export type CanonicalAmoCrmActorRole = "admin" | "sales" | "admissions";
export type CanonicalAmoCrmWorkflowScope =
  | "sales_pre_handoff"
  | "admissions_post_handoff";

export type CanonicalAmoCrmWorkflowAuthorization = Readonly<{
  actorRole: CanonicalAmoCrmActorRole;
  workflowScope: CanonicalAmoCrmWorkflowScope;
  workflowLeadId: string;
  studentCaseId: string | null;
}>;

export type ReadCanonicalAmoCrmBindingsInput = Readonly<{
  accountId: string;
  authorization: CanonicalAmoCrmWorkflowAuthorization;
  personId: string;
  leadId: string;
}>;

export type ReadBlockingCanonicalAmoCrmCommandInput = Readonly<{
  authorization: CanonicalAmoCrmWorkflowAuthorization;
  personId: string;
  leadId: string;
}>;

export type CanonicalAmoCrmBindingsSnapshot = Readonly<{
  contactId: string | null;
  leadId: string | null;
}>;

export type CanonicalAmoCrmCommandSnapshot = Readonly<{
  attemptId: string;
  accountId: string;
  commandReceiptId: string;
  operationName: EvoAmoCrmOperationName;
  personId: string | null;
  leadId: string | null;
  actorRole: CanonicalAmoCrmActorRole;
  workflowScope: CanonicalAmoCrmWorkflowScope;
  workflowLeadId: string;
  studentCaseId: string | null;
  status: "prepared" | "accepted" | "unknown" | "rejected";
  providerRequestMetadata: Readonly<Record<string, unknown>>;
  providerRequestSha256: string;
  commandRequestSha256: string;
  targetContactId: string | null;
  targetLeadId: string | null;
  resultContactId: string | null;
  resultLeadId: string | null;
  providerHttpStatus: number | null;
  providerRequestId: string | null;
  providerDispatchedAt: string | null;
  providerRespondedAt: string | null;
  providerReadback: Readonly<Record<string, unknown>> | null;
  providerReadbackSha256: string | null;
  providerReadbackAt: string | null;
  failureCode: string | null;
  correlationId: string;
  idempotencyKey: string;
  version: number;
  preparedAt: string;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
  lastReconciledAt: string | null;
}>;

export type CanonicalAmoCrmCommandRepositoryErrorCode =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "binding_conflict"
  | "state_conflict"
  | "unavailable";

export class CanonicalAmoCrmCommandRepositoryError extends Error {
  readonly code: CanonicalAmoCrmCommandRepositoryErrorCode;

  constructor(code: CanonicalAmoCrmCommandRepositoryErrorCode) {
    super(code);
    this.name = "CanonicalAmoCrmCommandRepositoryError";
    this.code = code;
  }
}

export type PrepareCanonicalAmoCrmCommandInput = Readonly<{
  accountId: string;
  operationName: EvoAmoCrmOperationName;
  personId: string | null;
  leadId: string | null;
  actorRole: CanonicalAmoCrmActorRole;
  authorization: CanonicalAmoCrmWorkflowAuthorization;
  targetContactId: string | null;
  targetLeadId: string | null;
  providerRequestMetadata: Readonly<Record<string, unknown>>;
  providerRequestSha256: string;
  correlationId: string;
  idempotencyKey: string;
}>;

export type SettleCanonicalAmoCrmCommandOutcome =
  | Readonly<{
      status: "accepted";
      providerHttpStatus: number;
      providerRequestId: string | null;
      providerRespondedAt: string;
      providerReadback: Readonly<Record<string, unknown>>;
      providerReadbackAt: string;
      resultContactId: string | null;
      resultLeadId: string | null;
      providerUpdatedAt: string | null;
    }>
  | Readonly<{
      status: "rejected";
      providerHttpStatus: number;
      providerRequestId: string | null;
      providerRespondedAt: string;
      providerReadback?: Readonly<Record<string, unknown>> | null;
      providerReadbackAt?: string | null;
      failureCode: string;
    }>
  | Readonly<{
      status: "unknown";
      providerHttpStatus?: number | null;
      providerRequestId?: string | null;
      providerRespondedAt?: string | null;
      providerReadback?: Readonly<Record<string, unknown>> | null;
      providerReadbackAt?: string | null;
      failureCode: string;
    }>;

export type ReconcileUnknownCanonicalAmoCrmCommandOutcome =
  | Readonly<{
      status: "accepted";
      providerHttpStatus: number;
      providerRequestId: string | null;
      providerRespondedAt: string;
      providerReadback: Readonly<Record<string, unknown>>;
      providerReadbackAt: string;
      resultContactId: string | null;
      resultLeadId: string | null;
      providerUpdatedAt: string | null;
    }>
  | Readonly<{
      status: "still_unknown";
      failureCode: string;
      providerReadback?: Readonly<Record<string, unknown>> | null;
      providerReadbackAt?: string | null;
    }>;

type Database = ReturnType<typeof getDatabase>;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type NormalizedSettlement = Readonly<{
  status: "accepted" | "unknown" | "rejected";
  providerHttpStatus: number | null;
  providerRequestId: string | null;
  providerRespondedAt: Date | null;
  providerReadback: Record<string, unknown> | null;
  providerReadbackSha256: string | null;
  providerReadbackAt: Date | null;
  resultContactId: string | null;
  resultLeadId: string | null;
  providerUpdatedAt: Date | null;
  failureCode: string | null;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const SECRET_KEY_PATTERN = /token|secret|authorization|api[_-]?key|header/i;

function repositoryError(
  code: CanonicalAmoCrmCommandRepositoryErrorCode,
): never {
  throw new CanonicalAmoCrmCommandRepositoryError(code);
}

function exactText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    repositoryError("invalid_input");
  }
  return value;
}

function uuid(value: unknown): string {
  const parsed = exactText(value, 36).toLowerCase();
  if (!UUID_PATTERN.test(parsed)) repositoryError("invalid_input");
  return parsed;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : uuid(value);
}

function providerId(value: unknown): string {
  const parsed = exactText(value, 20);
  if (!PROVIDER_ID_PATTERN.test(parsed)) repositoryError("invalid_input");
  return parsed;
}

function optionalProviderId(value: unknown): string | null {
  return value === null || value === undefined ? null : providerId(value);
}

function sha256Text(value: unknown): string {
  const parsed = exactText(value, 64);
  if (!/^[0-9a-f]{64}$/.test(parsed)) repositoryError("invalid_input");
  return parsed;
}

function actorRole(value: unknown): CanonicalAmoCrmActorRole {
  if (value !== "admin" && value !== "sales" && value !== "admissions") {
    repositoryError("invalid_input");
  }
  return value;
}

function workflowScope(value: unknown): CanonicalAmoCrmWorkflowScope {
  if (value !== "sales_pre_handoff" && value !== "admissions_post_handoff") {
    repositoryError("invalid_input");
  }
  return value;
}

function operationName(value: unknown): EvoAmoCrmOperationName {
  if (!EVO_AMOCRM_OPERATION_NAMES.includes(value as EvoAmoCrmOperationName)) {
    repositoryError("invalid_input");
  }
  return value as EvoAmoCrmOperationName;
}

function timestamp(value: unknown): Date {
  const text = exactText(value, 64);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) {
    repositoryError("invalid_input");
  }
  return parsed;
}

function optionalTimestamp(value: unknown): Date | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    repositoryError("invalid_input");
  }
  return value as number;
}

function canonicalJsonValue(value: unknown, key: string | null = null): JsonValue {
  if (key !== null && SECRET_KEY_PATTERN.test(key)) repositoryError("invalid_input");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) repositoryError("invalid_input");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalJsonValue(entry));
  }
  if (typeof value !== "object") repositoryError("invalid_input");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    repositoryError("invalid_input");
  }
  const result: Record<string, JsonValue> = {};
  for (const entryKey of Object.keys(value).sort()) {
    result[entryKey] = canonicalJsonValue(
      (value as Record<string, unknown>)[entryKey],
      entryKey,
    );
  }
  return result;
}

function canonicalObject(
  value: unknown,
  maximumBytes = 1_048_576,
): Record<string, unknown> {
  const normalized = canonicalJsonValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    repositoryError("invalid_input");
  }
  const encoded = JSON.stringify(normalized);
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    repositoryError("invalid_input");
  }
  return normalized as Record<string, unknown>;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deepFreezeObject(
  value: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") {
      if (Array.isArray(nested)) {
        for (const entry of nested) {
          if (entry && typeof entry === "object") {
            deepFreezeObject(entry as Record<string, unknown>);
          }
        }
        Object.freeze(nested);
      } else {
        deepFreezeObject(nested as Record<string, unknown>);
      }
    }
  }
  return Object.freeze(value);
}

function parseAuthorization(
  value: CanonicalAmoCrmWorkflowAuthorization,
): CanonicalAmoCrmWorkflowAuthorization {
  const parsedRole = actorRole(value?.actorRole);
  const parsedScope = workflowScope(value?.workflowScope);
  const workflowLeadId = uuid(value?.workflowLeadId);
  const studentCaseId = optionalUuid(value?.studentCaseId);
  if (
    (parsedScope === "sales_pre_handoff" &&
      (parsedRole === "admissions" || studentCaseId !== null)) ||
    (parsedScope === "admissions_post_handoff" &&
      (parsedRole === "sales" || studentCaseId === null))
  ) {
    repositoryError("forbidden");
  }
  return Object.freeze({
    actorRole: parsedRole,
    workflowScope: parsedScope,
    workflowLeadId,
    studentCaseId,
  });
}

function assertOperationShape(input: Readonly<{
  operationName: EvoAmoCrmOperationName;
  personId: string | null;
  leadId: string | null;
  targetContactId: string | null;
  targetLeadId: string | null;
}>): void {
  const contactOperation =
    input.operationName === "contact_create" || input.operationName === "contact_update";
  const leadOperation =
    input.operationName === "lead_create" ||
    input.operationName === "lead_update" ||
    input.operationName === "lead_pipeline_status_update" ||
    input.operationName === "lead_responsible_update" ||
    input.operationName === "lead_note_create" ||
    input.operationName === "lead_tag_update";
  if (
    (contactOperation && (input.personId === null || input.leadId !== null)) ||
    (leadOperation && (input.personId !== null || input.leadId === null)) ||
    (input.operationName === "contact_lead_link" &&
      (input.personId === null || input.leadId === null))
  ) {
    repositoryError("invalid_input");
  }
  if (
    ((input.operationName === "contact_create" || input.operationName === "lead_create") &&
      (input.targetContactId !== null || input.targetLeadId !== null)) ||
    (input.operationName === "contact_update" &&
      (input.targetContactId === null || input.targetLeadId !== null)) ||
    (leadOperation && input.operationName !== "lead_create" &&
      (input.targetContactId !== null || input.targetLeadId === null)) ||
    (input.operationName === "contact_lead_link" &&
      (input.targetContactId === null || input.targetLeadId === null))
  ) {
    repositoryError("invalid_input");
  }
}

type ParsedPrepareInput = Readonly<{
  accountId: string;
  operationName: EvoAmoCrmOperationName;
  personId: string | null;
  leadId: string | null;
  actorRole: CanonicalAmoCrmActorRole;
  authorization: CanonicalAmoCrmWorkflowAuthorization;
  targetContactId: string | null;
  targetLeadId: string | null;
  providerRequestMetadata: Record<string, unknown>;
  providerRequestSha256: string;
  commandRequestSha256: string;
  correlationId: string;
  idempotencyKey: string;
}>;

function parsePrepareInput(input: PrepareCanonicalAmoCrmCommandInput): ParsedPrepareInput {
  const authorization = parseAuthorization(input.authorization);
  const parsed = {
    accountId: uuid(input.accountId),
    operationName: operationName(input.operationName),
    personId: optionalUuid(input.personId),
    leadId: optionalUuid(input.leadId),
    actorRole: actorRole(input.actorRole),
    authorization,
    targetContactId: optionalProviderId(input.targetContactId),
    targetLeadId: optionalProviderId(input.targetLeadId),
    providerRequestMetadata: canonicalObject(input.providerRequestMetadata, 65_536),
    providerRequestSha256: sha256Text(input.providerRequestSha256),
    correlationId: exactText(input.correlationId, 255),
    idempotencyKey: exactText(input.idempotencyKey, 255),
  };
  if (parsed.actorRole !== authorization.actorRole) repositoryError("forbidden");
  assertOperationShape(parsed);
  if (parsed.leadId !== null && parsed.leadId !== authorization.workflowLeadId) {
    repositoryError("forbidden");
  }
  const commandRequestSha256 = sha256({
    accountId: parsed.accountId,
    operationName: parsed.operationName,
    personId: parsed.personId,
    leadId: parsed.leadId,
    actorRole: parsed.actorRole,
    workflowScope: authorization.workflowScope,
    workflowLeadId: authorization.workflowLeadId,
    studentCaseId: authorization.studentCaseId,
    targetContactId: parsed.targetContactId,
    targetLeadId: parsed.targetLeadId,
    providerRequestMetadata: parsed.providerRequestMetadata,
    providerRequestSha256: parsed.providerRequestSha256,
  });
  return Object.freeze({ ...parsed, commandRequestSha256 });
}

const attemptSelection = {
  attemptId: evoAmoCrmOperationAttempts.id,
  accountId: evoAmoCrmOperationAttempts.accountId,
  commandReceiptId: evoAmoCrmOperationAttempts.commandReceiptId,
  operationName: evoAmoCrmOperationAttempts.operationName,
  personId: evoAmoCrmOperationAttempts.personId,
  leadId: evoAmoCrmOperationAttempts.leadId,
  actorRole: evoAmoCrmOperationAttempts.actorRole,
  status: evoAmoCrmOperationAttempts.status,
  providerRequestMetadata: evoAmoCrmOperationAttempts.providerRequestMetadata,
  providerRequestSha256: evoAmoCrmOperationAttempts.providerRequestSha256,
  targetContactId: evoAmoCrmOperationAttempts.targetContactId,
  targetLeadId: evoAmoCrmOperationAttempts.targetLeadId,
  resultContactId: evoAmoCrmOperationAttempts.resultContactId,
  resultLeadId: evoAmoCrmOperationAttempts.resultLeadId,
  providerHttpStatus: evoAmoCrmOperationAttempts.providerHttpStatus,
  providerRequestId: evoAmoCrmOperationAttempts.providerRequestId,
  providerDispatchedAt: evoAmoCrmOperationAttempts.providerDispatchedAt,
  providerRespondedAt: evoAmoCrmOperationAttempts.providerRespondedAt,
  providerReadback: evoAmoCrmOperationAttempts.providerReadback,
  providerReadbackSha256: evoAmoCrmOperationAttempts.providerReadbackSha256,
  providerReadbackAt: evoAmoCrmOperationAttempts.providerReadbackAt,
  failureCode: evoAmoCrmOperationAttempts.failureCode,
  correlationId: evoAmoCrmOperationAttempts.correlationId,
  idempotencyKey: evoAmoCrmOperationAttempts.idempotencyKey,
  version: evoAmoCrmOperationAttempts.version,
  preparedAt: evoAmoCrmOperationAttempts.preparedAt,
  createdAt: evoAmoCrmOperationAttempts.createdAt,
  updatedAt: evoAmoCrmOperationAttempts.updatedAt,
  settledAt: evoAmoCrmOperationAttempts.settledAt,
  lastReconciledAt: evoAmoCrmOperationAttempts.lastReconciledAt,
  commandName: evoCommandReceipts.commandName,
  commandRequestSha256: evoCommandReceipts.requestHash,
  receiptActorRole: evoCommandReceipts.actorRole,
  receiptBusinessObjectType: evoCommandReceipts.businessObjectType,
  receiptBusinessObjectId: evoCommandReceipts.businessObjectId,
};

type StoredAttemptRow = {
  attemptId: string;
  accountId: string;
  commandReceiptId: string;
  operationName: string;
  personId: string | null;
  leadId: string | null;
  actorRole: string;
  status: string;
  providerRequestMetadata: Record<string, unknown>;
  providerRequestSha256: string;
  targetContactId: string | null;
  targetLeadId: string | null;
  resultContactId: string | null;
  resultLeadId: string | null;
  providerHttpStatus: number | null;
  providerRequestId: string | null;
  providerDispatchedAt: Date | null;
  providerRespondedAt: Date | null;
  providerReadback: Record<string, unknown> | null;
  providerReadbackSha256: string | null;
  providerReadbackAt: Date | null;
  failureCode: string | null;
  correlationId: string;
  idempotencyKey: string;
  version: number;
  preparedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  settledAt: Date | null;
  lastReconciledAt: Date | null;
  commandName: string;
  commandRequestSha256: string;
  receiptActorRole: string;
  receiptBusinessObjectType: string | null;
  receiptBusinessObjectId: string | null;
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function snapshot(
  row: StoredAttemptRow,
  authorization: CanonicalAmoCrmWorkflowAuthorization,
): CanonicalAmoCrmCommandSnapshot {
  if (
    !EVO_AMOCRM_OPERATION_NAMES.includes(row.operationName as EvoAmoCrmOperationName) ||
    (row.actorRole !== "admin" && row.actorRole !== "sales" && row.actorRole !== "admissions") ||
    (row.status !== "prepared" &&
      row.status !== "accepted" &&
      row.status !== "unknown" &&
      row.status !== "rejected")
  ) {
    repositoryError("unavailable");
  }
  return Object.freeze({
    attemptId: row.attemptId,
    accountId: row.accountId,
    commandReceiptId: row.commandReceiptId,
    operationName: row.operationName as EvoAmoCrmOperationName,
    personId: row.personId,
    leadId: row.leadId,
    actorRole: row.actorRole as CanonicalAmoCrmActorRole,
    workflowScope: authorization.workflowScope,
    workflowLeadId: authorization.workflowLeadId,
    studentCaseId: authorization.studentCaseId,
    status: row.status as CanonicalAmoCrmCommandSnapshot["status"],
    providerRequestMetadata: deepFreezeObject(structuredClone(row.providerRequestMetadata)),
    providerRequestSha256: row.providerRequestSha256,
    commandRequestSha256: row.commandRequestSha256,
    targetContactId: row.targetContactId,
    targetLeadId: row.targetLeadId,
    resultContactId: row.resultContactId,
    resultLeadId: row.resultLeadId,
    providerHttpStatus: row.providerHttpStatus,
    providerRequestId: row.providerRequestId,
    providerDispatchedAt: iso(row.providerDispatchedAt),
    providerRespondedAt: iso(row.providerRespondedAt),
    providerReadback:
      row.providerReadback === null
        ? null
        : deepFreezeObject(structuredClone(row.providerReadback)),
    providerReadbackSha256: row.providerReadbackSha256,
    providerReadbackAt: iso(row.providerReadbackAt),
    failureCode: row.failureCode,
    correlationId: row.correlationId,
    idempotencyKey: row.idempotencyKey,
    version: row.version,
    preparedAt: row.preparedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    settledAt: iso(row.settledAt),
    lastReconciledAt: iso(row.lastReconciledAt),
  });
}

async function selectByAttemptId(
  transaction: DatabaseTransaction,
  attemptId: string,
): Promise<StoredAttemptRow | null> {
  const [row] = await transaction
    .select(attemptSelection)
    .from(evoAmoCrmOperationAttempts)
    .innerJoin(
      evoCommandReceipts,
      eq(evoCommandReceipts.id, evoAmoCrmOperationAttempts.commandReceiptId),
    )
    .where(eq(evoAmoCrmOperationAttempts.id, attemptId))
    .limit(1);
  return (row as StoredAttemptRow | undefined) ?? null;
}

async function selectByIdempotencyKey(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
): Promise<StoredAttemptRow | null> {
  const [row] = await transaction
    .select(attemptSelection)
    .from(evoAmoCrmOperationAttempts)
    .innerJoin(
      evoCommandReceipts,
      eq(evoCommandReceipts.id, evoAmoCrmOperationAttempts.commandReceiptId),
    )
    .where(eq(evoAmoCrmOperationAttempts.idempotencyKey, idempotencyKey))
    .limit(1);
  return (row as StoredAttemptRow | undefined) ?? null;
}

async function assertWorkflowAuthorization(
  transaction: DatabaseTransaction,
  authorization: CanonicalAmoCrmWorkflowAuthorization,
  personId: string | null,
): Promise<void> {
  if (authorization.workflowScope === "sales_pre_handoff") {
    const [lead] = await transaction
      .select({
        id: evoLeads.id,
        personId: evoLeads.personId,
        handoffId: evoSalesAdmissionsHandoffs.id,
      })
      .from(evoLeads)
      .leftJoin(
        evoSalesAdmissionsHandoffs,
        eq(evoSalesAdmissionsHandoffs.leadId, evoLeads.id),
      )
      .where(
        and(
          eq(evoLeads.id, authorization.workflowLeadId),
          ne(evoLeads.stage, "handed_off"),
          eq(evoLeads.ownerRole, "sales"),
        ),
      )
      .limit(1);
    if (!lead || lead.handoffId !== null || (personId !== null && lead.personId !== personId)) {
      repositoryError("forbidden");
    }
    return;
  }

  const [studentCase] = await transaction
    .select({
      caseId: evoStudentCases.id,
      leadId: evoStudentCases.leadId,
      personId: evoStudentCases.personId,
    })
    .from(evoStudentCases)
    .innerJoin(
      evoSalesAdmissionsHandoffs,
      and(
        eq(evoSalesAdmissionsHandoffs.studentCaseId, evoStudentCases.id),
        eq(evoSalesAdmissionsHandoffs.leadId, evoStudentCases.leadId),
      ),
    )
    .innerJoin(evoLeads, eq(evoLeads.id, evoStudentCases.leadId))
    .where(
      and(
        eq(evoStudentCases.id, authorization.studentCaseId as string),
        eq(evoStudentCases.leadId, authorization.workflowLeadId),
        eq(evoStudentCases.status, "active"),
        eq(evoStudentCases.ownerRole, "admissions"),
        eq(evoLeads.stage, "handed_off"),
      ),
    )
    .limit(1);
  if (!studentCase || (personId !== null && studentCase.personId !== personId)) {
    repositoryError("forbidden");
  }
}

function assertStoredWorkflow(
  row: StoredAttemptRow,
  authorization: CanonicalAmoCrmWorkflowAuthorization,
): void {
  const expectedType =
    authorization.workflowScope === "sales_pre_handoff"
      ? "amocrm_sales_lead"
      : "amocrm_admissions_case";
  const expectedId =
    authorization.workflowScope === "sales_pre_handoff"
      ? authorization.workflowLeadId
      : authorization.studentCaseId;
  if (
    row.receiptBusinessObjectType !== expectedType ||
    row.receiptBusinessObjectId !== expectedId
  ) {
    repositoryError("forbidden");
  }
  if (row.leadId !== null && row.leadId !== authorization.workflowLeadId) {
    repositoryError("forbidden");
  }
}

async function authorizeStored(
  transaction: DatabaseTransaction,
  row: StoredAttemptRow,
  authorization: CanonicalAmoCrmWorkflowAuthorization,
): Promise<void> {
  assertStoredWorkflow(row, authorization);
  await assertWorkflowAuthorization(transaction, authorization, row.personId);
}

async function assertBindingPreconditions(
  transaction: DatabaseTransaction,
  input: ParsedPrepareInput,
): Promise<void> {
  const unresolvedConditions = [];
  if (input.personId !== null) {
    unresolvedConditions.push(eq(evoAmoCrmOperationAttempts.personId, input.personId));
  }
  if (input.leadId !== null) {
    unresolvedConditions.push(eq(evoAmoCrmOperationAttempts.leadId, input.leadId));
  }
  const [unresolved] = unresolvedConditions.length
    ? await transaction
        .select({ id: evoAmoCrmOperationAttempts.id })
        .from(evoAmoCrmOperationAttempts)
        .where(
          and(
            eq(evoAmoCrmOperationAttempts.accountId, input.accountId),
            inArray(evoAmoCrmOperationAttempts.status, ["prepared", "unknown"]),
            or(...unresolvedConditions),
          ),
        )
        .limit(1)
    : [];
  if (unresolved) repositoryError("state_conflict");

  if (input.personId !== null) {
    const [binding] = await transaction
      .select({ providerId: evoAmoCrmContactBindings.providerContactId })
      .from(evoAmoCrmContactBindings)
      .where(
        and(
          eq(evoAmoCrmContactBindings.accountId, input.accountId),
          eq(evoAmoCrmContactBindings.personId, input.personId),
        ),
      )
      .limit(1);
    if (
      (input.operationName === "contact_create" && binding) ||
      (input.operationName !== "contact_create" &&
        (!binding || binding.providerId !== input.targetContactId))
    ) {
      repositoryError("binding_conflict");
    }
  }

  if (input.leadId !== null) {
    const [binding] = await transaction
      .select({ providerId: evoAmoCrmLeadBindings.providerLeadId })
      .from(evoAmoCrmLeadBindings)
      .where(
        and(
          eq(evoAmoCrmLeadBindings.accountId, input.accountId),
          eq(evoAmoCrmLeadBindings.leadId, input.leadId),
        ),
      )
      .limit(1);
    if (
      (input.operationName === "lead_create" && binding) ||
      (input.operationName !== "lead_create" &&
        (!binding || binding.providerId !== input.targetLeadId))
    ) {
      repositoryError("binding_conflict");
    }
  }
}

async function lockCanonicalProviderObjects(
  transaction: DatabaseTransaction,
  input: ParsedPrepareInput,
): Promise<void> {
  const keys = [
    input.personId === null
      ? null
      : `amocrm-object:${input.accountId}:person:${input.personId}`,
    input.leadId === null
      ? null
      : `amocrm-object:${input.accountId}:lead:${input.leadId}`,
  ]
    .filter((value): value is string => value !== null)
    .sort();
  for (const key of keys) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }
}

async function repositoryOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CanonicalAmoCrmCommandRepositoryError) throw error;
    throw new CanonicalAmoCrmCommandRepositoryError("unavailable");
  }
}

export async function prepareCanonicalAmoCrmCommand(
  rawInput: PrepareCanonicalAmoCrmCommandInput,
): Promise<Readonly<{ kind: "prepared" | "replay"; attempt: CanonicalAmoCrmCommandSnapshot }>> {
  const input = parsePrepareInput(rawInput);
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`amocrm-command:${input.idempotencyKey}`}, 0))`,
      );
      const existing = await selectByIdempotencyKey(transaction, input.idempotencyKey);
      if (existing) {
        if (
          existing.commandName !== `amocrm.${input.operationName}` ||
          existing.commandRequestSha256 !== input.commandRequestSha256 ||
          existing.receiptActorRole !== input.actorRole ||
          existing.providerRequestSha256 !== input.providerRequestSha256
        ) {
          repositoryError("idempotency_conflict");
        }
        assertStoredWorkflow(existing, input.authorization);
        await authorizeStored(transaction, existing, input.authorization);
        return Object.freeze({
          kind: "replay" as const,
          attempt: snapshot(existing, input.authorization),
        });
      }

      const [foreignReceipt] = await transaction
        .select({ id: evoCommandReceipts.id })
        .from(evoCommandReceipts)
        .where(eq(evoCommandReceipts.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (foreignReceipt) repositoryError("idempotency_conflict");

      await lockCanonicalProviderObjects(transaction, input);
      await assertWorkflowAuthorization(transaction, input.authorization, input.personId);
      await assertBindingPreconditions(transaction, input);
      const receiptId = randomUUID();
      const attemptId = randomUUID();
      const businessObjectType =
        input.authorization.workflowScope === "sales_pre_handoff"
          ? "amocrm_sales_lead"
          : "amocrm_admissions_case";
      const businessObjectId =
        input.authorization.workflowScope === "sales_pre_handoff"
          ? input.authorization.workflowLeadId
          : (input.authorization.studentCaseId as string);
      await transaction.insert(evoCommandReceipts).values({
        id: receiptId,
        commandName: `amocrm.${input.operationName}`,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.commandRequestSha256,
        correlationId: input.correlationId,
        actorRole: input.actorRole,
        businessObjectType,
        businessObjectId,
        status: "processing",
      });
      await transaction.insert(evoAmoCrmOperationAttempts).values({
        id: attemptId,
        accountId: input.accountId,
        commandReceiptId: receiptId,
        operationName: input.operationName,
        personId: input.personId,
        leadId: input.leadId,
        actorRole: input.actorRole,
        status: "prepared",
        providerRequestMetadata: input.providerRequestMetadata,
        providerRequestSha256: input.providerRequestSha256,
        targetContactId: input.targetContactId,
        targetLeadId: input.targetLeadId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
      });
      const inserted = await selectByAttemptId(transaction, attemptId);
      if (!inserted) repositoryError("unavailable");
      return Object.freeze({
        kind: "prepared" as const,
        attempt: snapshot(inserted, input.authorization),
      });
    }),
  );
}

export async function readCanonicalAmoCrmCommand(
  rawAttemptId: string,
  rawAuthorization: CanonicalAmoCrmWorkflowAuthorization,
): Promise<CanonicalAmoCrmCommandSnapshot> {
  const attemptId = uuid(rawAttemptId);
  const authorization = parseAuthorization(rawAuthorization);
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      const row = await selectByAttemptId(transaction, attemptId);
      if (!row) repositoryError("not_found");
      await authorizeStored(transaction, row, authorization);
      return snapshot(row, authorization);
    }),
  );
}

export async function readCanonicalAmoCrmCommandByIdempotencyKey(
  rawKey: string,
  rawAuthorization: CanonicalAmoCrmWorkflowAuthorization,
): Promise<CanonicalAmoCrmCommandSnapshot | null> {
  const idempotencyKey = exactText(rawKey, 255);
  const authorization = parseAuthorization(rawAuthorization);
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      const row = await selectByIdempotencyKey(transaction, idempotencyKey);
      if (!row) return null;
      await authorizeStored(transaction, row, authorization);
      return snapshot(row, authorization);
    }),
  );
}

export async function readCanonicalAmoCrmBindings(
  rawInput: ReadCanonicalAmoCrmBindingsInput,
): Promise<CanonicalAmoCrmBindingsSnapshot> {
  const accountId = uuid(rawInput.accountId);
  const authorization = parseAuthorization(rawInput.authorization);
  const personId = uuid(rawInput.personId);
  const leadId = uuid(rawInput.leadId);
  if (leadId !== authorization.workflowLeadId) repositoryError("forbidden");
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      const [account] = await transaction
        .select({ id: evoAmoCrmAccounts.id })
        .from(evoAmoCrmAccounts)
        .where(eq(evoAmoCrmAccounts.id, accountId))
        .limit(1);
      if (!account) repositoryError("not_found");
      await assertWorkflowAuthorization(transaction, authorization, personId);
      const [contactBinding] = await transaction
        .select({ providerId: evoAmoCrmContactBindings.providerContactId })
        .from(evoAmoCrmContactBindings)
        .where(
          and(
            eq(evoAmoCrmContactBindings.accountId, accountId),
            eq(evoAmoCrmContactBindings.personId, personId),
          ),
        )
        .limit(1);
      const [leadBinding] = await transaction
        .select({ providerId: evoAmoCrmLeadBindings.providerLeadId })
        .from(evoAmoCrmLeadBindings)
        .where(
          and(
            eq(evoAmoCrmLeadBindings.accountId, accountId),
            eq(evoAmoCrmLeadBindings.leadId, leadId),
          ),
        )
        .limit(1);
      return Object.freeze({
        contactId: contactBinding?.providerId ?? null,
        leadId: leadBinding?.providerId ?? null,
      });
    }),
  );
}

export async function readBlockingCanonicalAmoCrmCommand(
  rawInput: ReadBlockingCanonicalAmoCrmCommandInput,
): Promise<CanonicalAmoCrmCommandSnapshot | null> {
  const authorization = parseAuthorization(rawInput.authorization);
  const personId = uuid(rawInput.personId);
  const leadId = uuid(rawInput.leadId);
  if (leadId !== authorization.workflowLeadId) repositoryError("forbidden");
  const businessObjectType =
    authorization.workflowScope === "sales_pre_handoff"
      ? "amocrm_sales_lead"
      : "amocrm_admissions_case";
  const businessObjectId =
    authorization.workflowScope === "sales_pre_handoff"
      ? authorization.workflowLeadId
      : (authorization.studentCaseId as string);

  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      await assertWorkflowAuthorization(transaction, authorization, personId);
      const [row] = await transaction
        .select(attemptSelection)
        .from(evoAmoCrmOperationAttempts)
        .innerJoin(
          evoCommandReceipts,
          eq(evoCommandReceipts.id, evoAmoCrmOperationAttempts.commandReceiptId),
        )
        .where(
          and(
            inArray(evoAmoCrmOperationAttempts.status, ["prepared", "unknown"]),
            eq(evoCommandReceipts.businessObjectType, businessObjectType),
            eq(evoCommandReceipts.businessObjectId, businessObjectId),
            or(
              eq(evoAmoCrmOperationAttempts.personId, personId),
              eq(evoAmoCrmOperationAttempts.leadId, leadId),
            ),
          ),
        )
        .orderBy(
          evoAmoCrmOperationAttempts.createdAt,
          evoAmoCrmOperationAttempts.id,
        )
        .limit(1);
      if (!row) return null;
      assertStoredWorkflow(row as StoredAttemptRow, authorization);
      return snapshot(row as StoredAttemptRow, authorization);
    }),
  );
}

export async function claimCanonicalAmoCrmCommandDispatch(
  rawAttemptId: string,
  rawAuthorization: CanonicalAmoCrmWorkflowAuthorization,
): Promise<
  | Readonly<{ kind: "claimed" | "replay"; attempt: CanonicalAmoCrmCommandSnapshot }>
  | Readonly<{
      kind: "blocked";
      reason: "dispatch_already_claimed";
      attempt: CanonicalAmoCrmCommandSnapshot;
    }>
> {
  const attemptId = uuid(rawAttemptId);
  const authorization = parseAuthorization(rawAuthorization);
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`amocrm-attempt:${attemptId}`}, 0))`,
      );
      const row = await selectByAttemptId(transaction, attemptId);
      if (!row) repositoryError("not_found");
      await authorizeStored(transaction, row, authorization);
      if (row.status !== "prepared") {
        return Object.freeze({
          kind: "replay" as const,
          attempt: snapshot(row, authorization),
        });
      }
      if (row.providerDispatchedAt !== null) {
        return Object.freeze({
          kind: "blocked" as const,
          reason: "dispatch_already_claimed" as const,
          attempt: snapshot(row, authorization),
        });
      }
      const [claimed] = await transaction
        .update(evoAmoCrmOperationAttempts)
        .set({
          providerDispatchedAt: new Date(),
          updatedAt: new Date(),
          version: sql`${evoAmoCrmOperationAttempts.version} + 1`,
        })
        .where(
          and(
            eq(evoAmoCrmOperationAttempts.id, attemptId),
            eq(evoAmoCrmOperationAttempts.status, "prepared"),
            isNull(evoAmoCrmOperationAttempts.providerDispatchedAt),
          ),
        )
        .returning({ id: evoAmoCrmOperationAttempts.id });
      if (!claimed) repositoryError("state_conflict");
      const updated = await selectByAttemptId(transaction, attemptId);
      if (!updated) repositoryError("unavailable");
      return Object.freeze({
        kind: "claimed" as const,
        attempt: snapshot(updated, authorization),
      });
    }),
  );
}

function parseSettlement(
  outcome: SettleCanonicalAmoCrmCommandOutcome,
): NormalizedSettlement {
  if (outcome.status === "accepted") {
    const readback = canonicalObject(outcome.providerReadback);
    const result = {
      status: "accepted" as const,
      providerHttpStatus: boundedInteger(outcome.providerHttpStatus, 200, 299),
      providerRequestId:
        outcome.providerRequestId === null
          ? null
          : exactText(outcome.providerRequestId, 255),
      providerRespondedAt: timestamp(outcome.providerRespondedAt),
      providerReadback: readback,
      providerReadbackSha256: sha256(readback),
      providerReadbackAt: timestamp(outcome.providerReadbackAt),
      resultContactId: optionalProviderId(outcome.resultContactId),
      resultLeadId: optionalProviderId(outcome.resultLeadId),
      providerUpdatedAt: optionalTimestamp(outcome.providerUpdatedAt),
      failureCode: null,
    };
    return Object.freeze(result);
  }
  const failureCode = exactText(outcome.failureCode, 80);
  const readback =
    outcome.providerReadback === null || outcome.providerReadback === undefined
      ? null
      : canonicalObject(outcome.providerReadback);
  const readbackAt = optionalTimestamp(outcome.providerReadbackAt);
  if ((readback === null) !== (readbackAt === null)) repositoryError("invalid_input");
  if (outcome.status === "rejected") {
    return Object.freeze({
      status: "rejected" as const,
      providerHttpStatus: boundedInteger(outcome.providerHttpStatus, 300, 599),
      providerRequestId:
        outcome.providerRequestId === null
          ? null
          : exactText(outcome.providerRequestId, 255),
      providerRespondedAt: timestamp(outcome.providerRespondedAt),
      providerReadback: readback,
      providerReadbackSha256: readback === null ? null : sha256(readback),
      providerReadbackAt: readbackAt,
      resultContactId: null,
      resultLeadId: null,
      providerUpdatedAt: null,
      failureCode,
    });
  }
  const respondedAt = optionalTimestamp(outcome.providerRespondedAt);
  const httpStatus =
    outcome.providerHttpStatus === null || outcome.providerHttpStatus === undefined
      ? null
      : boundedInteger(outcome.providerHttpStatus, 100, 599);
  const requestId =
    outcome.providerRequestId === null || outcome.providerRequestId === undefined
      ? null
      : exactText(outcome.providerRequestId, 255);
  if ((respondedAt === null) !== (httpStatus === null) || (respondedAt === null && requestId !== null)) {
    repositoryError("invalid_input");
  }
  return Object.freeze({
    status: "unknown" as const,
    providerHttpStatus: httpStatus,
    providerRequestId: requestId,
    providerRespondedAt: respondedAt,
    providerReadback: readback,
    providerReadbackSha256: readback === null ? null : sha256(readback),
    providerReadbackAt: readbackAt,
    resultContactId: null,
    resultLeadId: null,
    providerUpdatedAt: null,
    failureCode,
  });
}

function assertAcceptedResultMatchesOperation(
  row: StoredAttemptRow,
  outcome: NormalizedSettlement,
): void {
  if (outcome.status !== "accepted") return;
  if (
    (row.operationName === "contact_create" &&
      (outcome.resultContactId === null || outcome.resultLeadId !== null)) ||
    (row.operationName === "contact_update" &&
      (outcome.resultContactId !== row.targetContactId || outcome.resultLeadId !== null)) ||
    (row.operationName === "lead_create" &&
      (outcome.resultContactId !== null || outcome.resultLeadId === null)) ||
    ((row.operationName === "lead_update" ||
      row.operationName === "lead_pipeline_status_update" ||
      row.operationName === "lead_responsible_update" ||
      row.operationName === "lead_note_create" ||
      row.operationName === "lead_tag_update") &&
      (outcome.resultContactId !== null || outcome.resultLeadId !== row.targetLeadId)) ||
    (row.operationName === "contact_lead_link" &&
      (outcome.resultContactId !== row.targetContactId ||
        outcome.resultLeadId !== row.targetLeadId))
  ) {
    repositoryError("invalid_input");
  }
}

function isExactSettlementReplay(
  row: StoredAttemptRow,
  outcome: NormalizedSettlement,
): boolean {
  return (
    row.status === outcome.status &&
    row.providerHttpStatus === outcome.providerHttpStatus &&
    row.providerRequestId === outcome.providerRequestId &&
    iso(row.providerRespondedAt) === iso(outcome.providerRespondedAt) &&
    row.providerReadbackSha256 === outcome.providerReadbackSha256 &&
    iso(row.providerReadbackAt) === iso(outcome.providerReadbackAt) &&
    row.resultContactId === outcome.resultContactId &&
    row.resultLeadId === outcome.resultLeadId &&
    row.failureCode === outcome.failureCode
  );
}

function assertTransportOrder(
  row: StoredAttemptRow,
  outcome: NormalizedSettlement,
): void {
  const dispatchedAt = row.providerDispatchedAt?.getTime();
  if (dispatchedAt === undefined) repositoryError("state_conflict");
  if (
    (outcome.providerRespondedAt !== null &&
      outcome.providerRespondedAt.getTime() < dispatchedAt) ||
    (outcome.providerReadbackAt !== null &&
      outcome.providerReadbackAt.getTime() < dispatchedAt)
  ) {
    repositoryError("invalid_input");
  }
}

async function insertAcceptedCreateBinding(
  transaction: DatabaseTransaction,
  row: StoredAttemptRow,
  outcome: NormalizedSettlement,
): Promise<void> {
  if (outcome.status !== "accepted") return;
  const now = new Date();
  if (row.operationName === "contact_create") {
    await transaction.insert(evoAmoCrmContactBindings).values({
      id: randomUUID(),
      accountId: row.accountId,
      personId: row.personId as string,
      providerContactId: outcome.resultContactId as string,
      createdByAttemptId: row.attemptId,
      createdByAttemptStatus: "accepted",
      providerUpdatedAt: outcome.providerUpdatedAt,
      lastVerifiedAt: now,
    });
  }
  if (row.operationName === "lead_create") {
    await transaction.insert(evoAmoCrmLeadBindings).values({
      id: randomUUID(),
      accountId: row.accountId,
      leadId: row.leadId as string,
      providerLeadId: outcome.resultLeadId as string,
      createdByAttemptId: row.attemptId,
      createdByAttemptStatus: "accepted",
      providerUpdatedAt: outcome.providerUpdatedAt,
      lastVerifiedAt: now,
    });
  }
}

function receiptResult(row: StoredAttemptRow, outcome: NormalizedSettlement) {
  return {
    attemptId: row.attemptId,
    provider: "amocrm",
    operationName: row.operationName,
    status: outcome.status,
    resultContactId: outcome.resultContactId,
    resultLeadId: outcome.resultLeadId,
    providerHttpStatus: outcome.providerHttpStatus,
    providerRequestId: outcome.providerRequestId,
    providerReadbackSha256: outcome.providerReadbackSha256,
  };
}

async function settlePreparedRow(
  transaction: DatabaseTransaction,
  row: StoredAttemptRow,
  outcome: NormalizedSettlement,
  expectedStatus: "prepared" | "unknown",
  reconciled: boolean,
): Promise<void> {
  assertAcceptedResultMatchesOperation(row, outcome);
  assertTransportOrder(row, outcome);
  const now = new Date();
  const [updated] = await transaction
    .update(evoAmoCrmOperationAttempts)
    .set({
      status: outcome.status,
      resultContactId: outcome.resultContactId,
      resultLeadId: outcome.resultLeadId,
      providerHttpStatus: outcome.providerHttpStatus,
      providerRequestId: outcome.providerRequestId,
      providerRespondedAt: outcome.providerRespondedAt,
      providerReadback: outcome.providerReadback,
      providerReadbackSha256: outcome.providerReadbackSha256,
      providerReadbackAt: outcome.providerReadbackAt,
      failureCode: outcome.failureCode,
      settledAt: now,
      lastReconciledAt: reconciled ? now : null,
      updatedAt: now,
      version: sql`${evoAmoCrmOperationAttempts.version} + 1`,
    })
    .where(
      and(
        eq(evoAmoCrmOperationAttempts.id, row.attemptId),
        eq(evoAmoCrmOperationAttempts.status, expectedStatus),
      ),
    )
    .returning({ id: evoAmoCrmOperationAttempts.id });
  if (!updated) repositoryError("state_conflict");
  await insertAcceptedCreateBinding(transaction, row, outcome);
  if (outcome.status === "accepted") {
    await transaction
      .update(evoCommandReceipts)
      .set({
        status: "succeeded",
        resultPayload: receiptResult(row, outcome),
        failureCode: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(evoCommandReceipts.id, row.commandReceiptId));
  } else if (outcome.status === "rejected") {
    await transaction
      .update(evoCommandReceipts)
      .set({
        status: "failed",
        resultPayload: null,
        failureCode: outcome.failureCode,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(evoCommandReceipts.id, row.commandReceiptId));
  }
}

export async function settleCanonicalAmoCrmCommand(
  rawAttemptId: string,
  rawAuthorization: CanonicalAmoCrmWorkflowAuthorization,
  rawOutcome: SettleCanonicalAmoCrmCommandOutcome,
): Promise<Readonly<{ kind: "settled" | "replay"; attempt: CanonicalAmoCrmCommandSnapshot }>> {
  const attemptId = uuid(rawAttemptId);
  const authorization = parseAuthorization(rawAuthorization);
  const outcome = parseSettlement(rawOutcome);
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`amocrm-attempt:${attemptId}`}, 0))`,
      );
      const row = await selectByAttemptId(transaction, attemptId);
      if (!row) repositoryError("not_found");
      await authorizeStored(transaction, row, authorization);
      if (row.status !== "prepared") {
        if (!isExactSettlementReplay(row, outcome)) repositoryError("state_conflict");
        return Object.freeze({
          kind: "replay" as const,
          attempt: snapshot(row, authorization),
        });
      }
      if (row.providerDispatchedAt === null) repositoryError("state_conflict");
      await settlePreparedRow(transaction, row, outcome, "prepared", false);
      const settled = await selectByAttemptId(transaction, attemptId);
      if (!settled) repositoryError("unavailable");
      return Object.freeze({
        kind: "settled" as const,
        attempt: snapshot(settled, authorization),
      });
    }),
  );
}

export async function reconcileUnknownCanonicalAmoCrmCommand(
  rawAttemptId: string,
  rawAuthorization: CanonicalAmoCrmWorkflowAuthorization,
  rawOutcome: ReconcileUnknownCanonicalAmoCrmCommandOutcome,
): Promise<Readonly<{ kind: "reconciled" | "unchanged" | "replay"; attempt: CanonicalAmoCrmCommandSnapshot }>> {
  const attemptId = uuid(rawAttemptId);
  const authorization = parseAuthorization(rawAuthorization);
  const accepted = rawOutcome.status === "accepted" ? parseSettlement(rawOutcome) : null;
  const failureCode =
    rawOutcome.status === "still_unknown" ? exactText(rawOutcome.failureCode, 80) : null;
  const readback =
    rawOutcome.status === "still_unknown" &&
    rawOutcome.providerReadback !== null &&
    rawOutcome.providerReadback !== undefined
      ? canonicalObject(rawOutcome.providerReadback)
      : null;
  const readbackAt =
    rawOutcome.status === "still_unknown"
      ? optionalTimestamp(rawOutcome.providerReadbackAt)
      : null;
  if (rawOutcome.status === "still_unknown" && (readback === null) !== (readbackAt === null)) {
    repositoryError("invalid_input");
  }
  return repositoryOperation(() =>
    getDatabase().transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`amocrm-attempt:${attemptId}`}, 0))`,
      );
      const row = await selectByAttemptId(transaction, attemptId);
      if (!row) repositoryError("not_found");
      await authorizeStored(transaction, row, authorization);
      if (
        accepted &&
        row.status === "accepted" &&
        isExactSettlementReplay(row, accepted)
      ) {
        return Object.freeze({
          kind: "replay" as const,
          attempt: snapshot(row, authorization),
        });
      }
      const claimedPrepared =
        row.status === "prepared" && row.providerDispatchedAt !== null;
      if (row.status !== "unknown" && !claimedPrepared) {
        repositoryError("state_conflict");
      }
      const sourceStatus = row.status as "prepared" | "unknown";
      if (accepted) {
        await settlePreparedRow(
          transaction,
          row,
          accepted,
          sourceStatus,
          true,
        );
        const reconciled = await selectByAttemptId(transaction, attemptId);
        if (!reconciled) repositoryError("unavailable");
        return Object.freeze({
          kind: "reconciled" as const,
          attempt: snapshot(reconciled, authorization),
        });
      }
      const now = new Date();
      const [updated] = await transaction
        .update(evoAmoCrmOperationAttempts)
        .set({
          status: "unknown",
          failureCode,
          providerReadback: readback ?? row.providerReadback,
          providerReadbackSha256:
            readback === null ? row.providerReadbackSha256 : sha256(readback),
          providerReadbackAt: readbackAt ?? row.providerReadbackAt,
          settledAt: sourceStatus === "prepared" ? now : row.settledAt,
          lastReconciledAt: now,
          updatedAt: now,
          version: sql`${evoAmoCrmOperationAttempts.version} + 1`,
        })
        .where(
          and(
            eq(evoAmoCrmOperationAttempts.id, attemptId),
            eq(evoAmoCrmOperationAttempts.status, sourceStatus),
          ),
        )
        .returning({ id: evoAmoCrmOperationAttempts.id });
      if (!updated) repositoryError("state_conflict");
      const unchanged = await selectByAttemptId(transaction, attemptId);
      if (!unchanged) repositoryError("unavailable");
      return Object.freeze({
        kind: "unchanged" as const,
        attempt: snapshot(unchanged, authorization),
      });
    }),
  );
}
