import "server-only";

import {
  PLATFORM_APPLICATION_STATUSES,
  type PlatformApplicationStatus,
} from "../platform-application-contract.ts";
import {
  type PlatformCaseTaskStatus,
} from "../platform-admissions-task-contract.ts";
import {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_OBLIGATION_STATUSES,
  PLATFORM_VISA_STATUSES,
  type PlatformObligationCategory,
  type PlatformObligationStatus,
  type PlatformVisaStatus,
} from "../platform-case-operations-contract.ts";
import {
  PLATFORM_DOCUMENT_REVIEW_DECISIONS,
  PLATFORM_DOCUMENT_SLOT_STATUSES,
  type PlatformDocumentReviewDecision,
  type PlatformDocumentSlotStatus,
} from "../platform-private-documents.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const REQUIREMENT_KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const NOTIFICATION_CODE_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const TIMELINE_LIMIT = 50;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type StudentPortalDocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

export const STUDENT_PORTAL_DOCUMENT_ACTION_KINDS = [
  "upload_document",
  "replace_document",
] as const;

export type StudentPortalDocumentActionKind =
  (typeof STUDENT_PORTAL_DOCUMENT_ACTION_KINDS)[number];

const STUDENT_PORTAL_EVO_ACTION_STATUSES = [
  "open",
  "in_progress",
  "blocked",
] as const satisfies readonly PlatformCaseTaskStatus[];

type StudentPortalEvoActionStatus =
  (typeof STUDENT_PORTAL_EVO_ACTION_STATUSES)[number];

export type StudentPortalDocumentAction = Readonly<{
  kind: StudentPortalDocumentActionKind;
  label: string;
  dueAt: string | null;
  documentSlotId: string;
}>;

export type StudentPortalEvoAction = Readonly<{
  taskId: string;
  title: string;
  status: StudentPortalEvoActionStatus;
  dueAt: string | null;
  dueOn: string | null;
}>;

export type StudentPortalOverview = Readonly<{
  /** Canonical raw value; UI must map it through the single V3 wording module. */
  operationalStage: string;
  studentAction: StudentPortalDocumentAction | null;
  evoAction: StudentPortalEvoAction | null;
  curatorDisplayName: string | null;
}>;

export type StudentPortalApplicationTimelineEntry = Readonly<{
  previousStatus: PlatformApplicationStatus | null;
  newStatus: PlatformApplicationStatus;
  occurredAt: string;
}>;

export type StudentPortalApplication = Readonly<{
  applicationId: string;
  institutionName: string;
  programName: string;
  status: PlatformApplicationStatus;
  isPrimary: boolean;
  universityDeadlineOn: string | null;
  timeline: readonly StudentPortalApplicationTimelineEntry[];
}>;

export type StudentPortalVisaTimelineEntry = Readonly<{
  previousStatus: PlatformVisaStatus | null;
  newStatus: PlatformVisaStatus;
  occurredAt: string;
}>;

export type StudentPortalVisa = Readonly<{
  visaCaseId: string;
  status: PlatformVisaStatus;
  timeline: readonly StudentPortalVisaTimelineEntry[];
}>;

export type StudentPortalApplications = Readonly<{
  applications: readonly StudentPortalApplication[];
  visa: StudentPortalVisa | null;
}>;

export type StudentPortalDocument = Readonly<{
  caseId: string;
  documentSlotId: string;
  requirementKey: string | null;
  requirementLabel: string;
  instructions: string | null;
  status: PlatformDocumentSlotStatus;
  deadline: string | null;
  nextAction: string | null;
  documentVersionId: string | null;
  versionNo: string | null;
  originalFilename: string | null;
  declaredMimeType: StudentPortalDocumentMimeType | null;
  byteSize: number | null;
  submittedAt: string | null;
  reviewDecision: PlatformDocumentReviewDecision | null;
  reworkReason: string | null;
  reviewedAt: string | null;
}>;

export type StudentPortalPayment = Readonly<{
  label: string;
  category: PlatformObligationCategory;
  amountMinor: number;
  paidMinor: number;
  refundedMinor: number;
  outstandingMinor: number;
  currency: string;
  dueAt: string;
  status: PlatformObligationStatus;
  overdue: boolean;
  nextAction: string;
}>;

