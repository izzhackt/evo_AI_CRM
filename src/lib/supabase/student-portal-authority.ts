import type { JwtPayload, SupabaseClient } from "@supabase/supabase-js";

export type VerifiedStudentPortalAuthority = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  studentCaseId: string;
  displayName: string;
  email: string;
  databaseRole: "student";
  platformAccessVersion: number;
  platformBundleId: string;
  platformBundleVersion: number;
  caseState: "active" | "closed";
  portalActivatedAt: string;
}>;

export type StudentPortalAuthorityResult =
  | Readonly<{
      status: "authenticated";
      authority: VerifiedStudentPortalAuthority;
    }>
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

type PortalCaseRow = Readonly<{
  case_id?: unknown;
  case_state?: unknown;
  portal_activated_at?: unknown;
}>;

type StudentPortalAuthorityClient = Pick<SupabaseClient, "schema">;

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

function oneRecord(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : null;
}

function activePortalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : null;
}

/**
 * Decodes Student authority independently from the staff decoder. The JWT's
 * `user_metadata` is deliberately not an input: authority is the verified
 * claims/bundle plus the live RPC rows guarded by organization and exact-case
 * scope in PostgreSQL.
 */
export function decodeVerifiedStudentPortalAuthority(
  claims: JwtPayload,
  authorityData: unknown,
  portalCaseData: unknown,
): VerifiedStudentPortalAuthority | null {
  const authUserId = claims.sub;
  const email = claims.email;
  const bundleId = claims.platform_bundle_id;
  const bundleVersion = positiveInteger(claims.platform_bundle_version);
  const authority = oneRecord(authorityData) as AuthorityRow | null;
  const portalCase = oneRecord(portalCaseData) as PortalCaseRow | null;
  const accessVersion = positiveInteger(authority?.platform_access_version);
  const portalActivatedAt = activePortalTimestamp(
    portalCase?.portal_activated_at,
  );

  if (
    !isUuid(authUserId) ||
    typeof email !== "string" ||
    email.trim().length === 0 ||
    !isUuid(bundleId) ||
    bundleVersion === null ||
    authority?.auth_user_id !== authUserId ||
    !isUuid(authority.profile_id) ||
    !isUuid(authority.membership_id) ||
    !isUuid(authority.organization_id) ||
    typeof authority.display_name !== "string" ||
    authority.display_name.trim().length === 0 ||
    authority.platform_role !== "student" ||
    accessVersion === null ||
    !isUuid(portalCase?.case_id) ||
    (portalCase.case_state !== "active" && portalCase.case_state !== "closed") ||
    portalActivatedAt === null
  ) {
    return null;
  }

  return Object.freeze({
    authUserId,
    profileId: authority.profile_id,
    membershipId: authority.membership_id,
    organizationId: authority.organization_id,
    studentCaseId: portalCase.case_id,
    displayName: authority.display_name,
    email: email.trim(),
    databaseRole: "student",
    platformAccessVersion: accessVersion,
    platformBundleId: bundleId,
    platformBundleVersion: bundleVersion,
    caseState: portalCase.case_state,
    portalActivatedAt,
  });
}

/**
 * `student_portal_cases()` repeats `platform_can_read_student_portal_case`, so
 * one decoded row proves active Student identity, organization scope, portal
 * permission/activation and the exact current student-case scope together.
 */
export async function readVerifiedStudentPortalAuthority(
  client: StudentPortalAuthorityClient,
  claims: JwtPayload,
): Promise<StudentPortalAuthorityResult> {
  const authorityResponse = await client
    .schema("platform")
    .rpc("current_actor_authority");
  if (authorityResponse.error) {
    return { status: "unavailable", authority: null };
  }

  // Reject staff and malformed authority before asking a Portal projection to
  // disclose anything. A valid Student is decoded only after both rows exist.
  const authority = oneRecord(authorityResponse.data);
  if (authority?.platform_role !== "student") {
    return { status: "invalid", authority: null };
  }

  const portalResponse = await client
    .schema("platform")
    .rpc("student_portal_cases");
  if (portalResponse.error) {
    return { status: "unavailable", authority: null };
  }

  const decoded = decodeVerifiedStudentPortalAuthority(
    claims,
    authorityResponse.data,
    portalResponse.data,
  );
  return decoded
    ? { status: "authenticated", authority: decoded }
    : { status: "invalid", authority: null };
}
