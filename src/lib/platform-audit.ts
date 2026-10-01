import type { PlatformAuditCsvRow } from "./platform-audit-csv.ts";

export const PLATFORM_AUDIT_MAX_PAGE_SIZE = 100;
export const PLATFORM_AUDIT_DEFAULT_PAGE_SIZE = 50;
export const PLATFORM_AUDIT_MAX_FILTER_VALUES = 32;
export const PLATFORM_AUDIT_MAX_EXPORT_ROWS = 5_000;
export const PLATFORM_AUDIT_MAX_EXPORT_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;

// These projection allowlists mirror the server's final projection: 071's
// baseline extended by the wrapper chain through migration 255 (proposal,
// not yet applied to any database — see 255's own header and
// docs/PLAN_CHANGES.md «2026-09-29 — «Журнал действий»: серверный allowlist
// аудита расширен на 72 действия (предложение, миграция 255)», whose
// sub-sections correct the count to 71 actions (lead's PR #1120 head
// 170efb75 correction) and add the 16th resource type `document_export`
// (review correction, head 24b3184b)). Migration 191 (ledger 254) is the
// latest APPLIED wrapper; 255 widens the allowlist by 71 actions / 16
// resource types that are already written by canonical Supabase but were
// never projected. `document_export` is the resource type of the
// university-form and partner-package exports (167/169): the 9
// `document.export.*` actions write `student_profile` for a profile export
// and `document_export` for those artifacts, so both types are needed for
// the 9 actions to be fully visible. Two
// actions researched for 255 are deliberately left out: `case.contract_file.upload`
// (189) turned out to violate `platform.audit_events`'s own
// `audit_events_action_check` CHECK (a pre-existing, independent defect in
// already-applied migration 189, unrelated to this widening: the literal
// contains an underscore the CHECK's `[a-z][a-z0-9]*` segments forbid), and
// `document.slot.scaninvalidate` turned out to be a one-off deploy backfill
// (its only writer is a `DO $$ … $$` block inside already-applied migration
// 115, not a live function) — see 255's own header for the full evidence on
// both. A later migration that adds a P7A action/resource type/field
// code always wraps the previous
// `platform_private.p7a_safe_*`/`p7a_changed_field_codes` function
// (rename-and-union, see e.g. 191's `p7a_safe_audit_actions_pre_case_chat`
// or 255's `p7a_safe_audit_actions_pre_journal_widen`) rather than replacing
// it, so the server list only ever grows. Drift between this file and the
// live server allowlists is caught by the real-Postgres suite
// `supabase/tests/platform_audit_journal_contract.sql` (run on the latest
// migration chain by `scripts/test-postgres-authorization.sh`, checked by
// `scripts/check-platform-audit-journal-contract.mjs`), not by a build-time
// type. A row whose action, resource type or changed-field-codes are not
// (yet) in these lists is not rejected outright: `parseSafeRow` keeps it with
// `recognized: false` rather than dropping it or failing the whole page —
// dropping would make the journal and the CSV export silently incomplete.
// `expectedChangedFieldCodes` below needed no new branch for 255's 71
// actions: 9 `document.export.*` actions already hit the existing
// `action.startsWith("document.")` branch (mirroring the server's
// `p7a_changed_field_codes` `document.%` LIKE branch, itself unchanged by
// 255) and the remaining 62 fall through to the existing `["record_status"]`
// default, exactly matching the server's own `ELSE` branch.
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
  "ai.proposal.review",
  "ai.qualification.record",
  "ai.retrieval.preview",
  "application.create",
  "application.details.update",
  "application.document.review",
  "application.partner.details.update",
  "application.requirements.save",
  "application.status.change",
  "audit.export",
  "autonomous.reply.control.set",
  "case.chat.await",
  "case.chat.post",
  "case.coverage.return",
  "case.coverage.start",
  "case.create",
  "case.curator.set",
  "case.handoff.acknowledge",
  "case.handoff.clarification",
  "case.handoff.create",
  "case.handoff.decline",
  "case.lifecycle.change",
  "case.next.action.change",
  "case.payment.receipt.upload",
  "case.pipeline.move",
  "case.route.change",
  "case.sales.owner.sync",
  "case.tranche.save",
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
  "company.file.download.grant",
  "company.file.file.archive",
  "company.file.file.create",
  "company.file.file.move",
  "company.file.file.rename",
  "company.file.folder.archive",
  "company.file.folder.create",
  "company.file.folder.move",
  "company.file.folder.rename",
  "company.file.upload.finalize",
  "company.file.upload.reserve",
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
  "docs.student.create",
  "document.checklist.baseline.seed",
  "document.download.grant",
  "document.download.sign.authorize",
  "document.export.begun",
  "document.export.download.failed",
  "document.export.download.verified",
  "document.export.failed",
  "document.export.prepared",
  "document.export.ready",
  "document.export.reconciled",
  "document.export.sealed",
  "document.export.unknown",
  "document.media.attach.complete",
  "document.media.attach.reserve",
  "document.requirement.create",
  "document.requirement.retire",
  "document.slot.application.link",
  "document.slot.application.unlink",
  "document.slot.create",
  "document.slot.custom.create",
  "document.slot.metadata.change",
  "document.slot.remove",
  "document.slot.visa.link",
  "document.slot.visa.unlink",
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
  "lead.admissions.gate.contract.confirmed",
  "lead.admissions.gate.firstpayment.confirmed",
  "lead.admissions.gate.overridden",
  "lead.admissions.handoff.completed",
  "lead.cabinet.prepare",
  "lead.lifecycle.change",
  "lead.manual.create",
  "lead.sale.conditions.save",
  "lead.sales.workflow.changed",
  "lead.website.receive",
  "media.download.grant",
  "membership.permission.change",
  "membership.provision",
  "membership.role.change",
  "membership.scope.organization.assign",
  "membership.scope.organization.revoke",
  "membership.status.change",
  "messaging.integration.health.record",
  "note.create",
  "notification.consent.set",
  "notification.create",
  "notification.read",
  "organization.bootstrap",
  "pilot.cohort.configured",
  "pilot.cohort.member.automatic",
  "pilot.cohort.member.excluded",
  "pilot.cohort.member.included",
  "post.contract.item.update",
  "post.contract.items.seed",
  "post.contract.report.generate",
  "post.contract.report.review",
  "prompt.artifact.publish",
  "prompt.artifact.retire",
  "rbac.bundle.upgrade",
  "sales.register.archive",
  "sales.register.create",
  "sales.register.import",
  "sales.register.lead.link",
  "sales.register.lead.unlink",
  "sales.register.manager.label",
  "sales.register.pipeline",
  "sales.register.restore",
  "sales.register.target",
  "sales.register.update",
  "snippet.archive",
  "snippet.create",
  "snippet.update",
  "staff.department.archive",
  "staff.department.create",
  "staff.department.restore",
  "staff.department.update",
  "staff.organization.details.change",
  "staff.role.archive",
  "staff.role.assignments",
  "staff.role.copy",
  "staff.role.create",
  "staff.role.publish",
  "staff.role.restore",
  "staff.role.save",
  "staff.system.admin",
  "staff.task.create",
  "staff.task.edit",
  "staff.task.status",
  "student.portal.authority.activate",
  "student.profile.export.attempted",
  "student.profile.export.failed",
  "student.profile.export.generated",
  "student.profile.field.review",
  "student.profile.recognition.publish",
  "student.profile.start",
  "student.profile.upsert",
  "task.change",
  "task.create",
  "team.chat.delete",
  "team.chat.edit",
  "team.chat.moderate",
  "team.chat.post",
  "visa.create",
  "visa.status.change",
  "work.review.resolve",
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
  "ai_prompt_artifact_version",
  "ai_retrieval_request",
  "approved_knowledge_chunk_set",
  "approved_knowledge_version",
  "audit_export",
  "case_task",
  "catalog_import_batch",
  "catalog_import_candidate",
  "communication_conversation",
  "communication_media",
  "communication_message",
  "company_file",
  "company_file_folder",
  "company_file_version",
  "contract_template_version",
  "conversation_ai_control",
  "conversation_ai_fact",
  "conversation_ai_memory",
  "conversation_ai_qualification",
  "conversation_participant",
  "country_requirement_version",
  "country_requirement_version_source",
  "decision_backlog",
  "document_export",
  "document_requirement",
  "document_slot",
  "document_version",
  "durable_work_item",
  "gemini_proposal_review",
  "lead",
  "manual_send_authorization",
  "membership",
  "messaging_integration_health_event",
  "notification",
  "notification_consent",
  "organization",
  "organization_membership",
  "payment_event",
  "payment_obligation",
  "payment_receipt_file",
  "pilot_cohort_configuration",
  "pilot_cohort_membership",
  "post_contract_item",
  "post_contract_item_set",
  "post_contract_report",
  "provider_reconciliation_event",
  "reply_snippet",
  "sales_manager_label",
  "sales_register",
  "sales_register_import",
  "sales_register_target",
  "source_registry",
  "staff_department",
  "staff_organizational_details",
  "staff_role",
  "staff_task",
  "stop_factor",
  "student_case",
  "student_case_contract_draft",
  "student_case_update",
  "student_profile",
  "team_chat_message",
  "university_application",
  "visa_case",
  "waha_history_reconciliation_run",
  "work_review_case",
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
  "admissions_owner",
  "ai_control",
  "ai_status",
  "assignment",
  "case_assignment",
  "case_lifecycle",
  "case_route",
  "case_status",
  "communication_status",
  "consent_status",
  "contract_confirmation",
  "document_status",
  "export_filters",
  "export_row_count",
  "export_row_set_sha256",
  "finance_status",
  "first_payment_confirmation",
  "first_payment_expectation",
  "gate_state",
  "gate_version",
  "handoff_mode",
  "handoff_reason",
  "handoff_state",
  "inherited_sales_context",
  "notification_status",
  "pilot_configuration",
  "pilot_cutoff",
  "pilot_membership",
  "pilot_write_boundary",
  "record_status",
  "review_status",
  "sensitive_permission",
  "starter_tasks",
  "work_status",
] as const;

