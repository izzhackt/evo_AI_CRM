"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SignupConfirmState, SignupResendResult } from "./student-signup-confirmation-state";
import { STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE, validateStudentSignupConfirmationPost } from "./student-signup-confirmation-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { getStudentSignupConfirmationRuntimeConfig } from "./server/student-signup-confirmation-config";
import { resendStudentSignup, verifyStudentSignup } from "./server/student-signup-confirmation-runtime";
import { clearPendingStudentSignup, commitStudentSignupSession, readSignupCurrentIdentity, SIGNUP_PENDING_COOKIE, signupPublicState, validSignupOrigin } from "./server/student-signup-confirmation-web";
import { logStudentSignupFailure, resumeStudentApplication } from "./server/student-signup-runtime";

export async function resendStudentSignupConfirmationAction(_previous: SignupResendResult, form: FormData): Promise<SignupResendResult> {
  if (!await validSignupOrigin() || !exactActionStringFields(form, [])) return { status: "unavailable" };
  const cap = (await cookies()).get(SIGNUP_PENDING_COOKIE)?.value;
  return cap ? signupPublicState(await resendStudentSignup(cap)) : { status: "expired" };
}

export async function confirmStudentSignupAction(_previous: SignupConfirmState, form: FormData): Promise<SignupConfirmState> {
  let destination: string;
  let stage = "confirmation_input";
  try {
    const config = getStudentSignupConfirmationRuntimeConfig();
    const fields = exactActionStringFields(form, ["cap", "otp", "csrf_token"]);
    const h = await headers();
    const intent = fields && validateStudentSignupConfirmationPost({ form: fields.entries(),
      csrfCookie: (await cookies()).get(STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE)?.value ?? null,
      origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto"),
      nodeEnv: process.env.NODE_ENV, localCallbackOrigin: process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN, expectedOtpLength: config.otpLength });
    if (!intent) return { status: "invalid_link" };
    stage = "confirmation_existing_identity";
    const current = await readSignupCurrentIdentity();
    if (current.status !== "ready") return { status: "unavailable" };
    const verified = await verifyStudentSignup(intent.cap, intent.otp, current.user);
    if (verified.status !== "verified") return verified;
    stage = "confirmation_session";
    const committed = await commitStudentSignupSession(verified.session, verified.expectedAuthUserId);
    stage = "confirmation_resume";
    if (committed.destination) destination = committed.destination;
    else {
      const resumed = await resumeStudentApplication(committed.client, verified.expectedAuthUserId);
      if (resumed === "unverified") return { status: "resume_unknown" };
      destination = resumed === "saved" ? "/apply/status" : "/apply";
    }
    await clearPendingStudentSignup();
  } catch (error) {
    logStudentSignupFailure(stage, error);
    return { status: stage === "confirmation_resume" ? "resume_unknown" : "unavailable" };
  }
  redirect(destination);
}
