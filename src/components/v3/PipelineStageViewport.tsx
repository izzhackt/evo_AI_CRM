"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

type StagePanel = Readonly<{
  key: string;
  title: string;
  count: number;
  content: ReactNode;
}>;

/** Keep every server-rendered form mounted when switching the mobile view. */
export function PipelineStageViewport({
  panels,
  filteredStage,
  allStagesHref,
  truncated,
}: Readonly<{
  panels: readonly StagePanel[];
  filteredStage: string;
  allStagesHref: string;
  truncated: boolean;
}>) {
  const panelId = useId();
  const [selected, setSelected] = useState(
    () => panels.find((panel) => panel.count > 0)?.key ?? panels[0]?.key,
  );
  const activeKey = filteredStage !== "all"
    ? filteredStage
    : panels.find((panel) => panel.key === selected)?.key ?? panels[0]?.key;
  const activePanel = panels.find((panel) => panel.key === activeKey);

  return (
    <div className="min-w-0">
      <div className="mb-3 @2xl:hidden">
        {filteredStage === "all" ? (
          <>
            <div role="group" aria-label="Показать этап" className="flex gap-1 overflow-x-auto pb-1">
              {panels.map((panel) => (
                <button
                  key={panel.key}
                  type="button"
                  aria-pressed={panel.key === activeKey}
                  aria-controls={`${panelId}-${panel.key}`}
                  onClick={() => setSelected(panel.key)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-ctl px-3 text-sm font-medium ${panel.key === activeKey ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:bg-surface-3 hover:text-fg"}`}
                >
                  {panel.title}
                  <span className="tabular-nums">{panel.count}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-2xs text-fg-3">
              {truncated ? "Количество среди загруженных лидов" : "Количество с учётом фильтров"}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <p className="text-sm font-medium text-fg">Этап: {activePanel?.title}</p>
            <Link href={allStagesHref} prefetch={false} className="inline-flex min-h-11 items-center text-sm text-fg-2 underline underline-offset-4 hover:text-fg">
              Показать все этапы
            </Link>
          </div>
        )}
      </div>
      <div role="group" aria-label="Воронка продаж" tabIndex={0} className="max-w-full overflow-x-auto rounded-card">
        <ol className="flex flex-col gap-3 @2xl:w-max @2xl:flex-row @2xl:items-start">
          {panels.map((panel) => (
            <li
              key={panel.key}
              id={`${panelId}-${panel.key}`}
              className={`${panel.key === activeKey ? "block" : "hidden"} min-w-0 rounded-card bg-surface-2 @2xl:block @2xl:w-[280px] @2xl:shrink-0`}
            >
              {panel.content}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function PipelineMobileFilters({ activeCount, children }: Readonly<{
  activeCount: number;
  children: ReactNode;
}>) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg-2 underline underline-offset-4 @2xl:hidden">
        {expanded ? "Скрыть фильтры" : "Срок и ответственный"}
        {activeCount > 0 ? <span className="tabular-nums">({activeCount})</span> : null}
      </button>
      <div id={id} className={`${expanded ? "flex" : "hidden"} flex-col gap-2 @2xl:flex`}>
        {children}
      </div>
    </div>
  );
}
