import { StatTile } from "@/components/kit";

import type { SalesHeadlineData } from "./sales-next-types";

const NOTE_LINK = "inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Продажи» периода плитками: число по дате продажи (без архива) и план с остатком. Что в число не входит и где это смотреть
 * (записи без даты, с датой в другом месяце, из другого месяца отчёта) остаётся на виду ссылками на записи среза: число и таблица
 * считаются по-разному, и это сказано. Чтение не удалось — так и сказано, с «Повторить».
 */
export function SalesHeadlineTiles({ data }: Readonly<{ data: SalesHeadlineData }>) {
  if (data.kind === "error") {
    return (
      <p role="alert" className="t-body-compact text-fg-2" data-testid="v3-sales-headline">
        {data.text}{" "}
        <a href={data.retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
      </p>
    );
  }
  return (
    <div className="grid gap-2" data-testid="v3-sales-headline" data-sales={data.sales}>
      <div className="grid grid-cols-2 gap-3 md:max-w-xl">
        <StatTile label="Продажи" value={data.sales.toLocaleString("ru-RU")} hint={data.basis} />
        {data.target !== null ? <StatTile label="План" value={data.target.toLocaleString("ru-RU")} hint={data.left ?? undefined} /> : null}
      </div>
      {data.notes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 t-meta text-fg-3" data-testid="v3-sales-headline-notes">
          {data.notes.map((note) => (
            <p key={note.lead} className="flex flex-wrap items-center gap-x-3">
              {note.lead}
              {note.links.map((link) => link.href
                ? <a key={link.text} href={link.href} className={NOTE_LINK}>{link.text}</a>
                : <span key={link.text}>{link.text}</span>)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
