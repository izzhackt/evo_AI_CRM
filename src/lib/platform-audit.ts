import type { PlatformAuditCsvRow } from "./platform-audit-csv.ts";

export const PLATFORM_AUDIT_MAX_PAGE_SIZE = 100;
export const PLATFORM_AUDIT_DEFAULT_PAGE_SIZE = 50;
export const PLATFORM_AUDIT_MAX_FILTER_VALUES = 32;
export const PLATFORM_AUDIT_MAX_EXPORT_ROWS = 5_000;
export const PLATFORM_AUDIT_MAX_EXPORT_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;

// These projection allowlists intentionally mirror migration 071. Expanding
// either side is a reviewed contract change; unknown values fail closed.
export const PLATFORM_AUDIT_ACTIONS = [
  "ai.control.set",
  "ai.draft.generate",
  "ai.draft.language.resolve",
  "ai.draft.record",
  "ai.draft.request",
  "ai.draft.request.knowledge",
  "ai.draft.review",
  "ai.fact.record",
  "ai.memory.record",
  "ai.qualification.record",
  "ai.retrieval.preview",
  "application.create",
  "application.status.change",
  "audit.export",
  "autonomous.reply.control.set",
  "case.create",
  "case.curator.set",
  "case.handoff.create",
  "case.lifecycle.change",
  "case.route.change",
  "case.update.append",
  "catalog.import.batch.create",
  "catalog.import.batch.review",
  "catalog.import.batch.validate",
  "catalog.import.candidate.stage",
  "communication.conversation.create",
  "communication.conversation.link",
  "communication.manual.authorize",
  "communication.manual.send",
  "communication.manual.send.request",
  "communication.message.record",
  "communication.participant.record",
  "communication.provider.observe",
  "communication.waha.history.begin",
  "communication.waha.history.complete",
  "communication.waha.history.pause",
  "communication.waha.history.project",
  "communication.waha.project",
  "communication.waha.project.retry",
  "contract.draft.generate",
  "contract.draft.review",
  "contract.template.version.approve",
  "contract.template.version.create",
  "contract.template.version.retire",
  "country.requirement.apply",
  "country.requirement.source.link",
  "country.requirement.version.approve",
  "country.requirement.version.create",
  "country.requirement.version.retire",
  "decision.backlog.create",
  "decision.backlog.transition",
  "document.download.grant",
  "document.download.sign.authorize",
  "document.requirement.create",
  "document.requirement.retire",
  "document.slot.create",
  "document.upload.finalize",
  "document.upload.reserve",
  "document.validation.attest",
  "document.version.record",
  "document.version.review",
  "finance.obligation.create",
  "finance.payment.record",
  "finance.stop.create",
  "finance.stop.resolve",
  "knowledge.chunkset.publish",
  "knowledge.version.publish",
  "knowledge.version.retire",
  "membership.provision",
  "membership.role.change",
  "membership.scope.organization.assign",
  "membership.scope.organization.revoke",
  "membership.status.change",
  "messaging.integration.health.record",
  "notification.consent.set",
  "notification.create",
  "notification.read",
  "organization.bootstrap",
  "post.contract.item.update",
  "post.contract.items.seed",
  "post.contract.report.generate",
  "post.contract.report.review",
  "rbac.bundle.upgrade",
  "student.profile.upsert",
  "task.change",
  "task.create",
  "visa.create",
  "visa.status.change",
  "workflow.contract.create",
  "workflow.source.link",
  "workflow.source.register",
  "workflow.source.retire",
  "workflow.source.review",
  "workflow.version.approve",
  "workflow.version.create",
  "workflow.version.retire",
] as const;

