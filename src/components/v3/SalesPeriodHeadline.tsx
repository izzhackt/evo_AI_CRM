import Link from "next/link";

import type { SalesCountRead } from "@/lib/sales-numbers-contract";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** Период заголовка «Отчёта продаж»: выбранный месяц или весь год. */
export function salesHeadlinePeriod(year: number, month: number | undefined): Readonly<{ from: string; to: string; label: string }> {
  if (month === undefined) return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year} год` };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}`, label: `${MONTHS[month - 1]} ${year}` };
}

const records = (n: number) => {
  const tens = n % 100, ones = n % 10;
  const word = tens >= 11 && tens <= 14 ? "записей" : ones === 1 ? "запись" : ones >= 2 && ones <= 4 ? "записи" : "записей";
  return `${n.toLocaleString("ru-RU")} ${word}`;
};

/**
 * Заголовок «Отчёта продаж» — число «Продажи» по одному определению (Э2,
 * решение владельца 26.09.2026): записи не в архиве с датой продажи в
 * выбранном месяце или году. Таблица ниже собрана по «Месяцу отчёта»; всё,
 * чем она расходится с этим числом, названо словами, а не спрятано и не
 * угадано: записи без даты продажи, записи с датой продажи в другом месяце и
 * продажи этого периода, записанные в другой месяц отчёта. Роль без чтения
 * отчёта — ничего; чтение не удалось — так и сказано.
 */
export function SalesPeriodHeadline({ read, label, retryHref }: Readonly<{
  read: SalesCountRead;
  /** «сентябрь 2026» или «2026 год». */
  label: string;
  retryHref: string;
}>) {
  if (read.status === "denied") return null;
  if (read.status === "unavailable") {
    return (
      <p role="alert" className="mt-1 t-body-compact text-fg-2" data-testid="v3-sales-headline">
        Не удалось посчитать продажи за {label}.{" "}
        <a href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
      </p>
    );
  }
  const { sales, undated, otherSaleDate, filedElsewhere } = read.count;
  const notes = [
    undated > 0 ? `без даты продажи — ${records(undated)}` : null,
    otherSaleDate > 0 ? `дата продажи в другом месяце — ${records(otherSaleDate)}` : null,
  ].filter((note): note is string => note !== null);
  return (
    <div className="mt-1" data-testid="v3-sales-headline" data-sales={sales}>
      <p className="t-body-compact text-fg-2">
        Продажи за {label}: <strong className="text-base font-semibold tabular-nums text-fg">{sales.toLocaleString("ru-RU")}</strong>
        <span className="text-fg-3"> · по дате продажи, без архива</span>
      </p>
      {notes.length > 0 || filedElsewhere > 0 ? (
        <p className="t-meta mt-0.5 text-fg-3" data-testid="v3-sales-headline-notes">
          {notes.length > 0 ? `Не входят: ${notes.join(", ")}.` : null}
          {notes.length > 0 && filedElsewhere > 0 ? " " : null}
          {filedElsewhere > 0 ? `Входят из другого месяца отчёта: ${records(filedElsewhere)}.` : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * «Продажи за период» раздела «Динамика по дням» — то же определение, что у
 * заголовка отчёта (Э2): записи не в архиве с датой продажи в периоде.
 * Стоит отдельной строкой, а не среди чисел когорты: когорта — лиды,
 * пришедшие за период, а продажа считается по своей дате.
 */
export function SalesPeriodLine({ read, retryHref }: Readonly<{ read: SalesCountRead; retryHref: string }>) {
  if (read.status === "denied") return null;
  if (read.status === "unavailable") {
    return (
      <p role="alert" className="mt-3 t-body-compact text-fg-2" data-period-sales="">
        Не удалось посчитать продажи за период.{" "}
        <Link href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</Link>
      </p>
    );
  }
  const { sales, undated } = read.count;
  return (
    <p className="mt-3 t-body-compact text-fg-2" data-period-sales={sales}>
      Продажи за период: <strong className="text-base font-semibold tabular-nums text-fg">{sales.toLocaleString("ru-RU")}</strong>
      <span className="text-fg-3"> · по дате продажи, без архива{undated > 0 ? `; без даты продажи не посчитаны: ${records(undated)}` : ""}</span>
    </p>
  );
}
