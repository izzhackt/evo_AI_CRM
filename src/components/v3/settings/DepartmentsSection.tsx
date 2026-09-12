"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { btnCls, btnDangerGhostCls, btnGhostCls, inputCls } from "@/components/ui";
import { staffDepartmentAction } from "@/lib/staff-workspace-actions";
import type { StaffDepartment } from "@/lib/v3/staff-workspace-contract";
import { StaffMetadataFeedback, useStaffMetadataForm } from "./StaffMemberDetails";

function DepartmentForm({ department, operation, onClose, onArchived, onLockedChange, anotherRequestPending = false }: {
  department?: StaffDepartment;
  operation: "create" | "update" | "archive" | "restore";
  onClose: () => void;
  onArchived?: () => void;
  onLockedChange: (locked: boolean) => void;
  anotherRequestPending?: boolean;
}) {
  const [initial] = useState(department);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [reason, setReason] = useState("");
  const [state, action, pending] = useStaffMetadataForm(async (previous, form) => {
    const result = await staffDepartmentAction(previous, form);
    if (result.status === "success" && operation === "archive") onArchived?.();
    return result;
  });
  const firstField = useRef<HTMLInputElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const editsDetails = operation === "create" || operation === "update";
  const saved = state.status === "success";
  const unknown = state.metadataOutcome === "unknown";
  useEffect(() => { (firstField.current ?? reasonField.current)?.focus(); }, []);
  useEffect(() => {
    onLockedChange(pending || unknown);
    return () => onLockedChange(false);
  }, [pending, unknown, onLockedChange]);
  const actionLabel = operation === "create" ? "Создать отдел" : operation === "update" ? "Сохранить отдел"
    : operation === "archive" ? "Перенести в архив" : "Восстановить отдел";
  return <form action={action} aria-label={`${actionLabel}${initial ? `: ${initial.name}` : ""}`} aria-busy={pending} className="space-y-4 border-t border-border pt-4">
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="department_id" value={initial?.id ?? ""} />
    <input type="hidden" name="expected_version" value={initial?.version ?? 0} />
    <fieldset disabled={pending || saved || unknown || anotherRequestPending} className="space-y-4">
      {editsDetails ? <>
        <label className="grid gap-1.5 text-sm">Название отдела
          <input ref={firstField} className={inputCls} name="name" required maxLength={120}
            value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm">Описание
          <textarea className={`${inputCls} h-auto py-2`} name="description" rows={3} maxLength={500}
            value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </> : <>
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />
        <p className="text-sm leading-6 text-fg-2">{operation === "archive"
          ? "Сотрудники сохранят связь с отделом. Новые назначения станут недоступны, пока отдел находится в архиве."
          : "Отдел снова станет доступен для назначения сотрудникам."}</p>
      </>}
      <label className="grid gap-1.5 text-sm">Причина изменения
        <textarea ref={reasonField} className={`${inputCls} h-auto py-2`} name="reason" rows={2} required maxLength={500}
          value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
    </fieldset>
    <StaffMetadataFeedback state={state} />
    {unknown ? <p className="text-sm leading-6 text-fg-3">Сначала проверьте результат исходного запроса. До этого изменения и закрытие формы заблокированы.</p> : null}
    {anotherRequestPending && !unknown ? <p className="text-sm leading-6 text-fg-3">Сначала дождитесь результата или проверьте незавершённый запрос другого отдела.</p> : null}
    <div className="flex flex-wrap gap-2">
      {!saved ? <button className={operation === "archive" ? btnDangerGhostCls : btnCls} disabled={pending || (anotherRequestPending && !unknown)} type="submit">
        {pending ? unknown ? "Проверяем…" : "Сохраняем…" : unknown ? "Проверить сохранение" : actionLabel}
      </button> : null}
      <button type="button" className={btnGhostCls} disabled={pending || unknown} onClick={onClose}>{saved ? "Готово" : "Отмена"}</button>
    </div>
  </form>;
}

