import { QueueViewTabs } from "@/components/staff/queue/QueueViewTabs";

export type FinanceTabKey = "sales" | "finance" | "debts";
export const FINANCE_TAB_LABEL: Readonly<Record<FinanceTabKey, string>> = {
  sales: "Отчёт продаж",
  finance: "Финансовый отчёт",
  debts: "Долги студентов",
};
export const financeTabHref = (key: FinanceTabKey): string => `/finance?tab=${key}`;

/**
 * Ряд вкладок страницы «Финансы»: настоящие ссылки `/finance?tab=…` с `aria-current` (их можно переслать, «Назад» работает). Вкладку,
 * которой у человека нет, не передают: у продажника ряд — одна вкладка «Отчёт продаж», ссылки на финансовые вкладки в странице нет.
 */
export function FinanceTabs({ tabs, current }: Readonly<{ tabs: readonly FinanceTabKey[]; current: FinanceTabKey }>) {
  return (
    <QueueViewTabs
      label="Разделы «Финансов»"
      tabs={tabs.map((key) => ({ key, label: FINANCE_TAB_LABEL[key], href: financeTabHref(key), count: null, current: key === current }))}
    />
  );
}
