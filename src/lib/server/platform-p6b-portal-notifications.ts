import "server-only";

type P6BPortalNotificationsEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Keeps the durable P6B portal notification lane fail-closed. A configured
 * Supabase project alone must never activate new mutations or subscriptions.
 */
export function isPlatformP6BPortalNotificationsEnabled(
  environment: P6BPortalNotificationsEnvironment = process.env,
): boolean {
  return environment.EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED === "1";
}
