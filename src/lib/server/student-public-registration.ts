import "server-only";

import { studentLoginBase } from "../student-login";
import {
  isStudentApplicationUuid, STUDENT_AI_CONSENT_METADATA_KEY, STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft,
  type StudentApplicationDraft,
} from "../student-application-contract";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";
import { isPasswordProvisionedStaff, logStudentSignupFailure } from "./student-signup-runtime";
import { getStudentSignupConfirmationRuntimeConfig } from "./student-signup-confirmation-config.ts";
import { checkRegistrationLink, consumeRegistrationLink } from "./student-registration-link";
import { registrationAiConsentChoice } from "./student-registration-ai-consent";

type StudentAccountCreation = { status: "created"; authUserId: string }
  | { status: "invalid" | "password" | "password_too_long" | "rate_limit" | "conflict" | "unavailable" | "create_unknown" | "invite" };

/**
 * Creates only a new identity. Existing accounts, including invitations, are never changed.
 * 341 (07.11.2026): the website registers only through a personal registration link (`invite`). The link is checked
 * before anything is written and used right after the identity exists; if it cannot be used, that fresh identity is
 * removed again. `invite` null is the iPhone app, which has no link field yet: unchanged until the app gets one.
 * The student's login (name.surname, 340) is claimed last; without it the student still signs in by e-mail.
 * 345: the website's required AI-assistants consent waits in user_metadata until the confirmed student signs in.
 */
export async function createPublicStudentAccount(
  email: string, password: string, draft: StudentApplicationDraft, invite: string | null, aiConsent = false,
): Promise<StudentAccountCreation> {
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
    if (invite !== null) {
      stage = "check_invite";
      const link = await checkRegistrationLink(invite);
      if (link.status === "unavailable") return { status: "unavailable" };
      if (link.status !== "valid") return { status: "invite" };
    }
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
      user_metadata: {
        [STUDENT_APPLICATION_METADATA_KEY]: draft,
        ...(aiConsent ? { [STUDENT_AI_CONSENT_METADATA_KEY]: registrationAiConsentChoice(draft.requestId) } : {}),
      },
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
    const authUserId = data.user.id;
    stage = "consume_invite";
    const used = invite === null ? "consumed" : await consumeRegistrationLink(invite, authUserId);
    if (used !== "consumed") {
      // Another registration took the link in the meantime, or it could not be marked: no account without it.
      logStudentSignupFailure(stage);
      const removed = await service.auth.admin.deleteUser(authUserId);
      if (removed.error) logStudentSignupFailure("remove_identity", removed.error);
      return { status: used === "unavailable" ? "unavailable" : "invite" };
    }
    // The account and the used link stand from here on: a missing login never undoes them.
    try {
      const login = await service.schema("platform")
        .rpc("claim_student_login_v1", { p_auth_user_id: authUserId, p_base: studentLoginBase(draft.firstName, draft.lastName) })
        .abortSignal(AbortSignal.timeout(10000));
      if (login.error) logStudentSignupFailure("claim_login", login.error);
    } catch (error) {
      logStudentSignupFailure("claim_login", error);
    }
    return { status: "created", authUserId };
  } catch (error) {
    logStudentSignupFailure(stage, error);
    return { status: stage === "create_account" ? "create_unknown" : "unavailable" };
  }
}
