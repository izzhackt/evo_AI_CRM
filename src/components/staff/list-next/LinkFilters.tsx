"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChevronDownIcon, ListFilterIcon, XIcon } from "lucide-react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";

import type { LinkFilterBarData, LinkFilterMenu, LinkFilterOption } from "./link-filters-model";

/**
 * Вариант фильтра — строка списка без рамки: кружок-переключатель, название, число справа; выбранный — закрашенный кружок и
 * вес 600. Длинное название переносится, а не обрезается: содержимое панели (`DetailSheet`) растёт по самой длинной строке.
 */
const OPTION = "flex min-h-11 items-center gap-3 rounded-nav px-2 py-2 t-body-compact text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg aria-[current=true]:font-semibold aria-[current=true]:text-fg motion-reduce:transition-none";
/** Выбранный фильтр на странице — та же подложка «выбрано» и крестик: нажатие снимает только его. На телефоне поля уже: два чипа встают в строку. */
const APPLIED = "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-ctl bg-accent-weak px-3 max-sm:px-2.5 t-body-compact font-semibold text-accent-text transition-colors hover:bg-surface-3 motion-reduce:transition-none";
/** «Готово» — тёмная кнопка панели, как «Подтвердить» очередей: красный остаётся главным действием страницы. */
const DONE = "border-fg bg-fg text-surface hover:border-fg-2 hover:bg-fg-2 hover:text-surface";

/** Чип, который снимает фильтр: он исчезает вместе с фильтром, и фокус ушёл бы в начало страницы (`FilterPanel` вернёт его на кнопку). */
let removedChip: HTMLElement | null = null;

/** Выбранный вариант фильтра, если он не первый (первый — «Все …», «Любой срок», «Открытые», «По сроку шага»: значение по умолчанию). */
function chosenOf(menu: LinkFilterMenu): Readonly<{ option: LinkFilterOption; clearHref: string }> | null {
  const [first] = menu.options;
  const option = menu.options.find((entry) => entry.selected);
  return first && option && option.key !== first.key ? { option, clearHref: first.href } : null;
}

/**
 * Раздел панели: название и текущее значение (выбранное не по умолчанию — темнее и жирнее). Раскрыт может быть один
 * раздел (`name` у `details`): открыл «Этап» — «Направление» свернулся, панель не разрастается. Внутри — ровный список.
 */
function FilterSection({ menu }: Readonly<{ menu: LinkFilterMenu }>) {
  const current = menu.options.find((option) => option.selected)?.label ?? menu.valueLabel ?? "";
  const changed = chosenOf(menu) !== null;
  return (
    <details name="list-filters" className="group border-b border-border last:border-b-0" data-testid={`list-filter-${menu.key}`}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-nav py-2 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 t-label text-fg">{menu.label}</span>
        <span className={`ms-auto min-w-0 text-end [overflow-wrap:anywhere] t-body-compact ${changed ? "font-semibold text-fg" : "text-fg-2"}`}>{current}</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-fg-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul aria-label={menu.label} className="grid pb-3">
        {menu.options.map((option) => (
          <li key={option.key}>
            <Link href={option.href} scroll={false} aria-current={option.selected ? "true" : undefined} className={OPTION}>
              <span aria-hidden="true" className={`grid size-[18px] shrink-0 place-items-center rounded-full border-2 ${option.selected ? "border-fg" : "border-control-edge"}`}>
                {option.selected ? <span className="size-2 rounded-full bg-fg" /> : null}
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.label}</span>
              {option.count !== undefined && option.count !== null ? <span className="tabular-nums text-fg-3">{option.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Выбранный фильтр или поиск на странице: ссылка, которая снимает только его. `short` — поиск: длинный текст обрезается раньше. */
export function AppliedFilter({ href, label, short = false, children }: Readonly<{ href: string; label: string; short?: boolean; children: React.ReactNode }>) {
  return (
    <Link href={href} scroll={false} onClick={(event) => { removedChip = event.currentTarget; }} className={APPLIED} aria-label={label} data-testid="list-filter-applied">
      <span className={`min-w-0 truncate ${short ? "max-w-40" : ""}`}>{children}</span>
      <XIcon aria-hidden="true" className="size-4 shrink-0" />
    </Link>
  );
}

/**
 * Все фильтры списка — на отдельной панели за кнопкой «Фильтры» рядом с поиском (14.11.2026, слово владельца: «отдельная
 * страница, там всё подобрать: открыть фильтр и подобрать детальнее»; «ещё прокачать»; чипы в рамках — «it looks messy»).
 * На телефоне панель во весь экран. Строка на фильтр с текущим значением раскрывается ровным списком вариантов. Вариант —
 * ссылка, отбирает сервер; панель остаётся открытой, можно выбрать следующий фильтр. Выбранные фильтры видны и на
 * странице — чипами с крестиком рядом с кнопкой (сортировка — нет: это порядок, а не отбор). Точка на кнопке и «Сбросить» —
 * ровно когда в панели что-то выбрано не по умолчанию (сортировка тоже); поиск — не выбор панели, у него своё поле.
 */
export function FilterPanel({ menus, resetHref }: Readonly<{ menus: readonly LinkFilterMenu[]; resetHref: string | null }>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const chosen = menus.flatMap((menu) => {
    const entry = chosenOf(menu);
    return entry ? [{ menu, ...entry }] : [];
  });
  const marked = chosen.length > 0;
  // Новое чтение пришло, снятый чип исчез: фокус с него упал на страницу — ставим на «Фильтры». Чип ещё на месте — переход идёт.
  useEffect(() => {
    if (!removedChip || removedChip.isConnected) return;
    removedChip = null;
    if (document.activeElement === null || document.activeElement === document.body) trigger.current?.focus();
  }, [menus]);
  return (
    <>
      <DetailSheet
        title="Фильтры"
        trigger={(
          <Button ref={trigger} variant="outline" className="relative" aria-label={marked ? "Фильтры: есть выбранные" : "Фильтры"} data-testid="list-filters">
            <ListFilterIcon aria-hidden="true" />
            {/* На телефоне — только значок: кнопка встаёт в одну строку с поиском. */}
            <span className="max-sm:sr-only">Фильтры</span>
            {marked ? <span aria-hidden="true" className="size-2 rounded-full bg-fg" data-testid="list-filters-chosen" /> : null}
          </Button>
        )}
        footer={(
          <>
            {marked && resetHref ? <Button variant="ghost" asChild><Link href={resetHref} scroll={false}>Сбросить</Link></Button> : null}
            <SheetClose asChild><Button variant="outline" className={DONE}>Готово</Button></SheetClose>
          </>
        )}
      >
        <div data-testid="list-filters-panel">
          {menus.map((menu) => <FilterSection key={menu.key} menu={menu} />)}
        </div>
      </DetailSheet>
      {chosen.filter(({ menu }) => menu.key !== "sort").map(({ menu, option, clearHref }) => (
        <AppliedFilter key={menu.key} href={clearHref} label={`Убрать фильтр: ${menu.label}: ${option.label}`}>
          {menu.label}: {option.label}
        </AppliedFilter>
      ))}
    </>
  );
}

/** Фильтры списка рядом с поиском («Студенты», EVO Docs, «Университеты»): кнопка «Фильтры», панель и выбранные фильтры. */
export function LinkFilters({ bar }: Readonly<{ bar: LinkFilterBarData }>) {
  return <FilterPanel menus={bar.menus} resetHref={bar.resetHref} />;
}