export const PLATFORM_AUDIT_RESOURCE_TYPES = [
  "ai_draft",
  "ai_draft_request",
  "ai_draft_request_knowledge_selection",
  "ai_retrieval_request",
  "approved_knowledge_chunk_set",
  "approved_knowledge_version",
  "audit_export",
  "case_task",
  "catalog_import_batch",
  "catalog_import_candidate",
  "communication_conversation",
  "communication_message",
  "contract_template_version",
  "conversation_ai_control",
  "conversation_ai_fact",
  "conversation_ai_memory",
  "conversation_ai_qualification",
  "conversation_participant",
  "country_requirement_version",
  "country_requirement_version_source",
  "decision_backlog",
  "document_requirement",
  "document_slot",
  "document_version",
  "durable_work_item",
  "manual_send_authorization",
  "messaging_integration_health_event",
  "notification",
  "notification_consent",
  "organization",
  "organization_membership",
  "payment_event",
  "payment_obligation",
  "post_contract_item",
  "post_contract_item_set",
  "post_contract_report",
  "provider_reconciliation_event",
  "source_registry",
  "stop_factor",
  "student_case",
  "student_case_contract_draft",
  "student_case_update",
  "student_profile",
  "university_application",
  "visa_case",
  "waha_history_reconciliation_run",
  "workflow_contract",
  "workflow_contract_version",
  "workflow_contract_version_source",
] as const;

export const PLATFORM_AUDIT_REASON_CODES = [
  "audit_export_requested",
  "restricted",
] as const;

export const PLATFORM_AUDIT_CHANGED_FIELD_CODES = [
  "access_version",
  "actor_role",
  "ai_control",
  "ai_status",
  "assignment",
  "case_assignment",
  "case_lifecycle",
  "case_route",
  "case_status",
  "communication_status",
  "consent_status",
  "document_status",
  "export_filters",
  "export_row_count",
  "export_row_set_sha256",
  "finance_status",
  "notification_status",
  "record_status",
  "review_status",
  "work_status",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];
export type PlatformAuditResourceType =
  (typeof PLATFORM_AUDIT_RESOURCE_TYPES)[number];
export type PlatformAuditReasonCode =
  (typeof PLATFORM_AUDIT_REASON_CODES)[number];
export type PlatformAuditChangedFieldCode =
  (typeof PLATFORM_AUDIT_CHANGED_FIELD_CODES)[number];
export type PlatformAuditActorKind = "user" | "service" | "system";

export type PlatformAuditFilters = Readonly<{
  startAt: string | null;
  endAt: string | null;
  actions: readonly PlatformAuditAction[] | null;
  resourceTypes: readonly PlatformAuditResourceType[] | null;
  resourceId: string | null;
}>;

export type PlatformAuditSearchInput = PlatformAuditFilters &
  Readonly<{
    pageSize: number;
    snapshotCreatedAt: string | null;
    snapshotId: string | null;
    cursorCreatedAt: string | null;
    cursorId: string | null;
  }>;

export type PlatformAuditExportInput = PlatformAuditFilters &
  Readonly<{
    requestId: string;
    startAt: string;
    endAt: string;
    snapshotCreatedAt: string | null;
    snapshotId: string | null;
  }>;

export type PlatformAuditSafeRow = PlatformAuditCsvRow &
  Readonly<{
    action: PlatformAuditAction;
    resourceType: PlatformAuditResourceType;
    actorKind: PlatformAuditActorKind;
    actorDisplayLabel: "Staff" | "Service" | "System";
    reasonCode: PlatformAuditReasonCode;
    changedFieldCodes: readonly PlatformAuditChangedFieldCode[];
  }>;

export type PlatformAuditSearchResult = Readonly<{
  filters: PlatformAuditFilters;
  snapshotCreatedAt: string | null;
  snapshotId: string | null;
  nextCursorCreatedAt: string | null;
  nextCursorId: string | null;
  hasMore: boolean;
  rows: readonly PlatformAuditSafeRow[];
}>;

