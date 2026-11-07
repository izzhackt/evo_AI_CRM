import "server-only";

import { randomInt, randomUUID } from "node:crypto";

import {
  ACCOUNT_NAME_PREFILL_KEY,
  TECHNICAL_STUDENT_EMAIL_DOMAIN,
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_FLAG,
  type StudentAccountInput,
  type StudentAccountResult,
} from "../student-account-contract";
import { studentLoginBase } from "../student-login";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";

/**
 * Кабинет студента от администратора (342, 07.11.2026), порядок как у приглашения 185:
 *   1. разрешение в базе от имени админа (authorize_student_account_v1: только admin, повтор запроса — та же строка);
 *   2. пользователь Auth с временным паролем и пометкой «сначала свой пароль» (app_metadata, её ставит только сервер);
 *   3. complete_student_account_v1: логин имя.фамилия и журнал. Не вышло — пользователь удаляется, разрешение закрыто.
 * Пароль нигде не хранится: он уходит админу один раз в ответе действия.
 */

/** 14 знаков: три группы по 4 без похожих символов, crypto.randomInt. */
export function newTemporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

/** Без почты — служебный адрес в зоне .invalid (RFC 2606): никуда не доставляется; студент позже добавит свою почту. */
export function technicalStudentEmail(): string {
  return `student-${randomUUID()}@${TECHNICAL_STUDENT_EMAIL_DOMAIN}`;
}

type RpcResult = PromiseLike<Readonly<{ data: unknown; error: { code?: string } | null }>>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (name: string, args: Readonly<Record<string, unknown>>) => { abortSignal: (signal: AbortSignal) => RpcResult };
  }>;
}>;

export type StudentAccountProvisioning =
  | Readonly<{ status: "created"; account: StudentAccountResult }>
  | Readonly<{ status: "already_created"; login: string }>
  | Readonly<{ status: "forbidden" | "invalid" | "email_taken" | "unavailable" }>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const timeout = () => AbortSignal.timeout(10000);

export async function provisionStudentAccount(
  adminClient: RpcClient,
  organizationId: string,
  requestId: string,
  input: StudentAccountInput,
): Promise<StudentAccountProvisioning> {
  const authorized = await adminClient.schema("platform")
    .rpc("authorize_student_account_v1", { p_organization_id: organizationId, p_request_id: requestId })
    .abortSignal(timeout());
  if (authorized.error) {
    if (authorized.error.code === "42501") return { status: "forbidden" };
    return { status: authorized.error.code === "22023" || authorized.error.code === "23505" ? "invalid" : "unavailable" };
  }
  const permission = record(authorized.data);
  const provisioningId = typeof permission?.provisioning_id === "string" ? permission.provisioning_id : null;
  if (!provisioningId) return { status: "unavailable" };
  // A finished request is never redone: a lost answer of a created account gives its login, its password is gone.
  if (permission?.state === "completed" && typeof permission.login === "string") return { status: "already_created", login: permission.login };
  if (permission?.state !== "authorized") return { status: "unavailable" };

  const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const fail = async () => {
    await service.schema("platform").rpc("fail_student_account_v1", { p_provisioning_id: provisioningId })
      .abortSignal(timeout()).then(() => undefined, () => undefined);
  };
  const password = newTemporaryPassword();
  const created = await service.auth.admin.createUser({
    email: input.email ?? technicalStudentEmail(),
    password,
    email_confirm: true,
    user_metadata: { [ACCOUNT_NAME_PREFILL_KEY]: { firstName: input.firstName, lastName: input.lastName } },
    app_metadata: { [TEMPORARY_PASSWORD_FLAG]: true },
  });
  if (created.error || !created.data.user) {
    await fail();
    const code = created.error?.code;
    return { status: code === "email_exists" || code === "user_already_exists" ? "email_taken" : "unavailable" };
  }
  const authUserId = created.data.user.id;

  const completed = await service.schema("platform")
    .rpc("complete_student_account_v1", {
      p_provisioning_id: provisioningId, p_auth_user_id: authUserId, p_login_base: studentLoginBase(input.firstName, input.lastName),
    })
    .abortSignal(timeout());
  const login = record(completed.data)?.login;
  if (completed.error || typeof login !== "string") {
    // No login, no journal row: the account is removed again and the permission closed.
    await service.auth.admin.deleteUser(authUserId).then(() => undefined, () => undefined);
    await fail();
    return { status: "unavailable" };
  }
  return { status: "created", account: { firstName: input.firstName, lastName: input.lastName, login, password } };
}
