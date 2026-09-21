import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import { decimalVersion, scalarText, timestamp, deadline, requirementKey, parseApplicationRequirementsV2,
  type ApplicationRequirementsV2, type ApplicationRequirementDeadline } from "./application-requirements-v2.ts";

export type ApplicationDocumentOwner = Readonly<{ organizationId: string; membershipId: string }>;
export type ApplicationDocumentTarget = Readonly<{ studentCaseId: string; applicationId: string }>;
export type ApplicationDocumentItemTarget = ApplicationDocumentTarget & Readonly<{
  requirementsRevisionId: string; requirementItemId: string; documentSlotId: string;
}>;
export type ApplicationDocumentScope = ApplicationDocumentOwner & ApplicationDocumentTarget;
export type ApplicationDocumentFileMetadata = Readonly<{
  originalFilename: string;
  declaredMimeType: "application/pdf" | "image/jpeg" | "image/png";
  byteSize: string; sha256Hex: string;
}>;
export type ApplicationDocumentUploadHeader = ApplicationDocumentItemTarget & Readonly<{
  protocolVersion: 1; file: ApplicationDocumentFileMetadata;
}>;
export type ApplicationDocumentUploadIntent = ApplicationDocumentUploadHeader & Readonly<{ requestId: string }>;
export type ApplicationDocumentUploadReceipt = ApplicationDocumentItemTarget & Readonly<{
  protocolVersion: 1; requestId: string; uploadContextId: string; documentVersionId: string;
  versionNo: string; file: ApplicationDocumentFileMetadata; finalizedAt: string; publishedToLegacySlot: false;
}>;
export type ApplicationDocumentFailure = "invalid" | "forbidden" | "request_conflict" | "stale_context"
  | "case_ineligible" | "application_ineligible" | "file_unavailable" | "busy" | "lease_expired"
  | "file_too_large" | "unsupported_type" | "malware_detected" | "rate_limited" | "unavailable";
export type ApplicationDocumentFailureResult = Readonly<{
  ok: false; reason: ApplicationDocumentFailure; resolution: "retain" | "not_written";
}>;
export type ApplicationDocumentUploadResult = Readonly<{ ok: true; receipt: ApplicationDocumentUploadReceipt }> | ApplicationDocumentFailureResult;
export type ApplicationDocumentSelection = Readonly<{ kind: "program_upload"; uploadContextId: string; documentVersionId: string }>
  | Readonly<{ kind: "existing_version"; documentVersionId: string }>;
export type ApplicationDocumentSubmitIntent = ApplicationDocumentTarget & Readonly<{
  requirementsRevisionId: string; requirementItemId: string; selection: ApplicationDocumentSelection;
  expectedPreviousSubmissionId: string | null; requestId: string;
}>;
export type ApplicationDocumentSubmitReceipt = ApplicationDocumentItemTarget & Readonly<{
  protocolVersion: 1; requestId: string; submissionId: string; documentVersionId: string;
  versionNo: string; submittedAt: string; reused: boolean;
}>;
export type ApplicationDocumentReviewDecision = "approved" | "correction_required" | "rejected";
export type ApplicationDocumentReviewIntent = Readonly<{
  submissionId: string; expectedPreviousReviewId: string | null; decision: ApplicationDocumentReviewDecision;
  reason: string | null; requestId: string;
}>;
export type ApplicationDocumentReviewReceipt = Readonly<{
  protocolVersion: 1; requestId: string; reviewId: string; submissionId: string;
  decision: ApplicationDocumentReviewDecision; reason: string | null; reviewedAt: string;
}>;
export type ApplicationDocumentSubmitResult = Readonly<{ ok: true; receipt: ApplicationDocumentSubmitReceipt }> | ApplicationDocumentFailureResult;
export type ApplicationDocumentReviewResult = Readonly<{ ok: true; receipt: ApplicationDocumentReviewReceipt }> | ApplicationDocumentFailureResult;

