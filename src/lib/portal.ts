import { redirect } from "next/navigation";
import { cache } from "react";

import { getT } from "./i18n";
import { requirePlatformStudentPortalActor } from "./platform-guards";
import { getPlatformStudentPortalSnapshot } from "./platform-portal";
import { isUiContractFixtureMode } from "./runtime-mode";
import { isPlatformP6BPortalNotificationsEnabled } from "./server/platform-p6b-portal-notifications";
import { isPlatformP6COverdueNotificationsEnabled } from "./server/platform-p6c-overdue-config";

/**
 * Frozen V1 student-portal facade retained only as historical migration and
 * rollback input. The V2 route contract rejects every /portal page, so this
 * Supabase-backed path is not active authority and must not be imported by a
 * V2 capability until a later owner-approved replacement slice removes it.
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
    notificationsRealtimeScope: (
      isPlatformP6BPortalNotificationsEnabled()
      || isPlatformP6COverdueNotificationsEnabled()
    )
      ? {
          organizationId: actor.organizationId,
          membershipId: actor.membershipId,
        }
      : null,
    t,
    locale,
  };
});