// Actor CATEGORY codes of the server's safe projection (071). Migration 256
// splits a 'user' actor by the side of its membership — Staff or Student — or
// the neutral User when that side cannot be resolved honestly. A category,
// never an identity: no id, name or role travels with it.
export const PLATFORM_AUDIT_ACTOR_DISPLAY_LABELS = [
  "Staff",
  "Student",
  "User",
  "Service",
  "System",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];
export type PlatformAuditResourceType =
  (typeof PLATFORM_AUDIT_RESOURCE_TYPES)[number];
export type PlatformAuditReasonCode =
  (typeof PLATFORM_AUDIT_REASON_CODES)[number];
export type PlatformAuditChangedFieldCode =
  (typeof PLATFORM_AUDIT_CHANGED_FIELD_CODES)[number];
export type PlatformAuditActorKind = "user" | "service" | "system";
export type PlatformAuditActorDisplayLabel =
  (typeof PLATFORM_AUDIT_ACTOR_DISPLAY_LABELS)[number];

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

type PlatformAuditSafeRowEnvelope = Readonly<{
  auditEventId: string;
  createdAt: string;
  resourceId: string;
  actorKind: PlatformAuditActorKind;
  actorDisplayLabel: PlatformAuditActorDisplayLabel;
  requestId: string;
  reasonCode: PlatformAuditReasonCode;
}>;

