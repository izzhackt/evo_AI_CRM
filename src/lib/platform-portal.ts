import type { PlatformActor } from "./platform-auth";
import type { PlatformStudentProfileCommunicationLanguage } from "./platform-student-profile";

const PORTAL_PROFILE_COMMUNICATION_LANGUAGES = ["ru", "en"] as const;
const PORTAL_PROFILE_MAX_DECISION_PARTICIPANTS = 12;
const PORTAL_PROFILE_MAX_DECISION_PARTICIPANT_LENGTH = 120;
import type {
  StudentPortalApplication,
  StudentPortalDocument,
  StudentPortalNextAction,
  StudentPortalNotification,
  StudentPortalPayment,
  StudentPortalSection,
  StudentPortalSnapshot,
  StudentPortalTask,
  StudentPortalUpdate,
  StudentPortalVisaCase,
} from "./contracts/student-portal";
import type {
  ApplicationStatus,
  ClientStage,
  DocumentStatus,
  PaymentStatus,
  TaskPriority,
  TaskStatus,
  VisaStatus,
} from "./domain";
import { isPlatformP6BPortalNotificationsEnabled } from "./server/platform-p6b-portal-notifications.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SINGLE_LINE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const PROFILE_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Student portal data is unavailable.";

const PLATFORM_STUDENT_PORTAL_SECTIONS = [
  "overview",
  "stage",
  "contacts",
  "tasks",
  "updates",
  "applications",
  "documents",
  "visa",
  "payments",
] as const satisfies readonly StudentPortalSection[];

const PORTAL_TIMELINE_STAGES = [
  "contract",
  "documents",
  "applying",
  "offer",
  "visa",
  "enrolled",
] as const satisfies readonly ClientStage[];
const PORTAL_STAGE_RANK = [
  "contract",
  "documents",
  "applying",
  "offer",
  "visa",
  "enrolled",
  "archived",
] as const satisfies readonly ClientStage[];
type PortalClientStage = (typeof PORTAL_STAGE_RANK)[number];

type PortalRpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformPortalRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: undefined,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<PortalRpcResponse>;
  }>;
}>;

export type PlatformPortalRepositoryOptions = Readonly<{
  client?: PlatformPortalRpcClient;
  generatedAt?: string;
  notificationsEnabled?: boolean;
}>;

type PortalProfile = Readonly<{
  caseId: string;
  studentProfileId: string;
  studentDisplayName: string;
  profileRevision: number;
  preferredDisplayName: string | null;
  legalDisplayName: string | null;
  communicationLanguage: PlatformStudentProfileCommunicationLanguage;
  dateOfBirth: string | null;
  citizenshipCountry: string | null;
  residencyCountry: string | null;
  currentEducationSummary: string | null;
  academicSummary: string | null;
  languageSummary: string | null;
  budgetBand: string | null;
  decisionParticipantLabels: readonly string[];
  consentStatus: "not_recorded" | "granted" | "withdrawn";
  consentEvidenceRef: string | null;
  profileNextStep: string | null;
  targetCountry: string;
  targetDegree: string;
  programDirection: string | null;
  intake: string | null;
  routeApprovalStatus: "draft" | "approved" | "rework";
  operationalStage: string;
  caseState: "active" | "closed";
  caseNextAction: string | null;
  portalActivatedAt: string;
  appliedCountryRequirementVersionId: string;
  checklistVersion: number;
  requiredProfileFields: readonly string[];
}>;

type NormalizedDocument = Readonly<{
  document: StudentPortalDocument;
  deadline: string | null;
  nextAction: string | null;
  versionNo: number | null;
}>;

type NormalizedPayment = Readonly<{
  payment: StudentPortalPayment;
  nextAction: string | null;
}>;

export class PlatformPortalRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformPortalRepositoryError";
  }
}

export type PlatformStudentPortalNotificationAck = Readonly<{
  notificationId: string;
  isRead: true;
  readAt: string;
}>;

function invalidShape(): never {
  throw new PlatformPortalRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformPortalRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) return invalidShape();
  return normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredText(value: unknown, maxLength = 1000): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(value: unknown, maxLength = 1000): string | null {
  return value === null ? null : requiredText(value, maxLength);
}

