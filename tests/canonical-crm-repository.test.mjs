import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANONICAL_UNIVERSITY_APPLICATION_STATUSES,
  CANONICAL_VISA_MILESTONE_KINDS,
  CANONICAL_VISA_MILESTONE_STATUSES,
  CANONICAL_SALES_DUE_FILTERS,
  CANONICAL_SALES_STAGES,
  CANONICAL_STUDENT_CASE_STATUSES,
  CanonicalCrmRepositoryError,
  appendCanonicalInboundMessage,
  assertCanonicalFinanceStop,
  createCanonicalUniversityApplication,
  createCanonicalPersonLead,
  getCanonicalAdmissionsOperationsSnapshot,
  getCanonicalLeadConversationThread,
  getCanonicalLeadGateSnapshot,
  getCanonicalLeadSnapshot,
  getCanonicalStudentCaseHandoffSnapshot,
  getCanonicalStudentCaseSnapshot,
  handoffCanonicalLeadToAdmissions,
  listCanonicalFinanceStops,
  listCanonicalLeadConversations,
  listCanonicalSalesLeads,
  listCanonicalStudentCases,
  listCanonicalUniversityApplications,
  listCanonicalVisaMilestones,
  normalizeCanonicalPersonIdentity,
  parseCanonicalMessageCursor,
  parseCanonicalReadCursor,
  recordCanonicalSalesGateEvidence,
  releaseCanonicalFinanceStop,
  transitionCanonicalUniversityApplication,
  transitionCanonicalVisaMilestone,
  updateCanonicalUniversityApplication,
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
  assert.match(source, /transition: "student_case\.activated"/);
  assert.match(source, /fromState: studentCaseActivatedFromStatus/);
  assert.match(source, /let eventSequence = 1/);
  assert.match(source, /eventSequence \+= 1/);
  assert.match(source, /CANONICAL_ADMISSIONS_STARTER_TASKS\.map/);
});

test("canonical admissions operations expose the fixed application and visa contracts", () => {
  assert.deepEqual(CANONICAL_UNIVERSITY_APPLICATION_STATUSES, [
    "draft",
    "submitted",
    "accepted",
    "rejected",
    "withdrawn",
  ]);
  assert.deepEqual(CANONICAL_VISA_MILESTONE_KINDS, [
    "document_preparation",
    "appointment",
    "submission",
    "biometrics",
    "interview",
    "decision",
  ]);
  assert.deepEqual(CANONICAL_VISA_MILESTONE_STATUSES, [
    "pending",
    "in_progress",
    "completed",
    "blocked",
  ]);
});

test("canonical admissions queues reject malformed cursors before database access", async () => {
  for (const listQueue of [
    listCanonicalUniversityApplications,
    listCanonicalVisaMilestones,
    listCanonicalFinanceStops,
  ]) {
    await assert.rejects(
      listQueue({
        actorRole: "admissions",
        cursor: { updatedAt: "not-a-timestamp", id: UUID_A },
      }),
      rejectsWithCode("invalid_input"),
    );
    await assert.rejects(
      listQueue({
        actorRole: "admissions",
        cursor: { updatedAt: "2026-08-29T00:00:00.000Z", id: "not-a-uuid" },
      }),
      rejectsWithCode("invalid_input"),
    );
  }
});

