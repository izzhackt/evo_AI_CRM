"use client";

import { PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GuardedBody, useSheetGuard } from "@/components/v3/admin-next/SheetGuard";
import { DepartmentForm } from "@/components/v3/settings/DepartmentsSection";
import type { StaffDepartment } from "@/lib/v3/staff-workspace-contract";

import { DepartmentSheetBody } from "./DepartmentSheetBody";

const columns: DataTableColumn<StaffDepartment>[] = [
  {
    id: "name", accessorFn: (department) => `${department.name} ${department.description ?? ""}`, header: "Отдел", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.name}</span>
        {row.original.description ? <span className="block max-w-prose truncate t-meta text-fg-3">{row.original.description}</span> : null}
      </span>
    ),
  },
  { id: "members", accessorFn: (department) => department.memberCount, header: "Сотрудников", meta: { align: "end" }, cell: ({ row }) => <span className="tabular-nums">{row.original.memberCount}</span> },
  { id: "state", accessorFn: (department) => department.status, header: "Состояние", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "ok" : "neutral"} label={row.original.status === "active" ? "Действует" : "В архиве"} /> },
];

/**
 * «Отделы»: таблица (название и описание, сотрудников, состояние) с «Показать архивные», «Добавить отдел» и отдел в панели. Архивация и
 * правка — прежний бланк с причиной и версией. Незавершённый запрос или запрос с неизвестным итогом держит панель открытой (закрывать
 * нельзя, пока результат не проверен); на другой отдел переходят только после результата. Несохранённую правку Esc и щелчок мимо не
 * выбрасывают молча: панель спрашивает (`useSheetGuard`).
 */
export function DepartmentsNext({ departments }: Readonly<{ departments: readonly StaffDepartment[] }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [locked, setLocked] = useState(false);
  const onLockedChange = useCallback((value: boolean) => setLocked(value), []);
  const guard = useSheetGuard();
  const archivedCount = departments.filter((department) => department.status === "archived").length;
  const visible = useMemo(() => departments.filter((department) => showArchived || department.status === "active" || department.id === openId), [departments, showArchived, openId]);
  const open = departments.find((department) => department.id === openId) ?? null;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-departments">
      <div className="flex flex-wrap items-center justify-end gap-2"><Button onClick={() => setCreating(true)}><PlusIcon aria-hidden="true" />Добавить отдел</Button></div>
      <DataTable
        label="Список отделов"
        data={visible}
        columns={columns}
        getRowId={(department) => department.id}
        getRowLabel={(department) => department.name}
        onRowClick={(department) => setOpenId(department.id)}
        searchPlaceholder="Найти отдел"
        columnMenu={false}
        pageSize={25}
        toolbar={archivedCount ? (
          <label className="flex min-h-11 items-center gap-2 t-label text-fg-2">
            <Checkbox checked={showArchived} onCheckedChange={(value) => setShowArchived(value === true)} />Показать архивные · {archivedCount}
          </label>
        ) : undefined}
        empty={<EmptyState title={departments.length ? "Все отделы в архиве. Включите их отображение или добавьте действующий." : "Отделов пока нет. Добавьте первый, чтобы назначить его сотрудникам."} />}
      />
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next && guard.allowClose(locked)) setOpenId(null); }} title={open?.name ?? "Отдел"}>
        <GuardedBody guard={guard}>
          {open ? <DepartmentSheetBody key={open.id} department={open} onArchived={() => setShowArchived(true)} onLockedChange={onLockedChange} /> : null}
        </GuardedBody>
      </DetailSheet>
      <DetailSheet open={creating} onOpenChange={(next) => { if (!next && guard.allowClose(locked)) setCreating(false); }} title="Добавить отдел">
        <GuardedBody guard={guard}>
          {creating ? <DepartmentForm operation="create" onClose={() => setCreating(false)} onLockedChange={onLockedChange} /> : null}
        </GuardedBody>
      </DetailSheet>
    </div>
  );
}
