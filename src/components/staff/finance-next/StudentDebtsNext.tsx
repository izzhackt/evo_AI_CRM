"use client";

import Link from "next/link";

import { DataTable, EmptyState, WidgetCard, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { StudentDebtRow, StudentDebtsRead } from "@/lib/student-debts-contract";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
/** «120 000 KGS» как записано: сумма в минимальных единицах и её валюта, без пересчёта. */
const amount = (minor: number, currency: string) => `${number.format(minor / 100)} ${currency}`;
const caseHref = (id: string) => `/profile?case=${encodeURIComponent(id)}`;

function buildColumns(): DataTableColumn<StudentDebtRow>[] {
  const money = (id: string, header: string, value: (row: StudentDebtRow) => number, strong = false): DataTableColumn<StudentDebtRow> => ({
    id, header, accessorFn: value, meta: { align: "end", label: header },
    cell: ({ row }) => <span className={`block truncate tabular-nums ${strong ? "font-medium text-danger" : ""}`}>{amount(value(row.original), row.original.currency)}</span>,
  });
  return [
    {
      id: "student", header: "Студент", accessorFn: (row) => row.studentName, meta: { mobile: "title", opensRow: true }, enableHiding: false,
      cell: ({ row }) => (
        <span className="grid min-w-0 max-w-56 gap-0.5">
          <Link href={caseHref(row.original.caseId)} className="block truncate underline-offset-4 hover:underline" title={row.original.studentName}>{row.original.studentName}</Link>
          {row.original.hasOtherCurrencyPayments ? <span className="block truncate t-meta text-fg-2" data-debt-other-currency="" title="Эти оплаты в долг этой строки не вычитаются">есть оплаты в другой валюте</span> : null}
        </span>
      ),
    },
    money("debt", "Долг", (row) => row.debtMinor, true),
    money("cost", "Стоимость договора", (row) => row.costMinor),
    money("paid", "Оплачено", (row) => row.paidMinor),
    {
      id: "direction", header: "Страна · направление", accessorFn: (row) => `${row.country} ${row.direction ?? ""}`, meta: { label: "Страна · направление", mobile: "hide" },
      cell: ({ row }) => <span className="block max-w-56 truncate text-fg-2">{[row.original.country, row.original.direction].filter(Boolean).join(" · ") || "—"}</span>,
    },
    {
      id: "curator", header: "Куратор", accessorFn: (row) => row.curator ?? "", meta: { label: "Куратор", mobile: "hide" },
      cell: ({ row }) => <span className="block max-w-48 truncate text-fg-2">{row.original.curator ?? "Не назначен"}</span>,
    },
  ];
}

const COLUMNS = buildColumns();

/** Как считается долг, простыми словами: то же правило, что у блока «Оплата … остаток» в карточке студента. */
export const DEBT_RULE = "Долг = стоимость договора минус оплачено. Считаются только договорные взносы EVO (сторонние расходы и убранные из договора взносы не входят); оплачено — платежи минус возвраты. Как в блоке «Оплата … остаток» в карточке студента. Валюты не пересчитываются: итоги отдельно по каждой валюте. Оплаты в другой валюте в долг не вычитаются, строка про них говорит.";

/**
 * «Долги студентов»: дела, где стоимость договора больше оплаченного (платежи минус возвраты), по убыванию долга. Итоги — по каждой
 * валюте отдельно, валюты не пересчитываются и не складываются. Строка ведёт в дело. Цифры читает функция базы `student_debts_v1`
 * (право «Финансы» на всю организацию), страница ничего не считает сама. Нет долгов — честное пустое состояние, а не нули.
 */
export function StudentDebtsNext({ read }: Readonly<{ read: StudentDebtsRead }>) {
  if (read.status === "denied") {
    return <div className="rounded-card border border-border bg-surface" data-testid="v3-student-debts-denied"><EmptyState title="Нет доступа к долгам студентов: нужно право «Полный просмотр финансов» на всю организацию." /></div>;
  }
  if (read.status === "unavailable") {
    return (
      <div role="alert" className="rounded-card border border-border bg-card" data-testid="v3-student-debts-unavailable">
        <EmptyState tone="danger" title="Не удалось загрузить долги студентов. Проверьте подключение и повторите." action={<Button variant="outline" asChild><Link href="/finance?tab=debts">Обновить</Link></Button>} />
      </div>
    );
  }
  const { rows, totals, truncated, caseRowCount } = read.debts;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-student-debts">
      {rows.length === 0 ? (
        <div className="rounded-card border border-border bg-card"><EmptyState title="Долгов нет." description="По всем делам оплачено не меньше стоимости договора." /></div>
      ) : (
        <>
          <WidgetCard title="Итого долг" help={DEBT_RULE}>
            <ul className="flex flex-wrap gap-x-8 gap-y-2" data-testid="student-debts-totals">
              {totals.map((total) => (
                <li key={total.currency} className="grid">
                  <span className="t-meta text-fg-3">{total.currency} · дел: {total.caseCount.toLocaleString("ru-RU")}</span>
                  <span className="t-section tabular-nums text-danger">{amount(total.debtMinor, total.currency)}</span>
                  <span className="t-meta tabular-nums text-fg-3">договоры {amount(total.costMinor, total.currency)}, оплачено {amount(total.paidMinor, total.currency)}</span>
                </li>
              ))}
            </ul>
          </WidgetCard>
          <p className="t-meta text-fg-2" data-testid="student-debts-rule">{DEBT_RULE}</p>
          <DataTable label={`Долги студентов: ${caseRowCount}`} data={rows} columns={COLUMNS} getRowId={(row) => `${row.caseId}:${row.currency}`}
            searchPlaceholder="Поиск по студенту" paginate={false} columnMenu={false} empty={<EmptyState title="Ничего не найдено." />} />
          {truncated ? <p className="t-meta text-fg-2" role="status">Показаны {rows.length.toLocaleString("ru-RU")} дел с самым большим долгом из {caseRowCount.toLocaleString("ru-RU")}; итоги выше — по всем.</p> : null}
        </>
      )}
    </div>
  );
}
