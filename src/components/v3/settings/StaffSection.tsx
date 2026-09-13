"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { staffAuthAction, staffMemberAction } from "@/lib/staff-workspace-actions";
import { STAFF_WORKSPACE_INITIAL_STATE, staffAuthRejectionMessage,
  type StaffWorkspaceData, type StaffWorkspaceMember,
  type StaffAuthRequest } from "@/lib/v3/staff-workspace-contract";
import { btnGhostCls, inputCls } from "@/components/ui";
import { StaffDirectoryList } from "./StaffDirectoryList";
import { StaffMemberDetails } from "./StaffMemberDetails";
import { DepartmentsSection } from "./DepartmentsSection";
import { StaffRolesSection } from "./StaffRolesSection";
import { StaffRoleAssignments } from "./StaffRoleAssignments";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import { StaffInviteForm } from "./StaffInviteForm";
import { StaffPendingAccess } from "./StaffPendingAccess";
import { useStaffCommandForm, StaffCommandFeedback as Feedback } from "./useStaffCommandForm";
import { staffReconcileAllowsPreparation } from "@/lib/v3/staff-invitation-access";

function MemberChange({ member }: { member: StaffWorkspaceMember }) {
  const [command, setCommand] = useState(0);
  return <MemberChangeForm key={command} member={member} onNext={() => setCommand((value) => value + 1)} />;
}

function MemberChangeForm({ member, onNext }: { member: StaffWorkspaceMember; onNext: () => void }) {
  const [state, action, pending] = useStaffCommandForm(staffMemberAction);
  const [reason, setReason] = useState("");
  const value = member.status === "active" ? "suspended" : "active";
  if (state.status === "success" && state.outcome !== "unknown") return <div className="space-y-3 border-t border-border pt-4">
    <Feedback state={state} />
    <button type="button" className={`${btnGhostCls} min-h-11`} onClick={onNext}>Изменить доступ снова</button>
  </div>;
  return <form action={action} aria-busy={pending} className="space-y-3 border-t border-border pt-4">
    <input type="hidden" name="operation" value="status" />
    <input type="hidden" name="membership_id" value={member.membershipId} />
    <input type="hidden" name="expected_version" value={member.version} />
    <fieldset disabled={pending || state.status === "success" || state.outcome === "unknown"} className="space-y-3">
      <input type="hidden" name="value" value={value} />
      <label className="block text-sm">Причина изменения<input className={`${inputCls} mt-1 min-h-11 w-full`} name="reason" required maxLength={500}
        value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    </fieldset>
    <button className={`${btnGhostCls} min-h-11`} type="submit" disabled={pending || state.status === "success"} formNoValidate={state.outcome === "unknown"}>
      {pending ? "Сохраняем…" : state.outcome === "unknown" ? "Проверить сохранение" : value === "active" ? "Восстановить доступ" : "Заблокировать доступ"}
    </button>
    <Feedback state={state} />
  </form>;
}

function RecoveryForm({ member }: { member: StaffWorkspaceMember }) {
  const [state, action, pending] = useStaffCommandForm(staffAuthAction);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return <form action={action} aria-busy={pending} className="space-y-3 border-t border-border pt-4">
    <input type="hidden" name="operation" value="recovery" />
    <input type="hidden" name="membership_id" value={member.membershipId} />
    <input type="hidden" name="expected_version" value={member.version} />
    <fieldset disabled={pending || state.status === "success" || state.outcome === "unknown"} className="space-y-3">
      <label className="grid gap-1.5 text-sm">Причина восстановления<input className={`${inputCls} min-h-11 w-full`} name="reason" required minLength={3} maxLength={500}
        value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm leading-6"><input type="checkbox" required name="recipient_confirmed" value="yes" className="h-5 w-5 shrink-0"
        checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Сотрудник согласовал письмо для восстановления входа на свой email</label>
    </fieldset>
    <button type="submit" className={`${btnGhostCls} min-h-11`} name="retry_rejected" value={state.retryAllowed ? "yes" : "no"}
      disabled={pending || state.status === "success"} formNoValidate={state.outcome === "unknown"}>
      {pending ? "Проверяем запрос…" : state.outcome === "unknown" ? "Проверить тот же запрос" : state.retryAllowed ? "Отправить новый запрос восстановления" : "Отправить восстановление входа"}</button>
    <Feedback state={state} />
  </form>;
}

