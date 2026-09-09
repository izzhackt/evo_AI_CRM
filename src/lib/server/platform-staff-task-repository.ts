import "server-only";

import type { ActivePlatformActor, PlatformActor } from "../platform-auth";
import { parseStaffParticipant, parseStaffTask, type StaffTaskCursor, type StaffTaskFilter, type StaffTaskView } from "../platform-staff-task-contract";
import { createSupabaseServerClient } from "../supabase/server";
import { isTeamChatChannel, teamChatRoleCanAccess } from "../platform-team-chat";
import { staffTaskUuid } from "../platform-staff-task-contract";

function assertStaff(actor: PlatformActor) {
  if (!["admin", "sales", "admissions"].includes(actor.authorityRole)) throw new Error("Staff workspace is unavailable.");
}
export async function readStaffTaskChatSource(actor: ActivePlatformActor, taskId: string) {
  assertStaff(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_task_chat_source", {
    p_organization_id: actor.organizationId, p_task_id: taskId,
  });
  if (error) throw new Error("Task source is unavailable.");
  if (data === null) return null;
  if (!data || typeof data !== "object" || !staffTaskUuid(data.message_id) || !isTeamChatChannel(data.channel_key)) {
    throw new Error("Task source is unavailable.");
  }
  if (!teamChatRoleCanAccess(actor.presentationRole, data.channel_key)) return null;
  return `/v3/team-chat?${new URLSearchParams({ channel: data.channel_key, message: data.message_id })}`;
}
export async function listStaffParticipants(actor: PlatformActor) {
  assertStaff(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_workspace_participants", { p_organization_id: actor.organizationId });
  if (error || !Array.isArray(data)) throw new Error("Staff participants are unavailable.");
  const participants = data.map(parseStaffParticipant);
  if (new Set(participants.map((person) => person.membershipId)).size !== participants.length) throw new Error("Staff participants are unavailable.");
  return participants;
}
export async function listStaffTasks(actor: PlatformActor, options: Readonly<{
  view: StaffTaskView; status: StaffTaskFilter; cursor?: StaffTaskCursor | null; taskId?: string | null;
}>) {
  assertStaff(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_task_list", {
    p_organization_id: actor.organizationId, p_view: options.view, p_status: options.status,
    p_before_updated_at: options.cursor?.updatedAt ?? null, p_before_id: options.cursor?.id ?? null,
    p_task_id: options.taskId ?? null, p_limit: options.taskId ? 1 : 51,
  });
  if (error || !Array.isArray(data) || data.length > (options.taskId ? 1 : 51)) throw new Error("Staff tasks are unavailable.");
  const rows = data.map((row) => parseStaffTask(row, actor.organizationId));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Staff tasks are unavailable.");
  if (rows.some((row) => (options.taskId && row.id !== options.taskId)
    || (actor.authorityRole !== "admin" && actor.membershipId !== row.creatorMembershipId && actor.membershipId !== row.assigneeMembershipId))) throw new Error("Staff tasks are unavailable.");
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return Object.freeze({ rows: page, nextCursor: rows.length > 50 && last ? { updatedAt: last.updatedAt, id: last.id } : null });
}
