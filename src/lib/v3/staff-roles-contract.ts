export const STAFF_SCOPE_KINDS = ["own", "organization", "department", "direction", "record"] as const;
export type StaffScopeKind = (typeof STAFF_SCOPE_KINDS)[number];
export type StaffRoleScope = Readonly<{ kind: StaffScopeKind; key: string | null; resourceKind: string | null }>;
export type StaffRoleAssignmentInput = Readonly<{ roleId: string; scope: StaffRoleScope }>;
export type StaffRoleExpectedBinding = Readonly<{
  roleId: string; roleVersion: number; bundleId: string; bundleVersion: number;
}>;
export type StaffRoleAssignment = StaffRoleAssignmentInput & Readonly<{
  id: string; label: string; bundleId: string; bundleVersion: number;
}>;
export type StaffRolePermission = Readonly<{
  key: string; label: string; group: string; allowedScopes: readonly StaffScopeKind[];
  resourceKinds: readonly string[]; sensitive: boolean; systemOnly: boolean;
}>;
export type StaffEditableRole = Readonly<{
  id: string; label: string; description: string; status: "active" | "archived";
  version: number; bundleId: string | null; bundleVersion: number | null;
  permissionKeys: readonly string[]; draftPermissionKeys: readonly string[]; memberCount: number;
}>;
export type StaffRoleMember = Readonly<{
  membershipId: string; displayName: string; systemRole: "admin" | "staff";
  accessVersion: number; assignments: readonly StaffRoleAssignment[];
}>;
export type StaffRoleWorkspace = Readonly<{
  schemaVersion: 1; permissions: readonly StaffRolePermission[]; roles: readonly StaffEditableRole[];
  members: readonly StaffRoleMember[];
  departments: readonly Readonly<{ id: string; name: string; status: "active" | "archived" }>[];
}>;
export type StaffRoleImpact = Readonly<{
  roleId: string; version: number; affectedMembershipIds: readonly string[];
  addedPermissionKeys: readonly string[]; removedPermissionKeys: readonly string[];
  impactFingerprint: string;
}>;
export type StaffRolesActionState = Readonly<{
  status: "idle" | "success" | "error"; message: string; outcome?: "unknown";
  roleId?: string; version?: number; impact?: StaffRoleImpact;
  membershipId?: string; accessVersion?: number;
}>;
export const STAFF_ROLES_INITIAL_STATE: StaffRolesActionState = { status: "idle", message: "" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function invalid(): never { throw new Error("staff_roles_invalid_contract"); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) return invalid();
  return result;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalid(); }
function text(value: unknown): string { return typeof value === "string" ? value : invalid(); }
function requiredText(value: unknown): string { const result = text(value); return result.trim() ? result : invalid(); }
function uuid(value: unknown): string { const result = text(value); return UUID.test(result) ? result : invalid(); }
function integer(value: unknown, minimum = 1): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : invalid();
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function unique<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  return new Set(values.map(key)).size === values.length ? values : invalid();
}
function strings(value: unknown): readonly string[] { return unique(array(value).map(requiredText), (entry) => entry); }
function status(value: unknown): "active" | "archived" { return value === "active" || value === "archived" ? value : invalid(); }
function systemRole(value: unknown): "admin" | "staff" { return value === "admin" || value === "staff" ? value : invalid(); }
export function parseStaffRoleImpactFingerprint(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : invalid();
}
function scopeKind(value: unknown): StaffScopeKind {
  return STAFF_SCOPE_KINDS.includes(value as StaffScopeKind) ? value as StaffScopeKind : invalid();
}

export function parseStaffRoleScope(value: unknown): StaffRoleScope {
  const row = record(value, ["kind", "key", "resourceKind"]);
  const kind = scopeKind(row.kind);
  const key = row.key === null ? null : requiredText(row.key);
  const resourceKind = row.resourceKind === null ? null : requiredText(row.resourceKind);
  if ((kind === "own") !== (key === null) || (kind === "record") !== (resourceKind !== null)) return invalid();
  if (key !== null && ["organization", "department", "record"].includes(kind)) uuid(key);
  return { kind, key, resourceKind };
}

export function parseStaffRoleAssignmentInputs(value: unknown): readonly StaffRoleAssignmentInput[] {
  const rows = array(value);
  if (rows.length > 100) return invalid();
  return unique(rows.map((value) => {
    const row = record(value, ["roleId", "scope"]);
    return { roleId: uuid(row.roleId), scope: parseStaffRoleScope(row.scope) };
  }), (row) => JSON.stringify([row.roleId, row.scope.kind, row.scope.key, row.scope.resourceKind]));
}

/** Bind each distinct selected role to the exact published version reviewed. */
export function parseStaffRoleExpectedBindings(
  value: unknown, assignments: readonly StaffRoleAssignmentInput[],
): readonly StaffRoleExpectedBinding[] {
  const rows = array(value);
  if (rows.length > 100) return invalid();
  const expectedRoles = new Set(assignments.map((row) => row.roleId.toLowerCase()));
  const bindings = unique(rows.map((value) => {
    const row = record(value, ["roleId", "roleVersion", "bundleId", "bundleVersion"]);
    return { roleId: uuid(row.roleId), roleVersion: integer(row.roleVersion),
      bundleId: uuid(row.bundleId), bundleVersion: integer(row.bundleVersion) };
  }), (row) => row.roleId.toLowerCase());
  if (bindings.length !== expectedRoles.size
    || bindings.some((row) => !expectedRoles.has(row.roleId.toLowerCase()))) return invalid();
  return bindings;
}

