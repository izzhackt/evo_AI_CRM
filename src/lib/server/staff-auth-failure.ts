import { isAuthApiError } from "@supabase/supabase-js";

/** A narrow rejection classifier, not a retry policy. Auth DB readback must
 * additionally prove no observed side effect before a fresh send is allowed.
 * https://supabase.com/docs/guides/auth/debugging/error-codes
 * Unknown/network/client errors and every 5xx remain uncertain. */
export function definiteStaffAuthRejection(error: unknown): Readonly<{ code: string; httpStatus: number }> | null {
  if (!isAuthApiError(error) || !error.code) return null;
  const limited = error.status === 429 && ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code);
  const invalid = [400, 401, 403, 422].includes(error.status) && [
    "email_address_invalid", "email_address_not_authorized", "email_exists", "email_provider_disabled",
    "otp_disabled", "signup_disabled", "not_admin", "bad_jwt", "no_authorization", "captcha_failed",
  ].includes(error.code);
  return limited || invalid ? { code: error.code, httpStatus: error.status } : null;
}
