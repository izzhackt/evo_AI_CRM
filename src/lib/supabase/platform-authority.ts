import type { JwtPayload, SupabaseClient } from "@supabase/supabase-js";

export const DATABASE_STAFF_ROLES = ["admin", "sales", "curator"] as const;

export type DatabaseStaffRole = (typeof DATABASE_STAFF_ROLES)[number];
export type InterfaceStaffRole = "admin" | "sales" | "admissions";

export function databaseRoleToInterfaceRole(
  role: DatabaseStaffRole,
): InterfaceStaffRole {
  return role === "curator" ? "admissions" : role;
}

export type VerifiedPlatformAuthority = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  databaseRole: DatabaseStaffRole;
  platformAccessVersion: number;
  platformBundleId: string;
  platformBundleVersion: number;
  email: string;
}>;

export type PlatformAuthorityResult =
  | Readonly<{ status: "authenticated"; authority: VerifiedPlatformAuthority }>
  | Readonly<{ status: "invalid"; authority: null }>
  | Readonly<{ status: "unavailable"; authority: null }>;

type AuthorityRow = Readonly<{
  auth_user_id?: unknown;
  profile_id?: unknown;
  membership_id?: unknown;
  organization_id?: unknown;
  display_name?: unknown;
  platform_role?: unknown;
  platform_access_version?: unknown;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function positiveInteger(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numberValue) && numberValue > 0
    ? numberValue
    : null;
}

function isDatabaseStaffRole(value: unknown): value is DatabaseStaffRole {
  return (
    typeof value === "string" &&
    (DATABASE_STAFF_ROLES as readonly string[]).includes(value)
  );
}

function oneAuthorityRow(data: unknown): AuthorityRow | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  return typeof row === "object" && row !== null ? (row as AuthorityRow) : null;
}

/**
 * Cross-checks a cryptographically verified Supabase JWT against the live
 * profile, membership, organization, bundle and access-version rows. The RPC
 * returns no row as soon as any part of that authority is stale or disabled.
 */
export async function readVerifiedPlatformAuthority(
  client: SupabaseClient,
  claims: JwtPayload,
): Promise<PlatformAuthorityResult> {
  const authUserId = claims.sub;
  const email = claims.email;
  const bundleId = claims.platform_bundle_id;
  const bundleVersion = positiveInteger(claims.platform_bundle_version);

  if (
    !isUuid(authUserId) ||
    typeof email !== "string" ||
    email.length === 0 ||
    !isUuid(bundleId) ||
    bundleVersion === null
  ) {
    return { status: "invalid", authority: null };
  }

  const { data, error } = await client
    .schema("platform")
    .rpc("current_actor_authority");
  if (error) return { status: "unavailable", authority: null };

  const row = oneAuthorityRow(data);
  if (!row) return { status: "invalid", authority: null };

  const accessVersion = positiveInteger(row.platform_access_version);
  if (
    row.auth_user_id !== authUserId ||
    !isUuid(row.profile_id) ||
    !isUuid(row.membership_id) ||
    !isUuid(row.organization_id) ||
    typeof row.display_name !== "string" ||
    row.display_name.trim().length === 0 ||
    !isDatabaseStaffRole(row.platform_role) ||
    accessVersion === null
  ) {
    return { status: "invalid", authority: null };
  }

  return {
    status: "authenticated",
    authority: {
      authUserId,
      profileId: row.profile_id,
      membershipId: row.membership_id,
      organizationId: row.organization_id,
      displayName: row.display_name,
      databaseRole: row.platform_role,
      platformAccessVersion: accessVersion,
      platformBundleId: bundleId,
      platformBundleVersion: bundleVersion,
      email,
    },
  };
}
