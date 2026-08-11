import type { ReactNode } from "react";

import { PortalShell } from "@/components/platform/portal/PortalShell";
import { PortalNotificationsRealtime } from "@/components/platform/portal/PortalNotificationsRealtime";
import { getPortalPageData } from "@/lib/portal";

export default async function StudentPortalLayout({ children }: { children: ReactNode }) {
  const { user, snapshot, locale, notificationsRealtimeScope } =
    await getPortalPageData();
  const durableNotificationsEnabled = notificationsRealtimeScope !== null;
  const unreadNotificationCount = durableNotificationsEnabled
    ? snapshot?.notifications?.filter((notification) => !notification.isRead)
        .length ?? 0
    : snapshot?.updates.filter((update) => !update.isRead).length ?? 0;
  return (
    <>
      {notificationsRealtimeScope && (
        <PortalNotificationsRealtime
          organizationId={notificationsRealtimeScope.organizationId}
          membershipId={notificationsRealtimeScope.membershipId}
        />
      )}
      <PortalShell
        user={user}
        unreadNotificationCount={unreadNotificationCount}
        locale={locale}
      >
        {children}
      </PortalShell>
    </>
  );
}
