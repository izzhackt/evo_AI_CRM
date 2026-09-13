"use client";

import { btnGhostCls, inputCls } from "@/components/ui";
import { ADMISSIONS_DIRECTIONS } from "@/lib/platform-admissions-playbook-contract";
import { DIRECTION_LABELS } from "@/components/v3/profile/admissions-view";
import { staffScopeLabel } from "@/lib/v3/wording";
import { type StaffRoleScope, type StaffRoleWorkspace, type StaffScopeKind } from "@/lib/v3/staff-roles-contract";
import type { StaffInviteAssignmentInput } from "@/lib/v3/staff-workspace-contract";
import { supportedStaffInviteScopes } from "@/lib/v3/staff-invitation-access";

export type InvitationRoleRow = StaffInviteAssignmentInput & { clientId: string };

/** The invitation pins published role versions; it never silently adopts changed rights. */
export function StaffInvitationFields({ rows, noAccess, onChange, workspace, organizationId }: {
  rows: readonly InvitationRoleRow[]; noAccess: boolean;
  onChange: (rows: readonly InvitationRoleRow[], noAccess: boolean) => void;
  workspace: StaffRoleWorkspace; organizationId: string;
}) {
  const roles = workspace.roles.filter((role) => role.status === "active" && role.bundleId && role.permissionKeys.length);
  const scopeFor = (kind: StaffScopeKind): StaffRoleScope => ({ kind, key: kind === "own" ? null : kind === "organization" ? organizationId : "", resourceKind: null });
  const change = (id: string, patch: Partial<InvitationRoleRow>) => onChange(rows.map((row) => row.clientId === id ? { ...row, ...patch } : row), noAccess);
  return <div className="space-y-4">
    <input type="hidden" name="assignments" value={JSON.stringify(noAccess ? [] : rows.map(({ roleId, roleVersion, scope }) => ({ roleId, roleVersion, scope })))} />
    <input type="hidden" name="no_access" value={noAccess ? "yes" : "no"} />
    <label className="flex min-h-11 items-center gap-3 text-sm leading-6">
      <input type="checkbox" checked={noAccess} onChange={(event) => onChange(rows, event.target.checked)} className="h-5 w-5 shrink-0" />
      Создать вход без доступа к рабочим разделам — роли назначим позже
    </label>
    {noAccess ? <p className="text-sm leading-6 text-fg-3">Сотрудник сможет установить пароль. Рабочие разделы появятся только после назначения прав.</p> : <>
      <div className="space-y-5">{rows.map((row, index) => {
        const role = workspace.roles.find((entry) => entry.id === row.roleId);
        const supported = supportedStaffInviteScopes(workspace, row.roleId);
        const current = role?.version === row.roleVersion && role.status === "active" && !!role.bundleId;
        return <fieldset key={row.clientId} className="min-w-0 space-y-3 border-t border-border pt-3">
          <legend className="text-sm font-semibold">Роль {index + 1}</legend>
          <label className="grid gap-1.5 text-sm">Название роли
            <select className={`${inputCls} min-h-11 w-full`} required value={row.roleId} onChange={(event) => {
              const chosen = roles.find((entry) => entry.id === event.target.value);
              change(row.clientId, { roleId: event.target.value, roleVersion: chosen?.version ?? 0,
                scope: scopeFor(supportedStaffInviteScopes(workspace, event.target.value)[0] ?? "own") });
            }}>
              <option value="">Выберите опубликованную роль</option>
              {roles.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              {row.roleId && !roles.some((entry) => entry.id === row.roleId) ? <option value={row.roleId} disabled>{role?.label ?? "Роль недоступна"} — выберите другую</option> : null}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">Область доступа
            <select className={`${inputCls} min-h-11 w-full`} value={row.scope.kind} onChange={(event) => change(row.clientId, { scope: scopeFor(event.target.value as StaffScopeKind) })}>
              {!supported.includes(row.scope.kind) ? <option value={row.scope.kind} disabled>Выберите подходящую область</option> : null}
              {supported.map((kind) => <option key={kind} value={kind}>{staffScopeLabel(kind)}</option>)}
            </select>
          </label>
          {row.scope.kind === "department" ? <label className="grid gap-1.5 text-sm">Отдел
            <select required className={`${inputCls} min-h-11 w-full`} value={row.scope.key ?? ""} onChange={(event) => change(row.clientId, { scope: { ...row.scope, key: event.target.value } })}>
              <option value="">Выберите отдел</option>
              {workspace.departments.filter((department) => department.status === "active").map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              {row.scope.key && !workspace.departments.some((department) => department.id === row.scope.key && department.status === "active") ? <option value={row.scope.key} disabled>Отдел недоступен</option> : null}
            </select>
          </label> : null}
          {row.scope.kind === "direction" ? <label className="grid gap-1.5 text-sm">Направление
            <select required className={`${inputCls} min-h-11 w-full`} value={row.scope.key ?? ""} onChange={(event) => change(row.clientId, { scope: { ...row.scope, key: event.target.value } })}>
              <option value="">Выберите направление</option>
              {ADMISSIONS_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{DIRECTION_LABELS[direction]}</option>)}
            </select>
          </label> : null}
          {row.roleId && !current ? <div className="space-y-2" role="alert">
            <p className="text-sm text-danger">Роль изменилась или недоступна. Проверьте права перед отправкой.</p>
            {role?.status === "active" && role.bundleId ? <button type="button" className={`${btnGhostCls} min-h-11`} onClick={() => change(row.clientId, { roleVersion: role.version })}>Принять текущую версию роли</button> : null}
          </div> : null}
          {role ? <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-3 font-medium">{current ? "Доступные действия" : "Действия в текущей версии роли"} · {role.permissionKeys.length}</summary>
            <ul className="list-disc space-y-1 pl-5 text-fg-2">{role.permissionKeys.map((key) => <li key={key}>{workspace.permissions.find((permission) => permission.key === key)?.label ?? "Описание действия недоступно"}</li>)}</ul>
          </details> : null}
          <button type="button" className={`${btnGhostCls} min-h-11`} onClick={() => onChange(rows.filter((entry) => entry.clientId !== row.clientId), noAccess)}>Убрать роль</button>
        </fieldset>;
      })}</div>
      <button type="button" className={`${btnGhostCls} min-h-11`} disabled={!roles.length || rows.length >= 100}
        onClick={() => onChange([...rows, { clientId: crypto.randomUUID(), roleId: "", roleVersion: 0, scope: scopeFor("own") }], noAccess)}>Добавить роль</button>
      {!roles.length ? <p className="text-sm text-fg-3">Сначала создайте и опубликуйте роль во вкладке «Роли и права».</p> : !rows.length ? <p className="text-sm text-fg-3">Добавьте роль или явно выберите вход без рабочих прав.</p> : null}
    </>}
  </div>;
}
