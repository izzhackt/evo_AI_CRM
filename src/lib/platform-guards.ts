import { redirect } from "next/navigation";
import {
  resolvePlatformActor,
  type PlatformActor,
  type PlatformRole,
} from "./platform-auth";

export function platformHomeRoute(role: PlatformRole): string {
  if (role === "admin" || role === "sales") return "/sales";
  if (role === "curator") return "/clients";
  return "/platform-pending";
}

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
  if (actor.platformRole === "student") {
    redirect("/platform-pending?from=%2Fportal");
  }
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
