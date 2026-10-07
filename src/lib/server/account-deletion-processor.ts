import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseAccountDeletionProcessed,
  type AccountDeletionStorageObject,
  type ConfirmationEmailStatus,
} from "../account-deletion-contract.ts";
import { sendAccountDeletionMail } from "./account-deletion-mail.ts";

/**
 * Выполнение запроса на удаление (миграция 279). Шаги по порядку, каждый
 * безопасно повторяется:
 *  1. `process_account_deletion_v1` от имени Admin: база удаляет и обезличивает
 *     строки и отдаёт ключи файлов Storage и id аккаунта Auth;
 *  2. ключом service role файлы удаляются через Storage API (не SQL: иначе
 *     файл остался бы в хранилище);
 *  3. `auth.admin.deleteUser` удаляет аккаунт (уже удалённый — не ошибка);
 *  4. письмо, если почта настроена;
 *  5. `complete_account_deletion_v1`: база сама проверяет, что аккаунта и
 *     файлов больше нет, и только тогда пишет «выполнено».
 * Сбой на шаге оставляет запрос «в обработке»; кнопка «Повторить» запускает
 * всё заново, база и Storage дают тот же результат.
 */

export type AccountDeletionRunStep = "process" | "config" | "storage" | "auth" | "complete";

export type AccountDeletionRunResult =
  | Readonly<{ status: "completed"; emailStatus: ConfirmationEmailStatus | null }>
  | Readonly<{ status: "failed"; step: AccountDeletionRunStep }>;

export type AccountDeletionServices = Readonly<{
  /** Клиент с сессией Admin: права решает база. */
  session: SupabaseClient;
  /** Клиент service role: только Storage и Auth Admin. */
  service: () => SupabaseClient;
  sendMail?: typeof sendAccountDeletionMail;
}>;

const BATCH = 100;

function groupByBucket(objects: readonly AccountDeletionStorageObject[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const object of objects) {
    const names = groups.get(object.bucket) ?? [];
    names.push(object.name);
    groups.set(object.bucket, names);
  }
  return groups;
}

function isUserMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  return status === 404 || code === "user_not_found";
}

export async function runAccountDeletion(
  requestRowId: string,
  requestedAt: string | null,
  services: AccountDeletionServices,
): Promise<AccountDeletionRunResult> {
  const processedResponse = await services.session.schema("platform")
    .rpc("process_account_deletion_v1", { p_id: requestRowId });
  const processed = processedResponse.error ? null : parseAccountDeletionProcessed(processedResponse.data);
  if (!processed) return { status: "failed", step: "process" };
  if (processed.status === "completed") return { status: "completed", emailStatus: null };

  let service: SupabaseClient;
  try {
    service = services.service();
  } catch {
    return { status: "failed", step: "config" };
  }

  for (const [bucket, names] of groupByBucket(processed.storageObjects)) {
    for (let index = 0; index < names.length; index += BATCH) {
      const { error } = await service.storage.from(bucket).remove(names.slice(index, index + BATCH));
      if (error) return { status: "failed", step: "storage" };
    }
  }

  if (processed.authUserId) {
    const { error } = await service.auth.admin.deleteUser(processed.authUserId);
    if (error && !isUserMissing(error)) return { status: "failed", step: "auth" };
  }

  const emailStatus = await (services.sendMail ?? sendAccountDeletionMail)({
    to: processed.email, requestId: processed.id, requestedAt,
  });

  const completed = await services.session.schema("platform")
    .rpc("complete_account_deletion_v1", { p_id: requestRowId, p_confirmation_email_status: emailStatus });
  if (completed.error) return { status: "failed", step: "complete" };
  return { status: "completed", emailStatus };
}
