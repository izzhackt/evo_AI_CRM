import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseAccountDeletionStep,
  type AccountDeletionStep,
  type ConfirmationEmailStatus,
} from "../account-deletion-contract.ts";
import { sendAccountDeletionMail } from "./account-deletion-mail.ts";

/**
 * Выполнение запроса на удаление (миграция 280, упрощение для 1.0).
 *
 * Автоматически, только простой аккаунт (каждый шаг безопасно повторяется):
 *  1. `process_account_deletion_v1` от имени Admin: база удаляет строки,
 *     связанные с аккаунтом внешними ключами, и отдаёт id пользователя Auth.
 *     Не простой аккаунт база отклоняет (`account_deletion_not_simple`),
 *     ничего не меняя;
 *  2. ключом service role `auth.admin.deleteUser` удаляет вход (уже
 *     удалённый — не ошибка);
 *  3. `complete_account_deletion_v1`: база сама проверяет, что пользователя
 *     Auth больше нет, и пишет «выполнено».
 * Вручную: `mark_account_deletion_done_v1` с заметкой Admin; база отказывает,
 * пока вход работает или если аккаунт простой.
 * Затем в обоих случаях письмо (если почта настроена) и
 * `record_account_deletion_email_v1`: статус письма записывается один раз,
 * адрес при этом удаляется. Сбой называет шаг; повтор безопасен.
 */

export type AccountDeletionRunStep =
  | "process" | "not_simple" | "config" | "auth" | "complete"
  | "mark" | "login" | "automatic" | "invalid" | "processing" | "email";

export type AccountDeletionRunResult =
  | Readonly<{ status: "completed"; emailStatus: ConfirmationEmailStatus }>
  | Readonly<{ status: "failed"; step: AccountDeletionRunStep }>;

export type AccountDeletionServices = Readonly<{
  /** Клиент с сессией Admin: права решает база. */
  session: SupabaseClient;
  /** Клиент service role: только Auth Admin. */
  service: () => SupabaseClient;
  sendMail?: typeof sendAccountDeletionMail;
}>;

function errorMessage(error: unknown): string | null {
  return error !== null && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message : null;
}

function isUserMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  return status === 404 || code === "user_not_found";
}

/** Письмо и запись его статуса (выполненный запрос, статус ещё не записан). */
async function finishEmail(
  done: AccountDeletionStep,
  requestedAt: string | null,
  services: AccountDeletionServices,
): Promise<AccountDeletionRunResult> {
  if (done.emailStatus) return { status: "completed", emailStatus: done.emailStatus };
  const emailStatus = await (services.sendMail ?? sendAccountDeletionMail)({
    to: done.email, requestId: done.id, requestedAt,
  });
  const recorded = await services.session.schema("platform")
    .rpc("record_account_deletion_email_v1", { p_id: done.id, p_status: emailStatus });
  if (recorded.error || !parseAccountDeletionStep(recorded.data)) return { status: "failed", step: "email" };
  return { status: "completed", emailStatus };
}

/** Автоматическое удаление простого аккаунта. */
export async function runAccountDeletion(
  requestRowId: string,
  requestedAt: string | null,
  services: AccountDeletionServices,
): Promise<AccountDeletionRunResult> {
  const processedResponse = await services.session.schema("platform")
    .rpc("process_account_deletion_v1", { p_id: requestRowId });
  if (errorMessage(processedResponse.error) === "account_deletion_not_simple") {
    return { status: "failed", step: "not_simple" };
  }
  const processed = processedResponse.error ? null : parseAccountDeletionStep(processedResponse.data);
  if (!processed) return { status: "failed", step: "process" };
  if (processed.status === "completed") return finishEmail(processed, requestedAt, services);

  if (processed.authUserId) {
    let service: SupabaseClient;
    try {
      service = services.service();
    } catch {
      return { status: "failed", step: "config" };
    }
    const { error } = await service.auth.admin.deleteUser(processed.authUserId);
    if (error && !isUserMissing(error)) return { status: "failed", step: "auth" };
  }

  const completedResponse = await services.session.schema("platform")
    .rpc("complete_account_deletion_v1", { p_id: requestRowId });
  const completed = completedResponse.error ? null : parseAccountDeletionStep(completedResponse.data);
  if (!completed || completed.status !== "completed") return { status: "failed", step: "complete" };
  return finishEmail(completed, requestedAt, services);
}

const MARK_ERRORS: Readonly<Record<string, AccountDeletionRunStep>> = {
  account_deletion_login_active: "login",
  account_deletion_automatic_available: "automatic",
  account_deletion_invalid: "invalid",
  account_deletion_processing: "processing",
};

/** «Отметить выполненным»: ручная обработка завершена командой. */
export async function markAccountDeletionDone(
  requestRowId: string,
  requestedAt: string | null,
  note: string,
  services: AccountDeletionServices,
): Promise<AccountDeletionRunResult> {
  const marked = await services.session.schema("platform")
    .rpc("mark_account_deletion_done_v1", { p_id: requestRowId, p_note: note });
  if (marked.error) return { status: "failed", step: MARK_ERRORS[errorMessage(marked.error) ?? ""] ?? "mark" };
  const done = parseAccountDeletionStep(marked.data);
  if (!done || done.status !== "completed") return { status: "failed", step: "mark" };
  return finishEmail(done, requestedAt, services);
}
