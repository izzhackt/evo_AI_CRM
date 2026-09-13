"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { btnCls } from "@/components/ui";
import { staffRolesAction } from "@/lib/staff-roles-actions";
import { STAFF_ROLES_INITIAL_STATE, type StaffRolesActionState } from "@/lib/v3/staff-roles-contract";

/** Keep the exact request across an unknown server outcome, including disabled fields. */
export function useStaffRoleForm() {
  const request = useRef<{ payload: string; entries: [string, FormDataEntryValue][]; id: string } | null>(null);
  return useActionState(async (previous: StaffRolesActionState, form: FormData): Promise<StaffRolesActionState> => {
    if (previous.outcome !== "unknown") {
      const entries = [...form.entries()].filter(([key]) => !key.startsWith("$ACTION_") && key !== "request_id");
      const payload = JSON.stringify(entries);
      if (!request.current || request.current.payload !== payload || previous.status === "success") {
        request.current = { payload, entries, id: crypto.randomUUID() };
      }
    }
    if (!request.current) return { status: "error", outcome: "unknown", message: "Исходный запрос недоступен. Проверьте результат перед новым изменением." };
    const original = new FormData();
    for (const [key, value] of request.current.entries) original.append(key, value);
    original.set("request_id", request.current.id);
    try { return await staffRolesAction(previous, original); }
    catch { return { status: "error", outcome: "unknown", message: "Ответ не получен. Проверьте сохранение тем же запросом; не отправляйте новое изменение." }; }
  }, STAFF_ROLES_INITIAL_STATE);
}

export function StaffRoleFeedback({ state }: { state: StaffRolesActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"}
    className={`text-sm leading-6 ${state.status === "error" ? "text-danger" : "text-fg-2"}`}>{state.message}</p> : null;
}

export function StaffRoleCommandForm({ label, submitLabel, children, onComplete }: {
  label: string; submitLabel: string;
  children: (locked: boolean, state: StaffRolesActionState) => ReactNode;
  onComplete?: (state: StaffRolesActionState) => ReactNode;
}) {
  const [state, action, pending] = useStaffRoleForm();
  const saved = state.status === "success";
  return <form action={action} aria-label={label} aria-busy={pending} className="space-y-4">
    <fieldset disabled={pending || saved || state.outcome === "unknown"} className="min-w-0 space-y-4">
      {children(pending || saved || state.outcome === "unknown", state)}
    </fieldset>
    <StaffRoleFeedback state={state} />
    {!saved ? <button type="submit" className={btnCls} disabled={pending}>
      {pending ? "Проверяем…" : state.outcome === "unknown" ? "Проверить сохранение" : submitLabel}
    </button> : onComplete?.(state)}
  </form>;
}
