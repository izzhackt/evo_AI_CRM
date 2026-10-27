import Link from "next/link";

import { Icon } from "@/components/icons";
import { inputCls } from "@/components/ui";
import type { SalesRegisterWorkspace } from "@/lib/platform-sales-register-contract";
import { salesDirectionControl } from "@/lib/sales-register-directions";
import type { SalesReportQuery } from "@/lib/sales-register-navigation";
import { salesLabelGroupOf, type SalesLabelGroup } from "@/lib/sales-register-view";

import { FilterMenu, type FilterOption } from "../queue/FilterMenu";
import { QueueFilterDisclosure } from "../queue/QueueFilterDisclosure";

const tidy = (value: string) => value.trim().replace(/\s+/gu, " ");

/**
 * Переключатель строки инструментов — ссылка вида кнопки фильтра (`FILTER_BUTTON`
 * очереди; модуль клиентский, поэтому класс повторён здесь), выбранный —
 * `aria-current` и общий `.v3-choice`.
 */
const TOGGLE = "v3-choice inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
const QUIET_LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
/** Меню направления: одно имя на написания; у выбранной группы — её остальные написания. */
function labelOptions(groups: readonly SalesLabelGroup[], selected: string | null, href: (value: string | null) => string): FilterOption[] {
  const group = salesLabelGroupOf(groups, selected);
  const options: FilterOption[] = [{ key: "all", label: "Все", href: href(null), selected: !selected }];
  if (selected && !group) options.push({ key: "current", label: `Из фильтра: ${tidy(selected)}`, href: href(selected), selected: true });
  for (const one of groups) {
    options.push({ key: one.key, label: one.label, href: href(one.value), selected: selected === one.value });
    if (group?.key === one.key) {
      for (const variant of one.variants) {
        if (variant === one.value) continue;
        options.push({ key: `${one.key}:${variant}`, label: `другое написание: «${variant}»`, href: href(variant), selected: selected === variant });
      }
    }
  }
  return options;
}

/**
 * Меню менеджера (Э8.6, 253): один пункт на ключ написания — имя по таблице
 * владельца или самое частое написание — и число записей выборки после
 * выбора. Выбор — ключ; у кого есть «Менеджеры в отчёте», последний пункт
 * ведёт туда.
 */
function managerOptions(workspace: SalesRegisterWorkspace, selected: string | null, href: (value: string | null) => string, managersHref: string | null): FilterOption[] {
  const options: FilterOption[] = [{ key: "all", label: "Все", href: href(null), selected: !selected }];
  const current = workspace.managerKey;
  if (selected && current !== null && !workspace.managerOptions.some((option) => option.key === current)) {
    options.push({ key: "current", label: `Из фильтра: ${tidy(selected)}`, href: href(selected), selected: true });
  }
  for (const option of workspace.managerOptions) {
    options.push({ key: option.key, label: option.name, href: href(option.key), selected: option.key === current, count: option.count });
  }
  if (managersHref) options.push({ key: "managers", label: "Менеджеры в отчёте →", href: managersHref, selected: false });
  return options;
}

/**
 * Строка поиска и фильтров «Отчёта продаж» (Э4): поиск — форма методом GET, фильтры применяются сразу. Общая у прежнего вида и
 * «Нового вида» (вынесена из `SalesRegisterView.tsx` без изменений разметки): адреса и параметры те же.
 */
export function SalesReportToolbar({ workspace, query, params, searchQuery, hidden, activeCount, selectedManager, selectedManagerName, directionControl,
  directionGroups, selectedDirection, filterHref, managersHref, reviewCount, hasFilters, clearFiltersHref }: Readonly<{
  workspace: SalesRegisterWorkspace;
  query: SalesReportQuery;
  params: URLSearchParams;
  searchQuery: string | null;
  hidden: Readonly<Record<string, string>>;
  activeCount: number;
  selectedManager: string | null;
  selectedManagerName: string | null;
  directionControl: ReturnType<typeof salesDirectionControl>;
  directionGroups: readonly SalesLabelGroup[];
  selectedDirection: string | null;
  filterHref: (changes: Readonly<Record<string, string | null>>) => string;
  managersHref: string | null;
  reviewCount: number | null;
  hasFilters: boolean;
  clearFiltersHref: string;
}>) {
  return (
    <div role="group" aria-label="Поиск и фильтры" className="mt-4 flex flex-wrap items-center gap-2 first:mt-0" data-testid="sales-report-toolbar">
      <form key={params.toString()} method="get" role="search" aria-label="Поиск по записям" className="min-w-48 flex-1 basis-full md:basis-48 md:max-w-xs">
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="relative block">
          <span className="sr-only">Имя, телефон или договор</span>
          <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input name="q" type="search" defaultValue={searchQuery ?? (typeof query.q === "string" ? query.q : "")} maxLength={200}
            placeholder="Имя, телефон, договор" enterKeyHint="search" autoComplete="off"
            className="h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface ps-10 pe-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent" />
        </label>
      </form>
      <QueueFilterDisclosure activeCount={activeCount}>
        <FilterMenu label="Менеджер" valueLabel={selectedManagerName}
          options={managerOptions(workspace, selectedManager, (value) => filterHref({ manager: value }), managersHref)}
          clearHref={selectedManager ? filterHref({ manager: null }) : null} />
        {directionControl.kind === "select" ? (
          <FilterMenu label="Направление" valueLabel={selectedDirection ? tidy(selectedDirection) : null}
            options={labelOptions(directionGroups, selectedDirection, (value) => filterHref({ direction: value }))}
            clearHref={selectedDirection ? filterHref({ direction: null }) : null} />
        ) : (
          // Список направлений не прочитан — ввод как в записи (прежнее поведение), применяется по Enter.
          <form method="get" className="inline-flex" aria-label="Направление">
            {Object.entries(hidden).filter(([name]) => name !== "direction").map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
            {searchQuery ? <input type="hidden" name="q" value={searchQuery} /> : null}
            <label className="block">
              <span className="sr-only">Направление</span>
              <input name="direction" defaultValue={directionControl.value} maxLength={1000} placeholder="Направление — как в записи"
                aria-invalid={directionControl.reason === "invalid" ? true : undefined}
                title={directionControl.reason === "invalid"
                  ? "Введите направление до 500 символов без переносов строк и служебных символов."
                  : "Не удалось загрузить список. Введите направление как в записи или обновите страницу."}
                className={`${inputCls} min-h-11 w-56`} />
            </label>
          </form>
        )}
        <div role="group" aria-label="Уточнения" className="inline-flex">
          <Link href={filterHref({ review: query.review === "true" ? null : "true" })} scroll={false}
            aria-current={query.review === "true" ? "true" : undefined} className={`${TOGGLE} rounded-e-none`} data-testid="sales-review-toggle">
            Нужно уточнить{reviewCount !== null ? <span className="tabular-nums">{" · "}{reviewCount}</span> : null}
          </Link>
          <Link href={filterHref({ review: query.review === "false" ? null : "false" })} scroll={false}
            aria-current={query.review === "false" ? "true" : undefined} className={`${TOGGLE} -ms-px rounded-s-none`}>
            Сверено
          </Link>
        </div>
        <Link href={filterHref(query.archived === "true" ? { archived: null } : { archived: "true", sale: null })} scroll={false}
          aria-current={query.archived === "true" ? "true" : undefined} className={TOGGLE}>
          Архив
        </Link>
        {hasFilters ? <Link href={clearFiltersHref} scroll={false} className={`${QUIET_LINK} px-2`}>Сбросить</Link> : null}
      </QueueFilterDisclosure>
    </div>
  );
}
