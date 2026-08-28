import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_KEY_PATTERN = /^src_[a-f0-9]{32,64}$/;
const ARTIFACT_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
const REQUIREMENT_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const JSON_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE = "Platform BW4 workspace is unavailable.";
const MAX_WORKSPACE_BYTES = 2_000_000;
const MAX_DECISIONS = 100;
const MAX_DECISION_VERSIONS = 100;
const MAX_REVIEWED_SOURCES = 200;
const MAX_AVAILABLE_REQUIREMENTS = 200;

export const PLATFORM_DECISION_OWNER_ROLES = [
  "admin",
  "sales",
  "admissions",
] as const;
export const PLATFORM_DECISION_STATUSES = [
  "unresolved",
  "answered",
  "retired",
] as const;
export const PLATFORM_DECISION_REQUIREMENT_KINDS = [
  "general",
  "student_profile",
  "country_requirement",
  "document_requirement",
  "handoff",
] as const;
export const PLATFORM_WORKFLOW_SOURCE_KINDS = [
  "repository_contract",
  "google_document",
  "google_spreadsheet",
  "google_drive_file",
  "notion_database",
] as const;
export const PLATFORM_STUDENT_PROFILE_FIELDS = [
  "preferred_display_name",
  "legal_display_name",
  "communication_language",
  "date_of_birth",
  "citizenship_country",
  "residency_country",
  "current_education_summary",
  "academic_summary",
  "language_summary",
  "budget_band",
  "decision_participant_labels",
  "consent_status",
  "consent_evidence_ref",
  "next_step",
] as const;
export type PlatformDecisionOwnerRole =
  (typeof PLATFORM_DECISION_OWNER_ROLES)[number];
export type PlatformDecisionStatus =
  (typeof PLATFORM_DECISION_STATUSES)[number];
export type PlatformDecisionRequirementKind =
  (typeof PLATFORM_DECISION_REQUIREMENT_KINDS)[number];
export type PlatformWorkflowSourceKind =
  (typeof PLATFORM_WORKFLOW_SOURCE_KINDS)[number];
export type PlatformStudentProfileField =
  (typeof PLATFORM_STUDENT_PROFILE_FIELDS)[number];
export type PlatformPromptArtifactKind = "prompt_policy" | "business_context";
export type PlatformPromptArtifactStatus = "approved" | "retired";

export type PlatformBw4Scalar = string | number | boolean | null;

export type PlatformApprovedCommercialFieldEntry = Readonly<{
  key: string;
  value: PlatformBw4Scalar;
}>;

export type PlatformOpToOzoHandoffSummary = Readonly<{
  handoffId: string;
  studentCaseId: string;
  opWorkflowContractId: string;
  opWorkflowContractVersionId: string;
  ozoWorkflowContractId: string;
  ozoWorkflowContractVersionId: string;
  approvedCommercialFields: Readonly<Record<string, PlatformBw4Scalar>>;
  approvedCommercialFieldEntries: readonly PlatformApprovedCommercialFieldEntry[];
  unresolvedQuestions: readonly string[];
  promises: readonly string[];
  nextStep: string;
  dueAt: string;
  responsibleRole: PlatformDecisionOwnerRole;
  createdAt: string;
}>;

export type PlatformReviewedWorkflowSourceMetadata = Readonly<{
  sourceRegistryId: string;
  sourceKey: string;
  sourceKind: PlatformWorkflowSourceKind;
  sourceUrl: string;
  sourceRevision: string | null;
  reviewStatus: "reviewed" | "retired";
  canUseForDecisionEvidence: boolean;
  reviewedAt: string;
}>;

export type PlatformAvailableDecisionRequirement = Readonly<{
  requirementKind: "country_requirement" | "document_requirement";
  requirementId: string;
  label: string;
}>;

export type PlatformPromptArtifactMetadata = Readonly<{
  promptArtifactVersionId: string;
  artifactKind: PlatformPromptArtifactKind;
  artifactKey: string;
  title: string;
  version: string;
  status: PlatformPromptArtifactStatus;
  contentSha256: string;
  provenanceRef: string;
  approvedAt: string;
}>;

export type PlatformActivePromptArtifacts = Readonly<{
  promptPolicy: PlatformPromptArtifactMetadata | null;
  businessContext: PlatformPromptArtifactMetadata | null;
}>;

export type PlatformPinnedPromptArtifacts = Readonly<{
  aiDraftRequestId: string;
  selectedAt: string;
  promptPolicy: PlatformPromptArtifactMetadata;
  businessContext: PlatformPromptArtifactMetadata;
}>;

export type PlatformDecisionBacklogVersion = Readonly<{
  decisionBacklogVersionId: string;
  effectiveVersion: string;
  question: string;
  answer: string | null;
  ownerRole: PlatformDecisionOwnerRole;
  status: PlatformDecisionStatus;
  affectedRequirementKind: PlatformDecisionRequirementKind;
  affectedRequirementId: string | null;
  affectedRequirementField: PlatformStudentProfileField | null;
  sourceRegistryId: string | null;
  evidenceRef: string | null;
  createdAt: string;
}>;

