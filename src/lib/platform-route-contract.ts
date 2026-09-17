import { staffHomeRoute } from "./platform-access.ts";
import type { ActivePlatformActor } from "./platform-auth.ts";

const PLATFORM_STAFF_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/auth/staff",
  "/access-denied",
  "/platform-pending",
  "/v3",
  "/v3/main",
  "/v3/pipeline",
  "/v3/inbox",
  "/v3/profile",
  "/v3/settings",
  "/v3/knowledge",
  "/v3/calendar",
  "/v3/tasks",
  "/v3/team-chat",
  "/v3/universities",
  "/v3/universities/manage",
]);

const STUDENT_PORTAL_PAGE_ALLOWLIST = new Set([
  "/portal",
  "/portal/documents",
  "/portal/applications",
  "/portal/universities",
  "/portal/payments",
  "/portal/notifications",
  "/portal/tests",
  "/portal/tests/english",
  "/portal/tests/career",
]);

const STUDENT_AUTH_PAGE_ALLOWLIST = new Set([
  "/auth/callback",
  "/auth/set-password",
  "/auth/account-pending",
]);

const STAFF_UNIVERSITY_DETAIL_PATH = /^\/v3\/universities\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_UNIVERSITY_FORMS_PATH = /^\/v3\/universities\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/forms$/i;
const STUDENT_UNIVERSITY_DETAIL_PATH = /^\/portal\/universities\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUDENT_NOTIFICATION_DETAIL_PATH = /^\/portal\/notifications\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STUDENT_DOCUMENT_VERSION_UPLOAD_PATH =
  /^\/api\/portal\/document-slots\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/versions$/i;
const STUDENT_DOCUMENT_DOWNLOAD_PATH =
  /^\/api\/portal\/document-versions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i;

const PRIVATE_DOCUMENT_VERSION_UPLOAD_PATH =
  /^\/api\/v2\/document-slots\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/versions$/i;
const PRIVATE_DOCUMENT_DOWNLOAD_PATH =
  /^\/api\/v2\/document-versions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;
const PRIVATE_COMPANY_FILE_VERSION_UPLOAD_PATH =
  /^\/api\/v3\/company-files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/versions$/i;
const PRIVATE_COMPANY_FILE_DOWNLOAD_PATH =
  /^\/api\/v3\/company-file-versions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download$/i;
const DOCUMENT_RECOGNITION_JOBS_PATH =
  /^\/api\/v3\/student-cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/document-recognition-jobs$/i;
const DOCUMENT_EXPORT_PATH =
  /^\/api\/v3\/student-cases\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/document-exports(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:download|reconcile))?$/i;
const PLATFORM_STAFF_ASSISTANT_PATH =
  "/api/platform-ai/staff-assistant";
const UNIVERSITY_TEMPLATE_SOURCE_PATH =
  /^\/api\/v3\/university-forms\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/versions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/source(?:\/(?:status|preview|page|cancel|reconcile))?$/i;
const PLATFORM_AUDIT_EXPORT_PATH = "/api/platform-audit/export";
const PLATFORM_PRIVATE_API_ALLOWLIST = new Set([
  "/api/v2/whatsapp/inbound",
  "/api/internal/platform-messaging/waha/work",
  "/api/internal/platform-operations/portal-overdue",
]);
const RETIRED_PLATFORM_ROUTE_ROOTS = [
  "/dashboard",
  "/sales",
  "/clients",
  "/applications",
  "/documents",
  "/visa",
  "/finance",
  "/tasks",
  "/settings",
  "/portal/legacy",
  "/preview/student",
  "/calls",
  "/chat",
  "/whatsapp",
  "/notifications",
  "/reports",
  "/api/database/status",
  "/api/webhooks/telephony",
] as const;

export function platformHomeRoute(
  actor: ActivePlatformActor,
): ReturnType<typeof staffHomeRoute> {
  return staffHomeRoute(actor);
}

/**
 * Retired routes return a hidden 404 before auth or the generic deferred-module
 * redirect. They do not route to a handler and cannot reactivate old runtime.
 */
export function isRetiredPlatformRoute(path: string): boolean {
  return RETIRED_PLATFORM_ROUTE_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

/**
 * Only the authenticated V3 product and its small system surfaces pass proxy.
 * Unknown descendants stay fail-closed with every retired or not-yet-connected
 * route.
 */
export function isConnectedPlatformPage(path: string): boolean {
  return (
    PLATFORM_STAFF_PAGE_ALLOWLIST.has(path) ||
    STAFF_UNIVERSITY_DETAIL_PATH.test(path) ||
    STAFF_UNIVERSITY_FORMS_PATH.test(path) ||
    isConnectedStudentPortalPage(path) ||
    isConnectedStudentAuthPage(path)
  );
}

/** Only implemented Student pages and bounded university/notification details. */
export function isConnectedStudentPortalPage(path: string): boolean {
  return STUDENT_PORTAL_PAGE_ALLOWLIST.has(path) || STUDENT_UNIVERSITY_DETAIL_PATH.test(path)
    || STUDENT_NOTIFICATION_DETAIL_PATH.test(path);
}

/** Auth-only invite surfaces; none grants Student or staff product authority. */
export function isConnectedStudentAuthPage(path: string): boolean {
  return STUDENT_AUTH_PAGE_ALLOWLIST.has(path);
}

/** Student-only document APIs are connected only for their one exact method. */
export function isConnectedStudentPortalApi(
  path: string,
  method: string,
): boolean {
  return (
    (method === "POST" && STUDENT_DOCUMENT_VERSION_UPLOAD_PATH.test(path))
    || (method === "GET" && STUDENT_DOCUMENT_DOWNLOAD_PATH.test(path))
  );
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
 * These exact service-to-service routes own their HMAC, trusted-edge key or disabled-state
 * checks. They must bypass the staff-cookie refresh flow while still staying
 * in the connected Platform boundary.
 */
export function isConnectedPlatformPrivateApi(path: string): boolean {
  return PLATFORM_PRIVATE_API_ALLOWLIST.has(path) || path === "/api/public/website-leads";
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
    PRIVATE_COMPANY_FILE_VERSION_UPLOAD_PATH.test(path) ||
    PRIVATE_COMPANY_FILE_DOWNLOAD_PATH.test(path) ||
    DOCUMENT_RECOGNITION_JOBS_PATH.test(path) ||
    DOCUMENT_EXPORT_PATH.test(path) ||
    UNIVERSITY_TEMPLATE_SOURCE_PATH.test(path) ||
    isConnectedPlatformPrivateApi(path)
  );
}
