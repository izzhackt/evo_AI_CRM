import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizePlatformGeminiProposalPayload } from "../src/lib/platform-gemini-proposals.ts";
import {
  buildPlatformGeminiReviewPayload,
  buildPlatformGeminiReviewMutationRpcArgs,
  buildPlatformGeminiReviewReadRpcArgs,
  normalizePlatformGeminiProposalReview,
  normalizePlatformGeminiProposalReviewHistory,
  parsePlatformGeminiProposalReviewForm,
  PlatformGeminiProposalReviewContractError,
  reviewPlatformGeminiProposalWithReconciliation,
} from "../src/lib/platform-gemini-proposal-reviews.ts";
import {
  PLATFORM_GEMINI_PROPOSAL_REVIEW_RPC,
  PLATFORM_GEMINI_PROPOSAL_REVIEW_STAFF_RPC,
  PlatformGeminiProposalReviewRepositoryError,
  readPlatformGeminiProposalReviews,
  reviewPlatformGeminiProposal,
} from "../src/lib/server/platform-gemini-proposal-reviews-repository.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const PROPOSAL_REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const REVIEW_ID = "40000000-0000-4000-8000-000000000001";
const REVIEW_REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "60000000-0000-4000-8000-000000000001";
const actor = Object.freeze({ organizationId: ORGANIZATION_ID });

function payload(overrides = {}) {
  return {
    schema_version: 2,
    language: "ru",
    intent: "documents",
    confidence: 84,
    risk: "medium",
    handoff_required: true,
    handoff_reasons: ["missing_evidence"],
    citations: [
      {
        knowledge_key: "evo.documents.passport",
        knowledge_version: 3,
        evidence_ordinal: 1,
      },
    ],
    memory_changes: [],
    qualification: {
      status: "collecting",
      completeness: 70,
      missing_fact_keys: ["preferred_program"],
      notes: "Нужно уточнить программу.",
    },
    reply_text: "Пожалуйста, пришлите копию паспорта.",
    summary: "Клиент уточняет список документов.",
    next_action: "Проверить паспорт после загрузки.",
    draft_internal_note: "Ожидаем документ от клиента.",
    missing_document_suggestion: "Копия паспорта",
    deadline_warning: null,
    limitations: ["Не проверено качество скана."],
    uncertainty: "medium",
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    review_id: REVIEW_ID,
    proposal_request_id: PROPOSAL_REQUEST_ID,
    decision: "accepted",
    reviewed_payload: payload(),
    reviewed_payload_sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    reason: null,
    reviewed_by_membership_id: MEMBERSHIP_ID,
    reviewed_by_name: "Admissions Admin",
    reviewed_at: "2026-08-26T20:00:00Z",
    ...overrides,
  };
}

function readyProposal(overrides = {}) {
  const normalized = normalizePlatformGeminiProposalPayload(payload());
  return {
    requestId: PROPOSAL_REQUEST_ID,
    sourceMessageId: "70000000-0000-4000-8000-000000000001",
    modelRef: "gemini-3.7-flash",
    schemaVersion: 2,
    requestedAt: "2026-08-26T19:59:00Z",
    completedAt: "2026-08-26T20:00:00Z",
    humanReviewRequired: true,
    autonomousAuthority: false,
    providerProofState: "blocked",
    outcome: "proposal_ready",
    failureCode: null,
    ...normalized,
    ...overrides,
  };
}

test("U9 review normalizes an exact accepted schema-v2 proposal", () => {
  const review = normalizePlatformGeminiProposalReview(row());

  assert.equal(review.reviewId, REVIEW_ID);
  assert.equal(review.proposalRequestId, PROPOSAL_REQUEST_ID);
  assert.equal(review.decision, "accepted");
  assert.equal(review.reviewedPayload?.schemaVersion, 2);
  assert.equal(review.reviewedPayload?.summary, "Клиент уточняет список документов.");
  assert.equal(review.reviewedPayload?.citations[0]?.knowledgeKey, "evo.documents.passport");
  assert.equal(review.reviewedByName, "Admissions Admin");
  assert.equal(review.replayed, false);
});