export type PlatformAuditExportResult = Readonly<{
  requestId: string;
  filters: PlatformAuditFilters & Readonly<{ startAt: string; endAt: string }>;
  snapshotCreatedAt: string | null;
  snapshotId: string | null;
  rowCount: number;
  rowSetSha256: string;
  rows: readonly PlatformAuditSafeRow[];
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const SEARCH_INPUT_KEYS = [
  "start_at",
  "end_at",
  "actions",
  "resource_types",
  "resource_id",
  "page_size",
  "snapshot_created_at",
  "snapshot_id",
  "cursor_created_at",
  "cursor_id",
] as const;
const EXPORT_INPUT_KEYS = [
  "request_id",
  "start_at",
  "end_at",
  "actions",
  "resource_types",
  "resource_id",
  "snapshot_created_at",
  "snapshot_id",
] as const;
const FILTER_KEYS = [
  "start_at",
  "end_at",
  "actions",
  "resource_types",
  "resource_id",
] as const;
const SEARCH_RESULT_KEYS = [
  "filters",
  "snapshot_created_at",
  "snapshot_id",
  "next_cursor_created_at",
  "next_cursor_id",
  "has_more",
  "rows",
] as const;
const EXPORT_RESULT_KEYS = [
  "request_id",
  "filters",
  "snapshot_created_at",
  "snapshot_id",
  "row_count",
  "row_set_sha256",
  "rows",
] as const;
const SAFE_ROW_KEYS = [
  "audit_event_id",
  "created_at",
  "action",
  "resource_type",
  "resource_id",
  "actor_kind",
  "actor_display_label",
  "request_id",
  "reason_code",
  "changed_field_codes",
] as const;

export class PlatformAuditContractError extends Error {
  constructor() {
    super("Invalid Platform audit contract");
    this.name = "PlatformAuditContractError";
  }
}

function invalid(): never {
  throw new PlatformAuditContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function optionalInputText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value !== value.trim()) invalid();
  return value;
}

function parseUuid(value: unknown, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === "")) {
    return null;
  }
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) invalid();
  return normalized;
}

function parseUtcTimestamp(value: unknown, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === "")) {
    return null;
  }
  if (typeof value !== "string") invalid();
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) invalid();
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  if (year < 1 || second > 59) invalid();
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    invalid();
  }
  const rawFraction = match[7] ?? "000";
  // Keep PostgreSQL's full microsecond representation. Trimming significant
  // positions (including trailing zeroes) would make the browser cursor differ
  // from the exact snapshot/cursor token emitted by the RPC.
  const fraction = rawFraction.padEnd(6, "0");
  return `${value.slice(0, 19)}.${fraction}Z`;
}

function timestampMicros(value: string): bigint {
  const dot = value.indexOf(".");
  const fraction = value.slice(dot + 1, -1).padEnd(6, "0");
  const milliseconds = Date.parse(`${value.slice(0, dot)}.${fraction.slice(0, 3)}Z`);
  return BigInt(milliseconds) * BigInt(1_000) + BigInt(fraction.slice(3));
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
  return value as T;
}

function parseBoundedAsciiEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maxLength: number,
): T {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    !/^[\x20-\x7e]+$/u.test(value)
  ) {
    invalid();
  }
  return parseEnum(value, allowed);
}

function parseCanonicalOutputList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  nullable: boolean,
): readonly T[] | null {
  if (nullable && value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > PLATFORM_AUDIT_MAX_FILTER_VALUES) {
    invalid();
  }
  const parsed = value.map((item) => parseEnum(item, allowed));
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    invalid();
  }
  return canonical;
}

function parseInputList<T extends string>(
  value: unknown,
  allowed: readonly T[],
): readonly T[] | null {
  const text = optionalInputText(value);
  if (text === null) return null;
  if (text.length > 2_048) invalid();
  const values = text.split(",");
  if (
    values.length === 0 ||
    values.length > PLATFORM_AUDIT_MAX_FILTER_VALUES ||
    values.some((item) => item.length === 0 || item !== item.trim())
  ) {
    invalid();
  }
  return [...new Set(values.map((item) => parseEnum(item, allowed)))].sort();
}

function requirePair<T, U>(
  left: T | null,
  right: U | null,
): asserts left is T {
  if ((left === null) !== (right === null)) invalid();
}

