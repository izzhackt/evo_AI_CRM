import { CanonicalQueueRouteLoading } from "@/components/platform/core/CanonicalQueueRouteLoading";
import { getLocale } from "@/lib/i18n";

export default async function TasksLoading() {
  return <CanonicalQueueRouteLoading route="tasks" locale={await getLocale()} />;
}
