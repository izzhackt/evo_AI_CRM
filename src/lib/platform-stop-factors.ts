import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform stop factor data is unavailable.";

/**
 * Finance detail on stop factors is readable only by the roles that
 * `private.platform_can_read_finance_full` admits (migration 043). Reading with
 * any other role would silently return an empty set, so the module refuses it
 * instead of rendering a false "nothing is blocked" state.
 */
const STOP_FACTOR_READ_ROLES = ["admin", "finance"] as const;

export const PLATFORM_STOP_FACTOR_STATUSES = ["active", "resolved"] as const;

export const PLATFORM_STOP_FACTOR_RESOLUTION_KINDS = [
  "payment_event",
  "admin_override",
] as const;

export const PLATFORM_STOP_FACTOR_OBLIGATION_CATEGORIES = [
  "evo_service_fee",
  "third_party_cost",
] as const;

export type PlatformStopFactorStatus =
  (typeof PLATFORM_STOP_FACTOR_STATUSES)[number];
export type PlatformStopFactorResolutionKind =
  (typeof PLATFORM_STOP_FACTOR_RESOLUTION_KINDS)[number];
export type PlatformStopFactorObligationCategory =
  (typeof PLATFORM_STOP_FACTOR_OBLIGATION_CATEGORIES)[number];

export type PlatformStopFactor = Readonly<{
  stopFactorId: string;
  studentCaseId: string;
  paymentObligationId: string;
  status: PlatformStopFactorStatus;
  reason: string;
  ownerMembershipId: string;
  blockedAction: string;
  nextAction: string;
  createdAt: string;
  resolutionKind: PlatformStopFactorResolutionKind | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
}>;

export type PlatformStopFactorObligation = Readonly<{
  paymentObligationId: string;
  studentCaseId: string;
  label: string;
  category: PlatformStopFactorObligationCategory;
  amountMinor: number;
  currency: string;
  dueAt: string;
  outstandingMinor: number;
}>;

export type PlatformStopFactorPaymentEvent = Readonly<{
  paymentEventId: string;
  paymentObligationId: string;
  studentCaseId: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
}>;

export type PlatformStopFactorOwnerOption = Readonly<{
  membershipId: string;
  displayName: string;
}>;

type PlatformStopFactorRepositoryOptions = Readonly<{
  client?: SupabaseClient;
}>;

export class PlatformStopFactorRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformStopFactorRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformStopFactorRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformStopFactorRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string"
    || !TIMESTAMPTZ_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : requiredText(value, maximum);
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

function optionalOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return value === null ? null : oneOf(value, allowed);
}

function nonNegativeSafeInteger(value: unknown): number {
  const candidate = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (
    typeof candidate !== "number"
    || !Number.isSafeInteger(candidate)
    || candidate < 0
  ) {
    return invalidShape();
  }
  return candidate;
}

function positiveSafeInteger(value: unknown): number {
  const candidate = nonNegativeSafeInteger(value);
  return candidate > 0 ? candidate : invalidShape();
}

function requireStopFactorReadActor(actor: PlatformActor): string {
  if (
    !(STOP_FACTOR_READ_ROLES as readonly string[]).includes(actor.platformRole)
  ) {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient(): Promise<SupabaseClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export function normalizePlatformStopFactor(
  value: unknown,
  expectedOrganizationId: string,
): PlatformStopFactor {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "id",
      "organization_id",
      "student_case_id",
      "payment_obligation_id",
      "status",
      "reason",
      "owner_membership_id",
      "blocked_action",
      "next_action",
      "created_at",
      "resolution_kind",
      "resolution_reason",
      "resolved_at",
    ])
  ) {
    return invalidShape();
  }
  if (
    requiredUuid(value.organization_id)
    !== requiredUuid(expectedOrganizationId)
  ) {
    return invalidShape();
  }
  const status = oneOf(value.status, PLATFORM_STOP_FACTOR_STATUSES);
  const resolutionKind = optionalOneOf(
    value.resolution_kind,
    PLATFORM_STOP_FACTOR_RESOLUTION_KINDS,
  );
  const resolvedAt = optionalTimestamp(value.resolved_at);
  const resolutionReason = optionalText(value.resolution_reason, 1000);
  // A resolved row records its outcome in three columns at once. A row that
  // disagrees with its own status is not something this UI can act on, so it
  // fails closed rather than rendering a half-resolved block.
  const resolved = status === "resolved";
  if (
    resolved !== (resolutionKind !== null)
    || resolved !== (resolvedAt !== null)
    || resolved !== (resolutionReason !== null)
  ) {
    return invalidShape();
  }
  return {
    stopFactorId: requiredUuid(value.id),
    studentCaseId: requiredUuid(value.student_case_id),
    paymentObligationId: requiredUuid(value.payment_obligation_id),
    status,
    reason: requiredText(value.reason, 1000),
    ownerMembershipId: requiredUuid(value.owner_membership_id),
    blockedAction: requiredText(value.blocked_action, 1000),
    nextAction: requiredText(value.next_action, 1000),
    createdAt: requiredTimestamp(value.created_at),
    resolutionKind,
    resolutionReason,
    resolvedAt,
  };
}

