// These fixed views are only the protected Admin presentation preview.
// Real staff permissions come from staff_access_snapshot and object RPCs.
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
  "/main",
  "/requests",
  "/pipeline",
  "/admissions-pipeline",
  "/inbox",
  "/profile",
  "/calendar",
  "/tasks",
  "/team-chat",
  "/messages",
  "/universities",
  "/knowledge",
  "/marketing",
  // «Финансы» (решение владельца 26.10.2026): раздел верхнего уровня рядом с «Маркетингом»; пока заготовка под доходы, расходы и расчёты.
  "/finance",
  // Набор виджетов «Нового вида» (27.10.2026): страница для владельца, только настоящий Admin.
  "/ui-kit",
  "/ai-agent",
  "/ai-agents",
  "/reply-snippets",
  "/documents",
  "/settings",
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
  "/main": ["sales.read", "admissions.read"],
  "/requests": ["sales.read"],
  "/pipeline": ["sales.read"],
  "/admissions-pipeline": ["admissions.read"],
  "/inbox": ["messaging.read"],
  "/profile": ["dashboard.read"],
  "/calendar": ["admissions.read"],
  "/tasks": ["team.read"],
  "/team-chat": ["team.read"],
  "/messages": ["admissions.read"],
  "/universities": ["sales.read", "admissions.read"],
  "/knowledge": ["admin.preview"],
  "/marketing": ["admin.preview"],
  "/finance": ["admin.preview"],
  "/ui-kit": ["admin.preview"],
  // «ИИ-агент» — все сотрудники (решение владельца Q9, «нет, все могут»).
  "/ai-agent": ["dashboard.read"],
  // «ИИ-агенты» (отдел агентов Claude, 22.10.2026) — те же сотрудники.
  "/ai-agents": ["dashboard.read"],
  "/documents": ["documents.read"],
  "/reply-snippets": ["sales.read", "admissions.read"],
  "/settings": ["admin.preview"],
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
): "/main" | "/calendar" {
  // Every fixed role starts on /main — «Сегодня», one queue of what is
  // due (Э3, 26.09.2026) — matching real-staff routeCapabilities.
  void role;
  return "/main";
}

export function canAdminSelectEffectiveRole(
  systemRole: "admin" | "staff",
  requestedRole: unknown,
): requestedRole is FixedRole {
  return systemRole === "admin" && isFixedRole(requestedRole);
}
