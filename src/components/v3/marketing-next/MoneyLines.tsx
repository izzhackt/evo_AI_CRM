import { formatMinor } from "@/lib/marketing-view";
import type { MoneyCount } from "@/lib/marketing-contract";

/** Суммы по валютам, одна строка на валюту: «1 200 USD · 3 договора». Валюты не складываются. */
export function MoneyLines({ items, noun, primary = false }: Readonly<{ items: readonly MoneyCount[]; noun: (count: number) => string; primary?: boolean }>) {
  return (
    <>
      {items.map((item) => (
        <span key={item.currency} className={primary ? "block t-body-compact text-fg" : "block t-meta text-fg-3"}>
          {formatMinor(item.amountMinor, item.currency)}<span className="text-fg-3"> · {noun(item.count)}</span>
        </span>
      ))}
    </>
  );
}
