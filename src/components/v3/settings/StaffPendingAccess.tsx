"use client";

import { useActionState, useEffect, useState } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { staffAuthPreparationAction, staffPreparePendingAccessAction } from "@/lib/staff-workspace-actions";
import { STAFF_WORKSPACE_INITIAL_STATE, type StaffAuthPreparation } from "@/lib/v3/staff-workspace-contract";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import { StaffInvitationFields, type InvitationRoleRow } from "./StaffInvitationFields";
import { invitationAccessIsValid } from "@/lib/v3/staff-invitation-access";
import { StaffCommandFeedback, useStaffCommandForm } from "./useStaffCommandForm";

function PreparationForm({ preparation, workspace, organizationId, readPending, onWriteLocked, onPrepareStart, onPrepareFinish }: {
  preparation: StaffAuthPreparation; workspace: StaffRoleWorkspace; organizationId: string;
  readPending: boolean; onWriteLocked: (locked: boolean) => void;
  onPrepareStart: () => boolean; onPrepareFinish: () => void;
}) {
  const [initial] = useState(preparation);
  const [rows, setRows] = useState<readonly InvitationRoleRow[]>(() => initial.assignments.map((entry, index) => ({
    clientId: `${entry.roleId}-${index}`, roleId: entry.roleId, roleVersion: entry.roleVersion, scope: entry.scope,
  })));
  const [noAccess, setNoAccess] = useState(initial.noAccess);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useStaffCommandForm(async (previous, form) => {
    if (!onPrepareStart()) return { status: "error", message: "Сначала завершите проверку этого запроса." };
    const result = await staffPreparePendingAccessAction(previous, form);
    if (result.outcome !== "unknown" && result.metadataOutcome !== "unknown") onPrepareFinish();
    return result;
  }, "command_request_id");
  const unknown = state.outcome === "unknown";
  const locked = pending || unknown || readPending || state.status === "success";
  useEffect(() => { onWriteLocked(pending || unknown); }, [onWriteLocked, pending, unknown]);
  const valid = invitationAccessIsValid(rows, noAccess, workspace, organizationId);
  return <form action={action} aria-busy={pending} className="space-y-4 border-t border-border pt-4">
    <input type="hidden" name="request_id" value={initial.requestId} />
    <input type="hidden" name="expected_preparation_version" value={initial.preparationVersion} />
    <p className="text-sm leading-6 text-fg-2">Изменятся только подготовленные права. Адресат остаётся прежним; новое письмо не отправляется.</p>
    <fieldset disabled={locked} className="min-w-0 space-y-4">
      <StaffInvitationFields rows={rows} noAccess={noAccess} workspace={workspace} organizationId={organizationId} onChange={(nextRows, nextNoAccess) => {
        setRows(nextRows); setNoAccess(nextNoAccess); setConfirmed(false);
      }} />
      <label className="grid gap-1.5 text-sm">Причина изменения<input className={`${inputCls} min-h-11 w-full`} name="reason" required minLength={3} maxLength={500} value={reason}
        onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm leading-6"><input type="checkbox" required name="rights_confirmed" value="yes" checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} className="h-5 w-5 shrink-0" />Новые права для этого запроса согласованы</label>
    </fieldset>
    <StaffCommandFeedback state={state} />
    {state.status !== "success" ? <button type="submit" className={`${btnCls} min-h-11`} formNoValidate={unknown}
      disabled={pending || readPending || (!unknown && (!valid || !confirmed))}>{pending ? "Сохраняем…" : unknown ? "Проверить сохранение прав" : "Сохранить подготовленные права"}</button>
      : <p className="text-sm leading-6 text-fg-2">Теперь нажмите «Проверить результат» в этом запросе.</p>}
  </form>;
}

export function StaffPendingAccess({ requestId, workspace, organizationId, reconcileLocked, onPrepareStart, onPrepareFinish }: {
  requestId: string; workspace: StaffRoleWorkspace; organizationId: string;
  reconcileLocked: boolean; onPrepareStart: () => boolean; onPrepareFinish: () => void;
}) {
  const [state, action, pending] = useActionState(staffAuthPreparationAction, STAFF_WORKSPACE_INITIAL_STATE);
  const [writeLocked, setWriteLocked] = useState(false);
  return <details className="space-y-3">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Проверить подготовленные права</summary>
    <form action={action}><input type="hidden" name="request_id" value={requestId} />
      <button className={`${btnGhostCls} min-h-11`} disabled={pending || writeLocked || reconcileLocked}>{pending ? "Загружаем…" : "Загрузить текущее состояние"}</button>
    </form>
    <StaffCommandFeedback state={state} />
    {state.preparation?.requestId === requestId ? (state.preparation.operation === "invite" || state.preparation.operation === "password") && state.preparation.status !== "completed" && state.preparation.status !== "rejected" && state.preparation.conflictCode !== "identity_already_linked"
      ? <PreparationForm key={`${requestId}:${state.preparation.preparationVersion}`} preparation={state.preparation} workspace={workspace} organizationId={organizationId}
        readPending={pending || reconcileLocked} onWriteLocked={setWriteLocked} onPrepareStart={onPrepareStart} onPrepareFinish={onPrepareFinish} />
      : <p className="text-sm leading-6 text-fg-3">Подготовленные права этого запроса больше не редактируются.</p> : null}
  </details>;
}
