import "server-only";

import { TEMPORARY_PASSWORD_FLAG } from "../student-account-contract";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";
import { newTemporaryPassword } from "./student-account-provisioning";

/**
 * Сброс пароля студента администратором (344, 07.11.2026), порядок как у кабинета 342:
 *   1. authorize_student_password_reset_v1 от имени админа: только admin; студент — тот, кто привязан к делу, а не из формы;
 *   2. Auth: новый временный пароль и пометка «сначала свой пароль» (app_metadata, её ставит только сервер);
 *   3. complete_student_password_reset_v1 от сервера: одна запись журнала. Пароль показывается только после неё.
 * Пароль нигде не хранится. Без подтверждённой записи журнала пароль не показывается и разрешение закрывается:
 * следующий сброс выдаст новый пароль и запишет журнал.
 */

type RpcError = Readonly<{ code?: string; message?: string }>;
type RpcResult = PromiseLike<Readonly<{ data: unknown; error: RpcError | null }>>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (name: string, args: Readonly<Record<string, unknown>>) => { abortSignal: (signal: AbortSignal) => RpcResult };
  }>;
}>;

export type StudentPasswordReset =
  | Readonly<{ status: "reset"; password: string }>
  | Readonly<{ status: "already_reset" | "forbidden" | "invalid" | "no_cabinet" | "unavailable" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const timeout = () => AbortSignal.timeout(10000);

function refusal(error: RpcError | null): "no_cabinet" | "forbidden" | null {
  if (error?.code === "PT409" && error.message === "student_case_no_cabinet") return "no_cabinet";
  return error?.code === "42501" ? "forbidden" : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function resetStudentPassword(
  adminClient: RpcClient,
  organizationId: string,
  requestId: string,
  studentCaseId: string,
): Promise<StudentPasswordReset> {
  const authorized = await adminClient.schema("platform")
    .rpc("authorize_student_password_reset_v1", {
      p_organization_id: organizationId, p_request_id: requestId, p_student_case_id: studentCaseId,
    })
    .abortSignal(timeout());
  if (authorized.error) {
    const code = authorized.error.code;
    return { status: refusal(authorized.error) ?? (code === "22023" || code === "23505" ? "invalid" : "unavailable") };
  }
  const permission = record(authorized.data);
  const resetId = permission?.reset_id;
  const authUserId = permission?.auth_user_id;
  if (typeof resetId !== "string" || typeof authUserId !== "string" || !UUID.test(authUserId)) return { status: "unavailable" };
  // A finished reset is never redone under its request: its password is gone, the next reset is a new request.
  if (permission?.state === "completed") return { status: "already_reset" };
  if (permission?.state !== "authorized") return { status: "unavailable" };

  const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const fail = async () => {
    await service.schema("platform").rpc("fail_student_password_reset_v1", { p_reset_id: resetId })
      .abortSignal(timeout()).then(() => undefined, () => undefined);
  };
  const password = newTemporaryPassword();
  // Auth merges app_metadata: the provider keys stay, the flag sends the student to «Придумайте свой пароль».
  const updated = await service.auth.admin.updateUserById(authUserId, { password, app_metadata: { [TEMPORARY_PASSWORD_FLAG]: true } });
  if (updated.error || !updated.data.user) {
    await fail();
    return { status: "unavailable" };
  }
  const complete = () => service.schema("platform")
    .rpc("complete_student_password_reset_v1", { p_reset_id: resetId })
    .abortSignal(timeout());
  let completed = await complete();
  // No database code (network, timeout): the commit may have happened. A completed reset replays, so ask once more.
  if (completed.error && !completed.error.code) completed = await complete();
  if (!completed.error && record(completed.data)?.state === "completed") return { status: "reset", password };
  await fail();
  return { status: refusal(completed.error) ?? "unavailable" };
}
