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
  "team.read",
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
  "/v3/tasks",
  "/v3/team-chat",
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
    "team.read",
  ]),
  admissions: new Set<FixedRoleCapability>([
    "dashboard.read",
    "admissions.read",
    "admissions.write",
    "documents.read",
    "documents.write",
    "messaging.read",
    "messaging.send",
    "team.read",
  ]),
} as const satisfies Record<FixedRole, ReadonlySet<FixedRoleCapability>>;

type RouteCapabilityRequirement = readonly [
  FixedRoleCapability,
  ...FixedRoleCapability[],
];

const ROUTE_CAPABILITY_ANY_OF = {
  "/v3/main": ["sales.read"],
  "/v3/pipeline": ["sales.read"],
  "/v3/inbox": ["messaging.read"],
  "/v3/profile": ["dashboard.read"],
  "/v3/calendar": ["admissions.read"],
  "/v3/tasks": ["team.read"],
  "/v3/team-chat": ["team.read"],
  "/v3/knowledge": ["documents.read", "messaging.read"],
  "/v3/settings": ["admin.preview"],
} as const satisfies Record<FixedRoleRoute, RouteCapabilityRequirement>;

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
  return ROUTE_CAPABILITY_ANY_OF[route].some((capability) =>
    fixedRoleCan(role, capability),
  );
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
