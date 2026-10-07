import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isDeletedAuthUserError } from "../account-deletion-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Ревью 279, п. 4: аккаунт удалён, а в браузере остался его токен. Только
 * сервер Auth знает, что пользователя больше нет (`user_not_found`); любая
 * другая ошибка или сбой чтения значит «не удалён».
 */
export async function sessionAccountDeleted(client?: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await (client ?? await createSupabaseServerClient()).auth.getUser();
    return isDeletedAuthUserError(error);
  } catch {
    return false;
  }
}
