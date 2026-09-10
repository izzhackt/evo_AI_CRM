export type StaffNotification = Readonly<{
  id: string;
  kind: "task_assigned" | "task_updated" | "chat_mention" | "case_help";
  createdAt: string;
  readAt: string | null;
  href: string;
}>;
export type StaffNotificationCursor = Readonly<{ at: string; id: string }>;
export type StaffNotificationPage = Readonly<{
  items: readonly StaffNotification[];
  unreadCount: string;
  nextCursor: StaffNotificationCursor | null;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isStaffNotificationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}
export function isStaffNotificationCursor(value: unknown): value is StaffNotificationCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Record<string, unknown>;
  return isStaffNotificationId(cursor.id) && timestamp(cursor.at);
}
export function decodeStaffNotifications(value: unknown): StaffNotificationPage {
  const fail = (): never => { throw new Error("staff_notifications_response_invalid"); };
  if (!value || typeof value !== "object") return fail();
  const page = value as Record<string, unknown>;
  if (typeof page.unread_count !== "string" || !/^\d{1,20}$/.test(page.unread_count)
    || !Array.isArray(page.items) || page.items.length > 51) return fail();
  const items = page.items.map((entry: unknown): StaffNotification => {
    if (!entry || typeof entry !== "object") return fail();
    const row = entry as Record<string, unknown>;
    if (!isStaffNotificationId(row.id) || !timestamp(row.created_at)
      || (row.read_at !== null && !timestamp(row.read_at))) return fail();
    let href: string;
    if (row.kind === "chat_mention") {
      if (!isStaffNotificationId(row.message_id) || !["general", "sales", "admissions"].includes(String(row.channel_key))
        || (row.parent_message_id !== null && !isStaffNotificationId(row.parent_message_id))) return fail();
      const query = new URLSearchParams({ channel: String(row.channel_key), message: row.message_id });
      if (typeof row.parent_message_id === "string") query.set("thread", row.parent_message_id);
      href = `/v3/team-chat?${query}`;
    } else if (row.kind === "task_assigned" || row.kind === "task_updated") {
      if (!isStaffNotificationId(row.staff_task_id)) return fail();
      href = `/v3/tasks?task=${row.staff_task_id}`;
    } else if (row.kind === "case_help") {
      if (!isStaffNotificationId(row.student_case_id) || !isStaffNotificationId(row.help_request_id)) return fail();
      href = `/v3/profile?case=${row.student_case_id}&tab=route#case-help`;
    } else return fail();
    return { id: row.id, kind: row.kind, createdAt: row.created_at, readAt: row.read_at, href };
  });
  const visible = items.slice(0, 50);
  const last = visible.at(-1);
  return { items: visible, unreadCount: page.unread_count,
    nextCursor: items.length > 50 && last ? { at: last.createdAt, id: last.id } : null };
}
