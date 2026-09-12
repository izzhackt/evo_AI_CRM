"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { DIRECTION_LABELS } from "@/components/v3/profile/admissions-view";
import { ADMISSIONS_DIRECTIONS, type AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import { staffOrganizationalDetailsAction } from "@/lib/staff-workspace-actions";
import { STAFF_ROLE_LABELS, STAFF_WORKSPACE_INITIAL_STATE, type StaffDepartment,
  type StaffWorkspaceActionState, type StaffWorkspaceMember } from "@/lib/v3/staff-workspace-contract";

type StaffMutationAction = (previous: StaffWorkspaceActionState, form: FormData) => Promise<StaffWorkspaceActionState>;

/** Unknown outcomes must resolve the original command, including fields disabled in the UI. */
export function useStaffMetadataForm(action: StaffMutationAction) {
  const request = useRef<{ payload: string; entries: [string, FormDataEntryValue][]; id: string } | null>(null);
  return useActionState(async (previous: StaffWorkspaceActionState, form: FormData) => {
    if (previous.metadataOutcome !== "unknown") {
      const entries = [...form.entries()].filter(([key]) => !key.startsWith("$ACTION_") && key !== "request_id");
      const payload = JSON.stringify(entries);
      if (request.current?.payload !== payload) request.current = { payload, entries, id: crypto.randomUUID() };
    }
    if (!request.current) return {
      status: "error", metadataOutcome: "unknown",
      message: "Исходный запрос недоступен. Администратору нужно проверить результат сохранения; новый запрос не отправлен.",
    } satisfies StaffWorkspaceActionState;
    const original = new FormData();
    for (const [key, value] of request.current.entries) original.append(key, value);
    original.set("request_id", request.current.id);
    try {
      return await action(previous, original);
    } catch {
      return { status: "error", metadataOutcome: "unknown", message: "Не удалось подтвердить сохранение. Нажмите «Проверить сохранение»: повторится исходный запрос, без создания новой команды." } satisfies StaffWorkspaceActionState;
    }
  }, STAFF_WORKSPACE_INITIAL_STATE);
}

export function StaffMetadataFeedback({ state }: { state: StaffWorkspaceActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"}
    className={`text-sm leading-6 ${state.status === "error" ? "text-danger" : "text-fg-2"}`}>{state.message}</p> : null;
}

function OrganizationalDetailsForm({ member, departments, onClose }: {
  member: StaffWorkspaceMember; departments: readonly StaffDepartment[]; onClose: () => void;
}) {
  // Keep a dirty editor bound to its original version across background RSC updates.
  const [initial] = useState(member.metadata);
  const [jobTitle, setJobTitle] = useState(initial.jobTitle ?? "");
  const [departmentId, setDepartmentId] = useState(initial.departmentId ?? "");
  const [directions, setDirections] = useState<readonly AdmissionsDirection[]>(initial.directions);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useStaffMetadataForm(staffOrganizationalDetailsAction);
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus(); }, []);
  const selectedDepartment = departments.find((department) => department.id === departmentId);
  const archivedNewSelection = selectedDepartment?.status === "archived" && departmentId !== initial.departmentId;
  const saved = state.status === "success";
  const unknown = state.metadataOutcome === "unknown";

  return <form action={action} aria-label={`Рабочие сведения: ${member.displayName}`} aria-busy={pending} className="space-y-4">
    <input type="hidden" name="membership_id" value={member.membershipId} />
    <input type="hidden" name="expected_version" value={initial.version} />
    <fieldset disabled={pending || saved || unknown} className="space-y-4">
      <label className="grid gap-1.5 text-sm">Должность
        <input ref={firstField} className={inputCls} name="job_title" maxLength={160} value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)} autoComplete="organization-title" />
      </label>
      <label className="grid gap-1.5 text-sm">Отдел
        <select className={inputCls} name="department_id" value={departmentId} aria-invalid={archivedNewSelection || undefined}
          onChange={(event) => setDepartmentId(event.target.value)}>
          <option value="">Без отдела</option>
          {departments.filter((department) => department.status === "active" || department.id === initial.departmentId || department.id === departmentId)
            .map((department) => <option key={department.id} value={department.id}>
              {department.name}{department.status === "archived" ? " · в архиве" : ""}
            </option>)}
        </select>
      </label>
      {selectedDepartment?.status === "archived" ? <p role={archivedNewSelection ? "alert" : undefined} className="text-sm leading-6 text-fg-3">
        {archivedNewSelection ? "Выбранный отдел перенесён в архив. Выберите действующий отдел или вариант «Без отдела»."
          : "Отдел в архиве. Можно сохранить текущую связь или выбрать действующий отдел."}
      </p> : null}
      {!departments.some((department) => department.status === "active") ? <p className="text-sm leading-6 text-fg-3">
        Добавить отдел можно на вкладке «Отделы».
      </p> : null}
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">Направления работы</legend>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {ADMISSIONS_DIRECTIONS.map((direction) => <label key={direction} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="direction_codes" value={direction} className="size-5 shrink-0 accent-accent"
              checked={directions.includes(direction)} onChange={(event) => setDirections((current) => event.target.checked
                ? [...current, direction] : current.filter((value) => value !== direction))} />
            {DIRECTION_LABELS[direction]}
          </label>)}
        </div>
      </fieldset>
      <label className="grid gap-1.5 text-sm">Причина изменения
        <textarea className={`${inputCls} h-auto py-2`} name="reason" rows={2} required maxLength={500}
          value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
    </fieldset>
    <StaffMetadataFeedback state={state} />
    {unknown ? <p className="text-sm leading-6 text-fg-3">Сначала проверьте результат исходного запроса. До этого сведения и закрытие формы заблокированы.</p> : null}
    <div className="flex flex-wrap gap-2">
      {!saved ? <button className={btnCls} disabled={pending || (!unknown && archivedNewSelection)} type="submit">
        {pending ? unknown ? "Проверяем…" : "Сохраняем…" : unknown ? "Проверить сохранение" : "Сохранить сведения"}
      </button> : null}
      <button type="button" className={btnGhostCls} disabled={pending || unknown} onClick={onClose}>{saved ? "Готово" : "Отмена"}</button>
    </div>
  </form>;
}

