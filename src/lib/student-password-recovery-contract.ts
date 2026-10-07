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
 * Maps the `resetPasswordForEmail` outcome to one neutral UI state.
 *
 * Auth answers 200 for an unknown address. For a known address it answers
 * 429 «For security purposes, you can only request this after N seconds»
 * when an email went out moments ago: that is shown as the same neutral
 * «sent», otherwise the per-address limit would reveal the account.
 * Other limits (project email cap, request rate) are not tied to one
 * address and get the retry message.
 *
 * @see https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
 * @see https://supabase.com/docs/guides/auth/rate-limits
 */
export function classifyStudentRecoveryRequestError(
  error: unknown,
): StudentRecoveryRequestState["status"] {
  if (error === null || error === undefined) return "sent";
  const value = record(error);
  const status = typeof value?.status === "number" ? value.status : null;
  const code = typeof value?.code === "string" ? value.code : null;
  const message = typeof value?.message === "string" ? value.message : "";
  if (status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return code === "over_email_send_rate_limit" &&
      /you can only request this after \d+ seconds?/iu.test(message)
      ? "sent"
      : "rate_limited";
  }
  if (code === "validation_failed" || code === "email_address_invalid") {
    return "invalid_email";
  }
  // Any other definite rejection stays neutral; only an unknown outcome is
  // reported, so the person knows to try again instead of waiting.
  if (status !== null && status >= 400 && status < 500) return "sent";
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