test("U9 review rejects malformed decisions, payloads and DTO drift", () => {
  assert.throws(
    () => normalizePlatformGeminiProposalReview(row({ decision: "approve" })),
    PlatformGeminiProposalReviewContractError,
  );
  assert.throws(
    () =>
      normalizePlatformGeminiProposalReview(
        row({ reviewed_payload: payload({ schema_version: 1 }) }),
      ),
    PlatformGeminiProposalReviewContractError,
  );
  assert.throws(
    () => normalizePlatformGeminiProposalReview(row({ unexpected: true })),
    PlatformGeminiProposalReviewContractError,
  );
  assert.throws(
    () =>
      normalizePlatformGeminiProposalReview(
        row({ decision: "rejected", reviewed_payload: null, reason: null }),
      ),
    PlatformGeminiProposalReviewContractError,
  );
});

test("U9 rejected review contains a reason and no accepted content", () => {
  const review = normalizePlatformGeminiProposalReview(
    row({
      decision: "rejected",
      reviewed_payload: null,
      reviewed_payload_sha256: null,
      reason: "Источников недостаточно для ответа.",
      replayed: true,
    }),
    { mutation: true },
  );

  assert.equal(review.decision, "rejected");
  assert.equal(review.reviewedPayload, null);
  assert.equal(review.reviewedPayloadSha256, null);
  assert.equal(review.replayed, true);
});

test("U9 reconciles a committed human review after its first response is lost", async () => {
  let calls = 0;
  let auditEvents = 0;

  const receipt = await reviewPlatformGeminiProposalWithReconciliation(
    async () => {
      calls += 1;
      if (auditEvents === 0) auditEvents += 1;
      if (calls === 1) throw new Error("transport response was lost");
      return { reviewId: REVIEW_ID, replayed: true };
    },
  );

  assert.deepEqual(receipt, { reviewId: REVIEW_ID, replayed: true });
  assert.equal(calls, 2);
  assert.equal(auditEvents, 1);
});

test("U9 review history is bounded, newest-first and duplicate-free", () => {
  const older = row({
    review_id: "40000000-0000-4000-8000-000000000002",
    proposal_request_id: "30000000-0000-4000-8000-000000000002",
    reviewed_at: "2026-08-25T20:00:00Z",
  });
  const history = normalizePlatformGeminiProposalReviewHistory([row(), older], 20);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.reviewId, REVIEW_ID);

  assert.throws(
    () => normalizePlatformGeminiProposalReviewHistory([row(), row()], 20),
    PlatformGeminiProposalReviewContractError,
  );
  assert.throws(
    () => normalizePlatformGeminiProposalReviewHistory([older, row()], 20),
    PlatformGeminiProposalReviewContractError,
  );
});

test("U9 review RPC arguments bind tenant, conversation, request and exact payload", () => {
  assert.deepEqual(
    buildPlatformGeminiReviewReadRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      limit: 20,
    }),
    {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_limit: 20,
    },
  );

  const args = buildPlatformGeminiReviewMutationRpcArgs({
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    proposalRequestId: PROPOSAL_REQUEST_ID,
    reviewRequestId: REVIEW_REQUEST_ID,
    decision: "edited",
    reviewedPayload: payload({ reply_text: "Отредактированный ответ." }),
    reason: "Исправлена формулировка.",
  });
  assert.equal(args.p_decision, "edited");
  assert.equal(args.p_reviewed_payload.schema_version, 2);
  assert.equal(args.p_reviewed_payload.reply_text, "Отредактированный ответ.");
  assert.equal(args.p_reviewed_payload.summary, "Клиент уточняет список документов.");
  assert.equal(args.p_reviewed_payload.citations[0].knowledge_key, "evo.documents.passport");
});

test("U9 reject RPC cannot smuggle content and edit cannot use a historical v1 payload", () => {
  assert.throws(
    () =>
      buildPlatformGeminiReviewMutationRpcArgs({
        organizationId: ORGANIZATION_ID,
        conversationId: CONVERSATION_ID,
        proposalRequestId: PROPOSAL_REQUEST_ID,
        reviewRequestId: REVIEW_REQUEST_ID,
        decision: "rejected",
        reviewedPayload: payload(),
        reason: "Недостаточно источников.",
      }),
    PlatformGeminiProposalReviewContractError,
  );
  assert.throws(
    () =>
      buildPlatformGeminiReviewMutationRpcArgs({
        organizationId: ORGANIZATION_ID,
        conversationId: CONVERSATION_ID,
        proposalRequestId: PROPOSAL_REQUEST_ID,
        reviewRequestId: REVIEW_REQUEST_ID,
        decision: "edited",
        reviewedPayload: payload({ schema_version: 1 }),
        reason: null,
      }),
    PlatformGeminiProposalReviewContractError,
  );
});

