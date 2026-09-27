"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { StaffDepartment, StaffWorkspaceMember } from "@/lib/v3/staff-workspace-contract";
import type { StaffRoleMember } from "@/lib/v3/staff-roles-contract";
import { staffDirectoryAccessSummary } from "@/lib/v3/wording";

/** Поле строки инструментов — как у «Университетов»: 44 px, значение говорит, что выбрано. */
const CONTROL = "h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface t-body-compact text-fg hover:bg-surface-2";

/**
 * Список сотрудников и карточка выбранного (`children`). Поиск, «Отдел» и
 * «Доступ» — одна строка над списком и карточкой (Э6, правка по ревью
 * #1079): «Сотрудники» — первая страница «Настроек», и люди видны на первом
 * экране и на 1440, и на телефоне, а не под тремя полями в колонку. Подписи
 * полей — для читалки, значение («Все отделы», «Активен») говорит, что
 * выбрано. На телефоне при выбранном сотруднике строка и список скрыты,
 * видна карточка — как раньше.
 */
export function StaffDirectoryList({ members, accessMembers, departments, selectedMemberId, children }: {
  members: readonly StaffWorkspaceMember[];
  accessMembers: readonly StaffRoleMember[];
  departments: readonly StaffDepartment[];
  selectedMemberId?: string;
  /** Карточка выбранного сотрудника или подсказка выбрать. */
  children: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
  const accessByMember = new Map(accessMembers.map((member) => [member.membershipId, member]));
  const needle = search.trim().toLocaleLowerCase("ru");
  const visible = members.filter((member) => {
    const matchesDepartment = !departmentId || (departmentId === "unassigned"
      ? member.metadata.departmentId === null : member.metadata.departmentId === departmentId);
    const searchable = [member.displayName, member.metadata.jobTitle, departmentNames.get(member.metadata.departmentId ?? "")]
      .filter(Boolean).join(" ").toLocaleLowerCase("ru");
    return matchesDepartment && (!status || member.status === status) && (!needle || searchable.includes(needle));
  });

  return <div className="space-y-3">
    <div role="search" aria-label="Поиск сотрудников"
      className={`${selectedMemberId ? "hidden @4xl:flex" : "flex"} flex-wrap items-center gap-2`}>
      <label className="relative min-w-48 flex-1 basis-56 md:max-w-sm">
        <span className="sr-only">Найти сотрудника</span>
        <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <input type="search" className={`${CONTROL} ps-10 pe-3 placeholder:text-fg-3`} placeholder="Имя или должность"
          value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <label className="min-w-40 flex-1 basis-40 sm:max-w-56">
        <span className="sr-only">Отдел</span>
        <select className={`${CONTROL} px-3`} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
          <option value="">Все отделы</option>
          <option value="unassigned">Без отдела</option>
          {departments.map((department) => <option key={department.id} value={department.id}>
            {department.name}{department.status === "archived" ? " · в архиве" : ""}
          </option>)}
        </select>
      </label>
      <label className="min-w-40 flex-1 basis-40 sm:max-w-56">
        <span className="sr-only">Доступ</span>
        <select className={`${CONTROL} px-3`} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Все сотрудники</option>
          <option value="active">Активен</option>
          <option value="suspended">Заблокирован</option>
        </select>
      </label>
      <p role="status" className="t-meta px-1 text-fg-3">Показано <span className="tabular-nums">{visible.length}</span> из <span className="tabular-nums">{members.length}</span></p>
    </div>
    <div className="grid min-w-0 gap-6 border-t border-border @4xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
      <section aria-label="Список сотрудников" className={selectedMemberId ? "hidden min-w-0 @4xl:block" : "min-w-0"}>
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
                  {staffDirectoryAccessSummary(member, accessByMember.get(member.membershipId))} · {member.status === "active" ? "Доступ активен" : "Доступ заблокирован"}
                </span>
              </Link>
            </li>;
          })}
        </ul>}
      </section>
      <div className={`${selectedMemberId ? "block" : "hidden @4xl:block"} min-w-0 @4xl:border-l @4xl:border-border @4xl:pl-6`}>
        {children}
      </div>
    </div>
  </div>;
}
