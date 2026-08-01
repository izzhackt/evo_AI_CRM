import { redirect } from "next/navigation";
import {
  resolvePlatformActor,
  type PlatformActor,
} from "./platform-auth";
import {
  platformHomeRoute,
  platformStaffRedirect,
  platformStudentPortalRedirect,
} from "./platform-route-contract";

export {
  platformHomeRoute,
  platformStaffRedirect,
  platformStudentPortalRedirect,
};

export async function requirePlatformActor(): Promise<PlatformActor> {
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "invalid") {
    redirect(`/login?error=${encodeURIComponent(result.reason)}`);
  }
  return result.actor;
}

export async function requirePlatformStaffActor(): Promise<PlatformActor> {
  const actor = await requirePlatformActor();
  const destination = platformStaffRedirect(actor.platformRole);
  if (destination) redirect(destination);
  return actor;
}

export async function requirePlatformStudentPortalActor(): Promise<PlatformActor> {
  const actor = await requirePlatformActor();
  const destination = platformStudentPortalRedirect(actor.platformRole);
  if (destination) redirect(destination);
  return actor;
}

export async function requirePlatformMessagingActor(): Promise<PlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (actor.platformRole === "finance") {
    redirect("/platform-pending?from=%2Fwhatsapp");
  }
  return actor;
}

export async function requirePlatformAdmissionsActor(
  route: "/clients" | "/applications" = "/clients",
): Promise<PlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (actor.platformRole === "finance") {
    redirect(`/platform-pending?from=${encodeURIComponent(route)}`);
  }
  return actor;
}

export function requirePlatformClientsActor(): Promise<PlatformActor> {
  return requirePlatformAdmissionsActor("/clients");
}

export function requirePlatformApplicationsActor(): Promise<PlatformActor> {
  return requirePlatformAdmissionsActor("/applications");
}

export async function requirePlatformSalesActor(): Promise<PlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (actor.platformRole !== "admin" && actor.platformRole !== "sales") {
    redirect("/platform-pending?from=%2Fsales");
  }
  return actor;
}
