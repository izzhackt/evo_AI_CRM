"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { staffRolesAction } from "@/lib/staff-roles-actions";
import { selectStaffRolePreviewAction } from "@/lib/staff-auth-actions";
import { roleTitle } from "@/lib/v3/wording";
import {
  STAFF_ROLES_INITIAL_STATE, type StaffEditableRole, type StaffRolePermission, type StaffRoleWorkspace,
} from "@/lib/v3/staff-roles-contract";
import { StaffRoleCommandForm, StaffRoleFeedback } from "./StaffRoleForms";
import { StaffRoleControls } from "./StaffRoleControls";

function roleHref(id: string) { return `/v3/settings?section=staff&view=roles&role=${encodeURIComponent(id)}`; }

function PermissionFields({ permissions, selected, onChange }: {
  permissions: readonly StaffRolePermission[]; selected: readonly string[]; onChange: (keys: readonly string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const needle = search.toLocaleLowerCase("ru").trim();
  const groups = [...new Set(permissions.filter((permission) => !permission.systemOnly).map((permission) => permission.group))];
  return <div className="space-y-3">
    <label htmlFor={searchId} className="block text-sm font-medium">Найти разрешение</label>
    <input id={searchId} className={inputCls} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Например, документы" />
    {selected.map((key) => <input key={key} type="hidden" name="permission_keys" value={key} />)}
    <p className="text-sm text-fg-3" role="status">Выбрано разрешений: {selected.length}</p>
    {groups.map((group) => {
      const rows = permissions.filter((permission) => !permission.systemOnly && permission.group === group
        && (!needle || `${permission.label} ${group}`.toLocaleLowerCase("ru").includes(needle)));
      return rows.length ? <fieldset key={group} className="border-t border-border pt-3">
        <legend className="px-1 text-sm font-semibold">{group}</legend>
        {rows.map((permission) => <label key={permission.key} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={selected.includes(permission.key)}
            onChange={(event) => onChange(event.target.checked ? [...selected, permission.key] : selected.filter((key) => key !== permission.key))} />
          <span>{permission.label}{permission.sensitive ? <span className="block text-fg-3">Чувствительные данные: назначайте только по необходимости.</span> : null}</span>
        </label>)}
      </fieldset> : null;
    })}
    {needle && !permissions.some((permission) => !permission.systemOnly && `${permission.label} ${permission.group}`.toLocaleLowerCase("ru").includes(needle))
      ? <p className="text-sm text-fg-3">Разрешений не найдено. Измените поиск.</p> : null}
  </div>;
}

function RoleEditor({ role, sourceRole, permissions, onClose }: {
  role?: StaffEditableRole; sourceRole?: StaffEditableRole; permissions: readonly StaffRolePermission[]; onClose: () => void;
}) {
  const [initial] = useState(() => ({ id: role?.id ?? crypto.randomUUID(), version: role?.version ?? 0 }));
  const [label, setLabel] = useState(role?.label ?? (sourceRole ? `${sourceRole.label} — копия` : ""));
  const [description, setDescription] = useState(role?.description ?? sourceRole?.description ?? "");
  const [selected, setSelected] = useState<readonly string[]>(role?.draftPermissionKeys ?? sourceRole?.draftPermissionKeys ?? []);
  const operation = role ? "save" : sourceRole ? "copy" : "create";
  return <div className="min-w-0 space-y-4">
    <h3 className="t-section">{role ? "Изменить роль" : sourceRole ? "Скопировать роль" : "Новая роль"}</h3>
    <StaffRoleCommandForm label="Редактор роли" submitLabel="Сохранить черновик" onComplete={(state) => <div className="flex flex-wrap gap-3">
      <button type="button" className={btnGhostCls} onClick={onClose}>Закрыть редактор</button>
      {state.roleId ? <Link href={roleHref(state.roleId)} className={btnCls} onClick={onClose}>Открыть роль</Link> : null}
    </div>}>
      {(locked) => <>
        <input type="hidden" name="operation" value={operation} />
        <input type="hidden" name="role_id" value={initial.id} />
        <input type="hidden" name="expected_version" value={initial.version} />
        {sourceRole ? <input type="hidden" name="source_role_id" value={sourceRole.id} /> : null}
        <label className="grid gap-1.5 text-sm">Название роли
          <input autoFocus className={inputCls} name="label" required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm">Для какой работы
          <textarea className={inputCls} name="description" rows={2} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <PermissionFields permissions={permissions} selected={selected} onChange={setSelected} />
        <label className="grid gap-1.5 text-sm">Причина изменения
          <input className={inputCls} name="reason" required maxLength={500} />
        </label>
        {!locked ? <button type="button" className={btnGhostCls} onClick={onClose}>Отмена</button> : null}
      </>}
    </StaffRoleCommandForm>
  </div>;
}

function RolePublication({ role, workspace }: { role: StaffEditableRole; workspace: StaffRoleWorkspace }) {
  const [initial] = useState(role);
  const [state, action, pending] = useActionState(staffRolesAction, STAFF_ROLES_INITIAL_STATE);
  const permissionLabel = (key: string) => workspace.permissions.find((permission) => permission.key === key)?.label;
  const impact = state.impact;
  return <div className="space-y-4 border-t border-border pt-4">
    {!impact ? <form action={action} aria-label="Проверить публикацию роли" className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="operation" value="impact" />
      <input type="hidden" name="role_id" value={initial.id} />
      <input type="hidden" name="expected_version" value={initial.version} />
      <p className="text-sm text-fg-2">Перед публикацией проверьте, кому и как изменится доступ.</p>
      <StaffRoleFeedback state={state} />
      <button type="submit" className={btnCls} disabled={pending}>{pending ? "Проверяем…" : "Проверить и опубликовать"}</button>
    </form> : <>
      <h4 className="t-item">Изменение доступа</h4>
      <div className="space-y-2 text-sm leading-6">
        <p>Затронуто сотрудников: {impact.affectedMembershipIds.length}</p>
        {impact.affectedMembershipIds.length ? <ul className="list-disc space-y-1 pl-5">{impact.affectedMembershipIds.map((id) =>
          <li key={id}>{workspace.members.find((member) => member.membershipId === id)?.displayName ?? "Сотрудник больше недоступен — обновите данные"}</li>)}</ul> : null}
        {impact.addedPermissionKeys.length ? <p>Добавятся: {impact.addedPermissionKeys.map(permissionLabel).filter(Boolean).join(", ")}.</p> : null}
        {impact.removedPermissionKeys.length ? <p>Будут отозваны: {impact.removedPermissionKeys.map(permissionLabel).filter(Boolean).join(", ")}.</p> : null}
        {!impact.addedPermissionKeys.length && !impact.removedPermissionKeys.length ? <p>Состав разрешений не меняется.</p> : null}
      </div>
      <StaffRoleCommandForm label="Опубликовать роль" submitLabel="Применить изменения">
        {(_locked, publication) => <>
          <input type="hidden" name="operation" value="publish" />
          <input type="hidden" name="role_id" value={impact.roleId} />
          <input type="hidden" name="expected_version" value={impact.version} />
          <input type="hidden" name="expected_impact_fingerprint" value={impact.impactFingerprint} />
          <label className="grid gap-1.5 text-sm">Причина публикации<input className={inputCls} name="reason" required maxLength={500} /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirm_impact" value="yes" required />Я проверил изменение доступа</label>
          {publication.status === "error" && publication.outcome !== "unknown" ? <button
            type="button" className={btnGhostCls} onClick={() => window.location.reload()}
          >Обновить данные и проверить изменение заново</button> : null}
        </>}
      </StaffRoleCommandForm>
    </>}
  </div>;
}

function RoleArchiveReview({ role, workspace, onRestart }: {
  role: StaffEditableRole; workspace: StaffRoleWorkspace; onRestart: () => void;
}) {
  const [initial] = useState(role);
  const [replacement, setReplacement] = useState("");
  const [state, action, pending] = useActionState(staffRolesAction, STAFF_ROLES_INITIAL_STATE);
  const impact = state.archiveImpact;
  const detailsAvailable = !impact || (impact.affectedMembershipIds.every((id) => workspace.members.some((member) => member.membershipId === id))
    && [...impact.addedPermissionKeys, ...impact.removedPermissionKeys].every((key) => workspace.permissions.some((permission) => permission.key === key))
    && (!impact.replacementRoleId || workspace.roles.some((other) => other.id === impact.replacementRoleId)));
  const permissionLabel = (key: string) => workspace.permissions.find((permission) => permission.key === key)?.label
    ?? "Разрешение больше недоступно — обновите данные";
  return <div className="space-y-4">
    {!impact ? <form action={action} aria-label="Проверить архивирование" aria-busy={pending} className="space-y-4">
      <input type="hidden" name="operation" value="archive-impact" />
      <input type="hidden" name="role_id" value={initial.id} />
      <input type="hidden" name="expected_version" value={initial.version} />
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <p className="text-sm leading-6 text-fg-2">Выберите, что сделать с назначениями этой роли. До подтверждения ничего не изменится; история сохранится.</p>
        <label className="grid gap-1.5 text-sm">Заменить роль на
          <select className={inputCls} name="replacement_role_id" value={replacement} onChange={(event) => setReplacement(event.target.value)}>
            <option value="">Без замены</option>
            {workspace.roles.filter((other) => other.id !== initial.id && other.status === "active" && other.bundleId)
              .map((other) => <option key={other.id} value={other.id}>{other.label}</option>)}
          </select>
        </label>
        {!replacement ? <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="revoke_assignments" value="yes" />Отозвать назначения этой роли без замены
        </label> : null}
      </fieldset>
      <StaffRoleFeedback state={state} />
      <button type="submit" className={btnCls} disabled={pending}>{pending ? "Проверяем…" : "Проверить архивирование"}</button>
    </form> : <>
      <h4 className="t-item">Изменение доступа при архивировании</h4>
      <div className="space-y-2 text-sm leading-6">
        <p>Затронуто сотрудников: {impact.affectedMembershipIds.length}</p>
        {impact.affectedMembershipIds.length ? <ul className="list-disc space-y-1 pl-5">
          {impact.affectedMembershipIds.map((id) => <li key={id}>{workspace.members.find((member) => member.membershipId === id)?.displayName
            ?? "Сотрудник больше недоступен — обновите данные"}</li>)}
        </ul> : null}
        <p>{impact.replacementRoleId ? `Замена: ${workspace.roles.find((other) => other.id === impact.replacementRoleId)?.label
          ?? "Роль больше недоступна — обновите данные"}. Области назначений сохранятся.`
          : "Назначения этой роли будут сняты без замены."}</p>
        <p className="text-fg-3">Ниже — разрешения этой роли и её замены. Другие роли сотрудников сохраняются и могут давать те же разрешения.</p>
        {impact.addedPermissionKeys.length ? <p>Добавятся через замену: {impact.addedPermissionKeys.map(permissionLabel).join(", ")}.</p> : null}
        {impact.removedPermissionKeys.length ? <p>Перестанут предоставляться этой ролью: {impact.removedPermissionKeys.map(permissionLabel).join(", ")}.</p> : null}
        {!impact.addedPermissionKeys.length && !impact.removedPermissionKeys.length ? <p>Состав разрешений не меняется.</p> : null}
      </div>
      {!detailsAvailable ? <div className="space-y-3">
        <p role="alert" className="text-sm leading-6 text-danger">Список сотрудников или разрешений изменился. Обновите данные перед подтверждением.</p>
        <button type="button" className={btnGhostCls} onClick={() => window.location.reload()}>Обновить данные</button>
      </div> : <StaffRoleCommandForm label="Архивировать роль" submitLabel="Перенести в архив">
        {(locked, archival) => <>
          <input type="hidden" name="operation" value="archive" />
          <input type="hidden" name="role_id" value={impact.roleId} />
          <input type="hidden" name="expected_version" value={impact.version} />
          <input type="hidden" name="expected_impact_fingerprint" value={impact.impactFingerprint} />
          <input type="hidden" name="replacement_role_id" value={impact.replacementRoleId ?? ""} />
          {impact.revokeAssignments ? <input type="hidden" name="revoke_assignments" value="yes" /> : null}
          <label className="grid gap-1.5 text-sm">Причина<input className={inputCls} name="reason" required maxLength={500} /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="confirm_impact" value="yes" required />Я проверил изменение доступа</label>
          {!locked ? <button type="button" className={btnGhostCls} onClick={onRestart}>Изменить выбор</button> : null}
          {archival.status === "error" && archival.outcome !== "unknown" ? <button type="button" className={btnGhostCls}
            onClick={() => window.location.reload()}>Обновить данные и проверить изменение заново</button> : null}
        </>}
      </StaffRoleCommandForm>}
    </>}
  </div>;
}

function RoleArchive({ role, workspace }: { role: StaffEditableRole; workspace: StaffRoleWorkspace }) {
  const [review, setReview] = useState(0);
  const [initial] = useState(role);
  if (initial.status === "active") return <RoleArchiveReview key={review} role={initial} workspace={workspace}
    onRestart={() => setReview((current) => current + 1)} />;
  return <StaffRoleCommandForm label="Восстановить роль" submitLabel="Восстановить роль">
    {() => <>
      <input type="hidden" name="operation" value="restore" />
      <input type="hidden" name="role_id" value={initial.id} />
      <input type="hidden" name="expected_version" value={initial.version} />
      <label className="grid gap-1.5 text-sm">Причина<input className={inputCls} name="reason" required maxLength={500} /></label>
    </>}
  </StaffRoleCommandForm>;
}

function RoleDetails({ role, workspace, onCopy }: { role: StaffEditableRole; workspace: StaffRoleWorkspace; onCopy: () => void }) {
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  if (editing) return <RoleEditor role={role} permissions={workspace.permissions} onClose={() => setEditing(false)} />;
  return <div className="space-y-5">
    <Link className={`${btnGhostCls} @4xl:hidden`} href="/v3/settings?section=staff&view=roles">К списку ролей</Link>
    <div className="space-y-2"><h3 className="t-record-title break-words">{role.label}</h3>
      {role.description ? <p className="text-sm leading-6 text-fg-2">{role.description}</p> : null}
      <p className="text-sm text-fg-3">{role.status === "archived" ? "В архиве" : role.bundleId ? "Опубликована" : "Черновик"} · сотрудников: {role.memberCount}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {role.status === "active" ? <button type="button" className={btnCls} onClick={() => setEditing(true)}>Изменить</button> : null}
      <button type="button" className={btnGhostCls} onClick={onCopy}>Скопировать</button>
      {role.status === "active" ? <button type="button" className={btnGhostCls} aria-expanded={publishing} onClick={() => setPublishing(!publishing)}>Публикация</button> : null}
    </div>
    {publishing ? <RolePublication key={role.id} role={role} workspace={workspace} /> : null}
    <section className="space-y-2"><h4 className="t-item">Действующие разрешения</h4>
      {role.permissionKeys.length ? <ul className="divide-y divide-border text-sm leading-6">{role.permissionKeys.map((key) =>
        <li key={key} className="py-2">{workspace.permissions.find((permission) => permission.key === key)?.label}</li>)}</ul>
        : <p className="text-sm text-fg-3">Нет опубликованных разрешений.</p>}
    </section>
    <div className="border-t border-border pt-3">
      <button type="button" className={btnGhostCls} aria-expanded={archiving} onClick={() => setArchiving(!archiving)}>{role.status === "archived" ? "Восстановить" : "Архивировать"}</button>
      {archiving ? <div className="pt-3"><RoleArchive role={role} workspace={workspace} /></div> : null}
    </div>
  </div>;
}

export function StaffRolesSection({ workspace, selectedRoleId }: { workspace: StaffRoleWorkspace; selectedRoleId?: string }) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [newRole, setNewRole] = useState<"new" | StaffEditableRole | null>(null);
  const selected = workspace.roles.find((role) => role.id === selectedRoleId);
  const visible = workspace.roles.filter((role) => (archived || role.status === "active") && `${role.label} ${role.description}`.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru").trim()));
  if (newRole) return <RoleEditor sourceRole={newRole === "new" ? undefined : newRole} permissions={workspace.permissions} onClose={() => setNewRole(null)} />;
  return <StaffRoleControls>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="t-section">Роли и доступ</h3><button type="button" className={btnCls} onClick={() => setNewRole("new")}>Создать роль</button></div>
    <p className="text-sm leading-6 text-fg-3">Роль задаёт действия. Область — свои записи, отдел или направление — выбирается при назначении сотруднику.</p>
    <details className="border-b border-border pb-3" data-testid="staff-role-preview">
      <summary className="min-h-11 cursor-pointer content-center rounded-nav px-2 py-2 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
        Посмотреть интерфейс роли
      </summary>
      <p className="mt-2 text-sm leading-6 text-fg-3">Меняется только вид интерфейса. Вы остаётесь Администратором — это не вход за сотрудника.</p>
      <form action={selectStaffRolePreviewAction} className="mt-3 flex flex-wrap gap-2" data-testid="admin-role-preview">
        {(["sales", "admissions"] as const).map((role) => <button key={role} type="submit" name="role" value={role}
          data-testid={`preview-role-${role}`} className={`${btnGhostCls} min-h-11`}>{roleTitle(role)}</button>)}
      </form>
    </details>
    <div className="grid min-w-0 gap-6 @4xl:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]">
      <section aria-label="Список ролей" className={`${selectedRoleId ? "hidden @4xl:block" : "block"} min-w-0 space-y-3`}>
        <label className="grid gap-1.5 text-sm">Найти роль<input type="search" className={inputCls} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Показать архивные</label>
        <ul className="divide-y divide-border">{visible.map((role) => <li key={role.id}><Link href={roleHref(role.id)} aria-current={role.id === selectedRoleId ? "page" : undefined}
          className={`block min-h-11 rounded-nav px-3 py-3 text-sm transition-colors motion-reduce:transition-none ${role.id === selectedRoleId ? "bg-accent-weak text-accent" : "hover:bg-surface-2"}`}>
          <span className="block font-medium break-words">{role.label}</span><span className="mt-1 block text-fg-3">Сотрудников: {role.memberCount}{role.status === "archived" ? " · в архиве" : !role.bundleId ? " · черновик" : ""}</span>
        </Link></li>)}</ul>
        {!visible.length ? <p className="text-sm leading-6 text-fg-3">Ролей не найдено. Измените поиск или создайте новую.</p> : null}
      </section>
      <section aria-label="Выбранная роль" className={`${selectedRoleId ? "block" : "hidden @4xl:block"} min-w-0 @4xl:border-l @4xl:border-border @4xl:pl-6`}>
        {selected ? <RoleDetails key={selected.id} role={selected} workspace={workspace} onCopy={() => setNewRole(selected)} /> : <div className="space-y-3 py-5">
          <p className="text-sm text-fg-3" role={selectedRoleId ? "alert" : undefined}>{selectedRoleId ? "Роль не найдена или больше недоступна." : "Выберите роль, чтобы посмотреть и изменить разрешения."}</p>
          {selectedRoleId ? <Link className={btnGhostCls} href="/v3/settings?section=staff&view=roles">К списку ролей</Link> : null}
        </div>}
      </section>
    </div>
  </StaffRoleControls>;
}