export const APPLICATION_DOCUMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const ITEM_TARGET_KEYS = ["studentCaseId", "applicationId", "requirementsRevisionId", "requirementItemId", "documentSlotId"] as const;
const FILE_KEYS = ["originalFilename", "declaredMimeType", "byteSize", "sha256Hex"] as const;
const HEADER_KEYS = ["protocolVersion", ...ITEM_TARGET_KEYS, "file"] as const;
export function applicationDocumentRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function applicationDocumentExact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function applicationDocumentHash(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[0-9a-f]+$/u.test(value);
}
export function applicationDocumentFilename(value: unknown): value is string {
  return scalarText(value, 255) && value === value.trim() && !/[\p{Cc}/\\]/u.test(value)
    && new TextEncoder().encode(value).byteLength <= 1024;
}
function itemTarget(value: Record<string, unknown>): ApplicationDocumentItemTarget | null {
  if (!ITEM_TARGET_KEYS.every(key => uuid(value[key]))) return null;
  return Object.fromEntries(ITEM_TARGET_KEYS.map(key => [key, value[key]])) as ApplicationDocumentItemTarget;
}
export function parseApplicationDocumentTarget(value: unknown): ApplicationDocumentTarget | null {
  const row = applicationDocumentRecord(value);
  return row && applicationDocumentExact(row, ["studentCaseId", "applicationId"]) && uuid(row.studentCaseId) && uuid(row.applicationId)
    ? { studentCaseId: row.studentCaseId, applicationId: row.applicationId } : null;
}
export function parseApplicationDocumentItemTarget(value: unknown): ApplicationDocumentItemTarget | null {
  const row = applicationDocumentRecord(value);
  return row && applicationDocumentExact(row, ITEM_TARGET_KEYS) ? itemTarget(row) : null;
}
export function parseApplicationDocumentFileMetadata(value: unknown): ApplicationDocumentFileMetadata | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, FILE_KEYS) || !applicationDocumentFilename(row.originalFilename)
    || !["application/pdf", "image/jpeg", "image/png"].includes(String(row.declaredMimeType))
    || typeof row.declaredMimeType !== "string" || !decimalVersion(row.byteSize)
    || BigInt(row.byteSize) > BigInt(APPLICATION_DOCUMENT_MAX_FILE_BYTES) || !applicationDocumentHash(row.sha256Hex)) return null;
  return { originalFilename: row.originalFilename, declaredMimeType: row.declaredMimeType as ApplicationDocumentFileMetadata["declaredMimeType"], byteSize: row.byteSize, sha256Hex: row.sha256Hex };
}
function uploadHeader(row: Record<string, unknown>): ApplicationDocumentUploadHeader | null {
  const target = itemTarget(row), file = parseApplicationDocumentFileMetadata(row.file);
  return target && file && row.protocolVersion === 1 ? { protocolVersion: 1, ...target, file } : null;
}
export function parseApplicationDocumentUploadHeader(value: unknown): ApplicationDocumentUploadHeader | null {
  const row = applicationDocumentRecord(value);
  return row && applicationDocumentExact(row, HEADER_KEYS) ? uploadHeader(row) : null;
}
export function parseApplicationDocumentUploadIntent(value: unknown): ApplicationDocumentUploadIntent | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, [...HEADER_KEYS, "requestId"]) || !uuid(row.requestId)) return null;
  const header = uploadHeader(row);
  return header ? { ...header, requestId: row.requestId } : null;
}
export function applicationDocumentCanonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function parseApplicationDocumentUploadReceipt(value: unknown, intent?: ApplicationDocumentUploadIntent): ApplicationDocumentUploadReceipt | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, [...HEADER_KEYS, "requestId", "uploadContextId", "documentVersionId", "versionNo", "finalizedAt", "publishedToLegacySlot"])
    || !uuid(row.requestId) || !uuid(row.uploadContextId) || !uuid(row.documentVersionId) || !decimalVersion(row.versionNo)
    || !timestamp(row.finalizedAt) || row.publishedToLegacySlot !== false) return null;
  const header = uploadHeader(row);
  if (!header || (intent && (intent.requestId !== row.requestId || applicationDocumentCanonical(header) !== applicationDocumentCanonical(applicationDocumentUploadHeaderFromIntent(intent))))) return null;
  return { ...header, requestId: row.requestId, uploadContextId: row.uploadContextId, documentVersionId: row.documentVersionId,
    versionNo: row.versionNo, finalizedAt: row.finalizedAt, publishedToLegacySlot: false };
}
export function applicationDocumentUploadHeaderFromIntent(intent: ApplicationDocumentUploadIntent): ApplicationDocumentUploadHeader {
  return { protocolVersion: 1, studentCaseId: intent.studentCaseId, applicationId: intent.applicationId,
    requirementsRevisionId: intent.requirementsRevisionId, requirementItemId: intent.requirementItemId, documentSlotId: intent.documentSlotId, file: intent.file };
}

