import "server-only";

import type { ActivePlatformActor, PlatformActor } from "../platform-auth";
import { parseStaffParticipant, parseStaffTask, type StaffTaskCursor, type StaffTaskFilter, type StaffTaskView } from "../platform-staff-task-contract";
import { createSupabaseServerClient } from "../supabase/server";
import { isTeamChatChannel, teamChatRoleCanAccess } from "../platform-team-chat";
import { staffTaskUuid } from "../platform-staff-task-contract";
import { staffTaskTimestamp, staffTaskVersion } from "../platform-staff-task-contract";

export type StaffTaskContext = Readonly<{
  leadId: string | null;
  outcomes: readonly Readonly<{ requestId: string; version: string; note: string; createdAt: string; author: string }>[];
  truncated: boolean;
}>;
export async function readStaffTaskContext(actor: ActivePlatformActor, taskId: string): Promise<StaffTaskContext> {
  assertStaff(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_task_context", { p_organization_id: actor.organizationId, p_task_id: taskId });
  if (error || !data || !Array.isArray(data.outcomes) || data.outcomes.length > 30
    || typeof data.outcomes_truncated !== "boolean" || (data.lead_id !== null && !staffTaskUuid(data.lead_id))) throw new Error("Task context is unavailable.");
  const outcomes = data.outcomes.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Task context is unavailable.");
    const value = row as Record<string, unknown>;
    const requestId = staffTaskUuid(value.request_id), version = staffTaskVersion(value.version), createdAt = staffTaskTimestamp(value.created_at);
    if (!requestId || !version || !createdAt || typeof value.note !== "string" || value.note.length > 4000
      || typeof value.author !== "string" || value.author.length > 1000) throw new Error("Task context is unavailable.");
    return { requestId, version, createdAt, note: value.note, author: value.author };
  });
  return { leadId: data.lead_id, outcomes, truncated: data.outcomes_truncated };
}
export async function readStaffTaskLeadContext(actor: ActivePlatformActor, leadId: string) {
  assertStaff(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_task_lead_context", { p_organization_id: actor.organizationId, p_lead_id: leadId });
  if (error || !data || data.lead_id !== leadId || !staffTaskUuid(data.lead_id) || !staffTaskVersion(data.workflow_version)
    || typeof data.client_name !== "string" || data.client_name.length > 1000
    || (data.next_action !== null && (typeof data.next_action !== "string" || data.next_action.length > 1000))
    || (data.next_action_due_date !== null && (typeof data.next_action_due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.next_action_due_date)))
    || typeof data.can_open_pipeline !== "boolean") throw new Error("Lead task context is unavailable.");
  return { leadId: data.lead_id as string, clientDisplayName: data.client_name as string,
    workflowVersion: data.workflow_version as string, nextActionText: data.next_action as string | null,
    nextActionDueDate: data.next_action_due_date as string | null, canOpenPipeline: data.can_open_pipeline as boolean };
}
export async function readLeadTaskLinks(actor: ActivePlatformActor, leadId: string) {
  assertStaff(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("lead_staff_task_links", { p_organization_id: actor.organizationId, p_lead_id: leadId });
  if (error || !Array.isArray(data) || data.length > 51) throw new Error("Lead tasks are unavailable.");
  const rows = data.map((row) => {
    if (!row || !staffTaskUuid(row.id) || typeof row.title !== "string" || row.title.length > 1000
      || !["open", "in_progress", "blocked", "done", "cancelled"].includes(row.status)) throw new Error("Lead tasks are unavailable.");
    return { id: row.id as string, title: row.title as string, status: row.status as string };
  });
  return { rows: rows.slice(0, 50), truncated: rows.length > 50 };
}

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
