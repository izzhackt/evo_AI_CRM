import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform case assignment data is unavailable.";

export type PlatformStudentCaseAssignmentState = Readonly<{
  organizationId: string;
  studentCaseId: string;
  currentCuratorMembershipId: string | null;
  portalActivatedAt: string | null;
}>;

export type PlatformCuratorOption = Readonly<{
  membershipId: string;
  displayName: string;
}>;

type PlatformCaseAssignmentRepositoryOptions = Readonly<{
  client?: SupabaseClient;
}>;

export class PlatformCaseAssignmentRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCaseAssignmentRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformCaseAssignmentRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || !TIMESTAMPTZ_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function requiredDisplayName(value: unknown): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > 200
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function requireOrganization(actor: PlatformActor): string {
  if (
    actor.platformRole !== "admin"
    && actor.platformRole !== "sales"
    && actor.platformRole !== "curator"
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

export function normalizePlatformStudentCaseAssignmentState(
  value: unknown,
  expectedOrganizationId?: string,
  expectedStudentCaseId?: string,
): PlatformStudentCaseAssignmentState {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  const studentCaseId = requiredUuid(value.id);
  if (
    (expectedOrganizationId && organizationId !== expectedOrganizationId)
    || (expectedStudentCaseId && studentCaseId !== expectedStudentCaseId)
  ) {
    return invalidShape();
  }
  return {
    organizationId,
    studentCaseId,
    currentCuratorMembershipId: optionalUuid(
      value.current_curator_membership_id,
    ),
    portalActivatedAt: optionalTimestamp(value.portal_activated_at),
  };
}

export function normalizePlatformCuratorOptions(
  membershipRows: unknown,
  profileRows: unknown,
  expectedOrganizationId: string,
): readonly PlatformCuratorOption[] {
  const organizationId = requiredUuid(expectedOrganizationId);
  if (!Array.isArray(membershipRows) || !Array.isArray(profileRows)) {
    return invalidShape();
  }

  const profiles = new Map<string, string>();
  for (const rawProfile of profileRows) {
    if (!isRecord(rawProfile) || rawProfile.status !== "active") {
      return invalidShape();
    }
    const profileId = requiredUuid(rawProfile.id);
    if (profiles.has(profileId)) return invalidShape();
    profiles.set(profileId, requiredDisplayName(rawProfile.display_name));
  }

  const seenMemberships = new Set<string>();
  const options = membershipRows.map((rawMembership) => {
    if (
      !isRecord(rawMembership)
      || rawMembership.status !== "active"
      || rawMembership.current_role !== "curator"
      || requiredUuid(rawMembership.organization_id) !== organizationId
    ) {
      return invalidShape();
    }
    const membershipId = requiredUuid(rawMembership.id);
    const profileId = requiredUuid(rawMembership.profile_id);
    const displayName = profiles.get(profileId);
    if (seenMemberships.has(membershipId) || !displayName) return invalidShape();
    seenMemberships.add(membershipId);
    return { membershipId, displayName };
  });

  if (profiles.size !== options.length) return invalidShape();
  return options.sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
    || left.membershipId.localeCompare(right.membershipId)
  );
}

export async function getPlatformStudentCaseAssignmentState(
  actor: PlatformActor,
  id: string,
  options: PlatformCaseAssignmentRepositoryOptions = {},
): Promise<PlatformStudentCaseAssignmentState | null> {
  const organizationId = requireOrganization(actor);
  let studentCaseId: string;
  try {
    studentCaseId = requiredUuid(id);
  } catch (error) {
    if (error instanceof PlatformCaseAssignmentRepositoryError) return null;
    throw error;
  }
  try {
    const client = options.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .from("student_cases")
      .select(
        "id,organization_id,current_curator_membership_id,portal_activated_at",
      )
      .eq("organization_id", organizationId)
      .eq("id", studentCaseId)
      .maybeSingle();
    if (response.error) return invalidShape();
    if (response.data === null) return null;
    return normalizePlatformStudentCaseAssignmentState(
      response.data,
      organizationId,
      studentCaseId,
    );
  } catch (error) {
    if (error instanceof PlatformCaseAssignmentRepositoryError) throw error;
    throw new PlatformCaseAssignmentRepositoryError();
  }
}

export async function listPlatformActiveCurators(
  actor: PlatformActor,
  options: PlatformCaseAssignmentRepositoryOptions = {},
): Promise<readonly PlatformCuratorOption[]> {
  const organizationId = requireOrganization(actor);
  if (actor.platformRole !== "admin") return invalidShape();
  try {
    const client = options.client ?? await getPlatformClient();
    const membershipsResponse = await client
      .schema("platform")
      .from("organization_memberships")
      .select("id,organization_id,profile_id,status,current_role")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .eq("current_role", "curator");
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
    return normalizePlatformCuratorOptions(
      membershipsResponse.data,
      profilesResponse.data,
      organizationId,
    );
  } catch (error) {
    if (error instanceof PlatformCaseAssignmentRepositoryError) throw error;
    throw new PlatformCaseAssignmentRepositoryError();
  }
}
