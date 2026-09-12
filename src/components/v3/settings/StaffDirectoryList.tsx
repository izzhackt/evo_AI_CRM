"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { inputCls } from "@/components/ui";
import { STAFF_ROLE_LABELS, type StaffDepartment, type StaffWorkspaceMember } from "@/lib/v3/staff-workspace-contract";

export function StaffDirectoryList({ members, departments, selectedMemberId }: {
  members: readonly StaffWorkspaceMember[];
  departments: readonly StaffDepartment[];
  selectedMemberId?: string;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
  const needle = search.trim().toLocaleLowerCase("ru");
  const visible = members.filter((member) => {
    const matchesDepartment = !departmentId || (departmentId === "unassigned"
      ? member.metadata.departmentId === null : member.metadata.departmentId === departmentId);
    const searchable = [member.displayName, member.metadata.jobTitle, departmentNames.get(member.metadata.departmentId ?? "")]
      .filter(Boolean).join(" ").toLocaleLowerCase("ru");
    return matchesDepartment && (!status || member.status === status) && (!needle || searchable.includes(needle));
  });

  return <section aria-label="Список сотрудников" className="min-w-0">
    <div className="space-y-3 border-b border-border pb-4">
      <label htmlFor={searchId} className="block text-sm font-medium">Найти сотрудника</label>
      <input id={searchId} type="search" className={inputCls} placeholder="Имя или должность"
        value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 @4xl:grid-cols-1">
        <label className="grid min-w-0 gap-1.5 text-sm">Отдел
          <select className={inputCls} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">Все отделы</option>
            <option value="unassigned">Без отдела</option>
            {departments.map((department) => <option key={department.id} value={department.id}>
              {department.name}{department.status === "archived" ? " · в архиве" : ""}
            </option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm">Доступ
          <select className={inputCls} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Все сотрудники</option>
            <option value="active">Активен</option>
            <option value="suspended">Заблокирован</option>
          </select>
        </label>
      </div>
      <p role="status" className="text-sm text-fg-3">Показано {visible.length} из {members.length}</p>
    </div>
    {!visible.length ? <p className="py-6 text-sm leading-6 text-fg-3">
      {members.length ? "Сотрудники не найдены. Измените поиск или фильтры." : "Подключённых сотрудников пока нет."}
    </p> : <ul className="divide-y divide-border">
      {visible.map((member) => {
        const selected = member.membershipId === selectedMemberId;
        const department = departmentNames.get(member.metadata.departmentId ?? "");
        return <li key={member.membershipId}>
          <Link href={`/v3/settings?section=staff&view=people&member=${encodeURIComponent(member.membershipId)}`}
            aria-current={selected ? "page" : undefined}
            className={`block min-h-11 rounded-nav px-3 py-4 transition-colors motion-reduce:transition-none ${selected
              ? "bg-accent-weak" : "hover:bg-surface-2"}`}>
            <span className={`block break-words font-semibold ${selected ? "text-accent" : "text-fg"}`}>{member.displayName}</span>
            <span className="mt-1 block break-words text-sm leading-6 text-fg-2">
              {[member.metadata.jobTitle, department].filter(Boolean).join(" · ") || "Рабочие сведения не заполнены"}
            </span>
            <span className="mt-2 block text-sm leading-6 text-fg-3">
              {STAFF_ROLE_LABELS[member.role]} · {member.status === "active" ? "Доступ активен" : "Доступ заблокирован"}
            </span>
          </Link>
        </li>;
      })}
    </ul>}
  </section>;
}
