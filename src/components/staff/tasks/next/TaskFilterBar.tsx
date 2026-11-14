"use client";

import { AppliedFilter, FilterPanel } from "../../list-next/LinkFilters";
import type { TaskFilterBarData } from "./task-filter-menus";

/**
 * Фильтры «Задач» рядом с общим поиском таблицы: «Срок», «Тип», «Состояние» — на той же панели за кнопкой «Фильтры», что у
 * «Студентов» (`FilterPanel`: разделы со списком вариантов, «Сбросить» и «Готово» внизу; выбранное — чипами на странице).
 * Поиск из старой ссылки (`?q=`) — таким же чипом со ссылкой «убрать». Пояснений на панели нет.
 */
export function TaskFilterBar({ bar }: Readonly<{ bar: TaskFilterBarData }>) {
  return (
    <>
      <FilterPanel menus={bar.menus} resetHref={bar.resetHref} />
      {bar.query ? (
        <AppliedFilter href={bar.query.clearHref} label={`Убрать поиск: ${bar.query.text}`} short>
          Поиск: {bar.query.text}
        </AppliedFilter>
      ) : null}
    </>
  );
}
