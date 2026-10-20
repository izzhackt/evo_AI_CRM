import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  StudentPortalAuthUserResult,
  StudentPortalInviteAuthProvider,
  StudentPortalProviderInviteResult,
} from "./student-portal-invite-coordinator.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numericStatus(error: unknown): number | null {
  const value = record(error)?.status;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function errorCode(error: unknown): string | null {
  const value = record(error)?.code;
  return typeof value === "string" ? value : null;
}

function isOccupiedEmailError(error: unknown): boolean {
  const status = numericStatus(error);
  if (status === null || status < 400 || status >= 500) return false;
  const code = errorCode(error);
  return code === "email_exists" || code === "email_address_exists";
}

function classifyInviteError(error: unknown): StudentPortalProviderInviteResult {
  const status = numericStatus(error);
  if (status === null || status < 400 || status >= 500) {
    return { status: "unknown", code: "provider_outcome_unknown" };
  }

  if (status === 429 || errorCode(error) === "over_email_send_rate_limit") {
    return { status: "definite_failure", code: "provider_rate_limited" };
  }
  return { status: "definite_failure", code: "provider_rejected" };
}

/**
 * PORT-1b: exact occupied-email classification instead of the one-size
 * `portal_invite_already_accepted`. The lookup runs against the trusted
 * Admin API only; when it cannot answer, the legacy code stays the honest
 * fallback (the email IS occupied — only the kind is unknown).
 */
function classifyOccupiedEmail(user: Record<string, unknown> | null): string {
  if (user === null) return "portal_invite_already_accepted";
  const staffMarker = record(user.app_metadata)?.evo_staff_password_request_id;
  if (typeof staffMarker === "string" && staffMarker.length > 0) {
    return "existing_staff_account";
  }
  if (timestampOrNull(user.invited_at) !== null) {
    return "already_accepted_invite";
  }
  return "existing_student_account";
}

function timestampOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized.length >= 3 &&
    normalized.length <= 320 &&
    normalized.includes("@") &&
    !/\s/.test(normalized)
    ? normalized
    : null;
}

function decodeAuthUser(value: unknown): StudentPortalAuthUserResult {
  const user = record(value);
  if (!user) return { status: "missing", user: null };
  if (
    typeof user.id !== "string" ||
    !UUID_PATTERN.test(user.id) ||
    typeof user.email !== "string" ||
    user.email.length === 0
  ) {
    return { status: "unavailable", user: null };
  }
  return {
    status: "found",
    user: {
      authUserId: user.id,
      email: user.email,
      confirmedAt: timestampOrNull(user.email_confirmed_at ?? user.confirmed_at),
      confirmationSentAt: timestampOrNull(user.confirmation_sent_at),
    },
  };
}

export type RawAuthUserLookup = Readonly<{
  status: "found" | "missing" | "unavailable";
  user: Record<string, unknown> | null;
}>;

/**
 * Exact, case-insensitive address match by one point lookup in the database
 * (`platform.auth_user_by_exact_email_v1`, migration 313, callable by the
 * service role only). It replaced the page-by-page `auth.admin.listUsers`
 * scan, whose cost grew with every Auth user and which failed closed from
 * about 9000 users on. The answer carries only the fields read here and the
 * two staff markers. Two matches, an error, or an answer that is not exactly
 * the requested address is "unavailable", never a guess.
 */
export async function findRawAuthUserByExactEmail(
  client: Pick<SupabaseClient, "schema">,
  normalizedEmail: string,
): Promise<RawAuthUserLookup> {
  try {
    const { data, error } = await client
      .schema("platform")
      .rpc("auth_user_by_exact_email_v1", { p_email: normalizedEmail });
    if (error) return { status: "unavailable", user: null };
    if (data === null) return { status: "missing", user: null };
    const user = record(data);
    if (
      user === null ||
      typeof user.id !== "string" ||
      !UUID_PATTERN.test(user.id) ||
      normalizeEmail(user.email) !== normalizedEmail
    ) {
      return { status: "unavailable", user: null };
    }
    return { status: "found", user };
  } catch {
    return { status: "unavailable", user: null };
  }
}

/**
 * Wraps the trusted Supabase Admin API without exposing metadata, provider
 * bodies or the service credential to the coordinator result.
 *
 * @see https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
 */
export function createStudentPortalInviteAuthProvider(
  client: Pick<SupabaseClient, "auth" | "schema">,
): StudentPortalInviteAuthProvider {
  return Object.freeze({
    async inviteUserByEmail(input): Promise<StudentPortalProviderInviteResult> {
      try {
        const { data, error } = await client.auth.admin.inviteUserByEmail(
          input.email,
          { redirectTo: input.redirectTo },
        );
        if (error) {
          if (isOccupiedEmailError(error)) {
            const normalized = normalizeEmail(input.email);
            const occupant = normalized === null
              ? { status: "unavailable" as const, user: null }
              : await findRawAuthUserByExactEmail(client, normalized);
            return {
              status: "definite_failure",
              code: classifyOccupiedEmail(
                occupant.status === "found" ? occupant.user : null,
              ),
            };
          }
          return classifyInviteError(error);
        }

        const user = record(data)?.user;
        const authUserId = record(user)?.id;
        return typeof authUserId === "string" && UUID_PATTERN.test(authUserId)
          ? { status: "success", authUserId }
          : { status: "unknown", code: "provider_outcome_unknown" };
      } catch {
        return { status: "unknown", code: "provider_outcome_unknown" };
      }
    },

    async readUserById(authUserId): Promise<StudentPortalAuthUserResult> {
      try {
        const { data, error } = await client.auth.admin.getUserById(authUserId);
        if (error) {
          return numericStatus(error) === 404
            ? { status: "missing", user: null }
            : { status: "unavailable", user: null };
        }

        return decodeAuthUser(record(data)?.user);
      } catch {
        return { status: "unavailable", user: null };
      }
    },

    async findUserByExactEmail(normalizedEmail): Promise<StudentPortalAuthUserResult> {
      const expectedEmail = normalizeEmail(normalizedEmail);
      if (expectedEmail !== normalizedEmail) {
        return { status: "unavailable", user: null };
      }
      const raw = await findRawAuthUserByExactEmail(client, expectedEmail);
      if (raw.status !== "found") return { status: raw.status, user: null };
      const decoded = decodeAuthUser(raw.user);
      return decoded.status === "found"
        ? decoded
        : { status: "unavailable", user: null };
    },
  });
}
