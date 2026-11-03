import { StatusBadge, type DataTableColumn } from "@/components/kit";
import type { StaffRoleMember } from "@/lib/v3/staff-roles-contract";
import type { StaffDepartment, StaffWorkspaceMember } from "@/lib/v3/staff-workspace-contract";
import { staffDirectoryAccessSummary } from "@/lib/v3/wording";

export type StaffLookup = Readonly<{ departments: ReadonlyMap<string, StaffDepartment>; access: ReadonlyMap<string, StaffRoleMember> }>;

export const departmentOf = (member: StaffWorkspaceMember, lookup: StaffLookup) => lookup.departments.get(member.metadata.departmentId ?? "");
export const accessSummary = (member: StaffWorkspaceMember, lookup: StaffLookup) => staffDirectoryAccessSummary(member, lookup.access.get(member.membershipId));

/**
 * Колонки «Сотрудников»: имя с должностью, отдел, доступ словами и состояние. На телефоне под именем отдел, доступ и состояние.
 * Строка открывает панель сотрудника; блокировка доступа — отдельное слово, а не только цвет.
 */
export function staffColumns(lookup: StaffLookup): DataTableColumn<StaffWorkspaceMember>[] {
  return [
    {
      id: "name", accessorFn: (member) => `${member.displayName} ${member.metadata.jobTitle ?? ""}`, header: "Сотрудник", meta: { mobile: "title", label: "Сотрудник" }, enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0" data-member={row.original.membershipId}>
          <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.displayName}</span>
          <span className="block t-meta text-fg-3">{row.original.metadata.jobTitle || "Рабочие сведения не заполнены"}</span>
        </span>
      ),
    },
    {
      id: "department", accessorFn: (member) => departmentOf(member, lookup)?.name ?? "", header: "Отдел",
      cell: ({ row }) => {
        const department = departmentOf(row.original, lookup);
        return department ? `${department.name}${department.status === "archived" ? " · в архиве" : ""}` : <span className="text-fg-3">Без отдела</span>;
      },
    },
    { id: "access", accessorFn: (member) => accessSummary(member, lookup), header: "Доступ", cell: ({ row }) => <span className="block max-w-prose break-words">{accessSummary(row.original, lookup)}</span> },
    {
      id: "status", accessorFn: (member) => member.status, header: "Состояние",
      cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "ok" : "warn"} label={row.original.status === "active" ? "Доступ активен" : "Доступ заблокирован"} />,
    },
  ];
}
