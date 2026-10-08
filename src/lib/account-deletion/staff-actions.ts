"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import {
  ACCOUNT_DELETION_CONFIRM_WORD,
  parseAccountDeletionReviewDecision,
  type ConfirmationEmailStatus,
} from "../account-deletion-contract";
import { exactActionStringFields } from "../server/action-form-fields";

export type AccountDeletionProcessState = Readonly<{
  status: "idle" | "completed" | "failed" | "invalid" | "forbidden";
  step: "process" | "review" | "amocrm" | "config" | "storage" | "auth" | "complete" | null;
  emailStatus: ConfirmationEmailStatus | null;
}>;

export type AccountDeletionReviewState = Readonly<{
  status: "idle" | "done" | "failed" | "gone" | "has_account" | "invalid" | "forbidden";
}>;

const FIELDS = ["request_row_id", "requested_at", "confirm", "amocrm_erased"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * «Удалить аккаунт и данные» в «Настройках» (миграция 279). Подтверждение —
 * введённое слово «удалить»; просмотр интерфейса роли ничего не пишет. Права
 * решает база (account.deletion.process), здесь — подсказка.
 * `amocrm_erased` («1» или «0»): отметка Admin, что контакт и сделка в amoCRM
 * удалены; при связях с amoCRM база без неё не завершает запрос.
 */
export async function processAccountDeletionAction(
  _previous: AccountDeletionProcessState,
  form: FormData,
): Promise<AccountDeletionProcessState> {
  const actor = await requirePlatformStaffActor();
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) {
    return { status: "forbidden", step: null, emailStatus: null };
  }
  const fields = exactActionStringFields(form, FIELDS);
  const id = fields?.get("request_row_id") ?? "";
  const requestedAt = fields?.get("requested_at") ?? "";
  const confirm = (fields?.get("confirm") ?? "").trim().toLocaleLowerCase("ru");
  const amocrmErased = fields?.get("amocrm_erased");
  if (!fields || !UUID.test(id) || confirm !== ACCOUNT_DELETION_CONFIRM_WORD
    || (amocrmErased !== "0" && amocrmErased !== "1")) {
    return { status: "invalid", step: null, emailStatus: null };
  }
  const [{ createSupabaseServerClient }, { getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient },
    { runAccountDeletion }] = await Promise.all([
    import("../supabase/server"),
    import("../server/platform-supabase-backend-config.ts"),
    import("../server/platform-supabase-service-client.ts"),
    import("../server/account-deletion-processor.ts"),
  ]);
  const session = await createSupabaseServerClient();
  const result = await runAccountDeletion(id, Number.isNaN(Date.parse(requestedAt)) ? null : requestedAt, {
    session,
    service: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  }, amocrmErased === "1");
  revalidatePath("/v3/settings");
  return result.status === "completed"
    ? { status: "completed", step: null, emailStatus: result.emailStatus }
    : { status: "failed", step: result.step, emailStatus: null };
}

const REVIEW_FIELDS = ["request_row_id", "kind", "item_id", "decision"] as const;

/**
 * Решение Admin по одной записи «Проверить вручную» (дополнение к 279 от
 * 08.10): «erase» удаляет этот чат или обезличивает этого лида, этого клиента
 * или дело без аккаунта студента; «not_subject» это «Не этот человек», ничего не
 * меняет. База принимает только запись из списка этого запроса и меняет
 * только её; решение пишется в журнал.
 */
export async function resolveAccountDeletionCandidateAction(
  _previous: AccountDeletionReviewState,
  form: FormData,
): Promise<AccountDeletionReviewState> {
  const actor = await requirePlatformStaffActor();
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) return { status: "forbidden" };
  const fields = exactActionStringFields(form, REVIEW_FIELDS);
  const id = fields?.get("request_row_id") ?? "";
  const kind = fields?.get("kind") ?? "";
  const itemId = fields?.get("item_id") ?? "";
  const decision = fields?.get("decision") ?? "";
  if (!fields || !UUID.test(id) || !UUID.test(itemId) || !["chat", "lead", "client", "case"].includes(kind)
    || (decision !== "erase" && decision !== "not_subject")) {
    return { status: "invalid" };
  }
  const { createSupabaseServerClient } = await import("../supabase/server");
  const session = await createSupabaseServerClient();
  const { data, error } = await session.schema("platform").rpc("resolve_account_deletion_candidate_v1", {
    p_id: id, p_kind: kind, p_item_id: itemId, p_decision: decision,
  });
  revalidatePath("/v3/settings");
  if (error) {
    if (error.message === "account_deletion_candidate_not_found") return { status: "gone" };
    if (error.message === "account_deletion_candidate_has_account") return { status: "has_account" };
    if (error.code === "42501") return { status: "forbidden" };
    return { status: "failed" };
  }
  return parseAccountDeletionReviewDecision(data) ? { status: "done" } : { status: "failed" };
}