test("U9 editable review changes operator text while preserving model classification and sources", () => {
  const edited = buildPlatformGeminiReviewPayload(readyProposal(), {
    replyText: "Ответ после проверки сотрудником.",
    summary: "Уточнённое резюме.",
    nextAction: "Позвонить клиенту завтра.",
    draftInternalNote: "Проверено куратором.",
    missingDocumentSuggestion: null,
    deadlineWarning: "До срока осталось три дня.",
    limitations: ["Не подтверждён срок университета."],
    uncertainty: "high",
  });

  assert.equal(edited.reply_text, "Ответ после проверки сотрудником.");
  assert.equal(edited.intent, "documents");
  assert.equal(edited.risk, "medium");
  assert.deepEqual(edited.citations, payload().citations);
  assert.equal(edited.uncertainty, "high");

  assert.throws(
    () => buildPlatformGeminiReviewPayload(readyProposal({ schemaVersion: 1 })),
    PlatformGeminiProposalReviewContractError,
  );
  assert.throws(
    () => buildPlatformGeminiReviewPayload(readyProposal(), { citations: [] }),
    PlatformGeminiProposalReviewContractError,
  );
});

test("U9 review form parser accepts only the exact decision-specific browser contract", () => {
  const accepted = new FormData();
  accepted.set("conversation_id", CONVERSATION_ID);
  accepted.set("proposal_request_id", PROPOSAL_REQUEST_ID);
  accepted.set("review_request_id", REVIEW_REQUEST_ID);
  accepted.set("decision", "accepted");
  accepted.set("reason", "");
  accepted.set("$ACTION_ID", "next-internal");
  assert.deepEqual(parsePlatformGeminiProposalReviewForm(accepted), {
    conversationId: CONVERSATION_ID,
    proposalRequestId: PROPOSAL_REQUEST_ID,
    reviewRequestId: REVIEW_REQUEST_ID,
    decision: "accepted",
    reason: null,
    edits: undefined,
  });

  const edited = new FormData();
  edited.set("conversation_id", CONVERSATION_ID);
  edited.set("proposal_request_id", PROPOSAL_REQUEST_ID);
  edited.set("review_request_id", REVIEW_REQUEST_ID);
  edited.set("decision", "edited");
  edited.set("reason", "Исправлена формулировка");
  edited.set("reply_text", "Проверенный ответ");
  edited.set("summary", "Проверенное резюме");
  edited.set("next_action", "Позвонить завтра");
  edited.set("draft_internal_note", "Заметка сотрудника");
  edited.set("missing_document_suggestion", "");
  edited.set("deadline_warning", "До срока три дня");
  edited.set("limitations", "Не подтверждён срок\nНет оригинала документа");
  edited.set("uncertainty", "high");
  assert.deepEqual(parsePlatformGeminiProposalReviewForm(edited)?.edits, {
    replyText: "Проверенный ответ",
    summary: "Проверенное резюме",
    nextAction: "Позвонить завтра",
    draftInternalNote: "Заметка сотрудника",
    missingDocumentSuggestion: null,
    deadlineWarning: "До срока три дня",
    limitations: ["Не подтверждён срок", "Нет оригинала документа"],
    uncertainty: "high",
  });

  edited.set("source_ids", "smuggled");
  assert.equal(parsePlatformGeminiProposalReviewForm(edited), null);

  const rejected = new FormData();
  rejected.set("conversation_id", CONVERSATION_ID);
  rejected.set("proposal_request_id", PROPOSAL_REQUEST_ID);
  rejected.set("review_request_id", REVIEW_REQUEST_ID);
  rejected.set("decision", "rejected");
  rejected.set("reason", "");
  assert.equal(parsePlatformGeminiProposalReviewForm(rejected), null);
});

