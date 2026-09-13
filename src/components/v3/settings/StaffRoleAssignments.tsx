"use client";

import { useState, type ReactNode } from "react";
import { btnGhostCls, inputCls } from "@/components/ui";
import { ADMISSIONS_DIRECTIONS } from "@/lib/platform-admissions-playbook-contract";
import { DIRECTION_LABELS } from "@/components/v3/profile/admissions-view";
import { staffScopeLabel } from "@/lib/v3/wording";
import { STAFF_SCOPE_KINDS, type StaffRoleAssignmentInput, type StaffRoleExpectedBinding, type StaffRoleMember, type StaffRolesActionState, type StaffRoleWorkspace, type StaffScopeKind } from "@/lib/v3/staff-roles-contract";
import { StaffRoleCommandForm } from "./StaffRoleForms";

type Row = StaffRoleAssignmentInput & { clientId: string };
type EditorMode = "assignments" | "admin";
type MemberEditorProps = { member: StaffRoleMember; workspace: StaffRoleWorkspace; organizationId: string };

export function StaffRoleAssignments({ member, workspace, organizationId }: MemberEditorProps) {
  // Incoming revalidation must not discard a pending/unknown command or silently
  // change the roles reviewed in the open editor. Only the next-action buttons
  // create a new editor, after a matching receipt and fresh member readback.
  const [editor, setEditor] = useState(() => ({ member, workspace, mode: "assignments" as EditorMode, sequence: 0 }));
  const canContinue = (state: StaffRolesActionState) => state.status === "success" && state.outcome !== "unknown"
    && state.membershipId === editor.member.membershipId && member.membershipId === editor.member.membershipId
    && typeof state.accessVersion === "number" && state.accessVersion === editor.member.accessVersion + 1
    && member.accessVersion >= state.accessVersion;
  const next = (state: StaffRolesActionState, mode: EditorMode) => {
    if (canContinue(state)) setEditor((current) => ({ member, workspace, mode, sequence: current.sequence + 1 }));
  };
  return <StaffMemberAccessEditor key={editor.sequence} member={editor.member} workspace={editor.workspace} organizationId={organizationId}
    mode={editor.mode} onComplete={(state) => <div className="space-y-3">
      {!canContinue(state) ? <p role="status" className="text-sm leading-6 text-fg-2">Ожидаем актуальные данные сотрудника. Следующее изменение будет доступно после подтверждения версии.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhostCls} disabled={!canContinue(state)} onClick={() => next(state, "assignments")}>Изменить назначения</button>
        <button type="button" className={btnGhostCls} disabled={!canContinue(state)} onClick={() => next(state, "admin")}>Изменить доступ Admin</button>
      </div>
    </div>} />;
}

