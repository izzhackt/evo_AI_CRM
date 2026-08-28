import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CanonicalCrmRepositoryError,
  appendCanonicalInboundMessage,
  createCanonicalPersonLead,
  getCanonicalLeadSnapshot,
  getCanonicalStudentCaseSnapshot,
  handoffCanonicalLeadToAdmissions,
  normalizeCanonicalPersonIdentity,
  recordCanonicalSalesGateEvidence,
} from "../src/lib/server/canonical-crm-repository.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";

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
    handoffCanonicalLeadToAdmissions({ ...common, leadId: UUID_A }),
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
      adminOverride: { reason: " " },
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
    getCanonicalStudentCaseSnapshot({
      actorRole: "admissions",
      studentCaseId: "case-1",
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
