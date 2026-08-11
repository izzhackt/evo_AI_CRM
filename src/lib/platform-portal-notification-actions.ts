"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformStudentPortalActor } from "./platform-guards";
import { normalizePlatformStudentPortalNotificationAck } from "./platform-portal";
import { isPlatformP6BPortalNotificationsEnabled } from "./server/platform-p6b-portal-notifications";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function parseUuid(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  return UUID_PATTERN.test(candidate) && candidate !== NIL_UUID
    ? candidate
    : null;
}

function outcomeRedirect(outcome: "read" | "invalid" | "unavailable"): never {
  const params = new URLSearchParams({ notification_result: outcome });
  redirect(`/portal/notifications?${params.toString()}`);
}

export async function markOwnStudentPortalNotificationReadAction(
  notificationIdInput: string,
  requestIdInput: string,
  formData: FormData,
): Promise<void> {
  // React supplies FormData after the server-bound notification id. P6B has no
  // browser-controlled mutation fields, so the form body is intentionally unused.
  void formData;
  if (!isPlatformP6BPortalNotificationsEnabled()) {
    outcomeRedirect("unavailable");
  }

  await requirePlatformStudentPortalActor();
  const notificationId = parseUuid(notificationIdInput);
  const requestId = parseUuid(requestIdInput);
  if (!notificationId || !requestId) outcomeRedirect("invalid");

  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client.schema("platform").rpc("mark_own_student_portal_notification_read_v1", {
      p_notification_id: notificationId,
      p_request_id: requestId,
    });
  } catch {
    outcomeRedirect("unavailable");
  }

  if (response.error) outcomeRedirect("unavailable");
  try {
    normalizePlatformStudentPortalNotificationAck(
      response.data,
      notificationId,
    );
  } catch {
    outcomeRedirect("unavailable");
  }

  revalidatePath("/portal", "layout");
  revalidatePath("/portal/notifications");
  outcomeRedirect("read");
}
