import "server-only";

import { isStudentApplicationUuid, STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft, type StudentApplicationDraft } from "../student-application-contract";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";
import { isPasswordProvisionedStaff, logStudentSignupFailure } from "./student-signup-runtime";
import { getStudentSignupConfirmationRuntimeConfig } from "./student-signup-confirmation-config.ts";

type StudentAccountCreation = { status: "created"; authUserId: string }
  | { status: "invalid" | "password" | "password_too_long" | "rate_limit" | "conflict" | "unavailable" | "create_unknown" };

/** Creates only a new identity. Existing accounts, including invitations, are never changed. */
export async function createPublicStudentAccount(email: string, password: string, draft: StudentApplicationDraft): Promise<StudentAccountCreation> {
  if (email !== email.trim().toLowerCase() || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !validateStudentApplicationDraft(draft)) return { status: "invalid" };
  if (password.length < 12) return { status: "password" };
  // Auth uses bcrypt's byte limit, not a JavaScript character limit:
  // https://pkg.go.dev/golang.org/x/crypto/bcrypt#GenerateFromPassword
  if (new TextEncoder().encode(password).byteLength > 72) return { status: "password_too_long" };
  let stage = "configuration";
  try {
    // Missing/unspecified OTP configuration must fail before any quota or Auth write.
    getStudentSignupConfirmationRuntimeConfig();
    const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    stage = "reserve_attempt";
    const reserved = await service.schema("platform").rpc("reserve_student_signup_attempt_v1", { p_email: email })
      .abortSignal(AbortSignal.timeout(10000));
    if (reserved.error || typeof reserved.data !== "boolean") {
      logStudentSignupFailure(stage, reserved.error);
      return { status: "unavailable" };
    }
    if (!reserved.data) return { status: "rate_limit" };
    stage = "create_account";
    // Public Auth signup stays disabled. Unlike signUp, admin.createUser rejects
    // every duplicate, including an unconfirmed staff or Student invitation.
    const { data, error } = await service.auth.admin.createUser({
      email, password, email_confirm: false,
      user_metadata: { [STUDENT_APPLICATION_METADATA_KEY]: draft },
    });
    if (error) {
      logStudentSignupFailure(stage, error);
      if (error.status === 429) return { status: "rate_limit" };
      if (error.code === "weak_password") return { status: "password" };
      if (error.code === "user_already_exists" || error.code === "email_exists") return { status: "conflict" };
      return { status: error.status && error.status < 500 ? "unavailable" : "create_unknown" };
    }
    if (!data.user || !isStudentApplicationUuid(data.user.id) || data.user.email?.toLowerCase() !== email
      || data.user.email_confirmed_at || data.user.is_anonymous || data.user.invited_at || isPasswordProvisionedStaff(data.user)) {
      logStudentSignupFailure("created_identity");
      return { status: "create_unknown" };
    }
    return { status: "created", authUserId: data.user.id };
  } catch (error) {
    logStudentSignupFailure(stage, error);
    return { status: stage === "create_account" ? "create_unknown" : "unavailable" };
  }
}