function RequestRow({ request, workspace, organizationId }: { request: StaffAuthRequest; workspace: StaffRoleWorkspace; organizationId: string }) {
  const activeOperation = useRef<"prepare" | "reconcile" | null>(null);
  const [operation, setOperation] = useState<"prepare" | "reconcile" | null>(null);
  const claim = useCallback((next: "prepare" | "reconcile") => {
    if (activeOperation.current !== null && activeOperation.current !== next) return false;
    activeOperation.current = next;
    setOperation(next);
    return true;
  }, []);
  const release = useCallback((previous: "prepare" | "reconcile") => {
    if (activeOperation.current !== previous) return;
    activeOperation.current = null;
    setOperation(null);
  }, []);
  const onPrepareStart = useCallback(() => claim("prepare"), [claim]);
  const onPrepareFinish = useCallback(() => release("prepare"), [release]);
  const [state, action, pending] = useActionState(async (previous: typeof STAFF_WORKSPACE_INITIAL_STATE, form: FormData) => {
    if (!claim("reconcile")) return previous;
    try {
      const result = await staffAuthAction(previous, form);
      if (staffReconcileAllowsPreparation(result)) release("reconcile");
      return result;
    } catch {
      return { status: "error" as const, outcome: "unknown" as const, requestId: request.requestId,
        message: "Ответ не получен. Проверьте этот запрос ещё раз; повторное письмо не отправляется." };
    }
  }, STAFF_WORKSPACE_INITIAL_STATE);
  return <li className="space-y-2 border-b border-border py-4 last:border-0">
    <p className="break-words text-sm font-medium">{request.displayName} · {request.operation === "invite" ? "Приглашение" : "Восстановление входа"}</p>
    <p className="text-sm text-fg-3">{request.status === "completed" ? "Зарегистрировано в сервисе входа; доставка письма не подтверждена"
      : request.status === "rejected" ? `${staffAuthRejectionMessage(request.rejectionCode)} Изменений в Auth не обнаружено. Проверьте причину отказа перед новым запросом.`
      : "Требуется проверка результата; повторная отправка заблокирована"}</p>
    <p className="text-xs text-fg-3">{new Date(request.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Dubai" })} (Dubai)</p>
    {request.status !== "completed" && request.status !== "rejected" ? <form action={action}>
      <input type="hidden" name="operation" value="reconcile" /><input type="hidden" name="request_id" value={request.requestId} />
      <button className={`${btnGhostCls} min-h-11`} disabled={pending || operation === "prepare"}>{pending ? "Проверяем…" : "Проверить без повторного письма"}</button>
    </form> : null}<Feedback state={state} />
    {request.operation === "invite" && request.status !== "completed" && request.status !== "rejected"
      ? <StaffPendingAccess requestId={request.requestId} workspace={workspace} organizationId={organizationId}
        reconcileLocked={operation === "reconcile"} onPrepareStart={onPrepareStart} onPrepareFinish={onPrepareFinish} /> : null}
  </li>;
}

export function StaffSection({ data, roles, organizationId, view, selectedMemberId, selectedRoleId }: {
  data: StaffWorkspaceData; roles: StaffRoleWorkspace; organizationId: string;
  view: "people" | "departments" | "roles"; selectedMemberId?: string; selectedRoleId?: string;
}) {
  const selectedMember = data.members.find((member) => member.membershipId === selectedMemberId);
  const selectedAccess = roles.members.find((member) => member.membershipId === selectedMemberId);
  if (!data.available) return <p role="alert" className="rounded-card border border-border bg-surface p-5 text-sm leading-6">
    Список сотрудников недоступен. Проверьте подключение, сеанс администратора и применение миграции рабочего пространства.</p>;
  return <div className="space-y-5">
    <nav aria-label="Управление командой" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {([{ key: "people", label: "Сотрудники" }, { key: "roles", label: "Роли и права" }, { key: "departments", label: "Отделы" }] as const).map((entry) =>
        <Link key={entry.key} href={`/v3/settings?section=staff&view=${entry.key}`} aria-current={view === entry.key ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-nav px-4 text-sm font-semibold ${view === entry.key
            ? "bg-accent-weak text-accent" : "text-fg-2 hover:bg-surface-2"}`}>{entry.label}</Link>)}
    </nav>
    {view === "roles" ? <StaffRolesSection workspace={roles} selectedRoleId={selectedRoleId} /> : view === "departments" ? <DepartmentsSection departments={data.departments} /> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-md font-semibold">Сотрудники · {data.members.length}</h3>
        <details className="w-full">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-accent">Пригласить сотрудника</summary>
          <div className="pt-3"><StaffInviteForm workspace={roles} organizationId={organizationId} /></div>
        </details>
      </div>
      <div className="grid min-w-0 gap-6 @4xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
        <div className={selectedMemberId ? "hidden min-w-0 @4xl:block" : "min-w-0"}>
          <StaffDirectoryList members={data.members} accessMembers={roles.members} departments={data.departments} selectedMemberId={selectedMemberId} />
        </div>
        <div className={`${selectedMemberId ? "block" : "hidden @4xl:block"} min-w-0 @4xl:border-l @4xl:border-border @4xl:pl-6`}>
          {selectedMember ? <StaffMemberDetails key={selectedMember.membershipId} member={selectedMember} access={selectedAccess} departments={data.departments}>
            <details className="border-t border-border pt-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Доступ</summary>
              <div className="space-y-4 pt-2">
                {selectedAccess ? <StaffRoleAssignments member={selectedAccess} workspace={roles} organizationId={organizationId} />
                  : <p role="alert" className="text-sm text-danger">Права сотрудника недоступны. Обновите страницу.</p>}
                <MemberChange member={selectedMember} />
                {selectedMember.status === "active" ? <RecoveryForm member={selectedMember} /> : null}</div>
            </details>
          </StaffMemberDetails> : <div className="space-y-3 py-5">
            <p role={selectedMemberId ? "alert" : undefined} className="text-sm leading-6 text-fg-3">{selectedMemberId
              ? "Сотрудник не найден или больше недоступен." : "Выберите сотрудника, чтобы посмотреть рабочие сведения и управление доступом."}</p>
            {selectedMemberId ? <Link href="/v3/settings?section=staff&view=people" className={btnGhostCls}>К сотрудникам</Link> : null}
          </div>}
        </div>
      </div>
    </>}
    <details className="border-t border-border pt-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Журнал приглашений · {data.requests.length}</summary>
      <p className="mt-2 text-sm leading-6 text-fg-3">Проверка сверяет результат с сервисом входа. Она не отправляет новое письмо. Если результат не подтверждается, администратору нужно проверить настройки Auth и почты.</p>
      {data.requests.length ? <ul>{data.requests.map((request) => <RequestRow key={request.requestId} request={request} workspace={roles} organizationId={organizationId} />)}</ul>
        : <p className="mt-3 text-sm text-fg-3">Приглашений и запросов восстановления пока нет.</p>}
    </details>
  </div>;
}
