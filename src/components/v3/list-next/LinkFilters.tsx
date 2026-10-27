"use client";

import Link from "next/link";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import type { LinkFilterBarData, LinkFilterMenu } from "./link-filters-model";

function FilterMenu({ menu }: Readonly<{ menu: LinkFilterMenu }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-full">
          <span className="min-w-0 truncate">{menu.label}{menu.valueLabel ? <>: <span className="text-fg">{menu.valueLabel}</span></> : null}</span>
          <ChevronDownIcon aria-hidden="true" className="text-fg-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={menu.label}>
        {menu.options.map((option) => (
          <DropdownMenuItem key={option.key} asChild>
            <Link href={option.href} scroll={false} aria-current={option.selected ? "true" : undefined}>
              <span className="min-w-0 flex-1">{option.label}</span>
              {option.count !== undefined && option.count !== null ? <span className="tabular-nums text-fg-3">{option.count}</span> : null}
              {option.selected ? <CheckIcon aria-hidden="true" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Фильтры списка рядом с поиском: каждый — кнопка с выбранным значением внутри и меню пунктов-ссылок (числа — из
 * чтения, где они есть). «Сбросить» — когда выбрано что-то кроме вида. Пояснений на панели нет.
 */
export function LinkFilters({ bar }: Readonly<{ bar: LinkFilterBarData }>) {
  return (
    <>
      {bar.menus.map((menu) => <FilterMenu key={menu.key} menu={menu} />)}
      {bar.resetHref ? <Button variant="ghost" asChild><Link href={bar.resetHref} scroll={false}>Сбросить</Link></Button> : null}
    </>
  );
}
