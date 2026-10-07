"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { ACCOUNT_DELETION_CONFIRM_WORD, type ConfirmationEmailStatus } from "../account-deletion-contract";
import { exactActionStringFields } from "../server/action-form-fields";

export type AccountDeletionProcessState = Readonly<{
  status: "idle" | "completed" | "failed" | "invalid" | "forbidden";
  step: "process" | "config" | "storage" | "auth" | "complete" | null;
  emailStatus: ConfirmationEmailStatus | null;
}>;

const FIELDS = ["request_row_id", "requested_at", "confirm"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * «Удалить аккаунт и данные» в «Настройках» (миграция 279). Подтверждение —
 * введённое слово «удалить»; просмотр интерфейса роли ничего не пишет. Права
 * решает база (account.deletion.process), здесь — подсказка.
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
  if (!fields || !UUID.test(id) || confirm !== ACCOUNT_DELETION_CONFIRM_WORD) {
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
  });
  revalidatePath("/v3/settings");
  return result.status === "completed"
    ? { status: "completed", step: null, emailStatus: result.emailStatus }
    : { status: "failed", step: result.step, emailStatus: null };
}
