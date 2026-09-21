import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import { decimalVersion, scalarText, timestamp, parseApplicationRequirementsV2, type ApplicationRequirementsV2 } from "./application-requirements-v2.ts";
import {
  applicationDocumentRecord as record, applicationDocumentExact as exact, applicationDocumentHash as hash,
  applicationDocumentFailure, parseApplicationDocumentSelection, parseApplicationDocumentFile,
  parseApplicationDocumentReview, parseApplicationDocumentDefinition, parseApplicationDocumentMaterial,
  parseApplicationDocumentSubmission, parseApplicationDocumentItem, parseApplicationDocumentCursor,
  type ApplicationDocumentTarget, type ApplicationDocumentSelection, type ApplicationDocumentFile,
  type ApplicationDocumentReview, type ApplicationDocumentDefinition, type ApplicationDocumentMaterialSnapshot,
  type ApplicationDocumentSubmission, type ApplicationDocumentItemState, type ApplicationDocumentCursor,
  type ApplicationDocumentFailure,
} from "./application-documents.ts";

export type ApplicationPackageTarget = ApplicationDocumentTarget;
export type ApplicationPackageSelection = Readonly<{ requirementItemId: string; selection: ApplicationDocumentSelection; expectedPreviousSubmissionId: string | null }>;
export type ApplicationPackageSubmitIntent = ApplicationPackageTarget & Readonly<{
  requirementsRevisionId: string; expectedPreviousPackageId: string | null; items: readonly ApplicationPackageSelection[]; requestId: string;
}>;
export type ApplicationPackageReviewExpectation = Readonly<{ requirementItemId: string; submissionId: string; expectedReviewId: string | null }>;
export type ApplicationPackageReuseApproval = ApplicationPackageReviewExpectation & Readonly<{ sourceSubmissionId: string; sourceReviewId: string }>;
export type ApplicationPackageDecision = "approved" | "correction_required";
export type ApplicationPackageReviewIntent = ApplicationPackageTarget & Readonly<{
  packageId: string; expectedPreviousReviewId: string | null; decision: ApplicationPackageDecision; reason: string | null;
  affectedItemIds: readonly string[]; documentReviews: readonly ApplicationPackageReviewExpectation[];
  reuseApprovals: readonly ApplicationPackageReuseApproval[]; requestId: string;
}>;
export type ApplicationPackageReviewEvidence = Readonly<{
  requirementItemId: string; submissionId: string; review: ApplicationDocumentReview | null;
  reusedFromSubmissionId: string | null; reusedFromReview: ApplicationDocumentReview | null;
}>;
export type ApplicationPackageReview = Readonly<{
  packageReviewId: string; packageId: string; decision: ApplicationPackageDecision; reason: string | null;
  affectedItemIds: readonly string[]; documentReviews: readonly ApplicationPackageReviewEvidence[]; reviewedAt: string;
}>;
export type ApplicationPackageSummary = Readonly<{
  packageId: string; requirementsRevisionId: string; requirementsRevisionVersion: string;
  origin: "evo_starter" | "staff_confirmed"; configurationState: "needs_confirmation" | "confirmed";
  packageVersion: string; previousPackageId: string | null; compositionSha256: string; submittedAt: string;
  itemCount: number; isCurrentRequirements: boolean; latestReview: ApplicationPackageReview | null;
}>;
export type ApplicationPackageProgram = Readonly<{
  institutionId: string; publicationId: string; programId: string; intakeId: string;
  universityTitle: string; programTitle: string; intakeLabel: string;
}>;
export type ApplicationPackageItem = Readonly<{
  packageItemId: string; requirementItemId: string; definition: ApplicationDocumentDefinition;
  materialSnapshot: ApplicationDocumentMaterialSnapshot | null; selection: ApplicationDocumentSelection; submission: ApplicationDocumentSubmission;
}>;
export type ApplicationPackageWarning = Readonly<{
  requirementItemId: string; submissionId: string; reason: "review_changed" | "file_unavailable"; currentReview: ApplicationDocumentReview | null;
}>;
export type ApplicationPackageDetail = ApplicationPackageTarget & Readonly<{
  protocolVersion: 1; package: ApplicationPackageSummary; program: ApplicationPackageProgram;
  items: readonly ApplicationPackageItem[]; currentWarnings: readonly ApplicationPackageWarning[];
}>;
export const APPLICATION_PACKAGE_READY_REASONS = ["requirements_unavailable", "empty_composition", "missing_required", "material_unavailable", "file_unavailable", "previous_submission_changed"] as const;
export type ApplicationPackageReadyReason = typeof APPLICATION_PACKAGE_READY_REASONS[number];
export type ApplicationPackageReadinessSelection = ApplicationPackageSelection & Readonly<{
  file: ApplicationDocumentFile | null; submissionId: string | null; reasons: readonly ApplicationPackageReadyReason[];
}>;
export type ApplicationPackageReadiness = ApplicationPackageTarget & Readonly<{
  protocolVersion: 1; requirements: ApplicationRequirementsV2; documentItems: readonly ApplicationDocumentItemState[];
  latestPackage: ApplicationPackageSummary | null; selections: readonly ApplicationPackageReadinessSelection[];
  missingRequiredItemIds: readonly string[]; reasons: readonly ApplicationPackageReadyReason[]; canSubmit: boolean;
}>;
export type ApplicationPackageHistory = ApplicationPackageTarget & Readonly<{ protocolVersion: 1; packages: readonly ApplicationPackageSummary[]; nextCursor: ApplicationDocumentCursor | null }>;
export type ApplicationPackageReviewHistory = ApplicationPackageTarget & Readonly<{ protocolVersion: 1; packageId: string; reviews: readonly ApplicationPackageReview[]; nextCursor: ApplicationDocumentCursor | null }>;
export type ApplicationPackageQueueItem = ApplicationPackageTarget & Readonly<{ studentDisplayName: string; program: ApplicationPackageProgram; package: ApplicationPackageSummary }>;
export type ApplicationPackageQueue = Readonly<{ protocolVersion: 1; items: readonly ApplicationPackageQueueItem[]; nextCursor: ApplicationDocumentCursor | null }>;
export type ApplicationPackageNotification = ApplicationPackageTarget & Readonly<{ protocolVersion: 1; notificationId: string; packageId: string; packageReviewId: string; review: ApplicationPackageReview }>;
export type ApplicationPackageSubmitReceiptItem = Readonly<{ packageItemId: string; requirementItemId: string; documentSlotId: string; documentVersionId: string; submissionId: string }>;
export type ApplicationPackageSubmitReceipt = ApplicationPackageTarget & Readonly<{
  protocolVersion: 1; requestId: string; packageId: string; requirementsRevisionId: string; packageVersion: string;
  compositionSha256: string; submittedAt: string; reused: boolean; items: readonly ApplicationPackageSubmitReceiptItem[];
}>;
export type ApplicationPackageReviewReceipt = ApplicationPackageTarget & Readonly<{ protocolVersion: 1; requestId: string; packageId: string; packageReview: ApplicationPackageReview }>;
export type ApplicationPackageOperation = "submit" | "review";
export type ApplicationPackageRecovery = ApplicationPackageTarget & Readonly<{ protocolVersion: 1; operation: ApplicationPackageOperation; requestId: string }> & (
  Readonly<{ status: "not_written"; receipt: null }> |
  Readonly<{ status: "committed"; receipt: ApplicationPackageSubmitReceipt | ApplicationPackageReviewReceipt }>
);
export type ApplicationPackageFailure = ApplicationDocumentFailure | "not_ready" | "review_not_ready" | "reuse_unavailable";
export type ApplicationPackageFailureResult = Readonly<{ ok: false; reason: ApplicationPackageFailure; resolution: "retain" | "not_written" }>;
export type ApplicationPackageSubmitResult = Readonly<{ ok: true; receipt: ApplicationPackageSubmitReceipt }> | ApplicationPackageFailureResult;
export type ApplicationPackageReviewResult = Readonly<{ ok: true; receipt: ApplicationPackageReviewReceipt }> | ApplicationPackageFailureResult;
export type ApplicationPackageRecoveryResult = Readonly<{ ok: true; recovery: ApplicationPackageRecovery }> | ApplicationPackageFailureResult;
export class ApplicationPackageError extends Error {
  readonly reason: ApplicationPackageFailure;
  constructor(reason: ApplicationPackageFailure) { super("Application package is unavailable."); this.name = "ApplicationPackageError"; this.reason = reason; }
}
export function applicationPackageFailure(error: unknown): ApplicationPackageFailureResult {
  if (error instanceof ApplicationPackageError) return { ok: false, reason: error.reason, resolution: "retain" };
  const row = record(error), message = row?.message;
  const known: Record<string, ApplicationPackageFailure> = {
    application_packages_unavailable: "forbidden", application_package_invalid_intent: "invalid",
    application_package_intent_conflict: "request_conflict", application_package_stale_requirements: "stale_context",
    application_package_previous_package_changed: "stale_context", application_package_previous_submission_changed: "stale_context",
    application_package_previous_review_changed: "stale_context", application_package_document_review_changed: "stale_context",
    application_package_not_ready: "not_ready", application_package_review_not_ready: "review_not_ready", application_package_reuse_unavailable: "reuse_unavailable",
  };
  return { ok: false, reason: typeof message === "string" && Object.hasOwn(known, message) ? known[message] : applicationDocumentFailure(error).reason, resolution: "retain" };
}