export type PlatformDecisionBacklogEntry = Readonly<{
  decisionBacklogId: string;
  currentEffectiveVersion: string;
  currentVersion: PlatformDecisionBacklogVersion;
  versions: readonly PlatformDecisionBacklogVersion[];
  canAnswer: boolean;
  canReopen: boolean;
  canRetire: boolean;
}>;

export type PlatformConversationBw4Workspace = Readonly<{
  organizationId: string;
  conversationId: string;
  studentCaseId: string | null;
  actorRole: PlatformDecisionOwnerRole;
  canManageDecisions: boolean;
  canCreateDecision: boolean;
  allowedOwnerRoles: readonly PlatformDecisionOwnerRole[];
  handoff: PlatformOpToOzoHandoffSummary | null;
  availableRequirements: readonly PlatformAvailableDecisionRequirement[];
  reviewedSources: readonly PlatformReviewedWorkflowSourceMetadata[];
  activePromptArtifacts: PlatformActivePromptArtifacts;
  pinnedPromptArtifacts: PlatformPinnedPromptArtifacts | null;
  decisions: readonly PlatformDecisionBacklogEntry[];
}>;

export type PlatformCreateDecisionBacklogMutation = Readonly<{
  conversationId: string;
  studentCaseId: string | null;
  question: string;
  ownerRole: PlatformDecisionOwnerRole;
  affectedRequirementKind: PlatformDecisionRequirementKind;
  affectedRequirementId: string | null;
  affectedRequirementField: PlatformStudentProfileField | null;
  sourceRegistryId: string | null;
  evidenceRef: string | null;
  reason: string;
  requestId: string;
}>;

export type PlatformTransitionDecisionBacklogMutation =
  PlatformCreateDecisionBacklogMutation &
    Readonly<{
      decisionBacklogId: string;
      expectedEffectiveVersion: string;
      newStatus: PlatformDecisionStatus;
      answer: string | null;
  }>;

export function doesPlatformDecisionCreateTargetMatchWorkspace(
  workspace: PlatformConversationBw4Workspace,
  input: PlatformCreateDecisionBacklogMutation,
): boolean {
  if (workspace.studentCaseId !== input.studentCaseId) return false;
  if (input.affectedRequirementKind === "general") {
    return (
      input.affectedRequirementId === null &&
      input.affectedRequirementField === null
    );
  }
  if (input.affectedRequirementKind === "student_profile") {
    return (
      workspace.studentCaseId !== null &&
      input.affectedRequirementId === workspace.studentCaseId &&
      input.affectedRequirementField !== null
    );
  }
  if (input.affectedRequirementKind === "handoff") {
    return (
      workspace.handoff !== null &&
      input.affectedRequirementId === workspace.handoff.handoffId &&
      input.affectedRequirementField === null
    );
  }
  return (
    input.affectedRequirementField === null &&
    input.affectedRequirementId !== null &&
    workspace.availableRequirements.some(
      (requirement) =>
        requirement.requirementKind === input.affectedRequirementKind &&
        requirement.requirementId === input.affectedRequirementId,
    )
  );
}

export type PlatformDecisionMutationResponse = Readonly<{
  organizationId: string;
  conversationId: string;
  studentCaseId: string | null;
  decisionBacklogId: string;
  decisionBacklogVersionId: string;
  effectiveVersion: string;
  status: PlatformDecisionStatus;
  previousEffectiveVersion: string | null;
  previousStatus: PlatformDecisionStatus | null;
}>;

export class PlatformBw4RepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformBw4RepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformBw4RepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformBw4RepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  const expectedKeys = new Set(expected);
  return keys.every((key) => expectedKeys.has(key));
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (!hasExactKeys(value, expected)) invalidShape();
}

export function parsePlatformBw4Uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformBw4Uuid(value) ?? invalidShape();
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalBoundedText(
  value: unknown,
  maximum: number,
): string | null {
  return value === null ? null : boundedText(value, 1, maximum);
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

export function parsePlatformBw4PositiveBigint(value: unknown): string | null {
  const candidate =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string"
        ? value
        : null;
  if (candidate === null || !POSITIVE_BIGINT_PATTERN.test(candidate)) return null;
  if (
    candidate.length > MAX_POSTGRES_BIGINT.length ||
    (candidate.length === MAX_POSTGRES_BIGINT.length &&
      candidate > MAX_POSTGRES_BIGINT)
  ) {
    return null;
  }
  return candidate;
}

function positiveBigint(value: unknown): string {
  return parsePlatformBw4PositiveBigint(value) ?? invalidShape();
}

function nextPositiveBigint(value: string): string {
  const next = BigInt(value) + BigInt(1);
  const normalized = String(next);
  return parsePlatformBw4PositiveBigint(normalized) ?? invalidShape();
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidShape();
  }
  return value as T[number];
}

function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedScalarObject(
  value: unknown,
): Readonly<Record<string, PlatformBw4Scalar>> {
  if (
    !isRecord(value) ||
    Object.keys(value).length > 32 ||
    jsonByteSize(value) > 8192
  ) {
    return invalidShape();
  }
  const normalized: Record<string, PlatformBw4Scalar> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!JSON_KEY_PATTERN.test(key)) return invalidShape();
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      return invalidShape();
    }
    if (
      jsonByteSize(item) > 1024 ||
      (typeof item === "number" && !Number.isFinite(item)) ||
      (typeof item === "string" && CONTROL_CHARACTER_PATTERN.test(item))
    ) {
      return invalidShape();
    }
    normalized[key] = item;
  }
  return normalized;
}

function boundedTextArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 20 || jsonByteSize(value) > 8192) {
    return invalidShape();
  }
  return value.map((item) => boundedText(item, 1, 1000));
}

function safeSourceUrl(kind: PlatformWorkflowSourceKind, value: unknown): string {
  const sourceUrl = boundedText(value, 1, 512);
  const patterns: Record<PlatformWorkflowSourceKind, RegExp> = {
    repository_contract:
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/commit\/[A-Fa-f0-9]{40}$/,
    google_document:
      /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,200}(?:\/(?:edit|view))?$/,
    google_spreadsheet:
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,200}(?:\/(?:edit|view))?$/,
    google_drive_file:
      /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}(?:\/(?:view|edit))?$/,
    notion_database: /^https:\/\/(?:www\.)?notion\.so\/[A-Fa-f0-9]{32}$/,
  };
  return patterns[kind].test(sourceUrl) ? sourceUrl : invalidShape();
}

function normalizeHandoff(
  value: unknown,
  studentCaseId: string | null,
): PlatformOpToOzoHandoffSummary | null {
  if (value === null) return null;
  if (studentCaseId === null || !isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "handoff_id",
    "student_case_id",
    "op_workflow_contract_id",
    "op_workflow_contract_version_id",
    "ozo_workflow_contract_id",
    "ozo_workflow_contract_version_id",
    "approved_commercial_fields",
    "unresolved_questions",
    "promises",
    "next_step",
    "due_at",
    "responsible_role",
    "created_at",
  ]);
  const parsedStudentCaseId = requiredUuid(value.student_case_id);
  if (parsedStudentCaseId !== studentCaseId) return invalidShape();
  const approvedCommercialFields = boundedScalarObject(
    value.approved_commercial_fields,
  );
  return {
    handoffId: requiredUuid(value.handoff_id),
    studentCaseId: parsedStudentCaseId,
    opWorkflowContractId: requiredUuid(value.op_workflow_contract_id),
    opWorkflowContractVersionId: requiredUuid(
      value.op_workflow_contract_version_id,
    ),
    ozoWorkflowContractId: requiredUuid(value.ozo_workflow_contract_id),
    ozoWorkflowContractVersionId: requiredUuid(
      value.ozo_workflow_contract_version_id,
    ),
    approvedCommercialFields,
    approvedCommercialFieldEntries: Object.entries(
      approvedCommercialFields,
    ).map(([key, item]) => ({ key, value: item })),
    unresolvedQuestions: boundedTextArray(value.unresolved_questions),
    promises: boundedTextArray(value.promises),
    nextStep: boundedText(value.next_step, 1, 1000),
    dueAt: timestamp(value.due_at),
    responsibleRole: oneOf(
      value.responsible_role,
      PLATFORM_DECISION_OWNER_ROLES,
    ),
    createdAt: timestamp(value.created_at),
  };
}

export function normalizePlatformReviewedWorkflowSourceMetadata(
  value: unknown,
): PlatformReviewedWorkflowSourceMetadata {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "source_registry_id",
    "source_key",
    "source_kind",
    "source_url",
    "source_revision",
    "review_status",
    "reviewed_at",
  ]);
  const sourceKind = oneOf(value.source_kind, PLATFORM_WORKFLOW_SOURCE_KINDS);
  const sourceKey = boundedText(value.source_key, 1, 68);
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) return invalidShape();
  const sourceRevision = optionalBoundedText(value.source_revision, 128);
  if (sourceRevision !== null && !SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    return invalidShape();
  }
  return {
    sourceRegistryId: requiredUuid(value.source_registry_id),
    sourceKey,
    sourceKind,
    sourceUrl: safeSourceUrl(sourceKind, value.source_url),
    sourceRevision,
    reviewStatus: oneOf(value.review_status, ["reviewed", "retired"] as const),
    canUseForDecisionEvidence: value.review_status === "reviewed",
    reviewedAt: timestamp(value.reviewed_at),
  };
}

export function normalizePlatformPromptArtifactMetadata(
  value: unknown,
  expectedKind: PlatformPromptArtifactKind,
  allowedStatuses: readonly PlatformPromptArtifactStatus[],
): PlatformPromptArtifactMetadata {
  if (!isRecord(value)) return invalidShape();
  // Exact keys are intentional: raw prompt/business-context content must never
  // cross this server repository boundary, even if an RPC is changed later.
  requireExactKeys(value, [
    "prompt_artifact_version_id",
    "artifact_kind",
    "artifact_key",
    "title",
    "version",
    "status",
    "content_sha256",
    "provenance_ref",
    "approved_at",
  ]);
  const artifactKind = oneOf(value.artifact_kind, [
    "prompt_policy",
    "business_context",
  ] as const);
  if (artifactKind !== expectedKind) return invalidShape();
  const artifactKey = boundedText(value.artifact_key, 1, 128);
  if (!ARTIFACT_KEY_PATTERN.test(artifactKey)) return invalidShape();
  const contentSha256 = boundedText(value.content_sha256, 64, 64);
  if (!SHA256_PATTERN.test(contentSha256)) return invalidShape();
  return {
    promptArtifactVersionId: requiredUuid(value.prompt_artifact_version_id),
    artifactKind,
    artifactKey,
    title: boundedText(value.title, 1, 200),
    version: positiveBigint(value.version),
    status: oneOf(value.status, allowedStatuses),
    contentSha256,
    provenanceRef: boundedText(value.provenance_ref, 1, 1000),
    approvedAt: timestamp(value.approved_at),
  };
}