test("sales is denied every canonical admissions operations seam before database access", async () => {
  const readInputs = [
    () =>
      getCanonicalAdmissionsOperationsSnapshot({
        actorRole: "sales",
        studentCaseId: UUID_A,
      }),
    () => listCanonicalUniversityApplications({ actorRole: "sales" }),
    () => listCanonicalVisaMilestones({ actorRole: "sales" }),
    () => listCanonicalFinanceStops({ actorRole: "sales" }),
  ];
  for (const read of readInputs) {
    await assert.rejects(read(), rejectsWithCode("forbidden"));
  }

  const context = {
    actorRole: "sales",
    idempotencyKey: "admissions-operations-request",
    correlationId: "admissions-operations-request",
  };
  const mutationInputs = [
    () =>
      createCanonicalUniversityApplication({
        ...context,
        studentCaseId: UUID_A,
        institutionName: "Technical University",
        programName: "Computer Science",
        targetIntake: "Fall 2027",
        nextAction: "Collect the transcript",
        nextActionAt: "2026-09-01T12:00:00.000Z",
      }),
    () =>
      updateCanonicalUniversityApplication({
        ...context,
        applicationId: UUID_A,
        expectedVersion: 1,
        nextAction: "Submit the transcript",
        nextActionAt: "2026-09-02T12:00:00.000Z",
      }),
    () =>
      transitionCanonicalUniversityApplication({
        ...context,
        applicationId: UUID_A,
        expectedVersion: 1,
        toStatus: "submitted",
      }),
    () =>
      transitionCanonicalVisaMilestone({
        ...context,
        visaMilestoneId: UUID_A,
        expectedVersion: 1,
        toStatus: "in_progress",
      }),
    () =>
      assertCanonicalFinanceStop({
        ...context,
        studentCaseId: UUID_A,
        expectedVersion: 0,
        reason: "First payment needs review",
      }),
    () =>
      releaseCanonicalFinanceStop({
        ...context,
        financeStopId: UUID_A,
        expectedVersion: 1,
        reason: "Payment was verified",
      }),
  ];
  for (const mutate of mutationInputs) {
    await assert.rejects(mutate(), rejectsWithCode("forbidden"));
  }
});

test("canonical admissions operations reject incomplete state transitions before database access", async () => {
  const context = {
    actorRole: "admissions",
    idempotencyKey: "admissions-validation-request",
    correlationId: "admissions-validation-request",
  };
  await assert.rejects(
    createCanonicalUniversityApplication({
      ...context,
      studentCaseId: UUID_A,
      institutionName: "Technical University",
      programName: "Computer Science",
      targetIntake: "Fall 2027",
      nextAction: " ",
      nextActionAt: "2026-09-01T12:00:00.000Z",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    transitionCanonicalUniversityApplication({
      ...context,
      applicationId: UUID_A,
      expectedVersion: 1,
      toStatus: "rejected",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    transitionCanonicalVisaMilestone({
      ...context,
      visaMilestoneId: UUID_A,
      expectedVersion: 1,
      toStatus: "blocked",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    assertCanonicalFinanceStop({
      ...context,
      studentCaseId: UUID_A,
      expectedVersion: 0,
      reason: " ",
    }),
    rejectsWithCode("invalid_input"),
  );
  await assert.rejects(
    releaseCanonicalFinanceStop({
      ...context,
      financeStopId: UUID_A,
      expectedVersion: 1,
      reason: "Payment was verified",
    }),
    rejectsWithCode("forbidden"),
  );
});

test("handoff materializes exactly six canonical visa milestones with atomic creation events", async () => {
  const source = await readFile(
    new URL("../src/lib/server/canonical-crm-repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /CANONICAL_VISA_MILESTONE_KINDS\.map/);
  assert.match(source, /businessObjectType: "visa_milestone"/);
  assert.match(source, /transition: "visa_milestone\.created"/);
});

test("admissions operations snapshot reads inactive handed-off cases without a write lock", async () => {
  const source = await readFile(
    new URL("../src/lib/server/canonical-crm-repository.ts", import.meta.url),
    "utf8",
  );
  const snapshotSource = source.slice(
    source.indexOf(
      "export async function getCanonicalAdmissionsOperationsSnapshot",
    ),
    source.indexOf("export async function listCanonicalUniversityApplications"),
  );
  assert.match(snapshotSource, /requireHandedOffStudentCase/);
  assert.doesNotMatch(snapshotSource, /lockActiveHandedOffStudentCase/);

  const readGuardSource = source.slice(
    source.indexOf("async function requireHandedOffStudentCase"),
    source.indexOf("async function lockActiveHandedOffStudentCase"),
  );
  assert.doesNotMatch(readGuardSource, /\.for\("update"\)/);
  assert.doesNotMatch(readGuardSource, /!== "active"/);

  const writeGuardSource = source.slice(
    source.indexOf("async function lockActiveHandedOffStudentCase"),
    source.indexOf("async function requireFinanceProgressAllowed"),
  );
  assert.match(writeGuardSource, /\.for\("update"\)/);
  assert.match(writeGuardSource, /!== "active"/);
});
