import "server-only";
import { randomUUID } from "node:crypto";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import type { StudentApplicationDraft } from "../student-application-contract.ts";
import type { NativeSignupPending, NativeSignupResendResult, SignupDispatch, SignupFailure } from "../student-signup-confirmation-state.ts";
import { readVerifiedPlatformAuthority } from "../supabase/platform-authority.ts";
import { readVerifiedStudentPortalAuthority } from "../supabase/student-portal-authority.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { createPublicStudentAccount } from "./student-public-registration.ts";
import { isPasswordProvisionedStaff, logStudentSignupFailure } from "./student-signup-runtime.ts";
import { getStudentSignupConfirmationRuntimeConfig, type StudentSignupConfirmationConfig } from "./student-signup-confirmation-config.ts";
import { openSignupConfirmationCapability, sealSignupConfirmationCapability, SIGNUP_CAPABILITY_MAX_AGE_SECONDS, type SignupCapabilityPayload } from "./student-signup-confirmation-capability.ts";

const clock = () => Math.floor(Date.now() / 1000);
function binding(config: StudentSignupConfirmationConfig, purpose: "resend" | "confirm") {
  return { purpose, projectUrl: new URL(config.backend.supabaseUrl).origin, studentOrigin: config.studentOrigin };
}

/** No cookie adapter, verifier storage, persisted session or ambient Authorization. */
function isolatedClient(config: StudentSignupConfirmationConfig) {
  return createClient(config.publicConfig.url, config.publicConfig.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  });
}

function pending(payload: SignupCapabilityPayload, envelope: string, dispatch: SignupDispatch): NativeSignupPending {
  const [name, domain] = payload.email.split("@");
  return { status: "pending_confirmation", maskedEmail: `${name[0]}***@${domain}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(), retryAfterSeconds: null, dispatch,
    resendCapability: envelope };
}

async function readExpectedIdentity(config: StudentSignupConfirmationConfig, payload: SignupCapabilityPayload) {
  const service = createPlatformSupabaseServiceClient(config.backend);
  const { data, error } = await service.auth.admin.getUserById(payload.authUserId);
  if (error || !data.user) {
    logStudentSignupFailure("confirmation_identity", error);
    return { status: "unavailable" as const };
  }
  const user = data.user;
  if (user.id !== payload.authUserId || user.email?.toLowerCase() !== payload.email
    || user.is_anonymous || user.invited_at || isPasswordProvisionedStaff(user)) {
    return { status: "account_conflict" as const };
  }
  return { status: user.email_confirmed_at ? "confirmed" as const : "unconfirmed" as const, user };
}

async function dispatch(config: StudentSignupConfirmationConfig, payload: SignupCapabilityPayload): Promise<SignupDispatch> {
  try {
    const identity = await readExpectedIdentity(config, payload);
    if (identity.status !== "unconfirmed") return "unknown";
    const cap = sealSignupConfirmationCapability(payload, binding(config, "confirm"), config.backend.supabaseSecretKey);
    const { error } = await isolatedClient(config).auth.resend({ type: "signup", email: payload.email,
      options: { emailRedirectTo: `${config.callbackUrl}#cap=${cap}` } });
    if (!error) return "accepted";
    logStudentSignupFailure("confirmation_dispatch", error);
    // Even an SMTP failure may have delivered mail before token persistence.
    return error.status && error.status >= 400 && error.status < 500 ? "failed" : "unknown";
  } catch (error) {
    logStudentSignupFailure("confirmation_dispatch", error);
    return "unknown";
  }
}

export async function beginStudentSignup(email: string, password: string, draft: StudentApplicationDraft): Promise<NativeSignupPending | SignupFailure> {
  let config: StudentSignupConfirmationConfig;
  try { config = getStudentSignupConfirmationRuntimeConfig(); }
  catch (error) { logStudentSignupFailure("confirmation_configuration", error); return { status: "unavailable" }; }
  const result = await createPublicStudentAccount(email, password, draft);
  if (result.status !== "created") return result;
  const issuedAt = clock();
  const payload = { attemptId: randomUUID(), authUserId: result.authUserId, email, issuedAt, expiresAt: issuedAt + SIGNUP_CAPABILITY_MAX_AGE_SECONDS };
  let envelope: string;
  try { envelope = sealSignupConfirmationCapability(payload, binding(config, "resend"), config.backend.supabaseSecretKey, issuedAt); }
  catch (error) { logStudentSignupFailure("confirmation_attempt", error); return { status: "create_unknown" }; }
  // The create already reserved this attempt. No automatic dispatch retries.
  return pending(payload, envelope, await dispatch(config, payload));
}

