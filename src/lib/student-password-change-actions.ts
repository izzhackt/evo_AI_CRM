"use server";

import { headers } from "next/headers";

import { exactActionStringFields } from "./server/action-form-fields.ts";
import { changeStudentPassword } from "./server/student-password-change.ts";
import { isExpectedStudentOriginRequest } from "./student-invite-callback-contract.ts";
import type { StudentPasswordChangeState } from "./student-password-change-contract.ts";
import { checkStudentNewPassword } from "./student-password-recovery-contract.ts";
import { requireStudentPortalActor } from "./student-portal-guards.ts";

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
 * «Профиль → Пароль»: ровно три поля, запрос только со своего адреса кабинета, студент из живой сессии (не из формы),
 * правило нового пароля то же, что у восстановления. Почту и id для проверки текущего пароля берём из сессии.
 */
export async function changeStudentPasswordAction(
  _previous: StudentPasswordChangeState,
  form: FormData,
): Promise<StudentPasswordChangeState> {
  const fields = exactActionStringFields(form, ["current_password", "password", "password_confirm"]);
  if (!fields || !(await studentOriginRequest())) return { status: "unavailable" };
  const actor = await requireStudentPortalActor();
  const current = fields.get("current_password")!;
  const password = fields.get("password")!;
  if (current.length === 0) return { status: "wrong_current" };
  const check = checkStudentNewPassword(password, fields.get("password_confirm")!);
  if (check !== "ok") return { status: check };
  if (current === password) return { status: "same_password" };
  const status = await changeStudentPassword({
    authUserId: actor.authUserId, email: actor.email, currentPassword: current, newPassword: password,
  });
  return { status };
}
