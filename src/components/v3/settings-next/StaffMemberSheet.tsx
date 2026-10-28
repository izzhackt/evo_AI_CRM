"use client";

import { useState } from "react";

import { KeyFacts } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DIRECTION_LABELS } from "@/components/v3/profile/admissions-view";
import { StaffDisclosure } from "@/components/v3/settings/StaffDisclosure";
import { OrganizationalDetailsForm } from "@/components/v3/settings/StaffMemberDetails";
import { StaffRoleAssignments } from "@/components/v3/settings/StaffRoleAssignments";
import { StaffDangerZone } from "@/components/v3/settings/StaffSection";
import type { StaffRoleMember, StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffDepartment, StaffWorkspaceMember } from "@/lib/v3/staff-workspace-contract";

/**
 * Сотрудник в панели: рабочие сведения (должность, отдел, направления; «Должность не даёт прав доступа» — за «?» панели), правка тем же
 * бланком с причиной и версией, и «Доступ» — роли и области назначения и «Опасные действия» (блокировка, восстановление входа), как
 * раньше, отдельно от повседневных назначений. Вся работа с доступом — прежние формы: те же поля, команды и request_id.
 */
export function StaffMemberSheet({ member, access, department, departments, roles, organizationId }: Readonly<{
  member: StaffWorkspaceMember;
  access: StaffRoleMember | undefined;
  department: StaffDepartment | undefined;
  departments: readonly StaffDepartment[];
  roles: StaffRoleWorkspace;
  organizationId: string;
}>) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="grid gap-5" data-testid="v3-staff-member" data-member={member.membershipId}>
      <section aria-label="Рабочие сведения" className="grid gap-3">
        {editing ? <OrganizationalDetailsForm member={member} departments={departments} onClose={() => setEditing(false)} /> : (
          <>
            <KeyFacts columns={2} facts={[
              { label: "Должность", value: member.metadata.jobTitle || "Не указана" },
              { label: "Отдел", value: department ? `${department.name}${department.status === "archived" ? " · в архиве" : ""}` : "Не назначен" },
              { label: "Направления работы", value: member.metadata.directions.length ? member.metadata.directions.map((direction) => DIRECTION_LABELS[direction]).join(", ") : "Не указаны" },
            ]} />
            <div><Button variant="outline" onClick={() => setEditing(true)}>Редактировать</Button></div>
          </>
        )}
      </section>
      <StaffDisclosure label="Доступ" className="border-t border-border pt-2" buttonClassName="t-item">
        <div className="grid gap-4 pt-2">
          {access ? <StaffRoleAssignments member={access} workspace={roles} organizationId={organizationId} />
            : <p role="alert" className="text-sm text-danger">Права сотрудника недоступны. Обновите страницу.</p>}
          <StaffDangerZone member={member} />
        </div>
      </StaffDisclosure>
    </div>
  );
}
