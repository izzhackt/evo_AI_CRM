/**
 * Student self-service password recovery: pure, client-safe contract.
 *
 * The browser never receives an Auth token from this flow. The request form
 * posts only an email; the recovery session lives in a separate HttpOnly
 * cookie that only the new-password page reads.
 */

export const STUDENT_PASSWORD_FORGOT_PATH = "/auth/forgot-password" as const;
export const STUDENT_PASSWORD_RESET_PATH = "/auth/reset-password" as const;

/**
 * Storage key of the recovery-only Supabase session. It deliberately does not
 * match the `sb-…-auth-token` product session, so the proxy and every product
 * page ignore it, and its cookie path limits it to the new-password page.
 */
export const STUDENT_RECOVERY_SESSION_COOKIE = "evo-student-recovery" as const;
export const STUDENT_RECOVERY_SESSION_MAX_AGE_SECONDS = 15 * 60;

/** Same bounds as public registration (`student-public-registration.ts`). */
export const STUDENT_PASSWORD_MIN_LENGTH = 12;
export const STUDENT_PASSWORD_MAX_BYTES = 72;

/** Same neutral wait as the Auth per-address limit in production (60 s). */
export const STUDENT_RECOVERY_RESEND_SECONDS = 60;

export type StudentRecoveryRequestState = Readonly<{
  status: "idle" | "sent" | "invalid_email" | "rate_limited" | "unavailable";
}>;

export type StudentRecoveryVerifyState =
  | "invalidRequest"
  | "expiredOrUsed"
  | "staffRefused"
  | "invalidIdentity"
  | "authUnavailable"
  | null;

export type StudentRecoveryPasswordState = Readonly<{
  status:
    | "idle"
    | "invalid_request"
    | "mismatch"
    | "too_short"
    | "too_long"
    | "same_password"
    | "rejected"
    | "expired"
    | "staff_refused"
    | "sign_in_required"
    | "unavailable"
    | "done";
}>;

/** Lower-case, trimmed, one `@`, a dot in the domain, no whitespace/controls. */
export function normalizeStudentRecoveryEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    /[\u0000-\u001f\u007f]/u.test(email)
  ) {
    return null;
  }
  return email;
}

export type StudentNewPasswordCheck =
  | "ok"
  | "mismatch"
  | "too_short"
  | "too_long";

export function checkStudentNewPassword(
  password: string,
  confirmation: string,
): StudentNewPasswordCheck {
  if (password.length < STUDENT_PASSWORD_MIN_LENGTH) return "too_short";
  if (new TextEncoder().encode(password).byteLength > STUDENT_PASSWORD_MAX_BYTES) {
    return "too_long";
  }
  return password === confirmation ? "ok" : "mismatch";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The form answers no earlier than this after the request started, so the
 * Auth email send (done inside the request, only for a real account) does
 * not show up as a slower answer.
 */
export const STUDENT_RECOVERY_MIN_RESPONSE_MS = 1_500;

/** Own limits of the public form, in front of the shared Auth limits. */
export const STUDENT_RECOVERY_IP_LIMIT = Object.freeze({ limit: 5, windowMs: 15 * 60_000 });
export const STUDENT_RECOVERY_ADDRESS_LIMIT = Object.freeze({ limit: 3, windowMs: 60 * 60_000 });

/**
 * Maps the `resetPasswordForEmail` outcome to one neutral UI state.
 *
 * Auth answers 200 for an unknown address before any send. The project email
 * cap (429 `over_email_send_rate_limit`, any message) and an SMTP failure
 * (5xx) are reached only for a real account, so both stay the neutral
 * «sent»; otherwise they would reveal the account. Only the per-IP request
 * limit (`over_request_rate_limit`) does not depend on the address and asks
 * to retry. «unavailable» means no HTTP answer at all.
 *
 * @see https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
 * @see https://supabase.com/docs/guides/auth/rate-limits
 * @see https://supabase.com/docs/guides/auth/debugging/error-codes
 */
export function classifyStudentRecoveryRequestError(
  error: unknown,
): StudentRecoveryRequestState["status"] {
  if (error === null || error === undefined) return "sent";
  const value = record(error);
  const status = typeof value?.status === "number" ? value.status : null;
  const code = typeof value?.code === "string" ? value.code : null;
  if (code === "over_request_rate_limit") return "rate_limited";
  if (code === "over_email_send_rate_limit") return "sent";
  if (code === "validation_failed" || code === "email_address_invalid") {
    return "invalid_email";
  }
  // Any HTTP answer, including 429 email cap and 5xx send failure, stays
  // neutral. Status 0 or no status is a fetch failure without an answer.
  if (status !== null && status >= 400 && status < 600) return "sent";
  return "unavailable";
}

/**
 * Staff recovery stays admin-driven. These markers are written only by the
 * staff provisioning paths (`staff-workspace-service.ts`); the claim comes from
 * the custom access token hook, which sets `platform_role` to a non-Student
 * role only for an active staff membership.
 */
export function hasStaffRecoveryMarker(
  user: Readonly<{ app_metadata?: unknown; user_metadata?: unknown }>,
  claims: unknown,
): boolean {
  const app = record(user.app_metadata);
  const meta = record(user.user_metadata);
  const role = record(claims)?.platform_role;
  return (
    (typeof app?.evo_staff_password_request_id === "string" &&
      app.evo_staff_password_request_id.length > 0) ||
    (typeof meta?.evo_staff_invitation_request_id === "string" &&
      meta.evo_staff_invitation_request_id.length > 0) ||
    (role !== undefined && role !== null && role !== "student")
  );
}