export type StudentPortalNotification = Readonly<{
  notificationId: string;
  category: string;
  eventCode: string;
  subjectLabel: string;
  detail: string | null;
  dueAt: string | null;
  createdAt: string;
  readAt: string | null;
}>;

export type MarkStudentPortalNotificationReadInput = Readonly<{
  notificationId: string;
  requestId: string;
}>;

export type StudentPortalNotificationReadResult = Readonly<{
  notificationId: string;
  isRead: true;
  readAt: string;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type StudentPortalRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type StudentPortalSourceDependencies = Readonly<{
  client?: StudentPortalRpcClient;
}>;

export class StudentPortalSourceError extends Error {
  constructor() {
    super("Student Portal data is unavailable.");
    this.name = "StudentPortalSourceError";
  }
}

function invalidShape(): never {
  throw new StudentPortalSourceError();
}

function failClosed(error: unknown): never {
  if (error instanceof StudentPortalSourceError) throw error;
  throw new StudentPortalSourceError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidShape();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalidShape();
  }
  return record;
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : requiredText(value, maximum);
}

function requiredTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    return invalidShape();
  }

  const match = TIMESTAMPTZ_PATTERN.exec(value);
  const parsedTimestamp = Date.parse(value);
  if (!match || !Number.isFinite(parsedTimestamp)) return invalidShape();

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fractionalSecond = "",
    offsetText,
    offsetSign,
    offsetHourText = "0",
    offsetMinuteText = "0",
  ] = match;
  requiredDate(`${yearText}-${monthText}-${dayText}`);

  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (offsetHour > 23 || offsetMinute > 59) return invalidShape();

  const offsetDirection = offsetText === "Z" || offsetSign === "+" ? 1 : -1;
  const offsetMilliseconds = offsetDirection
    * ((offsetHour * 60) + offsetMinute)
    * 60_000;
  const localTimestamp = new Date(parsedTimestamp + offsetMilliseconds);
  const millisecond = Number(fractionalSecond.padEnd(3, "0").slice(0, 3));
  if (
    localTimestamp.getUTCFullYear() !== Number(yearText) ||
    localTimestamp.getUTCMonth() !== Number(monthText) - 1 ||
    localTimestamp.getUTCDate() !== Number(dayText) ||
    localTimestamp.getUTCHours() !== Number(hourText) ||
    localTimestamp.getUTCMinutes() !== Number(minuteText) ||
    localTimestamp.getUTCSeconds() !== Number(secondText) ||
    localTimestamp.getUTCMilliseconds() !== millisecond
  ) {
    return invalidShape();
  }

  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function requiredDate(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return invalidShape();
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return invalidShape();
  }
  return value;
}

function optionalDate(value: unknown): string | null {
  return value === null ? null : requiredDate(value);
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : invalidShape();
}

function nonNegativeSafeInteger(value: unknown): number {
  let numeric: bigint;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    numeric = BigInt(value);
  } else if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    numeric = BigInt(value);
  } else {
    return invalidShape();
  }
  if (numeric > MAX_POSTGRES_BIGINT || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    return invalidShape();
  }
  return Number(numeric);
}

function positiveSafeInteger(value: unknown): number {
  const numeric = nonNegativeSafeInteger(value);
  return numeric > 0 ? numeric : invalidShape();
}

function positiveBigintText(value: unknown): string {
  if (typeof value === "number") return String(positiveSafeInteger(value));
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return invalidShape();
  }
  return BigInt(value) <= MAX_POSTGRES_BIGINT ? value : invalidShape();
}

function rows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  key?: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value)) return invalidShape();
  const seen = new Set<string>();
  return Object.freeze(value.map((raw) => {
    const row = normalize(raw);
    if (key) {
      const rowKey = key(row);
      if (seen.has(rowKey)) return invalidShape();
      seen.add(rowKey);
    }
    return row;
  }));
}