const TARGET = ["studentCaseId", "applicationId"];
const selectionKeys = ["requirementItemId", "selection", "expectedPreviousSubmissionId"];
const expectationKeys = ["requirementItemId", "submissionId", "expectedReviewId"];
const nullableId = (v: unknown): v is string | null => v === null || uuid(v);
function list<T>(v: unknown, limit: number, parse: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > limit) return null;
  const result: T[] = [];
  for (const item of v) { const parsed = parse(item); if (parsed === null) return null; result.push(parsed); }
  return result;
}
const unique = <T>(v: readonly T[], key: (v: T) => string): boolean => new Set(v.map(key)).size === v.length;
function ids(v: unknown, limit = 100): string[] | null { const found = list(v, limit, x => uuid(x) ? x : null); return found && unique(found, x => x) ? found : null; }
function target(row: Record<string, unknown>, expected?: ApplicationPackageTarget): row is Record<string, unknown> & ApplicationPackageTarget {
  return uuid(row.studentCaseId) && uuid(row.applicationId) && (!expected || (row.studentCaseId === expected.studentCaseId && row.applicationId === expected.applicationId));
}
function selectionItem(value: unknown): ApplicationPackageSelection | null {
  const row = record(value);
  if (!row || !exact(row, selectionKeys) || !uuid(row.requirementItemId) || !nullableId(row.expectedPreviousSubmissionId)) return null;
  const selection = parseApplicationDocumentSelection(row.selection);
  return selection ? { requirementItemId: row.requirementItemId, selection, expectedPreviousSubmissionId: row.expectedPreviousSubmissionId } : null;
}
export function parseApplicationPackageSelections(value: unknown): readonly ApplicationPackageSelection[] | null {
  const items = list(value, 100, selectionItem);
  return items && unique(items, x => x.requirementItemId) ? items : null;
}
export function parseApplicationPackageSubmitIntent(value: unknown): ApplicationPackageSubmitIntent | null {
  const row = record(value);
  if (!row || !exact(row, [...TARGET, "requirementsRevisionId", "expectedPreviousPackageId", "items", "requestId"])
    || !target(row) || !uuid(row.requirementsRevisionId) || !nullableId(row.expectedPreviousPackageId) || !uuid(row.requestId)) return null;
  const items = parseApplicationPackageSelections(row.items);
  return items?.length ? { studentCaseId: row.studentCaseId, applicationId: row.applicationId, requirementsRevisionId: row.requirementsRevisionId,
    expectedPreviousPackageId: row.expectedPreviousPackageId, items, requestId: row.requestId } : null;
}
function expectation(value: unknown): ApplicationPackageReviewExpectation | null {
  const row = record(value);
  return row && exact(row, expectationKeys) && uuid(row.requirementItemId) && uuid(row.submissionId) && nullableId(row.expectedReviewId)
    ? { requirementItemId: row.requirementItemId, submissionId: row.submissionId, expectedReviewId: row.expectedReviewId } : null;
}
function reuseApproval(value: unknown): ApplicationPackageReuseApproval | null {
  const row = record(value);
  if (!row || !exact(row, [...expectationKeys, "sourceSubmissionId", "sourceReviewId"]) || !uuid(row.sourceSubmissionId) || !uuid(row.sourceReviewId)) return null;
  const base = expectation(Object.fromEntries(expectationKeys.map(k => [k, row[k]])));
  return base && base.submissionId !== row.sourceSubmissionId ? { ...base, sourceSubmissionId: row.sourceSubmissionId, sourceReviewId: row.sourceReviewId } : null;
}
function decisionFields(row: Record<string, unknown>): boolean {
  return row.decision === "approved" ? row.reason === null && Array.isArray(row.affectedItemIds) && row.affectedItemIds.length === 0
    : row.decision === "correction_required" && scalarText(row.reason, 5000) && !row.reason.includes("\u0000");
}
export function parseApplicationPackageReviewIntent(value: unknown): ApplicationPackageReviewIntent | null {
  const row = record(value);
  if (!row || !exact(row, [...TARGET, "packageId", "expectedPreviousReviewId", "decision", "reason", "affectedItemIds", "documentReviews", "reuseApprovals", "requestId"])
    || !target(row) || !uuid(row.packageId) || !nullableId(row.expectedPreviousReviewId) || !uuid(row.requestId) || !decisionFields(row)) return null;
  const affectedItemIds = ids(row.affectedItemIds), documentReviews = list(row.documentReviews, 100, expectation), reuseApprovals = list(row.reuseApprovals, 100, reuseApproval);
  if (!affectedItemIds || !documentReviews?.length || !reuseApprovals || !unique(documentReviews, x => x.requirementItemId)
    || !unique(documentReviews, x => x.submissionId) || !unique(reuseApprovals, x => x.requirementItemId)
    || affectedItemIds.some(id => !documentReviews.some(d => d.requirementItemId === id))
    || (row.decision !== "approved" && reuseApprovals.length > 0)
    || reuseApprovals.some(r => !documentReviews.some(d => d.requirementItemId === r.requirementItemId && d.submissionId === r.submissionId && d.expectedReviewId === r.expectedReviewId))) return null;
  return { studentCaseId: row.studentCaseId, applicationId: row.applicationId, packageId: row.packageId, expectedPreviousReviewId: row.expectedPreviousReviewId,
    decision: row.decision as ApplicationPackageDecision, reason: row.reason as string | null, affectedItemIds, documentReviews, reuseApprovals, requestId: row.requestId };
}
function reviewEvidence(value: unknown): ApplicationPackageReviewEvidence | null {
  const row = record(value);
  if (!row || !exact(row, ["requirementItemId", "submissionId", "review", "reusedFromSubmissionId", "reusedFromReview"])
    || !uuid(row.requirementItemId) || !uuid(row.submissionId) || !nullableId(row.reusedFromSubmissionId)) return null;
  const review = row.review === null ? null : parseApplicationDocumentReview(row.review);
  const reusedFromReview = row.reusedFromReview === null ? null : parseApplicationDocumentReview(row.reusedFromReview);
  if ((row.review !== null && !review) || (row.reusedFromReview !== null && !reusedFromReview)
    || (row.reusedFromSubmissionId === null) !== (reusedFromReview === null)
    || (reusedFromReview && (reusedFromReview.decision !== "approved" || review?.decision !== "approved" || row.submissionId === row.reusedFromSubmissionId))) return null;
  return { requirementItemId: row.requirementItemId, submissionId: row.submissionId, review, reusedFromSubmissionId: row.reusedFromSubmissionId, reusedFromReview };
}
export function parseApplicationPackageReview(value: unknown): ApplicationPackageReview | null {
  const row = record(value);
  if (!row || !exact(row, ["packageReviewId", "packageId", "decision", "reason", "affectedItemIds", "documentReviews", "reviewedAt"])
    || !uuid(row.packageReviewId) || !uuid(row.packageId) || !timestamp(row.reviewedAt) || !decisionFields(row)) return null;
  const affectedItemIds = ids(row.affectedItemIds), documentReviews = list(row.documentReviews, 100, reviewEvidence);
  if (!affectedItemIds || !documentReviews?.length || !unique(documentReviews, x => x.requirementItemId) || !unique(documentReviews, x => x.submissionId)
    || affectedItemIds.some(id => !documentReviews.some(d => d.requirementItemId === id))
    || (row.decision === "approved" && documentReviews.some(d => d.review?.decision !== "approved"))
    || (row.decision === "correction_required" && documentReviews.some(d => d.reusedFromReview !== null))) return null;
  return { packageReviewId: row.packageReviewId, packageId: row.packageId, decision: row.decision as ApplicationPackageDecision,
    reason: row.reason as string | null, affectedItemIds, documentReviews, reviewedAt: row.reviewedAt };
}
export function parseApplicationPackageSummary(value: unknown): ApplicationPackageSummary | null {
  const row = record(value);
  if (!row || !exact(row, ["packageId", "requirementsRevisionId", "requirementsRevisionVersion", "origin", "configurationState", "packageVersion", "previousPackageId", "compositionSha256", "submittedAt", "itemCount", "isCurrentRequirements", "latestReview"])
    || !uuid(row.packageId) || !uuid(row.requirementsRevisionId) || !decimalVersion(row.requirementsRevisionVersion) || !decimalVersion(row.packageVersion)
    || !nullableId(row.previousPackageId) || row.previousPackageId === row.packageId || !hash(row.compositionSha256) || !timestamp(row.submittedAt)
    || typeof row.itemCount !== "number" || !Number.isInteger(row.itemCount) || row.itemCount < 1 || row.itemCount > 100 || typeof row.isCurrentRequirements !== "boolean"
    || !((row.origin === "evo_starter" && row.configurationState === "needs_confirmation") || (row.origin === "staff_confirmed" && row.configurationState === "confirmed"))) return null;
  const latestReview = row.latestReview === null ? null : parseApplicationPackageReview(row.latestReview);
  if (row.latestReview !== null && (!latestReview || latestReview.packageId !== row.packageId || latestReview.documentReviews.length !== row.itemCount)) return null;
  return { ...row, latestReview } as ApplicationPackageSummary;
}
function receiptItem(value: unknown): ApplicationPackageSubmitReceiptItem | null {
  const row = record(value), keys = ["packageItemId", "requirementItemId", "documentSlotId", "documentVersionId", "submissionId"];
  return row && exact(row, keys) && keys.every(k => uuid(row[k])) ? { ...row } as ApplicationPackageSubmitReceiptItem : null;
}
export function parseApplicationPackageSubmitReceipt(value: unknown, intent?: ApplicationPackageSubmitIntent): ApplicationPackageSubmitReceipt | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", "requestId", ...TARGET, "packageId", "requirementsRevisionId", "packageVersion", "compositionSha256", "submittedAt", "reused", "items"])
    || row.protocolVersion !== 1 || !target(row, intent) || !uuid(row.requestId) || !uuid(row.packageId) || !uuid(row.requirementsRevisionId)
    || !decimalVersion(row.packageVersion) || !hash(row.compositionSha256) || !timestamp(row.submittedAt) || typeof row.reused !== "boolean") return null;
  const items = list(row.items, 100, receiptItem);
  if (!items?.length || !unique(items, x => x.packageItemId) || !unique(items, x => x.requirementItemId) || !unique(items, x => x.submissionId)
    || (intent && (row.requestId !== intent.requestId || row.requirementsRevisionId !== intent.requirementsRevisionId || items.length !== intent.items.length
      || items.some((item, i) => item.requirementItemId !== intent.items[i].requirementItemId || item.documentVersionId !== intent.items[i].selection.documentVersionId)))) return null;
  return { protocolVersion: 1, requestId: row.requestId, studentCaseId: row.studentCaseId, applicationId: row.applicationId,
    packageId: row.packageId, requirementsRevisionId: row.requirementsRevisionId, packageVersion: row.packageVersion,
    compositionSha256: row.compositionSha256, submittedAt: row.submittedAt, reused: row.reused, items };
}
function matchesReview(review: ApplicationPackageReview, intent: ApplicationPackageReviewIntent): boolean {
  if (review.packageId !== intent.packageId || review.decision !== intent.decision || review.reason !== intent.reason
    || JSON.stringify(review.affectedItemIds) !== JSON.stringify(intent.affectedItemIds) || review.documentReviews.length !== intent.documentReviews.length) return false;
  return review.documentReviews.every((item, index) => {
    const expected = intent.documentReviews[index], reuse = intent.reuseApprovals.find(r => r.requirementItemId === expected.requirementItemId);
    if (item.requirementItemId !== expected.requirementItemId || item.submissionId !== expected.submissionId) return false;
    if (reuse) return item.reusedFromSubmissionId === reuse.sourceSubmissionId && item.reusedFromReview?.reviewId === reuse.sourceReviewId
      && item.review?.decision === "approved" && (expected.expectedReviewId === null || item.review.reviewId === expected.expectedReviewId);
    return item.reusedFromSubmissionId === null && item.reusedFromReview === null && (item.review?.reviewId ?? null) === expected.expectedReviewId;
  });
}
export function parseApplicationPackageReviewReceipt(value: unknown, intent?: ApplicationPackageReviewIntent): ApplicationPackageReviewReceipt | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", "requestId", ...TARGET, "packageId", "packageReview"]) || row.protocolVersion !== 1
    || !target(row, intent) || !uuid(row.requestId) || !uuid(row.packageId)) return null;
  const packageReview = parseApplicationPackageReview(row.packageReview);
  if (!packageReview || packageReview.packageId !== row.packageId || (intent && (row.requestId !== intent.requestId || !matchesReview(packageReview, intent)))) return null;
  return { protocolVersion: 1, requestId: row.requestId, studentCaseId: row.studentCaseId, applicationId: row.applicationId, packageId: row.packageId, packageReview };
}
export function parseApplicationPackageRecovery(value: unknown, operation: ApplicationPackageOperation, intent: ApplicationPackageSubmitIntent | ApplicationPackageReviewIntent): ApplicationPackageRecovery | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", "operation", "requestId", ...TARGET, "status", "receipt"]) || row.protocolVersion !== 1
    || row.operation !== operation || !uuid(row.requestId) || row.requestId !== intent.requestId || !target(row, intent)) return null;
  if (operation === "submit" ? !parseApplicationPackageSubmitIntent(intent) : !parseApplicationPackageReviewIntent(intent)) return null;
  const identity = { protocolVersion: 1 as const, operation, requestId: row.requestId, studentCaseId: row.studentCaseId, applicationId: row.applicationId };
  if (row.status === "not_written") return row.receipt === null ? { ...identity, status: "not_written", receipt: null } : null;
  if (row.status !== "committed") return null;
  const receipt = operation === "submit" ? parseApplicationPackageSubmitReceipt(row.receipt, intent as ApplicationPackageSubmitIntent)
    : parseApplicationPackageReviewReceipt(row.receipt, intent as ApplicationPackageReviewIntent);
  return receipt ? { ...identity, status: "committed", receipt } : null;
}

