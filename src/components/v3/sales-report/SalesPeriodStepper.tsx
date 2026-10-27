import Link from "next/link";

import { Icon } from "@/components/icons";
import type { salesPeriodSteps } from "@/lib/sales-register-view";

import { FilterMenu } from "../queue/FilterMenu";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/**
 * Переключатель периода «Отчёта продаж» «‹ Сентябрь 2026 ›»: предыдущий и следующий месяц (год) ссылками, меню месяца. Общий у
 * прежнего вида и «Нового вида» (вынесен из `SalesRegisterView.tsx` без изменений разметки).
 */
export function SalesPeriodStepper({ year, month, steps, periodHref }: Readonly<{
  year: number;
  month: number | undefined;
  steps: ReturnType<typeof salesPeriodSteps>;
  periodHref: (year: number, month: number | undefined) => string;
}>) {
  return (
      <div role="group" aria-label="Период отчёта" className="flex items-center" data-testid="sales-period-stepper">
        <Link href={periodHref(steps.previous.year, steps.previous.month)} scroll={false}
          aria-label={month ? "Предыдущий месяц" : "Предыдущий год"}
          className="flex size-11 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg">
          <Icon name="chevron-right" size={18} className="rotate-180" />
        </Link>
        <FilterMenu label={month ? `${MONTHS[month - 1]} ${year}` : `${year} год`} valueLabel={null}
          options={[
            ...MONTHS.map((title, index) => ({ key: String(index + 1), label: `${title} ${year}`, href: periodHref(year, index + 1), selected: month === index + 1 })),
            { key: "all", label: `Весь ${year} год`, href: periodHref(year, undefined), selected: month === undefined },
          ]} />
        <Link href={periodHref(steps.next.year, steps.next.month)} scroll={false}
          aria-label={month ? "Следующий месяц" : "Следующий год"}
          className="flex size-11 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg">
          <Icon name="chevron-right" size={18} />
        </Link>
      </div>
  );
}
