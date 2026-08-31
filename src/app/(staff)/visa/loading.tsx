import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function VisaLoading() {
  return <CanonicalQueueRouteLoading route="visa" locale={await getLocale()} />;
}
