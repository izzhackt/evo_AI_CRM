"use client";

import { useState } from "react";

import { KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { RoleArchive, RoleEditor, RolePublication } from "@/components/v3/settings/StaffRolesSection";
import type { StaffEditableRole, StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

export const roleState = (role: StaffEditableRole) => (role.status === "archived" ? "В архиве" : role.bundleId ? "Опубликована" : "Черновик");

/**
 * Роль в панели: состояние и число сотрудников, действующие разрешения и команды роли — «Изменить», «Скопировать», «Опубликовать» (сначала
 * проверка, кому и как изменится доступ) и «Архивировать» / «Восстановить». Формы — прежние (`RoleEditor`, `RolePublication`, `RoleArchive`):
 * те же поля, версии, причины и подтверждения; публиковать нечего, пока набор разрешений черновика совпадает с опубликованным. «Изменить» и
 * «Скопировать» открывают бланк в этой же панели (второй панели нет: после неё фокус вернулся бы на строку за панелями).
 */
export function RoleSheetBody({ role, workspace }: Readonly<{ role: StaffEditableRole; workspace: StaffRoleWorkspace }>) {
  const [editing, setEditing] = useState<"edit" | "copy" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  if (editing) {
    return (
      <div className="grid gap-3">
        <h3 className="t-item text-fg">{editing === "copy" ? "Скопировать роль" : "Изменить роль"}</h3>
        <RoleEditor bare role={editing === "edit" ? role : undefined} sourceRole={editing === "copy" ? role : undefined} permissions={workspace.permissions} onClose={() => setEditing(null)} />
      </div>
    );
  }
  const unpublished = !role.bundleId || [...role.draftPermissionKeys].sort().join("|") !== [...role.permissionKeys].sort().join("|");
  const label = (key: string) => workspace.permissions.find((permission) => permission.key === key)?.label;
  return (
    <div className="grid gap-5" data-testid="v3-staff-role" data-role={role.id}>
      {role.description ? <p className="t-body-compact text-fg-2">{role.description}</p> : null}
      <KeyFacts columns={2} facts={[
        { label: "Состояние", value: <StatusBadge tone={role.status === "archived" ? "neutral" : role.bundleId ? "ok" : "warn"} label={roleState(role)} /> },
        { label: "Сотрудников", value: <span className="tabular-nums">{role.memberCount}</span> },
      ]} />
      <div className="flex flex-wrap gap-2">
        {role.status === "active" ? <Button variant="outline" onClick={() => setEditing("edit")}>Изменить</Button> : null}
        <Button variant="outline" onClick={() => setEditing("copy")}>Скопировать</Button>
        {role.status === "active" && unpublished ? <Button variant="outline" aria-expanded={publishing} onClick={() => setPublishing(!publishing)}>{role.bundleId ? "Опубликовать изменения" : "Опубликовать"}</Button> : null}
      </div>
      {publishing ? <RolePublication key={role.id} role={role} workspace={workspace} /> : null}
      <section className="grid gap-2" aria-label="Действующие разрешения">
        <h3 className="t-item text-fg">Действующие разрешения</h3>
        {role.permissionKeys.length
          ? <ul className="divide-y divide-border t-body-compact">{role.permissionKeys.map((key) => <li key={key} className="py-2">{label(key)}</li>)}</ul>
          : <p className="t-body-compact text-fg-3">Нет опубликованных разрешений.</p>}
      </section>
      <div className="grid gap-3 border-t border-border pt-3">
        <div><Button variant="outline" aria-expanded={archiving} onClick={() => setArchiving(!archiving)}>{role.status === "archived" ? "Восстановить" : "Архивировать"}</Button></div>
        {archiving ? <RoleArchive role={role} workspace={workspace} /> : null}
      </div>
    </div>
  );
}
