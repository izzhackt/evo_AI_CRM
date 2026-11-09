"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { exactActionStringFields } from "./server/action-form-fields.ts";
import { getPlatformSupabaseBackendConfig } from "./server/platform-supabase-backend-config";
import { recordStudentConsentsAfterSignIn } from "./server/student-consent-gate-record.ts";
import { createPlatformSupabaseServiceClient } from "./server/platform-supabase-service-client";
import { hasTemporaryPassword, TEMPORARY_PASSWORD_FLAG } from "./student-account-contract";
import { isExpectedStudentOriginRequest } from "./student-invite-callback-contract.ts";
import { checkStudentNewPassword } from "./student-password-recovery-contract.ts";
import { createSupabaseServerClient } from "./supabase/server";

export type StudentNewPasswordState = Readonly<{
  status: "idle" | "consent_required" | "too_short" | "too_long" | "mismatch" | "rejected" | "unavailable";
}>;

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
 * «Придумайте свой пароль» (342, 07.11.2026): вход с временным паролем от администратора. Студент из живой сессии,
 * пометка временного пароля — из Auth, а не из формы. Новый пароль и снятая пометка ставятся одним запросом сервера.
 * Смена пароля закрывает сессии студента, поэтому сессия открывается заново уже с новым паролем (как смена пароля в
 * кабинете, server/student-password-change.ts), дальше — обычный путь студента через /apply; не вышло — обычный вход.
 */
export async function setOwnStudentPasswordAction(
  _previous: StudentNewPasswordState,
  form: FormData,
): Promise<StudentNewPasswordState> {
  const fields = exactActionStringFields(form, ["password", "password_confirm", "policy_consent", "ai_consent"]);
  if (!fields || !(await studentOriginRequest())) return { status: "unavailable" };
  // 356 (решение владельца 09.11.2026): обе галочки «Конфиденциальность» обязательны и здесь.
  if (fields.get("policy_consent") !== "granted" || fields.get("ai_consent") !== "granted") return { status: "consent_required" };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (!hasTemporaryPassword(data.user.app_metadata)) redirect("/apply");
  const password = fields.get("password")!;
  const check = checkStudentNewPassword(password, fields.get("password_confirm")!);
  if (check !== "ok") return { status: check };
  try {
    const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    const updated = await service.auth.admin.updateUserById(data.user.id, {
      password,
      app_metadata: { ...data.user.app_metadata, [TEMPORARY_PASSWORD_FLAG]: false },
    });
    if (updated.error) {
      const status = typeof updated.error.status === "number" ? updated.error.status : 500;
      return { status: status >= 400 && status < 500 ? "rejected" : "unavailable" };
    }
  } catch {
    return { status: "unavailable" };
  }
  let signedIn = false;
  try {
    const again = await client.auth.signInWithPassword({ email: data.user.email ?? "", password });
    signedIn = !again.error && again.data.user?.id === data.user.id;
    // F-1: остальные сессии студента (другие устройства) закрываются, эта остаётся. Не вышло — вход не страдает.
    const keep = again.data.session?.access_token;
    if (signedIn && keep) {
      const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
      await service.auth.admin.signOut(keep, "others");
    }
  } catch { /* the regular sign-in below */ }
  // Принятие пишется уже с новой сессией; не вышло - экран кабинета спросит снова.
  if (signedIn) await recordStudentConsentsAfterSignIn();
  redirect(signedIn ? "/apply" : "/login");
}