export function parseApplicationDocumentSelection(value: unknown): ApplicationDocumentSelection | null {
  const row = applicationDocumentRecord(value);
  if (!row || !uuid(row.documentVersionId)) return null;
  if (row.kind === "existing_version" && applicationDocumentExact(row, ["kind", "documentVersionId"])) return { kind: row.kind, documentVersionId: row.documentVersionId };
  if (row.kind === "program_upload" && applicationDocumentExact(row, ["kind", "uploadContextId", "documentVersionId"]) && uuid(row.uploadContextId)) return { kind: row.kind, uploadContextId: row.uploadContextId, documentVersionId: row.documentVersionId };
  return null;
}
export function parseApplicationDocumentSubmitIntent(value: unknown): ApplicationDocumentSubmitIntent | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["studentCaseId", "applicationId", "requirementsRevisionId", "requirementItemId", "selection", "expectedPreviousSubmissionId", "requestId"])
    || ![row.studentCaseId, row.applicationId, row.requirementsRevisionId, row.requirementItemId, row.requestId].every(uuid)
    || !(row.expectedPreviousSubmissionId === null || uuid(row.expectedPreviousSubmissionId))) return null;
  const selection = parseApplicationDocumentSelection(row.selection);
  return selection ? { studentCaseId: row.studentCaseId as string, applicationId: row.applicationId as string,
    requirementsRevisionId: row.requirementsRevisionId as string, requirementItemId: row.requirementItemId as string,
    requestId: row.requestId as string, expectedPreviousSubmissionId: row.expectedPreviousSubmissionId, selection } : null;
}
function reviewFields(row: Record<string, unknown>): boolean {
  return ["approved", "correction_required", "rejected"].includes(String(row.decision))
    && (row.decision === "approved" ? row.reason === null : scalarText(row.reason, 2000) && !/(?![\t\n\r])\p{Cc}/u.test(row.reason));
}
export function parseApplicationDocumentReviewIntent(value: unknown): ApplicationDocumentReviewIntent | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["submissionId", "expectedPreviousReviewId", "decision", "reason", "requestId"])
    || !uuid(row.submissionId) || !uuid(row.requestId) || !(row.expectedPreviousReviewId === null || uuid(row.expectedPreviousReviewId)) || !reviewFields(row)) return null;
  return { submissionId: row.submissionId, expectedPreviousReviewId: row.expectedPreviousReviewId, decision: row.decision as ApplicationDocumentReviewDecision, reason: row.reason as string | null, requestId: row.requestId };
}
export function parseApplicationDocumentSubmitReceipt(value: unknown, intent?: ApplicationDocumentSubmitIntent): ApplicationDocumentSubmitReceipt | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", ...ITEM_TARGET_KEYS, "requestId", "submissionId", "documentVersionId", "versionNo", "submittedAt", "reused"])
    || row.protocolVersion !== 1 || !uuid(row.requestId) || !uuid(row.submissionId) || !uuid(row.documentVersionId)
    || !decimalVersion(row.versionNo) || !timestamp(row.submittedAt) || typeof row.reused !== "boolean") return null;
  const target = itemTarget(row);
  if (!target || (intent && (intent.requestId !== row.requestId || intent.studentCaseId !== row.studentCaseId || intent.applicationId !== row.applicationId
    || intent.requirementsRevisionId !== row.requirementsRevisionId || intent.requirementItemId !== row.requirementItemId || intent.selection.documentVersionId !== row.documentVersionId))) return null;
  return { protocolVersion: 1, ...target, requestId: row.requestId, submissionId: row.submissionId, documentVersionId: row.documentVersionId,
    versionNo: row.versionNo, submittedAt: row.submittedAt, reused: row.reused };
}
export function parseApplicationDocumentReviewReceipt(value: unknown, intent?: ApplicationDocumentReviewIntent): ApplicationDocumentReviewReceipt | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", "requestId", "reviewId", "submissionId", "decision", "reason", "reviewedAt"])
    || row.protocolVersion !== 1 || !uuid(row.requestId) || !uuid(row.reviewId) || !uuid(row.submissionId) || !reviewFields(row) || !timestamp(row.reviewedAt)
    || (intent && (intent.requestId !== row.requestId || intent.submissionId !== row.submissionId || intent.decision !== row.decision || intent.reason !== row.reason))) return null;
  return { protocolVersion: 1, requestId: row.requestId, reviewId: row.reviewId, submissionId: row.submissionId,
    decision: row.decision as ApplicationDocumentReviewDecision, reason: row.reason as string | null, reviewedAt: row.reviewedAt };
}

