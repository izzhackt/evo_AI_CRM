"use client";

import { useActionState, useRef } from "react";
import { STAFF_WORKSPACE_INITIAL_STATE, type StaffWorkspaceActionState } from "@/lib/v3/staff-workspace-contract";
import { staffAuthConflictMessage } from "@/lib/v3/wording";

type Action = (previous: StaffWorkspaceActionState, form: FormData) => Promise<StaffWorkspaceActionState>;

function copyForm(source: FormData) {
  const copy = new FormData();
  source.forEach((value, key) => copy.append(key, value));
  return copy;
}

/** Keep the entire original command when its outcome is unknown, not just its ID. */
export function useStaffCommandForm(action: Action, idField = "request_id") {
  const original = useRef<FormData | null>(null);
  return useActionState(async (previous: StaffWorkspaceActionState, form: FormData) => {
    if (previous.retryAllowed && previous.outcome !== "unknown" && form.get("retry_rejected") === "yes") original.current = null;
    if (!original.current) {
      original.current = copyForm(form);
      original.current.set(idField, crypto.randomUUID());
    }
    const command = copyForm(original.current);
    try {
      const result = await action(previous, command);
      if (result.status === "error" && result.outcome !== "unknown" && result.metadataOutcome !== "unknown") original.current = null;
      return result;
    } catch {
      return { status: "error", outcome: "unknown", requestId: String(command.get("request_id") ?? ""),
        message: "Ответ не получен. Проверьте тот же запрос; новое письмо или изменение повторно не создаётся." } satisfies StaffWorkspaceActionState;
    }
  }, STAFF_WORKSPACE_INITIAL_STATE);
}

export function StaffCommandFeedback({ state }: { state: StaffWorkspaceActionState }) {
  const conflict = staffAuthConflictMessage(state.conflictCode);
  return <>{state.message ? <p role={state.status === "error" ? "alert" : "status"}
    className={`text-sm leading-6 ${state.status === "error" ? "text-danger" : "text-fg-2"}`}>{state.message}</p> : null}
    {conflict ? <p role="alert" className="text-sm leading-6 text-danger">{conflict}</p> : null}</>;
}
