import { redirect } from "next/navigation";
import {
  resolvePlatformActor,
  type PlatformActor,
  type PlatformRole,
} from "./platform-auth";

export function platformHomeRoute(role: PlatformRole): string {
  return role === "admin" || role === "sales" || role === "curator"
    ? "/whatsapp"
    : "/platform-pending";
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