export type ApplicationDocumentFile = ApplicationDocumentFileMetadata & Readonly<{
  documentVersionId: string; versionNo: string; finalizedAt: string;
  technicalAvailability: "available" | "unavailable"; unavailableReasons: readonly string[];
}>;
export type ApplicationDocumentUpload = Readonly<{
  uploadContextId: string; requirementsRevisionId: string; requirementItemId: string; documentSlotId: string;
  admittedAt: string; file: ApplicationDocumentFile;
}>;
export type ApplicationDocumentReview = Readonly<{ reviewId: string; decision: ApplicationDocumentReviewDecision; reason: string | null; reviewedAt: string }>;
export type ApplicationDocumentSubmission = Readonly<{
  submissionId: string; requirementsRevisionId: string; requirementItemId: string; documentSlotId: string;
  submittedAt: string; file: ApplicationDocumentFile; review: ApplicationDocumentReview | null;
}>;
export type ApplicationDocumentDefinition = Readonly<{
  requirementKey: string; required: boolean; label: string; groupLabel: string; instructions: string;
  deadline: ApplicationRequirementDeadline | null; documentSlotId: string;
}>;
export type ApplicationDocumentMaterialSnapshot = Readonly<{
  intentKind: "baseline" | "custom"; requirementId: string | null; rawLabel: string | null; rawGroupLabel: string | null;
  label: string; groupLabel: string; sourceRequirementKey: string | null; sourceChecklistVersion: string | null; sourceInstructions: string | null;
}>;
export type ApplicationDocumentHistoryEntry = Readonly<{
  id: string; kind: "upload" | "submission"; createdAt: string; requirementsRevisionId: string; requirementItemId: string;
  definition: ApplicationDocumentDefinition; materialSnapshot: ApplicationDocumentMaterialSnapshot | null;
  upload: ApplicationDocumentUpload | null; submission: ApplicationDocumentSubmission | null;
}>;
export type ApplicationDocumentCursor = Readonly<{ createdAt: string; id: string }>;
export type ApplicationDocumentVersionCursor = Readonly<{ versionNo: string; documentVersionId: string }>;
export type ApplicationDocumentReusableVersion = Readonly<{
  selection: Readonly<{ kind: "existing_version"; documentVersionId: string }>; file: ApplicationDocumentFile;
}>;
export type ApplicationDocumentItemState = Readonly<{
  requirementItemId: string; documentSlotId: string; savedDraft: ApplicationDocumentUpload | null;
  submission: ApplicationDocumentSubmission | null; previousEvidence: ApplicationDocumentHistoryEntry | null;
  reusableVersions: readonly ApplicationDocumentReusableVersion[]; reusableVersionsNextCursor: ApplicationDocumentVersionCursor | null;
  canUpload: boolean; canSubmit: boolean;
}>;
export type ApplicationDocuments = ApplicationDocumentTarget & Readonly<{
  protocolVersion: 1; requirements: ApplicationRequirementsV2; items: readonly ApplicationDocumentItemState[];
}>;
export type ApplicationDocumentHistoryPage = ApplicationDocumentTarget & Readonly<{
  protocolVersion: 1; requirementItemId: string | null; events: readonly ApplicationDocumentHistoryEntry[]; nextCursor: ApplicationDocumentCursor | null;
}>;
export type ApplicationDocumentReusableVersionsPage = ApplicationDocumentTarget & Readonly<{
  protocolVersion: 1; requirementItemId: string; versions: readonly ApplicationDocumentReusableVersion[]; nextCursor: ApplicationDocumentVersionCursor | null;
}>;
export type ApplicationDocumentQueueItem = ApplicationDocumentTarget & Readonly<{
  studentDisplayName: string; universityTitle: string; programTitle: string; requirementLabel: string;
  deadline: ApplicationRequirementDeadline | null; isCurrentRequirement: boolean; submission: ApplicationDocumentSubmission;
}>;
export type ApplicationDocumentQueuePage = Readonly<{ protocolVersion: 1; items: readonly ApplicationDocumentQueueItem[]; nextCursor: ApplicationDocumentCursor | null }>;
function nullableText(value: unknown): value is string | null { return value === null || (typeof value === "string" && (value === "" || scalarText(value)) && !value.includes("\u0000")); }
function list<T>(value: unknown, max: number, parse: (value: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const result: T[] = [];
  for (const entry of value) { const item = parse(entry); if (item === null) return null; result.push(item); }
  return result;
}
function unique<T>(values: readonly T[], key: (value: T) => string) { return new Set(values.map(key)).size === values.length; }
export function parseApplicationDocumentFile(value: unknown): ApplicationDocumentFile | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, [...FILE_KEYS, "documentVersionId", "versionNo", "finalizedAt", "technicalAvailability", "unavailableReasons"])
    || !uuid(row.documentVersionId) || !decimalVersion(row.versionNo) || !timestamp(row.finalizedAt)
    || !["available", "unavailable"].includes(String(row.technicalAvailability))) return null;
  // Legacy finalized versions predate the contextual upload filename contract.
  // Preserve their exact display metadata; never interpret it as a path.
  const filename = row.originalFilename;
  if (typeof filename !== "string" || filename.replace(/^ +| +$/gu, "").length === 0 || Array.from(filename).length > 255
    || /[\uD800-\uDFFF\p{Cc}]/u.test(filename) || new TextEncoder().encode(filename).byteLength > 1024) return null;
  const metadata = parseApplicationDocumentFileMetadata({ originalFilename: "metadata", declaredMimeType: row.declaredMimeType, byteSize: row.byteSize, sha256Hex: row.sha256Hex });
  const file = metadata ? { ...metadata, originalFilename: filename } : null;
  const reasons = list(row.unavailableReasons, 9, v => typeof v === "string" && ["file_missing", "upload_not_finalized", "integrity_pending", "integrity_failed", "malware_pending", "malware_infected", "malware_error", "storage_object_unavailable", "scan_proof_unavailable"].includes(v) ? v : null);
  if (!file || !reasons || !unique(reasons, x => x) || reasons.filter(r => r.startsWith("integrity_")).length > 1 || reasons.filter(r => r.startsWith("malware_")).length > 1 || ((row.technicalAvailability === "available") !== (reasons.length === 0))) return null;
  return { ...file, documentVersionId: row.documentVersionId, versionNo: row.versionNo, finalizedAt: row.finalizedAt,
    technicalAvailability: row.technicalAvailability as "available" | "unavailable", unavailableReasons: reasons };
}
function parseUpload(value: unknown): ApplicationDocumentUpload | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["uploadContextId", "requirementsRevisionId", "requirementItemId", "documentSlotId", "admittedAt", "file"])
    || ![row.uploadContextId, row.requirementsRevisionId, row.requirementItemId, row.documentSlotId].every(uuid) || !timestamp(row.admittedAt)) return null;
  const file = parseApplicationDocumentFile(row.file);
  return file ? { uploadContextId: row.uploadContextId as string, requirementsRevisionId: row.requirementsRevisionId as string, requirementItemId: row.requirementItemId as string,
    documentSlotId: row.documentSlotId as string, admittedAt: row.admittedAt, file } : null;
}
function parseReview(value: unknown): ApplicationDocumentReview | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["reviewId", "decision", "reason", "reviewedAt"]) || !uuid(row.reviewId) || !reviewFields(row) || !timestamp(row.reviewedAt)) return null;
  return { reviewId: row.reviewId, decision: row.decision as ApplicationDocumentReviewDecision, reason: row.reason as string | null, reviewedAt: row.reviewedAt };
}
export function parseApplicationDocumentSubmission(value: unknown): ApplicationDocumentSubmission | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["submissionId", "requirementsRevisionId", "requirementItemId", "documentSlotId", "submittedAt", "file", "review"])
    || ![row.submissionId, row.requirementsRevisionId, row.requirementItemId, row.documentSlotId].every(uuid) || !timestamp(row.submittedAt)) return null;
  const file = parseApplicationDocumentFile(row.file), review = row.review === null ? null : parseReview(row.review);
  return file && (row.review === null || review) ? { submissionId: row.submissionId as string, requirementsRevisionId: row.requirementsRevisionId as string,
    requirementItemId: row.requirementItemId as string, documentSlotId: row.documentSlotId as string, submittedAt: row.submittedAt, file, review } : null;
}
function parseDefinition(value: unknown): ApplicationDocumentDefinition | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["requirementKey", "required", "label", "groupLabel", "instructions", "deadline", "documentSlotId"])
    || !requirementKey(row.requirementKey) || typeof row.required !== "boolean" || !scalarText(row.label, 500) || !scalarText(row.groupLabel, 200)
    || typeof row.instructions !== "string" || !nullableText(row.instructions) || !uuid(row.documentSlotId)) return null;
  const due = row.deadline === null ? null : deadline(row.deadline);
  return row.deadline === null || due ? { requirementKey: row.requirementKey, required: row.required, label: row.label, groupLabel: row.groupLabel,
    instructions: row.instructions, deadline: due, documentSlotId: row.documentSlotId } : null;
}
function parseMaterial(value: unknown): ApplicationDocumentMaterialSnapshot | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["intentKind", "requirementId", "rawLabel", "rawGroupLabel", "label", "groupLabel", "sourceRequirementKey", "sourceChecklistVersion", "sourceInstructions"])
    || !["baseline", "custom"].includes(String(row.intentKind)) || !(row.requirementId === null || uuid(row.requirementId))
    || !scalarText(row.label) || !scalarText(row.groupLabel) || !nullableText(row.rawLabel) || !nullableText(row.rawGroupLabel)
    || !nullableText(row.sourceRequirementKey) || !(row.sourceChecklistVersion === null || decimalVersion(row.sourceChecklistVersion)) || !nullableText(row.sourceInstructions)) return null;
  if (row.intentKind === "custom" && [row.requirementId, row.sourceRequirementKey, row.sourceChecklistVersion, row.sourceInstructions].some(v => v !== null)) return null;
  if (row.intentKind === "baseline" && (!uuid(row.requirementId) || !scalarText(row.sourceRequirementKey) || !decimalVersion(row.sourceChecklistVersion))) return null;
  return { ...row } as ApplicationDocumentMaterialSnapshot;
}
export function parseApplicationDocumentHistoryEntry(value: unknown): ApplicationDocumentHistoryEntry | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["id", "kind", "createdAt", "requirementsRevisionId", "requirementItemId", "definition", "materialSnapshot", "upload", "submission"])
    || !uuid(row.id) || !uuid(row.requirementsRevisionId) || !uuid(row.requirementItemId) || !timestamp(row.createdAt)
    || !["upload", "submission"].includes(String(row.kind))) return null;
  const definition = parseDefinition(row.definition), materialSnapshot = row.materialSnapshot === null ? null : parseMaterial(row.materialSnapshot);
  const upload = row.upload === null ? null : parseUpload(row.upload), submission = row.submission === null ? null : parseApplicationDocumentSubmission(row.submission);
  if (!definition || (row.materialSnapshot !== null && !materialSnapshot) || (row.kind === "upload" ? !upload || row.submission !== null : !submission || row.upload !== null)) return null;
  const actual = row.kind === "upload" ? upload! : submission!;
  if (actual.requirementsRevisionId !== row.requirementsRevisionId || actual.requirementItemId !== row.requirementItemId || actual.documentSlotId !== definition.documentSlotId
    || row.id !== (row.kind === "upload" ? upload!.uploadContextId : submission!.submissionId)) return null;
  return { id: row.id, kind: row.kind as "upload" | "submission", createdAt: row.createdAt, requirementsRevisionId: row.requirementsRevisionId,
    requirementItemId: row.requirementItemId, definition, materialSnapshot, upload, submission };
}
export function parseApplicationDocumentCursor(value: unknown): ApplicationDocumentCursor | null {
  const row = applicationDocumentRecord(value);
  return row && applicationDocumentExact(row, ["createdAt", "id"]) && timestamp(row.createdAt) && uuid(row.id) ? { createdAt: row.createdAt, id: row.id } : null;
}
export function parseApplicationDocumentVersionCursor(value: unknown): ApplicationDocumentVersionCursor | null {
  const row = applicationDocumentRecord(value);
  return row && applicationDocumentExact(row, ["versionNo", "documentVersionId"]) && decimalVersion(row.versionNo) && uuid(row.documentVersionId) ? { versionNo: row.versionNo, documentVersionId: row.documentVersionId } : null;
}
function reusable(value: unknown): ApplicationDocumentReusableVersion | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["selection", "file"])) return null;
  const selection = parseApplicationDocumentSelection(row.selection), file = parseApplicationDocumentFile(row.file);
  return selection?.kind === "existing_version" && file && selection.documentVersionId === file.documentVersionId ? { selection, file } : null;
}
function validVersionPage(items: readonly ApplicationDocumentReusableVersion[], cursor: ApplicationDocumentVersionCursor | null): boolean {
  if (!unique(items, i => i.file.documentVersionId) || !items.every((item, i) => i === 0 || BigInt(items[i - 1].file.versionNo) > BigInt(item.file.versionNo)
    || (items[i - 1].file.versionNo === item.file.versionNo && items[i - 1].file.documentVersionId > item.file.documentVersionId))) return false;
  const last = items.at(-1)?.file;
  return cursor === null || (!!last && last.documentVersionId === cursor.documentVersionId && last.versionNo === cursor.versionNo);
}
function documentItem(value: unknown): ApplicationDocumentItemState | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["requirementItemId", "documentSlotId", "savedDraft", "submission", "previousEvidence", "reusableVersions", "reusableVersionsNextCursor", "canUpload", "canSubmit"])
    || !uuid(row.requirementItemId) || !uuid(row.documentSlotId) || typeof row.canUpload !== "boolean" || typeof row.canSubmit !== "boolean") return null;
  const savedDraft = row.savedDraft === null ? null : parseUpload(row.savedDraft), submission = row.submission === null ? null : parseApplicationDocumentSubmission(row.submission);
  const previousEvidence = row.previousEvidence === null ? null : parseApplicationDocumentHistoryEntry(row.previousEvidence);
  const versions = list(row.reusableVersions, 20, reusable), next = row.reusableVersionsNextCursor === null ? null : parseApplicationDocumentVersionCursor(row.reusableVersionsNextCursor);
  if ((row.savedDraft !== null && !savedDraft) || (row.submission !== null && !submission) || (row.previousEvidence !== null && !previousEvidence) || !versions
    || (row.reusableVersionsNextCursor !== null && !next) || !validVersionPage(versions, next)
    || [savedDraft, submission].some(v => v && (v.requirementItemId !== row.requirementItemId || v.documentSlotId !== row.documentSlotId))
    || previousEvidence?.requirementItemId === row.requirementItemId) return null;
  return { requirementItemId: row.requirementItemId, documentSlotId: row.documentSlotId, savedDraft, submission, previousEvidence,
    reusableVersions: versions, reusableVersionsNextCursor: next, canUpload: row.canUpload, canSubmit: row.canSubmit };
}
export function parseApplicationDocuments(value: unknown, target: ApplicationDocumentTarget): ApplicationDocuments | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", "studentCaseId", "applicationId", "requirements", "items"]) || row.protocolVersion !== 1
    || row.studentCaseId !== target.studentCaseId || row.applicationId !== target.applicationId) return null;
  const requirements = parseApplicationRequirementsV2(row.requirements, target.studentCaseId, target.applicationId), items = list(row.items, 50, documentItem);
  if (!requirements || !items || items.length !== requirements.items.length || !unique(items, i => i.requirementItemId)
    || items.some((item, index) => item.requirementItemId !== requirements.items[index].requirementItemId || item.documentSlotId !== requirements.items[index].documentSlotId
      || [item.savedDraft, item.submission].some(v => v && v.requirementsRevisionId !== requirements.revisionId))) return null;
  return { protocolVersion: 1, ...target, requirements, items };
}
function micros(value: string): bigint { return BigInt(Date.parse(value)) * BigInt(1000) + BigInt((value.match(/\.(\d+)/u)?.[1] ?? "").padEnd(6, "0").slice(3, 6)); }
function descending(items: readonly ApplicationDocumentCursor[]): boolean {
  return unique(items, v => v.id) && items.every((v, i) => i === 0 || micros(items[i - 1].createdAt) > micros(v.createdAt)
    || (micros(items[i - 1].createdAt) === micros(v.createdAt) && items[i - 1].id > v.id));
}
function cursorMatches(items: readonly ApplicationDocumentCursor[], cursor: ApplicationDocumentCursor | null): boolean {
  const last = items.at(-1);
  return descending(items) && (cursor === null || !!last && last.id === cursor.id && micros(last.createdAt) === micros(cursor.createdAt));
}
export function parseApplicationDocumentHistoryPage(value: unknown, target: ApplicationDocumentTarget, requirementItemId: string | null): ApplicationDocumentHistoryPage | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", "studentCaseId", "applicationId", "requirementItemId", "events", "nextCursor"])
    || row.protocolVersion !== 1 || row.studentCaseId !== target.studentCaseId || row.applicationId !== target.applicationId || row.requirementItemId !== requirementItemId) return null;
  const events = list(row.events, 50, parseApplicationDocumentHistoryEntry), nextCursor = row.nextCursor === null ? null : parseApplicationDocumentCursor(row.nextCursor);
  if (!events || (row.nextCursor !== null && !nextCursor) || !cursorMatches(events, nextCursor)) return null;
  return { protocolVersion: 1, ...target, requirementItemId, events, nextCursor };
}
export function parseApplicationDocumentReusableVersionsPage(value: unknown, target: ApplicationDocumentTarget, requirementItemId: string): ApplicationDocumentReusableVersionsPage | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", "studentCaseId", "applicationId", "requirementItemId", "versions", "nextCursor"])
    || row.protocolVersion !== 1 || row.studentCaseId !== target.studentCaseId || row.applicationId !== target.applicationId || row.requirementItemId !== requirementItemId) return null;
  const versions = list(row.versions, 50, reusable), nextCursor = row.nextCursor === null ? null : parseApplicationDocumentVersionCursor(row.nextCursor);
  return versions && (row.nextCursor === null || nextCursor) && validVersionPage(versions, nextCursor) ? { protocolVersion: 1, ...target, requirementItemId, versions, nextCursor } : null;
}
export function parseApplicationDocumentQueuePage(value: unknown): ApplicationDocumentQueuePage | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", "items", "nextCursor"]) || row.protocolVersion !== 1) return null;
  const items = list(row.items, 50, value => {
    const item = applicationDocumentRecord(value);
    if (!item || !applicationDocumentExact(item, ["studentCaseId", "applicationId", "studentDisplayName", "universityTitle", "programTitle", "requirementLabel", "deadline", "isCurrentRequirement", "submission"])
      || !uuid(item.studentCaseId) || !uuid(item.applicationId) || ![item.studentDisplayName, item.universityTitle, item.programTitle, item.requirementLabel].every(v => scalarText(v)) || typeof item.isCurrentRequirement !== "boolean") return null;
    const submission = parseApplicationDocumentSubmission(item.submission), due = item.deadline === null ? null : deadline(item.deadline);
    return submission && submission.review === null && (item.deadline === null || due) ? { studentCaseId: item.studentCaseId, applicationId: item.applicationId,
      studentDisplayName: item.studentDisplayName as string, universityTitle: item.universityTitle as string, programTitle: item.programTitle as string, requirementLabel: item.requirementLabel as string,
      deadline: due, isCurrentRequirement: item.isCurrentRequirement, submission } : null;
  });
  const nextCursor = row.nextCursor === null ? null : parseApplicationDocumentCursor(row.nextCursor);
  return items && (row.nextCursor === null || nextCursor) && cursorMatches(items.map(i => ({ createdAt: i.submission.submittedAt, id: i.submission.submissionId })), nextCursor)
    ? { protocolVersion: 1, items, nextCursor } : null;
}

