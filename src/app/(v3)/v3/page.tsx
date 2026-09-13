import { staffHomeRoute } from "@/lib/platform-access";
import { redirect } from "next/navigation";

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
  redirect(staffHomeRoute(actor));
}
