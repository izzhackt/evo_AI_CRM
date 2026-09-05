import { STAFF_ROLES, type StaffRole } from "./roles.ts";

export const FIXED_ROLES = STAFF_ROLES;

export const FIXED_ROLE_CAPABILITIES = [
  "dashboard.read",
  "sales.read",
  "sales.write",
  "admissions.read",
  "admissions.write",
  "documents.read",
  "documents.write",
  "messaging.read",
  "messaging.send",
  "admin.preview",
] as const;

export type FixedRoleCapability = (typeof FIXED_ROLE_CAPABILITIES)[number];
export type FixedRole = StaffRole;

export const FIXED_ROLE_ROUTES = [
  "/v3/main",
  "/v3/pipeline",
  "/v3/inbox",
  "/v3/profile",
  "/v3/calendar",
  "/v3/knowledge",
  "/v3/settings",
] as const;

export type FixedRoleRoute = (typeof FIXED_ROLE_ROUTES)[number];

const ROLE_CAPABILITIES = {
  admin: new Set<FixedRoleCapability>(FIXED_ROLE_CAPABILITIES),
  sales: new Set<FixedRoleCapability>([
    "dashboard.read",
    "sales.read",
    "sales.write",
    "messaging.read",
    "messaging.send",
  ]),
  admissions: new Set<FixedRoleCapability>([
    "dashboard.read",
    "admissions.read",
    "admissions.write",
    "documents.read",
    "documents.write",
    "messaging.read",
    "messaging.send",
  ]),
} as const satisfies Record<FixedRole, ReadonlySet<FixedRoleCapability>>;

const ROUTE_CAPABILITY = {
  "/v3/main": "sales.read",
  "/v3/pipeline": "sales.read",
  "/v3/inbox": "messaging.read",
  "/v3/profile": "dashboard.read",
  "/v3/calendar": "admissions.read",
  "/v3/knowledge": "documents.read",
  "/v3/settings": "admin.preview",
} as const satisfies Record<FixedRoleRoute, FixedRoleCapability>;

export function isFixedRoleRoute(value: unknown): value is FixedRoleRoute {
  return (
    typeof value === "string" &&
    (FIXED_ROLE_ROUTES as readonly string[]).includes(value)
  );
}

export function isFixedRole(value: unknown): value is FixedRole {
  return (
    typeof value === "string" &&
    (FIXED_ROLES as readonly string[]).includes(value)
  );
}

export function fixedRoleCan(
  role: FixedRole,
  capability: FixedRoleCapability,
): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function fixedRoleCanAccessRoute(
  role: FixedRole,
  route: FixedRoleRoute,
): boolean {
  return fixedRoleCan(role, ROUTE_CAPABILITY[route]);
}

export function fixedRoleHomeRoute(
  role: FixedRole,
): "/v3/main" | "/v3/calendar" {
  return role === "admissions" ? "/v3/calendar" : "/v3/main";
}

export function canAdminSelectEffectiveRole(
  authorityRole: FixedRole,
  requestedRole: unknown,
): requestedRole is FixedRole {
  return authorityRole === "admin" && isFixedRole(requestedRole);
}
