import { notFound } from "next/navigation";

import { isPlatformP7AAuditEnabled } from "@/lib/platform-audit-config";
import { isConnectedPlatformAuditSettingsRequest } from "@/lib/platform-route-contract";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

type SettingsSearchParams = Record<string, string | string[] | undefined>;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const params = await searchParams;
  if (!isUiContractFixtureMode()) {
    const exactQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) exactQuery.append(key, item);
      } else if (value !== undefined) {
        exactQuery.append(key, value);
      }
    }
    if (
      !isPlatformP7AAuditEnabled() ||
      !isConnectedPlatformAuditSettingsRequest("/settings", exactQuery)
    ) {
      notFound();
    }
    const { default: PlatformAuditSettingsPage } = await import(
      "./PlatformAuditSettingsPage"
    );
    return <PlatformAuditSettingsPage searchParams={params} />;
  }

  const { default: LegacySettingsPage } = await import("./LegacySettingsPage");
  return <LegacySettingsPage searchParams={Promise.resolve(params)} />;
}
