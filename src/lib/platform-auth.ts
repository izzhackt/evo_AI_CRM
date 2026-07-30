import {
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Role } from "./roles";
import {
  createSupabaseServerContext,
  type SupabaseServerContext,
} from "./supabase/server";

export const PLATFORM_ROLES = [
  "admin",
  "sales",
  "curator",
  "finance",
  "student",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type PlatformActor = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  platformRole: PlatformRole;
  platformAccessVersion: number;
  /**
   * Compatibility role for the accepted frontend. Authorization must use
   * platformRole; only the database `student` role is renamed to UI `client`.
   */
  role: Role;
}>;

export type PlatformActorInvalidReason =
  | "auth_verification_failed"
  | "claims_invalid"
  | "authority_lookup_failed"
  | "authority_not_found"
  | "authority_invalid"
  | "authority_mismatch";

export type PlatformActorResult =
  | Readonly<{
      status: "anonymous";
      actor: null;
    }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason: PlatformActorInvalidReason;
    }>
  | Readonly<{
      status: "authenticated";
      actor: PlatformActor;
    }>;

type VerifiedAuthorityClaims = Readonly<{
  authUserId: string;
  platformRole: PlatformRole;
  platformAccessVersion: number;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;

  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function parsePlatformRole(value: unknown): PlatformRole | null {
  return typeof value === "string" &&
    (PLATFORM_ROLES as readonly string[]).includes(value)
    ? (value as PlatformRole)
    : null;
}

function parseAccessVersion(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseClaims(value: unknown): VerifiedAuthorityClaims | null {
  if (!isRecord(value) || value.role !== "authenticated") return null;

  const authUserId = parseUuid(value.sub);
  const platformRole = parsePlatformRole(value.platform_role);
  const platformAccessVersion = parseAccessVersion(
    value.platform_access_version,
  );

  if (!authUserId || !platformRole || !platformAccessVersion) return null;
  return { authUserId, platformRole, platformAccessVersion };
}

function toUiRole(platformRole: PlatformRole): Role {
  return platformRole === "student" ? "client" : platformRole;
}

function invalid(reason: PlatformActorInvalidReason): PlatformActorResult {
  return { status: "invalid", actor: null, reason };
}

function parseAuthority(
  value: unknown,
  claims: VerifiedAuthorityClaims,
): PlatformActorResult {
  if (!isRecord(value)) return invalid("authority_invalid");

  const authUserId = parseUuid(value.auth_user_id);
  const profileId = parseUuid(value.profile_id);
  const membershipId = parseUuid(value.membership_id);
  const organizationId = parseUuid(value.organization_id);
  const platformRole = parsePlatformRole(value.platform_role);
  const platformAccessVersion = parseAccessVersion(
    value.platform_access_version,
  );
  const displayName =
    typeof value.display_name === "string" ? value.display_name.trim() : "";

  if (
    !authUserId ||
    !profileId ||
    !membershipId ||
    !organizationId ||
    !platformRole ||
    !platformAccessVersion ||
    displayName.length === 0
  ) {
    return invalid("authority_invalid");
  }

  if (
    authUserId !== claims.authUserId ||
    platformRole !== claims.platformRole ||
    platformAccessVersion !== claims.platformAccessVersion
  ) {
    return invalid("authority_mismatch");
  }

  return {
    status: "authenticated",
    actor: {
      authUserId,
      profileId,
      membershipId,
      organizationId,
      displayName,
      platformRole,
      platformAccessVersion,
      role: toUiRole(platformRole),
    },
  };
}

async function resolveClient(
  client: SupabaseClient | undefined,
  authCookiePresent: boolean | undefined,
): Promise<SupabaseServerContext> {
  if (client) {
    return {
      client,
      authCookiePresent: authCookiePresent ?? false,
    };
  }
  return createSupabaseServerContext();
}

/**
 * Resolves a server actor from a cryptographically verified Supabase JWT and
 * the live fail-closed Platform authority RPC. getSession() is intentionally
 * never used as authorization evidence.
 */
export async function resolvePlatformActor(
  client?: SupabaseClient,
  authCookiePresent?: boolean,
): Promise<PlatformActorResult> {
  const context = await resolveClient(client, authCookiePresent);

  let claimsResponse: Awaited<
    ReturnType<SupabaseClient["auth"]["getClaims"]>
  >;
  try {
    claimsResponse = await context.client.auth.getClaims();
  } catch {
    return invalid("auth_verification_failed");
  }

  if (claimsResponse.error) {
    if (
      isAuthSessionMissingError(claimsResponse.error) &&
      !context.authCookiePresent
    ) {
      return { status: "anonymous", actor: null };
    }
    return invalid("auth_verification_failed");
  }

  const rawClaims = claimsResponse.data?.claims;
  const claims = parseClaims(rawClaims);
  if (!claims) {
    if (!context.authCookiePresent && rawClaims == null) {
      return { status: "anonymous", actor: null };
    }
    return invalid("claims_invalid");
  }

  let authorityResponse: {
    data: unknown;
    error: unknown;
  };
  try {
    authorityResponse = await context.client
      .schema("platform")
      .rpc("current_actor_authority");
  } catch {
    return invalid("authority_lookup_failed");
  }

  if (authorityResponse.error) return invalid("authority_lookup_failed");
  if (!Array.isArray(authorityResponse.data)) {
    return invalid("authority_invalid");
  }
  if (authorityResponse.data.length === 0) {
    return invalid("authority_not_found");
  }
  if (authorityResponse.data.length !== 1) {
    return invalid("authority_invalid");
  }

  return parseAuthority(authorityResponse.data[0], claims);
}
