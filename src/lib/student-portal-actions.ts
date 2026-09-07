"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireStudentPortalActor } from "./student-portal-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { markStudentPortalNotificationRead } from "./v3/portal-source";

const MARK_NOTIFICATION_READ_FIELDS = ["notification_id"] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export async function markStudentPortalNotificationReadAction(
  form: FormData,
): Promise<void> {
  await requireStudentPortalActor();

  const fields = exactActionStringFields(form, MARK_NOTIFICATION_READ_FIELDS);
  const notificationId = fields?.get("notification_id")?.toLowerCase() ?? null;
  if (
    notificationId === null ||
    !UUID_PATTERN.test(notificationId) ||
    notificationId === NIL_UUID
  ) {
    throw new Error("Student Portal notification input is invalid.");
  }

  await markStudentPortalNotificationRead({
    notificationId,
    requestId: randomUUID(),
  });
  revalidatePath("/portal/notifications");
}