test("U9 review repository uses only the authenticated bounded read RPC", async () => {
  const calls = [];
  const reviews = await readPlatformGeminiProposalReviews(
    actor,
    CONVERSATION_ID,
    20,
    {
      client: {
        schema(name) {
          assert.equal(name, "platform");
          return {
            async rpc(name, args, options) {
              calls.push({ name, args, options });
              return { data: [row()], error: null };
            },
          };
        },
      },
    },
  );

  assert.equal(reviews.length, 1);
  assert.deepEqual(calls, [
    {
      name: PLATFORM_GEMINI_PROPOSAL_REVIEW_STAFF_RPC,
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
        p_limit: 20,
      },
      options: { get: true },
    },
  ]);
});

test("U9 review repository writes one exact decision and validates its receipt", async () => {
  const calls = [];
  const review = await reviewPlatformGeminiProposal(
    actor,
    {
      conversationId: CONVERSATION_ID,
      proposalRequestId: PROPOSAL_REQUEST_ID,
      reviewRequestId: REVIEW_REQUEST_ID,
      decision: "accepted",
      reviewedPayload: payload(),
      reason: null,
    },
    {
      client: {
        schema() {
          return {
            async rpc(name, args, options) {
              calls.push({ name, args, options });
              return { data: [row({ replayed: false })], error: null };
            },
          };
        },
      },
    },
  );

  assert.equal(review.reviewId, REVIEW_ID);
  assert.equal(review.replayed, false);
  assert.equal(calls[0]?.name, PLATFORM_GEMINI_PROPOSAL_REVIEW_RPC);
  assert.equal(calls[0]?.options, undefined);
  assert.equal(calls[0]?.args.p_organization_id, ORGANIZATION_ID);
  assert.equal(calls[0]?.args.p_proposal_request_id, PROPOSAL_REQUEST_ID);
  assert.equal(calls[0]?.args.p_decision, "accepted");
});

test("U9 review repository fails closed on database errors and malformed receipts", async () => {
  const client = (data, error = null) => ({
    schema() {
      return { async rpc() { return { data, error }; } };
    },
  });

  await assert.rejects(
    () => readPlatformGeminiProposalReviews(actor, CONVERSATION_ID, 20, { client: client([], {}) }),
    PlatformGeminiProposalReviewRepositoryError,
  );
  await assert.rejects(
    () =>
      reviewPlatformGeminiProposal(
        actor,
        {
          conversationId: CONVERSATION_ID,
          proposalRequestId: PROPOSAL_REQUEST_ID,
          reviewRequestId: REVIEW_REQUEST_ID,
          decision: "accepted",
          reviewedPayload: payload(),
          reason: null,
        },
        { client: client([row()]) },
      ),
    PlatformGeminiProposalReviewContractError,
  );
});

test("U9 server action rechecks the exact proposal and owns no external side effect", async () => {
  const source = await readFile(
    new URL(
      "../src/lib/platform-gemini-proposal-review-actions.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /requirePlatformMessagingActor/);
  assert.match(source, /readPlatformGeminiProposal/);
  assert.match(source, /proposal\.requestId !== input\.proposalRequestId/);
  assert.match(source, /proposal\.schemaVersion !== 2/);
  assert.match(source, /input\.decision === "rejected"\s*\? null/);
  assert.match(source, /reviewPlatformGeminiProposal/);
  assert.doesNotMatch(
    source,
    /WAHA|amoCRM|outbox|enqueue|sendPlatform|sendWhatsApp/i,
  );
});

test("U9 review history keeps a read-only authorization path for PostgREST GET", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/091_platform_u9_gemini_human_review.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const start = migration.indexOf(
    "CREATE OR REPLACE FUNCTION platform.staff_gemini_proposal_reviews(",
  );
  const end = migration.indexOf(
    "REVOKE ALL ON TABLE platform.gemini_proposal_reviews",
    start,
  );
  const historyFunction = migration.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(historyFunction, /\bSTABLE\b/);
  assert.match(historyFunction, /require_domain_actor_read/);
  assert.match(historyFunction, /platform_can_read_communication_full/);
  assert.doesNotMatch(historyFunction, /require_communication_actor\s*\(/);
});