export function StaffMemberDetails({ member, departments, children }: {
  member: StaffWorkspaceMember; departments: readonly StaffDepartment[]; children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const department = departments.find((entry) => entry.id === member.metadata.departmentId);
  function closeEditor() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  return <article aria-label={`Сотрудник: ${member.displayName}`} className="min-w-0 space-y-5">
    <Link href="/v3/settings?section=staff&view=people" className={`${btnGhostCls} @4xl:hidden`}>К сотрудникам</Link>
    <header className="space-y-2 border-b border-border pb-4">
      <h3 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold">{member.displayName}</h3>
      <p className="text-sm leading-6 text-fg-2">{STAFF_ROLE_LABELS[member.role]} · {member.status === "active" ? "Доступ активен" : "Доступ заблокирован"}</p>
    </header>
    <section className="space-y-4" aria-label="Рабочие сведения">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-md font-semibold">Рабочие сведения</h4>
        {!editing ? <button ref={editButton} type="button" className={btnGhostCls} onClick={() => setEditing(true)}>Редактировать</button> : null}
      </div>
      <p className="text-sm leading-6 text-fg-3">Должность, отдел и направления помогают распределять работу. Права задаются в разделе «Доступ».</p>
      {editing ? <OrganizationalDetailsForm member={member} departments={departments} onClose={closeEditor} />
        : <dl className="grid gap-4 text-sm">
          <div><dt className="text-fg-3">Должность</dt><dd className="mt-1 break-words leading-6">{member.metadata.jobTitle || "Не указана"}</dd></div>
          <div><dt className="text-fg-3">Отдел</dt><dd className="mt-1 break-words leading-6">{department
            ? `${department.name}${department.status === "archived" ? " · в архиве" : ""}` : "Не назначен"}</dd></div>
          <div><dt className="text-fg-3">Направления работы</dt><dd className="mt-1 leading-6">{member.metadata.directions.length
            ? member.metadata.directions.map((direction) => DIRECTION_LABELS[direction]).join(", ") : "Не указаны"}</dd></div>
        </dl>}
    </section>
    {children}
  </article>;
}
