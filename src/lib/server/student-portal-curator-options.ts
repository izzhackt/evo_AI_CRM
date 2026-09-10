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
  value: unknown,
  expectedOrganizationId: string,
): readonly StudentPortalCuratorOption[] {
  const organizationId = requiredUuid(expectedOrganizationId);
  if (!isRecord(value)
    || Object.keys(value).sort().join(",") !== "organization_id,owners"
    || requiredUuid(value.organization_id) !== organizationId
    || !Array.isArray(value.owners) || value.owners.length > 100
  ) {
    return invalidShape();
  }
  const seenMemberships = new Set<string>();
  const options = value.owners.map((owner) => {
    if (!isRecord(owner)
      || Object.keys(owner).sort().join(",") !== "display_name,membership_id"
    ) {
      return invalidShape();
    }
    const membershipId = requiredUuid(owner.membership_id);
    const displayName = requiredDisplayName(owner.display_name);
    if (seenMemberships.has(membershipId)) return invalidShape();
    seenMemberships.add(membershipId);
    return Object.freeze({ membershipId, displayName });
  });

  return Object.freeze(options.sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
    || left.membershipId.localeCompare(right.membershipId)
  ));
}

export async function listStudentPortalActiveCurators(
  actor: PlatformActor,
  options: StudentPortalCuratorOptionsRepositoryOptions = {},
): Promise<readonly StudentPortalCuratorOption[]> {
  const organizationId = requiredUuid(actor.organizationId);
  if (actor.authorityRole !== "admin") return invalidShape();

  try {
    const client = options.client ?? await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("staff_student_portal_curator_options", {
        p_organization_id: organizationId,
      });
    if (response.error) {
      return invalidShape();
    }
    return normalizeStudentPortalCuratorOptions(response.data, organizationId);
  } catch (error) {
    if (error instanceof StudentPortalCuratorOptionsError) throw error;
    throw new StudentPortalCuratorOptionsError();
  }
}