function requiredSingleLineText(value: unknown, maxLength: number): string {
  const normalized = requiredText(value, maxLength);
  return SINGLE_LINE_CONTROL_CHARACTER_PATTERN.test(normalized)
    ? invalidShape()
    : normalized;
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !value.includes("T") ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function optionalDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return invalidShape();
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return invalidShape();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  const numberValue =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 1
  ) {
    return invalidShape();
  }
  return numberValue;
}

function nonNegativeInteger(value: unknown): number {
  const numberValue =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0
  ) {
    return invalidShape();
  }
  return numberValue;
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

function textArray(
  value: unknown,
  options: Readonly<{
    fieldKeys?: boolean;
    maximumItems?: number;
    maximumItemLength?: number;
  }> = {},
): readonly string[] {
  const maximumItems = options.maximumItems ?? 32;
  const maximumItemLength = options.maximumItemLength ?? 200;
  if (!Array.isArray(value) || value.length > maximumItems) return invalidShape();
  const normalized = value.map((item) => requiredText(item, maximumItemLength));
  if (
    new Set(normalized).size !== normalized.length ||
    (options.fieldKeys &&
      normalized.some((item) => !PROFILE_FIELD_KEY_PATTERN.test(item)))
  ) {
    return invalidShape();
  }
  return normalized;
}

function datePart(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function assertCaseId(value: unknown, expectedCaseId: string): void {
  if (requiredUuid(value) !== expectedCaseId) return invalidShape();
}

function normalizeUniqueRows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  id: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > 500) return invalidShape();
  const seen = new Set<string>();
  return value.map((raw) => {
    const row = normalize(raw);
    const rowId = id(row);
    if (seen.has(rowId)) return invalidShape();
    seen.add(rowId);
    return row;
  });
}

export function mapPortalApplicationStatus(
  value: unknown,
): ApplicationStatus {
  switch (value) {
    case "preparation":
    case "ready":
      return "preparing";
    case "submitted":
    case "under_review":
      return "submitted";
    case "offer":
      return "offer";
    case "enrolled":
      return "enrolled";
    case "rejected":
    case "withdrawn":
    case "closed":
      return "rejected";
    default:
      return invalidShape();
  }
}

export function mapPortalDocumentStatus(value: unknown): DocumentStatus {
  switch (value) {
    case "required":
      return "required";
    case "submitted":
      return "uploaded";
    case "approved":
      return "approved";
    case "correction_required":
    case "rejected":
      return "rejected";
    default:
      return invalidShape();
  }
}

export function mapPortalVisaStatus(value: unknown): VisaStatus | null {
  switch (value) {
    case "not_required":
    case "closed":
      return null;
    case "not_started":
    case "docs":
    case "appointment":
    case "submitted":
    case "approved":
    case "rejected":
      return value;
    default:
      return invalidShape();
  }
}

export function mapPortalPaymentStatus(value: unknown): PaymentStatus {
  switch (value) {
    case "pending":
    case "partially_paid":
      return "pending";
    case "paid":
      return "paid";
    case "overdue":
      return "overdue";
    default:
      return invalidShape();
  }
}

export function mapPortalTaskStatus(value: unknown): TaskStatus | null {
  switch (value) {
    case "open":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "review";
    case "done":
    case "cancelled":
      return null;
    default:
      return invalidShape();
  }
}

