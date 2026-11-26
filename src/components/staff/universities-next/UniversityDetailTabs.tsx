"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type View = "programs" | "geography";

/**
 * Две вкладки карточки вуза у редактора каталога (25.11.2026): «Программы» и «Город и стоимость». Переключаются на месте:
 * обе панели в разметке, скрытая — `hidden`, поэтому начатый ввод в формах города и стоимости не теряется. Стрелки ←/→
 * переводят фокус между вкладками (шаблон WAI-ARIA tabs). Без панели города (не редактор) вкладок нет — страница рисует
 * только программы.
 */
export function UniversityDetailTabs({ programsCount, programs, geography }: Readonly<{ programsCount: number; programs: ReactNode; geography: ReactNode }>) {
  const [view, setView] = useState<View>("programs");
  const refs = useRef<Record<View, HTMLButtonElement | null>>({ programs: null, geography: null });
  const tabs: readonly { key: View; label: string; count: number | null }[] = [
    { key: "programs", label: "Программы", count: programsCount },
    { key: "geography", label: "Город и стоимость", count: null },
  ];
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: View = view === "programs" ? "geography" : "programs";
    setView(next);
    refs.current[next]?.focus();
  }
  return (
    <div className="grid min-w-0 gap-4">
      <div role="tablist" aria-label="Разделы университета" onKeyDown={onKey} className="inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-card border border-border bg-surface p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(node) => { refs.current[tab.key] = node; }}
            type="button"
            role="tab"
            id={`university-tab-${tab.key}`}
            aria-selected={view === tab.key}
            aria-controls={`university-panel-${tab.key}`}
            tabIndex={view === tab.key ? 0 : -1}
            onClick={() => setView(tab.key)}
            className="v3-choice inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-ctl px-3 t-label text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg motion-reduce:transition-none"
          >
            {tab.label}
            {tab.count !== null ? <span className="tabular-nums text-fg-3">{tab.count}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="university-panel-programs" aria-labelledby="university-tab-programs" hidden={view !== "programs"} className="min-w-0">{programs}</div>
      <div role="tabpanel" id="university-panel-geography" aria-labelledby="university-tab-geography" hidden={view !== "geography"} className="min-w-0">{geography}</div>
    </div>
  );
}
