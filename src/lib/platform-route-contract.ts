const PLATFORM_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/register",
  "/platform-pending",
  "/sales",
  "/clients",
  "/applications",
  "/whatsapp",
]);
const PLATFORM_CONVERSATION_PATH =
  /^\/whatsapp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_CLIENT_PATH =
  /^\/clients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_APPLICATION_PATH =
  /^\/applications\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
