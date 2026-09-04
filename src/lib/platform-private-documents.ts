import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform private-document data is unavailable.";

export const PLATFORM_DOCUMENT_SLOT_STATUSES = [
  "required",
  "submitted",
  "approved",
  "correction_required",
  "rejected",
] as const;
export const PLATFORM_DOCUMENT_REVIEW_DECISIONS = [
  "approved",
  "correction_required",
  "rejected",
] as const;
export const PLATFORM_DOCUMENT_SLOT_INTENTS = ["baseline", "custom"] as const;
export const PLATFORM_DOCUMENT_SLOT_CASE_LINK_TARGETS = [
  "university_application",
  "visa_case",
] as const;

export type PlatformDocumentSlotStatus =
  (typeof PLATFORM_DOCUMENT_SLOT_STATUSES)[number];
export type PlatformDocumentReviewDecision =
  (typeof PLATFORM_DOCUMENT_REVIEW_DECISIONS)[number];
export type PlatformDocumentSlotIntent =
  (typeof PLATFORM_DOCUMENT_SLOT_INTENTS)[number];
export type PlatformDocumentSlotCaseLinkTargetKind =
  (typeof PLATFORM_DOCUMENT_SLOT_CASE_LINK_TARGETS)[number];

export type PlatformDocumentReview = Readonly<{
  decision: PlatformDocumentReviewDecision;
  reason: string | null;
  reviewerMembershipId: string;
  reviewerDisplayName: string;
  reviewedAt: string;
}>;