function StaffMemberAccessEditor({ member: initial, workspace, organizationId, mode: initialMode, onComplete }: MemberEditorProps & {
  mode: EditorMode; onComplete: (state: StaffRolesActionState) => ReactNode;
}) {
  const [mode, setMode] = useState(initialMode);
  const [rows, setRows] = useState<readonly Row[]>(() => initial.assignments.map(({ id, roleId, scope }) => ({ clientId: id, roleId, scope })));
  const roles = workspace.roles.filter((role) => role.status === "active" && role.bundleId);
  const bindings: StaffRoleExpectedBinding[] = [...new Set(rows.map((row) => row.roleId))].flatMap((roleId) => {
    const role = roles.find((candidate) => candidate.id === roleId);
    return role?.bundleId && role.bundleVersion ? [{ roleId, roleVersion: role.version, bundleId: role.bundleId, bundleVersion: role.bundleVersion }] : [];
  });
  const change = (clientId: string, patch: Partial<Row>) => setRows((current) => current.map((row) => row.clientId === clientId ? { ...row, ...patch } : row));
  const initialScope = (kind: StaffScopeKind) => ({ kind, key: kind === "own" ? null : kind === "organization" ? organizationId : "", resourceKind: null });
  return <div className="space-y-5">
    {initial.systemRole === "admin" ? <p className="text-sm leading-6 text-fg-2">У администратора широкий системный доступ. Чувствительные действия требуют отдельных личных разрешений; личные тесты студентов остаются закрытыми.</p> : null}
    <StaffRoleCommandForm label={`${mode === "assignments" ? "Назначения" : "Доступ администратора"}: ${initial.displayName}`}
      submitLabel={mode === "assignments" ? "Сохранить назначения" : initial.systemRole === "admin" ? "Снять доступ Admin" : "Назначить администратором"}
      onComplete={onComplete}>
      {(locked) => <>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Изменить доступ сотрудника">
          <button type="button" className={btnGhostCls} disabled={locked} aria-pressed={mode === "assignments"} onClick={() => setMode("assignments")}>Назначения ролей</button>
          <button type="button" className={btnGhostCls} disabled={locked} aria-pressed={mode === "admin"} onClick={() => setMode("admin")}>Системный доступ администратора</button>
        </div>
        <input type="hidden" name="operation" value={mode} />
        <input type="hidden" name="membership_id" value={initial.membershipId} />
        <input type="hidden" name="expected_version" value={initial.accessVersion} />
        {mode === "assignments" ? <>
        <input type="hidden" name="assignments" value={JSON.stringify(rows.map(({ roleId, scope }) => ({ roleId, scope })))} />
        <input type="hidden" name="expected_role_bindings" value={JSON.stringify(bindings)} />
        <div className="space-y-5">{rows.map((row, index) => {
          const role = workspace.roles.find((role) => role.id === row.roleId);
          const permissions = role?.permissionKeys.map((key) => workspace.permissions.find((permission) => permission.key === key));
          const supported = STAFF_SCOPE_KINDS.filter((kind) => kind !== "record" && permissions?.length && permissions.every((permission) => permission?.allowedScopes.includes(kind)));
          return <fieldset key={row.clientId} className="min-w-0 space-y-3 border-t border-border pt-3">
            <legend className="text-sm font-semibold">Назначение {index + 1}</legend>
            <label className="grid gap-1.5 text-sm">Роль
              <select className={inputCls} value={row.roleId} required onChange={(event) => change(row.clientId, { roleId: event.target.value, scope: initialScope("own") })}>
                <option value="">Выберите роль</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
                {row.roleId && !roles.some((role) => role.id === row.roleId) ? <option value={row.roleId} disabled>{role?.label ?? "Роль недоступна"} · замените назначение</option> : null}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">Область доступа
              <select className={inputCls} value={row.scope.kind} onChange={(event) => change(row.clientId, { scope: initialScope(event.target.value as StaffScopeKind) })}>
                {!supported.includes(row.scope.kind) ? <option value={row.scope.kind} disabled>{staffScopeLabel(row.scope.kind)}{row.scope.kind !== "record" ? " · не подходит роли" : " · сохранённое назначение"}</option> : null}
                {supported.map((kind) => <option key={kind} value={kind}>{staffScopeLabel(kind)}</option>)}
              </select>
            </label>
            {row.scope.kind === "department" ? <label className="grid gap-1.5 text-sm">Отдел
              <select className={inputCls} required value={row.scope.key ?? ""} onChange={(event) => change(row.clientId, { scope: { ...row.scope, key: event.target.value } })}>
                <option value="">Выберите отдел</option>{workspace.departments.filter((department) => department.status === "active").map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                {row.scope.key && !workspace.departments.some((department) => department.id === row.scope.key && department.status === "active") ? <option value={row.scope.key} disabled>Отдел недоступен — выберите другой</option> : null}
              </select>
            </label> : null}
            {row.scope.kind === "direction" ? <label className="grid gap-1.5 text-sm">Направление
              <select className={inputCls} required value={row.scope.key ?? ""} onChange={(event) => change(row.clientId, { scope: { ...row.scope, key: event.target.value } })}>
                <option value="">Выберите направление</option>{ADMISSIONS_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{DIRECTION_LABELS[direction]}</option>)}
              </select>
            </label> : null}
            {row.scope.kind === "record" ? <p className="text-sm text-fg-3">Доступ к ранее назначенной отдельной записи сохраняется. Для другой области выберите её выше.</p> : null}
            <button type="button" className={btnGhostCls} disabled={locked} onClick={() => setRows((current) => current.filter((entry) => entry.clientId !== row.clientId))}>Убрать назначение</button>
          </fieldset>;
        })}</div>
        {!rows.length ? <p className="text-sm leading-6 text-fg-3">Без назначений рабочие разделы недоступны сотруднику без системного Admin. Пустой список не снимает доступ Admin — он изменяется отдельно.</p> : null}
        <button type="button" className={btnGhostCls} disabled={locked || rows.length >= 100 || !roles.length}
          onClick={() => setRows((current) => [...current, { clientId: crypto.randomUUID(), roleId: "", scope: initialScope("own") }])}>Добавить роль</button>
        {!roles.length ? <p className="text-sm text-fg-3">Сначала создайте и опубликуйте роль.</p> : null}
        <label className="grid gap-1.5 text-sm">Причина изменения<input className={inputCls} name="reason" required maxLength={500} /></label>
        </> : <>
          <p className="text-sm leading-6 text-fg-3">Широкий системный доступ к работе сотрудников не заменяет личные разрешения чувствительных действий и не открывает личные тесты студентов. Последнего активного администратора нельзя отключить.</p>
          <input type="hidden" name="enabled" value={initial.systemRole === "admin" ? "false" : "true"} />
          <label className="grid gap-1.5 text-sm">Причина<input className={inputCls} name="reason" required maxLength={500} /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirm_admin" value="yes" required />Я подтверждаю изменение доступа администратора</label>
        </>}
      </>}
    </StaffRoleCommandForm>
  </div>;
}