export function normalizeStudentPortalOverview(
  value: unknown,
): StudentPortalOverview {
  const row = exactRecord(value, [
    "operational_stage",
    "student_action_kind",
    "student_action_label",
    "student_action_due_at",
    "student_action_document_slot_id",
    "evo_action_task_id",
    "evo_action_title",
    "evo_action_status",
    "evo_action_due_at",
    "evo_action_due_on",
    "curator_display_name",
  ]);

  const studentActionKind = row.student_action_kind === null
    ? null
    : enumValue(row.student_action_kind, STUDENT_PORTAL_DOCUMENT_ACTION_KINDS);
  const studentActionLabel = optionalText(row.student_action_label, 500);
  const studentActionDueAt = optionalTimestamp(row.student_action_due_at);
  const studentActionDocumentSlotId = row.student_action_document_slot_id === null
    ? null
    : requiredUuid(row.student_action_document_slot_id);
  let studentAction: StudentPortalDocumentAction | null = null;
  if (studentActionKind === null) {
    if (
      studentActionLabel !== null ||
      studentActionDueAt !== null ||
      studentActionDocumentSlotId !== null
    ) return invalidShape();
  } else {
    if (studentActionLabel === null || studentActionDocumentSlotId === null) {
      return invalidShape();
    }
    studentAction = Object.freeze({
      kind: studentActionKind,
      label: studentActionLabel,
      dueAt: studentActionDueAt,
      documentSlotId: studentActionDocumentSlotId,
    });
  }

  const evoActionTaskId = row.evo_action_task_id === null
    ? null
    : requiredUuid(row.evo_action_task_id);
  const evoActionTitle = optionalText(row.evo_action_title, 1000);
  const evoActionStatus = row.evo_action_status === null
    ? null
    : enumValue(row.evo_action_status, STUDENT_PORTAL_EVO_ACTION_STATUSES);
  const evoActionDueAt = optionalTimestamp(row.evo_action_due_at);
  const evoActionDueOn = optionalDate(row.evo_action_due_on);
  let evoAction: StudentPortalEvoAction | null = null;
  if (evoActionTaskId === null) {
    if (
      evoActionTitle !== null ||
      evoActionStatus !== null ||
      evoActionDueAt !== null ||
      evoActionDueOn !== null
    ) return invalidShape();
  } else {
    if (
      evoActionTitle === null ||
      evoActionStatus === null ||
      (evoActionDueAt !== null && evoActionDueOn !== null)
    ) return invalidShape();
    evoAction = Object.freeze({
      taskId: evoActionTaskId,
      title: evoActionTitle,
      status: evoActionStatus,
      dueAt: evoActionDueAt,
      dueOn: evoActionDueOn,
    });
  }

  return Object.freeze({
    operationalStage: requiredText(row.operational_stage, 300),
    studentAction,
    evoAction,
    curatorDisplayName: optionalText(row.curator_display_name, 200),
  });
}

function normalizeApplicationTimelineEntry(
  value: unknown,
): StudentPortalApplicationTimelineEntry {
  const row = exactRecord(value, ["previous_status", "new_status", "occurred_at"]);
  const previousStatus = row.previous_status === null
    ? null
    : enumValue(row.previous_status, PLATFORM_APPLICATION_STATUSES);
  const newStatus = enumValue(row.new_status, PLATFORM_APPLICATION_STATUSES);
  if (previousStatus === newStatus) return invalidShape();
  return Object.freeze({
    previousStatus,
    newStatus,
    occurredAt: requiredTimestamp(row.occurred_at),
  });
}

function normalizeApplication(value: unknown): Omit<StudentPortalApplication, "timeline"> {
  const row = exactRecord(value, [
    "application_id",
    "institution_name",
    "program_name",
    "application_status",
    "is_primary",
    "university_deadline_on",
  ]);
  if (typeof row.is_primary !== "boolean") return invalidShape();
  return Object.freeze({
    applicationId: requiredUuid(row.application_id),
    institutionName: requiredText(row.institution_name, 300),
    programName: requiredText(row.program_name, 300),
    status: enumValue(row.application_status, PLATFORM_APPLICATION_STATUSES),
    isPrimary: row.is_primary,
    universityDeadlineOn: optionalDate(row.university_deadline_on),
  });
}