function parseInputFilters(
  value: Record<string, unknown>,
): PlatformAuditFilters {
  const startAt = parseUtcTimestamp(value.start_at, true);
  const endAt = parseUtcTimestamp(value.end_at, true);
  if (
    startAt !== null &&
    endAt !== null &&
    timestampMicros(startAt) >= timestampMicros(endAt)
  ) {
    invalid();
  }
  return {
    startAt,
    endAt,
    actions: parseInputList(value.actions, PLATFORM_AUDIT_ACTIONS),
    resourceTypes: parseInputList(
      value.resource_types,
      PLATFORM_AUDIT_RESOURCE_TYPES,
    ),
    resourceId: parseUuid(value.resource_id, true),
  };
}

function parseOutputFilters(value: unknown): PlatformAuditFilters {
  if (!isRecord(value) || !hasExactKeys(value, FILTER_KEYS)) invalid();
  const startAt = parseUtcTimestamp(value.start_at, true);
  const endAt = parseUtcTimestamp(value.end_at, true);
  if (
    startAt !== null &&
    endAt !== null &&
    timestampMicros(startAt) >= timestampMicros(endAt)
  ) {
    invalid();
  }
  return {
    startAt,
    endAt,
    actions: parseCanonicalOutputList(
      value.actions,
      PLATFORM_AUDIT_ACTIONS,
      true,
    ),
    resourceTypes: parseCanonicalOutputList(
      value.resource_types,
      PLATFORM_AUDIT_RESOURCE_TYPES,
      true,
    ),
    resourceId: parseUuid(value.resource_id, true),
  };
}

export function normalizePlatformAuditSearchInput(
  value: unknown,
): PlatformAuditSearchInput {
  if (!isRecord(value) || !hasOnlyKeys(value, SEARCH_INPUT_KEYS)) invalid();
  const filters = parseInputFilters(value);
  const pageSizeText = optionalInputText(value.page_size);
  const pageSize = pageSizeText === null
    ? PLATFORM_AUDIT_DEFAULT_PAGE_SIZE
    : Number(pageSizeText);
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PLATFORM_AUDIT_MAX_PAGE_SIZE ||
    (pageSizeText !== null && String(pageSize) !== pageSizeText)
  ) {
    invalid();
  }

  const snapshotCreatedAt = parseUtcTimestamp(
    value.snapshot_created_at,
    true,
  );
  const snapshotId = parseUuid(value.snapshot_id, true);
  requirePair(snapshotCreatedAt, snapshotId);
  const cursorCreatedAt = parseUtcTimestamp(value.cursor_created_at, true);
  const cursorId = parseUuid(value.cursor_id, true);
  requirePair(cursorCreatedAt, cursorId);
  if (cursorCreatedAt !== null && snapshotCreatedAt === null) invalid();

  return {
    ...filters,
    pageSize,
    snapshotCreatedAt,
    snapshotId,
    cursorCreatedAt,
    cursorId,
  };
}

export function normalizePlatformAuditExportInput(
  value: unknown,
): PlatformAuditExportInput {
  if (!isRecord(value) || !hasOnlyKeys(value, EXPORT_INPUT_KEYS)) invalid();
  const filters = parseInputFilters(value);
  const requestId = parseUuid(value.request_id);
  if (filters.startAt === null || filters.endAt === null) invalid();
  const windowMicros = timestampMicros(filters.endAt) - timestampMicros(filters.startAt);
  if (
    windowMicros <= BigInt(0) ||
    windowMicros >
      BigInt(PLATFORM_AUDIT_MAX_EXPORT_WINDOW_MS) * BigInt(1_000)
  ) {
    invalid();
  }
  const snapshotCreatedAt = parseUtcTimestamp(
    value.snapshot_created_at,
    true,
  );
  const snapshotId = parseUuid(value.snapshot_id, true);
  requirePair(snapshotCreatedAt, snapshotId);
  return {
    ...filters,
    requestId: requestId!,
    startAt: filters.startAt,
    endAt: filters.endAt,
    snapshotCreatedAt,
    snapshotId,
  };
}