function normalizeActivePromptArtifacts(
  value: unknown,
): PlatformActivePromptArtifacts {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, ["prompt_policy", "business_context"]);
  const promptPolicy =
    value.prompt_policy === null
      ? null
      : normalizePlatformPromptArtifactMetadata(
          value.prompt_policy,
          "prompt_policy",
          ["approved"],
        );
  const businessContext =
    value.business_context === null
      ? null
      : normalizePlatformPromptArtifactMetadata(
          value.business_context,
          "business_context",
          ["approved"],
        );
  if (
    promptPolicy !== null &&
    businessContext !== null &&
    (promptPolicy.promptArtifactVersionId ===
      businessContext.promptArtifactVersionId ||
      promptPolicy.artifactKey !== businessContext.artifactKey)
  ) {
    return invalidShape();
  }
  return { promptPolicy, businessContext };
}

function normalizePinnedPromptArtifacts(
  value: unknown,
): PlatformPinnedPromptArtifacts | null {
  if (value === null) return null;
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "ai_draft_request_id",
    "selected_at",
    "prompt_policy",
    "business_context",
  ]);
  const promptPolicy = normalizePlatformPromptArtifactMetadata(
    value.prompt_policy,
    "prompt_policy",
    ["approved", "retired"],
  );
  const businessContext = normalizePlatformPromptArtifactMetadata(
    value.business_context,
    "business_context",
    ["approved", "retired"],
  );
  const selectedAt = timestamp(value.selected_at);
  if (
    promptPolicy.promptArtifactVersionId ===
      businessContext.promptArtifactVersionId ||
    promptPolicy.artifactKey !== businessContext.artifactKey ||
    Date.parse(promptPolicy.approvedAt) > Date.parse(selectedAt) ||
    Date.parse(businessContext.approvedAt) > Date.parse(selectedAt)
  ) {
    return invalidShape();
  }
  return {
    aiDraftRequestId: requiredUuid(value.ai_draft_request_id),
    selectedAt,
    promptPolicy,
    businessContext,
  };
}

function validateRequirementReference(
  kind: PlatformDecisionRequirementKind,
  requirementId: string | null,
  requirementField: PlatformStudentProfileField | null,
  studentCaseId: string | null,
  expectedHandoffId?: string | null,
): void {
  if (
    kind === "general" &&
    (requirementId !== null || requirementField !== null)
  ) {
    invalidShape();
  }
  if (
    kind === "student_profile" &&
    (studentCaseId === null ||
      requirementId !== studentCaseId ||
      requirementField === null)
  ) {
    invalidShape();
  }
  if (
    kind !== "general" &&
    kind !== "student_profile" &&
    (studentCaseId === null || requirementId === null || requirementField !== null)
  ) {
    invalidShape();
  }
  if (requirementField !== null && !REQUIREMENT_FIELD_PATTERN.test(requirementField)) {
    invalidShape();
  }
  if (
    kind === "handoff" &&
    expectedHandoffId !== undefined &&
    requirementId !== expectedHandoffId
  ) {
    invalidShape();
  }
}

function normalizeDecisionVersion(
  value: unknown,
  studentCaseId: string | null,
  reviewedSourceIds: ReadonlySet<string>,
  expectedHandoffId: string | null,
): PlatformDecisionBacklogVersion {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "decision_backlog_version_id",
    "effective_version",
    "question",
    "answer",
    "owner_role",
    "status",
    "affected_requirement_kind",
    "affected_requirement_id",
    "affected_requirement_field",
    "source_registry_id",
    "evidence_ref",
    "created_at",
  ]);
  const status = oneOf(value.status, PLATFORM_DECISION_STATUSES);
  const answer = optionalBoundedText(value.answer, 8000);
  const affectedRequirementKind = oneOf(
    value.affected_requirement_kind,
    PLATFORM_DECISION_REQUIREMENT_KINDS,
  );
  const affectedRequirementId = optionalUuid(value.affected_requirement_id);
  const rawAffectedRequirementField = optionalBoundedText(
    value.affected_requirement_field,
    128,
  );
  const affectedRequirementField =
    rawAffectedRequirementField === null
      ? null
      : oneOf(rawAffectedRequirementField, PLATFORM_STUDENT_PROFILE_FIELDS);
  validateRequirementReference(
    affectedRequirementKind,
    affectedRequirementId,
    affectedRequirementField,
    studentCaseId,
    expectedHandoffId,
  );
  const sourceRegistryId = optionalUuid(value.source_registry_id);
  const evidenceRef = optionalBoundedText(value.evidence_ref, 1000);
  if (
    (sourceRegistryId === null) !== (evidenceRef === null) ||
    (sourceRegistryId !== null && !reviewedSourceIds.has(sourceRegistryId)) ||
    (status === "answered" &&
      (answer === null || sourceRegistryId === null || evidenceRef === null)) ||
    (status === "unresolved" && answer !== null) ||
    (answer !== null && (sourceRegistryId === null || evidenceRef === null))
  ) {
    return invalidShape();
  }
  return {
    decisionBacklogVersionId: requiredUuid(
      value.decision_backlog_version_id,
    ),
    effectiveVersion: positiveBigint(value.effective_version),
    question: boundedText(value.question, 1, 2000),
    answer,
    ownerRole: oneOf(value.owner_role, PLATFORM_DECISION_OWNER_ROLES),
    status,
    affectedRequirementKind,
    affectedRequirementId,
    affectedRequirementField,
    sourceRegistryId,
    evidenceRef,
    createdAt: timestamp(value.created_at),
  };
}