function normalizeVisaTimelineEntry(value: unknown): StudentPortalVisaTimelineEntry {
  const row = exactRecord(value, ["previous_status", "new_status", "occurred_at"]);
  const previousStatus = row.previous_status === null
    ? null
    : enumValue(row.previous_status, PLATFORM_VISA_STATUSES);
  const newStatus = enumValue(row.new_status, PLATFORM_VISA_STATUSES);
  if (previousStatus === newStatus) return invalidShape();
  return Object.freeze({
    previousStatus,
    newStatus,
    occurredAt: requiredTimestamp(row.occurred_at),
  });
}

function normalizeVisa(value: unknown): Omit<StudentPortalVisa, "timeline"> {
  const row = exactRecord(value, ["visa_case_id", "visa_status"]);
  return Object.freeze({
    visaCaseId: requiredUuid(row.visa_case_id),
    status: enumValue(row.visa_status, PLATFORM_VISA_STATUSES),
  });
}

function assertTimelineContinuity<T extends Readonly<{
  previousStatus: string | null;
  newStatus: string;
  occurredAt: string;
}>>(timeline: readonly T[], currentStatus: string): void {
  if (timeline[0] && timeline[0].newStatus !== currentStatus) {
    return invalidShape();
  }
  for (let index = 1; index < timeline.length; index += 1) {
    const newer = timeline[index - 1];
    const older = timeline[index];
    if (
      Date.parse(newer.occurredAt) < Date.parse(older.occurredAt) ||
      newer.previousStatus !== older.newStatus
    ) {
      return invalidShape();
    }
  }
}

export function normalizeStudentPortalDocument(
  value: unknown,
): StudentPortalDocument {
  const row = exactRecord(value, [
    "case_id",
    "document_slot_id",
    "requirement_key",
    "requirement_label",
    "instructions",
    "slot_status",
    "deadline",
    "next_action",
    "document_version_id",
    "version_no",
    "original_filename",
    "declared_mime_type",
    "byte_size",
    "submitted_at",
    "review_decision",
    "rework_reason",
    "reviewed_at",
  ]);
  const requirementKey = row.requirement_key === null
    ? null
    : requiredText(row.requirement_key, 160);
  if (requirementKey !== null && !REQUIREMENT_KEY_PATTERN.test(requirementKey)) {
    return invalidShape();
  }

  const documentVersionId = row.document_version_id === null
    ? null
    : requiredUuid(row.document_version_id);
  const reviewDecision = row.review_decision === null
    ? null
    : enumValue(row.review_decision, PLATFORM_DOCUMENT_REVIEW_DECISIONS);
  const versionFields = [
    row.version_no,
    row.original_filename,
    row.declared_mime_type,
    row.byte_size,
    row.submitted_at,
  ];
  if (
    (documentVersionId === null && versionFields.some((field) => field !== null)) ||
    (documentVersionId !== null && versionFields.some((field) => field === null))
  ) {
    return invalidShape();
  }
  if (
    documentVersionId === null &&
    (reviewDecision !== null || row.rework_reason !== null || row.reviewed_at !== null)
  ) {
    return invalidShape();
  }
  if (
    (reviewDecision === null && (row.rework_reason !== null || row.reviewed_at !== null)) ||
    (reviewDecision !== null && row.reviewed_at === null)
  ) {
    return invalidShape();
  }
  if (
    (reviewDecision === "approved" && row.rework_reason !== null) ||
    ((reviewDecision === "correction_required" || reviewDecision === "rejected") &&
      row.rework_reason === null)
  ) {
    return invalidShape();
  }

  return Object.freeze({
    caseId: requiredUuid(row.case_id),
    documentSlotId: requiredUuid(row.document_slot_id),
    requirementKey,
    requirementLabel: requiredText(row.requirement_label, 300),
    instructions: optionalText(row.instructions, 5000),
    status: enumValue(row.slot_status, PLATFORM_DOCUMENT_SLOT_STATUSES),
    deadline: optionalTimestamp(row.deadline),
    nextAction: optionalText(row.next_action, 1000),
    documentVersionId,
    versionNo: documentVersionId === null ? null : positiveBigintText(row.version_no),
    originalFilename: documentVersionId === null
      ? null
      : requiredText(row.original_filename, 255),
    declaredMimeType: documentVersionId === null
      ? null
      : enumValue(row.declared_mime_type, DOCUMENT_MIME_TYPES),
    byteSize: documentVersionId === null
      ? null
      : positiveSafeInteger(row.byte_size),
    submittedAt: documentVersionId === null
      ? null
      : requiredTimestamp(row.submitted_at),
    reviewDecision,
    reworkReason: optionalText(row.rework_reason, 2000),
    reviewedAt: optionalTimestamp(row.reviewed_at),
  });
}

