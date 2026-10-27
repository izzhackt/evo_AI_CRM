"use client";

import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GuardedBody, useSheetGuard } from "@/components/v3/admin-next/SheetGuard";
import { RoleEditor } from "@/components/v3/settings/StaffRolesSection";
import { StaffRoleControls } from "@/components/v3/settings/StaffRoleControls";
import type { StaffEditableRole, StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

import { RolePreview } from "./RolePreview";
import { RoleSheetBody, roleState } from "./RoleSheetBody";

const ROLES_HREF = "/v3/settings?section=staff&view=roles";
const roleHref = (id: string | null) => (id ? `${ROLES_HREF}&role=${encodeURIComponent(id)}` : ROLES_HREF);

const columns: DataTableColumn<StaffEditableRole>[] = [
  {
    id: "role", accessorFn: (role) => `${role.label} ${role.description ?? ""}`, header: "Роль", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.label}</span>
        {row.original.description ? <span className="block max-w-prose truncate t-meta text-fg-3">{row.original.description}</span> : null}
      </span>
    ),
  },
  { id: "state", accessorFn: (role) => roleState(role), header: "Состояние", cell: ({ row }) => <StatusBadge tone={row.original.status === "archived" ? "neutral" : row.original.bundleId ? "ok" : "warn"} label={roleState(row.original)} /> },
  { id: "members", accessorFn: (role) => role.memberCount, header: "Сотрудников", meta: { align: "end" }, cell: ({ row }) => <span className="tabular-nums">{row.original.memberCount}</span> },
];

/**
 * «Роли и доступ»: таблица ролей (название и описание, состояние, число сотрудников) с «Показать архивные», роль открывается в панели,
 * «Создать роль» — единственное красное действие страницы и открывает бланк в панели. Роль задаёт действия; область — свои записи, отдел или
 * направление — выбирается при назначении сотруднику (это за «?» шапки таблицы). Адрес `?role=` обновляется на месте, как у «Сотрудников»;
 * страница, что пришла с другим `?role=` (мягкий переход по «Открыть роль»), открывает ту роль. Копия роли открывается в той же панели, а
 * панели не закрываются, пока запрос в пути или его итог неизвестен, и спрашивают, если в форме есть несохранённое.
 */
export function RolesNext({ workspace, selectedRoleId }: Readonly<{ workspace: StaffRoleWorkspace; selectedRoleId?: string }>) {
  const [openId, setOpenId] = useState<string | null>(selectedRoleId ?? null);
  const [synced, setSynced] = useState(selectedRoleId);
  if (synced !== selectedRoleId) { setSynced(selectedRoleId); setOpenId(selectedRoleId ?? null); }
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const guard = useSheetGuard();
  const visible = useMemo(() => workspace.roles.filter((role) => archived || role.status === "active"), [workspace.roles, archived]);
  const open = workspace.roles.find((role) => role.id === openId) ?? null;
  const choose = (id: string | null) => { setOpenId(id); window.history.replaceState(window.history.state, "", roleHref(id)); };
  return (
    <StaffRoleControls>
      <div className="grid min-w-0 gap-4" data-testid="v3-settings-roles">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <RolePreview />
          <Button onClick={() => setCreating(true)}><PlusIcon aria-hidden="true" />Создать роль</Button>
        </div>
        {selectedRoleId && openId === selectedRoleId && !open ? <p role="alert" className="t-body-compact text-danger">Роль не найдена или больше недоступна. <Button variant="link" onClick={() => choose(null)}>К списку ролей</Button></p> : null}
        <DataTable
          label="Список ролей"
          data={visible}
          columns={columns}
          getRowId={(role) => role.id}
          getRowLabel={(role) => role.label}
          onRowClick={(role) => choose(role.id)}
          searchPlaceholder="Найти роль"
          columnMenu={false}
          pageSize={25}
          toolbar={<label className="flex min-h-11 items-center gap-2 t-label text-fg-2"><Checkbox checked={archived} onCheckedChange={(value) => setArchived(value === true)} />Показать архивные</label>}
          empty={<EmptyState title="Ролей не найдено. Создайте новую." />}
        />
        <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next && guard.allowClose()) choose(null); }} title={open?.label ?? "Роль"}
          help="Роль задаёт действия. Область — свои записи, отдел или направление — выбирается при назначении сотруднику.">
          <GuardedBody guard={guard}>{open ? <RoleSheetBody key={open.id} role={open} workspace={workspace} /> : null}</GuardedBody>
        </DetailSheet>
        <DetailSheet open={creating} onOpenChange={(next) => { if (!next && guard.allowClose()) setCreating(false); }} title="Новая роль">
          <GuardedBody guard={guard}>{creating ? <RoleEditor bare permissions={workspace.permissions} onClose={() => setCreating(false)} /> : null}</GuardedBody>
        </DetailSheet>
      </div>
    </StaffRoleControls>
  );
}
