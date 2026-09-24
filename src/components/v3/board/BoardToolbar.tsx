"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";

export type NavigateOption = Readonly<{ value: string; label: string; href: string }>;
export type NavigateOptionGroup = Readonly<{ label: string; options: readonly NavigateOption[] }>;

/**
 * Выбор фильтра доски, который применяется сразу: у каждого пункта готовый
 * адрес от сервера (тот же построитель адреса, что у ссылок), поэтому все
 * прежние параметры строки адреса остаются рабочими. Кнопки «Найти» нет.
 */
export function NavigateSelect({
  label,
  value,
  options,
  groups = [],
}: Readonly<{
  label: string;
  value: string;
  options: readonly NavigateOption[];
  groups?: readonly NavigateOptionGroup[];
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Выбранное остаётся на экране, пока сервер отвечает; новый адрес пересоздаёт
  // компонент с новым `value` (родитель задаёт `key`).
  const [current, setCurrent] = useState(value);
  const hrefs = new Map([...options, ...groups.flatMap((group) => group.options)].map((option) => [option.value, option.href]));

  return (
    <label className="t-label flex min-w-0 shrink-0 items-center gap-2 text-fg-3">
      {label}
      <select
        value={current}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const next = event.target.value;
          const href = hrefs.get(next);
          if (!href) return;
          setCurrent(next);
          startTransition(() => router.push(href, { scroll: false }));
        }}
        className="min-h-11 min-w-0 max-w-60 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm font-normal text-fg"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/**
 * Фильтры доски: на широком экране стоят в строке инструментов, на узком —
 * за кнопкой «Фильтры (n)», чтобы доска начиналась выше.
 */
export function BoardFilters({ activeCount, children }: Readonly<{ activeCount: number; children: ReactNode }>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((previous) => !previous)}
        className="v3-choice inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg @2xl:hidden"
      >
        Фильтры
        {activeCount > 0 ? <span className="tabular-nums">({activeCount})</span> : null}
      </button>
      <div
        id={id}
        className={`${open ? "flex" : "hidden"} w-full flex-col items-start gap-3 @2xl:contents`}
      >
        {children}
      </div>
    </>
  );
}
