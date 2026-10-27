import { EmptyState } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { UiKit } from "@/components/v3/ui-kit/UiKit";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";

export const dynamic = "force-dynamic";
export const metadata = { title: "Набор виджетов" };

const TABS = ["overview", "history", "files"] as const;

/**
 * «Набор виджетов» (27.10.2026): все виджеты «Нового вида» на синтетических данных — для владельца. Права как у
 * «Финансов»: только настоящий администратор вне просмотра роли (`requireV3PageActor`). Показывается, когда
 * переключатель «Новый вид» включён; иначе — строка о том, как его включить (токены вида без него не заданы).
 */
export default async function UiKitPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const actor = await requireV3PageActor("/v3/ui-kit");
  if (!(await isNextUi(actor))) {
    return (
      <PartShell title="Набор виджетов" testId="v3-ui-kit-off">
        <div className="rounded-card border border-border bg-surface">
          <EmptyState text="Включите «Новый вид»: переключатель внизу меню, на телефоне — в «Ещё»." />
        </div>
      </PartShell>
    );
  }
  const requested = (await searchParams).tab;
  const tab = TABS.find((key) => key === requested) ?? TABS[0];
  return <UiKit tab={tab} />;
}