function normalizeDecision(
  value: unknown,
  studentCaseId: string | null,
  reviewedSourceIds: ReadonlySet<string>,
  canManageDecisions: boolean,
  expectedHandoffId: string | null,
): PlatformDecisionBacklogEntry {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "decision_backlog_id",
    "current_effective_version",
    "versions",
  ]);
  const decisionBacklogId = requiredUuid(value.decision_backlog_id);
  const currentEffectiveVersion = positiveBigint(
    value.current_effective_version,
  );
  if (
    !Array.isArray(value.versions) ||
    value.versions.length === 0 ||
    value.versions.length > MAX_DECISION_VERSIONS
  ) {
    return invalidShape();
  }
  const seenVersionIds = new Set<string>();
  let expectedEffectiveVersion = "1";
  const versions = value.versions.map((item) => {
    const version = normalizeDecisionVersion(
      item,
      studentCaseId,
      reviewedSourceIds,
      expectedHandoffId,
    );
    if (
      seenVersionIds.has(version.decisionBacklogVersionId) ||
      version.effectiveVersion !== expectedEffectiveVersion
    ) {
      return invalidShape();
    }
    seenVersionIds.add(version.decisionBacklogVersionId);
    expectedEffectiveVersion = nextPositiveBigint(version.effectiveVersion);
    return version;
  });
  const currentVersion = versions[versions.length - 1];
  if (currentVersion.effectiveVersion !== currentEffectiveVersion) {
    return invalidShape();
  }
  return {
    decisionBacklogId,
    currentEffectiveVersion,
    currentVersion,
    versions,
    canAnswer:
      canManageDecisions && currentVersion.status === "unresolved",
    canReopen: canManageDecisions && currentVersion.status === "answered",
    canRetire:
      canManageDecisions && currentVersion.status !== "retired",
  };
}

function sameRoleSet(
  actual: readonly PlatformDecisionOwnerRole[],
  expected: readonly PlatformDecisionOwnerRole[],
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((role) => actual.includes(role))
  );
}

function normalizeAllowedOwnerRoles(
  value: unknown,
  actorRole: PlatformDecisionOwnerRole,
): readonly PlatformDecisionOwnerRole[] {
  if (!Array.isArray(value) || value.length > PLATFORM_DECISION_OWNER_ROLES.length) {
    return invalidShape();
  }
  const roles = value.map((role) =>
    oneOf(role, PLATFORM_DECISION_OWNER_ROLES),
  );
  if (new Set(roles).size !== roles.length) return invalidShape();
  const expected =
    actorRole === "admin"
      ? PLATFORM_DECISION_OWNER_ROLES
      : ([actorRole] as const);
  return sameRoleSet(roles, expected) ? roles : invalidShape();
}

function normalizeAvailableRequirements(
  value: unknown,
  studentCaseId: string | null,
): readonly PlatformAvailableDecisionRequirement[] {
  if (!Array.isArray(value) || value.length > MAX_AVAILABLE_REQUIREMENTS) {
    return invalidShape();
  }
  if (studentCaseId === null && value.length > 0) return invalidShape();

  const seen = new Set<string>();
  let countryRequirementCount = 0;
  return value.map((item) => {
    if (!isRecord(item)) return invalidShape();
    requireExactKeys(item, ["requirement_kind", "requirement_id", "label"]);
    const requirementKind = oneOf(item.requirement_kind, [
      "country_requirement",
      "document_requirement",
    ] as const);
    const requirementId = requiredUuid(item.requirement_id);
    const key = `${requirementKind}:${requirementId}`;
    if (seen.has(key)) return invalidShape();
    seen.add(key);
    if (requirementKind === "country_requirement") {
      countryRequirementCount += 1;
      if (countryRequirementCount > 1) return invalidShape();
    }
    return {
      requirementKind,
      requirementId,
      label: boundedText(item.label, 1, 240),
    };
  });
}