function assignment(value: unknown): StaffRoleAssignment {
  const row = record(value, ["id", "roleId", "label", "bundleId", "bundleVersion", "scope"]);
  return { id: uuid(row.id), roleId: uuid(row.roleId), label: requiredText(row.label),
    bundleId: uuid(row.bundleId), bundleVersion: integer(row.bundleVersion), scope: parseStaffRoleScope(row.scope) };
}

export function parseStaffRoleWorkspace(value: unknown): StaffRoleWorkspace {
  const root = record(value, ["schemaVersion", "permissions", "roles", "members", "departments"]);
  if (root.schemaVersion !== 1) return invalid();
  const permissions = unique(array(root.permissions).map((value): StaffRolePermission => {
    const row = record(value, ["key", "label", "group", "allowedScopes", "resourceKinds", "sensitive", "systemOnly"]);
    return { key: requiredText(row.key), label: requiredText(row.label), group: requiredText(row.group),
      allowedScopes: unique(array(row.allowedScopes).map(scopeKind), (key) => key),
      resourceKinds: strings(row.resourceKinds), sensitive: boolean(row.sensitive), systemOnly: boolean(row.systemOnly) };
  }), (row) => row.key);
  const permissionKeys = new Set(permissions.map((row) => row.key));
  const roles = unique(array(root.roles).map((value): StaffEditableRole => {
    const row = record(value, ["id", "label", "description", "status", "version", "bundleId", "bundleVersion", "permissionKeys", "draftPermissionKeys", "memberCount"]);
    const bundleId = row.bundleId === null ? null : uuid(row.bundleId);
    const bundleVersion = row.bundleVersion === null ? null : integer(row.bundleVersion);
    if ((bundleId === null) !== (bundleVersion === null)) return invalid();
    const published = strings(row.permissionKeys), draft = strings(row.draftPermissionKeys);
    if ([...published, ...draft].some((key) => !permissionKeys.has(key))) return invalid();
    return { id: uuid(row.id), label: requiredText(row.label), description: text(row.description),
      status: status(row.status), version: integer(row.version), bundleId, bundleVersion,
      permissionKeys: published, draftPermissionKeys: draft, memberCount: integer(row.memberCount, 0) };
  }), (row) => row.id);
  const members = unique(array(root.members).map((value): StaffRoleMember => {
    const row = record(value, ["membershipId", "displayName", "systemRole", "accessVersion", "assignments"]);
    const assignments = unique(array(row.assignments).map(assignment), (entry) => entry.id);
    if (assignments.some((entry) => !roles.some((role) => role.id === entry.roleId))) return invalid();
    return { membershipId: uuid(row.membershipId), displayName: requiredText(row.displayName),
      systemRole: systemRole(row.systemRole), accessVersion: integer(row.accessVersion), assignments };
  }), (row) => row.membershipId);
  const departments = unique(array(root.departments).map((value) => {
    const row = record(value, ["id", "name", "status"]);
    return { id: uuid(row.id), name: requiredText(row.name), status: status(row.status) };
  }), (row) => row.id);
  return { schemaVersion: 1, permissions, roles, members, departments };
}

export function parseStaffRoleImpact(value: unknown): StaffRoleImpact {
  const row = record(value, ["roleId", "version", "affectedMembershipIds", "addedPermissionKeys", "removedPermissionKeys", "impactFingerprint"]);
  return { roleId: uuid(row.roleId), version: integer(row.version),
    affectedMembershipIds: unique(array(row.affectedMembershipIds).map(uuid), (id) => id),
    addedPermissionKeys: strings(row.addedPermissionKeys), removedPermissionKeys: strings(row.removedPermissionKeys),
    impactFingerprint: parseStaffRoleImpactFingerprint(row.impactFingerprint) };
}

export function parseStaffRoleCommandResult(value: unknown, kind: "role" | "publish" | "assignments" | "admin") {
  const roleKeys = ["status", "roleId", "version"];
  const memberKeys = ["status", "membershipId", "accessVersion"];
  const row = record(value, kind === "role" ? roleKeys : kind === "publish"
    ? [...roleKeys, "bundleId", "bundleVersion", "affectedMembershipIds"]
    : kind === "admin" ? [...memberKeys, "systemRole"] : memberKeys);
  if (row.status !== "applied" && row.status !== "replayed") return invalid();
  if (kind === "role" || kind === "publish") {
    if (kind === "publish") {
      uuid(row.bundleId); integer(row.bundleVersion); unique(array(row.affectedMembershipIds).map(uuid), (id) => id);
    }
    return { roleId: uuid(row.roleId), version: integer(row.version) };
  }
  if (kind === "admin") systemRole(row.systemRole);
  const membershipId = uuid(row.membershipId); const accessVersion = integer(row.accessVersion);
  return { membershipId, accessVersion };
}
