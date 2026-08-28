import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANONICAL_SALES_DUE_FILTERS,
  CANONICAL_SALES_STAGES,
  CANONICAL_STUDENT_CASE_STATUSES,
  CanonicalCrmRepositoryError,
  appendCanonicalInboundMessage,
  createCanonicalPersonLead,
  getCanonicalLeadConversationThread,
  getCanonicalLeadGateSnapshot,
  getCanonicalLeadSnapshot,
  getCanonicalStudentCaseHandoffSnapshot,
  getCanonicalStudentCaseSnapshot,
  handoffCanonicalLeadToAdmissions,
  listCanonicalLeadConversations,
  listCanonicalSalesLeads,
  listCanonicalStudentCases,
  normalizeCanonicalPersonIdentity,
  parseCanonicalMessageCursor,
  parseCanonicalReadCursor,
  recordCanonicalSalesGateEvidence,
  updateCanonicalSalesLeadWorkflow,
} from "../src/lib/server/canonical-crm-repository.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function rejectsWithCode(code) {
  return (error) =>
    error instanceof CanonicalCrmRepositoryError &&
    error.code === code &&
    error.message === "Canonical CRM operation failed.";
}

test("canonical person identity normalization is deterministic", () => {
  assert.deepEqual(
    normalizeCanonicalPersonIdentity({
      displayName: "  Technical   Subject ",
      email: "  SUBJECT@ACCEPTANCE.INVALID ",
      phone: " +996 (555) 12-34-56 ",
    }),
    {
      displayName: "Technical Subject",
      normalizedEmail: "subject@acceptance.invalid",
      normalizedPhone: "+996555123456",
    },
  );
});

test("canonical read cursor normalizes one real timestamp and non-nil UUID pair", () => {
  assert.deepEqual(CANONICAL_SALES_STAGES, [
    "new",
    "qualifying",
    "qualified",
    "disqualified",
    "handoff_ready",
    "handed_off",
  ]);
  assert.deepEqual(CANONICAL_SALES_DUE_FILTERS, [
    "all",
    "scheduled",
    "unscheduled",
    "due_today",
    "overdue",
  ]);
  assert.deepEqual(CANONICAL_STUDENT_CASE_STATUSES, [
    "active",
    "paused",
    "closed",
  ]);
  assert.deepEqual(
    parseCanonicalReadCursor("2026-08-28T16:30:00+04:00", UUID_B),
    {
      updatedAt: "2026-08-28T12:30:00.000Z",
      id: UUID_B,
    },
  );

  for (const [updatedAt, id] of [
    [undefined, UUID_B],
    ["2026-08-28T12:30:00.000Z", undefined],
    ["2026-02-30T12:30:00.000Z", UUID_B],
    ["2026-08-28", UUID_B],
    ["2026-08-28T12:30:00.000Z", "00000000-0000-0000-0000-000000000000"],
  ]) {
    assert.throws(
      () => parseCanonicalReadCursor(updatedAt, id),
      rejectsWithCode("invalid_input"),
    );
  }
});

test("canonical message cursor normalizes one real timestamp and non-nil UUID pair", () => {
  assert.deepEqual(
    parseCanonicalMessageCursor("2026-08-28T16:30:00+04:00", UUID_B),
    {
      occurredAt: "2026-08-28T12:30:00.000Z",
      id: UUID_B,
    },
  );

  for (const [occurredAt, id] of [
    [undefined, UUID_B],
    ["2026-08-28T12:30:00.000Z", undefined],
    ["2026-02-30T12:30:00.000Z", UUID_B],
    ["2026-08-28T25:30:00.000Z", UUID_B],
    ["2026-08-28T12:30:00.000Z", "not-a-uuid"],
  ]) {
    assert.throws(
      () => parseCanonicalMessageCursor(occurredAt, id),
      rejectsWithCode("invalid_input"),
    );
  }
});

test("Sales conversation reads reject Admissions before database access", async () => {
  await assert.rejects(
    listCanonicalLeadConversations({
      actorRole: "admissions",
      leadId: UUID_A,
    }),
    rejectsWithCode("forbidden"),
  );
  await assert.rejects(
    getCanonicalLeadConversationThread({
      actorRole: "admissions",
      leadId: UUID_A,
      conversationId: UUID_B,
    }),
    rejectsWithCode("forbidden"),
  );
});

test("canonical phone normalization rejects letters instead of deleting them", () => {
  assert.throws(
    () =>
      normalizeCanonicalPersonIdentity({
        displayName: "Technical Subject",
        phone: "+971 50 CALL-NOW",
      }),
    rejectsWithCode("invalid_input"),
  );
});

