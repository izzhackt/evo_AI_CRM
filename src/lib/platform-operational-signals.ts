const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_COUNT = 1_000_000;
const MAX_AGE_SECONDS = 31_536_000;

const READINESS_VALUES = new Set([
  "unconfigured",
  "configured_unverified",
  "blocked",
  "ready",
]);
const EVIDENCE_KIND_VALUES = new Set([
  "configuration_check",
  "local_non_provider",
  "provider_observed",
]);
const AUDIT_APPEND_STATUS_VALUES = new Set([
  "ready",
  "failed",
  "unavailable",
]);

export const PLATFORM_OPERATIONAL_SIGNAL_KEYS = Object.freeze([
  "schema_version",
  "observed_at",
  "saturated",
  "queue_ready_count",
  "queue_retry_wait_count",
  "queue_leased_count",
  "queue_expired_lease_count",
  "queue_oldest_ready_age_seconds",
  "queue_oldest_retry_wait_age_seconds",
  "dead_letter_count",
  "unknown_delivery_open_count",
  "provider_conflict_open_count",
  "private_media_pending_count",
  "private_media_processing_count",
  "private_media_retryable_error_count",
  "private_media_terminal_error_count",
  "private_media_expired_lease_count",
  "private_media_oldest_unarchived_age_seconds",
  "autonomy_queued_count",
  "autonomy_dispatching_count",
  "autonomy_unknown_count",
  "autonomy_manual_review_count",
  "autonomy_oldest_queued_age_seconds",
  "autonomy_oldest_dispatching_age_seconds",
  "waha_readiness",
  "waha_evidence_kind",
  "waha_age_seconds",
  "waha_evidence_future",
  "ai_readiness",
  "ai_evidence_kind",
  "ai_age_seconds",
  "ai_evidence_future",
  "audit_append_status",
] as const);

const COUNT_KEYS = Object.freeze([
  "queue_ready_count",
  "queue_retry_wait_count",
  "queue_leased_count",
  "queue_expired_lease_count",
  "dead_letter_count",
  "unknown_delivery_open_count",
  "provider_conflict_open_count",
  "private_media_pending_count",
  "private_media_processing_count",
  "private_media_retryable_error_count",
  "private_media_terminal_error_count",
  "private_media_expired_lease_count",
  "autonomy_queued_count",
  "autonomy_dispatching_count",
  "autonomy_unknown_count",
  "autonomy_manual_review_count",
] as const);

const AGE_KEYS = Object.freeze([
  "queue_oldest_ready_age_seconds",
  "queue_oldest_retry_wait_age_seconds",
  "private_media_oldest_unarchived_age_seconds",
  "autonomy_oldest_queued_age_seconds",
  "autonomy_oldest_dispatching_age_seconds",
  "waha_age_seconds",
  "ai_age_seconds",
] as const);

export type PlatformDependencyReadiness =
  | "unconfigured"
  | "configured_unverified"
  | "blocked"
  | "ready";
export type PlatformDependencyEvidenceKind =
  | "configuration_check"
  | "local_non_provider"
  | "provider_observed";
export type PlatformAuditAppendStatus = "ready" | "failed" | "unavailable";

export type PlatformOperationalSignals = Readonly<{
  schema_version: "p7b-v1";
  observed_at: string;
  saturated: boolean;
  queue_ready_count: number;
  queue_retry_wait_count: number;
  queue_leased_count: number;
  queue_expired_lease_count: number;
  queue_oldest_ready_age_seconds: number | null;
  queue_oldest_retry_wait_age_seconds: number | null;
  dead_letter_count: number;
  unknown_delivery_open_count: number;
  provider_conflict_open_count: number;
  private_media_pending_count: number;
  private_media_processing_count: number;
  private_media_retryable_error_count: number;
  private_media_terminal_error_count: number;
  private_media_expired_lease_count: number;
  private_media_oldest_unarchived_age_seconds: number | null;
  autonomy_queued_count: number;
  autonomy_dispatching_count: number;
  autonomy_unknown_count: number;
  autonomy_manual_review_count: number;
  autonomy_oldest_queued_age_seconds: number | null;
  autonomy_oldest_dispatching_age_seconds: number | null;
  waha_readiness: PlatformDependencyReadiness;
  waha_evidence_kind: PlatformDependencyEvidenceKind | null;
  waha_age_seconds: number | null;
  waha_evidence_future: boolean;
  ai_readiness: PlatformDependencyReadiness;
  ai_evidence_kind: PlatformDependencyEvidenceKind | null;
  ai_age_seconds: number | null;
  ai_evidence_future: boolean;
  audit_append_status: PlatformAuditAppendStatus;
}>;

