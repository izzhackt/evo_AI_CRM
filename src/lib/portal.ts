import { redirect } from "next/navigation";
import { cache } from "react";

import { getT } from "./i18n";
import { requirePlatformStudentPortalActor } from "./platform-guards";
import { getPlatformStudentPortalSnapshot } from "./platform-portal";
import { isUiContractFixtureMode } from "./runtime-mode";

/**
 * Request-memoized page facade for every accepted /portal page.
 *
 * Identity comes only from the verified Supabase actor. The repository calls
 * RLS-scoped, argument-free RPCs, so a route cannot select another student's
 * case by URL, query string or legacy numeric identifier.
 */
export const getPortalPageData = cache(async () => {
  if (isUiContractFixtureMode()) {
    const { getFixturePortalPageData } = await import("./portal-fixture");
    return getFixturePortalPageData();
  }

  const actor = await requirePlatformStudentPortalActor();
  const snapshot = await getPlatformStudentPortalSnapshot(actor);
  if (!snapshot) redirect("/platform-pending?from=/portal");

  const { t, locale } = await getT();
  return {
    user: { name: snapshot.student.name },
    snapshot,
    t,
    locale,
  };
});
