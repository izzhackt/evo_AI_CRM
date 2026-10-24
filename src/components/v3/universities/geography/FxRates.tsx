import { Icon } from "@/components/icons";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { COST_CURRENCIES, FX_STALE_DAYS, formatRate, rateIsStale, type StaffGeography } from "@/lib/catalog-geography";

import { FxRateForm } from "./FxRateForm";

/*
 * «Курсы валют» (план 7.5): последний курс каждой валюты строк стоимости,
 * «1 USD = x», дата, источник, кто и когда внёс. Курс старше 45 дней
 * помечен словом; полоса сверху только когда что-то устарело или курса нет
 * (исправное состояние не подписывается).
 */
const ROW = "grid grid-cols-1 gap-x-3 gap-y-0.5 @min-[44rem]/rates:grid-cols-[minmax(0,10fr)_minmax(0,22fr)_minmax(0,16fr)_minmax(0,30fr)_minmax(0,22fr)] @min-[44rem]/rates:items-center";
const HEAD = "t-caption flex h-8 items-center px-2 text-start text-fg-2 first:ps-3";
const CELL = "min-w-0 px-3 @min-[44rem]/rates:px-2";
const dayText = (value: string) => value.split("-").reverse().join(".");
const stamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek" }).format(date);
};

export function FxRates({ geography, today }: Readonly<{ geography: StaffGeography; today: string }>) {
  const latest = geography.fxRates.filter((rate) => rate.latest);
  const used = new Map<string, number>();
  for (const row of geography.costs) if (row.currency !== "USD") used.set(row.currency, (used.get(row.currency) ?? 0) + (row.status === "published" ? 1 : 0));
  const missing = [...used.keys()].filter((code) => !latest.some((rate) => rate.currency === code)).sort();
  const stale = latest.filter(rateIsStale);
  const currencies = [...new Set([...COST_CURRENCIES.filter((code) => code !== "USD"), ...used.keys(), ...latest.map((rate) => rate.currency)])];
  const initial = stale[0]?.currency ?? missing[0] ?? currencies[0] ?? "CNY";
  const history = geography.fxRates.filter((rate) => !rate.latest);
  return (
    <div className="@container/rates space-y-5">
      {stale.length || missing.length ? (
        <div role="status" className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card bg-warn-weak px-4 py-2.5 text-warn" data-testid="fx-rate-warning">
          <Icon name="alert" size={18} className="mt-0.5 flex-none" />
          <ul className="min-w-0 flex-1 space-y-1">
            {stale.map((rate) => <li key={rate.currency} className="t-body-compact">Курс {rate.currency} от {dayText(rate.asOf)} старше {FX_STALE_DAYS} дней ({rate.ageDays} дн.): ориентир в USD у студентов считается по нему.</li>)}
            {missing.map((code) => <li key={code} className="t-body-compact">Нет курса {code}: студенты видят суммы в {code} без ориентира в USD.</li>)}
          </ul>
          <a className="inline-flex min-h-11 flex-none items-center t-label underline underline-offset-4" href="#fx-rate-form">Внести курс</a>
        </div>
      ) : null}
      {latest.length ? (
        <table role="table" className="block w-full" data-testid="fx-rates-table">
          <caption className="sr-only">Последний курс каждой валюты к USD</caption>
          <thead role="rowgroup" className="sr-only @min-[44rem]/rates:not-sr-only @min-[44rem]/rates:block">
            <tr role="row" className={`${ROW} border-b border-border`}>
              {["Валюта", "Курс", "Дата курса", "Источник", "У студентов"].map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
            </tr>
          </thead>
          <tbody role="rowgroup" className="block">
            {latest.map((rate) => (
              <tr key={rate.currency} role="row" data-fx-row={rate.currency} data-fx-stale={rateIsStale(rate) ? "" : undefined} className={`${ROW} border-b border-border py-2`}>
                <th role="rowheader" scope="row" className={`${CELL} text-start t-item text-fg @min-[44rem]/rates:ps-3`}>{rate.currency}</th>
                <td role="cell" className={`${CELL} t-body-compact tabular-nums text-fg`}>{formatRate(rate)}</td>
                <td role="cell" className={`${CELL} t-body-compact`}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <time className="font-mono tabular-nums text-fg" dateTime={rate.asOf}>{dayText(rate.asOf)}</time>
                    {rateIsStale(rate) ? <StatusChip label={`Устарел: ${rate.ageDays} дн.`} tone="warn" /> : <span className="t-meta text-fg-3">{rate.ageDays} дн. назад</span>}
                  </span>
                </td>
                <td role="cell" className={`${CELL} t-body-compact text-fg-2`}>
                  {/* Название источника записано как есть (полное название ЕЦБ или ЦБ ОАЭ): две строки, целиком в подсказке. */}
                  {rate.sourceUrl ? <span className="flex min-h-11 items-center"><a className="line-clamp-2 underline underline-offset-4 [overflow-wrap:anywhere] hover:text-fg" title={rate.sourceName} href={rate.sourceUrl} target="_blank" rel="noopener noreferrer">{rate.sourceName}<span className="sr-only"> (в новой вкладке)</span></a></span> : <span className="line-clamp-2" title={rate.sourceName}>{rate.sourceName}</span>}
                  <span className="block t-meta text-fg-3">Внесён {stamp(rate.setAt)}</span>
                </td>
                <td role="cell" className={`${CELL} t-body-compact tabular-nums text-fg-2`}><span className="@min-[44rem]/rates:sr-only">Строк стоимости у студентов: </span>{used.get(rate.currency) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="rounded-card border border-border bg-surface px-4 py-5 t-body-compact text-fg-2">Курсов пока нет: студенты видят суммы только в валюте вуза.</p>}
      <FxRateForm currencies={currencies} latest={latest} initialCurrency={initial} today={today} />
      {history.length ? (
        <details className="rounded-card border border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 t-label text-fg-2 hover:text-fg">Прежние курсы <span className="ms-2 tabular-nums text-fg-3">{history.length}</span></summary>
          <ul className="divide-y divide-border border-t border-border">
            {history.map((rate) => (
              <li key={`${rate.currency}:${rate.asOf}`} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2 t-body-compact text-fg-2">
                <span className="tabular-nums text-fg">{formatRate(rate)}</span>
                <span><time className="font-mono tabular-nums" dateTime={rate.asOf}>{dayText(rate.asOf)}</time> · {rate.sourceName}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