function parseChangedFieldCodes(
  value: unknown,
): readonly PlatformAuditChangedFieldCode[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) invalid();
  const codes = value.map((code) =>
    parseBoundedAsciiEnum(code, PLATFORM_AUDIT_CHANGED_FIELD_CODES, 25),
  );
  if (new Set(codes).size !== codes.length) invalid();
  return codes;
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function expectedChangedFieldCodes(
  action: PlatformAuditAction,
): readonly PlatformAuditChangedFieldCode[] {
  if (action === "audit.export") {
    return ["export_filters", "export_row_count", "export_row_set_sha256"];
  }
  if (action === "organization.bootstrap" || action === "membership.provision") {
    return ["record_status", "actor_role", "assignment"];
  }
  if (action === "membership.role.change" || action === "rbac.bundle.upgrade") {
    return ["access_version", "actor_role"];
  }
  if (action === "membership.status.change") {
    return ["access_version", "record_status"];
  }
  if (
    action === "membership.scope.organization.assign" ||
    action === "membership.scope.organization.revoke"
  ) {
    return ["assignment"];
  }
  if (action === "case.curator.set" || action === "case.handoff.create") {
    return ["case_assignment"];
  }
  if (action === "case.lifecycle.change") {
    return ["case_lifecycle", "case_status"];
  }
  if (action === "case.route.change") return ["case_route"];
  if (
    action === "case.create" ||
    action === "application.status.change" ||
    action === "visa.status.change"
  ) {
    return ["case_status"];
  }
  if (
    action === "case.update.append" ||
    action === "application.create" ||
    action === "student.profile.upsert" ||
    action === "visa.create"
  ) {
    return ["record_status"];
  }
  if (action === "task.create" || action === "task.change") {
    return ["work_status"];
  }
  if (action.startsWith("document.")) {
    return action === "document.validation.attest" ||
      action === "document.version.review"
      ? ["document_status", "review_status"]
      : ["document_status"];
  }
  if (action.startsWith("finance.")) return ["finance_status"];
  if (action === "notification.consent.set") return ["consent_status"];
  if (action.startsWith("notification.")) return ["notification_status"];
  if (action === "ai.control.set" || action === "autonomous.reply.control.set") {
    return ["ai_control"];
  }
  if (action.startsWith("ai.")) {
    return action === "ai.draft.review"
      ? ["ai_status", "review_status"]
      : ["ai_status"];
  }
  if (
    action.startsWith("communication.") ||
    action === "messaging.integration.health.record"
  ) {
    return ["communication_status"];
  }
  return ["record_status"];
}

function parseSafeRow(value: unknown): PlatformAuditSafeRow {
  if (!isRecord(value) || !hasExactKeys(value, SAFE_ROW_KEYS)) invalid();
  const actorKind = parseEnum(value.actor_kind, ["user", "service", "system"]);
  const actorDisplayLabel = parseEnum(value.actor_display_label, [
    "Staff",
    "Service",
    "System",
  ]);
  const expectedLabel = {
    user: "Staff",
    service: "Service",
    system: "System",
  }[actorKind];
  if (actorDisplayLabel !== expectedLabel) invalid();
  if (
    typeof value.action !== "string" ||
    value.action.length > 64 ||
    !/^[\x20-\x7e]+$/u.test(value.action) ||
    typeof value.resource_type !== "string" ||
    value.resource_type.length > 64 ||
    !/^[\x20-\x7e]+$/u.test(value.resource_type)
  ) {
    invalid();
  }
  const action = parseBoundedAsciiEnum(value.action, PLATFORM_AUDIT_ACTIONS, 64);
  const resourceType = parseBoundedAsciiEnum(
    value.resource_type,
    PLATFORM_AUDIT_RESOURCE_TYPES,
    64,
  );
  const reasonCode = parseBoundedAsciiEnum(
    value.reason_code,
    PLATFORM_AUDIT_REASON_CODES,
    22,
  );
  const changedFieldCodes = parseChangedFieldCodes(value.changed_field_codes);
  if (
    reasonCode !== (action === "audit.export" ? "audit_export_requested" : "restricted") ||
    !sameStringList(changedFieldCodes, expectedChangedFieldCodes(action))
  ) {
    invalid();
  }
  return {
    auditEventId: parseUuid(value.audit_event_id)!,
    createdAt: parseUtcTimestamp(value.created_at)!,
    action,
    resourceType,
    resourceId: parseUuid(value.resource_id)!,
    actorKind,
    actorDisplayLabel,
    requestId: parseUuid(value.request_id)!,
    reasonCode,
    changedFieldCodes,
  };
}