export type PlatformDocumentVersion = Readonly<{
  documentVersionId: string;
  versionNumber: number;
  originalFilename: string;
  declaredMimeType: "application/pdf" | "image/jpeg" | "image/png";
  byteSize: number;
  sha256Hex: string;
  integrityStatus: "pending" | "verified" | "failed";
  malwareStatus: "pending" | "clean" | "infected" | "error";
  validationUpdatedAt: string | null;
  submittedByMembershipId: string;
  submittedByDisplayName: string;
  storageFinalized: boolean;
  finalizedAt: string | null;
  downloadReady: boolean;
  isCurrent: boolean;
  latestReview: PlatformDocumentReview | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformDocumentSlotCaseLink = Readonly<{
  documentSlotCaseLinkId: string;
  targetKind: PlatformDocumentSlotCaseLinkTargetKind;
  universityApplicationId: string | null;
  visaCaseId: string | null;
  createdByMembershipId: string;
  createdAt: string;
}>;

export type PlatformDocumentSlot = Readonly<{
  documentSlotId: string;
  documentRequirementId: string | null;
  requirementKey: string | null;
  requirementLabel: string;
  groupLabel: string;
  intentKind: PlatformDocumentSlotIntent;
  version: number;
  instructions: string | null;
  checklistVersion: number | null;
  status: PlatformDocumentSlotStatus;
  deadline: string | null;
  nextAction: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  createdAt: string;
  updatedAt: string;
  caseLinks: readonly PlatformDocumentSlotCaseLink[];
  versions: readonly PlatformDocumentVersion[];
}>;

/**
 * A removed checklist item is preserved as immutable case history. It is read
 * through the same canonical workspace RPC, but is deliberately a distinct
 * type so command-capable callers cannot mistake it for an active slot.
 */
export type PlatformRemovedDocumentSlot = PlatformDocumentSlot & Readonly<{
  removedAt: string;
  removedByMembershipId: string;
  removalReason: string;
}>;

export type PlatformCaseDocumentWorkspace = Readonly<{
  organizationId: string;
  studentCaseId: string;
  caseState: "active" | "closed";
  slots: readonly PlatformDocumentSlot[];
  removedSlots: readonly PlatformRemovedDocumentSlot[];
}>;

export type PlatformDocumentQueueRow = Readonly<{
  sortAt: string;
  organizationId: string;
  documentSlotId: string;
  studentCaseId: string;
  studentDisplayName: string;
  caseState: "active" | "closed";
  documentRequirementId: string | null;
  requirementKey: string | null;
  requirementLabel: string;
  status: PlatformDocumentSlotStatus;
  deadline: string | null;
  nextAction: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentOriginalFilename: string | null;
  currentDeclaredMimeType: "application/pdf" | "image/jpeg" | "image/png" | null;
  currentByteSize: number | null;
  currentSha256Hex: string | null;
  currentIntegrityStatus: "pending" | "verified" | "failed" | null;
  currentMalwareStatus: "pending" | "clean" | "infected" | "error" | null;
  currentReviewDecision: PlatformDocumentReviewDecision | null;
  currentReviewReason: string | null;
  currentVersionFinalizedAt: string | null;
  downloadReady: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformDocumentQueue = Readonly<{
  rows: readonly PlatformDocumentQueueRow[];
  hasMore: boolean;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformPrivateDocumentsRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ): PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformPrivateDocumentsDependencies = Readonly<{
  client?: PlatformPrivateDocumentsRpcClient;
}>;

export class PlatformPrivateDocumentsRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformPrivateDocumentsRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformPrivateDocumentsRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformPrivateDocumentsRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidShape();
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000"
    ? invalidShape()
    : normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredText(value: unknown, maximum = 2000): string {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > maximum
  ) {
    return invalidShape();
  }
  return value;
}

function optionalText(value: unknown, maximum = 2000): string | null {
  return value === null ? null : requiredText(value, maximum);
}

function requiredTimestamp(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : invalidShape();
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function integer(value: unknown, minimum: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum
    ? parsed
    : invalidShape();
}

function optionalInteger(value: unknown, minimum: number): number | null {
  return value === null ? null : integer(value, minimum);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? value as T[number]
    : invalidShape();
}

function normalizeReview(value: unknown): PlatformDocumentReview | null {
  if (value === null) return null;
  if (
    !isRecord(value)
    || !exact(value, [
      "decision",
      "reason",
      "reviewer_membership_id",
      "reviewer_display_name",
      "reviewed_at",
    ])
  ) {
    return invalidShape();
  }
  return Object.freeze({
    decision: oneOf(value.decision, PLATFORM_DOCUMENT_REVIEW_DECISIONS),
    reason: optionalText(value.reason),
    reviewerMembershipId: requiredUuid(value.reviewer_membership_id),
    reviewerDisplayName: requiredText(value.reviewer_display_name, 200),
    reviewedAt: requiredTimestamp(value.reviewed_at),
  });
}

function normalizePlatformDocumentSlotCaseLink(
  value: unknown,
): PlatformDocumentSlotCaseLink {
  if (
    !isRecord(value)
    || !exact(value, [
      "document_slot_case_link_id",
      "target_kind",
      "university_application_id",
      "visa_case_id",
      "created_by_membership_id",
      "created_at",
    ])
  ) {
    return invalidShape();
  }
  const targetKind = oneOf(value.target_kind, PLATFORM_DOCUMENT_SLOT_CASE_LINK_TARGETS);
  const universityApplicationId = optionalUuid(value.university_application_id);
  const visaCaseId = optionalUuid(value.visa_case_id);
  if (
    (targetKind === "university_application" &&
      (!universityApplicationId || visaCaseId !== null)) ||
    (targetKind === "visa_case" &&
      (universityApplicationId !== null || !visaCaseId))
  ) {
    return invalidShape();
  }
  return Object.freeze({
    documentSlotCaseLinkId: requiredUuid(value.document_slot_case_link_id),
    targetKind,
    universityApplicationId,
    visaCaseId,
    createdByMembershipId: requiredUuid(value.created_by_membership_id),
    createdAt: requiredTimestamp(value.created_at),
  });
}

export function normalizePlatformDocumentVersion(
  value: unknown,
): PlatformDocumentVersion {
  if (
    !isRecord(value)
    || !exact(value, [
      "document_version_id",
      "version_no",
      "original_filename",
      "declared_mime_type",
      "byte_size",
      "sha256_hex",
      "integrity_status",
      "malware_status",
      "validation_updated_at",
      "submitted_by_membership_id",
      "submitted_by_display_name",
      "storage_finalized",
      "finalized_at",
      "download_ready",
      "is_current",
      "latest_review",
      "created_at",
      "updated_at",
    ])
  ) {
    return invalidShape();
  }
  const sha256Hex = requiredText(value.sha256_hex, 64);
  if (!SHA256_PATTERN.test(sha256Hex)) return invalidShape();
  const integrityStatus = oneOf(
    value.integrity_status,
    ["pending", "verified", "failed"] as const,
  );
  const malwareStatus = oneOf(
    value.malware_status,
    ["pending", "clean", "infected", "error"] as const,
  );
  if (
    typeof value.storage_finalized !== "boolean"
    || typeof value.download_ready !== "boolean"
    || typeof value.is_current !== "boolean"
    || (value.download_ready
      && (!value.storage_finalized
        || integrityStatus !== "verified"
        || malwareStatus !== "clean"))
  ) {
    return invalidShape();
  }
  return Object.freeze({
    documentVersionId: requiredUuid(value.document_version_id),
    versionNumber: integer(value.version_no, 1),
    originalFilename: requiredText(value.original_filename, 512),
    declaredMimeType: oneOf(
      value.declared_mime_type,
      ["application/pdf", "image/jpeg", "image/png"] as const,
    ),
    byteSize: integer(value.byte_size, 1),
    sha256Hex,
    integrityStatus,
    malwareStatus,
    validationUpdatedAt: optionalTimestamp(value.validation_updated_at),
    submittedByMembershipId: requiredUuid(value.submitted_by_membership_id),
    submittedByDisplayName: requiredText(value.submitted_by_display_name, 200),
    storageFinalized: value.storage_finalized,
    finalizedAt: optionalTimestamp(value.finalized_at),
    downloadReady: value.download_ready,
    isCurrent: value.is_current,
    latestReview: normalizeReview(value.latest_review),
    createdAt: requiredTimestamp(value.created_at),
    updatedAt: requiredTimestamp(value.updated_at),
  });
}

export function normalizePlatformDocumentSlot(
  value: unknown,
): PlatformDocumentSlot {
  if (
    !isRecord(value)
    || !exact(value, [
      "document_slot_id",
      "document_requirement_id",
      "requirement_key",
      "requirement_label",
      "group_label",
      "intent_kind",
      "slot_version",
      "instructions",
      "checklist_version",
      "slot_status",
      "deadline",
      "next_action",
      "current_version_id",
      "current_version_no",
      "created_at",
      "updated_at",
      "case_links",
      "versions",
    ])
    || !Array.isArray(value.versions)
    || value.versions.length > 100
    || !Array.isArray(value.case_links)
    || value.case_links.length > 100
  ) {
    return invalidShape();
  }
  const caseLinks = Object.freeze(
    value.case_links.map(normalizePlatformDocumentSlotCaseLink),
  );
  const linkTargets = caseLinks.map((link) =>
    `${link.targetKind}:${
      link.targetKind === "university_application"
        ? link.universityApplicationId
        : link.visaCaseId
    }`
  );
  const versions = Object.freeze(value.versions.map(normalizePlatformDocumentVersion));
  const versionIds = versions.map((version) => version.documentVersionId);
  const versionNumbers = versions.map((version) => version.versionNumber);
  if (
    new Set(linkTargets).size !== linkTargets.length ||
    new Set(versionIds).size !== versionIds.length
    || new Set(versionNumbers).size !== versionNumbers.length
    || versions.some((version, index) =>
      index > 0 && version.versionNumber >= versions[index - 1].versionNumber)
  ) {
    return invalidShape();
  }
  const currentVersionId = optionalUuid(value.current_version_id);
  const currentVersionNumber = optionalInteger(value.current_version_no, 1);
  const markedCurrent = versions.filter((version) => version.isCurrent);
  if (
    (currentVersionId === null) !== (currentVersionNumber === null)
    || (currentVersionId === null && markedCurrent.length !== 0)
    || (currentVersionId !== null
      && (markedCurrent.length !== 1
        || markedCurrent[0].documentVersionId !== currentVersionId
        || markedCurrent[0].versionNumber !== currentVersionNumber))
  ) {
    return invalidShape();
  }
  const documentRequirementId = optionalUuid(value.document_requirement_id);
  const requirementKey = optionalText(value.requirement_key, 200);
  const checklistVersion = optionalInteger(value.checklist_version, 1);
  const intentKind = oneOf(value.intent_kind, PLATFORM_DOCUMENT_SLOT_INTENTS);
  if (
    (intentKind === "baseline"
      && (documentRequirementId === null || requirementKey === null || checklistVersion === null))
    || (intentKind === "custom"
      && (documentRequirementId !== null || requirementKey !== null || checklistVersion !== null))
  ) {
    return invalidShape();
  }
  return Object.freeze({
    documentSlotId: requiredUuid(value.document_slot_id),
    documentRequirementId,
    requirementKey,
    requirementLabel: requiredText(value.requirement_label, 500),
    groupLabel: requiredText(value.group_label, 200),
    intentKind,
    version: integer(value.slot_version, 1),
    instructions: optionalText(value.instructions, 4000),
    checklistVersion,
    status: oneOf(value.slot_status, PLATFORM_DOCUMENT_SLOT_STATUSES),
    deadline: optionalTimestamp(value.deadline),
    nextAction: optionalText(value.next_action, 2000),
    currentVersionId,
    currentVersionNumber,
    createdAt: requiredTimestamp(value.created_at),
    updatedAt: requiredTimestamp(value.updated_at),
    caseLinks,
    versions,
  });
}

export function normalizePlatformRemovedDocumentSlot(
  value: unknown,
): PlatformRemovedDocumentSlot {
  if (
    !isRecord(value)
    || !exact(value, [
      "document_slot_id",
      "document_requirement_id",
      "requirement_key",
      "requirement_label",
      "group_label",
      "intent_kind",
      "slot_version",
      "instructions",
      "checklist_version",
      "slot_status",
      "deadline",
      "next_action",
      "current_version_id",
      "current_version_no",
      "created_at",
      "updated_at",
      "case_links",
      "versions",
      "removed_at",
      "removed_by_membership_id",
      "removal_reason",
    ])
  ) {
    return invalidShape();
  }

  const {
    removed_at: removedAt,
    removed_by_membership_id: removedByMembershipId,
    removal_reason: removalReason,
    ...activeSlotPayload
  } = value;
  const slot = normalizePlatformDocumentSlot(activeSlotPayload);

  return Object.freeze({
    ...slot,
    removedAt: requiredTimestamp(removedAt),
    removedByMembershipId: requiredUuid(removedByMembershipId),
    removalReason: requiredText(removalReason, 2000),
  });
}

export function normalizePlatformCaseDocumentWorkspace(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
): PlatformCaseDocumentWorkspace {
  if (
    !isRecord(value)
    || !exact(value, [
      "organization_id",
      "student_case_id",
      "case_state",
      "slots",
      "removed_slots",
    ])
    || value.organization_id !== expectedOrganizationId
    || value.student_case_id !== expectedStudentCaseId
    || !Array.isArray(value.slots)
    || value.slots.length > 200
    || !Array.isArray(value.removed_slots)
    || value.removed_slots.length > 200
  ) {
    return invalidShape();
  }
  const slots = Object.freeze(value.slots.map(normalizePlatformDocumentSlot));
  const removedSlots = Object.freeze(
    value.removed_slots.map(normalizePlatformRemovedDocumentSlot),
  );
  const ids = [...slots, ...removedSlots].map((slot) => slot.documentSlotId);
  if (new Set(ids).size !== ids.length) return invalidShape();
  return Object.freeze({
    organizationId: requiredUuid(value.organization_id),
    studentCaseId: requiredUuid(value.student_case_id),
    caseState: oneOf(value.case_state, ["active", "closed"] as const),
    slots,
    removedSlots,
  });
}

export function normalizePlatformDocumentQueueRow(
  value: unknown,
  expectedOrganizationId: string,
): PlatformDocumentQueueRow {
  if (
    !isRecord(value)
    || !exact(value, [
      "sort_at",
      "organization_id",
      "document_slot_id",
      "student_case_id",
      "student_display_name",
      "case_state",
      "document_requirement_id",
      "requirement_key",
      "requirement_label",
      "slot_status",
      "deadline",
      "next_action",
      "current_version_id",
      "current_version_no",
      "current_original_filename",
      "current_declared_mime_type",
      "current_byte_size",
      "current_sha256_hex",
      "current_integrity_status",
      "current_malware_status",
      "current_review_decision",
      "current_review_reason",
      "current_version_finalized_at",
      "download_ready",
      "created_at",
      "updated_at",
    ])
    || value.organization_id !== expectedOrganizationId
    || typeof value.download_ready !== "boolean"
  ) {
    return invalidShape();
  }
  const documentRequirementId = optionalUuid(value.document_requirement_id);
  const requirementKey = optionalText(value.requirement_key, 200);
  if ((documentRequirementId === null) !== (requirementKey === null)) {
    return invalidShape();
  }
  const currentVersionId = optionalUuid(value.current_version_id);
  const currentVersionNumber = optionalInteger(value.current_version_no, 1);
  const currentSha = optionalText(value.current_sha256_hex, 64);
  const currentVersionFinalizedAt = optionalTimestamp(
    value.current_version_finalized_at,
  );
  const currentIntegrityStatus = value.current_integrity_status === null
    ? null
    : oneOf(value.current_integrity_status, ["pending", "verified", "failed"] as const);
  const currentMalwareStatus = value.current_malware_status === null
    ? null
    : oneOf(value.current_malware_status, ["pending", "clean", "infected", "error"] as const);
  if (
    (currentVersionId === null) !== (currentVersionNumber === null)
    || (currentSha !== null && !SHA256_PATTERN.test(currentSha))
    || (value.download_ready
      && (currentVersionFinalizedAt === null
        || currentIntegrityStatus !== "verified"
        || currentMalwareStatus !== "clean"))
  ) {
    return invalidShape();
  }
  return Object.freeze({
    sortAt: requiredTimestamp(value.sort_at),
    organizationId: requiredUuid(value.organization_id),
    documentSlotId: requiredUuid(value.document_slot_id),
    studentCaseId: requiredUuid(value.student_case_id),
    studentDisplayName: requiredText(value.student_display_name, 300),
    caseState: oneOf(value.case_state, ["active", "closed"] as const),
    documentRequirementId,
    requirementKey,
    requirementLabel: requiredText(value.requirement_label, 500),
    status: oneOf(value.slot_status, PLATFORM_DOCUMENT_SLOT_STATUSES),
    deadline: optionalTimestamp(value.deadline),
    nextAction: optionalText(value.next_action, 2000),
    currentVersionId,
    currentVersionNumber,
    currentOriginalFilename: optionalText(value.current_original_filename, 512),
    currentDeclaredMimeType: value.current_declared_mime_type === null
      ? null
      : oneOf(
          value.current_declared_mime_type,
          ["application/pdf", "image/jpeg", "image/png"] as const,
        ),
    currentByteSize: optionalInteger(value.current_byte_size, 1),
    currentSha256Hex: currentSha,
    currentIntegrityStatus,
    currentMalwareStatus,
    currentReviewDecision: value.current_review_decision === null
      ? null
      : oneOf(value.current_review_decision, PLATFORM_DOCUMENT_REVIEW_DECISIONS),
    currentReviewReason: optionalText(value.current_review_reason, 2000),
    currentVersionFinalizedAt,
    downloadReady: value.download_ready,
    createdAt: requiredTimestamp(value.created_at),
    updatedAt: requiredTimestamp(value.updated_at),
  });
}

function requireDocumentReader(actor: PlatformActor): string {
  if (actor.platformRole !== "admin" && actor.platformRole !== "admissions") {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient() {
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export async function getPlatformCaseDocumentWorkspace(
  actor: PlatformActor,
  studentCaseId: string,
  dependencies: PlatformPrivateDocumentsDependencies = {},
): Promise<PlatformCaseDocumentWorkspace> {
  try {
    const organizationId = requireDocumentReader(actor);
    const parsedStudentCaseId = requiredUuid(studentCaseId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_student_case_document_workspace",
      { p_student_case_id: parsedStudentCaseId },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizePlatformCaseDocumentWorkspace(
      response.data,
      organizationId,
      parsedStudentCaseId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformDocumentQueue(
  actor: PlatformActor,
  pageSize = 50,
  dependencies: PlatformPrivateDocumentsDependencies = {},
): Promise<PlatformDocumentQueue> {
  try {
    const organizationId = requireDocumentReader(actor);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return invalidShape();
    }
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_document_queue",
      { p_limit: pageSize + 1 },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    const rows = response.data.map((row) =>
      normalizePlatformDocumentQueueRow(row, organizationId));
    const ids = rows.map((row) => row.documentSlotId);
    if (new Set(ids).size !== ids.length) return invalidShape();
    return Object.freeze({
      rows: Object.freeze(rows.slice(0, pageSize)),
      hasMore: rows.length > pageSize,
    });
  } catch (error) {
    return failClosed(error);
  }
}
