import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";

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
  stage: string;
  ownerRole: FixedRole;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CanonicalStudentCaseSnapshot = Readonly<{
  studentCaseId: string;
  leadId: string;
  personId: string;
  displayName: string;
  status: string;
  assignedRole: FixedRole;
  version: number;
  createdAt: string;
  updatedAt: string;
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

function databaseStudentCaseStatus(value: string): CanonicalStudentCaseStatus {
  if (!isCanonicalStudentCaseStatus(value)) {
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
    ownerRole: databaseRole(row.ownerRole),
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
    assignedRole: databaseRole(row.assignedRole),
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
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

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`whatsapp:${externalConversationId}:${externalMessageId}`}, 0))`,
    );

    const [lead] = await transaction
      .select({ id: evoLeads.id })
      .from(evoLeads)
      .where(eq(evoLeads.id, leadId))
      .limit(1);
    if (!lead) throw new CanonicalCrmRepositoryError("not_found");

    let [conversation] = await transaction
      .select({ id: evoConversations.id, leadId: evoConversations.leadId })
      .from(evoConversations)
      .where(
        and(
          eq(evoConversations.channel, "whatsapp"),
          eq(evoConversations.externalConversationId, externalConversationId),
        ),
      )
      .limit(1);

    if (!conversation) {
      const proposedConversationId = randomUUID();
      const [createdConversation] = await transaction
        .insert(evoConversations)
        .values({
          id: proposedConversationId,
          leadId,
          channel: "whatsapp",
          externalConversationId,
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
                externalConversationId,
              ),
            ),
          )
          .limit(1);
      }
    }
    if (!conversation) throw new CanonicalCrmRepositoryError("unavailable");
    if (conversation.leadId !== leadId) {
      throw new CanonicalCrmRepositoryError("conflict");
    }

    const [duplicateMessage] = await transaction
      .select({
        id: evoMessages.id,
        conversationId: evoMessages.conversationId,
        body: evoMessages.body,
        occurredAt: evoMessages.occurredAt,
      })
      .from(evoMessages)
      .where(
        and(
          eq(evoMessages.conversationId, conversation.id),
          eq(evoMessages.externalMessageId, externalMessageId),
        ),
      )
      .limit(1);

    let messageId: string;
    if (duplicateMessage) {
      if (
        duplicateMessage.body !== body ||
        duplicateMessage.occurredAt.getTime() !== occurredAt.getTime()
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
        externalMessageId,
        body,
        authorRole: null,
        occurredAt,
        correlationId: context.correlationId,
        idempotencyKey: context.idempotencyKey,
      });
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "message",
        businessObjectId: messageId,
        transition: "message.received",
        toState: "received",
      });
    }

    const result = { conversationId: conversation.id, messageId, leadId };
    await completeCommand(transaction, {
      receiptId: reservation.receiptId,
      businessObjectType: "message",
      businessObjectId: messageId,
      resultPayload: result,
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
    adminOverride?: Readonly<{ reason: string }> | null;
  }>,
): Promise<CanonicalHandoffResult> {
  const context = parseCommandContext(input, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
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
      })
      .from(evoLeads)
      .where(eq(evoLeads.id, leadId))
      .limit(1)
      .for("update");
    if (!lead) throw new CanonicalCrmRepositoryError("not_found");
    if (lead.stage !== "qualified" && lead.stage !== "handoff_ready") {
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
      .select({ id: evoStudentCases.id })
      .from(evoStudentCases)
      .where(eq(evoStudentCases.leadId, leadId))
      .limit(1);
    let studentCaseCreated = false;
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
        .returning({ id: evoStudentCases.id });
      studentCaseCreated = true;
    }
    if (!studentCase) throw new CanonicalCrmRepositoryError("unavailable");

    if (studentCaseCreated) {
      await insertBusinessEvent(transaction, {
        context,
        businessObjectType: "student_case",
        businessObjectId: studentCase.id,
        transition: "student_case.created",
        toState: "active",
        eventSequence: 1,
      });
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
      eventSequence: studentCaseCreated ? 2 : 1,
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

export async function getCanonicalLeadSnapshot(
  input: Readonly<{ actorRole: FixedRole; leadId: string }>,
): Promise<CanonicalLeadSnapshot> {
  actorRole(input.actorRole, ["admin", "sales"]);
  const leadId = uuid(input.leadId);
  return runTransaction((transaction) =>
    selectLeadSnapshot(transaction, leadId),
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