/** Refresh reconstructs waiting from the exact capability, never re-creates or sends. */
export async function inspectStudentSignup(envelope: string): Promise<NativeSignupResendResult> {
  try {
    const config = getStudentSignupConfirmationRuntimeConfig();
    const payload = openSignupConfirmationCapability(envelope, binding(config, "resend"), config.backend.supabaseSecretKey);
    if (!payload) return { status: "expired" };
    const identity = await readExpectedIdentity(config, payload);
    return identity.status === "unconfirmed" ? pending(payload, envelope, "unknown") : { status: identity.status };
  } catch (error) { logStudentSignupFailure("confirmation_status", error); return { status: "unavailable" }; }
}

export async function resendStudentSignup(envelope: string): Promise<NativeSignupResendResult> {
  try {
    const config = getStudentSignupConfirmationRuntimeConfig();
    const payload = openSignupConfirmationCapability(envelope, binding(config, "resend"), config.backend.supabaseSecretKey);
    if (!payload) return { status: "expired" };
    const identity = await readExpectedIdentity(config, payload);
    if (identity.status !== "unconfirmed") return { status: identity.status };
    const reserved = await createPlatformSupabaseServiceClient(config.backend).schema("platform")
      .rpc("reserve_student_signup_attempt_v1", { p_email: payload.email }).abortSignal(AbortSignal.timeout(10000));
    if (reserved.error || typeof reserved.data !== "boolean") {
      logStudentSignupFailure("confirmation_resend_quota", reserved.error); return { status: "unavailable" };
    }
    if (!reserved.data) return { status: "rate_limit" };
    return pending(payload, envelope, await dispatch(config, payload));
  } catch (error) { logStudentSignupFailure("confirmation_resend", error); return { status: "unavailable" }; }
}

type VerifiedSignup = { status: "verified"; expectedAuthUserId: string; destination: "/portal" | null; session: Session | null };
type VerifyFailure = { status: "invalid_link" | "expired_or_used" | "account_conflict" | "unavailable" | "sign_in_required" };

/** Session is returned only server-to-server, after identity and current DB authority. */
export async function verifyStudentSignup(cap: string, otp: string, currentUser: User | null): Promise<VerifiedSignup | VerifyFailure> {
  try {
    const config = getStudentSignupConfirmationRuntimeConfig();
    if (!new RegExp(`^[0-9]{${config.otpLength}}$`).test(otp)) return { status: "invalid_link" };
    const payload = openSignupConfirmationCapability(cap, binding(config, "confirm"), config.backend.supabaseSecretKey);
    if (!payload) return { status: "invalid_link" };
    if (currentUser && currentUser.id !== payload.authUserId) return { status: "account_conflict" };
    const identity = await readExpectedIdentity(config, payload);
    if (identity.status === "unavailable" || identity.status === "account_conflict") return { status: identity.status };
    if (identity.status === "confirmed") {
      if (!currentUser?.email_confirmed_at || currentUser.email?.toLowerCase() !== payload.email || currentUser.is_anonymous) return { status: "sign_in_required" };
      // Caller must check current-session authority before its read-own/resume.
      return { status: "verified", expectedAuthUserId: payload.authUserId, destination: null, session: null };
    }
    const client = isolatedClient(config);
    const verified = await client.auth.verifyOtp({ type: "signup", email: payload.email, token: otp });
    if (verified.error || !verified.data.session) {
      logStudentSignupFailure("confirmation_verify", verified.error);
      return { status: verified.error?.status && verified.error.status < 500 ? "expired_or_used" : "unavailable" };
    }
    const session = verified.data.session;
    const live = await client.auth.getUser(session.access_token);
    if (live.error || !live.data.user) return { status: "unavailable" };
    const user = live.data.user;
    if (user.id !== payload.authUserId || user.email?.toLowerCase() !== payload.email
      || !user.email_confirmed_at || user.is_anonymous || user.invited_at || isPasswordProvisionedStaff(user)) return { status: "account_conflict" };
    const claims = await client.auth.getClaims(session.access_token);
    if (claims.error || claims.data?.claims.sub !== user.id) return { status: "unavailable" };
    const staff = await readVerifiedPlatformAuthority(client, claims.data.claims);
    if (staff.status === "authenticated") return { status: "account_conflict" };
    if (staff.status === "unavailable") return { status: "unavailable" };
    const portal = await readVerifiedStudentPortalAuthority(client, claims.data.claims);
    if (portal.status === "unavailable") return { status: "unavailable" };
    return { status: "verified", expectedAuthUserId: user.id, destination: portal.status === "authenticated" ? "/portal" : null, session };
  } catch (error) { logStudentSignupFailure("confirmation_verify", error); return { status: "unavailable" }; }
}