/**
 * `recognized: true` — the row's action, resource type and changed-field
 * codes are all in the current allowlists above; the narrow literal types
 * apply. `recognized: false` — the server emitted a value this file has not
 * (yet) learned about; every STRUCTURAL shape is still enforced (envelope
 * keys, UUIDs, UTC timestamps, actor kind/label pairing, the reason-code/
 * action pairing, 1-16 unique bounded codes each matching the field-code
 * shape), but the row is kept with plain-string `action`/`resourceType`/
 * `changedFieldCodes` rather than dropped: dropping a row would make the
 * journal and the CSV export silently incomplete. The UI never shows the raw
 * strings of an unrecognized row — `wording.ts` returns `null` for an
 * unknown key, and the caller draws nothing for it. Both branches intersect
 * `PlatformAuditCsvRow` directly, so `serializePlatformAuditCsv()` keeps
 * exporting codes for every row, recognized or not — checked here, not just
 * hoped for, because the intersection fails to compile otherwise.
 */
export type PlatformAuditRecognizedSafeRow = PlatformAuditSafeRowEnvelope &
  PlatformAuditCsvRow &
  Readonly<{
    recognized: true;
    action: PlatformAuditAction;
    resourceType: PlatformAuditResourceType;
    changedFieldCodes: readonly PlatformAuditChangedFieldCode[];
  }>;

