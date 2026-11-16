"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Ряд вкладок-видов, который никогда не переносится: лишнее прокручивается
 * вбок внутри ряда. После загрузки текущая вкладка (`aria-current="page"`)
 * встаёт в видимую часть ряда, а у края, за которым есть ещё вкладки, ряд
 * плавно гаснет (`data-fade-start` / `data-fade-end`, маска в staff.css) — так
 * скрытые виды не пропадают без следа. Без скрипта ряд просто прокручивается.
 *
 * `focusable` — вкладки профиля (Lead 360 и Student 360, Э8.4): ряд сам
 * принимает фокус (на него возвращается фокус после ответа на передачу), а
 * рамка фокуса вкладки рисуется внутри (`data-tab-strip`, staff.css).
 *
 * Вкладка с `data-tab-pin` (15.11.2026, «Переданы» воронки) может стоять у
 * правого края ряда прилипшей (`position: sticky`): тогда её ширина уходит в
 * `--tab-pin`, и затухание кончается перед ней, а не на ней.
 */
export function QueueTabStrip({ id, label, focusable = false, testId = "queue-view-tabs", children }: Readonly<{
  id?: string; label: string; focusable?: boolean; testId?: string; children: ReactNode;
}>) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const pin = strip.querySelector<HTMLElement>("[data-tab-pin]");
    const pinWidth = () => (pin && getComputedStyle(pin).position === "sticky" ? Math.round(pin.getBoundingClientRect().width) : 0);
    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) {
      const box = strip.getBoundingClientRect();
      const tab = current.getBoundingClientRect();
      // Видимая часть ряда кончается перед прилипшей вкладкой.
      const right = box.right - (pin?.contains(current) ? 0 : pinWidth());
      // Только по горизонтали и только если вкладка не видна целиком: страница не прокручивается.
      if (tab.left < box.left || tab.right > right) {
        strip.scrollLeft += tab.left - box.left - Math.max(0, (right - box.left - tab.width) / 2);
      }
    }
    let pinned = -1;
    const update = () => {
      const width = pinWidth();
      if (width !== pinned) strip.style.setProperty("--tab-pin", `${(pinned = width)}px`);
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setEdges((previous) => previous.start === start && previous.end === end ? previous : { start, end });
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(strip);
    // Число на прилипшей вкладке меняется («Переданы 9» → «10») — её ширина тоже.
    if (pin) observer?.observe(pin);
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
      tabIndex={focusable ? 0 : undefined}
      data-tab-strip={focusable ? "" : undefined}
      data-fade-start={edges.start ? "" : undefined}
      data-fade-end={edges.end ? "" : undefined}
      className="v3-tab-strip -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      data-testid={testId}
    >
      {children}
    </nav>
  );
}
