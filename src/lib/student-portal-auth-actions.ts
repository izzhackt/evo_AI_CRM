"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_ROLE_PREVIEW_COOKIE } from "./platform-auth.ts";
import { exactActionStringFields } from "./server/action-form-fields.ts";
import { createStudentInviteCallbackRuntime } from "./server/student-invite-callback-runtime.ts";
import { verifyStudentInviteCallback } from "./server/student-invite-callback-verification.ts";
import { createStudentInviteSessionRuntime } from "./server/student-invite-session-runtime.ts";
import { readVerifiedStudentInviteSession } from "./server/student-invite-session.ts";
import { createStudentPortalInviteStore } from "./server/student-portal-invite-store.ts";
import { getPlatformSupabaseBackendConfig } from "./server/platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./server/platform-supabase-service-client.ts";
import {
  STUDENT_INVITE_CSRF_COOKIE,
  validateStudentInviteCallbackPost,
} from "./student-invite-callback-contract.ts";
import { createSupabaseServerClient } from "./supabase/server.ts";
import { readVerifiedStudentPortalAuthority } from "./supabase/student-portal-authority.ts";

export type StudentInviteVerificationActionState =
  | "invalidRequest"
  | "expiredOrUsed"
  | "invalidIdentity"
  | "authUnavailable"
  | null;

export type StudentPasswordActionState =
  | "invalidRequest"
  | "passwordMismatch"
  | "passwordRejected"
  | "invalidIdentity"
  | "authUnavailable"
  | null;

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const value = error.status;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

async function clearLocalStudentSession(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<void> {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // A failed cookie clear never converts a rejected receipt into authority.
  }
}

export async function verifyStudentInviteAction(
  _previousState: StudentInviteVerificationActionState,
  form: FormData,
): Promise<StudentInviteVerificationActionState> {
  const fields = exactActionStringFields(form, [
    "csrf_token",
    "token_hash",
    "type",
  ]);
  if (!fields) return "invalidRequest";

  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const input = validateStudentInviteCallbackPost({
    nodeEnv: process.env.NODE_ENV,
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
    csrfCookie: cookieStore.get(STUDENT_INVITE_CSRF_COOKIE)?.value ?? null,
    form: fields,
  });
  if (!input) return "invalidRequest";

  let result;
  try {
    const sessionClient = await createSupabaseServerClient();
    const serviceClient = createPlatformSupabaseServiceClient(
      getPlatformSupabaseBackendConfig(),
    );
    const receiptStore = createStudentPortalInviteStore(serviceClient);
    result = await verifyStudentInviteCallback(
      input,
      createStudentInviteCallbackRuntime(sessionClient, receiptStore),
    );
  } catch {
    return "authUnavailable";
  }
  if (result.status === "set_password") {
    cookieStore.delete(STUDENT_INVITE_CSRF_COOKIE);
    redirect("/auth/set-password");
  }
  if (result.status === "expired_or_used") return "expiredOrUsed";
  if (result.status === "invalid_identity") return "invalidIdentity";
  return "authUnavailable";
}

export async function setStudentPortalPasswordAction(
  _previousState: StudentPasswordActionState,
  form: FormData,
): Promise<StudentPasswordActionState> {
  const fields = exactActionStringFields(form, ["password", "password_confirm"]);
  if (!fields) return "invalidRequest";
  const password = fields.get("password") ?? "";
  const passwordConfirm = fields.get("password_confirm") ?? "";
  if (password !== passwordConfirm) return "passwordMismatch";
  if (password.length < 12 || password.length > 4096) return "passwordRejected";

  let destination: "/portal" | "/auth/account-pending" | null = null;
  try {
    const { sessionClient, receiptStore } =
      await createStudentInviteSessionRuntime();
    const inviteSession = await readVerifiedStudentInviteSession(
      sessionClient,
      receiptStore,
    );
    if (inviteSession.status === "unavailable") return "authUnavailable";
    if (inviteSession.status !== "authenticated") {
      await clearLocalStudentSession(sessionClient);
      return "invalidIdentity";
    }

    const { error: passwordError } = await sessionClient.auth.updateUser({ password });
    if (passwordError) {
      const status = errorStatus(passwordError);
      return status !== null && status >= 400 && status < 500
        ? "passwordRejected"
        : "authUnavailable";
    }

    const { data: claimsData, error: claimsError } =
      await sessionClient.auth.getClaims();
    if (claimsError || !claimsData?.claims) {
      return "authUnavailable";
    }
    const authority = await readVerifiedStudentPortalAuthority(
      sessionClient,
      claimsData.claims,
    );
    if (authority.status === "authenticated") {
      destination = "/portal";
    } else if (authority.status === "unavailable") {
      return "authUnavailable";
    } else {
      const pendingSession = await readVerifiedStudentInviteSession(
        sessionClient,
        receiptStore,
      );
      if (
        pendingSession.status === "authenticated" &&
        pendingSession.receipt.accountPending
      ) {
        destination = "/auth/account-pending";
      } else if (pendingSession.status === "unavailable") {
        return "authUnavailable";
      } else {
        await clearLocalStudentSession(sessionClient);
        return "invalidIdentity";
      }
    }
    (await cookies()).delete(ADMIN_ROLE_PREVIEW_COOKIE);
  } catch {
    return "authUnavailable";
  }

  if (!destination) return "authUnavailable";
  redirect(destination);
}

/** Re-run the bounded root dispatcher; this action performs no provisioning. */
export async function refreshStudentPortalAccessAction(): Promise<void> {
  redirect("/");
}

/** Clear only this browser's Supabase session and any stale staff preview. */
export async function logoutStudentPortalAction(): Promise<void> {
  try {
    const client = await createSupabaseServerClient();
    await client.auth.signOut({ scope: "local" });
  } finally {
    (await cookies()).delete(ADMIN_ROLE_PREVIEW_COOKIE);
  }
  redirect("/login");
}
