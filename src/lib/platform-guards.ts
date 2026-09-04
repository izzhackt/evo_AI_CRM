import { redirect } from "next/navigation";
import {
  fixedRoleCan,
  fixedRoleCanAccessRoute,
  type FixedRoleCapability,
  type FixedRoleRoute,
} from "./fixed-role-policy";
import {
  resolvePlatformActor,
  type ActivePlatformActor,
} from "./platform-auth";
import {
  platformHomeRoute,
} from "./platform-route-contract";

export { platformHomeRoute };

export async function requirePlatformActor(): Promise<ActivePlatformActor> {
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "invalid") redirect("/login?error=session_invalid");
  return result.actor;
}

export async function requirePlatformStaffActor(): Promise<ActivePlatformActor> {
  return requirePlatformActor();
}

export async function requirePlatformCapability(
  capability: FixedRoleCapability,
  from: string,
): Promise<ActivePlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, capability)) {
    redirect(`/access-denied?from=${encodeURIComponent(from)}`);
  }
  return actor;
}

/**
 * V3 page visibility follows the selected presentation role. This guard is
 * deliberately separate from `requirePlatformCapability`: server actions and
 * repositories continue to authorize with the actor's immutable authority
 * role, while an Admin preview cannot open pages hidden from the role being
 * previewed by typing their URL directly.
 */
export async function requireV3PageActor(
  route: FixedRoleRoute,
): Promise<ActivePlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCanAccessRoute(actor.presentationRole, route)) {
    redirect(`/access-denied?from=${encodeURIComponent(route)}`);
  }
  return actor;
}

export async function requirePlatformMessagingActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("messaging.read", "/v3/inbox");
}

export async function requirePlatformMessagingSendActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("messaging.send", "/v3/inbox");
}

export async function requirePlatformAdmissionsActor(
  route: "/v3/profile" = "/v3/profile",
): Promise<ActivePlatformActor> {
  return requirePlatformCapability("admissions.read", route);
}

export async function requirePlatformSalesActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("sales.read", "/v3/pipeline");
}
