import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function ClientsLoading() {
  return (
    <CanonicalQueueRouteLoading route="clients" locale={await getLocale()} />
  );
}
