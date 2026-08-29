import { redirect } from "next/navigation";
import {
  fixedRoleCan,
  type FixedRoleCapability,
} from "./fixed-role-policy";
import {
  resolvePlatformActor,
  type ActivePlatformActor,
  type PlatformActor,
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
  if (!fixedRoleCan(actor.platformRole, capability)) {
    redirect(`/access-denied?from=${encodeURIComponent(from)}`);
  }
  return actor;
}

export async function requirePlatformStudentPortalActor(): Promise<PlatformActor<"student">> {
  await requirePlatformActor();
  redirect("/platform-pending?from=%2Fportal");
}

export async function requirePlatformMessagingActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("messaging.read", "/whatsapp");
}

export async function requirePlatformMessagingSendActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("messaging.send", "/whatsapp");
}

export async function requirePlatformAdmissionsActor(
  route: "/clients" | "/applications" = "/clients",
): Promise<ActivePlatformActor> {
  return requirePlatformCapability("admissions.read", route);
}

export function requirePlatformClientsActor(): Promise<ActivePlatformActor> {
  return requirePlatformAdmissionsActor("/clients");
}

export function requirePlatformApplicationsActor(): Promise<ActivePlatformActor> {
  return requirePlatformAdmissionsActor("/applications");
}

export function requirePlatformDocumentsActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("documents.read", "/documents");
}

export async function requirePlatformSalesActor(): Promise<ActivePlatformActor> {
  return requirePlatformCapability("sales.read", "/sales");
}
