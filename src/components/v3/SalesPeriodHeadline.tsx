import Link from "next/link";

import type { SalesCountRead } from "@/lib/sales-numbers-contract";
import type { SalesSaleSlice } from "@/lib/sales-register-navigation";

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

const NOTE_LINK = "inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Заголовок «Отчёта продаж» — число «Продажи» по одному определению (Э2,
 * решение владельца 26.09.2026): записи не в архиве с датой продажи в
 * выбранном месяце или году. Таблица ниже собрана по «Месяцу отчёта»; всё,
 * чем она расходится с этим числом, названо словами и ведёт в таблицу к
 * этим записям (`sale=<срез>`, `read_sales_register_v3`): записи без даты
 * продажи, записи с датой продажи в другом месяце и продажи этого периода,
 * записанные в другой месяц отчёта. Число не зависит от фильтров строк — при
 * фильтрах это сказано («без фильтров»), чтобы его не сверяли с «Найдено по
 * фильтрам». Роль без чтения отчёта — ничего; чтение не удалось — так и сказано.
 */
export function SalesPeriodHeadline({ read, label, retryHref, filtered = false, sliceHref }: Readonly<{
  read: SalesCountRead;
  /** «сентябрь 2026» или «2026 год». */
  label: string;
  retryHref: string;
  /** Таблица под заголовком сужена фильтрами строк (менеджер, направление, поиск…). */
  filtered?: boolean;
  /** Ссылка на записи среза в том же периоде; без неё — только слова. */
  sliceHref?: (slice: SalesSaleSlice) => string;
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
  const note = (slice: SalesSaleSlice, text: string) => sliceHref
    ? <a key={slice} href={sliceHref(slice)} className={NOTE_LINK} data-sale-slice={slice}>{text}</a>
    : <span key={slice}>{text}</span>;
  const notIn = [
    undated > 0 ? note("undated", `без даты продажи — ${records(undated)}`) : null,
    otherSaleDate > 0 ? note("other_sale_date", `дата продажи в другом месяце — ${records(otherSaleDate)}`) : null,
  ].filter((item) => item !== null);
  return (
    <div className="mt-1" data-testid="v3-sales-headline" data-sales={sales}>
      <p className="t-body-compact text-fg-2">
        Продажи за {label}: <strong className="text-base font-semibold tabular-nums text-fg">{sales.toLocaleString("ru-RU")}</strong>
        <span className="text-fg-3"> · по дате продажи, без архива{filtered ? " и без фильтров" : ""}</span>
      </p>
      {notIn.length > 0 || filedElsewhere > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 t-meta text-fg-3" data-testid="v3-sales-headline-notes">
          {notIn.length > 0 ? <p className="flex flex-wrap items-center gap-x-3">Не входят: {notIn}</p> : null}
          {filedElsewhere > 0 ? (
            <p className="flex flex-wrap items-center gap-x-3">
              Входят из другого месяца отчёта: {note("filed_elsewhere", records(filedElsewhere))}
            </p>
          ) : null}
        </div>
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
