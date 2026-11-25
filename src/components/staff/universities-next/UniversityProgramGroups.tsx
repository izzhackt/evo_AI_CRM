"use client";

import { useDeferredValue, useState } from "react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { UNIVERSITY_LEVELS } from "@/lib/platform-university-catalog";
import { matchesSearch } from "@/lib/portal/university-search";

import { UniversityProgramSection } from "./UniversityProgramSection";
import type { ProgramView } from "./university-detail-types";

/** С какого числа программ список делится на свёрнутые группы по уровню и получает поиск. */
export const PROGRAM_GROUPS_FROM = 9;

/**
 * Программы вуза (25.11.2026, вуз с 53 программами шёл одним плоским списком). До `PROGRAM_GROUPS_FROM` — прежний список.
 * Длиннее — поиск по названию и группы по уровню (порядок `UNIVERSITY_LEVELS`) в свёрнутых `<details>` со счётчиком; одна
 * группа раскрыта сразу. Пока в поиске есть слова, показываются только подходящие программы, их группы раскрыты.
 */
export function UniversityProgramGroups({ programs }: Readonly<{ programs: readonly ProgramView[] }>) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query).trim();
  if (programs.length < PROGRAM_GROUPS_FROM) {
    return <div className="grid min-w-0 gap-8">{programs.map((program) => <UniversityProgramSection key={program.id} program={program} />)}</div>;
  }
  const shown = deferred ? programs.filter((program) => matchesSearch(program.title, deferred)) : programs;
  const groups = UNIVERSITY_LEVELS.map((level) => ({ level, items: shown.filter((program) => program.levelKey === level) })).filter((group) => group.items.length > 0);
  const openAll = deferred !== "" || groups.length === 1;
  return (
    <section aria-labelledby="university-programs" className="grid min-w-0 gap-3" data-testid="university-program-groups">
      <h2 id="university-programs" className="t-section text-fg">Программы</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <label htmlFor="university-program-search" className="sr-only">Поиск по названию программы</label>
          <Input id="university-program-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название программы" className="ps-9" autoComplete="off" />
        </div>
        <p className="t-meta text-fg-3" role="status" aria-live="polite">
          {/* Без поиска число программ уже стоит под названием вуза — второй раз его не пишем. */}
          {deferred ? (shown.length ? `Найдено: ${shown.length} из ${programs.length}` : "Таких программ нет") : null}
        </p>
      </div>
      {groups.map(({ level, items }) => (
        // Ключ с поиском: группа заново раскрывается или сворачивается, когда поиск начался или кончился, но не на каждой букве.
        <details key={`${level}-${openAll ? "open" : "closed"}`} open={openAll} className="group rounded-card border border-border bg-surface" data-program-level={level}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
            <h3 className="t-item text-fg">
              {items[0].level} <span className="font-normal tabular-nums text-fg-3">{items.length}</span>
            </h3>
            <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-fg-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="grid min-w-0 gap-8 border-t border-border px-4 py-5">
            {items.map((program) => <UniversityProgramSection key={program.id} program={program} heading="h4" />)}
          </div>
        </details>
      ))}
    </section>
  );
}
