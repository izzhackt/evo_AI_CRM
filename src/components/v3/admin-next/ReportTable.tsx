import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ReportTableRow = Readonly<{ key: string; head: ReactNode; cells: readonly ReactNode[]; testId?: string; channel?: string }>;

const STICKY = "sticky left-0 z-10 bg-card";

/**
 * Итоговая таблица отчёта (каналы × этапы): не список записей, а сводка из нескольких строк, поэтому без поиска и страниц.
 * Узко прокручивается вбок, первый столбец остаётся на месте; прокручиваемая область подписана и берёт фокус с клавиатуры.
 * Числа — табличные. Строки не нажимаются: за ними нет записи, которую можно открыть.
 */
export function ReportTable({ label, columns, rows, foot, minWidth = "min-w-[40rem]", className }: Readonly<{
  label: string;
  columns: readonly string[];
  rows: readonly ReportTableRow[];
  foot?: Readonly<{ head: ReactNode; cells: readonly ReactNode[] }>;
  minWidth?: string;
  className?: string;
}>) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto rounded-card border border-border", className)}>
      <Table className={minWidth}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column, index) => (
              <TableHead key={column} scope="col" className={cn(index === 0 && STICKY)}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} data-channel={row.channel} data-testid={row.testId} className="hover:bg-transparent">
              <TableHead scope="row" className={cn(STICKY, "h-auto min-w-40 whitespace-normal py-3 align-top t-item text-fg")}>{row.head}</TableHead>
              {row.cells.map((cell, index) => <TableCell key={index} className="align-top tabular-nums">{cell}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
        {foot ? (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="row" className={cn(STICKY, "bg-surface-2 t-item text-fg")}>{foot.head}</TableHead>
              {foot.cells.map((cell, index) => <TableCell key={index} className="align-top tabular-nums">{cell}</TableCell>)}
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}