export function normalizeStudentPortalPayment(value: unknown): StudentPortalPayment {
  const row = exactRecord(value, [
    "obligation_label",
    "category",
    "amount_minor",
    "paid_minor",
    "refunded_minor",
    "outstanding_minor",
    "currency",
    "due_at",
    "derived_status",
    "overdue",
    "next_action",
  ]);
  const amountMinor = nonNegativeSafeInteger(row.amount_minor);
  const paidMinor = nonNegativeSafeInteger(row.paid_minor);
  const refundedMinor = nonNegativeSafeInteger(row.refunded_minor);
  const outstandingMinor = nonNegativeSafeInteger(row.outstanding_minor);
  const status = enumValue(row.derived_status, PLATFORM_OBLIGATION_STATUSES);
  if (
    amountMinor < 1 ||
    refundedMinor > paidMinor ||
    paidMinor - refundedMinor > amountMinor ||
    !Number.isSafeInteger(amountMinor - paidMinor + refundedMinor) ||
    outstandingMinor !== amountMinor - paidMinor + refundedMinor ||
    typeof row.overdue !== "boolean" ||
    row.overdue !== (status === "overdue") ||
    (status === "paid" ? outstandingMinor !== 0 : outstandingMinor === 0)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    label: requiredText(row.obligation_label, 300),
    category: enumValue(row.category, PLATFORM_OBLIGATION_CATEGORIES),
    amountMinor,
    paidMinor,
    refundedMinor,
    outstandingMinor,
    currency: typeof row.currency === "string" && CURRENCY_PATTERN.test(row.currency)
      ? row.currency
      : invalidShape(),
    dueAt: requiredTimestamp(row.due_at),
    status,
    overdue: row.overdue,
    nextAction: requiredText(row.next_action, 1000),
  });
}

export function normalizeStudentPortalNotification(
  value: unknown,
): StudentPortalNotification {
  const row = exactRecord(value, [
    "notification_id",
    "category",
    "event_code",
    "subject_label",
    "detail",
    "due_at",
    "created_at",
    "read_at",
  ]);
  const category = requiredText(row.category, 160);
  const eventCode = requiredText(row.event_code, 160);
  if (
    !NOTIFICATION_CODE_PATTERN.test(category) ||
    !NOTIFICATION_CODE_PATTERN.test(eventCode)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    notificationId: requiredUuid(row.notification_id),
    category,
    eventCode,
    subjectLabel: requiredText(row.subject_label, 300),
    detail: optionalText(row.detail, 2000),
    dueAt: optionalTimestamp(row.due_at),
    createdAt: requiredTimestamp(row.created_at),
    readAt: optionalTimestamp(row.read_at),
  });
}

function normalizeNotificationReadResult(
  value: unknown,
): StudentPortalNotificationReadResult {
  const row = exactRecord(value, ["notification_id", "is_read", "read_at"]);
  if (row.is_read !== true) return invalidShape();
  return Object.freeze({
    notificationId: requiredUuid(row.notification_id),
    isRead: true,
    readAt: requiredTimestamp(row.read_at),
  });
}

async function getPortalClient(): Promise<StudentPortalRpcClient> {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  return await createSupabaseServerClient() as unknown as StudentPortalRpcClient;
}

async function clientFor(
  dependencies: StudentPortalSourceDependencies,
): Promise<StudentPortalRpcClient> {
  return dependencies.client ?? getPortalClient();
}

