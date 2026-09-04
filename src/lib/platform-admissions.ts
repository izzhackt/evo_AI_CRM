import type { PlatformActor } from "./platform-auth";
import {
  isPlatformApplicationCalendarDate,
  PLATFORM_APPLICATION_STATUSES,
  type PlatformApplicationQueueRow,
  type PlatformApplicationStatus,
} from "./platform-application-contract.ts";

export {
  PLATFORM_APPLICATION_EVIDENCE_STATUSES,
  PLATFORM_APPLICATION_STATUSES,
} from "./platform-application-contract.ts";
export type {
  PlatformApplicationQueueRow,
  PlatformApplicationStatus,
} from "./platform-application-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const JSON_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform admissions data is unavailable.";
const POSTGRES_BIGINT_MAX = "9223372036854775807";

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalidShape();
  return value;
}

function optionalDate(value: unknown): string | null {
  if (value === null) return null;
  return isPlatformApplicationCalendarDate(value) ? value : invalidShape();
}

export type PlatformStudentCaseState = "pending" | "active" | "closed";
export type PlatformRouteApprovalStatus = "draft" | "approved" | "rework";

export function buildPlatformAdmissionsRedirectUrl(
  path: string,
  outcome: "saved" | "invalid" | "unavailable",
  retryRequestId?: string | null,
  anchor?: "case-lifecycle" | "applications",
): string {
  const params = new URLSearchParams({ result: outcome });
  if (retryRequestId) params.set("retry_request_id", retryRequestId);
  return `${path}?${params.toString()}${anchor ? `#${anchor}` : ""}`;
}

export type PlatformOpWorkflowContract = Readonly<{
  organizationId: string;
  workflowContractId: string;
  workflowContractVersionId: string;
  contractKey: "wf_op";
  workflowKind: "op";
  version: number;
  status: "approved";
  stageKeys: readonly string[];
  followUpOutcomeKeys: readonly string[];
  closureResultKeys: readonly string[];
  terminalStageKeys: readonly string[];
  approvedAt: string;
  createdAt: string;
}>;

export type PlatformStudentCaseQueueRow = Readonly<{
  organizationId: string;
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  targetDegree: string | null;
  programDirection: string | null;
  intake: string | null;
  languageAssumption: string | null;
  fundingAssumption: string | null;
  routeApprovalStatus: PlatformRouteApprovalStatus;
  operationalStage: string;
  state: PlatformStudentCaseState;
  createdAt: string;
  updatedAt: string;
  handoffAt: string | null;
  nextAction: string | null;
  responsibleSalesDisplayName: string;
  currentCuratorDisplayName: string | null;
  appliedOzoWorkflowContractVersionId: string | null;
  overdueTaskCount: number;
  overdueObligationCount: number;
  rejectedDocumentCount: number;
}>;

export type PlatformStudentCaseSnapshot = PlatformStudentCaseQueueRow &
  Readonly<{
    handoff: Readonly<{
      studentCaseOpHandoffId: string;
      opWorkflowContractVersionId: string;
      approvedCommercialFields: Readonly<
        Record<string, string | number | boolean | null>
      >;
      unresolvedQuestions: readonly string[];
      promises: readonly string[];
      nextStep: string;
      dueAt: string;
      responsibleRole: "admin" | "sales" | "admissions";
      createdAt: string;
    }> | null;
  }>;

export type PlatformSalesHandoffSummary = Readonly<{
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  targetDegree: string | null;
  state: "active" | "closed";
  assignedCuratorDisplayName: string;
  handoffAt: string;
}>;

export type PlatformStudentCaseView =
  | Readonly<{ access: "full"; studentCase: PlatformStudentCaseSnapshot }>
  | Readonly<{
      access: "sales_summary";
      studentCase: PlatformSalesHandoffSummary;
    }>;

