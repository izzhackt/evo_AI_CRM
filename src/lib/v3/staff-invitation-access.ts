import { ADMISSIONS_DIRECTIONS } from "../platform-admissions-playbook-contract.ts";
import { STAFF_SCOPE_KINDS, type StaffRoleWorkspace } from "./staff-roles-contract.ts";
import type { StaffInviteAssignmentInput, StaffWorkspaceActionState } from "./staff-workspace-contract.ts";

/** A returned access-review conflict is resolved by preparation, never by resending Auth. */
export function staffReconcileAllowsPreparation(state: StaffWorkspaceActionState) {
  if (state.metadataOutcome === "unknown") return false;
  if (state.outcome !== "unknown") return true;
  return ["legacy_access_review_required", "prepared_access_invalid", "role_version_changed", "scope_changed"].includes(state.conflictCode ?? "");
}

export function supportedStaffInviteScopes(workspace: StaffRoleWorkspace, roleId: string) {
  const role = workspace.roles.find((entry) => entry.id === roleId && entry.status === "active" && entry.bundleId);
  return STAFF_SCOPE_KINDS.filter((kind) => kind !== "record" && !!role?.permissionKeys.length && role.permissionKeys.every((key) =>
    workspace.permissions.find((permission) => permission.key === key)?.allowedScopes.includes(kind)));
}

/** UI readiness only; the server independently verifies live role versions and scopes. */
export function invitationAccessIsValid(rows: readonly StaffInviteAssignmentInput[], noAccess: boolean, workspace: StaffRoleWorkspace, organizationId: string) {
  if (noAccess) return true;
  if (!rows.length || rows.length > 100) return false;
  const keys = rows.map((row) => JSON.stringify([row.roleId, row.scope.kind, row.scope.key, row.scope.resourceKind]));
  return new Set(keys).size === rows.length && rows.every((row) => {
    const role = workspace.roles.find((entry) => entry.id === row.roleId && entry.status === "active" && entry.bundleId);
    if (!role || role.version !== row.roleVersion || row.scope.resourceKind !== null || !supportedStaffInviteScopes(workspace, row.roleId).includes(row.scope.kind)) return false;
    if (row.scope.kind === "own") return row.scope.key === null;
    if (row.scope.kind === "organization") return row.scope.key === organizationId;
    if (row.scope.kind === "department") return workspace.departments.some((department) => department.id === row.scope.key && department.status === "active");
    return row.scope.kind === "direction" && ADMISSIONS_DIRECTIONS.some((direction) => direction === row.scope.key);
  });
}
