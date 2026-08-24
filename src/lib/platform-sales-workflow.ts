import type { PlatformActor } from "./platform-auth";
import {
  PLATFORM_SALES_ASSIGNMENT_FILTERS,
  PLATFORM_SALES_CONNECTION_FILTERS,
  PLATFORM_SALES_DUE_FILTERS,
  PLATFORM_SALES_STAGES,
  PLATFORM_SALES_WORKFLOW_MAX_PAGE_SIZE,
  type PlatformSalesLeadPage,
  type PlatformSalesLeadPageOptions,
  type PlatformSalesLeadWorkflow,
  type PlatformSalesLeadWorkflowDetail,
  type PlatformSalesOwnerCursor,
  type PlatformSalesOwnerOption,
  type PlatformSalesOwnerPage,
  type PlatformSalesOwnerPageOptions,
  type PlatformSalesStage,
  type PlatformSalesWorkflowCursor,
  type PlatformSalesWorkflowMutationInput,
  type PlatformSalesWorkflowMutationReceipt,
} from "./platform-sales-workflow-contract.ts";

export {
  PLATFORM_SALES_ASSIGNMENT_FILTERS,
  PLATFORM_SALES_CONNECTION_FILTERS,
  PLATFORM_SALES_DUE_FILTERS,
  PLATFORM_SALES_STAGES,
  PLATFORM_SALES_WORKFLOW_MAX_PAGE_SIZE,
} from "./platform-sales-workflow-contract.ts";
export type {
  PlatformSalesAssignmentFilter,
  PlatformSalesConnectionFilter,
  PlatformSalesDueFilter,
  PlatformSalesLeadPage,
  PlatformSalesLeadPageOptions,
  PlatformSalesLeadWorkflow,
  PlatformSalesLeadWorkflowDetail,
  PlatformSalesOwnerCursor,
  PlatformSalesOwnerOption,
  PlatformSalesOwnerPage,
  PlatformSalesOwnerPageOptions,
  PlatformSalesStage,
  PlatformSalesWorkflowCursor,
  PlatformSalesWorkflowMutationInput,
  PlatformSalesWorkflowMutationReceipt,
} from "./platform-sales-workflow-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export type PlatformSalesWorkflowFailureKind =
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "no_change"
  | "unavailable";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformSalesWorkflowDependencies = Readonly<{
  client?: RpcClient;
}>;

export class PlatformSalesWorkflowRepositoryError extends Error {
  readonly kind: PlatformSalesWorkflowFailureKind;

  constructor(kind: PlatformSalesWorkflowFailureKind = "unavailable") {
    super("Platform Sales workflow is unavailable.");
    this.name = "PlatformSalesWorkflowRepositoryError";
    this.kind = kind;
  }
}

export type PlatformSalesOwnerSearchInput = Readonly<{
  query: string | null;
  cursor: PlatformSalesOwnerCursor | null;
}>;

function invalid(kind: PlatformSalesWorkflowFailureKind = "invalid"): never {
  throw new PlatformSalesWorkflowRepositoryError(kind);
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformSalesWorkflowRepositoryError) throw error;
  throw new PlatformSalesWorkflowRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlatformSalesUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

export function parsePlatformSalesOwnerSearchInput(
  value: unknown,
): PlatformSalesOwnerSearchInput | null {
  if (!isRecord(value)) return null;

  const rawQuery = value.query;
  if (rawQuery !== null && typeof rawQuery !== "string") return null;
  const query = rawQuery?.trim() || null;
  if (query !== null && query.length > 120) return null;

  const rawCursor = value.cursor;
  if (rawCursor === null) return Object.freeze({ query, cursor: null });
  if (!isRecord(rawCursor)) return null;

  const rawSortLabel = rawCursor.sortLabel;
  const membershipId = parsePlatformSalesUuid(rawCursor.membershipId);
  if (
    typeof rawSortLabel !== "string" ||
    rawSortLabel.length === 0 ||
    rawSortLabel.length > 500 ||
    rawSortLabel !== rawSortLabel.trim().toLowerCase() ||
    membershipId === null
  ) {
    return null;
  }

  return Object.freeze({
    query,
    cursor: Object.freeze({
      sortLabel: rawSortLabel,
      membershipId,
    }),
  });
}

export function classifyPlatformSalesOwnerSearchFailure(
  error: unknown,
): "invalid" | "unavailable" {
  return error instanceof PlatformSalesWorkflowRepositoryError &&
    error.kind === "invalid"
    ? "invalid"
    : "unavailable";
}

function parseOptionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parsePlatformSalesUuid(value) ?? undefined;
}

function parseTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

function timestampMicros(value: string): bigint {
  const fraction = /(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/
    .exec(value)?.[1]
    ?.padEnd(6, "0") ?? "000000";
  return BigInt(Date.parse(value)) * BigInt(1_000) + BigInt(fraction.slice(3));
}

export function parsePlatformSalesDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function parseOptionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function parseCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function parseStage(value: unknown): PlatformSalesStage | null {
  return PLATFORM_SALES_STAGES.find((stage) => stage === value) ?? null;
}

function normalizeQuery(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120) return invalid();
  return normalized;
}

function compactGetRpcArgs(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== null && value !== undefined),
  );
}

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return 24;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PLATFORM_SALES_WORKFLOW_MAX_PAGE_SIZE
  ) {
    return invalid();
  }
  return value;
}

function requireActor(actor: PlatformActor): Readonly<{
  organizationId: string;
  membershipId: string;
  role: "admin" | "sales";
}> {
  const organizationId = parsePlatformSalesUuid(actor.organizationId);
  const membershipId = parsePlatformSalesUuid(actor.membershipId);
  if (
    organizationId === null ||
    membershipId === null ||
    (actor.platformRole !== "admin" && actor.platformRole !== "sales")
  ) {
    return invalid("forbidden");
  }
  return Object.freeze({
    organizationId,
    membershipId,
    role: actor.platformRole,
  });
}

async function getClient(injected?: RpcClient): Promise<RpcClient> {
  if (injected) return injected;
  if (typeof window !== "undefined") return invalid();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as RpcClient;
}

function normalizeLead(value: unknown): PlatformSalesLeadWorkflow {
  if (!isRecord(value)) return invalid();

  const organizationId = parsePlatformSalesUuid(value.organization_id);
  const leadId = parsePlatformSalesUuid(value.lead_id);
  const clientId = parseOptionalUuid(value.client_id);
  const clientDisplayName = parseOptionalText(value.client_display_name, 500);
  const clientEmail = parseOptionalText(value.client_email, 320);
  const clientPhone = parseOptionalText(value.client_phone, 64);
  const ownerMembershipId = parseOptionalUuid(
    value.current_owner_membership_id,
  );
  const ownerDisplayName = parseOptionalText(
    value.current_owner_display_name,
    500,
  );
  const stage = parseStage(value.stage_key);
  const sourceKey =
    typeof value.source_key === "string" && SAFE_KEY_PATTERN.test(value.source_key)
      ? value.source_key
      : null;
  const nextActionText = parseOptionalText(value.next_action_text, 500);
  const nextActionDueDate =
    value.next_action_due_date === null
      ? null
      : parsePlatformSalesDate(value.next_action_due_date) ?? undefined;
  const workflowVersion = parsePositiveInteger(value.workflow_version);
  const openDuplicateCandidateCount = parseCount(
    value.open_duplicate_candidate_count,
  );
  const linkedStudentCaseCount = parseCount(value.linked_student_case_count);
  const linkedConversationCount = parseCount(value.linked_conversation_count);
  const createdAt = parseTimestamp(value.created_at);
  const updatedAt = parseTimestamp(value.updated_at);

  if (
    organizationId === null ||
    leadId === null ||
    clientId === undefined ||
    clientDisplayName === undefined ||
    clientEmail === undefined ||
    clientPhone === undefined ||
    ownerMembershipId === undefined ||
    ownerDisplayName === undefined ||
    (ownerMembershipId === null && ownerDisplayName !== null) ||
    stage === null ||
    sourceKey === null ||
    value.lifecycle_state !== "open" ||
    nextActionText === undefined ||
    nextActionDueDate === undefined ||
    (nextActionText === null) !== (nextActionDueDate === null) ||
    workflowVersion === null ||
    typeof value.is_connected !== "boolean" ||
    openDuplicateCandidateCount === null ||
    linkedStudentCaseCount === null ||
    linkedConversationCount === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return invalid();
  }

  return Object.freeze({
    organizationId,
    leadId,
    clientId,
    clientDisplayName,
    clientEmail,
    clientPhone,
    currentOwnerMembershipId: ownerMembershipId,
    currentOwnerDisplayName: ownerDisplayName,
    stage,
    sourceKey,
    lifecycleState: "open" as const,
    nextActionText,
    nextActionDueDate,
    workflowVersion,
    isConnected: value.is_connected,
    openDuplicateCandidateCount,
    linkedStudentCaseCount,
    linkedConversationCount,
    createdAt,
    updatedAt,
  });
}

