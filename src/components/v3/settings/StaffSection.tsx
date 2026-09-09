"use client";

import { useActionState, useRef, useState } from "react";
import { staffAuthAction, staffMemberAction } from "@/lib/staff-workspace-actions";
import { STAFF_WORKSPACE_INITIAL_STATE, STAFF_ROLE_LABELS, STAFF_ROLES, staffAuthRejectionMessage,
  type StaffWorkspaceActionState, type StaffWorkspaceData, type StaffWorkspaceMember,
  type StaffRole, type StaffAuthRequest } from "@/lib/v3/staff-workspace-contract";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";

function Feedback({ state }: { state: StaffWorkspaceActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"}
    className={`text-sm leading-6 ${state.status === "error" ? "text-danger" : "text-fg-2"}`}>{state.message}</p> : null;
}

function useStaffForm(action: typeof staffAuthAction) {
  const requestId = useRef<string | null>(null);
  return useActionState(async (previous: StaffWorkspaceActionState, form: FormData) => {
    // Only an explicit submit after a proved rejection starts a fresh attempt.
    // An uncertain result always retains its original request ID.
    if (previous.retryAllowed && form.get("retry_rejected") === "yes") requestId.current = null;
    requestId.current ??= crypto.randomUUID();
    form.set("request_id", requestId.current);
    return action(previous, form);
  }, STAFF_WORKSPACE_INITIAL_STATE);
}

function InviteForm() {
  const [state, action, pending] = useStaffForm(staffAuthAction);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("sales");
  const [confirmed, setConfirmed] = useState(false);
  return <form action={action} aria-busy={pending} className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-5">
    <h3 className="text-md font-semibold">Пригласить сотрудника</h3>
    <p className="text-sm leading-6 text-fg-3">Сотрудник получит письмо для входа в EVO. Роль определяет его доступ к рабочим разделам.</p>
    <input type="hidden" name="operation" value="invite" />
    <fieldset disabled={pending || state.status === "success"} className="space-y-4">
      <label className="block text-sm">Имя<input className={`${inputCls} mt-1 min-h-11 w-full`} name="display_name" required maxLength={160}
        value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
      <label className="block text-sm">Рабочий email<input className={`${inputCls} mt-1 min-h-11 w-full`} name="email" type="email" required maxLength={320}
        value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
      <label className="block text-sm">Роль<select className={`${inputCls} mt-1 min-h-11 w-full`} name="role" value={role}
        onChange={(event) => setRole(event.target.value as StaffRole)}>
        {STAFF_ROLES.map((value) => <option key={value} value={value}>{STAFF_ROLE_LABELS[value]}</option>)}
      </select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm leading-6"><input name="recipient_confirmed" type="checkbox" value="yes" required
        checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-5 w-5 shrink-0" />
        Адресат согласован, письмо на этот адрес можно отправить</label>
      <button className={`${btnCls} min-h-11`} type="submit" name="retry_rejected" value={state.retryAllowed ? "yes" : "no"}>
        {pending ? "Регистрируем приглашение…" : state.retryAllowed ? "Отправить новое приглашение" : "Отправить приглашение"}</button>
    </fieldset>
    <Feedback state={state} />
  </form>;
}

function MemberChange({ member, operation }: { member: StaffWorkspaceMember; operation: "role" | "status" }) {
  const [state, action, pending] = useStaffForm(staffMemberAction);
  const [role, setRole] = useState(member.role);
  const [reason, setReason] = useState("");
  const value = operation === "role" ? role : member.status === "active" ? "suspended" : "active";
  return <form action={action} aria-busy={pending} className="space-y-3 border-t border-border pt-4">
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="membership_id" value={member.membershipId} />
    <input type="hidden" name="expected_version" value={member.version} />
    <fieldset disabled={pending || state.status === "success"} className="space-y-3">
      {operation === "role" ? <label className="block text-sm">Новая роль<select className={`${inputCls} mt-1 min-h-11 w-full`} name="value"
        value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
        {STAFF_ROLES.map((entry) => <option key={entry} value={entry}>{STAFF_ROLE_LABELS[entry]}</option>)}
      </select></label> : <input type="hidden" name="value" value={value} />}
      <label className="block text-sm">Причина изменения<input className={`${inputCls} mt-1 min-h-11 w-full`} name="reason" required maxLength={500}
        value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button className={`${btnGhostCls} min-h-11`} type="submit" disabled={operation === "role" && value === member.role}>
        {pending ? "Сохраняем…" : operation === "role" ? "Изменить роль" : value === "active" ? "Восстановить доступ" : "Заблокировать доступ"}
      </button>
    </fieldset>
    <Feedback state={state} />
  </form>;
}

function RecoveryForm({ member }: { member: StaffWorkspaceMember }) {
  const [state, action, pending] = useStaffForm(staffAuthAction);
  return <form action={action} aria-busy={pending} className="space-y-3 border-t border-border pt-4">
    <input type="hidden" name="operation" value="recovery" />
    <input type="hidden" name="membership_id" value={member.membershipId} />
    <fieldset disabled={pending || state.status === "success"} className="space-y-3">
      <label className="flex min-h-11 items-center gap-3 text-sm leading-6"><input type="checkbox" required name="recipient_confirmed" value="yes" className="h-5 w-5 shrink-0" />
        Сотрудник согласовал письмо для восстановления входа на свой email</label>
      <button type="submit" className={`${btnGhostCls} min-h-11`} name="retry_rejected" value={state.retryAllowed ? "yes" : "no"}>
        {pending ? "Регистрируем запрос…" : state.retryAllowed ? "Отправить новый запрос восстановления" : "Отправить восстановление входа"}</button>
    </fieldset><Feedback state={state} />
  </form>;
}

function RequestRow({ request }: { request: StaffAuthRequest }) {
  const [state, action, pending] = useActionState(staffAuthAction, STAFF_WORKSPACE_INITIAL_STATE);
  return <li className="space-y-2 border-b border-border py-4 last:border-0">
    <p className="break-words text-sm font-medium">{request.displayName} · {request.operation === "invite" ? "Приглашение" : "Восстановление входа"}</p>
    <p className="text-sm text-fg-3">{request.status === "completed" ? "Зарегистрировано в сервисе входа; доставка письма не подтверждена"
      : request.status === "rejected" ? `${staffAuthRejectionMessage(request.rejectionCode)} Изменений в Auth не обнаружено. После устранения причины используйте новое приглашение или форму восстановления сотрудника.`
      : "Требуется проверка результата; повторная отправка заблокирована"}</p>
    <p className="text-xs text-fg-3">{new Date(request.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Dubai" })} (Dubai)</p>
    {request.status !== "completed" && request.status !== "rejected" ? <form action={action}>
      <input type="hidden" name="operation" value="reconcile" /><input type="hidden" name="request_id" value={request.requestId} />
      <button className={`${btnGhostCls} min-h-11`} disabled={pending}>{pending ? "Проверяем…" : "Проверить без повторного письма"}</button>
    </form> : null}<Feedback state={state} />
  </li>;
}

export function StaffSection({ data }: { data: StaffWorkspaceData }) {
  const [inviteKey, setInviteKey] = useState(0);
  if (!data.available) return <p role="alert" className="rounded-card border border-border bg-surface p-5 text-sm leading-6">
    Список сотрудников недоступен. Проверьте подключение, сеанс администратора и применение миграции рабочего пространства.</p>;
  return <div className="space-y-5">
    <InviteForm key={inviteKey} />
    <button type="button" className={`${btnGhostCls} min-h-11`} onClick={() => setInviteKey((key) => key + 1)}>Новое приглашение</button>
    <section className="space-y-3" aria-label="Сотрудники">
      <h3 className="text-md font-semibold">Сотрудники · {data.members.length}</h3>
      {!data.members.length ? <p className="text-sm text-fg-3">Сотрудников пока нет.</p> : data.members.map((member) =>
        <article key={`${member.membershipId}:${member.version}`} className="rounded-card border border-border bg-surface p-4 sm:p-5">
          <h4 className="break-words font-semibold">{member.displayName}</h4>
          <p className="mt-1 text-sm text-fg-3">{STAFF_ROLE_LABELS[member.role]} · {member.status === "active" ? "Членство активно" : "Членство заблокировано"}</p>
          <details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Управление доступом</summary>
            <div className="space-y-4"><MemberChange member={member} operation="role" /><MemberChange member={member} operation="status" />
              {member.status === "active" ? <RecoveryForm member={member} /> : null}</div>
          </details>
        </article>)}
    </section>
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5" aria-label="Журнал приглашений">
      <h3 className="text-md font-semibold">Последние запросы входа</h3>
      <p className="mt-2 text-sm leading-6 text-fg-3">Проверка сверяет результат с сервисом входа. Она не отправляет новое письмо. Если результат не подтверждается, администратору нужно проверить настройки Auth и почты.</p>
      {data.requests.length ? <ul>{data.requests.map((request) => <RequestRow key={request.requestId} request={request} />)}</ul>
        : <p className="mt-3 text-sm text-fg-3">Приглашений и запросов восстановления пока нет.</p>}
    </section>
  </div>;
}
