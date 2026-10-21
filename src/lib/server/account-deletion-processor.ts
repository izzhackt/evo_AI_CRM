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
 * пока вход работает или если аккаунт простой (начатый автоматический запрос,
 * который стал не простым, закрывается этим же путём: миграция 315).
 * Затем в обоих случаях письмо (если почта настроена) и
 * `record_account_deletion_email_v1`: статус письма записывается один раз,
 * адрес при этом удаляется. Сбой называет шаг; повтор безопасен. Запись статуса
 * сервер повторяет сам несколько раз (короткий сбой не оставляет адрес), а если
 * не вышло, у выполненного запроса есть «Повторить письмо»
 * (`resendAccountDeletionEmail`, ревью 280 F1 и UI-F2).
 *
 * Ключ service role проверяется ДО `process_account_deletion_v1`: удаление
 * строк в базе необратимо, и отсутствие ключа не должно обнаруживаться после
 * него (ревью 280 F2). Если вход удалить не удалось, сервер всё равно просит у
 * базы `complete_account_deletion_v1`: база сама решает, не активен ли вход
 * (мягко отключённый вход не мешает, миграция 315, SQL-2).
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
  /** Паузы перед повторами записи статуса письма; по умолчанию 150 и 500 мс. Для проверок. */
  recordRetryDelaysMs?: readonly number[];
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

/** Паузы перед повторами записи статуса письма (мс): короткий сбой сети или базы. */
const RECORD_RETRY_DELAYS_MS: readonly number[] = [150, 500];

/**
 * Записывает статус письма (один раз в базе; адрес при этом удаляется).
 * Повторяет запись при сбое: письмо уже отправлено, и повторять надо только
 * запись, а не отправку.
 */
async function recordEmailStatus(
  id: string,
  emailStatus: ConfirmationEmailStatus,
  services: AccountDeletionServices,
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    const recorded = await services.session.schema("platform")
      .rpc("record_account_deletion_email_v1", { p_id: id, p_status: emailStatus });
    if (!recorded.error && parseAccountDeletionStep(recorded.data)) return true;
    const delay = (services.recordRetryDelaysMs ?? RECORD_RETRY_DELAYS_MS)[attempt];
    if (delay === undefined) return false;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
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
  if (!await recordEmailStatus(done.id, emailStatus, services)) return { status: "failed", step: "email" };
  return { status: "completed", emailStatus };
}

/** Автоматическое удаление простого аккаунта. */
export async function runAccountDeletion(
  requestRowId: string,
  requestedAt: string | null,
  services: AccountDeletionServices,
): Promise<AccountDeletionRunResult> {
  // Ключ service role нужен позже, но проверяется до необратимого удаления в базе.
  let service: SupabaseClient;
  try {
    service = services.service();
  } catch {
    return { status: "failed", step: "config" };
  }

  const processedResponse = await services.session.schema("platform")
    .rpc("process_account_deletion_v1", { p_id: requestRowId });
  if (errorMessage(processedResponse.error) === "account_deletion_not_simple") {
    return { status: "failed", step: "not_simple" };
  }
  const processed = processedResponse.error ? null : parseAccountDeletionStep(processedResponse.data);
  if (!processed) return { status: "failed", step: "process" };
  if (processed.status === "completed") return finishEmail(processed, requestedAt, services);

  let authFailed = false;
  if (processed.authUserId) {
    const { error } = await service.auth.admin.deleteUser(processed.authUserId);
    authFailed = Boolean(error) && !isUserMissing(error);
  }

  // Даже если сервер Auth не удалил вход, база решает сама: вход, которым нельзя
  // войти (мягко отключён), запрос не держит; активный она отклонит.
  const completedResponse = await services.session.schema("platform")
    .rpc("complete_account_deletion_v1", { p_id: requestRowId });
  const completed = completedResponse.error ? null : parseAccountDeletionStep(completedResponse.data);
  if (!completed || completed.status !== "completed") return { status: "failed", step: authFailed ? "auth" : "complete" };
  return finishEmail(completed, requestedAt, services);
}

/**
 * «Повторить письмо» у выполненного запроса, статус письма которого не записан
 * (сбой записи, ревью 280 F1 и UI-F2). Ключ service role не нужен. Выполненный
 * запрос `complete_account_deletion_v1` отдаёт без изменений, вместе с адресом,
 * пока статус не записан. Кнопка есть только у выполненного запроса; у
 * невыполненного тот же вызов был бы обычным последним шагом (вход уже удалён)
 * или отказом базы, больше ничем.
 */
export async function resendAccountDeletionEmail(
  requestRowId: string,
  requestedAt: string | null,
  services: AccountDeletionServices,
): Promise<AccountDeletionRunResult> {
  const response = await services.session.schema("platform")
    .rpc("complete_account_deletion_v1", { p_id: requestRowId });
  const done = response.error ? null : parseAccountDeletionStep(response.data);
  if (!done || done.status !== "completed") return { status: "failed", step: "complete" };
  return finishEmail(done, requestedAt, services);
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
