"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";

import { TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Нажатие внутри строки на ссылку, кнопку или поле — не нажатие на саму строку. */
const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=switch],[role=menuitem]";
const SORT_ICON = { asc: ArrowUpIcon, desc: ArrowDownIcon } as const;

/** Ячейка заголовка: прилипает сверху; сортируемая — кнопка со стрелкой и `aria-sort`. */
export function DataTableHeadCell({
  colSpan,
  sorted,
  canSort,
  onSort,
  end = false,
  children,
}: Readonly<{
  colSpan?: number;
  sorted: false | "asc" | "desc";
  canSort: boolean;
  onSort?: (event: unknown) => void;
  end?: boolean;
  children?: React.ReactNode;
}>) {
  const Icon = sorted ? SORT_ICON[sorted] : ArrowUpDownIcon;
  const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined;
  return (
    <TableHead colSpan={colSpan} aria-sort={ariaSort} className={cn("sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--border)]", end && "text-right")}>
      {children === null || children === undefined ? null : canSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn("-mx-1 inline-flex min-h-11 items-center gap-1 rounded-nav px-1 hover:text-fg", end && "flex-row-reverse")}
        >
          {children}
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </TableHead>
  );
}

/** Строка таблицы; с `onOpen` — нажимается мышью и открывается с клавиатуры (Enter, пробел). */
export function DataTableRow({ onOpen, children }: Readonly<{ onOpen?: () => void; children: React.ReactNode }>) {
  if (!onOpen) return <TableRow>{children}</TableRow>;
  return (
    <TableRow
      tabIndex={0}
      className="cursor-pointer"
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest(INTERACTIVE)) onOpen();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
    </TableRow>
  );
}
