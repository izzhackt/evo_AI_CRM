"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { EmptyIcon } from "@/components/portal/home/HomeParts";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { groupProfessionsByScale, searchProfessions } from "@/lib/portal/profession-guide";
import { ORVIS_SCALE_IDS, type OrvisScaleId, type ProfessionCardSummary } from "@/lib/portal/professions";

type Strings = PortalStrings<"professions">;

/**
 * Поиск и группы по интересам (разбор владельца 10.11.2026, п. 5). Без
 * фильтра — группы по основной шкале с числом профессий; с фильтром — один
 * список выбранного интереса. Карточка: название, строка о работе, интересы;
 * «где учиться» в карточке нет (просьба владельца) — это страница профессии.
 */
export function ProfessionsBrowser({
  cards,
  activeScale,
  locale,
  strings,
}: {
  cards: ProfessionCardSummary[];
  activeScale: OrvisScaleId | null;
  locale: Locale;
  strings: Strings;
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const found = searchProfessions(cards, query, locale === "ky" ? "ky" : "ru");
  const groups = activeScale === null
    ? groupProfessionsByScale(found)
    : found.length > 0 ? [{ scale: activeScale, cards: found }] : [];
  const plural = new Intl.PluralRules(locale === "ky" ? "ky" : "ru");
  const countLabel = (count: number) => {
    const rule = plural.select(count);
    const key = rule === "one" ? "groupCount.one" : rule === "few" ? "groupCount.few" : "groupCount.many";
    return formatPortalString(strings[key], { count: String(count) });
  };
  return (
    <div className="pt-prof-browser">
      <div className="pt-prof-search">
        <label className="pt-sr-only" htmlFor={inputId}>{strings.searchLabel}</label>
        <Search className="pt-prof-search-icon" size={18} aria-hidden="true" />
        <input
          id={inputId}
          className="pt-input pt-prof-search-input"
          type="search"
          autoComplete="off"
          placeholder={strings.searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <nav aria-label={strings.filterAria} className="pt-prof-filter">
        <Link className="pt-chip" aria-current={activeScale === null ? "true" : undefined} href="/portal/professions">
          {strings.allScales}
        </Link>
        {ORVIS_SCALE_IDS.map((scale) => (
          <Link
            key={scale}
            className="pt-chip"
            aria-current={activeScale === scale ? "true" : undefined}
            href={`/portal/professions?scale=${scale}`}
          >
            {strings[`scale.${scale}`]}
          </Link>
        ))}
      </nav>
      {cards.length === 0 ? (
        <div className="pt-empty">
          <EmptyIcon name="professions" />
          <p className="pt-empty-title">{strings.emptyTitle}</p>
          <p className="pt-empty-body">{strings.emptyBody}</p>
        </div>
      ) : groups.length === 0 ? (
        <p className="pt-prof-search-empty" role="status">{strings.searchEmpty}</p>
      ) : groups.map((group) => (
        <section key={group.scale} className="pt-prof-group" aria-labelledby={`pt-prof-group-${group.scale}`}>
          <h2 id={`pt-prof-group-${group.scale}`} className="pt-prof-group-title">
            {strings[`scale.${group.scale}`]}
            <span className="pt-prof-group-count">{countLabel(group.cards.length)}</span>
          </h2>
          <ul className="pt-prof-grid">
            {group.cards.map((card) => (
              <li key={card.cardId}>
                <ProfessionTile card={card} locale={locale} strings={strings} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ProfessionTile({ card, locale, strings }: { card: ProfessionCardSummary; locale: Locale; strings: Strings }) {
  const summary = locale === "ky" ? card.summaryKy : card.summaryRu;
  return (
    <article className="pt-prof-card">
      <h3 className="pt-prof-title">
        <IntentPrefetchLink href={`/portal/professions/${card.cardId}`}>
          {locale === "ky" ? card.titleKy : card.titleRu}
        </IntentPrefetchLink>
      </h3>
      {summary ? <p className="pt-prof-summary">{summary}</p> : null}
      <p className="pt-chip-row pt-prof-chips">
        {card.orvisScales.map((scale) => (
          <span key={scale} className="pt-chip">{strings[`scale.${scale}`]}</span>
        ))}
      </p>
    </article>
  );
}
