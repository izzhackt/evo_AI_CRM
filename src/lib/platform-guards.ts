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

const PLATFORM_ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function configuredPlatformOrganizationId(): string | null {
  const value = process.env.EVO_PLATFORM_ORGANIZATION_ID;
  if (!value || value !== value.trim() || !PLATFORM_ORGANIZATION_ID_PATTERN.test(value)) {
    return null;
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

export async function requirePlatformActor(): Promise<PlatformActor> {
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "invalid") {
    // Cookie mutation is not permitted from a Server Component. Hand invalid
    // resident sessions to the exact same-origin Route Handler, which repeats
    // live authorization before it decides whether the session is still valid
    // or must be cleared.
    redirect("/auth/platform-session");
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

export async function requirePlatformAuditAdminActor(): Promise<PlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (actor.platformRole !== "admin") {
    redirect("/platform-pending?from=%2Fsettings%3Ftab%3Daudit");
  }
  return actor;
}

export async function requirePlatformOperationsAdminActor(): Promise<PlatformActor> {
  const actor = await requirePlatformActor();
  const organizationId = configuredPlatformOrganizationId();
  if (
    actor.platformRole !== "admin" ||
    organizationId === null ||
    actor.organizationId !== organizationId
  ) {
    redirect("/platform-pending?from=%2Fsettings%3Ftab%3Doperations");
  }
  return actor;
}