export type PlatformStudentCasePageItem =
  | Readonly<{
      access: "full";
      studentCase: PlatformStudentCaseQueueRow;
    }>
  | Readonly<{
      access: "sales_summary";
      studentCase: PlatformSalesHandoffSummary;
    }>;

export type PlatformStudentCaseLeadLink = Readonly<{
  studentCaseId: string;
  leadId: string;
}>;

export type PlatformAdmissionsCursor = Readonly<{
  sortAt: string;
  id: string;
}>;

export type PlatformPageSlice<T> = Readonly<{
  rows: readonly T[];
  nextCursor: PlatformAdmissionsCursor | null;
  hasNext: boolean;
}>;

export type PlatformStudentCasePageOptions = Readonly<{
  cursor?: PlatformAdmissionsCursor | null;
  pageSize?: number;
  query?: string;
  state?: PlatformStudentCaseState;
}>;

export type PlatformApplicationPageOptions = Readonly<{
  cursor?: PlatformAdmissionsCursor | null;
  pageSize?: number;
  status?: PlatformApplicationStatus;
  studentCaseId?: string;
}>;

export class PlatformAdmissionsRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformAdmissionsRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformAdmissionsRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAdmissionsRepositoryError) throw error;
  return invalidShape();
}

function normalizePageSize(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value && value > 0 && value <= 100
    ? value
    : fallback;
}

export function parsePlatformAdmissionsCursor(
  sortAt: unknown,
  id: unknown,
): PlatformAdmissionsCursor | null {
  const parsedSortAt =
    typeof sortAt === "string" &&
    TIMESTAMPTZ_PATTERN.test(sortAt) &&
    Number.isFinite(Date.parse(sortAt))
      ? sortAt
      : null;
  const parsedId = parsePlatformAdmissionsUuid(id);
  return parsedSortAt && parsedId
    ? Object.freeze({ sortAt: parsedSortAt, id: parsedId })
    : null;
}

export function compactPlatformAdmissionsGetRpcArguments(
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlatformAdmissionsUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformAdmissionsUuid(value) ?? invalidShape();
}

export function summarizePlatformStudentCaseApplicationPreview(
  applications: readonly Readonly<{ status: PlatformApplicationStatus }>[],
  hasMore: boolean,
  studentCaseId: string,
): Readonly<{
  activeApplications: number;
  preview: Readonly<{
    visibleCount: number;
    hasMore: boolean;
    fullListHref: string;
  }>;
}> {
  const normalizedStudentCaseId = requiredUuid(studentCaseId);
  const activeApplications = applications.filter(
    (application) =>
      application.status !== "rejected" &&
      application.status !== "withdrawn" &&
      application.status !== "closed",
  ).length;
  return Object.freeze({
    activeApplications,
    preview: Object.freeze({
      visibleCount: applications.length,
      hasMore,
      fullListHref:
        `/applications?student_case_id=${normalizedStudentCaseId}`,
    }),
  });
}

function optionalUuid(value: unknown): string | null {
  if (value === null) return null;
  return requiredUuid(value);
}

function requiredText(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(value: unknown, maxLength = 500): string | null {
  return value === null ? null : requiredText(value, maxLength);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function nonNegativeCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) return invalidShape();
  return parsed;
}

function positiveInteger(value: unknown): number {
  const parsed = nonNegativeCount(value);
  return parsed > 0 ? parsed : invalidShape();
}

function positiveBigint(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value > POSTGRES_BIGINT_MAX)
  ) {
    return invalidShape();
  }
  return value;
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

function workflowKeys(value: unknown, allowEmpty: boolean): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    return invalidShape();
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      typeof item !== "string" ||
      !WORKFLOW_KEY_PATTERN.test(item) ||
      seen.has(item)
    ) {
      return invalidShape();
    }
    seen.add(item);
    return item;
  });
}

