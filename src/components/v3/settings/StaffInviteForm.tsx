"use client";

import { useState } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { staffAuthAction } from "@/lib/staff-workspace-actions";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import { StaffInvitationFields, type InvitationRoleRow } from "./StaffInvitationFields";
import { invitationAccessIsValid } from "@/lib/v3/staff-invitation-access";
import { StaffCommandFeedback, useStaffCommandForm } from "./useStaffCommandForm";

function Invitation({ workspace, organizationId, onNext }: {
  workspace: StaffRoleWorkspace; organizationId: string; onNext: () => void;
}) {
  const [state, action, pending] = useStaffCommandForm(staffAuthAction);
  const [rows, setRows] = useState<readonly InvitationRoleRow[]>([]);
  const [noAccess, setNoAccess] = useState(false);
  const [recipientConfirmed, setRecipientConfirmed] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const unknown = state.outcome === "unknown";
  const locked = pending || unknown || state.status === "success";
  const valid = invitationAccessIsValid(rows, noAccess, workspace, organizationId);
  return <form action={action} aria-busy={pending} className="space-y-4 border-t border-border py-4" onChange={(event) => {
    const name = event.target instanceof HTMLInputElement ? event.target.name : "";
    if (name !== "rights_confirmed") setRightsConfirmed(false);
    if (name === "email" || name === "display_name") setRecipientConfirmed(false);
  }}>
    <h3 className="text-md font-semibold">Пригласить сотрудника</h3>
    <p className="text-sm leading-6 text-fg-3">Выберите рабочие права и согласованный email. Сотрудник сам установит пароль по письму.</p>
    <input type="hidden" name="operation" value="invite" />
    <fieldset disabled={locked} className="min-w-0 space-y-4">
      <label className="grid gap-1.5 text-sm">Имя<input className={`${inputCls} min-h-11 w-full`} name="display_name" required maxLength={160} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="grid gap-1.5 text-sm">Рабочий email<input className={`${inputCls} min-h-11 w-full`} name="email" type="email" required maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <StaffInvitationFields rows={rows} noAccess={noAccess} workspace={workspace} organizationId={organizationId} onChange={(nextRows, nextNoAccess) => {
        setRows(nextRows); setNoAccess(nextNoAccess); setRightsConfirmed(false);
      }} />
      <label className="grid gap-1.5 text-sm">Основание подключения<input className={`${inputCls} min-h-11 w-full`} name="reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm leading-6"><input name="recipient_confirmed" type="checkbox" value="yes" required checked={recipientConfirmed}
        onChange={(event) => setRecipientConfirmed(event.target.checked)} className="h-5 w-5 shrink-0" />Адресат согласован, письмо на этот адрес можно отправить</label>
      <label className="flex min-h-11 items-center gap-3 text-sm leading-6"><input name="rights_confirmed" type="checkbox" value="yes" required checked={rightsConfirmed}
        onChange={(event) => setRightsConfirmed(event.target.checked)} className="h-5 w-5 shrink-0" />Проверены и согласованы роли и области доступа{noAccess ? ": пока без рабочих прав" : ""}</label>
    </fieldset>
    <StaffCommandFeedback state={state} />
    {state.status === "success" ? <button type="button" className={`${btnGhostCls} min-h-11`} onClick={onNext}>Пригласить следующего сотрудника</button>
      : <button className={`${btnCls} min-h-11`} type="submit" name="retry_rejected" value={state.retryAllowed ? "yes" : "no"} formNoValidate={unknown}
        disabled={pending || (!unknown && (!valid || !rightsConfirmed || !recipientConfirmed))}>
        {pending ? "Проверяем запрос…" : unknown ? "Проверить тот же запрос" : state.retryAllowed ? "Отправить новое приглашение" : "Отправить приглашение"}
      </button>}
    {unknown ? <p className="text-sm leading-6 text-fg-3">Поля сохранены для проверки исходного запроса. Не создавайте новое приглашение этому адресату. После перезагрузки используйте журнал приглашений.</p> : null}
  </form>;
}

export function StaffInviteForm({ workspace, organizationId }: { workspace: StaffRoleWorkspace; organizationId: string }) {
  const [generation, setGeneration] = useState(0);
  return <Invitation key={generation} workspace={workspace} organizationId={organizationId} onNext={() => setGeneration((value) => value + 1)} />;
}
