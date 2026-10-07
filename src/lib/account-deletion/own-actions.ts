"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "../supabase/server";
import { parseOwnAccountDeletion, type OwnAccountDeletion } from "../account-deletion-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type OwnAccountDeletionActionResult =
  | Readonly<{ ok: true; request: OwnAccountDeletion }>
  | Readonly<{ ok: false }>;

/**
 * «Удалить аккаунт» (миграция 279, App Store 5.1.1(v)): запрос из кабинета,
 * анкеты или экрана ожидания. Кто может просить, решает база по живой сессии
 * (сотрудникам отказ); request_id стабилен на попытку, повтор и сбой сети
 * возвращают тот же открытый запрос.
 */
export async function requestOwnAccountDeletionAction(requestId: unknown): Promise<OwnAccountDeletionActionResult> {
  if (typeof requestId !== "string" || !UUID.test(requestId)) return { ok: false };
  try {
    const client = await createSupabaseServerClient();
    const { data: user } = await client.auth.getUser();
    if (!user.user) return { ok: false };
    const { data, error } = await client.schema("platform")
      .rpc("request_account_deletion_v2", { p_request_id: requestId });
    if (error) return { ok: false };
    const request = parseOwnAccountDeletion(data);
    if (!request) return { ok: false };
    revalidatePath("/portal/profile");
    revalidatePath("/apply/status");
    return { ok: true, request };
  } catch {
    return { ok: false };
  }
}
