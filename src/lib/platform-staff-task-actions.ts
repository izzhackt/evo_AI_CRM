"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { STAFF_TASK_FORM_FIELDS, parseStaffTaskCommand, staffTaskTimestamp, staffTaskUuid, staffTaskVersion, type StaffTaskActionState } from "./platform-staff-task-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

export async function mutateStaffTaskAction(previous: StaffTaskActionState, form: FormData): Promise<StaffTaskActionState> {
  const actor = await requirePlatformStaffActor();
  let requestId = staffTaskUuid(form.get("request_id")) ?? previous.requestId;
  const failed = (status: StaffTaskActionState["status"]): StaffTaskActionState => ({ status, requestId, taskId: null, version: null });
  if (!["admin", "sales", "admissions"].includes(actor.authorityRole)) return failed("forbidden");
  const fields = exactActionStringFields(form, STAFF_TASK_FORM_FIELDS);
  const command = fields ? parseStaffTaskCommand(fields) : null;
  if (!command) return failed("invalid");
  requestId = command.p_request_id;
  try {
    const client = await createSupabaseServerClient();
    const { p_source_message_id: sourceMessageId, p_source_message_version: sourceMessageVersion, ...plainCommand } = command;
    const response = sourceMessageId && command.p_operation === "create"
      ? await client.schema("platform").rpc("create_staff_task_from_chat", {
        p_organization_id: actor.organizationId, p_request_id: command.p_request_id,
        p_message_id: sourceMessageId, p_message_version: sourceMessageVersion,
        p_title: command.p_title, p_assignee_membership_id: command.p_assignee_membership_id,
        p_description: command.p_description, p_priority: command.p_priority,
        p_due_on: command.p_due_on, p_due_at: command.p_due_at,
      })
      : await client.schema("platform").rpc("mutate_staff_task", { p_organization_id: actor.organizationId, ...plainCommand });
    const { data, error } = response;
    if (error) {
      if (error.code === "42501") return failed("forbidden");
      if (error.code === "PT409") return failed("stale");
      if (error.code === "23505") return failed("request_conflict");
      if (error.code === "22023") return failed("invalid");
      return failed("unavailable");
    }
    const taskId = staffTaskUuid(data?.staff_task_id);
    const version = staffTaskVersion(data?.version);
    if (!taskId || !version || data?.request_id !== requestId || !staffTaskTimestamp(data?.changed_at)
      || (command.p_staff_task_id !== null && command.p_staff_task_id !== taskId)) return failed("unavailable");
    revalidatePath("/v3/tasks");
    if (sourceMessageId) revalidatePath("/v3/team-chat");
    return { status: "saved", requestId, taskId, version };
  } catch {
    return failed("unavailable");
  }
}
