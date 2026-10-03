import "server-only";

/**
 * The owner's switch for the receive path. The inbound WAHA route does nothing
 * unless it is exactly "1", and the status shown to staff says so plainly even
 * when the WhatsApp session itself is working: a staged setup (secret and
 * session in place, intake still off) is valid, but it must never look live.
 */
export function isPlatformWahaIngressEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.EVO_PLATFORM_WAHA_INGRESS_ENABLED === "1";
}
