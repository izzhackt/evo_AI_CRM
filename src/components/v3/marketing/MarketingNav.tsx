import { MainHeader, type PeriodChoice } from "@/components/v3/MainHeader";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import type { MarketingLeadFilters } from "@/lib/marketing-contract";
import { marketingHref, MARKETING_VIEWS, type MarketingView } from "@/lib/marketing-view";
import { PERIODS, type Period } from "@/lib/v3/funnel-source";
import { marketingLeadFilterParams } from "@/lib/marketing-contract";

/**
 * Вкладки раздела («Обзор · Заявки · Отчёты») и период — настоящие ссылки с адресом. Фильтры списка живут в
 * адресе ключами и датами, имён и телефонов там нет; смена периода их сохраняет. «Отчёты» (отчёт Looker Studio) есть
 * только при подключённой ссылке (`reports`), на этом виде нет выбора периода: даты выбираются внутри отчёта.
 */
export function MarketingNav({ view, period, filters, reports }: Readonly<{ view: MarketingView; period: Period; filters: MarketingLeadFilters; reports: boolean }>) {
  const custom = period.key === "custom" ? { key: "custom", from: period.from, to: period.to } : null;
  const choices: PeriodChoice[] = PERIODS.map((one) => ({
    key: one.key,
    title: one.title,
    href: marketingHref({ view, period: one.key === "custom" && custom ? custom : { key: one.key }, filters }),
    active: one.key === period.key,
  }));
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <QueueViewTabs
        label="Разделы маркетинга"
        tabs={MARKETING_VIEWS.filter((tab) => tab.key !== "reports" || reports).map((tab) => ({
          key: tab.key, label: tab.title, count: null, current: tab.key === view,
          href: marketingHref({ view: tab.key, period: custom ?? { key: period.key }, filters }),
        }))}
      />
      {view === "reports" ? null : (
        <MainHeader
          choices={choices}
          range={period.key === "custom" ? { from: period.from, to: period.to, max: period.today } : null}
          action="/v3/marketing"
          hidden={{ ...(view === "leads" ? { view: "leads" } : {}), ...(view === "leads" ? marketingLeadFilterParams(filters) : {}) }}
        />
      )}
    </div>
  );
}
