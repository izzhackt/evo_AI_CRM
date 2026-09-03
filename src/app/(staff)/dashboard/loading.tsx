import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function PlatformDashboardLoading() {
  return (
    <CanonicalQueueRouteLoading route="dashboard" locale={await getLocale()} />
  );
}
