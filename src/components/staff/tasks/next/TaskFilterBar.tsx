"use client";

import Link from "next/link";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import type { TaskFilterBarData, TaskFilterMenu } from "./task-filter-menus";

function FilterMenu({ menu }: Readonly<{ menu: TaskFilterMenu }>) {
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
              {option.selected ? <CheckIcon aria-hidden="true" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Фильтры «Задач» рядом с общим поиском таблицы: «Срок», «Тип», «Состояние» — пункты-ссылки, выбранное значение
 * внутри кнопки. Поиск из старой ссылки (`?q=`) показан кнопкой-чипом со ссылкой «убрать»; «Сбросить» — когда выбрано
 * что-то кроме вида. Пояснений на панели нет.
 */
export function TaskFilterBar({ bar }: Readonly<{ bar: TaskFilterBarData }>) {
  return (
    <>
      {bar.menus.map((menu) => <FilterMenu key={menu.key} menu={menu} />)}
      {bar.query ? (
        <Button variant="outline" asChild>
          <Link href={bar.query.clearHref} scroll={false} aria-label={`Убрать поиск: ${bar.query.text}`}>
            <span className="min-w-0 max-w-40 truncate">Поиск: {bar.query.text}</span>
            <XIcon aria-hidden="true" className="text-fg-3" />
          </Link>
        </Button>
      ) : null}
      {bar.resetHref ? <Button variant="ghost" asChild><Link href={bar.resetHref} scroll={false}>Сбросить</Link></Button> : null}
    </>
  );
}
