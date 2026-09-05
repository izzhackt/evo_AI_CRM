import { redirect } from "next/navigation";

import { fixedRoleHomeRoute } from "@/lib/fixed-role-policy";
import { requirePlatformStaffActor } from "@/lib/platform-guards";

/**
 * Корень нового интерфейса.
 *
 * Раньше здесь был каталог частей: части собирались по одной и смотрелись по
 * одной. Теперь они сведены в один интерфейс, и у продукта корень — главная,
 * а не список того, из чего он состоит.
 */
export default async function V3Root() {
  const actor = await requirePlatformStaffActor();
  redirect(fixedRoleHomeRoute(actor.presentationRole));
}
