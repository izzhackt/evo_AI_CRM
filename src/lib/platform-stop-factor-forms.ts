/**
 * Pure form contract for the stop factor screen.
 *
 * `platform.create_stop_factor` and `platform.resolve_stop_factor`
 * (migration 043) reject incomplete or contradictory input with a bare SQL
 * error. Deciding validity here — before any network call — keeps the failure
 * legible to the operator and keeps the rules testable without a database.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const PLATFORM_STOP_FACTOR_REASON_MIN = 3;
export const PLATFORM_STOP_FACTOR_REASON_MAX = 1000;
export const PLATFORM_STOP_FACTOR_ACTION_MAX = 1000;
export const PLATFORM_STOP_FACTOR_EVIDENCE_MAX = 500;

export const PLATFORM_STOP_FACTOR_CREATE_FIELDS = [
  "payment_obligation_id",
  "owner_membership_id",
  "reason",
  "blocked_action",
  "next_action",
  "evidence_ref",
  "request_id",
] as const;

export const PLATFORM_STOP_FACTOR_RESOLVE_FIELDS = [
  "stop_factor_id",
  "resolution_kind",
  "payment_event_id",
  "reason",
  "evidence_ref",
  "request_id",
] as const;

export type PlatformStopFactorCreateInput = Readonly<{
  paymentObligationId: string;
  ownerMembershipId: string;
  reason: string;
  blockedAction: string;
  nextAction: string;
  evidenceRef: string;
  requestId: string;
}>;

export type PlatformStopFactorResolveInput = Readonly<{
  stopFactorId: string;
  resolutionKind: "payment_event" | "admin_override";
  paymentEventId: string | null;
  reason: string;
  evidenceRef: string | null;
  requestId: string;
}>;

function uuid(value: string | undefined): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function text(
  value: string | undefined,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length < minimum
    || candidate.length > maximum
    || CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function isBlank(value: string | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

export function decidePlatformStopFactorCreate(
  fields: Readonly<Record<string, string | undefined>>,
): PlatformStopFactorCreateInput | null {
  const paymentObligationId = uuid(fields.payment_obligation_id);
  const ownerMembershipId = uuid(fields.owner_membership_id);
  const reason = text(
    fields.reason,
    PLATFORM_STOP_FACTOR_REASON_MIN,
    PLATFORM_STOP_FACTOR_REASON_MAX,
  );
  const blockedAction = text(
    fields.blocked_action,
    1,
    PLATFORM_STOP_FACTOR_ACTION_MAX,
  );
  const nextAction = text(
    fields.next_action,
    1,
    PLATFORM_STOP_FACTOR_ACTION_MAX,
  );
  const evidenceRef = text(
    fields.evidence_ref,
    1,
    PLATFORM_STOP_FACTOR_EVIDENCE_MAX,
  );
  const requestId = uuid(fields.request_id);
  if (
    !paymentObligationId
    || !ownerMembershipId
    || !reason
    || !blockedAction
    || !nextAction
    || !evidenceRef
    || !requestId
  ) {
    return null;
  }
  return {
    paymentObligationId,
    ownerMembershipId,
    reason,
    blockedAction,
    nextAction,
    evidenceRef,
    requestId,
  };
}

/**
 * `resolve_stop_factor` treats the two resolution kinds as exclusive: a
 * payment-event resolution must carry an event and no free-text evidence, and
 * an override must carry evidence and no event. `actorRole` is checked here
 * too because the database refuses an override from anyone but an Admin.
 */
export function decidePlatformStopFactorResolve(
  fields: Readonly<Record<string, string | undefined>>,
  actorRole: string,
): PlatformStopFactorResolveInput | null {
  const stopFactorId = uuid(fields.stop_factor_id);
  const reason = text(
    fields.reason,
    PLATFORM_STOP_FACTOR_REASON_MIN,
    PLATFORM_STOP_FACTOR_REASON_MAX,
  );
  const requestId = uuid(fields.request_id);
  const kind = fields.resolution_kind;
  if (!stopFactorId || !reason || !requestId) return null;

  if (kind === "payment_event") {
    const paymentEventId = uuid(fields.payment_event_id);
    if (!paymentEventId || !isBlank(fields.evidence_ref)) return null;
    return {
      stopFactorId,
      resolutionKind: "payment_event",
      paymentEventId,
      reason,
      evidenceRef: null,
      requestId,
    };
  }

  if (kind === "admin_override") {
    if (actorRole !== "admin") return null;
    const evidenceRef = text(
      fields.evidence_ref,
      1,
      PLATFORM_STOP_FACTOR_EVIDENCE_MAX,
    );
    if (!evidenceRef || !isBlank(fields.payment_event_id)) return null;
    return {
      stopFactorId,
      resolutionKind: "admin_override",
      paymentEventId: null,
      reason,
      evidenceRef,
      requestId,
    };
  }

  return null;
}

export function hasExactPlatformStopFactorFormKeys(
  form: FormData,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = [...form.keys()]
    .filter((key) => !key.startsWith("$ACTION_"))
    .sort();
  const expected = [...expectedKeys].sort();
  return actualKeys.length === expected.length
    && actualKeys.every((key, index) => key === expected[index])
    && expectedKeys.every((key) => form.getAll(key).length === 1);
}
