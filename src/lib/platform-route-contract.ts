const PLATFORM_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/register",
  "/platform-pending",
  "/sales",
  "/clients",
  "/applications",
  "/whatsapp",
  "/portal",
  "/portal/applications",
  "/portal/documents",
  "/portal/messages",
  "/portal/notifications",
  "/portal/payments",
  "/portal/profile",
  "/portal/team",
  "/portal/visa",
]);
const PLATFORM_CONVERSATION_PATH =
  /^\/whatsapp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_CLIENT_PATH =
  /^\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_APPLICATION_PATH =
  /^\/applications\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_MEDIA_DOWNLOAD_PATH =
  /^\/api\/platform-messaging\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function platformHomeRoute(role: PlatformRole): string {
  if (role === "admin" || role === "sales") return "/sales";
  if (role === "curator") return "/clients";
  if (role === "student") return "/portal";
  return "/platform-pending";
}

export function platformStudentPortalRedirect(
  role: PlatformRole,
): string | null {
  return role === "student" ? null : platformHomeRoute(role);
}

export function platformStaffRedirect(role: PlatformRole): string | null {
  return role === "student" ? "/portal" : null;
}

/**
 * Only routes backed by the greenfield Platform data plane may pass proxy.
 * Connected detail routes are one exact UUID segment; numeric identifiers,
 * prefixes and descendants stay fail-closed with every legacy or
 * not-yet-connected route.
 */
export function isConnectedPlatformPage(path: string): boolean {
  return (
    PLATFORM_PAGE_ALLOWLIST.has(path) ||
    PLATFORM_CONVERSATION_PATH.test(path) ||
    PLATFORM_CLIENT_PATH.test(path) ||
    PLATFORM_APPLICATION_PATH.test(path)
  );
}

/**
 * The only browser-facing Platform API currently connected through proxy.
 * Its route handler repeats getClaims(), live authority and record-scope
 * checks before issuing an audited one-time media grant.
 */
export function isConnectedPlatformApi(path: string): boolean {
  return PLATFORM_MEDIA_DOWNLOAD_PATH.test(path);
}
import type { PlatformRole } from "./platform-auth";