function normalizeProfile(value: unknown): PortalProfile {
  if (!isRecord(value)) return invalidShape();
  return {
    caseId: requiredUuid(value.case_id),
    studentProfileId: requiredUuid(value.student_profile_id),
    studentDisplayName: requiredText(value.student_display_name, 200),
    profileRevision: positiveInteger(value.profile_revision),
    preferredDisplayName: optionalText(value.preferred_display_name, 200),
    legalDisplayName: optionalText(value.legal_display_name, 200),
    communicationLanguage: oneOf(
      value.communication_language,
      PORTAL_PROFILE_COMMUNICATION_LANGUAGES,
    ),
    dateOfBirth: optionalDate(value.date_of_birth),
    citizenshipCountry: requiredText(value.citizenship_country, 200),
    residencyCountry: requiredText(value.residency_country, 200),
    currentEducationSummary: requiredText(
      value.current_education_summary,
      2000,
    ),
    academicSummary: requiredText(value.academic_summary, 4000),
    languageSummary: requiredText(value.language_summary, 2000),
    budgetBand: requiredText(value.budget_band, 200),
    decisionParticipantLabels: textArray(value.decision_participant_labels, {
      maximumItems: PORTAL_PROFILE_MAX_DECISION_PARTICIPANTS,
      maximumItemLength: PORTAL_PROFILE_MAX_DECISION_PARTICIPANT_LENGTH,
    }),
    consentStatus: oneOf(value.consent_status, [
      "not_recorded",
      "granted",
      "withdrawn",
    ] as const),
    consentEvidenceRef: optionalText(value.consent_evidence_ref, 1000),
    profileNextStep: requiredText(value.profile_next_step, 1000),
    targetCountry: requiredText(value.target_country, 200),
    targetDegree: requiredText(value.target_degree, 200),
    programDirection: optionalText(value.program_direction, 500),
    intake: optionalText(value.intake, 200),
    routeApprovalStatus: oneOf(value.route_approval_status, [
      "draft",
      "approved",
      "rework",
    ] as const),
    operationalStage: requiredText(value.operational_stage, 100),
    caseState: oneOf(value.case_state, ["active", "closed"] as const),
    caseNextAction: optionalText(value.case_next_action, 1000),
    portalActivatedAt: requiredTimestamp(value.portal_activated_at),
    appliedCountryRequirementVersionId: requiredUuid(
      value.applied_country_requirement_version_id,
    ),
    checklistVersion: positiveInteger(value.checklist_version),
    requiredProfileFields: textArray(value.required_profile_fields, {
      fieldKeys: true,
    }),
  };
}

function normalizeApplication(
  value: unknown,
  profile: PortalProfile,
): StudentPortalApplication {
  if (!isRecord(value)) return invalidShape();
  assertCaseId(value.case_id, profile.caseId);
  requiredTimestamp(value.updated_at);
  return {
    id: requiredUuid(value.application_id),
    university: requiredText(value.institution_name, 500),
    country: profile.targetCountry,
    program: optionalText(value.program_name, 500),
    degree: profile.targetDegree,
    deadline: null,
    status: mapPortalApplicationStatus(value.application_status),
    notes: null,
  };
}

function normalizeDocument(
  value: unknown,
  profile: PortalProfile,
): NormalizedDocument {
  if (!isRecord(value)) return invalidShape();
  assertCaseId(value.case_id, profile.caseId);
  const submittedAt = optionalTimestamp(value.submitted_at);
  const reviewedAt = optionalTimestamp(value.reviewed_at);
  optionalUuid(value.document_version_id);
  optionalText(value.review_decision, 64);
  optionalText(value.instructions, 4000);
  optionalText(value.original_filename, 500);
  optionalText(value.declared_mime_type, 200);
  if (value.byte_size !== null) nonNegativeInteger(value.byte_size);
  const versionNo =
    value.version_no === null ? null : positiveInteger(value.version_no);
  return {
    document: {
      id: requiredUuid(value.document_slot_id),
      name: requiredText(value.requirement_label, 500),
      status: mapPortalDocumentStatus(value.slot_status),
      comment:
        optionalText(value.rework_reason, 2000) ??
        optionalText(value.next_action, 1000),
      updatedAt: reviewedAt ?? submittedAt,
    },
    deadline: datePart(optionalTimestamp(value.deadline)),
    nextAction: optionalText(value.next_action, 1000),
    versionNo,
  };
}

function normalizeVisa(
  value: unknown,
  profile: PortalProfile,
): StudentPortalVisaCase | null {
  if (!isRecord(value)) return invalidShape();
  assertCaseId(value.case_id, profile.caseId);
  requiredTimestamp(value.updated_at);
  const status = mapPortalVisaStatus(value.visa_status);
  if (status === null) return null;
  return {
    id: requiredUuid(value.visa_case_id),
    country: profile.targetCountry,
    status,
    appointmentAt: null,
    notes: null,
  };
}

function normalizeTask(
  value: unknown,
  profile: PortalProfile,
): StudentPortalTask | null {
  if (!isRecord(value)) return invalidShape();
  assertCaseId(value.case_id, profile.caseId);
  requiredTimestamp(value.updated_at);
  optionalText(value.task_type, 100);
  const status = mapPortalTaskStatus(value.task_status);
  if (status === null) return null;
  return {
    id: requiredUuid(value.case_task_id),
    title: requiredText(value.title, 500),
    description: null,
    dueDate: datePart(optionalTimestamp(value.due_at)),
    status,
    priority: oneOf(value.priority, [
      "low",
      "normal",
      "high",
      "urgent",
    ] as const) satisfies TaskPriority,
    assigneeName: null,
  };
}