function boundedScalarObject(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (
    !isRecord(value) ||
    Object.keys(value).length > 32 ||
    new TextEncoder().encode(JSON.stringify(value)).length > 8192
  ) {
    return invalidShape();
  }
  const normalized: Record<string, string | number | boolean | null> = {};
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
      new TextEncoder().encode(JSON.stringify(item)).length > 1024 ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      return invalidShape();
    }
    normalized[key] = item;
  }
  return normalized;
}

function boundedTextArray(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    new TextEncoder().encode(JSON.stringify(value)).length > 8192
  ) {
    return invalidShape();
  }
  return value.map((item) => requiredText(item, 1000));
}

function requireAdmissionsOrganization(actor: PlatformActor): string {
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !== "sales" &&
    actor.platformRole !== "admissions"
  ) {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export function normalizePlatformOpWorkflowContract(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformOpWorkflowContract {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalidShape();
  }
  const contractKey = oneOf(value.contract_key, ["wf_op"] as const);
  const workflowKind = oneOf(value.workflow_kind, ["op"] as const);
  const status = oneOf(value.status, ["approved"] as const);
  return {
    organizationId,
    workflowContractId: requiredUuid(value.workflow_contract_id),
    workflowContractVersionId: requiredUuid(value.workflow_contract_version_id),
    contractKey,
    workflowKind,
    version: positiveInteger(value.version),
    status,
    stageKeys: workflowKeys(value.stage_keys, false),
    followUpOutcomeKeys: workflowKeys(value.follow_up_outcome_keys, true),
    closureResultKeys: workflowKeys(value.closure_result_keys, true),
    terminalStageKeys: workflowKeys(value.terminal_stage_keys, true),
    approvedAt: requiredTimestamp(value.approved_at),
    createdAt: requiredTimestamp(value.created_at),
  };
}

export function normalizePlatformStudentCaseQueueRow(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformStudentCaseQueueRow {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalidShape();
  }
  return {
    organizationId,
    studentCaseId: requiredUuid(value.student_case_id),
    studentDisplayName: requiredText(value.student_display_name, 200),
    targetCountry: optionalText(value.target_country, 200),
    targetDegree: optionalText(value.target_degree, 200),
    programDirection: optionalText(value.program_direction, 300),
    intake: optionalText(value.intake, 200),
    languageAssumption: optionalText(value.language_assumption, 200),
    fundingAssumption: optionalText(value.funding_assumption, 300),
    routeApprovalStatus: oneOf(value.route_approval_status, [
      "draft",
      "approved",
      "rework",
    ] as const),
    operationalStage: requiredText(value.operational_stage, 200),
    state: oneOf(value.state, ["pending", "active", "closed"] as const),
    createdAt: requiredTimestamp(value.created_at),
    updatedAt: requiredTimestamp(value.updated_at),
    handoffAt: optionalTimestamp(value.handoff_at),
    nextAction: optionalText(value.next_action, 1000),
    responsibleSalesDisplayName: requiredText(
      value.responsible_sales_display_name,
      200,
    ),
    currentCuratorDisplayName: optionalText(
      value.current_curator_display_name,
      200,
    ),
    appliedOzoWorkflowContractVersionId: optionalUuid(
      value.applied_ozo_workflow_contract_version_id,
    ),
    overdueTaskCount: nonNegativeCount(value.overdue_task_count),
    overdueObligationCount: nonNegativeCount(value.overdue_obligation_count),
    rejectedDocumentCount: nonNegativeCount(value.rejected_document_count),
  };
}

export function normalizePlatformStudentCaseSnapshot(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformStudentCaseSnapshot {
  if (!isRecord(value)) return invalidShape();
  const rawHandoffValues = [
    value.student_case_op_handoff_id,
    value.op_workflow_contract_version_id,
    value.approved_commercial_fields,
    value.unresolved_questions,
    value.promises,
    value.handoff_next_step,
    value.handoff_due_at,
    value.handoff_responsible_role,
    value.handoff_created_at,
  ];
  const emptyHandoff = rawHandoffValues.every((item) => item === null);
  if (!emptyHandoff && rawHandoffValues.some((item) => item === null)) {
    return invalidShape();
  }
  return {
    ...normalizePlatformStudentCaseQueueRow(value, expectedOrganizationId),
    handoff: emptyHandoff
      ? null
      : {
          studentCaseOpHandoffId: requiredUuid(
            value.student_case_op_handoff_id,
          ),
          opWorkflowContractVersionId: requiredUuid(
            value.op_workflow_contract_version_id,
          ),
          approvedCommercialFields: boundedScalarObject(
            value.approved_commercial_fields,
          ),
          unresolvedQuestions: boundedTextArray(value.unresolved_questions),
          promises: boundedTextArray(value.promises),
          nextStep: requiredText(value.handoff_next_step, 1000),
          dueAt: requiredTimestamp(value.handoff_due_at),
          responsibleRole: oneOf(value.handoff_responsible_role, [
            "admin",
            "sales",
            "admissions",
          ] as const),
          createdAt: requiredTimestamp(value.handoff_created_at),
        },
  };
}

export function normalizePlatformSalesHandoffSummary(
  value: unknown,
): PlatformSalesHandoffSummary {
  if (!isRecord(value)) return invalidShape();
  return {
    studentCaseId: requiredUuid(value.case_id),
    studentDisplayName: requiredText(value.student_display_name, 200),
    targetCountry: optionalText(value.target_country, 200),
    targetDegree: optionalText(value.target_degree, 200),
    state: oneOf(value.case_state, ["active", "closed"] as const),
    assignedCuratorDisplayName: requiredText(
      value.assigned_curator_display_name,
      200,
    ),
    handoffAt: requiredTimestamp(value.handoff_at),
  };
}

export function normalizePlatformStudentCaseLeadLink(
  value: unknown,
): PlatformStudentCaseLeadLink {
  if (!isRecord(value)) return invalidShape();
  return {
    studentCaseId: requiredUuid(value.student_case_id),
    leadId: requiredUuid(value.lead_id),
  };
}

export function normalizePlatformApplicationQueueRow(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformApplicationQueueRow {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalidShape();
  }
  return {
    organizationId,
    universityApplicationId: requiredUuid(value.university_application_id),
    version: positiveBigint(value.version),
    studentCaseId: requiredUuid(value.student_case_id),
    studentDisplayName: requiredText(value.student_display_name, 200),
    targetCountry: optionalText(value.target_country, 200),
    targetDegree: optionalText(value.target_degree, 200),
    programDirection: optionalText(value.program_direction, 300),
    intake: optionalText(value.intake, 200),
    institutionName: requiredText(value.institution_name, 300),
    programName: requiredText(value.program_name, 300),
    isPrimary: requiredBoolean(value.is_primary),
    universityDeadlineOn: optionalDate(value.university_deadline_on),
    status: oneOf(value.status, PLATFORM_APPLICATION_STATUSES),
    latestEvidenceReference: optionalText(
      value.latest_evidence_reference,
      1000,
    ),
    createdAt: requiredTimestamp(value.created_at),
    updatedAt: requiredTimestamp(value.updated_at),
    responsibleSalesDisplayName: requiredText(
      value.responsible_sales_display_name,
      200,
    ),
    currentCuratorDisplayName: optionalText(
      value.current_curator_display_name,
      200,
    ),
    documentCount: nonNegativeCount(value.document_count),
    openDocumentCount: nonNegativeCount(value.open_document_count),
    taskCount: nonNegativeCount(value.task_count),
    openTaskCount: nonNegativeCount(value.open_task_count),
    paymentObligationCount: nonNegativeCount(
      value.payment_obligation_count,
    ),
    outstandingPaymentObligationCount: nonNegativeCount(
      value.outstanding_payment_obligation_count,
    ),
  };
}

function normalizeRows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  key: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value)) return invalidShape();
  const seen = new Set<string>();
  return value.map((raw) => {
    const row = normalize(raw);
    const id = key(row);
    if (seen.has(id)) return invalidShape();
    seen.add(id);
    return row;
  });
}

