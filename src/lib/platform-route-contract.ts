import { fixedRoleHomeRoute, type FixedRole } from "./fixed-role-policy.ts";

const PLATFORM_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/access-denied",
  "/platform-pending",
  "/sales",
  "/clients",
  "/applications",
  "/documents",
  "/visa",
  "/finance",
  "/tasks",
  "/whatsapp",
  "/settings",
]);
const PLATFORM_CONVERSATION_PATH =
  /^\/whatsapp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_LEAD_PATH =
  /^\/sales\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_LEAD_CONVERSATION_PATH =
  /^\/sales\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/conversations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_CLIENT_PATH =
  /^\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_DOCUMENT_UPLOAD_PATH = "/api/v2/documents";
const PRIVATE_DOCUMENT_RESUBMISSION_PATH =
  /^\/api\/v2\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resubmissions$/i;
const PRIVATE_DOCUMENT_DOWNLOAD_PATH =
  /^\/api\/v2\/document-versions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;
const PLATFORM_STAFF_ASSISTANT_PATH =
  "/api/platform-ai/staff-assistant";
const PLATFORM_PRIVATE_API_ALLOWLIST = new Set([
  "/api/v2/whatsapp/inbound",
  "/api/internal/platform-messaging/waha/autonomous-reply",
  "/api/internal/platform-messaging/manual-send/work",
  "/api/internal/platform-operations/portal-overdue",
  "/api/internal/platform-ai/gemini/proposal",
]);
export function platformHomeRoute(role: FixedRole): "/sales" | "/clients" {
  return fixedRoleHomeRoute(role);
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
    PLATFORM_LEAD_PATH.test(path) ||
    PLATFORM_LEAD_CONVERSATION_PATH.test(path) ||
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
    path === PRIVATE_DOCUMENT_UPLOAD_PATH ||
    PRIVATE_DOCUMENT_RESUBMISSION_PATH.test(path) ||
    PRIVATE_DOCUMENT_DOWNLOAD_PATH.test(path) ||
    isConnectedPlatformPrivateApi(path)
  );
}
