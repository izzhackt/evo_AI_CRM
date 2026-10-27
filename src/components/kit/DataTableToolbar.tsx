"use client";

import { Columns3Icon, SearchIcon } from "lucide-react";

import type { DataTableColumnMeta } from "@/components/kit/data-table-core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type Column = {
  id: string;
  getCanHide: () => boolean;
  getIsVisible: () => boolean;
  toggleVisibility: (value?: boolean) => void;
  columnDef: { header?: unknown; meta?: DataTableColumnMeta };
};

/** Общий поиск по строкам, место под свои фильтры страницы и список видимых колонок. */
export function DataTableToolbar({
  search,
  onSearch,
  placeholder,
  columns,
  extra,
}: Readonly<{
  search: string;
  onSearch: (value: string) => void;
  /** Подсказка поля общего поиска; `null` — поля нет (поиск ведёт страница в `extra`). */
  placeholder: string | null;
  /** Колонки таблицы; меню показывается, если хотя бы одну можно скрыть. Без списка меню нет. */
  columns?: readonly Column[];
  /** Свои фильтры страницы (статус, ответственный…) — те же поля и кнопки, что были, без пояснений. */
  extra?: React.ReactNode;
}>) {
  const hideable = columns?.filter((column) => column.getCanHide()) ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="data-table-toolbar">
      {placeholder === null ? null : (
        <div className="relative min-w-0 flex-1 basis-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pl-9"
          />
        </div>
      )}
      {extra}
      {hideable.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3Icon aria-hidden="true" />
              Колонки
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hideable.map((column) => {
              const header = column.columnDef.header;
              const name = column.columnDef.meta?.label ?? (typeof header === "string" ? header : column.id);
              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                  onSelect={(event) => event.preventDefault()}
                >
                  {name}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
