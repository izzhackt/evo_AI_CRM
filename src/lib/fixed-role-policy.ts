import {
  DEVELOPMENT_GATE_ROLES,
  type DevelopmentGateRole,
} from "./development-gate-core.ts";

export const FIXED_ROLE_CAPABILITIES = [
  "sales.read",
  "sales.write",
  "admissions.read",
  "admissions.write",
  "messaging.read",
  "admin.preview",
] as const;

export type FixedRoleCapability = (typeof FIXED_ROLE_CAPABILITIES)[number];
export type FixedRole = DevelopmentGateRole;

export const FIXED_ROLE_ROUTES = [
  "/sales",
  "/clients",
  "/applications",
  "/whatsapp",
  "/settings",
] as const;

export type FixedRoleRoute = (typeof FIXED_ROLE_ROUTES)[number];

const ROLE_CAPABILITIES = {
  admin: new Set<FixedRoleCapability>(FIXED_ROLE_CAPABILITIES),
  sales: new Set<FixedRoleCapability>([
    "sales.read",
    "sales.write",
    "messaging.read",
  ]),
  admissions: new Set<FixedRoleCapability>([
    "admissions.read",
    "admissions.write",
    "messaging.read",
  ]),
} as const satisfies Record<FixedRole, ReadonlySet<FixedRoleCapability>>;

const ROUTE_CAPABILITY = {
  "/sales": "sales.read",
  "/clients": "admissions.read",
  "/applications": "admissions.read",
  "/whatsapp": "messaging.read",
  "/settings": "admin.preview",
} as const satisfies Record<FixedRoleRoute, FixedRoleCapability>;

export function isFixedRole(value: unknown): value is FixedRole {
  return (
    typeof value === "string" &&
    (DEVELOPMENT_GATE_ROLES as readonly string[]).includes(value)
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

export function fixedRoleHomeRoute(role: FixedRole): "/sales" | "/clients" {
  return role === "admissions" ? "/clients" : "/sales";
}

export function canAdminSelectEffectiveRole(
  authorityRole: FixedRole,
  requestedRole: unknown,
): requestedRole is FixedRole {
  return authorityRole === "admin" && isFixedRole(requestedRole);
}