export function normalizePlatformConversationBw4Workspace(
  value: unknown,
  expected?: Readonly<{
    organizationId?: string;
    conversationId?: string;
    actorRole?: PlatformDecisionOwnerRole;
  }>,
): PlatformConversationBw4Workspace {
  if (!isRecord(value) || jsonByteSize(value) > MAX_WORKSPACE_BYTES) {
    return invalidShape();
  }
  requireExactKeys(value, [
    "organization_id",
    "conversation_id",
    "student_case_id",
    "actor_role",
    "can_manage_decisions",
    "allowed_owner_roles",
    "handoff",
    "available_requirements",
    "reviewed_sources",
    "active_prompt_artifacts",
    "pinned_prompt_artifacts",
    "decisions",
  ]);
  const organizationId = requiredUuid(value.organization_id);
  const conversationId = requiredUuid(value.conversation_id);
  const studentCaseId = optionalUuid(value.student_case_id);
  const actorRole = oneOf(value.actor_role, PLATFORM_DECISION_OWNER_ROLES);
  if (
    (expected?.organizationId &&
      organizationId !== expected.organizationId) ||
    (expected?.conversationId &&
      conversationId !== expected.conversationId) ||
    (expected?.actorRole && actorRole !== expected.actorRole) ||
    typeof value.can_manage_decisions !== "boolean"
  ) {
    return invalidShape();
  }
  const canManageDecisions = value.can_manage_decisions;
  const allowedOwnerRoles = normalizeAllowedOwnerRoles(
    value.allowed_owner_roles,
    actorRole,
  );
  if (
    !Array.isArray(value.reviewed_sources) ||
    value.reviewed_sources.length > MAX_REVIEWED_SOURCES
  ) {
    return invalidShape();
  }
  const reviewedSourceIds = new Set<string>();
  const reviewedSourceKeys = new Set<string>();
  const reviewedSources = value.reviewed_sources.map((item) => {
    const source = normalizePlatformReviewedWorkflowSourceMetadata(item);
    if (
      reviewedSourceIds.has(source.sourceRegistryId) ||
      reviewedSourceKeys.has(source.sourceKey)
    ) {
      return invalidShape();
    }
    reviewedSourceIds.add(source.sourceRegistryId);
    reviewedSourceKeys.add(source.sourceKey);
    return source;
  });
  const handoff = normalizeHandoff(value.handoff, studentCaseId);
  const availableRequirements = normalizeAvailableRequirements(
    value.available_requirements,
    studentCaseId,
  );
  if (!Array.isArray(value.decisions) || value.decisions.length > MAX_DECISIONS) {
    return invalidShape();
  }
  const seenDecisionIds = new Set<string>();
  const seenDecisionVersionIds = new Set<string>();
  const decisions = value.decisions.map((item) => {
    const decision = normalizeDecision(
      item,
      studentCaseId,
      reviewedSourceIds,
      canManageDecisions,
      handoff?.handoffId ?? null,
    );
    if (seenDecisionIds.has(decision.decisionBacklogId)) return invalidShape();
    seenDecisionIds.add(decision.decisionBacklogId);
    for (const version of decision.versions) {
      if (seenDecisionVersionIds.has(version.decisionBacklogVersionId)) {
        return invalidShape();
      }
      seenDecisionVersionIds.add(version.decisionBacklogVersionId);
    }
    return decision;
  });
  return {
    organizationId,
    conversationId,
    studentCaseId,
    actorRole,
    canManageDecisions,
    canCreateDecision: canManageDecisions,
    allowedOwnerRoles,
    handoff,
    availableRequirements,
    reviewedSources,
    activePromptArtifacts: normalizeActivePromptArtifacts(
      value.active_prompt_artifacts,
    ),
    pinnedPromptArtifacts: normalizePinnedPromptArtifacts(
      value.pinned_prompt_artifacts,
    ),
    decisions,
  };
}

function requireWorkspaceActor(actor: PlatformActor): Readonly<{
  organizationId: string;
  actorRole: PlatformDecisionOwnerRole;
}> {
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !== "sales" &&
    actor.platformRole !== "admissions"
  ) {
    return invalidShape();
  }
  return {
    organizationId: requiredUuid(actor.organizationId),
    actorRole: actor.platformRole,
  };
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export async function getPlatformConversationBw4Workspace(
  actor: PlatformActor,
  conversationId: string,
): Promise<PlatformConversationBw4Workspace | null> {
  try {
    const authority = requireWorkspaceActor(actor);
    const parsedConversationId = parsePlatformBw4Uuid(conversationId);
    if (parsedConversationId === null) return null;
    const client = await getPlatformClient();
    // Keep the default POST transport. The live authority helper deliberately
    // takes row locks; PostgREST GET RPCs run in a read-only transaction.
    const response = await client
      .schema("platform")
      .rpc(
        "staff_conversation_bw4_workspace",
        {
          p_organization_id: authority.organizationId,
          p_conversation_id: parsedConversationId,
        },
      );
    if (response.error || response.data === null) return invalidShape();
    return normalizePlatformConversationBw4Workspace(response.data, {
      organizationId: authority.organizationId,
      conversationId: parsedConversationId,
      actorRole: authority.actorRole,
    });
  } catch (error) {
    return failClosed(error);
  }
}

function scalarFormValue(form: FormData, key: string): string | undefined {
  const values = form.getAll(key);
  if (values.length > 1) return undefined;
  if (values.length === 0) return "";
  return typeof values[0] === "string" ? values[0].trim() : undefined;
}

