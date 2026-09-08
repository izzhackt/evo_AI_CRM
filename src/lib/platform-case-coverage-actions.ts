"use server";

import { randomUUID } from "node:crypto";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";
import { parseCoverageUuid, parseCoverageVersion } from "./platform-case-coverage-contract.ts";
import {
  COVERAGE_COMMAND_FIELDS,
  parseCoverageCommand,
  parseCoverageTaskSnapshot,
} from "./platform-case-coverage-command.ts";

export type CaseCoverageActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
  requestId: string;
}>;

function candidateField(form: FormData, key: string): string | null {
  const values = [...form.entries()].filter(([name]) => name === key || name === `_1_${key}`);
  return values.length === 1 && typeof values[0][1] === "string" ? values[0][1] : null;
}

function outcome(form: FormData, status: CaseCoverageActionState["status"]): CaseCoverageActionState {
  return { status, requestId: status === "request_conflict" || status === "saved" ? randomUUID() :
    parseCoverageUuid(candidateField(form, "request_id")) ?? randomUUID() };
}

export async function manageCaseCoverageAction(
  _previous: CaseCoverageActionState,
  form: FormData,
): Promise<CaseCoverageActionState> {
  const actor = await requirePlatformStaffActor();
  if (actor.authorityRole !== "admin") return outcome(form, "forbidden");
  const snapshot = parseCoverageTaskSnapshot(candidateField(form, "task_snapshot"));
  if (!snapshot) return outcome(form, "invalid");
  const fields = exactActionStringFields(form, [
    ...COVERAGE_COMMAND_FIELDS, ...snapshot.map((task) => `task_${task.id}`),
  ]);
  const command = fields ? parseCoverageCommand(fields) : null;
  if (!command) return outcome(form, "invalid");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("manage_case_coverage", {
      p_operation: command.operation,
      p_organization_id: actor.organizationId,
      p_student_case_id: command.caseId,
      p_expected_owner: command.ownerId,
      p_expected_scope_version: command.scopeVersion,
      p_substitute_membership_id: command.substituteId,
      p_planned_end_on: command.plannedEndOn,
      p_coverage_id: command.coverageId,
      p_expected_coverage_version: command.coverageVersion,
      p_tasks: command.tasks,
      p_reason: command.reason,
      p_request_id: command.requestId,
    });
    if (error) {
      if (error.code === "42501") return outcome(form, "forbidden");
      if (error.code === "PT409") return outcome(form, "stale");
      if ((error.code === "22023" || error.code === "23505") && /request_id/i.test(error.message)) {
        return outcome(form, "request_conflict");
      }
      return outcome(form, error.code === "22023" ? "invalid" : "unavailable");
    }
    // Only the exact confirmed command can produce a success state. An unknown
    // response may follow a committed write; keep its request ID for replay.
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.organization_id !== actor.organizationId || data.student_case_id !== command.caseId ||
      data.operation !== command.operation || !parseCoverageUuid(data.coverage_id) ||
      !parseCoverageVersion(data.coverage_version) || !parseCoverageVersion(data.current_scope_version) ||
      data.transferred_task_count !== command.tasks.filter((task) => task.selected).length ||
      (command.operation === "start" && (data.original_curator_membership_id !== command.ownerId ||
        data.substitute_curator_membership_id !== command.substituteId || data.planned_end_on !== command.plannedEndOn)) ||
      (command.operation === "return" && (data.coverage_id !== command.coverageId ||
        data.substitute_curator_membership_id !== command.ownerId))) return outcome(form, "unavailable");
    // Both views are force-dynamic. The confirmed receipt lets the client
    // navigate to the new canonical owner before requesting the next preview;
    // refreshing the outgoing owner's selection here would erase the receipt.
    return outcome(form, "saved");
  } catch {
    return outcome(form, "unavailable");
  }
}