function normalizeUpdate(
  value: unknown,
  profile: PortalProfile,
): StudentPortalUpdate {
  if (!isRecord(value)) return invalidShape();
  assertCaseId(value.case_id, profile.caseId);
  optionalText(value.source, 100);
  return {
    id: requiredUuid(value.case_update_id),
    message: requiredText(value.body, 4000),
    authorName: null,
    createdAt: requiredTimestamp(value.occurred_at),
    // The RPC has no per-student read receipt. Treating its historical updates
    // as read avoids inventing unread state or a fake acknowledgement control.
    isRead: true,
  };
}

function normalizePortalNotification(
  value: unknown,
): StudentPortalNotification {
  if (!isRecord(value)) return invalidShape();
  const readAt = optionalTimestamp(value.read_at);
  return {
    id: requiredUuid(value.notification_id),
    category: oneOf(value.category, ["document.review"] as const),
    decision: oneOf(value.review_decision, [
      "correction_required",
      "rejected",
    ] as const),
    requirementKey: requiredSingleLineText(value.requirement_key, 128),
    requirementLabel: requiredSingleLineText(value.requirement_label, 300),
    reason: requiredSingleLineText(value.reason, 2000),
    createdAt: requiredTimestamp(value.created_at),
    readAt,
    isRead: readAt !== null,
  };
}

export function normalizePlatformStudentPortalNotificationAck(
  value: unknown,
  expectedNotificationId: string,
): PlatformStudentPortalNotificationAck {
  if (!isRecord(value)) return invalidShape();
  if (
    Object.keys(value).sort().join(",") !==
      "is_read,notification_id,read_at" ||
    value.is_read !== true
  ) {
    return invalidShape();
  }
  const notificationId = requiredUuid(value.notification_id);
  if (notificationId !== requiredUuid(expectedNotificationId)) {
    return invalidShape();
  }
  return {
    notificationId,
    isRead: true,
    readAt: requiredTimestamp(value.read_at),
  };
}

function normalizePayment(
  value: unknown,
  profile: PortalProfile,
): NormalizedPayment {
  if (!isRecord(value)) return invalidShape();
  assertCaseId(value.case_id, profile.caseId);
  optionalText(value.category, 100);
  const amountMinor = nonNegativeInteger(value.amount_minor);
  const currency = requiredText(value.currency, 10).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return invalidShape();
  const derivedStatus = mapPortalPaymentStatus(value.derived_status);
  if (typeof value.overdue !== "boolean") return invalidShape();
  if (value.overdue !== (derivedStatus === "overdue")) return invalidShape();
  return {
    payment: {
      id: requiredUuid(value.payment_obligation_id),
      title: requiredText(value.obligation_label, 500),
      amount: amountMinor / 100,
      currency,
      dueDate: datePart(optionalTimestamp(value.due_at)),
      // The projection exposes status totals, not a confirmed settlement date.
      paidAt: null,
      status: derivedStatus,
    },
    nextAction: optionalText(value.next_action, 1000),
  };
}

function deduplicateDocuments(
  value: unknown,
  profile: PortalProfile,
): readonly NormalizedDocument[] {
  if (!Array.isArray(value) || value.length > 1000) return invalidShape();
  const documents = new Map<string, NormalizedDocument>();
  for (const raw of value) {
    const candidate = normalizeDocument(raw, profile);
    const id = String(candidate.document.id);
    const current = documents.get(id);
    if (!current) {
      documents.set(id, candidate);
      continue;
    }
    if (
      current.versionNo === null ||
      candidate.versionNo === null ||
      current.versionNo === candidate.versionNo ||
      current.document.name !== candidate.document.name ||
      current.document.status !== candidate.document.status
    ) {
      return invalidShape();
    }
    if (candidate.versionNo > current.versionNo) {
      documents.set(id, candidate);
    }
  }
  return [...documents.values()];
}

