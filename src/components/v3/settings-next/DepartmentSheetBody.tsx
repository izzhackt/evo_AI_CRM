"use client";

import { useState } from "react";

import { KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DepartmentForm } from "@/components/v3/settings/DepartmentsSection";
import type { StaffDepartment } from "@/lib/v3/staff-workspace-contract";

type Operation = "update" | "archive" | "restore";

/**
 * Отдел в панели: название, описание, число сотрудников и состояние; «Редактировать» (действующему), «В архив» и «Восстановить» открывают
 * прежний бланк (`DepartmentForm`) с причиной и версией. Пока запрос не завершён или его результат неизвестен (`locked`), панель не
 * закрывается — как не закрывался бланк.
 */
export function DepartmentSheetBody({ department, onArchived, onLockedChange }: Readonly<{
  department: StaffDepartment;
  onArchived: () => void;
  onLockedChange: (locked: boolean) => void;
}>) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const active = department.status === "active";
  return (
    <div className="grid gap-5" data-testid="v3-department" data-department={department.id}>
      {department.description ? <p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{department.description}</p> : null}
      <KeyFacts columns={2} facts={[
        { label: "Состояние", value: <StatusBadge tone={active ? "ok" : "neutral"} label={active ? "Действует" : "В архиве"} /> },
        { label: "Сотрудников", value: <span className="tabular-nums">{department.memberCount}</span> },
      ]} />
      {operation ? (
        <DepartmentForm department={department} operation={operation} onClose={() => setOperation(null)} onArchived={onArchived} onLockedChange={onLockedChange} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {active ? <Button variant="outline" onClick={() => setOperation("update")}>Редактировать</Button> : null}
          <Button variant="outline" onClick={() => setOperation(active ? "archive" : "restore")}>{active ? "В архив" : "Восстановить"}</Button>
        </div>
      )}
    </div>
  );
}