export function normalizePlatformStopFactorObligation(
  value: unknown,
  expectedOrganizationId: string,
): PlatformStopFactorObligation {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "id",
      "organization_id",
      "student_case_id",
      "label",
      "category",
      "amount_minor",
      "currency",
      "due_at",
      "total_paid_minor",
      "total_refunded_minor",
    ])
  ) {
    return invalidShape();
  }
  if (
    requiredUuid(value.organization_id)
    !== requiredUuid(expectedOrganizationId)
  ) {
    return invalidShape();
  }
  const amountMinor = positiveSafeInteger(value.amount_minor);
  const paidMinor = nonNegativeSafeInteger(value.total_paid_minor);
  const refundedMinor = nonNegativeSafeInteger(value.total_refunded_minor);
  if (refundedMinor > paidMinor) return invalidShape();
  if (
    typeof value.currency !== "string"
    || !CURRENCY_PATTERN.test(value.currency)
  ) {
    return invalidShape();
  }
  const settledMinor = paidMinor - refundedMinor;
  return {
    paymentObligationId: requiredUuid(value.id),
    studentCaseId: requiredUuid(value.student_case_id),
    label: requiredText(value.label, 500),
    category: oneOf(value.category, PLATFORM_STOP_FACTOR_OBLIGATION_CATEGORIES),
    amountMinor,
    currency: value.currency,
    dueAt: requiredTimestamp(value.due_at),
    outstandingMinor: Math.max(amountMinor - settledMinor, 0),
  };
}

export function normalizePlatformStopFactorPaymentEvent(
  value: unknown,
  expectedOrganizationId: string,
): PlatformStopFactorPaymentEvent {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "id",
      "organization_id",
      "student_case_id",
      "payment_obligation_id",
      "event_type",
      "amount_minor",
      "currency",
      "occurred_at",
    ])
  ) {
    return invalidShape();
  }
  if (
    requiredUuid(value.organization_id)
    !== requiredUuid(expectedOrganizationId)
  ) {
    return invalidShape();
  }
  // `resolve_stop_factor` links only `event_type = 'payment'`. Offering any
  // other event in the picker would produce a guaranteed rejection on submit.
  if (value.event_type !== "payment") return invalidShape();
  if (
    typeof value.currency !== "string"
    || !CURRENCY_PATTERN.test(value.currency)
  ) {
    return invalidShape();
  }
  return {
    paymentEventId: requiredUuid(value.id),
    paymentObligationId: requiredUuid(value.payment_obligation_id),
    studentCaseId: requiredUuid(value.student_case_id),
    amountMinor: positiveSafeInteger(value.amount_minor),
    currency: value.currency,
    occurredAt: requiredTimestamp(value.occurred_at),
  };
}

export function normalizePlatformStopFactorOwnerOptions(
  memberships: readonly unknown[],
  profiles: readonly unknown[],
  expectedOrganizationId: string,
): readonly PlatformStopFactorOwnerOption[] {
  const organizationId = requiredUuid(expectedOrganizationId);
  const displayNames = new Map<string, string>();
  for (const profile of profiles) {
    if (
      !isRecord(profile)
      || !hasExactKeys(profile, ["id", "display_name", "status"])
    ) {
      return invalidShape();
    }
    if (profile.status !== "active") return invalidShape();
    const profileId = requiredUuid(profile.id);
    if (displayNames.has(profileId)) return invalidShape();
    displayNames.set(profileId, requiredText(profile.display_name, 200));
  }
  const seen = new Set<string>();
  const options: PlatformStopFactorOwnerOption[] = [];
  for (const membership of memberships) {
    if (
      !isRecord(membership)
      || !hasExactKeys(membership, [
        "id",
        "organization_id",
        "profile_id",
        "status",
        "current_role",
      ])
    ) {
      return invalidShape();
    }
    if (requiredUuid(membership.organization_id) !== organizationId) {
      return invalidShape();
    }
    if (membership.status !== "active") return invalidShape();
    oneOf(membership.current_role, STOP_FACTOR_READ_ROLES);
    const membershipId = requiredUuid(membership.id);
    if (seen.has(membershipId)) return invalidShape();
    seen.add(membershipId);
    const displayName = displayNames.get(requiredUuid(membership.profile_id));
    // A membership whose profile is missing or inactive is not selectable.
    if (displayName === undefined) continue;
    options.push({ membershipId, displayName });
  }
  return options.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "ru")
  );
}

