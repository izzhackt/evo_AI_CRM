import { PageShell } from "@/components/kit";
import { KitBasics } from "./KitBasics";
import { KitTable } from "./KitTable";
import { KitWidgets } from "./KitWidgets";

/** Страница «Набор виджетов»: каждый виджет «Нового вида» на синтетических данных — владельцу посмотреть. */
export function UiKit({ tab }: Readonly<{ tab: string }>) {
  return (
    <PageShell
      title="Набор виджетов"
      testId="v3-ui-kit"
      help="Из этих блоков собираются экраны «Нового вида». Данные здесь выдуманные. Правила — в DESIGN.md, раздел «Новый вид: набор виджетов»."
    >
      <KitWidgets tab={tab} />
      <KitBasics />
      <KitTable />
    </PageShell>
  );
}
