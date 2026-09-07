import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlatformActor } from "../platform-auth.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_ERROR_MESSAGE = "Student portal curator options are unavailable.";

export type StudentPortalCuratorOption = Readonly<{
  membershipId: string;
  displayName: string;
}>;

type StudentPortalCuratorOptionsRepositoryOptions = Readonly<{
  client?: SupabaseClient;
}>;

export class StudentPortalCuratorOptionsError extends Error {
  constructor() {
    super(SAFE_ERROR_MESSAGE);
    this.name = "StudentPortalCuratorOptionsError";
  }
}

function invalidShape(): never {
  throw new StudentPortalCuratorOptionsError();
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

async function getPlatformClient(): Promise<SupabaseClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  return createSupabaseServerClient();
}

export function normalizeStudentPortalCuratorOptions(
  membershipRows: unknown,
  profileRows: unknown,
  expectedOrganizationId: string,
): readonly StudentPortalCuratorOption[] {
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

export async function listStudentPortalActiveCurators(
  actor: PlatformActor,
  options: StudentPortalCuratorOptionsRepositoryOptions = {},
): Promise<readonly StudentPortalCuratorOption[]> {
  const organizationId = requiredUuid(actor.organizationId);
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

    return normalizeStudentPortalCuratorOptions(
      membershipsResponse.data,
      profilesResponse.data,
      organizationId,
    );
  } catch (error) {
    if (error instanceof StudentPortalCuratorOptionsError) throw error;
    throw new StudentPortalCuratorOptionsError();
  }
}
