"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { EmptyIcon } from "@/components/portal/home/HomeParts";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { matchesSearch, searchUniversities } from "@/lib/portal/university-search";

import { CityCards, type CityCardModel } from "./Places";
import { UniversityTileGrid, type UniversityTileModel, type UniversityTileStrings } from "./UniversityTile";

/**
 * Поиск по городу и названию вуза (план 7.3): на первом экране «Университетов»
 * идёт по индексу всех шести стран, внутри страны: по её городам и вузам.
 * Работает в браузере, без запроса к серверу. Пустой запрос показывает
 * страны или города (children), непустой: карточки найденных городов и
 * вузов (регистр, диакритика и латиница не мешают). Запрос
 * хранится в адресе (`?q=`), поэтому «Назад», обновление и ссылка сохраняют
 * его; без JavaScript форма отправляет тот же `?q=`, и сервер рисует те же
 * результаты.
 */

export type UniversitySearchStrings = UniversityTileStrings & Readonly<{
  searchLabel: string;
  searchPlaceholder: string;
  searchClear: string;
  searchFound: string;
  searchEmptyTitle: string;
  searchEmptyBody: string;
  universitiesHeading: string;
  citiesHeading: string;
  cityFactLabel: PortalStrings<"universities">["cityFactLabel"];
}>;

export function UniversitySearch({
  items,
  initialQuery,
  action,
  strings,
  favorites,
  cities = [],
  children,
}: {
  items: readonly UniversityTileModel[];
  /** Города страны: на экране страны поиск находит и их. */
  cities?: readonly CityCardModel[];
  initialQuery: string;
  action: string;
  strings: UniversitySearchStrings;
  /** Вход в «Избранное» рядом с полем поиска (только на первом экране). */
  favorites?: Readonly<{ href: string; label: string }>;
  children: ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const statusId = useId();
  const trimmed = deferred.trim();
  const results = useMemo(() => searchUniversities(items, trimmed), [items, trimmed]);
  const cityResults = useMemo(
    () => (trimmed ? cities.filter((city) => matchesSearch(`${city.name} ${city.search ?? ""}`, trimmed)) : []),
    [cities, trimmed],
  );
  const total = results.length + cityResults.length;

  // Адрес следует за запросом без перехода и без запроса к серверу.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (trimmed) url.searchParams.set("q", trimmed);
    else url.searchParams.delete("q");
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [trimmed]);

  return (
    <>
      <div className="pt-uni-search-row">
        <form
          role="search"
          action={action}
          className="pt-uni-search"
          onSubmit={(event) => {
            event.preventDefault();
            inputRef.current?.blur();
          }}
        >
          <label className="pt-uni-search-field">
            <span className="pt-sr-only">{strings.searchLabel}</span>
            <svg className="pt-uni-search-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <circle cx="8.75" cy="8.75" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              name="q"
              type="search"
              value={query}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder={strings.searchPlaceholder}
              aria-describedby={trimmed ? statusId : undefined}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              className="pt-uni-search-input"
            />
          </label>
          {query ? (
            <button
              type="button"
              className="pt-uni-search-clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                <path d="m5 5 8 8M13 5l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="pt-sr-only">{strings.searchClear}</span>
            </button>
          ) : null}
        </form>
        {favorites ? (
        <IntentPrefetchLink href={favorites.href} className="pt-btn-ghost pt-uni-favorites-link">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M10 16.6 3.9 10.7a3.9 3.9 0 0 1 0-5.6 4 4 0 0 1 5.6 0l.5.5.5-.5a4 4 0 0 1 5.6 0 3.9 3.9 0 0 1 0 5.6z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span className="pt-uni-favorites-label">{favorites.label}</span>
        </IntentPrefetchLink>
        ) : null}
      </div>
      <p id={statusId} className="pt-uni-search-status" role="status">
        {trimmed ? formatPortalString(strings.searchFound, { count: String(total) }) : ""}
      </p>
      {!trimmed ? children : total > 0 ? (
        <>
          {cityResults.length > 0 ? (
            <section aria-labelledby={`${statusId}-cities`} className="pt-place-section">
              <h2 id={`${statusId}-cities`} className="pt-section-title">{strings.citiesHeading}</h2>
              <CityCards cities={cityResults} strings={strings} label={strings.citiesHeading} />
            </section>
          ) : null}
          {results.length > 0 ? (
            <section aria-labelledby={`${statusId}-universities`} className="pt-place-section">
              {cityResults.length > 0 ? (
                <h2 id={`${statusId}-universities`} className="pt-section-title">{strings.universitiesHeading}</h2>
              ) : <h2 id={`${statusId}-universities`} className="pt-sr-only">{strings.universitiesHeading}</h2>}
              <UniversityTileGrid models={results} strings={strings} headingLevel={3} label={strings.universitiesHeading} />
            </section>
          ) : null}
        </>
      ) : (
        <section className="pt-empty pt-uni-search-empty">
          <EmptyIcon name="search" />
          <h2 className="pt-empty-title">{formatPortalString(strings.searchEmptyTitle, { query: trimmed })}</h2>
          <p className="pt-empty-body">{strings.searchEmptyBody}</p>
          <p>
            <button type="button" className="pt-btn-ghost" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              {strings.searchClear}
            </button>
          </p>
        </section>
      )}
    </>
  );
}
