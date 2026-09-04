import { fixedRoleHomeRoute, type FixedRole } from "./fixed-role-policy.ts";

const PLATFORM_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/access-denied",
  "/platform-pending",
  "/dashboard",
  "/sales",
  "/clients",
  "/applications",
  "/documents",
  "/visa",
  "/finance",
  "/tasks",
  "/settings",
  // V3 is the accepted successor surface. It remains namespaced until the
  // slice-by-slice replacement sequence retires the superseded UI routes.
  "/v3",
  "/v3/main",
  "/v3/pipeline",
  "/v3/inbox",
  "/v3/profile",
  "/v3/settings",
  "/v3/knowledge",
  "/v3/calendar",
]);

const PLATFORM_CLIENT_PATH =
  /^\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETIRED_PLATFORM_SALES_DETAIL_PATH =
  /^\/sales\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/.*)?$/i;
const PRIVATE_DOCUMENT_VERSION_UPLOAD_PATH =
  /^\/api\/v2\/document-slots\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/versions$/i;
const PRIVATE_DOCUMENT_DOWNLOAD_PATH =
  /^\/api\/v2\/document-versions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;
const PLATFORM_STAFF_ASSISTANT_PATH =
  "/api/platform-ai/staff-assistant";
const PLATFORM_AUDIT_EXPORT_PATH = "/api/platform-audit/export";
const PLATFORM_PRIVATE_API_ALLOWLIST = new Set([
  "/api/v2/whatsapp/inbound",
  "/api/internal/platform-messaging/waha/work",
  "/api/internal/platform-operations/portal-overdue",
]);
const RETIRED_PLATFORM_ROUTE_ROOTS = [
  "/calls",
  "/chat",
  "/whatsapp",
  "/notifications",
  "/reports",
  "/api/database/status",
  "/api/webhooks/telephony",
] as const;

export function platformHomeRoute(role: FixedRole): "/sales" | "/clients" {
  return fixedRoleHomeRoute(role);
}

/**
 * P6B tombstones return a hidden 404 before auth or the generic deferred-module
 * redirect. They do not route to a handler and cannot reactivate old runtime.
 */
export function isRetiredPlatformRoute(path: string): boolean {
  return (
    RETIRED_PLATFORM_SALES_DETAIL_PATH.test(path) ||
    RETIRED_PLATFORM_ROUTE_ROOTS.some(
      (root) => path === root || path.startsWith(`${root}/`),
    )
  );
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
    PLATFORM_CLIENT_PATH.test(path)
  );
}

export function isConnectedPlatformSettingsRequest(
  path: string,
  searchParams: URLSearchParams,
): boolean {
  return path === "/settings" && [...searchParams.keys()].length === 0;
}

/**
 * This exact route owns its complete configuration, same-origin, actor, role,
 * organization and audit boundary. Proxy passes it through without performing
 * the separate optimistic staff-cookie refresh first.
 */
export function isDirectPlatformStaffAssistantApi(path: string): boolean {
  return path === PLATFORM_STAFF_ASSISTANT_PATH;
}

/**
 * These exact service-to-service routes own their own HMAC or disabled-state
 * checks. They must bypass the staff-cookie refresh flow while still staying
 * in the connected Platform boundary.
 */
export function isConnectedPlatformPrivateApi(path: string): boolean {
  return PLATFORM_PRIVATE_API_ALLOWLIST.has(path);
}

/**
 * Browser-facing Platform APIs that use the proxy's optimistic staff-cookie
 * refresh. Their handlers repeat live authority and record-scope checks. The
 * staff assistant deliberately uses the separate direct-route predicate above
 * because its handler owns the full disabled/configuration/Auth boundary.
 */
export function isConnectedPlatformApi(path: string): boolean {
  return (
    path === PLATFORM_AUDIT_EXPORT_PATH ||
    PRIVATE_DOCUMENT_VERSION_UPLOAD_PATH.test(path) ||
    PRIVATE_DOCUMENT_DOWNLOAD_PATH.test(path) ||
    isConnectedPlatformPrivateApi(path)
  );
}