test("person and lead command rejects malformed identity before database access", async () => {
  await assert.rejects(
    createCanonicalPersonLead({
      actorRole: "sales",
      idempotencyKey: "lead:create:1",
      correlationId: "request:1",
      displayName: "Technical Subject",
      email: "not-an-email",
      phone: "+996555123456",
      source: "whatsapp",
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("admissions cannot mutate the Sales-owned canonical intake surface", async () => {
  await assert.rejects(
    createCanonicalPersonLead({
      actorRole: "admissions",
      idempotencyKey: "lead:create:2",
      correlationId: "request:2",
      displayName: "Technical Subject",
      email: "subject@acceptance.invalid",
      phone: "+996555123456",
      source: "whatsapp",
    }),
    rejectsWithCode("forbidden"),
  );

  await assert.rejects(
    appendCanonicalInboundMessage({
      actorRole: "admissions",
      idempotencyKey: "message:receive:1",
      correlationId: "request:3",
      leadId: UUID_A,
      channel: "whatsapp",
      externalConversationId: "chat-1",
      externalMessageId: "message-1",
      body: "Inbound text",
      occurredAt: "2026-08-28T12:00:00.000Z",
    }),
    rejectsWithCode("forbidden"),
  );
});

test("all consequential commands require bounded idempotency and correlation keys", async () => {
  const common = {
    actorRole: "sales",
    idempotencyKey: " ",
    correlationId: "request:4",
  };

  await assert.rejects(
    recordCanonicalSalesGateEvidence({
      ...common,
      leadId: UUID_A,
      evidenceType: "contract",
      decision: "confirmed",
      evidenceReference: "contract-1",
      occurredAt: "2026-08-28T12:00:00.000Z",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    handoffCanonicalLeadToAdmissions({
      ...common,
      leadId: UUID_A,
      expectedVersion: 1,
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("first-payment evidence requires a positive minor amount and ISO currency", async () => {
  await assert.rejects(
    recordCanonicalSalesGateEvidence({
      actorRole: "sales",
      idempotencyKey: "gate:payment:1",
      correlationId: "request:5",
      leadId: UUID_A,
      evidenceType: "first_payment",
      decision: "confirmed",
      evidenceReference: "receipt-1",
      amountMinor: 0,
      currency: "usd",
      occurredAt: "2026-08-28T12:00:00.000Z",
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("only Admin can request a gate override and a reason is mandatory", async () => {
  await assert.rejects(
    handoffCanonicalLeadToAdmissions({
      actorRole: "sales",
      idempotencyKey: "handoff:1",
      correlationId: "request:6",
      leadId: UUID_A,
      expectedVersion: 1,
      adminOverride: { reason: "Director exception" },
    }),
    rejectsWithCode("forbidden"),
  );

  await assert.rejects(
    handoffCanonicalLeadToAdmissions({
      actorRole: "admin",
      idempotencyKey: "handoff:2",
      correlationId: "request:7",
      leadId: UUID_A,
      expectedVersion: 1,
      adminOverride: { reason: " " },
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("handoff requires a positive expected lead version", async () => {
  await assert.rejects(
    handoffCanonicalLeadToAdmissions({
      actorRole: "sales",
      idempotencyKey: "handoff:version",
      correlationId: "request:version",
      leadId: UUID_A,
      expectedVersion: 0,
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("snapshot reads reject malformed UUIDs before database access", async () => {
  await assert.rejects(
    getCanonicalLeadSnapshot({ actorRole: "sales", leadId: "lead-1" }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    getCanonicalLeadGateSnapshot({ actorRole: "sales", leadId: "lead-1" }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    getCanonicalStudentCaseSnapshot({
      actorRole: "admissions",
      studentCaseId: "case-1",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    getCanonicalStudentCaseHandoffSnapshot({
      actorRole: "admissions",
      studentCaseId: "case-1",
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("gate and handoff reads enforce the fixed role boundary before database access", async () => {
  await assert.rejects(
    getCanonicalLeadGateSnapshot({ actorRole: "admissions", leadId: UUID_A }),
    rejectsWithCode("forbidden"),
  );
  await assert.rejects(
    getCanonicalStudentCaseHandoffSnapshot({
      actorRole: "sales",
      studentCaseId: UUID_A,
    }),
    rejectsWithCode("forbidden"),
  );
});

test("student case queue enforces role and bounded read inputs before database access", async () => {
  await assert.rejects(
    listCanonicalStudentCases({ actorRole: "sales" }),
    rejectsWithCode("forbidden"),
  );

  for (const pageSize of [0, 51, 1.5, "25"]) {
    await assert.rejects(
      listCanonicalStudentCases({ actorRole: "admin", pageSize }),
      rejectsWithCode("invalid_input"),
    );
  }
  await assert.rejects(
    listCanonicalStudentCases({ actorRole: "admin", status: "blocked" }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    listCanonicalStudentCases({ actorRole: "admissions", query: "x".repeat(121) }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    listCanonicalStudentCases({
      actorRole: "admin",
      cursor: {
        updatedAt: "2026-08-28T12:30:00.000Z",
        id: UUID_B,
        extra: "second-token",
      },
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("Sales lead queue enforces role and bounded read inputs before database access", async () => {
  await assert.rejects(
    listCanonicalSalesLeads({ actorRole: "admissions" }),
    rejectsWithCode("forbidden"),
  );

  for (const pageSize of [0, 51, 1.5, "25"]) {
    await assert.rejects(
      listCanonicalSalesLeads({ actorRole: "admin", pageSize }),
      rejectsWithCode("invalid_input"),
    );
  }
  await assert.rejects(
    listCanonicalSalesLeads({ actorRole: "sales", stage: "prospect" }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    listCanonicalSalesLeads({ actorRole: "admin", due: "tomorrow" }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    listCanonicalSalesLeads({ actorRole: "sales", query: "x".repeat(121) }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    listCanonicalSalesLeads({
      actorRole: "admin",
      cursor: {
        updatedAt: "2026-08-28T12:30:00.000Z",
        id: UUID_A,
        extra: "second-token",
      },
    }),
    rejectsWithCode("invalid_input"),
  );
});

const VALID_SALES_WORKFLOW_CONTEXT = {
  actorRole: "sales",
  idempotencyKey: "sales-workflow:update:1",
  correlationId: "request:sales-workflow:1",
};

const VALID_SALES_WORKFLOW_INPUT = {
  leadId: UUID_A,
  expectedVersion: 1,
  stage: "qualifying",
  qualificationSummary: null,
  nextAction: "Confirm the technical follow-up",
  nextActionAt: "2026-08-29",
  reason: null,
};

test("Admissions cannot mutate the canonical Sales workflow", async () => {
  await assert.rejects(
    updateCanonicalSalesLeadWorkflow(
      { ...VALID_SALES_WORKFLOW_CONTEXT, actorRole: "admissions" },
      VALID_SALES_WORKFLOW_INPUT,
    ),
    rejectsWithCode("forbidden"),
  );
});

test("normal Sales workflow updates cannot manufacture handed_off", async () => {
  await assert.rejects(
    updateCanonicalSalesLeadWorkflow(VALID_SALES_WORKFLOW_CONTEXT, {
      ...VALID_SALES_WORKFLOW_INPUT,
      stage: "handed_off",
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("active Sales workflow stages require a meaningful action and exact real date", async () => {
  for (const patch of [
    { nextAction: " " },
    { nextActionAt: "2026-02-30" },
    { nextActionAt: "2026-8-29" },
  ]) {
    await assert.rejects(
      updateCanonicalSalesLeadWorkflow(VALID_SALES_WORKFLOW_CONTEXT, {
        ...VALID_SALES_WORKFLOW_INPUT,
        ...patch,
      }),
      rejectsWithCode("invalid_input"),
    );
  }
});

test("qualified Sales workflow stages require a qualification summary", async () => {
  for (const stage of ["qualified", "handoff_ready"]) {
    await assert.rejects(
      updateCanonicalSalesLeadWorkflow(VALID_SALES_WORKFLOW_CONTEXT, {
        ...VALID_SALES_WORKFLOW_INPUT,
        stage,
        qualificationSummary: " ",
      }),
      rejectsWithCode("invalid_input"),
    );
  }
});

test("disqualification requires a reason and optimistic version is positive", async () => {
  await assert.rejects(
    updateCanonicalSalesLeadWorkflow(VALID_SALES_WORKFLOW_CONTEXT, {
      ...VALID_SALES_WORKFLOW_INPUT,
      stage: "disqualified",
      reason: " ",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    updateCanonicalSalesLeadWorkflow(VALID_SALES_WORKFLOW_CONTEXT, {
      ...VALID_SALES_WORKFLOW_INPUT,
      expectedVersion: 0,
    }),
    rejectsWithCode("invalid_input"),
  );
});

test("canonical repository has no Supabase, SQLite, compatibility, or fallback authority", async () => {
  const source = await readFile(
    new URL("../src/lib/server/canonical-crm-repository.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /supabase|sqlite|compatib(?:ility|le)|fallback/i);
  assert.match(source, /getDatabase/);
  assert.match(source, /\.transaction\(/);
  assert.doesNotMatch(
    source,
    /export\s+(?:async\s+)?function\s+createCanonicalStudentCase\b/,
  );
  assert.doesNotMatch(
    source,
    /export\s+(?:async\s+)?function\s+appendCanonicalBusinessEvent\b/,
  );
  assert.match(source, /async function insertBusinessEvent\b/);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(
    source,
    /eq\(evoCommandReceipts\.idempotencyKey, input\.context\.idempotencyKey\)/,
  );
  assert.match(
    source,
    /lead\.stage === "disqualified" \|\| lead\.stage === "handed_off"/,
  );
  assert.match(
    source,
    /lead\.stage !== "qualified" && lead\.stage !== "handoff_ready"/,
  );
  assert.match(source, /transition: "student_case\.created"/);
  assert.match(source, /eventSequence: studentCaseCreated \? 2 : 1/);
});