function operationalStageCandidate(value: string): PortalClientStage {
  switch (value.trim().toLowerCase()) {
    case "documents":
    case "document_collection":
    case "document_preparation":
      return "documents";
    case "applying":
    case "applications":
    case "application_preparation":
      return "applying";
    case "offer":
      return "offer";
    case "visa":
      return "visa";
    case "enrolled":
      return "enrolled";
    case "archived":
    case "closed":
      return "archived";
    default:
      // Portal activation is post-contract. Unknown operational workflow keys
      // must not be reinterpreted as amoCRM lead or consultation stages.
      return "contract";
  }
}

export function derivePortalClientStage(input: Readonly<{
  caseState: "active" | "closed";
  operationalStage: string;
  applications: readonly Pick<StudentPortalApplication, "status">[];
  documents: readonly Pick<StudentPortalDocument, "status">[];
  visaStatus: VisaStatus | null;
}>): ClientStage {
  if (input.caseState === "closed") return "archived";

  const candidates: PortalClientStage[] = [
    "contract",
    operationalStageCandidate(input.operationalStage),
  ];
  if (input.documents.length > 0) candidates.push("documents");
  if (input.applications.length > 0) candidates.push("applying");
  if (input.applications.some(({ status }) => status === "offer")) {
    candidates.push("offer");
  }
  if (input.visaStatus !== null) candidates.push("visa");
  if (input.applications.some(({ status }) => status === "enrolled")) {
    candidates.push("enrolled");
  }

  return candidates.reduce((furthest, candidate) =>
    PORTAL_STAGE_RANK.indexOf(candidate) >
    PORTAL_STAGE_RANK.indexOf(furthest)
      ? candidate
      : furthest,
  );
}

function stageTimeline(stage: ClientStage): StudentPortalSnapshot["stageTimeline"] {
  const visibleStage = stage === "archived" ? "enrolled" : stage;
  const currentIndex = Math.max(
    0,
    PORTAL_TIMELINE_STAGES.indexOf(
      visibleStage as (typeof PORTAL_TIMELINE_STAGES)[number],
    ),
  );
  return PORTAL_TIMELINE_STAGES.map((stageItem, index) => ({
    stage: stageItem,
    labelKey: `stage.${stageItem}` as const,
    state:
      index < currentIndex
        ? "complete"
        : index === currentIndex
          ? "current"
          : "locked",
  }));
}

function progressPercent(stage: ClientStage): number {
  const visibleStage = stage === "archived" ? "enrolled" : stage;
  const currentIndex = Math.max(
    0,
    PORTAL_TIMELINE_STAGES.indexOf(
      visibleStage as (typeof PORTAL_TIMELINE_STAGES)[number],
    ),
  );
  return Math.round(
    ((currentIndex + 1) / PORTAL_TIMELINE_STAGES.length) * 100,
  );
}

function actionForTask(task: StudentPortalTask): StudentPortalNextAction {
  return {
    labelKey: "portalNextTask",
    detail: task.title,
    dueDate: task.dueDate,
    severity:
      task.priority === "urgent"
        ? "urgent"
        : task.priority === "high"
          ? "warning"
          : "normal",
  };
}

function nextAction(input: Readonly<{
  profile: PortalProfile;
  documents: readonly NormalizedDocument[];
  payments: readonly NormalizedPayment[];
  tasks: readonly StudentPortalTask[];
}>): StudentPortalNextAction | null {
  const urgentTask = input.tasks.find(
    ({ priority }) => priority === "urgent" || priority === "high",
  );
  if (urgentTask) return actionForTask(urgentTask);

  const rejectedDocument = input.documents.find(
    ({ document }) => document.status === "rejected",
  );
  if (rejectedDocument) {
    return {
      labelKey: "portalNextDocument",
      detail:
        rejectedDocument.nextAction ?? rejectedDocument.document.name,
      dueDate: rejectedDocument.deadline,
      severity: "urgent",
    };
  }

  const overduePayment = input.payments.find(
    ({ payment }) => payment.status === "overdue",
  );
  if (overduePayment) {
    return {
      labelKey: "portalNextOverduePayment",
      detail: overduePayment.nextAction ?? overduePayment.payment.title,
      dueDate: overduePayment.payment.dueDate,
      severity: "urgent",
    };
  }

  const explicitNextStep =
    input.profile.profileNextStep ?? input.profile.caseNextAction;
  if (explicitNextStep) {
    return {
      labelKey: "nextAction",
      detail: explicitNextStep,
      // Neither profile nor case next-action text carries a deadline.
      dueDate: null,
      severity: "normal",
    };
  }

  if (input.tasks[0]) return actionForTask(input.tasks[0]);

  const requiredDocument = input.documents.find(
    ({ document }) => document.status === "required",
  );
  if (requiredDocument) {
    return {
      labelKey: "portalNextDocument",
      detail: requiredDocument.nextAction ?? requiredDocument.document.name,
      dueDate: requiredDocument.deadline,
      severity: "warning",
    };
  }

  const pendingPayment = input.payments.find(
    ({ payment }) => payment.status === "pending",
  );
  if (pendingPayment) {
    return {
      labelKey: "portalNextPayment",
      detail: pendingPayment.nextAction ?? pendingPayment.payment.title,
      dueDate: pendingPayment.payment.dueDate,
      severity: "normal",
    };
  }

  return null;
}

