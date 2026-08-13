type PlatformAuditEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function isPlatformP7AAuditEnabled(
  environment: PlatformAuditEnvironment = process.env,
): boolean {
  return environment.EVO_PLATFORM_P7A_AUDIT_ENABLED === "1";
}
