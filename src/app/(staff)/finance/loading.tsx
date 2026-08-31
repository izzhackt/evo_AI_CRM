import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function FinanceLoading() {
  return <CanonicalQueueRouteLoading route="finance" locale={await getLocale()} />;
}