export function normalizePlatformSalesLeadWorkflow(
  value: unknown,
): PlatformSalesLeadWorkflow {
  return normalizeLead(value);
}

export function normalizePlatformSalesLeadWorkflowDetail(
  value: unknown,
): PlatformSalesLeadWorkflowDetail {
  const lead = normalizeLead(value);
  if (!isRecord(value)) return invalid();
  const arrays = [
    value.external_identifiers,
    value.provenance,
    value.linked_student_cases,
    value.linked_conversations,
  ];
  if (!arrays.every(Array.isArray)) return invalid();
  return Object.freeze({
    ...lead,
    externalIdentifiers: Object.freeze([...arrays[0] as unknown[]]),
    provenance: Object.freeze([...arrays[1] as unknown[]]),
    linkedStudentCases: Object.freeze([...arrays[2] as unknown[]]),
    linkedConversations: Object.freeze([...arrays[3] as unknown[]]),
  });
}

export function parsePlatformSalesWorkflowCursor(
  updatedAt: unknown,
  leadId: unknown,
): PlatformSalesWorkflowCursor | null {
  if (updatedAt === undefined && leadId === undefined) return null;
  const parsedUpdatedAt = parseTimestamp(updatedAt);
  const parsedLeadId = parsePlatformSalesUuid(leadId);
  if (parsedUpdatedAt === null || parsedLeadId === null) return invalid();
  return Object.freeze({ updatedAt: parsedUpdatedAt, leadId: parsedLeadId });
}

