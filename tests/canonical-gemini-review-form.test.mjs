import assert from "node:assert/strict";
import test from "node:test";

import { parseCanonicalGeminiReviewForm } from "../src/lib/server/canonical-gemini-review-form.ts";

const IDS = Object.freeze({
  conversation: "11111111-1111-4111-8111-111111111111",
  proposal: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
});

function reviewForm({
  decision = "accepted",
  reviewedText = "",
  reviewReason = "",
} = {}) {
  const form = new FormData();
  form.set("conversation_id", IDS.conversation);
  form.set("proposal_id", IDS.proposal);
  form.set("decision", decision);
  form.set("reviewed_text", reviewedText);
  form.set("review_reason", reviewReason);
  form.set("review_request_id", IDS.request);
  return form;
}

test("accept, edit, and reject parse only their exact decision payload", () => {
  assert.deepEqual(parseCanonicalGeminiReviewForm(reviewForm()), {
    conversationId: IDS.conversation,
    proposalId: IDS.proposal,
    requestId: IDS.request,
    decision: "accepted",
  });

  assert.deepEqual(
    parseCanonicalGeminiReviewForm(
      reviewForm({ decision: "edited", reviewedText: "  Final answer  " }),
    ),
    {
      conversationId: IDS.conversation,
      proposalId: IDS.proposal,
      requestId: IDS.request,
      decision: "edited",
      reviewedText: "  Final answer  ",
    },
  );

  assert.deepEqual(
    parseCanonicalGeminiReviewForm(
      reviewForm({ decision: "rejected", reviewReason: "Needs evidence" }),
    ),
    {
      conversationId: IDS.conversation,
      proposalId: IDS.proposal,
      requestId: IDS.request,
      decision: "rejected",
      reviewReason: "Needs evidence",
    },
  );
});

test("unknown, duplicate, missing, invalid UUID, and mixed decision fields fail closed", () => {
  const unknown = reviewForm();
  unknown.set("send_now", "true");
  assert.equal(parseCanonicalGeminiReviewForm(unknown), null);

  const duplicate = reviewForm();
  duplicate.append("decision", "rejected");
  assert.equal(parseCanonicalGeminiReviewForm(duplicate), null);

  const missing = reviewForm();
  missing.delete("review_request_id");
  assert.equal(parseCanonicalGeminiReviewForm(missing), null);

  const invalidRequest = reviewForm();
  invalidRequest.set("review_request_id", "not-a-uuid");
  assert.equal(parseCanonicalGeminiReviewForm(invalidRequest), null);

  assert.equal(
    parseCanonicalGeminiReviewForm(
      reviewForm({ decision: "accepted", reviewedText: "smuggled" }),
    ),
    null,
  );
  assert.equal(
    parseCanonicalGeminiReviewForm(
      reviewForm({ decision: "edited", reviewedText: "   " }),
    ),
    null,
  );
  assert.equal(
    parseCanonicalGeminiReviewForm(
      reviewForm({ decision: "rejected", reviewReason: "   " }),
    ),
    null,
  );
});

test("the React useActionState envelope is accepted only when complete", () => {
  const form = new FormData();
  form.set("_1_$ACTION_REF_12", "");
  form.set("_1_$ACTION_12:0", "");
  form.set("_1_$ACTION_12:1", "");
  form.set("_1_$ACTION_KEY", "state-key");
  form.set("_1_conversation_id", IDS.conversation);
  form.set("_1_proposal_id", IDS.proposal);
  form.set("_1_decision", "accepted");
  form.set("_1_reviewed_text", "");
  form.set("_1_review_reason", "");
  form.set("_1_review_request_id", IDS.request);
  form.set("0", "previous-state");

  assert.deepEqual(parseCanonicalGeminiReviewForm(form), {
    conversationId: IDS.conversation,
    proposalId: IDS.proposal,
    requestId: IDS.request,
    decision: "accepted",
  });

  form.delete("0");
  assert.equal(parseCanonicalGeminiReviewForm(form), null);
});