export type PlatformAuditUnrecognizedSafeRow = PlatformAuditSafeRowEnvelope &
  PlatformAuditCsvRow &
  Readonly<{
    recognized: false;
    action: string;
    resourceType: string;
    changedFieldCodes: readonly string[];
  }>;

export type PlatformAuditSafeRow =
  | PlatformAuditRecognizedSafeRow
  | PlatformAuditUnrecognizedSafeRow;

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

// Structural shape only — NOT an enum membership check. A row whose action
// is not (yet) in PLATFORM_AUDIT_ACTIONS still carries changed-field codes
// that must look like codes (so a corrupted/oversized/malformed value still
// fails closed); whether they are the SPECIFIC codes this file knows about
// is a `recognized` question, decided in parseSafeRow, not a parse error.
const CHANGED_FIELD_CODE_PATTERN = /^[a-z][a-z0-9_]*$/u;

function parseBoundedPatternString(
  value: unknown,
  pattern: RegExp,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !pattern.test(value)
  ) {
    invalid();
  }
  return value;
}

// A generous STRUCTURAL sanity bound against malformed data, not a mirror of
// today's server maximum: this file no longer fails the whole page when the
// server adds an action with a wider changed_field_codes array (the defect
// this file fixes was exactly that — a stale bound throwing on a well-formed
// row). Whether specific codes are the ones this file KNOWS for a given
// action is what `recognized` decides, in parseSafeRow, not this bound.
// Today's widest row is 6 codes (lead.admissions.handoff.completed, 088);
// 16 leaves real headroom for the server to grow without another PR here.
const PLATFORM_AUDIT_MAX_CHANGED_FIELD_CODES = 16;
// Same reasoning as the count above, and the same bound the action/resource
// type patterns already use: a generous sanity ceiling, not today's longest
// code (first_payment_confirmation, 26 chars).
const PLATFORM_AUDIT_MAX_CHANGED_FIELD_CODE_LENGTH = 64;