export async function getPlatformOpWorkflowContract(
  actor: PlatformActor,
): Promise<PlatformOpWorkflowContract | null> {
  try {
    const organizationId = requireAdmissionsOrganization(actor);
    if (actor.platformRole !== "admin" && actor.platformRole !== "sales") {
      return invalidShape();
    }
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("staff_op_workflow_contract", undefined, { get: true });
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalidShape();
    return normalizePlatformOpWorkflowContract(
      response.data[0],
      organizationId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformStudentCases(
  actor: PlatformActor,
  options?: PlatformStudentCasePageOptions,
): Promise<PlatformPageSlice<PlatformStudentCasePageItem>> {
  try {
    const organizationId = requireAdmissionsOrganization(actor);
    const client = await getPlatformClient();
    const pageSize = normalizePageSize(options?.pageSize, 50);
    const cursor = options?.cursor ?? null;
    const response = await client.schema("platform").rpc(
      "staff_student_case_page",
      compactPlatformAdmissionsGetRpcArguments({
        p_limit: pageSize + 1,
        p_before_sort_at: cursor?.sortAt ?? null,
        p_before_student_case_id: cursor?.id ?? null,
        p_state: options?.state ?? null,
        p_query: options?.query?.trim() || null,
        p_student_case_id: null,
      }),
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();

    const seenIds = new Set<string>();
    const normalized = response.data.map((raw) => {
      if (!isRecord(raw)) return invalidShape();
      const rowCursor = parsePlatformAdmissionsCursor(
        raw.sort_at,
        raw.student_case_id,
      );
      if (rowCursor === null || seenIds.has(rowCursor.id)) return invalidShape();
      seenIds.add(rowCursor.id);

      if (raw.access_mode === "full") {
        return Object.freeze({
          access: "full" as const,
          cursor: rowCursor,
          row: normalizePlatformStudentCaseQueueRow(raw, organizationId),
        });
      }
      if (raw.access_mode === "sales_summary") {
        return Object.freeze({
          access: "sales_summary" as const,
          cursor: rowCursor,
          row: normalizePlatformSalesHandoffSummary({
            case_id: raw.student_case_id,
            student_display_name: raw.student_display_name,
            target_country: raw.target_country,
            target_degree: raw.target_degree,
            case_state: raw.state,
            assigned_curator_display_name: raw.current_curator_display_name,
            handoff_at: raw.handoff_at,
          }),
        });
      }
      return invalidShape();
    });
    const hasNext = normalized.length > pageSize;
    const page = normalized.slice(0, pageSize);
    const nextCursor = hasNext ? page.at(-1)?.cursor ?? null : null;
    return {
      rows: page.map((entry): PlatformStudentCasePageItem =>
        entry.access === "full"
          ? Object.freeze({ access: "full", studentCase: entry.row })
          : Object.freeze({ access: "sales_summary", studentCase: entry.row })),
      nextCursor,
      hasNext,
    };
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformStudentCaseLeadLinks(
  actor: PlatformActor,
  studentCaseIds: readonly string[],
): Promise<readonly PlatformStudentCaseLeadLink[]> {
  try {
    const organizationId = requireAdmissionsOrganization(actor);
    if (studentCaseIds.length === 0) return [];
    if (studentCaseIds.length > 100) return invalidShape();

    const normalizedIds = studentCaseIds.map(requiredUuid);
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      return invalidShape();
    }

    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_student_case_sales_links",
      {
        p_organization_id: organizationId,
        p_student_case_ids: normalizedIds,
      },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();

    const requestedIds = new Set(normalizedIds);
    const seenIds = new Set<string>();
    return response.data.map((raw) => {
      const link = normalizePlatformStudentCaseLeadLink(raw);
      if (
        !requestedIds.has(link.studentCaseId) ||
        seenIds.has(link.studentCaseId)
      ) {
        return invalidShape();
      }
      seenIds.add(link.studentCaseId);
      return Object.freeze(link);
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformStudentCaseView(
  actor: PlatformActor,
  id: string,
): Promise<PlatformStudentCaseView | null> {
  try {
    const organizationId = requireAdmissionsOrganization(actor);
    const studentCaseId = parsePlatformAdmissionsUuid(id);
    if (studentCaseId === null) return null;
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc(
        "staff_student_case_read_snapshot",
        { p_student_case_id: studentCaseId },
        { get: true },
      );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1 || !isRecord(response.data[0])) {
      return invalidShape();
    }
    const row = response.data[0];
    if (row.access_mode === "full") {
      return {
        access: "full",
        studentCase: normalizePlatformStudentCaseSnapshot(
          row,
          organizationId,
        ),
      };
    }
    if (row.access_mode !== "sales_summary") return invalidShape();
    return {
      access: "sales_summary",
      studentCase: normalizePlatformSalesHandoffSummary({
        case_id: row.student_case_id,
        student_display_name: row.student_display_name,
        target_country: row.target_country,
        target_degree: row.target_degree,
        case_state: row.state,
        assigned_curator_display_name: row.current_curator_display_name,
        handoff_at: row.handoff_at,
      }),
    };
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformApplications(
  actor: PlatformActor,
  options?: PlatformApplicationPageOptions,
): Promise<PlatformPageSlice<PlatformApplicationQueueRow>> {
  try {
    const organizationId = requireAdmissionsOrganization(actor);
    const studentCaseId = options?.studentCaseId
      ? parsePlatformAdmissionsUuid(options.studentCaseId)
      : null;
    if (options?.studentCaseId && studentCaseId === null) return invalidShape();
    const client = await getPlatformClient();
    const pageSize = normalizePageSize(options?.pageSize, 50);
    const cursor = options?.cursor ?? null;
    const response = await client.schema("platform").rpc(
      "staff_application_page",
      compactPlatformAdmissionsGetRpcArguments({
        p_limit: pageSize + 1,
        p_before_updated_at: cursor?.sortAt ?? null,
        p_before_application_id: cursor?.id ?? null,
        p_status: options?.status ?? null,
        p_student_case_id: studentCaseId,
        p_application_id: null,
      }),
      { get: true },
    );
    if (response.error) return invalidShape();
    const rows = normalizeRows(
      response.data,
      (row) => normalizePlatformApplicationQueueRow(row, organizationId),
      (row) => row.universityApplicationId,
    );
    const hasNext = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor: hasNext && last
        ? Object.freeze({ sortAt: last.updatedAt, id: last.universityApplicationId })
        : null,
      hasNext,
    };
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformApplicationsForStudentCase(
  actor: PlatformActor,
  studentCaseId: string,
  options?: Omit<PlatformApplicationPageOptions, "studentCaseId">,
): Promise<PlatformPageSlice<PlatformApplicationQueueRow>> {
  return listPlatformApplications(actor, { ...options, studentCaseId });
}

export async function getPlatformApplication(
  actor: PlatformActor,
  id: string,
): Promise<PlatformApplicationQueueRow | null> {
  try {
    const organizationId = requireAdmissionsOrganization(actor);
    const universityApplicationId = parsePlatformAdmissionsUuid(id);
    if (universityApplicationId === null) return null;
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc(
        "staff_application_snapshot",
        { p_university_application_id: universityApplicationId },
        { get: true },
      );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalidShape();
    return normalizePlatformApplicationQueueRow(
      response.data[0],
      organizationId,
    );
  } catch (error) {
    return failClosed(error);
  }
}
