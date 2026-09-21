import type { ApplicationPackageDetail, ApplicationPackageReview, ApplicationPackageWarning } from "../../../lib/portal/application-packages.ts";

/** The notification decision is immutable; live file state is a separate projection. */
export function packageReviewPresentation(detail: ApplicationPackageDetail, frozenReview?: ApplicationPackageReview) {
  const review = frozenReview ?? detail.package.latestReview;
  const newerReview = frozenReview && detail.package.latestReview?.packageReviewId !== frozenReview.packageReviewId
    ? detail.package.latestReview : null;
  const items = detail.items.map(item => ({
    item,
    evidence: review?.documentReviews.find(value => value.requirementItemId === item.requirementItemId) ?? null,
    currentReview: item.submission.review,
  }));
  // SQL warnings are relative to the latest package decision, which may already
  // incorporate a rejection. A historical notification needs its own comparison.
  const warnings: readonly ApplicationPackageWarning[] = frozenReview ? items.flatMap(({ item, evidence, currentReview }) => {
    const identity = { requirementItemId: item.requirementItemId, submissionId: item.submission.submissionId, currentReview };
    const result: ApplicationPackageWarning[] = [];
    if ((evidence?.review?.reviewId ?? null) !== (currentReview?.reviewId ?? null)) result.push({ ...identity, reason: "review_changed" });
    if (item.submission.file.technicalAvailability !== "available") result.push({ ...identity, reason: "file_unavailable" });
    return result;
  }) : detail.currentWarnings;
  return { review, newerReview, items, warnings };
}
