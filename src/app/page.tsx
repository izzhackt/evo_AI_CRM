import { redirect } from "next/navigation";

import { fixedRoleHomeRoute } from "@/lib/fixed-role-policy";
import { requirePlatformStaffActor } from "@/lib/platform-guards";

/** The authenticated product entry is the exact home of the active V3 role. */
export default async function Home() {
  const actor = await requirePlatformStaffActor();
  redirect(fixedRoleHomeRoute(actor.presentationRole));
}
