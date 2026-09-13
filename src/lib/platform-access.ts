import { fixedRoleCan, fixedRoleCanAccessRoute, type FixedRoleCapability, type FixedRoleRoute } from "./fixed-role-policy.ts";
import type { ActivePlatformActor, PlatformActor } from "./platform-auth.ts";

export type StaffCapability = FixedRoleCapability | "sales.report.read" | "snippets.read" | "snippets.write" | "finance.read" | "finance.write" | "catalog.read" | "knowledge.read" | "tasks.read" | "tasks.write" | "chat.read";
const CAPABILITY_PERMISSIONS: Record<StaffCapability, readonly string[]> = {
  "dashboard.read": ["lead.read", "case.read.full", "case.read.summary", "profile.read.full"],
  "sales.read": ["lead.read"],
  "sales.report.read": ["sales.register.read"],
  "snippets.read": ["reply.snippet.sales", "reply.snippet.admissions", "reply.snippet.all"],
  "snippets.write": ["reply.snippet.manage", "reply.snippet.moderate"],
  "sales.write": ["lead.sales.workflow.manage", "lead.sales.owner.assign", "sales.register.manage"],
  "admissions.read": ["case.read.full", "profile.read.full"],
  "admissions.write": ["case.route.manage", "case.lifecycle.change", "case.update.append", "case.curator.assign", "profile.manage", "application.manage", "visa.manage", "task.manage"],
  "documents.read": ["document.read.full", "document.read.sales", "document.download", "knowledge.read.approved"],
  "documents.write": ["document.manage", "document.upload", "document.review", "knowledge.manage"],
  "messaging.read": ["communication.read.full"],
  "messaging.send": ["communication.manual.send"],
  "team.read": ["staff.task.read", "staff.task.create", "team.chat.general", "team.chat.sales", "team.chat.admissions"],
  "admin.preview": [],
  "finance.read": ["finance.read.full", "finance.read.summary"],
  "finance.write": ["finance.manage", "finance.event.confirm", "finance.stop.create", "finance.stop.manage"],
  "catalog.read": ["catalog.read"],
  "knowledge.read": ["knowledge.read.approved", "company.file.read"],
  "tasks.read": ["staff.task.read", "staff.task.create", "task.create", "task.manage"],
  "tasks.write": ["staff.task.create", "staff.task.edit", "staff.task.complete"],
  "chat.read": ["team.chat.general", "team.chat.sales", "team.chat.admissions"],
};

/** A section hint only. Never proves the permission/scope pair for an object. */
export function staffHasPermission(actor: PlatformActor, permission: string): boolean {
  return actor.systemRole === "admin" || actor.permissionKeys.includes(permission);
}
export function staffCan(actor: PlatformActor, capability: StaffCapability): boolean {
  return actor.systemRole === "admin" || CAPABILITY_PERMISSIONS[capability].some((key) => actor.permissionKeys.includes(key));
}
export function isStaffPreview(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): boolean {
  return actor.systemRole === "admin" && actor.presentationRole !== null;
}
export function staffPresentationCan(actor: ActivePlatformActor, capability: FixedRoleCapability): boolean {
  return isStaffPreview(actor) && actor.presentationRole !== null
    ? fixedRoleCan(actor.presentationRole, capability) : staffCan(actor, capability);
}
export function staffCanAccessRoute(actor: ActivePlatformActor, route: FixedRoleRoute): boolean {
  if (isStaffPreview(actor) && actor.presentationRole !== null) return fixedRoleCanAccessRoute(actor.presentationRole, route);
  if (route === "/v3/calendar") return staffCan(actor, "admissions.read") || staffHasPermission(actor, "task.manage");
  if (route === "/v3/tasks") return staffHasPermission(actor, "staff.task.read") || staffHasPermission(actor, "staff.task.create")
    || staffHasPermission(actor, "task.manage")
    || (staffCan(actor, "admissions.read") && staffHasPermission(actor, "task.create"));
  const routeCapabilities: Record<FixedRoleRoute, readonly StaffCapability[]> = {
    "/v3/main": ["sales.read", "sales.report.read", "finance.read"],
    "/v3/pipeline": ["sales.read"],
    "/v3/inbox": ["messaging.read"],
    "/v3/profile": ["dashboard.read"],
    "/v3/calendar": ["admissions.read"],
    "/v3/tasks": ["tasks.read"],
    "/v3/team-chat": ["chat.read"],
    "/v3/universities": ["catalog.read"],
    "/v3/knowledge": ["knowledge.read", "documents.read", "snippets.read"],
    "/v3/settings": ["admin.preview"],
  };
  return routeCapabilities[route].some((capability) => staffCan(actor, capability));
}
export function staffHomeRoute(actor: ActivePlatformActor): FixedRoleRoute | "/access-denied" {
  const routes: readonly FixedRoleRoute[] = ["/v3/main", "/v3/calendar", "/v3/tasks", "/v3/team-chat", "/v3/inbox", "/v3/profile", "/v3/universities", "/v3/knowledge"];
  return routes.find((route) => staffCanAccessRoute(actor, route)) ?? "/access-denied";
}
