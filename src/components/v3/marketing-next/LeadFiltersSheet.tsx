"use client";

import { SlidersHorizontalIcon } from "lucide-react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { LEAD_CHANNELS } from "@/lib/lead-channel-contract";
import { MARKETING_STAGES, type MarketingLeadFilters } from "@/lib/marketing-contract";
import { SALES_STAGE_TITLE } from "@/lib/v3/wording";

const STAGE_TITLES: Readonly<Record<string, string>> = { ...SALES_STAGE_TITLE, closed: "Закрыт" };

/**
 * Фильтры «Заявок» в панели: обычная GET-форма, как раньше — в адресе только ключи и даты, имён и телефонов там нет. Период
 * форма несёт скрытыми полями. «Сбросить» видна, когда что-то выбрано.
 */
export function LeadFiltersSheet({ period, filters, clearHref }: Readonly<{
  period: Readonly<{ key: string; from: string; to: string }>;
  filters: MarketingLeadFilters;
  clearHref: string;
}>) {
  const active = Object.values(filters).filter((value) => value !== null && value !== false).length;
  return (
    <DetailSheet
      title="Фильтры заявок"
      trigger={<Button variant="outline"><SlidersHorizontalIcon aria-hidden="true" />Фильтры{active ? ` · ${active}` : ""}</Button>}
    >
      <form method="get" action="/v3/marketing" aria-label="Фильтры заявок" className="grid gap-4">
        <input type="hidden" name="view" value="leads" />
        {period.key !== "month" ? <input type="hidden" name="period" value={period.key} /> : null}
        {period.key === "custom" ? <><input type="hidden" name="from" value={period.from} /><input type="hidden" name="to" value={period.to} /></> : null}
        <div className="grid gap-1.5"><Label htmlFor="mk-channel">Откуда узнал</Label>
          <NativeSelect id="mk-channel" name="channel" defaultValue={filters.channel ?? ""}>
            <option value="">Любой</option>{Object.entries(LEAD_CHANNELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </NativeSelect></div>
        <div className="grid gap-1.5"><Label htmlFor="mk-campaign">Кампания</Label><Input id="mk-campaign" name="campaign" maxLength={100} defaultValue={filters.campaign ?? ""} /></div>
        <div className="grid gap-1.5"><Label htmlFor="mk-stage">Этап</Label>
          <NativeSelect id="mk-stage" name="stage" defaultValue={filters.stage ?? ""}>
            <option value="">Любой</option>{MARKETING_STAGES.map((key) => <option key={key} value={key}>{STAGE_TITLES[key]}</option>)}
          </NativeSelect></div>
        <div className="grid gap-1.5"><Label htmlFor="mk-contract">Договор</Label>
          <NativeSelect id="mk-contract" name="contract" defaultValue={filters.hasContract === null ? "" : filters.hasContract ? "yes" : "no"}>
            <option value="">Любой</option><option value="yes">Есть договор</option><option value="no">Договора нет</option>
          </NativeSelect></div>
        <label className="flex min-h-11 items-center gap-3 t-label text-fg-2"><input type="checkbox" name="unknown" value="1" defaultChecked={filters.unknownOnly} className="size-[18px] accent-fg" />Источник не известен</label>
        <label className="flex min-h-11 items-center gap-3 t-label text-fg-2"><input type="checkbox" name="no_owner" value="1" defaultChecked={filters.noOwner} className="size-[18px] accent-fg" />Без ответственного</label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline">Применить</Button>
          {active ? <Button variant="ghost" asChild><a href={clearHref}>Сбросить</a></Button> : null}
        </div>
      </form>
    </DetailSheet>
  );
}
