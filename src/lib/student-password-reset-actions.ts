"use server";

import { randomUUID } from "node:crypto";

import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parsePlatformSalesUuid } from "./platform-sales";
import { exactActionStringFields } from "./server/action-form-fields";
import { resetStudentPassword } from "./server/student-password-reset";
import type { StudentPasswordResetActionState } from "./student-account-contract";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * «Карточка студента → Доступ к порталу → Сбросить пароль» (344, 07.11.2026). Только администратор вне просмотра роли;
 * право и студента дела ещё раз проверяет база. После ответа базы следующий сброс — новый запрос. Новый временный
 * пароль возвращается один раз и нигде не хранится.
 */
export async function resetStudentPasswordAction(
  previous: StudentPasswordResetActionState,
  form: FormData,
): Promise<StudentPasswordResetActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "student_case_id"]);
  const requestId = parsePlatformSalesUuid(fields?.get("request_id")) ?? previous.requestId;
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) return { status: "forbidden", requestId };
  const studentCaseId = parsePlatformSalesUuid(fields?.get("student_case_id"));
  if (!studentCaseId) return { status: "invalid", requestId };
  try {
    const client = await createSupabaseServerClient();
    const outcome = await resetStudentPassword(client, actor.organizationId, requestId, studentCaseId);
    // A request that reached the database is finished either way: the next attempt is a new request.
    const next = randomUUID();
    if (outcome.status === "reset") return { status: "reset", requestId: next, password: outcome.password };
    return { status: outcome.status, requestId: next };
  } catch {
    return { status: "unavailable", requestId: randomUUID() };
  }
}
