import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANONICAL_SALES_STAGES,
  CANONICAL_STUDENT_CASE_STATUSES,
  CanonicalCrmRepositoryError,
  createCanonicalPersonLead,
  getCanonicalLeadGateSnapshot,
  getCanonicalLeadSnapshot,
  getCanonicalStudentCaseHandoffSnapshot,
  handoffCanonicalLeadToAdmissions,
  listCanonicalStudentCases,
  normalizeCanonicalPersonIdentity,
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

test("admissions cannot create a Sales-owned canonical lead", async () => {
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

test("remaining legacy-isolated snapshots reject malformed UUIDs before database access", async () => {
  await assert.rejects(
    getCanonicalLeadSnapshot({ actorRole: "sales", leadId: "lead-1" }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    getCanonicalLeadGateSnapshot({ actorRole: "sales", leadId: "lead-1" }),
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

test("canonical repository retains only non-communication Drizzle authority", async () => {
  const repositorySource = await readFile(
    new URL("../src/lib/server/canonical-crm-repository.ts", import.meta.url),
    "utf8",
  );
  const coreSchemaSource = await readFile(
    new URL("../src/db/schema/canonical-crm-core.ts", import.meta.url),
    "utf8",
  );
  const operationsSchemaSource = await readFile(
    new URL("../src/db/schema/canonical-crm-operations.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    repositorySource,
    /supabase|sqlite|compatib(?:ility|le)|fallback/i,
  );
  assert.match(repositorySource, /getDatabase/);
  assert.match(repositorySource, /\.transaction\(/);
  assert.doesNotMatch(
    repositorySource,
    /export\s+(?:async\s+)?function\s+createCanonicalStudentCase\b/,
  );
  assert.doesNotMatch(
    repositorySource,
    /export\s+(?:async\s+)?function\s+appendCanonicalBusinessEvent\b/,
  );
  assert.match(repositorySource, /async function insertBusinessEvent\b/);
  assert.match(repositorySource, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(
    repositorySource,
    /eq\(evoCommandReceipts\.idempotencyKey, input\.context\.idempotencyKey\)/,
  );
  assert.match(
    repositorySource,
    /lead\.stage === "disqualified" \|\| lead\.stage === "handed_off"/,
  );
  assert.match(
    repositorySource,
    /lead\.stage !== "qualified" && lead\.stage !== "handoff_ready"/,
  );
  assert.match(repositorySource, /transition: "student_case\.created"/);
  assert.match(repositorySource, /transition: "student_case\.activated"/);
  assert.match(repositorySource, /fromState: studentCaseActivatedFromStatus/);
  assert.match(repositorySource, /let eventSequence = 1/);
  assert.match(repositorySource, /eventSequence \+= 1/);
  assert.match(repositorySource, /CANONICAL_ADMISSIONS_STARTER_TASKS\.map/);

  assert.doesNotMatch(
    repositorySource,
    /CANONICAL_WAHA_ACK_NAMES|Canonical(?:MessageCursor|StaffConversation|ConversationMessage|Gemini|Waha|WhatsApp|InboundMessageResult)|receiveCanonicalWhatsAppInbound|appendCanonicalInboundMessage|listCanonicalStaffConversations|getCanonicalStaffConversationThread|executeCanonicalGeminiProposal|reviewCanonicalGeminiProposal|readLatestCanonicalGeminiProposal|executeCanonicalWhatsAppSend|reconcileCanonicalWhatsAppSendAttempt|readLatestCanonicalWhatsAppSendAttempt/,
  );
  assert.doesNotMatch(
    coreSchemaSource,
    /evoConversations|evoMessages|evo_conversations|evo_messages/,
  );
  assert.doesNotMatch(
    operationsSchemaSource,
    /evoAiProposals|evoWhatsappSendAttempts|evo_ai_proposals|evo_whatsapp_send_attempts/,
  );
});
