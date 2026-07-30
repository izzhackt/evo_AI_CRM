import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ROLE_HOME_ROUTE } from "@/lib/domain";
import { platformHomeRoute, requirePlatformActor } from "@/lib/platform-guards";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function Home() {
  if (isUiContractFixtureMode()) {
    const user = await currentUser();
    if (!user) redirect("/login");
    redirect(ROLE_HOME_ROUTE[user.role]);
  }

  const actor = await requirePlatformActor();
  redirect(platformHomeRoute(actor.platformRole));
}
