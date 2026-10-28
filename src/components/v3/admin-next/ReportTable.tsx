import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ReportStack } from "./ReportStack";

export type ReportTableRow = Readonly<{ key: string; head: ReactNode; cells: readonly ReactNode[]; testId?: string; channel?: string }>;

const STICKY = "sticky left-0 z-10 bg-card";

/**
 * Полоса фокуса области с таблицей. Область (`tabIndex=0`) лежит внутри карточки с `overflow-hidden`, которая режет полосу, вынесенную наружу
 * (общее правило рисует её снаружи), а полосу внутри области закрывает прилипший первый столбец (`z-10`). Поэтому полосу рисует сама карточка, снаружи:
 * такая же, как у остальных элементов (2 px, отступ 3 px), по всему периметру и поверх содержимого не лежит.
 */
const FOCUS_RING = "has-[>[role=region]:focus-visible]:outline-2 has-[>[role=region]:focus-visible]:outline-offset-3 has-[>[role=region]:focus-visible]:outline-focus-ring";

/**
 * Таблица показывается, пока помещается без прокрутки: ширина карточки не меньше её `minWidth`; уже — стопка `ReportStack` (урок волны 2A:
 * столбец за краем карточки на 360 и 320 никто не находил). Классы записаны целиком, чтобы Tailwind их видел; порог — ширина самой
 * обёртки (`@container`), а не окна.
 */
const FITS: Readonly<Record<string, readonly [table: string, stack: string]>> = {
  "min-w-[40rem]": ["@max-[40rem]:hidden", "@min-[40rem]:hidden"],
  "min-w-[28rem]": ["@max-[28rem]:hidden", "@min-[28rem]:hidden"],
  "min-w-[20rem]": ["@max-[20rem]:hidden", "@min-[20rem]:hidden"],
};

/**
 * Итоговая таблица отчёта (каналы × этапы): не список записей, а сводка из нескольких строк, поэтому без поиска и страниц.
 * Пока таблица помещается, она на месте (область подписана и берёт фокус с клавиатуры; первый столбец прилипает, если длинное содержимое всё же
 * раздвинет её); на узкой карточке вместо неё стопка (`ReportStack`). Числа — табличные. Строки не нажимаются: за ними нет записи.
 */
export function ReportTable({ label, columns, rows, foot, minWidth = "min-w-[40rem]", className }: Readonly<{
  label: string;
  columns: readonly string[];
  rows: readonly ReportTableRow[];
  foot?: Readonly<{ head: ReactNode; cells: readonly ReactNode[] }>;
  minWidth?: string;
  className?: string;
}>) {
  const [tableClass, stackClass] = FITS[minWidth] ?? ["", "hidden"];
  return (
    <div className={cn("@container overflow-hidden rounded-card border border-border", FOCUS_RING, className)}>
      <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto", tableClass)}>
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
                <TableHead scope="row" className={cn(STICKY, "h-auto bg-surface-2 py-3 align-top t-item text-fg")}>{foot.head}</TableHead>
                {foot.cells.map((cell, index) => <TableCell key={index} className="align-top tabular-nums">{cell}</TableCell>)}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
      <ReportStack label={label} columns={columns} rows={rows} foot={foot} className={stackClass} />
    </div>
  );
}
