import { redirect } from "next/navigation";

import { currentUser } from "./auth";
import { getT } from "./i18n";
import { studentPortalSnapshotForUser } from "./queries";
import { isUiContractFixtureMode } from "./runtime-mode";

/**
 * Preserves the accepted SQLite-backed visual/scenario fixture only for the
 * explicit non-production UI-contract mode. Normal Platform sessions never
 * import this module and always use Supabase Auth plus RLS-scoped RPCs.
 */
export async function getFixturePortalPageData() {
  if (!isUiContractFixtureMode()) {
    throw new Error("Portal fixture data is disabled");
  }

  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "client") redirect("/dashboard");

  const { t, locale } = await getT();
  return {
    user: { name: user.name },
    snapshot: studentPortalSnapshotForUser(user.id),
    t,
    locale,
  };
}
