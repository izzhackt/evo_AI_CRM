import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type { PlacePhoto } from "@/lib/portal/university-tiles";

import { PlaceImage } from "./PlaceImage";

/**
 * Места «Атласа» (S3): карточки стран и городов, шапка места и путь по
 * каталогу. Фото несёт атмосферу, текст поверх фото лежит на затемнении и
 * остаётся читаемым и без фото (тёмная подложка). Вся карточка: одна
 * ссылка: заголовок растягивает свою ссылку на карточку.
 */

type Strings = PortalStrings<"universities">;

const COUNTRY_CARD_SIZES = "(min-width: 1180px) 380px, (min-width: 640px) 48vw, 100vw";
const CITY_CARD_SIZES = "(min-width: 1180px) 360px, (min-width: 640px) 48vw, 100vw";
const HERO_SIZES = "(min-width: 1180px) 1150px, 100vw";

export type CountryCardModel = Readonly<{
  code: string;
  name: string;
  href: string;
  counts: string;
  photo: PlacePhoto | null;
}>;

export type CityCardModel = Readonly<{
  key: string;
  name: string;
  href: string;
  count: string;
  summary: string;
  fact: string;
  photo: PlacePhoto;
}>;

export function CountryCards({
  countries,
  label,
}: {
  countries: readonly CountryCardModel[];
  label: string;
}) {
  return (
    <ul className="pt-place-grid pt-country-grid" aria-label={label}>
      {countries.map((country, index) => (
        <li key={country.code}>
          <article className="pt-place-card pt-country-card">
            <div className="pt-place-media">
              {country.photo ? (
                <PlaceImage
                  src={country.photo.src}
                  srcSet={country.photo.srcSet}
                  sizes={COUNTRY_CARD_SIZES}
                  width={country.photo.width}
                  height={country.photo.height}
                  priority={index < 3}
                  className="pt-place-img"
                />
              ) : null}
            </div>
            <div className="pt-place-overlay">
              <h3 className="pt-place-name">
                <IntentPrefetchLink href={country.href} className="pt-place-link">{country.name}</IntentPrefetchLink>
              </h3>
              <p className="pt-place-count">{country.counts}</p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

export function CityCards({
  cities,
  strings,
  label,
}: {
  cities: readonly CityCardModel[];
  strings: Pick<Strings, "cityFactLabel">;
  label: string;
}) {
  return (
    <ul className="pt-place-grid pt-city-grid" aria-label={label}>
      {cities.map((city, index) => (
        <li key={city.key}>
          <article className="pt-place-card pt-city-card">
            <div className="pt-place-media pt-city-media">
              <PlaceImage
                src={city.photo.src}
                srcSet={city.photo.srcSet}
                sizes={CITY_CARD_SIZES}
                width={city.photo.width}
                height={city.photo.height}
                priority={index < 3}
                className="pt-place-img"
              />
              <p className="pt-city-count">{city.count}</p>
            </div>
            <div className="pt-city-body">
              <h3 className="pt-city-name">
                <IntentPrefetchLink href={city.href} className="pt-place-link">{city.name}</IntentPrefetchLink>
              </h3>
              <p className="pt-city-summary">{city.summary}</p>
              <p className="pt-city-fact">
                <span className="pt-city-fact-label">{strings.cityFactLabel}</span>
                <span>{city.fact}</span>
              </p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

export function PlaceHero({
  title,
  counts,
  photo,
  strings,
  compact = false,
  children,
}: {
  title: string;
  counts: string;
  photo: PlacePhoto | null;
  strings: Pick<Strings, "photoCredit" | "newTab">;
  /** Узкая шапка над картой: карта видна на первом экране. */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={`pt-place-hero${compact ? " pt-place-hero-compact" : ""}`}>
      <div className="pt-place-hero-media">
        {photo ? (
          <PlaceImage
            src={photo.src}
            srcSet={photo.srcSet}
            sizes={HERO_SIZES}
            width={photo.width}
            height={photo.height}
            priority
            className="pt-place-img"
          />
        ) : null}
        <div className="pt-place-hero-title">
          <h1 className="pt-place-hero-name">{title}</h1>
          <p className="pt-place-hero-count">{counts}</p>
        </div>
      </div>
      {photo?.credit ? (
        <p className="pt-place-credit">
          {(() => {
            const [before, after] = strings.photoCredit.split("{author}");
            const [middle, end] = (after ?? "").split("{license}");
            return (
              <>
                {before}
                <a href={photo.credit.authorUrl} target="_blank" rel="noopener noreferrer">
                  {photo.credit.author}
                  <span className="pt-sr-only"> {strings.newTab}</span>
                </a>
                {middle}
                {photo.credit.licenseUrl ? (
                  <a href={photo.credit.licenseUrl} target="_blank" rel="noopener noreferrer">
                    {photo.credit.license}
                    <span className="pt-sr-only"> {strings.newTab}</span>
                  </a>
                ) : photo.credit.license}
                {end}
              </>
            );
          })()}
        </p>
      ) : null}
      {children}
    </header>
  );
}

export type Crumb = Readonly<{ label: string; href: string | null }>;

export function Breadcrumbs({ crumbs, label }: { crumbs: readonly Crumb[]; label: string }) {
  return (
    <nav aria-label={label} className="pt-crumbs">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={`${index}:${crumb.label}`}>
            {index > 0 ? (
              <svg className="pt-crumbs-sep" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
            {crumb.href ? (
              <IntentPrefetchLink href={crumb.href} className="pt-crumbs-link">{crumb.label}</IntentPrefetchLink>
            ) : (
              <span aria-current="page" className="pt-crumbs-current">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** «47 университетов · 19 городов» по правилам склонения словаря. */
export function placeCountsLabel(
  strings: Strings,
  universities: number,
  cities: number | null,
  form: (value: number) => "one" | "few" | "many",
): string {
  // Число и слово не разрываются переносом («3 города», а не «3 / города»).
  const keep = (value: string) => value.replace(" ", "\u00a0");
  const university = keep(formatPortalString(strings[`count.university.${form(universities)}`], { count: String(universities) }));
  if (cities === null) return university;
  return `${university} · ${keep(formatPortalString(strings[`count.city.${form(cities)}`], { count: String(cities) }))}`;
}

export function UnavailableNotice({ strings, href }: { strings: Pick<Strings, "unavailable" | "retry">; href: string }) {
  return (
    <div role="alert" className="pt-alert pt-alert-action">
      <p>{strings.unavailable}</p>
      <a href={href} className="pt-btn-ghost">{strings.retry}</a>
    </div>
  );
}