async function readRpcRows<T>(
  client: StudentPortalRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  normalize: (row: unknown) => T,
  key?: (row: T) => string,
): Promise<readonly T[]> {
  const response = await client.schema("platform").rpc(
    functionName,
    args,
    { get: true },
  );
  if (response.error) return invalidShape();
  return rows(response.data, normalize, key);
}

export async function readStudentPortalOverview(
  dependencies: StudentPortalSourceDependencies = {},
): Promise<StudentPortalOverview | null> {
  try {
    const client = await clientFor(dependencies);
    const response = await client.schema("platform").rpc(
      "student_portal_overview_v2",
      {},
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > 1
    ) {
      return invalidShape();
    }
    return response.data.length === 0
      ? null
      : normalizeStudentPortalOverview(response.data[0]);
  } catch (error) {
    return failClosed(error);
  }
}

export async function readStudentPortalDocuments(
  dependencies: StudentPortalSourceDependencies = {},
): Promise<readonly StudentPortalDocument[]> {
  try {
    const client = await clientFor(dependencies);
    return await readRpcRows(
      client,
      "student_portal_documents",
      {},
      normalizeStudentPortalDocument,
      (row) => row.documentSlotId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function readStudentPortalApplications(
  dependencies: StudentPortalSourceDependencies = {},
): Promise<StudentPortalApplications> {
  try {
    const client = await clientFor(dependencies);
    const applications = await readRpcRows(
      client,
      "student_portal_applications_v2",
      {},
      normalizeApplication,
      (row) => row.applicationId,
    );
    const visas = await readRpcRows(
      client,
      "student_portal_visa_cases_v2",
      {},
      normalizeVisa,
      (row) => row.visaCaseId,
    );
    if (visas.length > 1) return invalidShape();

    const applicationRows = await Promise.all(applications.map(async (application) => {
      const timeline = await readRpcRows(
        client,
        "student_portal_application_timeline_v1",
        {
          p_application_id: application.applicationId,
          p_limit: TIMELINE_LIMIT,
        },
        normalizeApplicationTimelineEntry,
      );
      assertTimelineContinuity(timeline, application.status);
      return Object.freeze({ ...application, timeline });
    }));

    let visa: StudentPortalVisa | null = null;
    if (visas[0]) {
      const timeline = await readRpcRows(
        client,
        "student_portal_visa_timeline_v1",
        { p_visa_case_id: visas[0].visaCaseId, p_limit: TIMELINE_LIMIT },
        normalizeVisaTimelineEntry,
      );
      assertTimelineContinuity(timeline, visas[0].status);
      visa = Object.freeze({ ...visas[0], timeline });
    }

    return Object.freeze({
      applications: Object.freeze(applicationRows),
      visa,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function readStudentPortalPayments(
  dependencies: StudentPortalSourceDependencies = {},
): Promise<readonly StudentPortalPayment[]> {
  try {
    const client = await clientFor(dependencies);
    return await readRpcRows(
      client,
      "student_portal_finance_v2",
      {},
      normalizeStudentPortalPayment,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function readStudentPortalNotifications(
  dependencies: StudentPortalSourceDependencies = {},
): Promise<readonly StudentPortalNotification[]> {
  try {
    const client = await clientFor(dependencies);
    return await readRpcRows(
      client,
      "student_portal_notifications_v2",
      {},
      normalizeStudentPortalNotification,
      (row) => row.notificationId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function markStudentPortalNotificationRead(
  input: MarkStudentPortalNotificationReadInput,
  dependencies: StudentPortalSourceDependencies = {},
): Promise<StudentPortalNotificationReadResult> {
  try {
    const notificationId = requiredUuid(input.notificationId);
    const requestId = requiredUuid(input.requestId);
    const client = await clientFor(dependencies);
    const response = await client.schema("platform").rpc(
      "mark_own_student_portal_notification_read_v2",
      { p_notification_id: notificationId, p_request_id: requestId },
    );
    if (response.error) return invalidShape();
    const result = normalizeNotificationReadResult(response.data);
    return result.notificationId === notificationId ? result : invalidShape();
  } catch (error) {
    return failClosed(error);
  }
}
