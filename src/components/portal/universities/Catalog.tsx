import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import {
  UNIVERSITY_COUNTRIES,
  UNIVERSITY_LEVELS,
  type PublishedUniversity,
  type UniversityFilters,
  type UniversityPage,
} from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  nearestUniversityIntake,
  universityCountryLabel,
  universityDateLabel,
  universityLevelKey,
  universityLevels,
  universityMonthLabel,
} from "@/lib/portal/universities";

import { FavoriteToggle } from "./FavoriteToggle";
import { PhotoFigure } from "./PhotoFigure";

/**
 * Портальный каталог «Атлас» (PORT-3a): список⇄карта, карточки с фото,
 * уровнями и ближайшим набором. Портальная поверхность каталога — staff
 * продолжает пользоваться `src/components/v3/universities/UniversityCatalogue`
 * (разделение аудиторий по дизайн-контракту).
 */

type Strings = PortalStrings<"universities">;
export type UniversitiesView = "list" | "map";

function filterSearchParams(filters: UniversityFilters): URLSearchParams {
  return new URLSearchParams({
    ...(filters.query ? { q: filters.query } : {}),
    ...(filters.country ? { country: filters.country } : {}),
    ...(filters.level ? { level: filters.level } : {}),
  });
}

/** Ссылка списка/карты, сохраняющая q/country/level (offset — только у списка). */
export function universitiesHref(
  base: string,
  filters: UniversityFilters,
  view: UniversitiesView,
): string {
  const params = filterSearchParams(filters);
  if (view === "map") params.set("view", "map");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function UniversitiesToolbar({
  base,
  filters,
  view,
  strings,
  locale,
}: {
  base: string;
  filters: UniversityFilters;
  view: UniversitiesView;
  strings: Strings;
  locale: Locale;
}) {
  const collator = locale === "ky" ? "ky" : "ru";
  const countries = UNIVERSITY_COUNTRIES
    .map((code) => ({ code, label: universityCountryLabel(code, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, collator));
  const filtered = Boolean(filters.query || filters.country || filters.level || filters.offset);
  return (
    <div className="pt-uni-toolbar">
      <nav aria-label={strings.viewAria} className="pt-view-toggle">
        <IntentPrefetchLink
          href={universitiesHref(base, filters, "list")}
          aria-current={view === "list" ? "page" : undefined}
          className="pt-view-toggle-link"
        >
          {strings.viewList}
        </IntentPrefetchLink>
        <IntentPrefetchLink
          href={universitiesHref(base, filters, "map")}
          aria-current={view === "map" ? "page" : undefined}
          className="pt-view-toggle-link"
        >
          {strings.viewMap}
        </IntentPrefetchLink>
      </nav>
      <form action={base} aria-label={strings.filtersAria} className="pt-uni-filters">
        {view === "map" ? <input type="hidden" name="view" value="map" /> : null}
        <label className="pt-field pt-field-query">
          <span className="pt-field-label">{strings.searchLabel}</span>
          <input
            name="q"
            type="search"
            defaultValue={filters.query}
            maxLength={100}
            placeholder={strings.searchPlaceholder}
            className="pt-input"
          />
        </label>
        <label className="pt-field">
          <span className="pt-field-label">{strings.countryLabel}</span>
          <select name="country" defaultValue={filters.country} className="pt-input">
            <option value="">{strings.allCountries}</option>
            {countries.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label className="pt-field">
          <span className="pt-field-label">{strings.levelLabel}</span>
          <select name="level" defaultValue={filters.level} className="pt-input">
            <option value="">{strings.allLevels}</option>
            {UNIVERSITY_LEVELS.map((level) => (
              <option key={level} value={level}>{strings[universityLevelKey(level)]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="pt-btn">{strings.submit}</button>
      </form>
      {filtered ? (
        <IntentPrefetchLink
          href={view === "map" ? `${base}?view=map` : base}
          className="pt-link pt-uni-reset"
        >
          {strings.resetFilters}
        </IntentPrefetchLink>
      ) : null}
    </div>
  );
}

export function UniversityCard({
  item,
  base,
  strings,
  locale,
  now,
  favored = null,
  priority = false,
}: {
  item: PublishedUniversity;
  base: string;
  strings: Strings;
  locale: Locale;
  now: Date;
  /** null — состояние избранного неизвестно (toggle не показывается). */
  favored?: boolean | null;
  /** Первые карточки экрана: фото грузится сразу, не лениво. */
  priority?: boolean;
}) {
  const content = item.content;
  const nearest = nearestUniversityIntake(content, now);
  const intakeText = nearest === null
    ? strings.intakeDatesPending
    : nearest.kind === "deadline"
      ? formatPortalString(strings.intakeDeadlineByDate, {
        date: universityDateLabel(nearest.value, locale),
      })
      : formatPortalString(strings.intakeStartFromDate, {
        date: nearest.kind === "start"
          ? universityDateLabel(nearest.value, locale)
          : universityMonthLabel(nearest.value, locale),
      });
  return (
    <article className="pt-uni-card">
      <PhotoFigure content={content} priority={priority} strings={strings} />
      <div className="pt-uni-card-body">
        <div className="pt-uni-card-top">
          <p className="pt-uni-meta">
            {universityCountryLabel(content.country, locale)}
            {content.city ? ` · ${content.city}` : ""}
          </p>
          {favored !== null ? (
            <FavoriteToggle
              institutionId={item.id}
              initialFavored={favored}
              universityName={content.name}
              strings={{
                favoriteAdd: strings.favoriteAdd,
                favoriteRemove: strings.favoriteRemove,
                favoriteError: strings.favoriteError,
              }}
            />
          ) : null}
        </div>
        <h2 className="pt-uni-name">
          <IntentPrefetchLink href={`${base}/${item.id}`}>{content.name}</IntentPrefetchLink>
        </h2>
        <ul className="pt-chip-row" aria-label={strings.levelLabel}>
          {universityLevels(content).map((level) => (
            <li key={level} className="pt-chip">{strings[universityLevelKey(level)]}</li>
          ))}
        </ul>
        <p className="pt-uni-intake">
          <span>{strings.nearestIntake}: </span>
          <span className="pt-data">{intakeText}</span>
        </p>
        <IntentPrefetchLink className="pt-btn-ghost pt-uni-card-action" href={`${base}/${item.id}`}>
          {strings.openCard}
          <span className="pt-sr-only"> — {content.name}</span>
        </IntentPrefetchLink>
      </div>
    </article>
  );
}

export function UniversityCards({
  page,
  filters,
  base,
  strings,
  locale,
  now,
  favoriteIds = null,
}: {
  page: UniversityPage;
  filters: UniversityFilters;
  base: string;
  strings: Strings;
  locale: Locale;
  now: Date;
  /** null — избранное недоступно этому рендеру (toggle не показывается). */
  favoriteIds?: readonly string[] | null;
}) {
  if (!page.items.length) {
    return (
      <section className="pt-empty">
        <h2 className="pt-empty-title">{strings.emptyTitle}</h2>
        <p className="pt-empty-body">{strings.emptyBody}</p>
      </section>
    );
  }
  const next = filterSearchParams(filters);
  if (page.nextOffset !== null) next.set("offset", String(page.nextOffset));
  return (
    <>
      <ul className="pt-uni-grid">
        {page.items.map((item, index) => (
          <li key={item.id}>
            <UniversityCard
              item={item}
              base={base}
              strings={strings}
              locale={locale}
              now={now}
              favored={favoriteIds === null ? null : favoriteIds.includes(item.id)}
              priority={index < 3}
            />
          </li>
        ))}
      </ul>
      {page.nextOffset !== null ? (
        <IntentPrefetchLink className="pt-btn-ghost" href={`${base}?${next}`}>{strings.nextPage}</IntentPrefetchLink>
      ) : null}
    </>
  );
}

export function UniversitiesUnavailable({ strings }: { strings: Strings }) {
  return <p role="alert" className="pt-alert">{strings.unavailable}</p>;
}

/** Честная сводка карты: сколько точек показано и сколько вузов без точки. */
export function UniversitiesMapSummary({
  shown,
  missing,
  strings,
}: {
  shown: number;
  missing: number;
  strings: Strings;
}) {
  return (
    <p className="pt-map-note">
      <span>{formatPortalString(strings.mapShown, { count: String(shown) })}</span>
      {missing > 0 ? (
        <span> · {formatPortalString(strings.mapWithoutPoint, { count: String(missing) })}</span>
      ) : null}
    </p>
  );
}
