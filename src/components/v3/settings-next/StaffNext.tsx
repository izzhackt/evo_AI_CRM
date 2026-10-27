"use client";

import { useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffWorkspaceData } from "@/lib/v3/staff-workspace-contract";

import { StaffAccessLog } from "./StaffAccessLog";
import { StaffMemberSheet } from "./StaffMemberSheet";
import { StaffNewAccess } from "./StaffNewAccess";
import { accessSummary, departmentOf, staffColumns, type StaffLookup } from "./staff-columns";

const PEOPLE_HREF = "/v3/settings?section=staff&view=people";
const memberHref = (id: string | null) => (id ? `${PEOPLE_HREF}&member=${encodeURIComponent(id)}` : PEOPLE_HREF);

/**
 * «Сотрудники»: таблица людей (имя и должность, отдел, доступ словами, состояние) с поиском и фильтрами «Отдел» и «Доступ», панель
 * сотрудника по строке и действия доступа над таблицей. Выбор несёт адрес `?member=` (ссылку можно переслать), но панель открывается
 * сразу из присланных данных, без нового чтения: адрес обновляется на месте. Чтения, права и команды — прежние.
 */
export function StaffNext({ data, roles, organizationId, selectedMemberId }: Readonly<{
  data: StaffWorkspaceData; roles: StaffRoleWorkspace; organizationId: string; selectedMemberId?: string;
}>) {
  const [openId, setOpenId] = useState<string | null>(selectedMemberId ?? null);
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");
  const lookup: StaffLookup = useMemo(() => ({
    departments: new Map(data.departments.map((department) => [department.id, department])),
    access: new Map(roles.members.map((member) => [member.membershipId, member])),
  }), [data.departments, roles.members]);
  const columns = useMemo(() => staffColumns(lookup), [lookup]);
  const visible = data.members.filter((member) =>
    (!departmentId || (departmentId === "unassigned" ? member.metadata.departmentId === null : member.metadata.departmentId === departmentId))
    && (!status || member.status === status));
  const open = data.members.find((member) => member.membershipId === openId) ?? null;
  const choose = (id: string | null) => {
    setOpenId(id);
    window.history.replaceState(window.history.state, "", memberHref(id));
  };
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-staff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StaffNewAccess roles={roles} organizationId={organizationId} />
        <StaffAccessLog requests={data.requests} roles={roles} organizationId={organizationId} />
      </div>
      {selectedMemberId && !data.members.some((member) => member.membershipId === selectedMemberId) && openId === selectedMemberId ? (
        <p role="alert" className="t-body-compact text-danger">Сотрудник не найден или больше недоступен. <Button variant="link" onClick={() => choose(null)}>К сотрудникам</Button></p>
      ) : null}
      <DataTable
        label="Список сотрудников"
        data={visible}
        columns={columns}
        getRowId={(member) => member.membershipId}
        getRowLabel={(member) => member.displayName}
        onRowClick={(member) => choose(member.membershipId)}
        searchPlaceholder="Имя, должность или отдел"
        columnMenu={false}
        pageSize={25}
        toolbar={(
          <>
            <div className="w-44"><NativeSelect aria-label="Отдел" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">Все отделы</option><option value="unassigned">Без отдела</option>
              {data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}{department.status === "archived" ? " · в архиве" : ""}</option>)}
            </NativeSelect></div>
            <div className="w-44"><NativeSelect aria-label="Доступ" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Любой доступ</option><option value="active">Доступ активен</option><option value="suspended">Доступ заблокирован</option>
            </NativeSelect></div>
          </>
        )}
        empty={<EmptyState title={data.members.length ? "Сотрудники не найдены. Измените поиск или фильтры." : "Подключённых сотрудников пока нет."} />}
      />
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next) choose(null); }} title={open?.displayName ?? "Сотрудник"}
        description={open ? `${accessSummary(open, lookup)} · ${open.status === "active" ? "Доступ активен" : "Доступ заблокирован"}` : undefined}
        help="Должность не даёт прав доступа.">
        {open ? <StaffMemberSheet key={open.membershipId} member={open} access={lookup.access.get(open.membershipId)} department={departmentOf(open, lookup)}
          departments={data.departments} roles={roles} organizationId={organizationId} /> : null}
      </DetailSheet>
    </div>
  );
}
