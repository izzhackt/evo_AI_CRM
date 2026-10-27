"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { PAGE_SIZES } from "@/components/kit/data-table-core";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * «11–20 из 57», размер страницы и стрелки. Одна страница — полосы нет (нечего листать). Общее число неизвестно
 * (`totalKnown = false`, данные неполные) — «11–20» без «из N».
 */
export function DataTablePagination({
  total,
  totalKnown = true,
  pageIndex,
  pageSize,
  pageCount,
  onPageSize,
  onPrevious,
  onNext,
}: Readonly<{
  total: number;
  totalKnown?: boolean;
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  onPageSize: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  if (total <= PAGE_SIZES[0]) return null;
  const from = pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-slot="data-table-pagination">
      <p className="t-body-compact tabular-nums text-fg-2" aria-live="polite">
        {from}–{to}{totalKnown ? ` из ${total}` : ""}
      </p>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => onPageSize(Number(value))}>
          <SelectTrigger aria-label="Строк на странице" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={onPrevious} disabled={pageIndex <= 0} aria-label="Предыдущая страница">
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" onClick={onNext} disabled={pageIndex >= pageCount - 1} aria-label="Следующая страница">
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
