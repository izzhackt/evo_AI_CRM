// Pure presentation regression with actual wire codecs. No app/browser/RPC acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseApplicationPackageDetail, parseApplicationPackageReview } from "../src/lib/portal/application-packages.ts";
import { packageReviewPresentation } from "../src/components/portal/applicationPackages/presentation.ts";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/application-packages-v1.json", import.meta.url), "utf8"));
const id = n => `c3a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function historicalScenario() {
  const raw = structuredClone(fixture.detail);
  const frozen = parseApplicationPackageReview(fixture.reviewReceipt.packageReview);
  assert.ok(frozen); assert.equal(frozen.decision, "approved");
  const changed = raw.items[0];
  changed.submission.review = { reviewId: id(921), decision: "rejected", reason: "Нечитаемая страница паспорта", reviewedAt: "2026-09-21T15:00:00Z" };
  const later = structuredClone(frozen);
  later.packageReviewId = id(922); later.decision = "correction_required"; later.reason = "Замените нечитаемый файл";
  later.reviewedAt = "2026-09-21T15:05:00Z"; later.affectedItemIds = [changed.requirementItemId];
  later.documentReviews = raw.items.map(item => ({ requirementItemId: item.requirementItemId, submissionId: item.submission.submissionId, review: item.submission.review, reusedFromSubmissionId: null, reusedFromReview: null }));
  const latest = parseApplicationPackageReview(later); assert.ok(latest);
  raw.package.latestReview = latest; raw.currentWarnings = [];
  const detail = parseApplicationPackageDetail(raw, fixture.target, raw.package.packageId); assert.ok(detail);
  return { frozen, detail };
}
test("R1 notification preserves approval while exposing current rejection and actual R2 correction", () => {
  const { frozen, detail } = historicalScenario();
  assert.deepEqual(detail.currentWarnings, []);
  const before = JSON.stringify({ frozen, detail });
  const view = packageReviewPresentation(detail, frozen);
  assert.equal(view.review.packageReviewId, frozen.packageReviewId);
  assert.equal(view.review.decision, "approved");
  assert.equal(view.items[0].evidence.review.decision, "approved");
  assert.equal(view.items[0].currentReview.decision, "rejected");
  assert.equal(view.items[0].currentReview.reason, "Нечитаемая страница паспорта");
  assert.equal(view.newerReview.decision, "correction_required");
  assert.equal(view.newerReview.reason, "Замените нечитаемый файл");
  assert.deepEqual(view.newerReview.affectedItemIds, [detail.items[0].requirementItemId]);
  assert.ok(view.warnings.some(warning => warning.requirementItemId === detail.items[0].requirementItemId && warning.reason === "review_changed" && warning.currentReview.decision === "rejected"));
  assert.equal(JSON.stringify({ frozen, detail }), before, "presentation must not rewrite frozen evidence");
});
test("current detail keeps SQL warning semantics and does not invent a newer decision", () => {
  const { detail } = historicalScenario();
  const view = packageReviewPresentation(detail);
  assert.equal(view.review.decision, "correction_required"); assert.equal(view.newerReview, null);
  assert.deepEqual(view.warnings, []); assert.equal(view.items[0].currentReview.decision, "rejected");
  const same = packageReviewPresentation(detail, detail.package.latestReview);
  assert.equal(same.newerReview, null); assert.deepEqual(same.warnings, []);
});
