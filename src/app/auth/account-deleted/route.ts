import { redirect } from "next/navigation";

import { ACCOUNT_DELETED_NOTICE } from "@/lib/account-deletion-contract";
import { sessionAccountDeleted } from "@/lib/account-deletion/deleted-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Удаление аккаунта (миграция 280, ревью п. 4). Сюда ведут прокси и экраны
 * анкеты, когда Auth отвечает, что пользователя из токена больше нет. Сервер
 * проверяет это сам: только тогда локальный выход очищает cookie и вход
 * показывает «Аккаунт удалён». Живой аккаунт этим адресом не выйти: ссылка
 * на него лишь открывает страницу входа, сессия не трогается.
 */
export async function GET(): Promise<never> {
  let deleted = false;
  try {
    const client = await createSupabaseServerClient();
    deleted = await sessionAccountDeleted(client);
    if (deleted) await client.auth.signOut({ scope: "local" });
  } catch {
    // Вход остаётся безопасным местом в любом случае.
  }
  redirect(deleted ? `/login?notice=${ACCOUNT_DELETED_NOTICE}` : "/login");
}
