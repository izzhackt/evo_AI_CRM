import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function ApplicationsLoading() {
  return (
    <CanonicalQueueRouteLoading route="applications" locale={await getLocale()} />
  );
}
