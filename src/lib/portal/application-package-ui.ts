import {
  applicationDocumentCanonical as canonical,
  type ApplicationDocumentDefinition,
  type ApplicationDocumentHistoryEntry,
  type ApplicationDocumentHistoryPage,
  type ApplicationDocumentMaterialSnapshot,
  type ApplicationDocumentTarget,
} from "./application-documents.ts";
import {
  parseApplicationPackageDetail,
  parseApplicationPackageReadiness,
  parseApplicationPackageReviewIntent,
  parseApplicationPackageSubmitIntent,
  type ApplicationPackageDecision,
  type ApplicationPackageDetail,
  type ApplicationPackageReadiness,
  type ApplicationPackageReuseApproval,
} from "./application-packages.ts";

/** Build only from the last explicit server preview, never from a newer draft. */
export function buildApplicationPackageSubmitIntent(readiness: ApplicationPackageReadiness, requestId: string) {
  const checked = parseApplicationPackageReadiness(readiness, {
    studentCaseId: readiness.studentCaseId, applicationId: readiness.applicationId,
  });
  if (!checked?.canSubmit || !checked.requirements.revisionId) return null;
  return parseApplicationPackageSubmitIntent({
    studentCaseId: checked.studentCaseId,
    applicationId: checked.applicationId,
    requirementsRevisionId: checked.requirements.revisionId,
    expectedPreviousPackageId: checked.latestPackage?.packageId ?? null,
    items: checked.selections.map(({ requirementItemId, selection, expectedPreviousSubmissionId }) => ({
      requirementItemId, selection, expectedPreviousSubmissionId,
    })),
    requestId,
  });
}

export type ApplicationPackageReviewBlocker = Readonly<{
  requirementItemId: string;
  reason: "file_unavailable" | "document_unreviewed" | "document_correction_required" | "document_rejected" | "reuse_unavailable";
}>;

/** Visible reasons to withhold approval. Reuse eligibility is still proven by SQL. */
export function applicationPackageReviewBlockers(detail: ApplicationPackageDetail, reuseApprovals: readonly ApplicationPackageReuseApproval[] = []) {
  const blockers: ApplicationPackageReviewBlocker[] = [];
  for (const item of detail.items) {
    const current = item.submission.review;
    const reuse = reuseApprovals.filter(value => value.requirementItemId === item.requirementItemId);
    const selectedReuse = reuse.length === 1 && reuse[0].submissionId === item.submission.submissionId
      && reuse[0].expectedReviewId === (current?.reviewId ?? null)
      && reuse[0].sourceSubmissionId !== item.submission.submissionId;
    if (item.submission.file.technicalAvailability !== "available") {
      blockers.push({ requirementItemId: item.requirementItemId, reason: "file_unavailable" });
    }
    if (reuse.length && (!selectedReuse || (current && current.decision !== "approved"))) {
      blockers.push({ requirementItemId: item.requirementItemId, reason: "reuse_unavailable" });
    }
    if (current?.decision === "correction_required" || current?.decision === "rejected") {
      blockers.push({ requirementItemId: item.requirementItemId,
        reason: current.decision === "rejected" ? "document_rejected" : "document_correction_required" });
    } else if (!current && !selectedReuse) {
      blockers.push({ requirementItemId: item.requirementItemId, reason: "document_unreviewed" });
    }
  }
  return blockers;
}

export type ApplicationPackageReviewInput = Readonly<{
  decision: ApplicationPackageDecision;
  reason: string | null;
  affectedItemIds: readonly string[];
  reuseApprovals: readonly ApplicationPackageReuseApproval[];
  requestId: string;
}>;

/** The complete current evidence vector is frozen together with the staff decision. */
export function buildApplicationPackageReviewIntent(scope: ApplicationDocumentTarget, detail: ApplicationPackageDetail, input: ApplicationPackageReviewInput) {
  const checked = parseApplicationPackageDetail(detail, scope, detail.package.packageId);
  if (!checked || (input.decision === "approved" && applicationPackageReviewBlockers(checked, input.reuseApprovals).length)) return null;
  return parseApplicationPackageReviewIntent({
    studentCaseId: scope.studentCaseId,
    applicationId: scope.applicationId,
    packageId: checked.package.packageId,
    expectedPreviousReviewId: checked.package.latestReview?.packageReviewId ?? null,
    decision: input.decision,
    reason: input.reason,
    affectedItemIds: input.affectedItemIds,
    documentReviews: checked.items.map(item => ({
      requirementItemId: item.requirementItemId,
      submissionId: item.submission.submissionId,
      expectedReviewId: item.submission.review?.reviewId ?? null,
    })),
    reuseApprovals: input.reuseApprovals,
    requestId: input.requestId,
  });
}

function comparableMaterial(definition: ApplicationDocumentDefinition, snapshot: ApplicationDocumentMaterialSnapshot | null) {
  return snapshot ?? {
    intentKind: "custom", requirementId: null, rawLabel: definition.label, rawGroupLabel: definition.groupLabel,
    label: definition.label, groupLabel: definition.groupLabel, sourceRequirementKey: null,
    sourceChecklistVersion: null, sourceInstructions: null,
  };
}

export type ApplicationPackageReuseCandidate = Readonly<{
  approval: ApplicationPackageReuseApproval;
  source: ApplicationDocumentHistoryEntry;
}>;

/** A candidate is a staff choice, never a client-side proof of the predecessor chain. */
export function applicationPackageReuseCandidates(detail: ApplicationPackageDetail, history: ApplicationDocumentHistoryPage): readonly ApplicationPackageReuseCandidate[] {
  if (history.studentCaseId !== detail.studentCaseId || history.applicationId !== detail.applicationId) return [];
  const candidates: ApplicationPackageReuseCandidate[] = [];
  const seen = new Set<string>();
  for (const item of detail.items) {
    const current = item.submission;
    if (current.file.technicalAvailability !== "available" || (current.review && current.review.decision !== "approved")) continue;
    for (const source of history.events) {
      const previous = source.submission;
      if (source.kind !== "submission" || !previous || previous.review?.decision !== "approved"
        || previous.submissionId === current.submissionId || previous.file.technicalAvailability !== "available"
        || previous.documentSlotId !== current.documentSlotId || previous.file.documentVersionId !== current.file.documentVersionId
        || previous.file.sha256Hex !== current.file.sha256Hex || canonical(source.definition) !== canonical(item.definition)
        || canonical(comparableMaterial(source.definition, source.materialSnapshot)) !== canonical(comparableMaterial(item.definition, item.materialSnapshot))) continue;
      const key = `${item.requirementItemId}:${previous.submissionId}:${previous.review.reviewId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ source, approval: {
        requirementItemId: item.requirementItemId, submissionId: current.submissionId,
        expectedReviewId: current.review?.reviewId ?? null,
        sourceSubmissionId: previous.submissionId, sourceReviewId: previous.review.reviewId,
      } });
    }
  }
  return candidates;
}
