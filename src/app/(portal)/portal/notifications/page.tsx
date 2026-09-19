import type { Metadata } from "next";

import { NotificationsView } from "@/components/portal/admission/NotificationsView";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { markStudentPortalNotificationReadAction } from "@/lib/student-portal-actions";
import { readStudentPortalNotifications } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.notificationsTitle} — EVO Admissions` };
}

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
  const [notifications, locale] = await Promise.all([readStudentPortalNotifications(), getLocale()]);
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kickerCabinet}</p>
        <h1 className="pt-page-title">{strings.notificationsTitle}</h1>
        <p className="pt-page-lead">{strings.notificationsLead}</p>
      </header>
      <NotificationsView
        notifications={notifications}
        markReadAction={markStudentPortalNotificationReadAction}
        markAllReadAction={markAllStudentPortalNotificationsReadAction}
        locale={locale}
      />
    </main>
  );
}