export async function listPlatformStopFactors(
  actor: PlatformActor,
  options: PlatformStopFactorRepositoryOptions = {},
): Promise<readonly PlatformStopFactor[]> {
  const organizationId = requireStopFactorReadActor(actor);
  try {
    const client = options.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .from("stop_factors")
      .select(
        "id,organization_id,student_case_id,payment_obligation_id,status,"
        + "reason,owner_membership_id,blocked_action,next_action,created_at,"
        + "resolution_kind,resolution_reason,resolved_at",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    const seen = new Set<string>();
    return response.data.map((value) => {
      const row = normalizePlatformStopFactor(value, organizationId);
      if (seen.has(row.stopFactorId)) return invalidShape();
      seen.add(row.stopFactorId);
      return row;
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformStopFactorObligations(
  actor: PlatformActor,
  options: PlatformStopFactorRepositoryOptions = {},
): Promise<readonly PlatformStopFactorObligation[]> {
  const organizationId = requireStopFactorReadActor(actor);
  try {
    const client = options.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .from("payment_obligations")
      .select(
        "id,organization_id,student_case_id,label,category,amount_minor,"
        + "currency,due_at,total_paid_minor,total_refunded_minor",
      )
      .eq("organization_id", organizationId)
      .order("due_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500);
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    const seen = new Set<string>();
    return response.data.map((value) => {
      const row = normalizePlatformStopFactorObligation(value, organizationId);
      if (seen.has(row.paymentObligationId)) return invalidShape();
      seen.add(row.paymentObligationId);
      return row;
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformStopFactorPaymentEvents(
  actor: PlatformActor,
  options: PlatformStopFactorRepositoryOptions = {},
): Promise<readonly PlatformStopFactorPaymentEvent[]> {
  const organizationId = requireStopFactorReadActor(actor);
  try {
    const client = options.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .from("payment_events")
      .select(
        "id,organization_id,student_case_id,payment_obligation_id,event_type,"
        + "amount_minor,currency,occurred_at",
      )
      .eq("organization_id", organizationId)
      .eq("event_type", "payment")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    const seen = new Set<string>();
    return response.data.map((value) => {
      const row = normalizePlatformStopFactorPaymentEvent(value, organizationId);
      if (seen.has(row.paymentEventId)) return invalidShape();
      seen.add(row.paymentEventId);
      return row;
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformStopFactorOwners(
  actor: PlatformActor,
  options: PlatformStopFactorRepositoryOptions = {},
): Promise<readonly PlatformStopFactorOwnerOption[]> {
  const organizationId = requireStopFactorReadActor(actor);
  try {
    const client = options.client ?? await getPlatformClient();
    const membershipsResponse = await client
      .schema("platform")
      .from("organization_memberships")
      .select("id,organization_id,profile_id,status,current_role")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("current_role", [...STOP_FACTOR_READ_ROLES]);
    if (membershipsResponse.error || !Array.isArray(membershipsResponse.data)) {
      return invalidShape();
    }
    if (membershipsResponse.data.length === 0) return [];
    const profileIds = membershipsResponse.data.map((membership) => {
      if (!isRecord(membership)) return invalidShape();
      return requiredUuid(membership.profile_id);
    });
    const profilesResponse = await client
      .schema("platform")
      .from("profiles")
      .select("id,display_name,status")
      .in("id", profileIds)
      .eq("status", "active");
    if (profilesResponse.error || !Array.isArray(profilesResponse.data)) {
      return invalidShape();
    }
    return normalizePlatformStopFactorOwnerOptions(
      membershipsResponse.data,
      profilesResponse.data,
      organizationId,
    );
  } catch (error) {
    return failClosed(error);
  }
}
