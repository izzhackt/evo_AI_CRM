import type { Metadata } from "next";

import { NotificationsView } from "@/components/v3/portal/NotificationsView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { markStudentPortalNotificationReadAction } from "@/lib/student-portal-actions";
import { readStudentPortalNotifications } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Уведомления — EVO Admissions",
};

/**
 * Loops the existing single-item action over every unread id — no new RPC.
 * Each call re-verifies the Student actor and replays through the same
 * durable command id, so a retry after a partial failure stays safe.
 */
async function markAllStudentPortalNotificationsReadAction(): Promise<void> {
  "use server";
  const notifications = await readStudentPortalNotifications();
  for (const notification of notifications) {
    if (notification.readAt !== null) continue;
    const form = new FormData();
    form.set("notification_id", notification.notificationId);
    await markStudentPortalNotificationReadAction(form);
  }
}

export default async function StudentPortalNotificationsPage() {
  const notifications = await readStudentPortalNotifications();

  return (
    <PortalPage
      title="Уведомления"
      description="Важные изменения и сроки по вашему поступлению."
    >
      <NotificationsView
        notifications={notifications}
        markReadAction={markStudentPortalNotificationReadAction}
        markAllReadAction={markAllStudentPortalNotificationsReadAction}
      />
    </PortalPage>
  );
}
