import "server-only";

import type { ProfileEvent } from "@/components/v3/profile/types";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { journalEvent } from "@/lib/v3/wording";

export type ProfileActivityCursor = Readonly<{ at: string; id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "Asia/Bishkek",
});
const FIELDS = new Set(["status", "priority", "due_at", "due_on", "assignee_membership_id"]);

export function parseProfileActivityCursor(at: string, id: string): ProfileActivityCursor | null {
  return TIMESTAMP.test(at) && Number.isFinite(Date.parse(at)) && UUID.test(id)
    ? Object.freeze({ at, id }) : null;
}

function fail(): never { throw new Error("История дела сейчас недоступна."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return fail();
  return value;
}

export async function readProfileActivity(
  actor: ActivePlatformActor,
  studentCaseId: string,
  cursor: ProfileActivityCursor | null,
): Promise<Readonly<{ events: readonly ProfileEvent[]; nextCursor: ProfileActivityCursor | null }>> {
  if (actor.presentationRole !== "admin" && actor.presentationRole !== "admissions") return fail();
  const client = await createSupabaseServerClient();
  const response = await client.schema("platform").rpc("staff_student_case_activity", {
    p_student_case_id: uuid(studentCaseId), p_limit: 50,
    p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null,
  });
  if (response.error) return fail();
  const data = object(response.data);
  if (data.organization_id !== actor.organizationId || data.student_case_id !== studentCaseId
    || !Array.isArray(data.events) || data.events.length > 50) return fail();
  const seen = new Set<string>();
  const events = data.events.map((value: unknown): ProfileEvent => {
    const row = object(value);
    const id = uuid(row.id);
    const targetId = uuid(row.target_id);
    if (seen.has(id)) return fail();
    seen.add(id);
    if (typeof row.action !== "string" || !journalEvent(row.action)) return fail();
    if (!Array.isArray(row.changed_fields) || row.changed_fields.some((field) => !FIELDS.has(field))) return fail();
    const fields = [...new Set(row.changed_fields as string[])];
    const kind = row.target_kind;
    if (!["overview", "documents", "money", "task", "conversation"].includes(String(kind))) return fail();
    if ((kind === "documents") !== (row.occurred_at === null)) return fail();
    const timestamp = row.occurred_at;
    if (timestamp !== null && (typeof timestamp !== "string"
      || !parseProfileActivityCursor(timestamp, id))) return fail();
    const query = kind === "task"
      ? new URLSearchParams({ case: studentCaseId, task: targetId })
      : kind === "conversation"
        ? new URLSearchParams({ conversation: targetId })
        : new URLSearchParams({ case: studentCaseId, tab: String(kind) });
    return Object.freeze({
      id, transition: row.action, role: "", at: timestamp === null ? null : DATE.format(new Date(timestamp as string)),
      href: `${kind === "task" ? "/v3/calendar" : kind === "conversation" ? "/v3/inbox" : "/v3/profile"}?${query}`,
      changedFields: fields,
    });
  });
  let nextCursor: ProfileActivityCursor | null = null;
  if (data.next_cursor !== null) {
    const next = object(data.next_cursor);
    nextCursor = typeof next.at === "string" && typeof next.id === "string"
      ? parseProfileActivityCursor(next.at, next.id) : null;
    if (!nextCursor || events.length !== 50 || events.at(-1)?.id !== nextCursor.id) return fail();
  }
  return Object.freeze({ events: Object.freeze(events), nextCursor });
}
