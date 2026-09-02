import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const IDS = Object.freeze({
  conversation: "11111111-1111-4111-8111-111111111111",
  source: "22222222-2222-4222-8222-222222222222",
  proposal: "33333333-3333-4333-8333-333333333333",
  review: "44444444-4444-4444-8444-444444444444",
  send: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  reconcile: "77777777-7777-4777-8777-777777777777",
  membership: "88888888-8888-4888-8888-888888888888",
  work: "99999999-9999-4999-8999-999999999999",
  authorization: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
});

const proposalPayload = Object.freeze({
  schema_version: 2,
  language: "ru",
  intent: "admissions_discovery",
  confidence: 0.91,
  risk: "low",
  handoff_required: false,
  handoff_reasons: [],
  citations: [{ knowledge_key: "country.uae", knowledge_version: 3, evidence_ordinal: 1 }],
  memory_changes: [],
  qualification: {
    status: "collecting",
    completeness: 0.5,
    missing_fact_keys: ["budget_signal"],
    notes: null,
  },
  reply_text: "Здравствуйте! Уточните, пожалуйста, ваш бюджет.",
  summary: "Абитуриент выбирает программу.",
  next_action: "Уточнить бюджет",
  draft_internal_note: "Нужна квалификация бюджета.",
  missing_document_suggestion: null,
  deadline_warning: null,
  limitations: [],
  uncertainty: "low",
});

function baseProps(overrides = {}) {
  const unchanged = async (state) => state;
  return {
    locale: "ru",
    conversationId: IDS.conversation,
    latestInboundSourceMessageId: IDS.source,
    proposal: null,
    reviews: [],
    latestAttempt: null,
    requestIds: {
      gemini: IDS.proposal,
      review: IDS.review,
      send: IDS.send,
      reconcile: IDS.reconcile,
    },
    requestGemini: unchanged,
    reviewGemini: unchanged,
    sendWhatsApp: unchanged,
    reconcileWhatsApp: unchanged,
    ...overrides,
  };
}

test("controls state clearly says AI is advisory and send needs explicit confirmation", async () => {
  const { PlatformProviderWorkflowControls } = await import(
    "../src/components/platform/communications/PlatformProviderWorkflowControls.tsx"
  );
  const markup = renderToStaticMarkup(
    React.createElement(PlatformProviderWorkflowControls, baseProps()),
  );

  assert.match(markup, /ИИ[^<]*(?:совет|черновик)|AI[^<]*advisory/i);
  assert.match(markup, /name="request_id"/);
  assert.match(markup, /name="source_message_id"/);
  assert.match(markup, /<input[^>]*type="checkbox"[^>]*required[^>]*name="confirm_send"/);
  assert.match(markup, /name="message_text"/);
  assert.doesNotMatch(markup, /name="(?:recipient|phone|session|api_key|provider_evidence)"/i);
  assert.doesNotMatch(markup, /автоматичес|рассылк|broadcast/i);
});

test("proposal review offers exact Accept, reply-only Edit and reasoned Reject forms", async () => {
  const { PlatformProviderWorkflowControls } = await import(
    "../src/components/platform/communications/PlatformProviderWorkflowControls.tsx"
  );
  const proposal = {
    proposalRequestId: IDS.proposal,
    sourceMessageId: IDS.source,
    outcome: "proposal_ready",
    failureCode: null,
    modelRef: "gemini-3.7-flash",
    schemaVersion: 2,
    proposal: proposalPayload,
    requestedAt: "2026-09-02T08:00:00Z",
    completedAt: "2026-09-02T08:00:03Z",
    humanReviewRequired: true,
    autonomousAuthority: false,
    providerProofState: "blocked",
  };
  const markup = renderToStaticMarkup(
    React.createElement(
      PlatformProviderWorkflowControls,
      baseProps({ proposal }),
    ),
  );

  for (const decision of ["accepted", "edited", "rejected"]) {
    assert.match(markup, new RegExp(`name="decision" value="${decision}"`));
  }
  assert.match(markup, /name="edited_reply_text"/);
  assert.match(markup, /<input[^>]*required[^>]*name="reason"/);
  assert.doesNotMatch(markup, /name="(?:citations|summary|confidence|risk|model_ref|schema_version)"/);
});

test("an unknown outcome disables resend and offers exact reconciliation", async () => {
  const { PlatformProviderWorkflowControls } = await import(
    "../src/components/platform/communications/PlatformProviderWorkflowControls.tsx"
  );
  const latestAttempt = {
    attemptId: IDS.attempt,
    workItemId: IDS.work,
    conversationId: IDS.conversation,
    manualSendAuthorizationId: IDS.authorization,
    finalText: "Проверенный ответ",
    authorizedByMembershipId: IDS.membership,
    authorizedByName: "Amina Manager",
    status: "unknown",
    reconciliationRequired: true,
    providerSource: null,
    ackName: null,
    providerObservedAt: null,
    ackObservedAt: null,
    failureCode: "provider_timeout",
    attemptNumber: 1,
    authorizedAt: "2026-09-02T08:10:00Z",
    claimedAt: "2026-09-02T08:10:01Z",
    settledAt: "2026-09-02T08:10:31Z",
    lastReconciledAt: null,
    latestReconciliationKind: null,
    latestReconciliationOutcome: null,
  };
  const markup = renderToStaticMarkup(
    React.createElement(
      PlatformProviderWorkflowControls,
      baseProps({ latestAttempt }),
    ),
  );

  assert.match(markup, /<button[^>]*disabled[^>]*data-testid="platform-provider-send"/);
  assert.match(markup, /data-testid="platform-provider-reconcile"/);
  assert.match(markup, /name="attempt_id" value="66666666-6666-4666-8666-666666666666"/);
  assert.match(markup, /повторн[^<]*отправ|resend[^<]*block/i);
});

test("conversation page loads provider reads through the authenticated client only on the canonical thread", () => {
  const page = readFileSync(
    new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /createSupabaseServerClient\(\)/);
  assert.match(page, /readStaffGeminiProposal\(/);
  assert.match(page, /listStaffGeminiProposalReviews\(/);
  assert.match(page, /readLatestManualWhatsAppSendAttempt\(/);
  assert.match(page, /organizationId:\s*actor\.organizationId/g);
  assert.match(page, /messageCursor === null[\s\S]*?direction === "inbound"/);
  assert.match(page, /workflowControls=\{[\s\S]*?<PlatformProviderWorkflowControls/);
  assert.doesNotMatch(page, /service[_-]?role|EVO_PLATFORM_SUPABASE_SECRET_KEY|recipient|rawChat/i);
});
