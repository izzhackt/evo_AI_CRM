"use client";

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useSearchParams } from "next/navigation";

import type { UniversityLevel } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  PROGRAMS_FIRST, programMatches, visiblePrograms, type ProgramDuration, type ProgramField, type ProgramPick,
} from "@/lib/portal/program-facets";
import { matchesSearch } from "@/lib/portal/university-search";

/** У вуза с таким числом программ и меньше подбора нет: карточек и так немного. */
const FILTER_FROM = 4;

export type ProgramListItem = Readonly<{
  id: string;
  level: UniversityLevel;
  field: ProgramField;
  months: readonly number[];
  duration: ProgramDuration | null;
  search: string;
  node: ReactNode;
}>;
type Facet = keyof ProgramPick;
type Option = Readonly<{ value: string; label: string }>;

const NONE: ProgramPick = { level: "", field: "", month: "", duration: "" };

/**
 * Подбор программ вуза (10.11.2026, «детальный фильтр … карточки программ с изображением»): поиск и четыре поля -
 * уровень, направление, месяц начала, длительность. У каждого варианта число программ с учётом остальных полей; варианты
 * без программ недоступны. Пока ничего не выбрано - первые четыре карточки и «Показать все»; с любым фильтром или
 * поиском - все подходящие («только 4 сначала выведем, потом когда юзер будет фильтровать - все»). Программа с
 * неизвестным месяцем или длительностью не прячется (`programMatches`). Карточки рисует сервер (`Detail`), здесь только выбор, какие
 * показать. Выбор живёт в адресе через Next (`replaceState(null)`), поэтому обновление и «Назад» возвращают ту же выдачу.
 */
export function ProgramList({ items, options, totalLabel, strings }: Readonly<{
  items: readonly ProgramListItem[];
  /** «112 программ» - по правилам склонения, считает сервер. */
  totalLabel: string;
  /** Варианты полей, которые есть у вуза, в своём порядке, с подписью. */
  options: Readonly<Record<Facet, readonly Option[]>>;
  strings: PortalStrings<"universities">;
}>) {
  const params = useSearchParams();
  const filter = items.length >= FILTER_FROM;
  const [picked, setPicked] = useState<ProgramPick>(() => {
    if (!filter) return NONE;
    const read = (facet: Facet) => options[facet].find((option) => option.value === params.get(facet))?.value ?? "";
    return { level: read("level"), field: read("field"), month: read("month"), duration: read("duration") };
  });
  const [query, setQuery] = useState(() => (filter ? (params.get("q") ?? "").slice(0, 100) : ""));
  const [expanded, setExpanded] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const focusNew = useRef(false);
  const trimmed = useDeferredValue(query).trim();
  const found = useMemo(() => (trimmed ? items.filter((item) => matchesSearch(item.search, trimmed)) : items), [items, trimmed]);
  const shown = found.filter((item) => programMatches(item, picked));
  const active = Boolean(trimmed || picked.level || picked.field || picked.month || picked.duration);
  const count = (facet: Facet, value: string) => found.filter((item) => programMatches(item, { ...picked, [facet]: value })).length;
  const visible = filter ? visiblePrograms(shown, active, expanded) : shown;

  // Адрес следует за выбором без перехода и без запроса к серверу.
  useEffect(() => {
    if (!filter) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ ...picked, q: trimmed })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
  }, [filter, picked, trimmed]);

  const pick = (facet: Facet, value: string) => setPicked({ ...picked, [facet]: value });
  const reset = () => { setPicked(NONE); setQuery(""); setExpanded(false); };
  const expand = () => { focusNew.current = true; setExpanded(true); };

  // «Показать все»: фокус на первую новую карточку, а не в никуда.
  useEffect(() => {
    if (!expanded || !focusNew.current) return;
    focusNew.current = false;
    grid.current?.querySelectorAll<HTMLButtonElement>("[data-program-open]")[PROGRAMS_FIRST]?.focus();
  }, [expanded]);
  const labels: Readonly<Record<Facet, string>> = {
    level: strings.levelLabel, field: strings.programFieldLabel, month: strings.programMonthLabel, duration: strings.duration,
  };
  const anyLabels: Readonly<Record<Facet, string>> = {
    level: strings.programsAnyLevel, field: strings.programsAnyField, month: strings.programsAnyMonth, duration: strings.programsAnyDuration,
  };

  return (
    <>
      {filter ? (
        <div className="pt-program-filter">
          <form role="search" className="pt-uni-search" onSubmit={(event) => event.preventDefault()}>
            <label className="pt-uni-search-field">
              <span className="pt-sr-only">{strings.programSearchLabel}</span>
              <svg className="pt-uni-search-icon" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <circle cx="8.75" cy="8.75" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="m13.2 13.2 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder={strings.programSearchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
                className="pt-uni-search-input"
              />
            </label>
            {query ? (
              <button type="button" className="pt-uni-search-clear" onClick={() => setQuery("")}>
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="m5 5 8 8M13 5l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span className="pt-sr-only">{strings.searchClear}</span>
              </button>
            ) : null}
          </form>
          <div className="pt-program-facets">
            {(["level", "field", "month", "duration"] as const).filter((facet) => options[facet].length > 1).map((facet) => (
              <label key={facet} className="pt-field">
                <span className="pt-field-label">{labels[facet]}</span>
                <select className="pt-input pt-program-select" value={picked[facet]} onChange={(event) => pick(facet, event.target.value)}>
                  <option value="">{anyLabels[facet]}</option>
                  {options[facet].map((option) => {
                    const total = count(facet, option.value);
                    return (
                      <option key={option.value} value={option.value} disabled={total === 0 && option.value !== picked[facet]}>
                        {option.label} ({total})
                      </option>
                    );
                  })}
                </select>
              </label>
            ))}
          </div>
          <div className="pt-program-summary-row">
            <p className="pt-program-found" role="status">
              {active ? formatPortalString(strings.programsFound, { shown: String(shown.length), total: String(items.length) }) : totalLabel}
            </p>
            {active ? <button type="button" className="pt-link" onClick={reset}>{strings.programsReset}</button> : null}
          </div>
        </div>
      ) : null}
      {shown.length > 0 ? (
        <div ref={grid} className="pt-program-cards">
          {visible.map((item) => <Fragment key={item.id}>{item.node}</Fragment>)}
        </div>
      ) : filter ? (
        <div className="pt-program-empty">
          <p>{strings.programsEmpty}</p>
          <button type="button" className="pt-btn-ghost" onClick={reset}>{strings.programsReset}</button>
        </div>
      ) : null}
      {visible.length < shown.length ? (
        <p className="pt-program-more">
          <button type="button" className="pt-btn-ghost pt-program-more-button" onClick={expand}>
            {formatPortalString(strings.programsShowAll, { count: String(shown.length) })}
            <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" />
          </button>
        </p>
      ) : null}
    </>
  );
}
