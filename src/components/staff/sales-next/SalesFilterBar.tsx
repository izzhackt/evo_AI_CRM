import { Icon } from "@/components/icons";
import { inputCls } from "@/components/ui";
import type { SalesRegisterWorkspace } from "@/lib/platform-sales-register-contract";
import { salesDirectionControl } from "@/lib/sales-register-directions";
import type { SalesReportQuery } from "@/lib/sales-register-navigation";
import type { SalesLabelGroup } from "@/lib/sales-register-view";

import { FilterPanel } from "../list-next/LinkFilters";
import type { LinkFilterMenu } from "../list-next/link-filters-model";
import { labelOptions, managerOptions } from "../sales-report/SalesReportToolbar";

const tidy = (value: string) => value.trim().replace(/\s+/gu, " ");

/** Разделы панели «Фильтры»: те же адреса и параметры, что у прежних кнопок строки (`SalesReportToolbar`). */
function salesFilterMenus({ workspace, query, selectedManager, selectedManagerName, directionControl, directionGroups, selectedDirection, filterHref, managersHref, reviewCount }: SalesFilterBarProps): LinkFilterMenu[] {
  const review = query.review === "true" || query.review === "false" ? query.review : null;
  const archived = query.archived === "true";
  return [
    { key: "manager", label: "Менеджер", valueLabel: selectedManagerName,
      options: managerOptions(workspace, selectedManager, (value) => filterHref({ manager: value }), null),
      link: managersHref ? { href: managersHref, label: "Менеджеры в отчёте" } : null },
    ...(directionControl.kind === "select" ? [{ key: "direction", label: "Направление", valueLabel: selectedDirection ? tidy(selectedDirection) : null,
      options: labelOptions(directionGroups, selectedDirection, (value) => filterHref({ direction: value })) }] : []),
    { key: "review", label: "Сверка", valueLabel: null, options: [
      { key: "all", label: "Все", href: filterHref({ review: null }), selected: review === null },
      { key: "true", label: "Нужно уточнить", href: filterHref({ review: "true" }), selected: review === "true", count: reviewCount },
      { key: "false", label: "Сверено", href: filterHref({ review: "false" }), selected: review === "false" },
    ] },
    { key: "archived", label: "Записи", valueLabel: null, options: [
      { key: "work", label: "Без архива", href: filterHref({ archived: null }), selected: !archived },
      { key: "archive", label: "Архив", href: filterHref({ archived: "true", sale: null }), selected: archived },
    ] },
  ];
}

type SalesFilterBarProps = Readonly<{
  workspace: SalesRegisterWorkspace;
  query: SalesReportQuery;
  params: URLSearchParams;
  searchQuery: string | null;
  hidden: Readonly<Record<string, string>>;
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
}>;

/**
 * Поиск и фильтры «Отчёта продаж» (15.11.2026, решение владельца упростить отчёт): поле поиска и одна кнопка «Фильтры» с той же
 * панелью, что у списков (`FilterPanel`): «Менеджер», «Направление», «Сверка» (с числом «Нужно уточнить»), «Записи» (архив).
 * Выбранное видно на странице чипами с крестиком. Адреса, параметры и применение ссылкой — прежние; поиск — форма методом GET.
 * Список направлений не прочитан — направление вводится как в записи (прежнее поведение) полем после кнопки «Фильтры».
 */
export function SalesFilterBar(props: SalesFilterBarProps) {
  const { query, params, searchQuery, hidden, directionControl, hasFilters, clearFiltersHref } = props;
  return (
    <div role="group" aria-label="Поиск и фильтры" className="flex flex-wrap items-center gap-2" data-testid="sales-report-toolbar">
      {/* Основа 14rem, как у поиска списков: чипы выбранного уходят на следующую строку, а не сжимают поле до значка. */}
      <form key={params.toString()} method="get" role="search" aria-label="Поиск по записям" className="min-w-0 flex-1 basis-56 sm:max-w-sm">
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="relative block">
          <span className="sr-only">Имя, телефон или договор</span>
          <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input name="q" type="search" defaultValue={searchQuery ?? (typeof query.q === "string" ? query.q : "")} maxLength={200}
            placeholder="Имя, телефон, договор" enterKeyHint="search" autoComplete="off"
            className="h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface ps-10 pe-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent" />
        </label>
      </form>
      <FilterPanel menus={salesFilterMenus(props)} resetHref={hasFilters ? clearFiltersHref : null} />
      {/* Список направлений не прочитан — поле ввода после кнопки: строка «поиск + Фильтры» остаётся целой, поле переносится ниже. */}
      {directionControl.kind !== "select" ? (
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
      ) : null}
    </div>
  );
}