export async function listPlatformSalesLeads(
  actor: PlatformActor,
  options: PlatformSalesLeadPageOptions = {},
  dependencies: PlatformSalesWorkflowDependencies = {},
): Promise<PlatformSalesLeadPage> {
  try {
    const authority = requireActor(actor);
    const pageSize = normalizePageSize(options.pageSize);
    const connection = options.connection ?? "all";
    const assignment = options.assignment ?? "all";
    const due = options.due ?? "all";
    if (
      !PLATFORM_SALES_CONNECTION_FILTERS.includes(connection) ||
      !PLATFORM_SALES_ASSIGNMENT_FILTERS.includes(assignment) ||
      !PLATFORM_SALES_DUE_FILTERS.includes(due) ||
      (options.stage !== undefined &&
        options.stage !== null &&
        !PLATFORM_SALES_STAGES.includes(options.stage))
    ) {
      return invalid();
    }
    const ownerMembershipId =
      options.ownerMembershipId === undefined ||
      options.ownerMembershipId === null
        ? null
        : parsePlatformSalesUuid(options.ownerMembershipId);
    if (
      (options.ownerMembershipId !== undefined &&
        options.ownerMembershipId !== null &&
        ownerMembershipId === null) ||
      (ownerMembershipId !== null && assignment !== "all") ||
      (authority.role === "sales" &&
        ownerMembershipId !== null &&
        ownerMembershipId !== authority.membershipId)
    ) {
      return invalid();
    }
    const query = normalizeQuery(options.query);
    const cursor = options.cursor ?? null;
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_sales_lead_page",
      compactGetRpcArgs({
        p_limit: pageSize + 1,
        p_cursor_updated_at: cursor?.updatedAt ?? null,
        p_cursor_id: cursor?.leadId ?? null,
        p_connection_filter: connection,
        p_stage_filter: options.stage ?? null,
        p_assignment_filter: assignment,
        p_owner_membership_id: ownerMembershipId,
        p_due_filter: due,
        p_query: query,
      }),
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > pageSize + 1
    ) {
      return invalid("unavailable");
    }

    const seen = new Set<string>();
    let previous: PlatformSalesWorkflowCursor | null = cursor;
    const normalized = response.data.map((raw) => {
      const row = normalizeLead(raw);
      if (row.organizationId !== authority.organizationId || seen.has(row.leadId)) {
        return invalid();
      }
      const rowCursor = Object.freeze({
        updatedAt: row.updatedAt,
        leadId: row.leadId,
      });
      if (previous !== null) {
        const timestampOrder =
          timestampMicros(previous.updatedAt) - timestampMicros(row.updatedAt);
        if (
          timestampOrder < BigInt(0) ||
          (timestampOrder === BigInt(0) && previous.leadId <= row.leadId)
        ) {
          return invalid();
        }
      }
      seen.add(row.leadId);
      previous = rowCursor;
      return Object.freeze({ row, cursor: rowCursor });
    });
    const hasNext = normalized.length > pageSize;
    const visible = normalized.slice(0, pageSize);
    return Object.freeze({
      rows: Object.freeze(visible.map((entry) => entry.row)),
      nextCursor: hasNext ? visible.at(-1)?.cursor ?? null : null,
      hasNext,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformSalesLeadDetail(
  actor: PlatformActor,
  leadIdInput: string,
  dependencies: PlatformSalesWorkflowDependencies = {},
): Promise<PlatformSalesLeadWorkflowDetail | null> {
  try {
    const authority = requireActor(actor);
    const leadId = parsePlatformSalesUuid(leadIdInput);
    if (leadId === null) return null;
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_sales_lead_detail",
      { p_lead_id: leadId },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > 1
    ) {
      return invalid("unavailable");
    }
    if (response.data.length === 0) return null;
    const detail = normalizePlatformSalesLeadWorkflowDetail(response.data[0]);
    if (
      detail.organizationId !== authority.organizationId ||
      detail.leadId !== leadId
    ) {
      return invalid();
    }
    return detail;
  } catch (error) {
    return failClosed(error);
  }
}

function normalizeOwnerOption(value: unknown): PlatformSalesOwnerOption {
  if (!isRecord(value)) return invalid();
  const membershipId = parsePlatformSalesUuid(value.membership_id);
  const displayLabel = parseOptionalText(value.display_label, 500);
  const sortLabel = parseOptionalText(value.sort_label, 500);
  if (
    membershipId === null ||
    displayLabel === null ||
    displayLabel === undefined ||
    sortLabel === null ||
    sortLabel === undefined ||
    sortLabel !== sortLabel.toLowerCase()
  ) {
    return invalid();
  }
  return Object.freeze({ membershipId, displayLabel, sortLabel });
}

export async function listPlatformSalesOwnerOptions(
  actor: PlatformActor,
  options: PlatformSalesOwnerPageOptions = {},
  dependencies: PlatformSalesWorkflowDependencies = {},
): Promise<PlatformSalesOwnerPage> {
  try {
    const authority = requireActor(actor);
    const pageSize = normalizePageSize(options.pageSize);
    const query = normalizeQuery(options.query);
    const cursor = options.cursor ?? null;
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_sales_owner_options",
      compactGetRpcArgs({
        p_limit: pageSize + 1,
        p_cursor_label: cursor?.sortLabel ?? null,
        p_cursor_id: cursor?.membershipId ?? null,
        p_query: query,
      }),
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > pageSize + 1
    ) {
      return invalid("unavailable");
    }
    const seen = new Set<string>();
    let previous = cursor;
    const normalized = response.data.map((raw) => {
      const row = normalizeOwnerOption(raw);
      if (
        seen.has(row.membershipId) ||
        (authority.role === "sales" &&
          row.membershipId !== authority.membershipId) ||
        (previous !== null &&
          (row.sortLabel < previous.sortLabel ||
            (row.sortLabel === previous.sortLabel &&
              row.membershipId <= previous.membershipId)))
      ) {
        return invalid();
      }
      seen.add(row.membershipId);
      previous = Object.freeze({
        sortLabel: row.sortLabel,
        membershipId: row.membershipId,
      });
      return Object.freeze({ row, cursor: previous });
    });
    const hasNext = normalized.length > pageSize;
    const visible = normalized.slice(0, pageSize);
    return Object.freeze({
      rows: Object.freeze(visible.map((entry) => entry.row)),
      nextCursor: hasNext ? visible.at(-1)?.cursor ?? null : null,
      hasNext,
    });
  } catch (error) {
    return failClosed(error);
  }
}

function rpcFailure(error: unknown): PlatformSalesWorkflowRepositoryError {
  if (!isRecord(error)) return new PlatformSalesWorkflowRepositoryError();
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (message.includes("workflow_version_conflict") || code === "PT409") {
    return new PlatformSalesWorkflowRepositoryError("stale");
  }
  if (message.includes("request_id_conflict")) {
    return new PlatformSalesWorkflowRepositoryError("request_conflict");
  }
  if (message.includes("workflow_no_change")) {
    return new PlatformSalesWorkflowRepositoryError("no_change");
  }
  if (
    message.includes("workflow_not_found_or_forbidden") ||
    code === "42501"
  ) {
    return new PlatformSalesWorkflowRepositoryError("forbidden");
  }
  if (
    message.includes("workflow_invalid_") ||
    message.includes("workflow_reason_required") ||
    code === "22023" ||
    code === "23514"
  ) {
    return new PlatformSalesWorkflowRepositoryError("invalid");
  }
  return new PlatformSalesWorkflowRepositoryError();
}

function normalizeMutationReceipt(
  value: unknown,
): PlatformSalesWorkflowMutationReceipt {
  if (!isRecord(value)) return invalid();
  const requestId = parsePlatformSalesUuid(value.request_id);
  const organizationId = parsePlatformSalesUuid(value.organization_id);
  const leadId = parsePlatformSalesUuid(value.lead_id);
  const stage = parseStage(value.stage_key);
  const ownerMembershipId = parseOptionalUuid(
    value.current_owner_membership_id,
  );
  const nextActionText = parseOptionalText(value.next_action_text, 500);
  const nextActionDueDate =
    value.next_action_due_date === null
      ? null
      : parsePlatformSalesDate(value.next_action_due_date) ?? undefined;
  const workflowVersion = parsePositiveInteger(value.workflow_version);
  const changedAt = parseTimestamp(value.changed_at);
  if (
    requestId === null ||
    organizationId === null ||
    leadId === null ||
    stage === null ||
    ownerMembershipId === undefined ||
    nextActionText === undefined ||
    nextActionDueDate === undefined ||
    (nextActionText === null) !== (nextActionDueDate === null) ||
    workflowVersion === null ||
    changedAt === null
  ) {
    return invalid();
  }
  return Object.freeze({
    requestId,
    organizationId,
    leadId,
    stage,
    currentOwnerMembershipId: ownerMembershipId,
    nextActionText,
    nextActionDueDate,
    workflowVersion,
    changedAt,
  });
}

export async function mutatePlatformSalesLeadWorkflow(
  actor: PlatformActor,
  input: PlatformSalesWorkflowMutationInput,
  dependencies: PlatformSalesWorkflowDependencies = {},
): Promise<PlatformSalesWorkflowMutationReceipt> {
  try {
    const authority = requireActor(actor);
    const leadId = parsePlatformSalesUuid(input.leadId);
    const requestId = parsePlatformSalesUuid(input.requestId);
    const ownerMembershipId =
      input.ownerMembershipId === null
        ? null
        : parsePlatformSalesUuid(input.ownerMembershipId);
    const actionText =
      input.nextActionText === null
        ? null
        : parseOptionalText(input.nextActionText, 500);
    const dueDate =
      input.nextActionDueDate === null
        ? null
        : parsePlatformSalesDate(input.nextActionDueDate);
    const reason =
      input.reason === null ? null : parseOptionalText(input.reason, 500);
    if (
      leadId === null ||
      requestId === null ||
      !Number.isSafeInteger(input.expectedWorkflowVersion) ||
      input.expectedWorkflowVersion < 1 ||
      !PLATFORM_SALES_STAGES.includes(input.stage) ||
      (input.ownerMembershipId !== null && ownerMembershipId === null) ||
      actionText === undefined ||
      (input.nextActionDueDate !== null && dueDate === null) ||
      reason === undefined ||
      (input.clearNextAction && (actionText !== null || dueDate !== null)) ||
      (!input.clearNextAction && (actionText === null || dueDate === null))
    ) {
      return invalid();
    }
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "mutate_sales_lead_workflow",
      {
        p_lead_id: leadId,
        p_expected_workflow_version: input.expectedWorkflowVersion,
        p_request_id: requestId,
        p_stage_key: input.stage,
        p_owner_membership_id: ownerMembershipId,
        p_next_action_text: actionText,
        p_next_action_due_date: dueDate,
        p_clear_next_action: input.clearNextAction,
        p_reason: reason,
      },
    );
    if (response.error) throw rpcFailure(response.error);
    const receipt = normalizeMutationReceipt(response.data);
    if (
      receipt.requestId !== requestId ||
      receipt.organizationId !== authority.organizationId ||
      receipt.leadId !== leadId
    ) {
      return invalid();
    }
    return receipt;
  } catch (error) {
    return failClosed(error);
  }
}