function DepartmentRow({ department, onArchived, onLockedChange }: {
  department: StaffDepartment; onArchived: () => void; onLockedChange: (id: string, locked: boolean) => void;
}) {
  const [operation, setOperation] = useState<"update" | "archive" | "restore" | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const statusButton = useRef<HTMLButtonElement>(null);
  const reportLocked = useCallback((locked: boolean) => onLockedChange(department.id, locked), [department.id, onLockedChange]);
  function closeEditor() {
    const returnTarget = operation === "update" ? editButton : statusButton;
    setOperation(null);
    requestAnimationFrame(() => (returnTarget.current ?? statusButton.current)?.focus());
  }
  return <li className="min-w-0 space-y-4 py-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <h4 className="break-words font-semibold">{department.name}</h4>
        <p className="text-sm text-fg-3">{department.status === "archived" ? "В архиве" : "Действующий отдел"} · Сотрудников: {department.memberCount}</p>
        {department.description ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{department.description}</p> : null}
      </div>
      {!operation ? <div className="flex flex-wrap gap-2">
        {department.status === "active" ? <button ref={editButton} type="button" className={btnGhostCls} onClick={() => setOperation("update")}>Редактировать</button> : null}
        <button ref={statusButton} type="button" className={btnGhostCls} onClick={() => setOperation(department.status === "active" ? "archive" : "restore")}>
          {department.status === "active" ? "В архив" : "Восстановить"}
        </button>
      </div> : null}
    </div>
    {operation ? <DepartmentForm department={department} operation={operation} onClose={closeEditor}
      onArchived={onArchived} onLockedChange={reportLocked} /> : null}
  </li>;
}

export function DepartmentsSection({ departments }: { departments: readonly StaffDepartment[] }) {
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [lockedForms, setLockedForms] = useState<readonly string[]>([]);
  const reportLocked = useCallback((id: string, locked: boolean) => {
    setLockedForms((current) => locked === current.includes(id) ? current
      : locked ? [...current, id] : current.filter((value) => value !== id));
  }, []);
  const reportCreatorLocked = useCallback((locked: boolean) => reportLocked("create", locked), [reportLocked]);
  const addButton = useRef<HTMLButtonElement>(null);
  const archivedCount = departments.filter((department) => department.status === "archived").length;
  const visible = departments.filter((department) => showArchived || department.status === "active" || lockedForms.includes(department.id));
  function closeCreator() {
    setCreating(false);
    requestAnimationFrame(() => addButton.current?.focus());
  }
  return <section className="min-w-0 space-y-4" aria-label="Отделы">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <h3 className="text-md font-semibold">Отделы · {departments.length}</h3>
        <p className="text-sm leading-6 text-fg-3">Структура команды и распределение сотрудников.</p>
      </div>
      {!creating ? <button ref={addButton} type="button" className={btnCls} disabled={lockedForms.length > 0} onClick={() => setCreating(true)}>Добавить отдел</button> : null}
    </div>
    {creating ? <DepartmentForm operation="create" onClose={closeCreator} onLockedChange={reportCreatorLocked}
      anotherRequestPending={lockedForms.some((id) => id !== "create")} /> : null}
    {archivedCount ? <label className="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" className="size-5 accent-accent" checked={showArchived} disabled={lockedForms.length > 0}
        onChange={(event) => setShowArchived(event.target.checked)} />
      Показать архивные · {archivedCount}
    </label> : null}
    {!visible.length ? <p className="border-t border-border py-6 text-sm leading-6 text-fg-3">
      {departments.length ? "Все отделы в архиве. Включите их отображение или добавьте действующий отдел." : "Отделов пока нет. Добавьте первый, чтобы назначить его сотрудникам."}
    </p> : <ul className="divide-y divide-border border-t border-border">{visible.map((department) =>
      <DepartmentRow key={department.id} department={department} onArchived={() => setShowArchived(true)} onLockedChange={reportLocked} />)}</ul>}
  </section>;
}
