import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  buildPlatformGeminiStaffReadRpcArgs,
  normalizePlatformGeminiProposal,
  PlatformGeminiProposalContractError,
} from "../src/lib/platform-gemini-proposals.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  PLATFORM_GEMINI_PROPOSAL_STAFF_RPC,
  PlatformGeminiProposalRepositoryError,
  readPlatformGeminiProposal,
} = await import(
  "../src/lib/server/platform-gemini-proposals-repository.ts"
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

function actor(overrides = {}) {
  return {
    authUserId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    profileId: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    membershipId: "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    organizationId: ORGANIZATION_ID,
    displayName: "Operator",
    platformRole: "sales",
    platformAccessVersion: 7,
    role: "sales",
    ...overrides,
  };
}

function readyRow(overrides = {}) {
  return {
    proposal_request_id: REQUEST_ID,
    source_message_id: MESSAGE_ID,
    outcome: "proposal_ready",
    failure_code: null,
    model_ref: "gemini-3.7-flash",
    schema_version: 2,
    language: "ru",
    intent: "admissions_discovery",
    confidence: 86,
    risk: "low",
    handoff_required: true,
    handoff_reasons: ["missing_evidence"],
    citations: [
      {
        knowledge_key: "admissions.requirements",
        knowledge_version: 3,
        evidence_ordinal: 1,
      },
    ],
    memory_changes: [
      {
        fact_key: "preferred_country",
        action: "set",
        value: "Germany",
        confidence: 92,
      },
    ],
    qualification: {
      status: "ready_for_staff_review",
      completeness: 70,
      missing_fact_keys: ["budget_signal", "intake_target"],
      notes: "Confirm the budget and intake.",
    },
    reply_text: "Спасибо! Уточните, пожалуйста, бюджет и желаемый набор.",
    summary: "Клиент планирует поступление в Германию.",
    next_action: "Проверить бюджет и желаемый набор.",
    draft_internal_note: "Уточнить бюджет до консультации.",
    missing_document_suggestion: "Попросить копию аттестата.",
    deadline_warning: null,
    limitations: ["Ответ основан на подтвержденных источниках."],
    uncertainty: "low",
    requested_at: "2026-08-11T07:00:00Z",
    completed_at: "2026-08-11T07:00:02Z",
    human_review_required: true,
    autonomous_authority: false,
    provider_proof_state: "blocked",
    ...overrides,
  };
}

function nullProposalFields(overrides = {}) {
  return readyRow({
    language: null,
    intent: null,
    confidence: null,
    risk: null,
    handoff_required: null,
    handoff_reasons: null,
    citations: null,
    memory_changes: null,
    qualification: null,
    reply_text: null,
    summary: null,
    next_action: null,
    draft_internal_note: null,
    missing_document_suggestion: null,
    deadline_warning: null,
    limitations: null,
    uncertainty: null,
    ...overrides,
  });
}

test("normalizes one exact safe proposal without private provider fields", () => {
  const proposal = normalizePlatformGeminiProposal(readyRow());
  assert.equal(proposal.outcome, "proposal_ready");
  assert.equal(proposal.modelRef, "gemini-3.7-flash");
  assert.equal(proposal.autonomousAuthority, false);
  assert.equal(proposal.providerProofState, "blocked");
  assert.equal(proposal.replyText.startsWith("Спасибо"), true);
  assert.equal(proposal.summary, "Клиент планирует поступление в Германию.");
  assert.equal(proposal.nextAction, "Проверить бюджет и желаемый набор.");
  assert.equal(proposal.draftInternalNote, "Уточнить бюджет до консультации.");
  assert.equal(proposal.missingDocumentSuggestion, "Попросить копию аттестата.");
  assert.equal(proposal.deadlineWarning, null);
  assert.deepEqual(proposal.limitations, [
    "Ответ основан на подтвержденных источниках.",
  ]);
  assert.equal(proposal.uncertainty, "low");
  assert.deepEqual(proposal.citations[0], {
    knowledgeKey: "admissions.requirements",
    knowledgeVersion: 3,
    evidenceOrdinal: 1,
  });
  assert.equal(proposal.qualification.status, "ready_for_staff_review");
});

test("normalizes historical schema-v1 staff rows without inventing U9 fields", () => {
  const proposal = normalizePlatformGeminiProposal(
    readyRow({
      model_ref: "gemini-3.5-flash",
      schema_version: 1,
      summary: null,
      next_action: null,
      draft_internal_note: null,
      missing_document_suggestion: null,
      deadline_warning: null,
      limitations: null,
      uncertainty: null,
    }),
  );

  assert.equal(proposal.schemaVersion, 1);
  assert.equal(proposal.summary, null);
  assert.equal(proposal.nextAction, null);
  assert.deepEqual(proposal.limitations, []);
  assert.equal(proposal.uncertainty, null);
});

test("normalizes pending and durable human-review states", () => {
  const pending = normalizePlatformGeminiProposal(
    nullProposalFields({
      outcome: null,
      failure_code: null,
      completed_at: null,
    }),
  );
  assert.deepEqual(
    { outcome: pending.outcome, completedAt: pending.completedAt },
    { outcome: "pending", completedAt: null },
  );

  const failed = normalizePlatformGeminiProposal(
    nullProposalFields({
      outcome: "human_review",
      failure_code: "provider_timeout",
    }),
  );
  assert.equal(failed.outcome, "human_review");
  assert.equal(failed.failureCode, "provider_timeout");
});

test("safe proposal contract rejects private, autonomous, unknown and unsafe shapes", () => {
  for (const invalid of [
    { ...readyRow(), provider_interaction_ref: "private" },
    readyRow({ autonomous_authority: true }),
    readyRow({ provider_proof_state: "observed" }),
    readyRow({ model_ref: "gemini-3.6-flash" }),
    readyRow({ model_ref: "gemini-3.5-flash", schema_version: 2 }),
    readyRow({ model_ref: "gemini-3.7-flash", schema_version: 1 }),
    readyRow({ intent: "invented_intent" }),
    readyRow({ handoff_required: false }),
    readyRow({ qualification: { ...readyRow().qualification, status: "staff_confirmed" } }),
    nullProposalFields({ outcome: "human_review", failure_code: "unknown_failure" }),
    nullProposalFields({ outcome: null, completed_at: "2026-08-11T07:00:02Z" }),
  ]) {
    assert.throws(
      () => normalizePlatformGeminiProposal(invalid),
      PlatformGeminiProposalContractError,
    );
  }
});

test("builds exact organization-bound staff read arguments", () => {
  assert.deepEqual(
    buildPlatformGeminiStaffReadRpcArgs({
      organizationId: ORGANIZATION_ID.toUpperCase(),
      conversationId: CONVERSATION_ID,
    }),
    {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
    },
  );
  assert.throws(
    () =>
      buildPlatformGeminiStaffReadRpcArgs({
        organizationId: ORGANIZATION_ID,
        conversationId: "not-a-uuid",
      }),
    PlatformGeminiProposalContractError,
  );
});

test("staff repository reads zero-or-one row without an execution flag", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args, options) {
          calls.push({ name, args, options });
          return { data: [readyRow()], error: null };
        },
      };
    },
  };
  const proposal = await readPlatformGeminiProposal(actor(), CONVERSATION_ID, {
    client,
  });
  assert.equal(proposal?.outcome, "proposal_ready");
  assert.deepEqual(calls, [
    {
      name: PLATFORM_GEMINI_PROPOSAL_STAFF_RPC,
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
      },
      options: { get: true },
    },
  ]);

  const empty = await readPlatformGeminiProposal(actor(), CONVERSATION_ID, {
    client: {
      schema() {
        return { async rpc() { return { data: [], error: null }; } };
      },
    },
  });
  assert.equal(empty, null);
});

