import { cn } from "@/lib/utils";

/** Один блок стопки: валюта (или пара валют) и её значения «подпись — число». */
export type CurrencyStackBlock = Readonly<{
  key: string;
  head: React.ReactNode;
  /** Всплывающее и скрытое пояснение к заголовку блока (у пары валют). */
  title?: string;
  sr?: string;
  items: readonly Readonly<{ label: string; value: React.ReactNode; tone?: "strong" | "medium" | "muted"; sr?: string }>[];
}>;

/**
 * Суммы по валютам для узкого блока (меньше 34rem): каждая валюта — блок «подпись — число», числа не режутся краем карточки. Широкая таблица
 * (`Table` рядом) на узком экране обрезала последний столбец («Итого», «Остаток») и не говорила, что его можно прокрутить: жирное «11»
 * на краю читалось как значение. Родитель — `@container`: стопка видна, пока он уже 34rem, и скрывается, когда помещается таблица.
 */
export function SalesCurrencyStack({ label, testId, blocks }: Readonly<{ label: string; testId: string; blocks: readonly CurrencyStackBlock[] }>) {
  return (
    <ul aria-label={label} data-testid={testId} className="grid min-w-0 gap-2 @min-[34rem]:hidden">
      {blocks.map((block) => (
        <li key={block.key} data-stack-key={block.key} className="grid min-w-0 gap-1 rounded-card border border-border px-3 py-2">
          <p className={cn("t-item min-w-0 text-fg", block.sr && "font-normal text-fg-2")} title={block.title}>
            {block.head}
            {block.sr ? <span className="sr-only">{block.sr}</span> : null}
          </p>
          <dl className="grid min-w-0 gap-0.5">
            {block.items.map((item) => (
              <div key={item.label} className="flex min-w-0 items-baseline justify-between gap-3">
                <dt className="t-meta min-w-0 text-fg-3">{item.label}</dt>
                <dd className={cn("m-0 text-right tabular-nums", item.tone === "strong" && "font-semibold", item.tone === "medium" && "font-medium", item.tone === "muted" && "text-fg-3")}>
                  {item.value}
                  {item.sr ? <span className="sr-only">{item.sr}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
