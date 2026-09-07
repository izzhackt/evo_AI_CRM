import type { Metadata } from "next";

import { NotificationsView } from "@/components/v3/portal/NotificationsView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { markStudentPortalNotificationReadAction } from "@/lib/student-portal-actions";
import { readStudentPortalNotifications } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Уведомления — EVO Admissions",
};

export default async function StudentPortalNotificationsPage() {
  const notifications = await readStudentPortalNotifications();

  return (
    <PortalPage
      title="Уведомления"
      description="Важные изменения и сроки по вашему делу без внутренних комментариев команды."
    >
      <NotificationsView
        notifications={notifications}
        markReadAction={markStudentPortalNotificationReadAction}
      />
    </PortalPage>
  );
}