export class ApplicationDocumentError extends Error {
  readonly reason: ApplicationDocumentFailure;
  constructor(reason: ApplicationDocumentFailure) { super("Application document unavailable"); this.reason = reason; }
}
export function applicationDocumentFailure(error: unknown, command: "submit" | "review" | null = null): ApplicationDocumentFailureResult {
  if (error instanceof ApplicationDocumentError) return { ok: false, reason: error.reason, resolution: "retain" };
  const row = applicationDocumentRecord(error);
  if (row?.code === "42501") return { ok: false, reason: "forbidden", resolution: "retain" };
  const definitive = ["application_document_stale_requirements", "application_document_mapping_changed", "application_document_previous_submission_changed", "application_document_previous_review_changed", "application_document_file_unavailable"];
  if (command && row?.code === "PT409" && definitive.includes(String(row.message))) return { ok: false,
    reason: row.message === "application_document_file_unavailable" ? "file_unavailable" : "stale_context", resolution: "not_written" };
  if (row?.message === "application_document_intent_conflict") return { ok: false, reason: "request_conflict", resolution: "retain" };
  const aliases: Readonly<Record<string, ApplicationDocumentFailure>> = {
    application_document_stale_requirements: "stale_context", application_document_mapping_changed: "stale_context",
    application_document_previous_submission_changed: "stale_context", application_document_previous_review_changed: "stale_context",
    application_document_upload_busy: "busy", application_document_upload_lease_unavailable: "lease_expired",
    application_document_upload_rate_limit: "rate_limited", application_document_invalid_intent: "invalid",
  };
  if (typeof row?.message === "string" && Object.hasOwn(aliases, row.message)) return { ok: false, reason: aliases[row.message], resolution: "retain" };
  const known: readonly ApplicationDocumentFailure[] = ["invalid", "request_conflict", "stale_context", "case_ineligible", "application_ineligible", "file_unavailable", "busy", "lease_expired", "file_too_large", "unsupported_type", "malware_detected", "rate_limited"];
  const candidate = typeof row?.message === "string" ? row.message.replace(/^application_document_/u, "") : "";
  return { ok: false, reason: known.includes(candidate as ApplicationDocumentFailure) ? candidate as ApplicationDocumentFailure : "unavailable", resolution: "retain" };
}


export type ApplicationDocumentNotification = ApplicationDocumentItemTarget & Readonly<{
  protocolVersion: 1; notificationId: string; reviewId: string; submission: ApplicationDocumentSubmission;
}>;
export function parseApplicationDocumentNotification(value: unknown, notificationId: string, studentCaseId: string): ApplicationDocumentNotification | null {
  const row = applicationDocumentRecord(value);
  if (!row || !applicationDocumentExact(row, ["protocolVersion", "notificationId", ...ITEM_TARGET_KEYS, "reviewId", "submission"])
    || row.protocolVersion !== 1 || !uuid(notificationId) || row.notificationId !== notificationId || row.studentCaseId !== studentCaseId || !uuid(row.reviewId)) return null;
  const target = itemTarget(row), submission = parseApplicationDocumentSubmission(row.submission);
  if (!target || !submission || submission.review?.reviewId !== row.reviewId || submission.requirementsRevisionId !== target.requirementsRevisionId
    || submission.requirementItemId !== target.requirementItemId || submission.documentSlotId !== target.documentSlotId) return null;
  return { protocolVersion: 1, ...target, notificationId, reviewId: row.reviewId, submission };
}
