import { notFound } from "next/navigation";

import { isPlatformP7AAuditEnabled } from "@/lib/platform-audit-config";
import {
  isConnectedPlatformAuditSettingsRequest,
  isConnectedPlatformStaffSettingsRequest,
} from "@/lib/platform-route-contract";
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
    // Staff administration is not behind a feature flag. It is the only way to
    // give the team access after a release, so a disabled-by-default switch
    // would withhold the screen exactly when it is needed. Authorization is
    // still enforced: the page itself requires an Admin actor.
    if (isConnectedPlatformStaffSettingsRequest("/settings", exactQuery)) {
      const { default: PlatformStaffSettingsPage } = await import(
        "./PlatformStaffSettingsPage"
      );
      return <PlatformStaffSettingsPage searchParams={params} />;
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

  const { renderLegacySettingsPage } = await import("./LegacySettingsPage");
  return renderLegacySettingsPage({
    searchParams: Promise.resolve(params),
  });
}
