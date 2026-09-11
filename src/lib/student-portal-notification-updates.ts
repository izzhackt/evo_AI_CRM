"use server";

import { requireStudentPortalActor } from "./student-portal-guards";
import { readStudentPortalNotifications } from "./v3/portal-source";

export async function loadStudentPortalNotificationState() {
  try {
    await requireStudentPortalActor();
    const notifications = await readStudentPortalNotifications();
    return {
      ok: true as const,
      unread: notifications.filter(item => item.readAt === null).length,
    };
  } catch {
    return { ok: false as const };
  }
}
