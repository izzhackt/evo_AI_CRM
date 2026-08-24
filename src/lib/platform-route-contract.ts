import type { PlatformRole } from "./platform-auth";

const PLATFORM_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/register",
  "/platform-pending",
  "/sales",
  "/clients",
  "/applications",
  "/whatsapp",
  "/settings",
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
const PLATFORM_LEAD_PATH =
  /^\/sales\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_CLIENT_PATH =
  /^\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_APPLICATION_PATH =
  /^\/applications\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_MEDIA_DOWNLOAD_PATH =
  /^\/api\/platform-messaging\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_AUDIT_EXPORT_PATH = "/api/platform-audit/export";
const PLATFORM_STAFF_ASSISTANT_PATH =
  "/api/platform-ai/staff-assistant";
const PLATFORM_PRIVATE_API_ALLOWLIST = new Set([
  "/api/internal/platform-messaging/waha/events",
  "/api/internal/platform-messaging/waha/work",
  "/api/internal/platform-messaging/waha/history",
  "/api/internal/platform-messaging/waha/media",
  "/api/internal/platform-messaging/waha/autonomous-reply",
  "/api/internal/platform-messaging/manual-send/work",
  "/api/internal/platform-operations/portal-overdue",
  "/api/internal/lead-agent/whatsapp",
  "/api/internal/platform-ai/gemini/proposal",
]);
const PLATFORM_AUDIT_SETTINGS_QUERY_KEYS = new Set([
  "tab",
  "start_at",
  "end_at",
  "actions",
  "resource_types",
  "resource_id",
  "page_size",
  "snapshot_created_at",
  "snapshot_id",
  "cursor_created_at",
  "cursor_id",
]);
const PLATFORM_STAFF_SETTINGS_QUERY_KEYS = new Set(["tab", "staff_result"]);

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
  if (role === "student") return "/portal";
  if (role === "finance") return "/platform-pending";
  return null;
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
    PLATFORM_CLIENT_PATH.test(path) ||
    PLATFORM_APPLICATION_PATH.test(path)
  );
}

/**
 * `/settings` must be present in the path-only proxy allowlist, so the page
 * repeats this exact query check before it imports or reads the legacy SQLite
 * settings provider. Unknown and duplicate fields fail closed.
 */
export function isConnectedPlatformAuditSettingsRequest(
  path: string,
  searchParams: URLSearchParams,
): boolean {
  if (path !== "/settings" || searchParams.getAll("tab").length !== 1) {
    return false;
  }
  if (searchParams.get("tab") !== "audit") return false;

  for (const key of new Set(searchParams.keys())) {
    if (
      !PLATFORM_AUDIT_SETTINGS_QUERY_KEYS.has(key) ||
      searchParams.getAll(key).length !== 1
    ) {
      return false;
    }
  }
  return true;
}

export function isConnectedPlatformStaffSettingsRequest(
  path: string,
  searchParams: URLSearchParams,
): boolean {
  if (path !== "/settings" || searchParams.getAll("tab").length !== 1) {
    return false;
  }
  if (searchParams.get("tab") !== "staff") return false;

  for (const key of new Set(searchParams.keys())) {
    if (
      !PLATFORM_STAFF_SETTINGS_QUERY_KEYS.has(key) ||
      searchParams.getAll(key).length !== 1
    ) {
      return false;
    }
  }
  return true;
}

export function isConnectedPlatformSettingsRequest(
  path: string,
  searchParams: URLSearchParams,
  { auditEnabled }: { auditEnabled: boolean },
): boolean {
  return (
    isConnectedPlatformStaffSettingsRequest(path, searchParams) ||
    (
      auditEnabled &&
      isConnectedPlatformAuditSettingsRequest(path, searchParams)
    )
  );
}

export function isConnectedPlatformAuditExportApi(path: string): boolean {
  return path === PLATFORM_AUDIT_EXPORT_PATH;
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
    PLATFORM_MEDIA_DOWNLOAD_PATH.test(path) ||
    isConnectedPlatformAuditExportApi(path) ||
    isConnectedPlatformPrivateApi(path)
  );
}
