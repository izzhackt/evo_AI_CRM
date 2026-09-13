import type { JwtPayload, SupabaseClient } from "@supabase/supabase-js";

export type StaffAccessScope = Readonly<{
  kind: "own" | "organization" | "department" | "direction" | "record";
  key: string | null;
  resourceKind: string | null;
}>;
export type StaffAccessAssignment = Readonly<{
  id: string;
  roleId: string;
  label: string;
  bundleId: string;
  bundleVersion: number;
  scope: StaffAccessScope;
}>;
export type VerifiedPlatformAuthority = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  systemRole: "admin" | "staff";
  platformAccessVersion: number;
  assignments: readonly StaffAccessAssignment[];
  permissionKeys: readonly string[];
  email: string;
}>;
export type PlatformAuthorityResult =
  | Readonly<{ status: "authenticated"; authority: VerifiedPlatformAuthority }>
  | Readonly<{ status: "invalid" | "unavailable"; authority: null }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function exactKeys(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}
function integer(value: unknown): number | null {
  const number = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function scope(value: unknown, organizationId: string): StaffAccessScope | null {
  const row = object(value);
  if (!row || !exactKeys(row, ["kind", "key", "resourceKind"])) return null;
  const { kind, key, resourceKind } = row;
  if (kind === "own" && key === null && resourceKind === null) return { kind, key, resourceKind };
  if (kind === "organization" && key === organizationId && resourceKind === null) return { kind, key, resourceKind };
  if (kind === "department" && isUuid(key) && resourceKind === null) return { kind, key, resourceKind };
  if (kind === "direction" && typeof key === "string" && ["CN", "MY", "EUROPE", "AE", "TR"].includes(key) && resourceKind === null) return { kind, key, resourceKind };
  if (kind === "record" && isUuid(key) && typeof resourceKind === "string" && KEY_PATTERN.test(resourceKind)) return { kind, key, resourceKind };
  return null;
}

/** Parses the live RPC only. JWT business roles/bundles are never a fallback. */
export function parseStaffAccessSnapshot(data: unknown, authUserId: string, email: string): VerifiedPlatformAuthority | null {
  const row = object(data);
  if (!row || !exactKeys(row, ["schemaVersion", "authUserId", "profileId", "membershipId", "organizationId", "displayName", "systemRole", "accessVersion", "assignments", "permissions"])
    || row.schemaVersion !== 1 || !isUuid(authUserId) || row.authUserId !== authUserId
    || !isUuid(row.profileId) || !isUuid(row.membershipId) || !isUuid(row.organizationId)
    || typeof row.displayName !== "string" || !row.displayName.trim()
    || (row.systemRole !== "admin" && row.systemRole !== "staff")
    || !Array.isArray(row.assignments) || !Array.isArray(row.permissions)
    || typeof email !== "string" || !email.trim()) return null;
  const accessVersion = integer(row.accessVersion);
  if (accessVersion === null) return null;
  const assignments: StaffAccessAssignment[] = [];
  const ids = new Set<string>();
  for (const value of row.assignments) {
    const assignment = object(value);
    if (!assignment || !exactKeys(assignment, ["id", "roleId", "label", "bundleId", "bundleVersion", "scope"])
      || !isUuid(assignment.id) || ids.has(assignment.id)
      || !isUuid(assignment.roleId) || !isUuid(assignment.bundleId)
      || typeof assignment.label !== "string" || !assignment.label.trim()) return null;
    const assignmentScope = scope(assignment.scope, row.organizationId);
    const bundleVersion = integer(assignment.bundleVersion);
    if (!assignmentScope || bundleVersion === null) return null;
    ids.add(assignment.id);
    assignments.push({ id: assignment.id, roleId: assignment.roleId, label: assignment.label,
      bundleId: assignment.bundleId, bundleVersion, scope: assignmentScope });
  }
  const permissionKeys: string[] = [];
  for (const permission of row.permissions) {
    if (typeof permission !== "string" || !PERMISSION_PATTERN.test(permission) || permissionKeys.includes(permission)) return null;
    permissionKeys.push(permission);
  }
  return { authUserId, email, profileId: row.profileId, membershipId: row.membershipId,
    organizationId: row.organizationId, displayName: row.displayName, systemRole: row.systemRole,
    platformAccessVersion: accessVersion, assignments, permissionKeys };
}

/**
 * Supabase verifies the JWT; the RPC verifies the live staff identity and reads
 * current assignments. An old JWT access version cannot prolong revoked rights.
 * Student authority remains in the separate owner-private Student resolver.
 */
export async function readVerifiedPlatformAuthority(client: SupabaseClient, claims: JwtPayload): Promise<PlatformAuthorityResult> {
  if (!isUuid(claims.sub) || typeof claims.email !== "string" || !claims.email.trim()) return { status: "invalid", authority: null };
  const { data, error } = await client.schema("platform").rpc("staff_access_snapshot");
  if (error) return { status: "unavailable", authority: null };
  const authority = parseStaffAccessSnapshot(data, claims.sub, claims.email);
  return authority ? { status: "authenticated", authority } : { status: "invalid", authority: null };
}
