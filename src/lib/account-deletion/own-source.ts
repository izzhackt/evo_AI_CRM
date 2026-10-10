import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { parseOwnAccountDeletion, type OwnAccountDeletion } from "../account-deletion-contract";

export type OwnAccountDeletionRead =
  | Readonly<{ status: "ready"; request: OwnAccountDeletion | null }>
  | Readonly<{ status: "unavailable" }>;

/**
 * Свой запрос на удаление (миграция 280): любой вошедший аккаунт, который не
 * сотрудник, в том числе анкета без одобрения. Отказ RPC или чужая форма
 * ответа — «unavailable»: экран говорит, что статус не проверен, а не
 * показывает кнопку поверх возможно открытого запроса.
 */
export async function readOwnAccountDeletion(): Promise<OwnAccountDeletionRead> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("own_account_deletion_request_v1");
    if (error) return { status: "unavailable" };
    const request = parseOwnAccountDeletion(data);
    return request === undefined ? { status: "unavailable" } : { status: "ready", request };
  } catch {
    return { status: "unavailable" };
  }
}