export function normalizePlatformStudentPortalSnapshot(input: Readonly<{
  profile: unknown;
  applications: unknown;
  documents: unknown;
  visaCases: unknown;
  tasks: unknown;
  updates: unknown;
  finance: unknown;
  notifications?: unknown;
  generatedAt?: string;
}>): StudentPortalSnapshot {
  const profile = normalizeProfile(input.profile);

  const applications = normalizeUniqueRows(
    input.applications,
    (row) => normalizeApplication(row, profile),
    (row) => String(row.id),
  );
  const documents = deduplicateDocuments(input.documents, profile);
  if (!Array.isArray(input.visaCases) || input.visaCases.length > 1) {
    return invalidShape();
  }
  const visa = input.visaCases[0]
    ? normalizeVisa(input.visaCases[0], profile)
    : null;
  const tasks = normalizeUniqueRows(
    input.tasks,
    (row) => {
      const normalized = normalizeTask(row, profile);
      return normalized ?? { filteredId: requiredUuid((row as Record<string, unknown>).case_task_id) };
    },
    (row) =>
      "filteredId" in row ? row.filteredId : String(row.id),
  ).filter((row): row is StudentPortalTask => !("filteredId" in row));
  const updates = normalizeUniqueRows(
    input.updates,
    (row) => normalizeUpdate(row, profile),
    (row) => String(row.id),
  );
  const notifications = input.notifications === undefined
    ? undefined
    : normalizeUniqueRows(
        input.notifications,
        normalizePortalNotification,
        (notification) => notification.id,
      );
  const payments = normalizeUniqueRows(
    input.finance,
    (row) => normalizePayment(row, profile),
    (row) => String(row.payment.id),
  );
  const stage = derivePortalClientStage({
    caseState: profile.caseState,
    operationalStage: profile.operationalStage,
    applications,
    documents: documents.map(({ document }) => document),
    visaStatus: visa?.status ?? null,
  });
  const generatedAt = requiredTimestamp(
    input.generatedAt ?? new Date().toISOString(),
  );

  const snapshot: StudentPortalSnapshot = {
    student: {
      id: profile.studentProfileId,
      name:
        profile.preferredDisplayName ??
        profile.legalDisplayName ??
        profile.studentDisplayName,
      // The profile RPC deliberately does not expose auth email or phone.
      email: null,
      phone: null,
    },
    client: {
      id: profile.caseId,
      stage,
      targetCountry: profile.targetCountry,
      targetDegree: profile.targetDegree,
      managerId: null,
      curatorId: null,
    },
    profile: {
      revision: profile.profileRevision,
      preferredDisplayName: profile.preferredDisplayName,
      legalDisplayName: profile.legalDisplayName,
      communicationLanguage: profile.communicationLanguage,
      dateOfBirth: profile.dateOfBirth,
      citizenshipCountry: profile.citizenshipCountry,
      residencyCountry: profile.residencyCountry,
      currentEducationSummary: profile.currentEducationSummary,
      academicSummary: profile.academicSummary,
      languageSummary: profile.languageSummary,
      budgetBand: profile.budgetBand,
      decisionParticipantLabels: profile.decisionParticipantLabels,
      consentStatus: profile.consentStatus,
      nextStep: profile.profileNextStep ?? profile.caseNextAction,
      programDirection: profile.programDirection,
      intake: profile.intake,
      requiredFields: profile.requiredProfileFields,
    },
    visibleSections: PLATFORM_STUDENT_PORTAL_SECTIONS,
    stageTimeline: stageTimeline(stage),
    progressPercent: progressPercent(stage),
    nextAction: null,
    // Staff identity/contact columns are not present in the student RPCs.
    manager: null,
    curator: null,
    ...(notifications ? { notifications } : {}),
    updates,
    applications,
    documents: documents.map(({ document }) => document),
    visa,
    payments: payments.map(({ payment }) => payment),
    tasks,
    generatedAt,
  };
  return {
    ...snapshot,
    nextAction: nextAction({ profile, documents, payments, tasks }),
  };
}

