import "server-only";
import { getSupabasePublicConfig } from "../supabase/config.ts";
import { studentSignupConfirmationUrl } from "../student-signup-confirmation-contract.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";

/** Must match the independently verified Auth/template packet; no guessed default. */
export function signupConfirmationOtpLength(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(value)) return null;
  return Number(value);
}

export function getStudentSignupConfirmationRuntimeConfig() {
  const otpLength = signupConfirmationOtpLength(process.env.EVO_STUDENT_SIGNUP_OTP_LENGTH);
  if (otpLength === null) throw new Error("Student signup confirmation is not configured.");
  const backend = getPlatformSupabaseBackendConfig();
  const publicConfig = getSupabasePublicConfig();
  if (new URL(backend.supabaseUrl).origin !== new URL(publicConfig.url).origin) {
    throw new Error("Student signup confirmation is not configured.");
  }
  const callbackUrl = studentSignupConfirmationUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN);
  return { backend, publicConfig, otpLength, callbackUrl, studentOrigin: new URL(callbackUrl).origin };
}

export type StudentSignupConfirmationConfig = ReturnType<typeof getStudentSignupConfirmationRuntimeConfig>;
