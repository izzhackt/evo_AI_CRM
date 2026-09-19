import { isStaffPreview } from "../platform-access.ts";
import "server-only";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  decodeStaffNotifications,
  type StaffNotificationCursor,
} from "@/lib/platform-staff-notifications-contract";

export async function readStaffNotifications(cursor: StaffNotificationCursor | null = null) {
  const actor = await requirePlatformStaffActor();
  return readStaffNotificationsForActor(actor, cursor);
}

export async function readStaffNotificationsForActor(actor: ActivePlatformActor, cursor: StaffNotificationCursor | null = null) {
  if (isStaffPreview(actor)) throw new Error("staff_notifications_preview_unavailable");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("platform").rpc("staff_notifications_page_v2", {
    p_organization_id: actor.organizationId,
    p_before_at: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (error) throw new Error("staff_notifications_unavailable");
  return decodeStaffNotifications(data);
}

export async function markStaffNotificationRead(id: string) {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) throw new Error("staff_notifications_preview_unavailable");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("platform").rpc("mark_staff_notification_read", {
    p_organization_id: actor.organizationId, p_notification_id: id,
  });
  if (error || !data || data.id !== id || data.read !== true) throw new Error("staff_notifications_unavailable");
}

export async function markAllStaffNotificationsRead() {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) throw new Error("staff_notifications_preview_unavailable");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("platform").rpc("mark_all_staff_notifications_read", {
    p_organization_id: actor.organizationId,
  });
  if (error || !data || typeof data.marked !== "string") throw new Error("staff_notifications_unavailable");
}