function parseChangedFieldCodes(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > PLATFORM_AUDIT_MAX_CHANGED_FIELD_CODES
  ) {
    invalid();
  }
  const codes = value.map((code) =>
    parseBoundedPatternString(
      code,
      CHANGED_FIELD_CODE_PATTERN,
      PLATFORM_AUDIT_MAX_CHANGED_FIELD_CODE_LENGTH,
    ),
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
  if (action.startsWith("staff.department.")) return ["record_status"];
  if (action === "staff.organization.details.change") return ["assignment"];
  if (action === "audit.export") {
    return ["export_filters", "export_row_count", "export_row_set_sha256"];
  }
  if (action === "organization.bootstrap" || action === "membership.provision") {
    return ["record_status", "actor_role", "assignment"];
  }
  if (action === "membership.role.change" || action === "rbac.bundle.upgrade") {
    return ["access_version", "actor_role"];
  }
  if (action === "membership.permission.change") {
    return ["access_version", "sensitive_permission"];
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
    return action === "ai.draft.review" || action === "ai.proposal.review"
      ? ["ai_status", "review_status"]
      : ["ai_status"];
  }
  if (
    action === "lead.admissions.gate.contract.confirmed" ||
    action === "lead.admissions.gate.firstpayment.confirmed" ||
    action === "lead.admissions.gate.overridden"
  ) {
    return [
      "contract_confirmation",
      "first_payment_expectation",
      "first_payment_confirmation",
      "gate_state",
      "gate_version",
    ];
  }
  if (action === "lead.admissions.handoff.completed") {
    return [
      "admissions_owner",
      "handoff_mode",
      "handoff_state",
      "handoff_reason",
      "inherited_sales_context",
      "starter_tasks",
    ];
  }
  if (action === "pilot.cohort.configured") {
    return ["pilot_configuration", "pilot_cutoff"];
  }
  if (
    action === "pilot.cohort.member.automatic" ||
    action === "pilot.cohort.member.excluded" ||
    action === "pilot.cohort.member.included"
  ) {
    return ["pilot_membership", "pilot_write_boundary"];
  }
  if (
    action.startsWith("communication.") ||
    action === "messaging.integration.health.record"
  ) {
    return ["communication_status"];
  }
  return ["record_status"];
}

// Structural shape only. `action`'s segment separator keeps the server's
// dot-joined convention; a segment may start with a digit or underscore
// (looser than the DB's own CHECK) because recognition — not this pattern —
// is what decides whether a value is drawn on screen.
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/u;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/u;

function isKnownAction(value: string): value is PlatformAuditAction {
  return (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isKnownResourceType(value: string): value is PlatformAuditResourceType {
  return (PLATFORM_AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

// The kind/label pairing stays fail-closed: free text, a label of another kind
// or any unknown code throws PlatformAuditContractError — the journal must
// never show an identity or an unchecked label.
const ACTOR_DISPLAY_LABELS_BY_KIND: Readonly<
  Record<PlatformAuditActorKind, readonly PlatformAuditActorDisplayLabel[]>
> = {
  user: ["Staff", "Student", "User"],
  service: ["Service"],
  system: ["System"],
};

function parseSafeRow(value: unknown): PlatformAuditSafeRow {
  if (!isRecord(value) || !hasExactKeys(value, SAFE_ROW_KEYS)) invalid();
  const actorKind = parseEnum(value.actor_kind, ["user", "service", "system"]);
  const actorDisplayLabel = parseEnum(
    value.actor_display_label,
    PLATFORM_AUDIT_ACTOR_DISPLAY_LABELS,
  );
  if (!ACTOR_DISPLAY_LABELS_BY_KIND[actorKind].includes(actorDisplayLabel)) {
    invalid();
  }

  const action = parseBoundedPatternString(value.action, ACTION_PATTERN, 64);
  const resourceType = parseBoundedPatternString(
    value.resource_type,
    RESOURCE_TYPE_PATTERN,
    64,
  );
  const expectedReasonCode: PlatformAuditReasonCode =
    action === "audit.export" ? "audit_export_requested" : "restricted";
  if (value.reason_code !== expectedReasonCode) invalid();
  const reasonCode = expectedReasonCode;
  const changedFieldCodes = parseChangedFieldCodes(value.changed_field_codes);

  const envelope: PlatformAuditSafeRowEnvelope = {
    auditEventId: parseUuid(value.audit_event_id)!,
    createdAt: parseUtcTimestamp(value.created_at)!,
    resourceId: parseUuid(value.resource_id)!,
    actorKind,
    actorDisplayLabel,
    requestId: parseUuid(value.request_id)!,
    reasonCode,
  };

  if (
    isKnownAction(action) &&
    isKnownResourceType(resourceType) &&
    sameStringList(changedFieldCodes, expectedChangedFieldCodes(action))
  ) {
    return {
      ...envelope,
      recognized: true,
      action,
      resourceType,
      changedFieldCodes: changedFieldCodes as readonly PlatformAuditChangedFieldCode[],
    };
  }
  return {
    ...envelope,
    recognized: false,
    action,
    resourceType,
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
