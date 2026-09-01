import { cookies } from "next/headers";

import {
  FIXED_ROLES,
  isFixedRole,
  type FixedRole,
} from "./fixed-role-policy.ts";
import { createSupabaseServerClient } from "./supabase/server.ts";
import {
  databaseRoleToInterfaceRole,
  readVerifiedPlatformAuthority,
} from "./supabase/platform-authority.ts";

export const ACTIVE_PLATFORM_ROLES = FIXED_ROLES;
export const ADMIN_ROLE_PREVIEW_COOKIE = "evo_admin_role_preview";

export const HISTORICAL_PLATFORM_ROLES = ["finance", "student"] as const;

export type HistoricalPlatformRole = (typeof HISTORICAL_PLATFORM_ROLES)[number];
export type PlatformRole = FixedRole | HistoricalPlatformRole;

export type PlatformActor<Role extends PlatformRole = FixedRole> = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  email: string;
  platformRole: Role;
  authorityRole: FixedRole;
  platformAccessVersion: number;
  platformBundleId: string;
  platformBundleVersion: number;
}>;

export type ActivePlatformActor = PlatformActor<FixedRole>;

/** Repository-only tail for the frozen student portal and unreplaced slices. */
export type HistoricalRepositoryActor = PlatformActor<PlatformRole>;

export type PlatformActorInvalidReason =
  | "supabase_session_invalid"
  | "staff_authority_invalid"
  | "staff_authority_unavailable";

export type PlatformActorResult =
  | Readonly<{ status: "anonymous"; actor: null }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason: PlatformActorInvalidReason;
    }>
  | Readonly<{ status: "authenticated"; actor: ActivePlatformActor }>;

async function adminPreviewRole(authorityRole: FixedRole): Promise<FixedRole> {
  if (authorityRole !== "admin") return authorityRole;
  const requestedRole = (await cookies()).get(ADMIN_ROLE_PREVIEW_COOKIE)?.value;
  return isFixedRole(requestedRole) ? requestedRole : authorityRole;
}

export async function resolvePlatformActor(): Promise<PlatformActorResult> {
  let client;
  try {
    client = await createSupabaseServerClient();
  } catch {
    return {
      status: "invalid",
      actor: null,
      reason: "staff_authority_unavailable",
    };
  }

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  if (claimsError) {
    const missingSession = claimsError.name === "AuthSessionMissingError";
    return missingSession
      ? { status: "anonymous", actor: null }
      : {
          status: "invalid",
          actor: null,
          reason: "supabase_session_invalid",
        };
  }
  if (!claimsData?.claims) return { status: "anonymous", actor: null };

  const authorityResult = await readVerifiedPlatformAuthority(
    client,
    claimsData.claims,
  );
  if (authorityResult.status !== "authenticated") {
    return {
      status: "invalid",
      actor: null,
      reason:
        authorityResult.status === "unavailable"
          ? "staff_authority_unavailable"
          : "staff_authority_invalid",
    };
  }

  const authority = authorityResult.authority;
  const authorityRole = databaseRoleToInterfaceRole(authority.databaseRole);
  const platformRole = await adminPreviewRole(authorityRole);
  return {
    status: "authenticated",
    actor: {
      authUserId: authority.authUserId,
      profileId: authority.profileId,
      membershipId: authority.membershipId,
      organizationId: authority.organizationId,
      displayName: authority.displayName,
      email: authority.email,
      platformRole,
      authorityRole,
      platformAccessVersion: authority.platformAccessVersion,
      platformBundleId: authority.platformBundleId,
      platformBundleVersion: authority.platformBundleVersion,
    },
  };
}
