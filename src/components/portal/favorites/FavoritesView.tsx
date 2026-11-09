"use client";

import { useState, type ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  nearestUniversityIntake,
  universityCountryLabel,
  universityDateLabel,
  universityLevelKey,
  universityLevels,
  universityMonthLabel,
} from "@/lib/portal/universities";

type FavoritesStrings = PortalStrings<"favorites">;
type UniversitiesStrings = PortalStrings<"universities">;

/**
 * Раздел «Избранное» (PORT-3b, план §6, дизайн-контракт §5): сохранённые
 * карточки и «Сравнить» — таблица фактических свойств выбранных вузов
 * (страна/город, уровни, программы, ближайший набор). Никаких рейтингов и
 * «шансов поступления» (план §6/§14). Выбор — клиентское состояние; сами
 * записи приходят с сервера и после удаления обновляются серверным
 * revalidate, не выдуманным локальным успехом.
 */

function nearestIntakeText(
  item: PublishedUniversity,
  universitiesStrings: UniversitiesStrings,
  locale: Locale,
  now: Date,
): string {
  const nearest = nearestUniversityIntake(item.content, now);
  if (nearest === null) return universitiesStrings.intakeDatesPending;
  if (nearest.kind === "deadline") {
    return formatPortalString(universitiesStrings.intakeDeadlineByDate, {
      date: universityDateLabel(nearest.value, locale),
    });
  }
  return formatPortalString(universitiesStrings.intakeStartFromDate, {
    date: nearest.kind === "start"
      ? universityDateLabel(nearest.value, locale)
      : universityMonthLabel(nearest.value, locale),
  });
}

function CompareTable({
  selected,
  strings,
  universitiesStrings,
  locale,
  now,
}: {
  selected: readonly PublishedUniversity[];
  strings: FavoritesStrings;
  universitiesStrings: UniversitiesStrings;
  locale: Locale;
  now: Date;
}) {
  return (
    // A11y (PORT-6a, WCAG 2.1.1): таблица шире контейнера и скроллится по
    // горизонтали; tabIndex + role="region" с именем делают прокрутку
    // достижимой с клавиатуры (ячейки таблицы не фокусируемы сами по себе).
    <div
      className="pt-compare-scroll"
      tabIndex={0}
      role="region"
      aria-label={strings.compareHeading}
    >
      <table className="pt-compare-table">
        <caption className="pt-sr-only">{strings.compareHeading}</caption>
        <thead>
          <tr>
            <th scope="col">{strings.compareProperty}</th>
            {selected.map((item) => (
              <th key={item.id} scope="col">{item.content.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{strings.compareCountry}</th>
            {selected.map((item) => (
              <td key={item.id}>
                {universityCountryLabel(item.content.country, locale)}
                {item.content.city ? ` · ${item.content.city}` : ` · ${strings.cityUnknown}`}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{strings.compareLevels}</th>
            {selected.map((item) => (
              <td key={item.id}>
                {universityLevels(item.content)
                  .map((level) => universitiesStrings[universityLevelKey(level)])
                  .join(", ")}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{strings.comparePrograms}</th>
            {selected.map((item) => (
              <td key={item.id}>
                <ul className="pt-compare-programs">
                  {item.content.programs.map((program) => (
                    <li key={program.id}>
                      {program.title}
                      {" — "}
                      {universitiesStrings[universityLevelKey(program.level)]}
                    </li>
                  ))}
                </ul>
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{strings.compareIntake}</th>
            {selected.map((item) => (
              <td key={item.id} className="pt-data">
                {nearestIntakeText(item, universitiesStrings, locale, now)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function FavoritesView({
  items,
  cards,
  strings,
  universitiesStrings,
  locale,
  now,
}: {
  items: readonly PublishedUniversity[];
  cards: Readonly<Record<string, ReactNode>>;
  strings: FavoritesStrings;
  universitiesStrings: UniversitiesStrings;
  locale: Locale;
  now: Date;
}) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  // Запись могла уйти из избранного после серверного обновления — выбор
  // сравнения не должен держать исчезнувшие карточки.
  const selected = items.filter((item) => selectedIds.includes(item.id));

  return (
    <>
      <p className="pt-uni-meta">
        {formatPortalString(strings.savedCount, { count: String(items.length) })}
      </p>
      <ul className="pt-uni-grid">
        {items.map((item) => (
          <li key={item.id} className="pt-favorite-entry">
            <label className="pt-compare-pick">
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={(event) => {
                  setSelectedIds((previous) => event.target.checked
                    ? [...previous, item.id]
                    : previous.filter((id) => id !== item.id));
                }}
              />
              <span>
                {formatPortalString(strings.compareSelect, { name: item.content.name })}
              </span>
            </label>
            {cards[item.id]}
          </li>
        ))}
      </ul>
      <section aria-labelledby="portal-favorites-compare" className="pt-compare">
        <h2 id="portal-favorites-compare" className="pt-section-title">
          {strings.compareHeading}
        </h2>
        {selected.length >= 2 ? (
          <CompareTable
            selected={selected}
            strings={strings}
            universitiesStrings={universitiesStrings}
            locale={locale}
            now={now}
          />
        ) : (
          <p className="pt-empty-body">{strings.compareHint}</p>
        )}
      </section>
    </>
  );
}
