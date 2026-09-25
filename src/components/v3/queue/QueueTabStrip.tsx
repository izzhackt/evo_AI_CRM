"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Ряд вкладок-видов, который никогда не переносится: лишнее прокручивается
 * вбок внутри ряда. После загрузки текущая вкладка (`aria-current="page"`)
 * встаёт в видимую часть ряда, а у края, за которым есть ещё вкладки, ряд
 * плавно гаснет (`data-fade-start` / `data-fade-end`, маска в v3.css) — так
 * скрытые виды не пропадают без следа. Без скрипта ряд просто прокручивается.
 */
export function QueueTabStrip({ id, label, children }: Readonly<{ id?: string; label: string; children: ReactNode }>) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) {
      const box = strip.getBoundingClientRect();
      const tab = current.getBoundingClientRect();
      // Только по горизонтали и только если вкладка не видна целиком: страница не прокручивается.
      if (tab.left < box.left || tab.right > box.right) {
        strip.scrollLeft += tab.left - box.left - Math.max(0, (box.width - tab.width) / 2);
      }
    }
    const update = () => {
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setEdges((previous) => previous.start === start && previous.end === end ? previous : { start, end });
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(strip);
    return () => {
      strip.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  return (
    <nav
      ref={ref}
      id={id}
      aria-label={label}
      data-fade-start={edges.start ? "" : undefined}
      data-fade-end={edges.end ? "" : undefined}
      className="v3-tab-strip -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      data-testid="queue-view-tabs"
    >
      {children}
    </nav>
  );
}
