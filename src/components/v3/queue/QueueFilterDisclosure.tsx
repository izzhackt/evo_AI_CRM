"use client";

import { useId, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";

/**
 * Фильтры очереди на телефоне (≤767 px): одна кнопка «Фильтры (n)» вместо
 * ряда выпадающих фильтров. От 768 px кнопки нет, фильтры стоят в строке —
 * одна копия фильтров, без второго набора ссылок.
 */
export function QueueFilterDisclosure({ activeCount, children }: Readonly<{ activeCount: number; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((previous) => !previous)}
        className="v3-choice inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:text-fg md:hidden"
      >
        Фильтры{activeCount ? <span className="tabular-nums"> ({activeCount})</span> : null}
        <Icon name="chevron-down" size={16} className={`shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={contentId} className={`${open ? "flex" : "hidden"} order-last w-full flex-wrap items-center gap-2 md:order-none md:flex md:w-auto`}>
        {children}
      </div>
    </>
  );
}
