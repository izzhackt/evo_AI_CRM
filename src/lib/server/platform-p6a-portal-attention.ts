import "server-only";

type PlatformP6APortalAttentionEnvironment = Readonly<
  Record<string, string | undefined>
>;

type PortalNextActionSeverity = "normal" | "warning" | "urgent";

export function isPlatformP6APortalAttentionEnabled(
  environment: PlatformP6APortalAttentionEnvironment = process.env,
): boolean {
  return environment.EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED === "1";
}

export function shouldShowPortalNextActionForP6A(
  action: Readonly<{
    labelKey: string;
    severity: PortalNextActionSeverity;
  }>,
  p6aEnabled: boolean,
): boolean {
  if (!p6aEnabled) return true;

  return (
    (action.labelKey === "portalNextTask" &&
      (action.severity === "warning" || action.severity === "urgent")) ||
    (action.labelKey === "portalNextDocument" && action.severity === "urgent") ||
    (action.labelKey === "portalNextOverduePayment" && action.severity === "urgent")
  );
}
