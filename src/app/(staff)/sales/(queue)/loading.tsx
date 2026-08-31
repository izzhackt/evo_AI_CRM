import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function SalesLoading() {
  return <CanonicalQueueRouteLoading route="sales" locale={await getLocale()} />;
}