async function getPlatformPortalClient(): Promise<PlatformPortalRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return (await createSupabaseServerClient()) as unknown as PlatformPortalRpcClient;
}

async function readPortalRpc(
  client: PlatformPortalRpcClient,
  functionName: string,
): Promise<unknown[]> {
  let response: PortalRpcResponse;
  try {
    response = await client
      .schema("platform")
      .rpc(functionName, undefined, { get: true });
  } catch {
    return invalidShape();
  }
  if (response.error || !Array.isArray(response.data)) return invalidShape();
  return response.data;
}

/**
 * Reads the argument-free, actor-scoped P6B projection. Mapping creates the
 * browser-safe DTO and deliberately drops every unapproved source column.
 */
export async function listPlatformStudentPortalNotifications(
  actor: PlatformActor,
  options: Pick<PlatformPortalRepositoryOptions, "client"> = {},
): Promise<readonly StudentPortalNotification[]> {
  try {
    if (actor.platformRole !== "student") return invalidShape();
    requiredUuid(actor.profileId);
    requiredUuid(actor.authUserId);
    requiredUuid(actor.membershipId);
    requiredUuid(actor.organizationId);

    const client = options.client ?? (await getPlatformPortalClient());
    const rows = await readPortalRpc(
      client,
      "student_portal_notifications_v1",
    );
    return normalizeUniqueRows(
      rows,
      normalizePortalNotification,
      (notification) => notification.id,
    );
  } catch (error) {
    return failClosed(error);
  }
}

/**
 * Loads the complete RLS-scoped portal projection for the current student.
 * A missing profile means no connected case; every malformed, duplicate or
 * provider-error response fails closed.
 */
export async function getPlatformStudentPortalSnapshot(
  actor: PlatformActor,
  options: PlatformPortalRepositoryOptions = {},
): Promise<StudentPortalSnapshot | null> {
  try {
    if (actor.platformRole !== "student") return invalidShape();
    // Identity profile and admissions Student Profile are distinct records.
    // The argument-free RPC binds them through membership scope and RLS.
    requiredUuid(actor.profileId);
    requiredUuid(actor.authUserId);
    requiredUuid(actor.membershipId);
    requiredUuid(actor.organizationId);

    const client = options.client ?? (await getPlatformPortalClient());
    const profileRows = await readPortalRpc(
      client,
      "student_portal_profile",
    );
    if (profileRows.length === 0) return null;
    if (profileRows.length !== 1) return invalidShape();

    const notificationsEnabled =
      options.notificationsEnabled
      ?? isPlatformP6BPortalNotificationsEnabled();
    const [
      applications,
      visaCases,
      tasks,
      updates,
      documents,
      finance,
      notifications,
    ] =
      await Promise.all([
        readPortalRpc(client, "student_portal_applications"),
        readPortalRpc(client, "student_portal_visa_cases"),
        readPortalRpc(client, "student_portal_tasks"),
        readPortalRpc(client, "student_portal_updates"),
        readPortalRpc(client, "student_portal_documents"),
        readPortalRpc(client, "student_portal_finance"),
        notificationsEnabled
          ? readPortalRpc(client, "student_portal_notifications_v1")
          : Promise.resolve(undefined),
      ]);

    return normalizePlatformStudentPortalSnapshot({
      profile: profileRows[0],
      applications,
      documents,
      visaCases,
      tasks,
      updates,
      finance,
      notifications,
      generatedAt: options.generatedAt,
    });
  } catch (error) {
    return failClosed(error);
  }
}