function formText(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const candidate = scalarFormValue(form, key);
  if (
    candidate === undefined ||
    candidate.length < minimum ||
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function optionalFormText(
  form: FormData,
  key: string,
  maximum: number,
): string | null | undefined {
  const candidate = scalarFormValue(form, key);
  if (candidate === undefined) return undefined;
  if (!candidate) return null;
  if (candidate.length > maximum || CONTROL_CHARACTER_PATTERN.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function formUuid(form: FormData, key: string): string | null {
  return parsePlatformBw4Uuid(scalarFormValue(form, key));
}

function optionalFormUuid(
  form: FormData,
  key: string,
): string | null | undefined {
  const candidate = scalarFormValue(form, key);
  if (candidate === undefined) return undefined;
  return candidate === "" ? null : parsePlatformBw4Uuid(candidate) ?? undefined;
}

function parseOwnerRole(form: FormData): PlatformDecisionOwnerRole | null {
  const candidate = scalarFormValue(form, "owner_role");
  return candidate !== undefined &&
    (PLATFORM_DECISION_OWNER_ROLES as readonly string[]).includes(candidate)
    ? (candidate as PlatformDecisionOwnerRole)
    : null;
}

function parseRequirementKind(
  form: FormData,
): PlatformDecisionRequirementKind | null {
  const candidate = scalarFormValue(form, "affected_requirement_kind");
  return candidate !== undefined &&
    (PLATFORM_DECISION_REQUIREMENT_KINDS as readonly string[]).includes(
      candidate,
    )
    ? (candidate as PlatformDecisionRequirementKind)
    : null;
}

function formRequirementReference(
  form: FormData,
  studentCaseId: string | null,
): Readonly<{
  kind: PlatformDecisionRequirementKind;
  id: string | null;
  field: PlatformStudentProfileField | null;
}> | null {
  const kind = parseRequirementKind(form);
  const id = optionalFormUuid(form, "affected_requirement_id");
  const rawField = optionalFormText(form, "affected_requirement_field", 128);
  if (kind === null || id === undefined || rawField === undefined) return null;
  const field =
    rawField === null
      ? null
      : (PLATFORM_STUDENT_PROFILE_FIELDS as readonly string[]).includes(rawField)
        ? (rawField as PlatformStudentProfileField)
        : undefined;
  if (field === undefined) return null;
  try {
    validateRequirementReference(kind, id, field, studentCaseId);
  } catch {
    return null;
  }
  return { kind, id, field };
}

function formSourceEvidence(
  form: FormData,
): Readonly<{ sourceRegistryId: string | null; evidenceRef: string | null }> | null {
  const sourceRegistryId = optionalFormUuid(form, "source_registry_id");
  const evidenceRef = optionalFormText(form, "evidence_ref", 1000);
  if (
    sourceRegistryId === undefined ||
    evidenceRef === undefined ||
    (sourceRegistryId === null) !== (evidenceRef === null)
  ) {
    return null;
  }
  return { sourceRegistryId, evidenceRef };
}

export function parsePlatformCreateDecisionBacklogEntryForm(
  form: FormData,
): PlatformCreateDecisionBacklogMutation | null {
  const conversationId = formUuid(form, "conversation_id");
  const studentCaseId = optionalFormUuid(form, "student_case_id");
  const question = formText(form, "question", 1, 2000);
  const ownerRole = parseOwnerRole(form);
  const reason = formText(form, "reason", 1, 1000);
  const requestId = formUuid(form, "request_id");
  if (
    conversationId === null ||
    studentCaseId === undefined ||
    question === null ||
    ownerRole === null ||
    reason === null ||
    requestId === null
  ) {
    return null;
  }
  const requirement = formRequirementReference(form, studentCaseId);
  const evidence = formSourceEvidence(form);
  if (requirement === null || evidence === null) return null;
  return {
    conversationId,
    studentCaseId,
    question,
    ownerRole,
    affectedRequirementKind: requirement.kind,
    affectedRequirementId: requirement.id,
    affectedRequirementField: requirement.field,
    sourceRegistryId: evidence.sourceRegistryId,
    evidenceRef: evidence.evidenceRef,
    reason,
    requestId,
  };
}

export function parsePlatformTransitionDecisionBacklogEntryForm(
  form: FormData,
): PlatformTransitionDecisionBacklogMutation | null {
  const base = parsePlatformCreateDecisionBacklogEntryForm(form);
  const decisionBacklogId = formUuid(form, "decision_backlog_id");
  const expectedEffectiveVersion = parsePlatformBw4PositiveBigint(
    scalarFormValue(form, "expected_effective_version"),
  );
  const rawStatus = scalarFormValue(form, "new_status");
  const newStatus =
    rawStatus !== undefined &&
    (PLATFORM_DECISION_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as PlatformDecisionStatus)
      : null;
  const answer = optionalFormText(form, "answer", 8000);
  if (
    base === null ||
    decisionBacklogId === null ||
    expectedEffectiveVersion === null ||
    newStatus === null ||
    answer === undefined ||
    (newStatus === "answered" &&
      (answer === null ||
        base.sourceRegistryId === null ||
        base.evidenceRef === null)) ||
    (newStatus === "unresolved" && answer !== null) ||
    (answer !== null &&
      (base.sourceRegistryId === null || base.evidenceRef === null))
  ) {
    return null;
  }
  return {
    ...base,
    decisionBacklogId,
    expectedEffectiveVersion,
    newStatus,
    answer,
  };
}

export function isPlatformDecisionTransitionAllowed(
  currentStatus: PlatformDecisionStatus,
  newStatus: PlatformDecisionStatus,
): boolean {
  return (
    (currentStatus === "unresolved" &&
      (newStatus === "answered" || newStatus === "retired")) ||
    (currentStatus === "answered" &&
      (newStatus === "unresolved" || newStatus === "retired"))
  );
}

export function doesPlatformDecisionMutationPreserveSnapshot(
  version: PlatformDecisionBacklogVersion,
  input: PlatformTransitionDecisionBacklogMutation,
): boolean {
  return (
    input.question === version.question &&
    input.answer === version.answer &&
    input.ownerRole === version.ownerRole &&
    input.affectedRequirementKind === version.affectedRequirementKind &&
    input.affectedRequirementId === version.affectedRequirementId &&
    input.affectedRequirementField === version.affectedRequirementField &&
    input.sourceRegistryId === version.sourceRegistryId &&
    input.evidenceRef === version.evidenceRef
  );
}

export function buildPlatformCreateDecisionBacklogRpcArgs(
  organizationId: string,
  input: PlatformCreateDecisionBacklogMutation,
): Readonly<Record<string, string | null>> {
  const parsedOrganizationId = parsePlatformBw4Uuid(organizationId);
  if (parsedOrganizationId === null) return invalidShape();
  return {
    p_organization_id: parsedOrganizationId,
    p_conversation_id: input.conversationId,
    p_student_case_id: input.studentCaseId,
    p_question: input.question,
    p_owner_role: input.ownerRole,
    p_affected_requirement_kind: input.affectedRequirementKind,
    p_affected_requirement_id: input.affectedRequirementId,
    p_affected_requirement_field: input.affectedRequirementField,
    p_source_registry_id: input.sourceRegistryId,
    p_evidence_ref: input.evidenceRef,
    p_reason: input.reason,
    p_request_id: input.requestId,
  };
}

export function buildPlatformTransitionDecisionBacklogRpcArgs(
  organizationId: string,
  input: PlatformTransitionDecisionBacklogMutation,
): Readonly<Record<string, string | null>> {
  const parsedOrganizationId = parsePlatformBw4Uuid(organizationId);
  if (parsedOrganizationId === null) return invalidShape();
  return {
    p_organization_id: parsedOrganizationId,
    p_conversation_id: input.conversationId,
    p_decision_backlog_id: input.decisionBacklogId,
    p_expected_effective_version: input.expectedEffectiveVersion,
    p_new_status: input.newStatus,
    p_question: input.question,
    p_answer: input.answer,
    p_owner_role: input.ownerRole,
    p_affected_requirement_kind: input.affectedRequirementKind,
    p_affected_requirement_id: input.affectedRequirementId,
    p_affected_requirement_field: input.affectedRequirementField,
    p_source_registry_id: input.sourceRegistryId,
    p_evidence_ref: input.evidenceRef,
    p_reason: input.reason,
    p_request_id: input.requestId,
  };
}

export function normalizePlatformDecisionMutationResponse(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    conversationId: string;
    studentCaseId?: string | null;
    decisionBacklogId?: string;
    expectedEffectiveVersion?: string;
    previousStatus?: PlatformDecisionStatus;
    status: PlatformDecisionStatus;
  }>,
): PlatformDecisionMutationResponse {
  if (!isRecord(value)) return invalidShape();
  const isTransition = expected.expectedEffectiveVersion !== undefined;
  requireExactKeys(
    value,
    isTransition
      ? [
          "organization_id",
          "conversation_id",
          "student_case_id",
          "decision_backlog_id",
          "decision_backlog_version_id",
          "effective_version",
          "status",
          "previous_effective_version",
          "previous_status",
        ]
      : [
          "organization_id",
          "conversation_id",
          "student_case_id",
          "decision_backlog_id",
          "decision_backlog_version_id",
          "effective_version",
          "status",
        ],
  );
  const organizationId = requiredUuid(value.organization_id);
  const conversationId = requiredUuid(value.conversation_id);
  const studentCaseId = optionalUuid(value.student_case_id);
  const decisionBacklogId = requiredUuid(value.decision_backlog_id);
  const effectiveVersion = positiveBigint(value.effective_version);
  const status = oneOf(value.status, PLATFORM_DECISION_STATUSES);
  const previousEffectiveVersion = isTransition
    ? positiveBigint(value.previous_effective_version)
    : null;
  const previousStatus = isTransition
    ? oneOf(value.previous_status, PLATFORM_DECISION_STATUSES)
    : null;
  if (
    organizationId !== expected.organizationId ||
    conversationId !== expected.conversationId ||
    (expected.studentCaseId !== undefined &&
      studentCaseId !== expected.studentCaseId) ||
    status !== expected.status ||
    (expected.decisionBacklogId !== undefined &&
      decisionBacklogId !== expected.decisionBacklogId) ||
    (isTransition &&
      (previousEffectiveVersion !== expected.expectedEffectiveVersion ||
        effectiveVersion !== nextPositiveBigint(previousEffectiveVersion) ||
        (expected.previousStatus !== undefined &&
          previousStatus !== expected.previousStatus))) ||
    (!isTransition && effectiveVersion !== "1")
  ) {
    return invalidShape();
  }
  return {
    organizationId,
    conversationId,
    studentCaseId,
    decisionBacklogId,
    decisionBacklogVersionId: requiredUuid(
      value.decision_backlog_version_id,
    ),
    effectiveVersion,
    status,
    previousEffectiveVersion,
    previousStatus,
  };
}
