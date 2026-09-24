"use client";

import { useId, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";

/**
 * Колонка фасетов на узком экране: одна кнопка «Фильтры» с активными
 * фильтрами вместо колонки. От ширины контейнера 68rem (колонка 15rem и
 * таблица не уже 48rem рядом) колонка видна всегда, а кнопка скрыта — фасеты
 * рисуются один раз, без второй копии ссылок.
 */
export function StudentsFacetDisclosure({
  summary,
  children,
}: Readonly<{ summary: string | null; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((previous) => !previous)}
        className="v3-choice flex min-h-11 w-full min-w-0 items-center gap-3 rounded-ctl border border-control-edge bg-surface px-3 text-start text-sm text-fg-2 hover:text-fg @min-[68rem]:hidden"
      >
        <span className="shrink-0 font-semibold text-fg">Фильтры</span>
        <span className="min-w-0 flex-1 truncate">{summary ?? "не выбраны"}</span>
        <Icon name="chevron-right" size={16} className={`shrink-0 ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      <div id={contentId} className={open ? "mt-4" : "hidden @min-[68rem]:block"}>
        {children}
      </div>
    </>
  );
}