test("staff repository fails closed on RPC errors, duplicates and tenant mismatch input", async () => {
  for (const response of [
    { data: null, error: { message: "denied" } },
    { data: [readyRow(), readyRow()], error: null },
  ]) {
    await assert.rejects(
      () =>
        readPlatformGeminiProposal(actor(), CONVERSATION_ID, {
          client: {
            schema() {
              return { async rpc() { return response; } };
            },
          },
        }),
      PlatformGeminiProposalRepositoryError,
    );
  }
  await assert.rejects(
    () =>
      readPlatformGeminiProposal(
        actor({ organizationId: "wrong" }),
        CONVERSATION_ID,
        {
          client: {
            schema() {
              return { async rpc() { throw new Error("must not execute"); } };
            },
          },
        },
      ),
    PlatformGeminiProposalContractError,
  );
});

test("accepted conversation renders a localized read-only safe proposal inspector", async () => {
  const [cardSource, viewSource, pageSource, repositorySource, i18nSource] =
    await Promise.all([
      readFile(
        new URL(
          "../src/components/platform/communications/PlatformGeminiProposalCard.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/components/platform/communications/PlatformConversationView.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/lib/server/platform-gemini-proposals-repository.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../src/lib/i18n-data.ts", import.meta.url), "utf8"),
    ]);

  for (const testId of [
    "platform-gemini-proposal-card",
    "platform-gemini-proposal-status",
    "platform-gemini-proposal-reply",
    "platform-gemini-proposal-qualification",
    "platform-gemini-proposal-memory-changes",
    "platform-gemini-proposal-citations",
    "platform-gemini-proposal-unavailable",
  ]) {
    assert.match(cardSource, new RegExp(testId));
  }
  assert.match(cardSource, /data-human-review-required/);
  assert.match(cardSource, /data-autonomous-authority/);
  assert.match(cardSource, /data-provider-proof-state/);
  assert.match(cardSource, /reviewPlatformGeminiProposalAction/);
  assert.match(cardSource, /name="decision" value="accepted"/);
  assert.match(cardSource, /name="decision" value="edited"/);
  assert.match(cardSource, /name="decision" value="rejected"/);
  assert.doesNotMatch(cardSource, /provider_interaction_ref|context_sha|prompt_text|raw_waha/i);
  assert.match(viewSource, /PlatformGeminiProposalCard/);
  assert.match(viewSource, /unavailable=\{geminiProposalUnavailable\}/);
  assert.match(pageSource, /readPlatformGeminiProposal/);
  assert.match(pageSource, /unavailable: false as const/);
  assert.match(pageSource, /unavailable: true as const/);
  assert.match(pageSource, /geminiProposalUnavailable=\{geminiProposal\.unavailable\}/);
  assert.doesNotMatch(pageSource, /error\.message|String\(error\)|console\.(?:error|warn)/);
  assert.match(repositorySource, /staff_gemini_proposal/);
  assert.doesNotMatch(repositorySource, /EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED/);
  assert.equal(
    i18nSource.match(/platformGeminiProposalReviewRequired:/g)?.length,
    3,
  );
  assert.equal(
    i18nSource.match(/platformGeminiProposalUnavailable:/g)?.length,
    3,
  );
});
