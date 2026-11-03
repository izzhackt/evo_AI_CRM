import { UiKit } from "@/components/v3/ui-kit/UiKit";
import { requireV3PageActor } from "@/lib/platform-guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Набор виджетов" };

const TABS = ["overview", "history", "files"] as const;

/**
 * «Набор виджетов» (27.10.2026): все виджеты «Нового вида» на синтетических данных — для владельца. Права как у
 * «Финансов»: только настоящий администратор вне просмотра роли (`requireV3PageActor`). «Новый вид» — единственный вид (#1327), переключателя нет.
 */
export default async function UiKitPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireV3PageActor("/v3/ui-kit");
  const requested = (await searchParams).tab;
  const tab = TABS.find((key) => key === requested) ?? TABS[0];
  return <UiKit tab={tab} />;
}
