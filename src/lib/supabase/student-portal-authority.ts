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
  /**
   * Unified workflow (S1): a portal cabinet can be activated before a sale —
   * 'pending' with portal_activated_at set (public анкета approval, plan §4).
   * No curator/direction exist yet in that state; the portal UI must not
   * assume either.
   */
  caseState: "pending" | "active" | "closed";
  /**
   * PORT-1a (PORT-0 «Решение: модель доступа»): the single checkable tier
   * boundary for web and iPhone instead of scattered `caseState === 'pending'`
   * checks. Derived, never stored: 'approved' = a portal-activated pending
   * cabinet (обзор, каталог, тесты, уведомления, профиль); 'assisted' =
   * active/closed сопровождение (плюс документы и case-help — migration 195
   * enforces the same boundary in PostgreSQL).
   */
  accessTier: "approved" | "assisted";
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
    (portalCase.case_state !== "pending" && portalCase.case_state !== "active" && portalCase.case_state !== "closed") ||
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
    accessTier: portalCase.case_state === "pending" ? "approved" : "assisted",
    portalActivatedAt,
  });
}

/** True when a `current_actor_authority` answer is one Student row. */
export function isStudentAuthorityRow(authorityData: unknown): boolean {
  return oneRecord(authorityData)?.platform_role === "student";
}

/**
 * Interprets the two live RPC answers exactly like the sequential reader: a
 * non-Student authority row is rejected before the portal projection is
 * considered, and a valid Student is decoded only from both rows. `cases`
 * absent means the projection was not read (the caller must read it live).
 */
export function studentPortalAuthorityFromRows(
  claims: JwtPayload,
  authorityData: unknown,
  portalCaseData: unknown,
): StudentPortalAuthorityResult {
  const authority = oneRecord(authorityData);
  if (authority?.platform_role !== "student") {
    return { status: "invalid", authority: null };
  }
  const decoded = decodeVerifiedStudentPortalAuthority(
    claims,
    authorityData,
    portalCaseData,
  );
  return decoded
    ? { status: "authenticated", authority: decoded }
    : { status: "invalid", authority: null };
}

export type StudentPortalAuthorityRead = Readonly<{
  result: StudentPortalAuthorityResult;
  /** Raw successful RPC answers, for the request-bound proxy handoff. */
  rows: Readonly<{ actor?: unknown; cases?: unknown }>;
}>;

/**
 * Same chain as {@link readVerifiedStudentPortalAuthority}. With
 * `parallel` (the proxy on Student routes only) both RPCs start together:
 * each repeats its own database authorization (`student_portal_cases()`
 * returns nothing for a non-Student), and the answer is interpreted in the
 * same order, so a staff actor's projection is never used.
 */
export async function readStudentPortalAuthorityRows(
  client: StudentPortalAuthorityClient,
  claims: JwtPayload,
  options: Readonly<{ parallel?: boolean }> = {},
): Promise<StudentPortalAuthorityRead> {
  const authorityRead = client.schema("platform").rpc("current_actor_authority");
  const portalRead = options.parallel
    ? client.schema("platform").rpc("student_portal_cases")
    : null;
  // A parallel projection read must never reject unobserved.
  const portalSettled = portalRead ? Promise.resolve(portalRead).catch((error: unknown) => ({ data: null, error })) : null;
  const authorityResponse = await authorityRead;
  if (authorityResponse.error) {
    return { result: { status: "unavailable", authority: null }, rows: {} };
  }

  // Reject staff and malformed authority before asking a Portal projection to
  // disclose anything. A valid Student is decoded only after both rows exist.
  const authority = oneRecord(authorityResponse.data);
  if (authority?.platform_role !== "student") {
    return { result: { status: "invalid", authority: null }, rows: { actor: authorityResponse.data } };
  }

  const portalResponse = portalSettled
    ? await portalSettled
    : await client.schema("platform").rpc("student_portal_cases");
  if (portalResponse.error) {
    return { result: { status: "unavailable", authority: null }, rows: {} };
  }

  return {
    result: studentPortalAuthorityFromRows(claims, authorityResponse.data, portalResponse.data),
    rows: { actor: authorityResponse.data, cases: portalResponse.data },
  };
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
  return (await readStudentPortalAuthorityRows(client, claims)).result;
}
