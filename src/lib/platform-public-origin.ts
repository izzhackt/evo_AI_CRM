import {
  isConnectedPlatformPage,
  isConnectedStudentAuthPage,
  isConnectedStudentPortalPage,
} from "./platform-route-contract.ts";

export const PRODUCTION_STAFF_ORIGIN = "https://crm.evoadmissions.com" as const;
export const PRODUCTION_STUDENT_ORIGIN = "https://app.evoadmissions.com" as const;

export type PlatformAudience = "staff" | "student";

/** Routing hints only: live authority and RLS remain the access boundary. */
export function platformAudienceForHost(host: string | null): PlatformAudience | null {
  if (host === "crm.evoadmissions.com") return "staff";
  if (host === "app.evoadmissions.com") return "student";
  return null;
}

/** Only known page routes move between the two fixed origins, never APIs. */
export function canonicalPlatformPageOrigin(host: string | null, path: string): string | null {
  const audience = platformAudienceForHost(host);
  if (!audience || path === "/" || path === "/login") return null;
  const studentPage = isConnectedStudentAuthPage(path) || isConnectedStudentPortalPage(path);
  if (audience === "staff" && studentPage) return PRODUCTION_STUDENT_ORIGIN;
  if (audience === "student" && !studentPage && isConnectedPlatformPage(path)) {
    return PRODUCTION_STAFF_ORIGIN;
  }
  return null;
}

/** Resolve a verified actor's home without making the host an identity claim. */
export function platformAudienceHomeRoute(
  host: string | null,
  audience: PlatformAudience,
  path: string,
): string {
  const requestedAudience = platformAudienceForHost(host);
  if (!requestedAudience || requestedAudience === audience) return path;
  const origin = audience === "staff" ? PRODUCTION_STAFF_ORIGIN : PRODUCTION_STUDENT_ORIGIN;
  // Set pathname rather than resolving arbitrary input against the origin.
  const target = new URL(origin);
  target.pathname = path;
  return target.toString();
}
