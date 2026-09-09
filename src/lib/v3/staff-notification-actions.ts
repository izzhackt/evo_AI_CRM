"use server";
import {
  isStaffNotificationCursor, isStaffNotificationId,
  type StaffNotificationCursor, type StaffNotificationPage,
} from "@/lib/platform-staff-notifications-contract";
import { markStaffNotificationRead, readStaffNotifications } from "@/lib/v3/staff-notification-source";

export async function loadStaffNotificationsAction(cursor: StaffNotificationCursor | null = null): Promise<
  { ok: true; page: StaffNotificationPage } | { ok: false; message: string }
> {
  if (cursor !== null && !isStaffNotificationCursor(cursor)) return { ok: false, message: "Обновите список уведомлений." };
  try { return { ok: true, page: await readStaffNotifications(cursor) }; }
  catch { return { ok: false, message: "Не удалось загрузить уведомления. Повторите или войдите снова." }; }
}
export async function markStaffNotificationReadAction(id: string): Promise<{ ok: boolean; message?: string }> {
  if (!isStaffNotificationId(id)) return { ok: false, message: "Уведомление недоступно." };
  try { await markStaffNotificationRead(id); return { ok: true }; }
  catch { return { ok: false, message: "Уведомление больше недоступно. Обновите список." }; }
}
