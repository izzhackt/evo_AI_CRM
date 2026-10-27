import { cookies } from "next/headers";

import { isNextUiFor, NEXT_UI_COOKIE, type NextUiActor } from "./ui-next-contract.ts";

/**
 * Серверный помощник экранов: рисовать ли «Новый вид» этому сотруднику. Истина только для настоящего
 * администратора (не просмотр роли) с включённым переключателем. Экран делает
 * `(await isNextUi(actor)) ? <НовыйВид …/> : <ПрежнийВид …/>`; данные, права и действия берёт одни и те же.
 */
export async function isNextUi(actor: NextUiActor): Promise<boolean> {
  return isNextUiFor(actor, (await cookies()).get(NEXT_UI_COOKIE)?.value);
}
