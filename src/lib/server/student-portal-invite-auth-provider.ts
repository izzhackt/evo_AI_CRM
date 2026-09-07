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

function classifyInviteError(error: unknown): StudentPortalProviderInviteResult {
  const status = numericStatus(error);
  if (status === null || status < 400 || status >= 500) {
    return { status: "unknown", code: "provider_outcome_unknown" };
  }

  const code = errorCode(error);
  if (code === "email_exists" || code === "email_address_exists") {
    return {
      status: "definite_failure",
      code: "portal_invite_already_accepted",
    };
  }
  if (status === 429 || code === "over_email_send_rate_limit") {
    return { status: "definite_failure", code: "provider_rate_limited" };
  }
  return { status: "definite_failure", code: "provider_rejected" };
}

function timestampOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

/**
 * Wraps the trusted Supabase Admin API without exposing metadata, provider
 * bodies or the service credential to the coordinator result.
 *
 * @see https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
 */
export function createStudentPortalInviteAuthProvider(
  client: Pick<SupabaseClient, "auth">,
): StudentPortalInviteAuthProvider {
  return Object.freeze({
    async inviteUserByEmail(input): Promise<StudentPortalProviderInviteResult> {
      try {
        const { data, error } = await client.auth.admin.inviteUserByEmail(
          input.email,
          { redirectTo: input.redirectTo },
        );
        if (error) return classifyInviteError(error);

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

        const user = record(record(data)?.user);
        if (!user) return { status: "missing", user: null };
        if (
          typeof user.id !== "string" ||
          !UUID_PATTERN.test(user.id) ||
          typeof user.email !== "string" ||
          user.email.length === 0
        ) {
          return { status: "unavailable", user: null };
        }

        const confirmationSentAt = timestampOrNull(user.confirmation_sent_at);
        const confirmedAt = timestampOrNull(
          user.email_confirmed_at ?? user.confirmed_at,
        );
        return {
          status: "found",
          user: {
            authUserId: user.id,
            email: user.email,
            confirmedAt,
            confirmationSentAt,
          },
        };
      } catch {
        return { status: "unavailable", user: null };
      }
    },
  });
}
