"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import {
  ACCOUNT_DELETION_CONFIRM_WORD,
  ACCOUNT_DELETION_DONE_WORD,
  normalizeAccountDeletionNote,
  type ConfirmationEmailStatus,
} from "../account-deletion-contract";
import { exactActionStringFields } from "../server/action-form-fields";
import type { AccountDeletionRunResult, AccountDeletionRunStep } from "../server/account-deletion-processor.ts";

export type AccountDeletionActionState = Readonly<{
  status: "idle" | "completed" | "failed" | "invalid" | "forbidden";
  step: AccountDeletionRunStep | null;
  emailStatus: ConfirmationEmailStatus | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PROCESS_FIELDS = ["request_row_id", "requested_at", "confirm"] as const;
const DONE_FIELDS = ["request_row_id", "requested_at", "confirm", "note"] as const;

function word(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("ru");
}

function requestedAtOf(value: string | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function state(result: AccountDeletionRunResult): AccountDeletionActionState {
  return result.status === "completed"
    ? { status: "completed", step: null, emailStatus: result.emailStatus }
    : { status: "failed", step: result.step, emailStatus: null };
}

async function services() {
  const [{ createSupabaseServerClient }, { getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] =
    await Promise.all([
      import("../supabase/server"),
      import("../server/platform-supabase-backend-config.ts"),
      import("../server/platform-supabase-service-client.ts"),
    ]);
  return {
    session: await createSupabaseServerClient(),
    service: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  };
}

/**
 * «Удалить аккаунт и данные» (простой аккаунт, миграция 280). Подтверждение —
 * введённое слово «удалить»; просмотр интерфейса роли ничего не пишет. Права
 * и то, что аккаунт простой, решает база; здесь — подсказка.
 */
export async function processAccountDeletionAction(
  _previous: AccountDeletionActionState,
  form: FormData,
): Promise<AccountDeletionActionState> {
  const actor = await requirePlatformStaffActor();
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) {
    return { status: "forbidden", step: null, emailStatus: null };
  }
  const fields = exactActionStringFields(form, PROCESS_FIELDS);
  const id = fields?.get("request_row_id") ?? "";
  if (!fields || !UUID.test(id) || word(fields.get("confirm")) !== ACCOUNT_DELETION_CONFIRM_WORD) {
    return { status: "invalid", step: null, emailStatus: null };
  }
  const { runAccountDeletion } = await import("../server/account-deletion-processor.ts");
  const result = await runAccountDeletion(id, requestedAtOf(fields.get("requested_at")), await services());
  revalidatePath("/v3/settings");
  return state(result);
}

/**
 * «Отметить выполненным» (ручная обработка, миграция 280): команда сделала
 * всё по инструкции docs/runbooks/account-deletion.md. Нужны заметка (что
 * сделано, без личных данных) и слово «выполнено». База отказывает, пока
 * вход в аккаунт работает или если аккаунт можно удалить автоматически, и
 * пишет действие в журнал вместе с заметкой.
 */
export async function markAccountDeletionDoneAction(
  _previous: AccountDeletionActionState,
  form: FormData,
): Promise<AccountDeletionActionState> {
  const actor = await requirePlatformStaffActor();
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) {
    return { status: "forbidden", step: null, emailStatus: null };
  }
  const fields = exactActionStringFields(form, DONE_FIELDS);
  const id = fields?.get("request_row_id") ?? "";
  const note = normalizeAccountDeletionNote(fields?.get("note") ?? "");
  if (!fields || !UUID.test(id) || !note || word(fields.get("confirm")) !== ACCOUNT_DELETION_DONE_WORD) {
    return { status: "invalid", step: null, emailStatus: null };
  }
  const { markAccountDeletionDone } = await import("../server/account-deletion-processor.ts");
  const result = await markAccountDeletionDone(id, requestedAtOf(fields.get("requested_at")), note, await services());
  revalidatePath("/v3/settings");
  return state(result);
}