function parseRows(value: unknown): readonly PlatformAuditSafeRow[] {
  if (!Array.isArray(value) || value.length > PLATFORM_AUDIT_MAX_EXPORT_ROWS) {
    invalid();
  }
  const rows = value.map(parseSafeRow);
  if (new Set(rows.map((row) => row.auditEventId)).size !== rows.length) invalid();
  return rows;
}

export function normalizePlatformAuditSearchResult(
  value: unknown,
): PlatformAuditSearchResult {
  if (!isRecord(value) || !hasExactKeys(value, SEARCH_RESULT_KEYS)) invalid();
  if (typeof value.has_more !== "boolean") invalid();
  const snapshotCreatedAt = parseUtcTimestamp(value.snapshot_created_at, true);
  const snapshotId = parseUuid(value.snapshot_id, true);
  requirePair(snapshotCreatedAt, snapshotId);
  const nextCursorCreatedAt = parseUtcTimestamp(
    value.next_cursor_created_at,
    true,
  );
  const nextCursorId = parseUuid(value.next_cursor_id, true);
  requirePair(nextCursorCreatedAt, nextCursorId);
  if (
    value.has_more !== (nextCursorCreatedAt !== null) ||
    (nextCursorCreatedAt !== null && snapshotCreatedAt === null)
  ) {
    invalid();
  }
  const rows = parseRows(value.rows);
  if (rows.length > PLATFORM_AUDIT_MAX_PAGE_SIZE) invalid();
  return {
    filters: parseOutputFilters(value.filters),
    snapshotCreatedAt,
    snapshotId,
    nextCursorCreatedAt,
    nextCursorId,
    hasMore: value.has_more,
    rows,
  };
}

export function normalizePlatformAuditExportResult(
  value: unknown,
): PlatformAuditExportResult {
  if (!isRecord(value) || !hasExactKeys(value, EXPORT_RESULT_KEYS)) invalid();
  const filters = parseOutputFilters(value.filters);
  if (filters.startAt === null || filters.endAt === null) invalid();
  const snapshotCreatedAt = parseUtcTimestamp(value.snapshot_created_at, true);
  const snapshotId = parseUuid(value.snapshot_id, true);
  requirePair(snapshotCreatedAt, snapshotId);
  const rows = parseRows(value.rows);
  if (
    typeof value.row_count !== "number" ||
    !Number.isInteger(value.row_count) ||
    value.row_count < 0 ||
    value.row_count > PLATFORM_AUDIT_MAX_EXPORT_ROWS ||
    value.row_count !== rows.length ||
    typeof value.row_set_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.row_set_sha256)
  ) {
    invalid();
  }
  return {
    requestId: parseUuid(value.request_id)!,
    filters: {
      ...filters,
      startAt: filters.startAt,
      endAt: filters.endAt,
    },
    snapshotCreatedAt,
    snapshotId,
    rowCount: value.row_count,
    rowSetSha256: value.row_set_sha256,
    rows,
  };
}

export const PLATFORM_AUDIT_SEARCH_INPUT_FIELDS = SEARCH_INPUT_KEYS;
export const PLATFORM_AUDIT_EXPORT_INPUT_FIELDS = EXPORT_INPUT_KEYS;