export class PlatformOperationalSignalsContractError extends Error {
  constructor() {
    super("Platform operational signals did not match p7b-v1.");
    this.name = "PlatformOperationalSignalsContractError";
  }
}

function invalid(): never {
  throw new PlatformOperationalSignalsContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIMESTAMPTZ_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parsePlatformOperationalSignals(
  value: unknown,
): PlatformOperationalSignals {
  if (!isRecord(value)) return invalid();
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...PLATFORM_OPERATIONAL_SIGNAL_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return invalid();
  }

  if (
    value.schema_version !== "p7b-v1" ||
    !isValidTimestamp(value.observed_at) ||
    typeof value.saturated !== "boolean"
  ) {
    return invalid();
  }
  for (const key of COUNT_KEYS) {
    if (!isBoundedInteger(value[key], MAX_COUNT)) return invalid();
  }
  for (const key of AGE_KEYS) {
    if (value[key] !== null && !isBoundedInteger(value[key], MAX_AGE_SECONDS)) {
      return invalid();
    }
  }
  if (
    typeof value.waha_readiness !== "string" ||
    !READINESS_VALUES.has(value.waha_readiness) ||
    typeof value.ai_readiness !== "string" ||
    !READINESS_VALUES.has(value.ai_readiness) ||
    (value.waha_evidence_kind !== null &&
      (typeof value.waha_evidence_kind !== "string" ||
        !EVIDENCE_KIND_VALUES.has(value.waha_evidence_kind))) ||
    (value.ai_evidence_kind !== null &&
      (typeof value.ai_evidence_kind !== "string" ||
        !EVIDENCE_KIND_VALUES.has(value.ai_evidence_kind))) ||
    typeof value.waha_evidence_future !== "boolean" ||
    typeof value.ai_evidence_future !== "boolean" ||
    typeof value.audit_append_status !== "string" ||
    !AUDIT_APPEND_STATUS_VALUES.has(value.audit_append_status)
  ) {
    return invalid();
  }

  // Every property was checked above, including the exact key set. Keep this
  // alias so the returned DTO can be rebuilt in the contract's canonical order.
  const validated = value as unknown as PlatformOperationalSignals;
  return Object.freeze({
    schema_version: validated.schema_version,
    observed_at: validated.observed_at,
    saturated: validated.saturated,
    queue_ready_count: validated.queue_ready_count,
    queue_retry_wait_count: validated.queue_retry_wait_count,
    queue_leased_count: validated.queue_leased_count,
    queue_expired_lease_count: validated.queue_expired_lease_count,
    queue_oldest_ready_age_seconds: validated.queue_oldest_ready_age_seconds,
    queue_oldest_retry_wait_age_seconds:
      validated.queue_oldest_retry_wait_age_seconds,
    dead_letter_count: validated.dead_letter_count,
    unknown_delivery_open_count: validated.unknown_delivery_open_count,
    provider_conflict_open_count: validated.provider_conflict_open_count,
    private_media_pending_count: validated.private_media_pending_count,
    private_media_processing_count: validated.private_media_processing_count,
    private_media_retryable_error_count:
      validated.private_media_retryable_error_count,
    private_media_terminal_error_count:
      validated.private_media_terminal_error_count,
    private_media_expired_lease_count:
      validated.private_media_expired_lease_count,
    private_media_oldest_unarchived_age_seconds:
      validated.private_media_oldest_unarchived_age_seconds,
    autonomy_queued_count: validated.autonomy_queued_count,
    autonomy_dispatching_count: validated.autonomy_dispatching_count,
    autonomy_unknown_count: validated.autonomy_unknown_count,
    autonomy_manual_review_count: validated.autonomy_manual_review_count,
    autonomy_oldest_queued_age_seconds:
      validated.autonomy_oldest_queued_age_seconds,
    autonomy_oldest_dispatching_age_seconds:
      validated.autonomy_oldest_dispatching_age_seconds,
    waha_readiness: validated.waha_readiness,
    waha_evidence_kind: validated.waha_evidence_kind,
    waha_age_seconds: validated.waha_age_seconds,
    waha_evidence_future: validated.waha_evidence_future,
    ai_readiness: validated.ai_readiness,
    ai_evidence_kind: validated.ai_evidence_kind,
    ai_age_seconds: validated.ai_age_seconds,
    ai_evidence_future: validated.ai_evidence_future,
    audit_append_status: validated.audit_append_status,
  });
}
