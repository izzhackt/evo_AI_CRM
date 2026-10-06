import { LEAD_CHANNELS } from "@/lib/lead-channel-contract";
import { MARKETING_STAGES, type MarketingLeadFilters, type MarketingLeadsRead } from "@/lib/marketing-contract";
import { marketingHref } from "@/lib/marketing-view";
import { btnGhostCls, fieldLabelCls, inputCls } from "@/components/ui";
import { SALES_STAGE_TITLE } from "@/lib/v3/wording";
import { MarketingLeadsTable } from "./MarketingLeadsTable";

const STAGE_FILTER_TITLES: Readonly<Record<string, string>> = { ...SALES_STAGE_TITLE, closed: "Закрыт" };

/**
 * «Заявки» раздела: кто пришёл, откуда и что с ним стало. Фильтры — обычная GET-форма: в адресе только
 * ключи и даты, имён и телефонов там нет. Список с именами читает только администратор; в строке нет
 * переписок, заметок, документов, данных дела и куратора; экспорта нет.
 */
export function MarketingLeadsView({ read, period, filters, retryHref }: Readonly<{
  read: MarketingLeadsRead;
  period: Readonly<{ key: string; from: string; to: string }>;
  filters: MarketingLeadFilters;
  retryHref: string;
}>) {
  const clear = marketingHref({ view: "leads", period: period.key === "custom" ? period : { key: period.key } });
  const filtered = Object.values(filters).some((value) => value !== null && value !== false);
  return (
    <div className="space-y-4" data-testid="marketing-leads">
      <form method="get" action="/v3/marketing" className="grid gap-3 rounded-card border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Фильтры заявок">
        <input type="hidden" name="view" value="leads" />
        {period.key !== "month" ? <input type="hidden" name="period" value={period.key} /> : null}
        {period.key === "custom" ? <><input type="hidden" name="from" value={period.from} /><input type="hidden" name="to" value={period.to} /></> : null}
        <label><span className={fieldLabelCls}>Откуда узнал</span>
          <select name="channel" defaultValue={filters.channel ?? ""} className={inputCls}>
            <option value="">Любой</option>{Object.entries(LEAD_CHANNELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        <label><span className={fieldLabelCls}>Кампания</span>
          <input name="campaign" maxLength={100} defaultValue={filters.campaign ?? ""} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Этап</span>
          <select name="stage" defaultValue={filters.stage ?? ""} className={inputCls}>
            <option value="">Любой</option>{MARKETING_STAGES.map((key) => <option key={key} value={key}>{STAGE_FILTER_TITLES[key]}</option>)}
          </select></label>
        <label><span className={fieldLabelCls}>Договор</span>
          <select name="contract" defaultValue={filters.hasContract === null ? "" : filters.hasContract ? "yes" : "no"} className={inputCls}>
            <option value="">Не важно</option><option value="yes">Есть договор</option><option value="no">Договора нет</option>
          </select></label>
        <label className="flex min-h-11 items-center gap-2 t-label text-fg-2"><input type="checkbox" name="unknown" value="1" defaultChecked={filters.unknownOnly} className="size-4" />Источник не известен</label>
        <label className="flex min-h-11 items-center gap-2 t-label text-fg-2"><input type="checkbox" name="no_owner" value="1" defaultChecked={filters.noOwner} className="size-4" />Без ответственного</label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className={btnGhostCls}>Применить</button>
          {filtered ? <a href={clear} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">Сбросить</a> : null}
        </div>
      </form>
      {read.status === "denied" ? <p role="alert" className="t-body-compact text-fg-2">Раздел доступен только администратору.</p> : null}
      {read.status === "unavailable" ? (
        <p role="alert" className="t-body-compact text-fg-2">
          Не удалось загрузить заявки.{" "}
          <a href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
        </p>
      ) : null}
      {read.status === "available"
        ? <MarketingLeadsTable key={JSON.stringify([period.from, period.to, filters])} initial={read.page} request={{ from: period.from, to: period.to, filters }} />
        : null}
    </div>
  );
}
