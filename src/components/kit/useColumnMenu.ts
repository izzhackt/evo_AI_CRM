"use client";

import { useEffect, useState } from "react";

import type { DataTableColumnMeta } from "@/components/kit/data-table-core";

/** Порог `@5xl` контейнера Tailwind: 64rem (колонка `meta.wide` рисуется, только когда блок таблицы не уже). */
const WIDE_REM = 64;

/**
 * Колонки для меню «Колонки» и ссылка-функция `watchBlock` для блока таблицы (`@container`). Колонка `meta.wide` в блоке уже 64rem скрыта стилем, а
 * состояние видимости TanStack об этом не знает: меню показывало бы «Кто запустил» с галочкой, нажатие ничего не меняло бы. В узком
 * блоке такие колонки в меню не перечисляются; ширину блока (его содержимого, как его меряет контейнерный запрос) следит
 * `ResizeObserver`. Пока ширина неизвестна (сервер, первая отрисовка), меню закрыто и список полный.
 */
export function useColumnMenu<C extends Readonly<{ columnDef: Readonly<{ meta?: DataTableColumnMeta }> }>>(columns: readonly C[]) {
  // Ссылка-функция, а не объект `useRef`: блок попадает в состояние, и эффект следит за ним без чтения ссылки при отрисовке.
  const [block, setBlock] = useState<HTMLDivElement | null>(null);
  const [wideFits, setWideFits] = useState<boolean | null>(null);
  useEffect(() => {
    if (!block) return;
    const observer = new ResizeObserver(([entry]) => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWideFits((entry?.contentBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width ?? 0) >= WIDE_REM * rem);
    });
    observer.observe(block);
    return () => observer.disconnect();
  }, [block]);
  return { watchBlock: setBlock, columns: columns.filter((column) => wideFits !== false || !column.columnDef.meta?.wide) };
}
