"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_ROLE_PREVIEW_COOKIE } from "./platform-auth.ts";
import { exactActionStringFields } from "./server/action-form-fields.ts";
import {
  admitStudentRecoveryRequest,
  commitStudentRecoverySession,
  completeStudentPasswordRecovery,
  logStudentRecoveryFailure,
  requestStudentPasswordRecovery,
  verifyStudentPasswordRecoveryLink,
} from "./server/student-password-recovery.ts";
import {
  isExpectedStudentOriginRequest,
  STUDENT_INVITE_CSRF_COOKIE,
  studentInviteCallbackUrl,
  validateStudentRecoveryCallbackPost,
} from "./student-invite-callback-contract.ts";
import {
  checkStudentNewPassword,
  normalizeStudentRecoveryEmail,
  STUDENT_PASSWORD_RESET_PATH,
  STUDENT_RECOVERY_RESPONSE_DEADLINE_MS,
  type StudentRecoveryPasswordState,
  type StudentRecoveryRequestState,
  type StudentRecoveryVerifyState,
} from "./student-password-recovery-contract.ts";
import { answerAtFixedDeadline } from "./student-password-recovery-timing.ts";

type RequestStatus = StudentRecoveryRequestState["status"];

async function studentOriginRequest(): Promise<boolean> {
  const requestHeaders = await headers();
  return isExpectedStudentOriginRequest({
    nodeEnv: process.env.NODE_ENV,
    localCallbackOrigin: process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN,
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
  });
}

/**
 * Step 1. One neutral answer for every address. The link target is the
 * fixed Student origin callback, never anything taken from the request.
 *
 * Only answers that do not depend on the account leave at once: the form
 * check, the address format and the per-IP limit. Everything after the
 * admission (the per-address «sent», the staff lookup, the Auth call) leaves
 * at one fixed deadline whatever the work took, so a slow email send cannot
 * tell a real account from an unknown one. The work keeps running past a
 * missed deadline, and the neutral «sent» is the answer then.
 */
export async function requestStudentPasswordRecoveryAction(
  _previous: StudentRecoveryRequestState,
  form: FormData,
): Promise<StudentRecoveryRequestState> {
  const startedAt = Date.now();
  const fields = exactActionStringFields(form, ["email"]);
  if (!fields || !(await studentOriginRequest())) {
    return { status: "unavailable" };
  }
  const email = normalizeStudentRecoveryEmail(fields.get("email"));
  if (!email) return { status: "invalid_email" };

  const admission = admitStudentRecoveryRequest((await headers()).get("x-forwarded-for"), email);
  if (admission === "ip_limited") return { status: "rate_limited" };

  const work: Promise<RequestStatus> =
    admission === "address_limited" ? Promise.resolve("sent") : requestStatus(email);
  const status = await answerAtFixedDeadline<RequestStatus>({
    work,
    startedAt,
    deadlineMs: STUDENT_RECOVERY_RESPONSE_DEADLINE_MS,
    pending: "sent",
  });
  return { status };
}

/** Never rejects: a failure is logged and answered as «unavailable». */
async function requestStatus(email: string): Promise<RequestStatus> {
  try {
    let redirectTo: string;
    try {
      redirectTo = studentInviteCallbackUrl(
        process.env.NODE_ENV,
        process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN,
      );
    } catch (error) {
      logStudentRecoveryFailure("request_configuration", error);
      return "unavailable";
    }
    return await requestStudentPasswordRecovery(email, redirectTo);
  } catch (error) {
    logStudentRecoveryFailure("request", error);
    return "unavailable";
  }
}

/** Step 2. The CSRF-bound interstitial POST on /auth/callback. */
export async function verifyStudentPasswordRecoveryAction(
  _previous: StudentRecoveryVerifyState,
  form: FormData,
): Promise<StudentRecoveryVerifyState> {
  const fields = exactActionStringFields(form, ["csrf_token", "token_hash", "type"]);
  if (!fields) return "invalidRequest";

  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const input = validateStudentRecoveryCallbackPost({
    nodeEnv: process.env.NODE_ENV,
    localCallbackOrigin: process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN,
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
    csrfCookie: cookieStore.get(STUDENT_INVITE_CSRF_COOKIE)?.value ?? null,
    form: fields,
  });
  if (!input) return "invalidRequest";

  const result = await verifyStudentPasswordRecoveryLink(input.tokenHash);
  if (result.status === "expired_or_used") return "expiredOrUsed";
  if (result.status === "staff_refused") return "staffRefused";
  if (result.status === "invalid_identity") return "invalidIdentity";
  if (result.status !== "verified") return "authUnavailable";

  try {
    await commitStudentRecoverySession(result.session, result.authUserId);
  } catch (error) {
    logStudentRecoveryFailure("commit_session", error);
    return "authUnavailable";
  }
  cookieStore.delete({ name: STUDENT_INVITE_CSRF_COOKIE, path: "/auth/callback" });
  redirect(STUDENT_PASSWORD_RESET_PATH);
}

/** Step 3. The only thing the recovery session can do: set a new password. */
export async function setStudentRecoveryPasswordAction(
  _previous: StudentRecoveryPasswordState,
  form: FormData,
): Promise<StudentRecoveryPasswordState> {
  const fields = exactActionStringFields(form, ["password", "password_confirm"]);
  if (!fields || !(await studentOriginRequest())) {
    return { status: "invalid_request" };
  }
  const password = fields.get("password") ?? "";
  const check = checkStudentNewPassword(password, fields.get("password_confirm") ?? "");
  if (check !== "ok") return { status: check };

  const status = await completeStudentPasswordRecovery(password);
  if (status === "done") (await cookies()).delete(ADMIN_ROLE_PREVIEW_COOKIE);
  return { status };
}
