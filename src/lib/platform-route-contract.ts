const PLATFORM_PAGE_ALLOWLIST = new Set([
  "/",
  "/login",
  "/register",
  "/platform-pending",
  "/whatsapp",
]);
const PLATFORM_CONVERSATION_PATH =
  /^\/whatsapp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only routes backed by the greenfield Platform data plane may pass proxy.
 * A conversation route is one exact UUID segment; prefixes and descendants
 * stay fail-closed with every legacy or not-yet-connected route.
 */
export function isConnectedPlatformPage(path: string): boolean {
  return (
    PLATFORM_PAGE_ALLOWLIST.has(path) ||
    PLATFORM_CONVERSATION_PATH.test(path)
  );
}