function program(value: unknown): ApplicationPackageProgram | null {
  const row = record(value);
  return row && exact(row, ["institutionId", "publicationId", "programId", "intakeId", "universityTitle", "programTitle", "intakeLabel"])
    && [row.institutionId, row.publicationId, row.intakeId].every(uuid) && typeof row.programId === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(row.programId)
    && [row.universityTitle, row.programTitle, row.intakeLabel].every(v => scalarText(v, 1000)) ? { ...row } as ApplicationPackageProgram : null;
}
function packageItem(value: unknown): ApplicationPackageItem | null {
  const row = record(value);
  if (!row || !exact(row, ["packageItemId", "requirementItemId", "definition", "materialSnapshot", "selection", "submission"])
    || !uuid(row.packageItemId) || !uuid(row.requirementItemId)) return null;
  const definition = parseApplicationDocumentDefinition(row.definition), materialSnapshot = row.materialSnapshot === null ? null : parseApplicationDocumentMaterial(row.materialSnapshot);
  const selection = parseApplicationDocumentSelection(row.selection), submission = parseApplicationDocumentSubmission(row.submission);
  if (!definition || (row.materialSnapshot !== null && !materialSnapshot) || !selection || !submission || submission.requirementItemId !== row.requirementItemId
    || submission.documentSlotId !== definition.documentSlotId || selection.documentVersionId !== submission.file.documentVersionId) return null;
  return { packageItemId: row.packageItemId, requirementItemId: row.requirementItemId, definition, materialSnapshot, selection, submission };
}
function warning(value: unknown): ApplicationPackageWarning | null {
  const row = record(value);
  if (!row || !exact(row, ["requirementItemId", "submissionId", "reason", "currentReview"]) || !uuid(row.requirementItemId) || !uuid(row.submissionId)
    || typeof row.reason !== "string" || !["review_changed", "file_unavailable"].includes(row.reason)) return null;
  const currentReview = row.currentReview === null ? null : parseApplicationDocumentReview(row.currentReview);
  return row.currentReview !== null && !currentReview ? null : { requirementItemId: row.requirementItemId, submissionId: row.submissionId, reason: row.reason as ApplicationPackageWarning["reason"], currentReview };
}
export function parseApplicationPackageDetail(value: unknown, expected: ApplicationPackageTarget, packageId: string): ApplicationPackageDetail | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", ...TARGET, "package", "program", "items", "currentWarnings"]) || row.protocolVersion !== 1 || !target(row, expected)) return null;
  const summary = parseApplicationPackageSummary(row.package), metadata = program(row.program), items = list(row.items, 100, packageItem), currentWarnings = list(row.currentWarnings, 200, warning);
  if (!summary || summary.packageId !== packageId || !metadata || !items || items.length !== summary.itemCount || !currentWarnings
    || !unique(items, i => i.packageItemId) || !unique(items, i => i.requirementItemId) || !unique(items, i => i.submission.submissionId)
    || items.some(i => i.submission.requirementsRevisionId !== summary.requirementsRevisionId)
    || (summary.latestReview && summary.latestReview.documentReviews.some((r, i) => r.requirementItemId !== items[i].requirementItemId || r.submissionId !== items[i].submission.submissionId))
    || !unique(currentWarnings, w => `${w.requirementItemId}:${w.reason}`)
    || currentWarnings.some(w => { const item = items.find(i => i.requirementItemId === w.requirementItemId); return !item || item.submission.submissionId !== w.submissionId
      || JSON.stringify(item.submission.review) !== JSON.stringify(w.currentReview)
      || (w.reason === "file_unavailable" && item.submission.file.technicalAvailability !== "unavailable")
      || (w.reason === "review_changed" && (!summary.latestReview || (summary.latestReview.documentReviews.find(r => r.requirementItemId === w.requirementItemId)?.review?.reviewId ?? null) === (w.currentReview?.reviewId ?? null))); })) return null;
  const expectedWarningCount = items.reduce((count, item) => count + (item.submission.file.technicalAvailability === "unavailable" ? 1 : 0)
    + (summary.latestReview && (summary.latestReview.documentReviews.find(r => r.requirementItemId === item.requirementItemId)?.review?.reviewId ?? null)
      !== (item.submission.review?.reviewId ?? null) ? 1 : 0), 0);
  if (currentWarnings.length !== expectedWarningCount) return null;
  return { protocolVersion: 1, ...expected, package: summary, program: metadata, items, currentWarnings };
}
function reasons(value: unknown): ApplicationPackageReadyReason[] | null {
  const found = list(value, APPLICATION_PACKAGE_READY_REASONS.length, v => typeof v === "string" && APPLICATION_PACKAGE_READY_REASONS.includes(v as ApplicationPackageReadyReason) ? v as ApplicationPackageReadyReason : null);
  return found && unique(found, x => x) ? found : null;
}
function readinessSelection(value: unknown): ApplicationPackageReadinessSelection | null {
  const row = record(value);
  if (!row || !exact(row, [...selectionKeys, "file", "submissionId", "reasons"]) || !nullableId(row.submissionId)) return null;
  const base = selectionItem(Object.fromEntries(selectionKeys.map(k => [k, row[k]]))), file = row.file === null ? null : parseApplicationDocumentFile(row.file), why = reasons(row.reasons);
  if (!base || !why || (row.file !== null && !file) || (file && file.documentVersionId !== base.selection.documentVersionId)) return null;
  return { ...base, file, submissionId: row.submissionId, reasons: why };
}
export function parseApplicationPackageReadiness(value: unknown, expected: ApplicationPackageTarget): ApplicationPackageReadiness | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", ...TARGET, "requirements", "documentItems", "latestPackage", "selections", "missingRequiredItemIds", "reasons", "canSubmit"])
    || row.protocolVersion !== 1 || !target(row, expected) || typeof row.canSubmit !== "boolean") return null;
  const requirements = parseApplicationRequirementsV2(row.requirements, expected.studentCaseId, expected.applicationId), documentItems = list(row.documentItems, 100, parseApplicationDocumentItem);
  const latestPackage = row.latestPackage === null ? null : parseApplicationPackageSummary(row.latestPackage), selections = list(row.selections, 100, readinessSelection);
  const missingRequiredItemIds = ids(row.missingRequiredItemIds), why = reasons(row.reasons);
  if (!requirements || !documentItems || (row.latestPackage !== null && !latestPackage) || !selections || !missingRequiredItemIds || !why
    || documentItems.length !== requirements.items.length || !unique(documentItems, i => i.requirementItemId) || !unique(selections, i => i.requirementItemId)
    || documentItems.some((item, i) => item.requirementItemId !== requirements.items[i].requirementItemId || item.documentSlotId !== requirements.items[i].documentSlotId
      || [item.savedDraft, item.submission].some(v => v && v.requirementsRevisionId !== requirements.revisionId))
    || selections.some(s => !requirements.items.some(i => i.requirementItemId === s.requirementItemId))
    || missingRequiredItemIds.some(id => !requirements.items.some(i => i.requirementItemId === id && i.required) || selections.some(s => s.requirementItemId === id))
    || requirements.items.some(i => i.required && !selections.some(s => s.requirementItemId === i.requirementItemId) && !missingRequiredItemIds.includes(i.requirementItemId))
    || (latestPackage && latestPackage.isCurrentRequirements !== (latestPackage.requirementsRevisionId === requirements.revisionId))
    || (row.canSubmit && (why.length !== 0 || selections.length === 0 || missingRequiredItemIds.length !== 0 || requirements.revisionId === null
      || selections.some(s => s.reasons.length > 0 || s.file?.technicalAvailability !== "available")))) return null;
  return { protocolVersion: 1, ...expected, requirements, documentItems, latestPackage, selections, missingRequiredItemIds, reasons: why, canSubmit: row.canSubmit };
}
function micros(value: string): bigint { return BigInt(Date.parse(value)) * BigInt(1000) + BigInt((value.match(/\.(\d+)/u)?.[1] ?? "").padEnd(6, "0").slice(3, 6)); }
function page<T>(items: readonly T[], next: ApplicationDocumentCursor | null, cursorOf: (v: T) => ApplicationDocumentCursor): boolean {
  const cursors = items.map(cursorOf), last = cursors.at(-1);
  return unique(cursors, c => c.id) && cursors.every((c, i) => i === 0 || micros(cursors[i - 1].createdAt) > micros(c.createdAt)
    || (micros(cursors[i - 1].createdAt) === micros(c.createdAt) && cursors[i - 1].id > c.id))
    && (next === null || (!!last && next.createdAt === last.createdAt && next.id === last.id));
}
export function parseApplicationPackageHistory(value: unknown, expected: ApplicationPackageTarget): ApplicationPackageHistory | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", ...TARGET, "packages", "nextCursor"]) || row.protocolVersion !== 1 || !target(row, expected)) return null;
  const packages = list(row.packages, 50, parseApplicationPackageSummary), nextCursor = row.nextCursor === null ? null : parseApplicationDocumentCursor(row.nextCursor);
  if (!packages || (row.nextCursor !== null && !nextCursor) || !page(packages, nextCursor, p => ({ createdAt: p.submittedAt, id: p.packageId }))) return null;
  return { protocolVersion: 1, ...expected, packages, nextCursor };
}
export function parseApplicationPackageReviewHistory(value: unknown, expected: ApplicationPackageTarget, packageId: string): ApplicationPackageReviewHistory | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", ...TARGET, "packageId", "reviews", "nextCursor"]) || row.protocolVersion !== 1 || !target(row, expected) || !uuid(row.packageId) || row.packageId !== packageId) return null;
  const reviews = list(row.reviews, 50, parseApplicationPackageReview), nextCursor = row.nextCursor === null ? null : parseApplicationDocumentCursor(row.nextCursor);
  if (!reviews || reviews.some(r => r.packageId !== packageId) || (row.nextCursor !== null && !nextCursor) || !page(reviews, nextCursor, r => ({ createdAt: r.reviewedAt, id: r.packageReviewId }))) return null;
  return { protocolVersion: 1, ...expected, packageId, reviews, nextCursor };
}
function queueItem(value: unknown): ApplicationPackageQueueItem | null {
  const row = record(value);
  if (!row || !exact(row, [...TARGET, "studentDisplayName", "program", "package"]) || !target(row) || !scalarText(row.studentDisplayName, 500)) return null;
  const metadata = program(row.program), summary = parseApplicationPackageSummary(row.package);
  return metadata && summary ? { studentCaseId: row.studentCaseId, applicationId: row.applicationId, studentDisplayName: row.studentDisplayName, program: metadata, package: summary } : null;
}
export function parseApplicationPackageQueue(value: unknown): ApplicationPackageQueue | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", "items", "nextCursor"]) || row.protocolVersion !== 1) return null;
  const items = list(row.items, 50, queueItem), nextCursor = row.nextCursor === null ? null : parseApplicationDocumentCursor(row.nextCursor);
  if (!items || (row.nextCursor !== null && !nextCursor) || !page(items, nextCursor, i => ({ createdAt: i.package.submittedAt, id: i.package.packageId }))) return null;
  return { protocolVersion: 1, items, nextCursor };
}
export function parseApplicationPackageNotification(value: unknown, notificationId: string, studentCaseId: string): ApplicationPackageNotification | null {
  const row = record(value);
  if (!row || !exact(row, ["protocolVersion", "notificationId", ...TARGET, "packageId", "packageReviewId", "review"]) || row.protocolVersion !== 1
    || !target(row) || row.studentCaseId !== studentCaseId || !uuid(row.notificationId) || row.notificationId !== notificationId || !uuid(row.packageId) || !uuid(row.packageReviewId)) return null;
  const review = parseApplicationPackageReview(row.review);
  return review && review.packageId === row.packageId && review.packageReviewId === row.packageReviewId ? { protocolVersion: 1, notificationId: row.notificationId,
    studentCaseId: row.studentCaseId, applicationId: row.applicationId, packageId: row.packageId, packageReviewId: row.packageReviewId, review } : null;
}
