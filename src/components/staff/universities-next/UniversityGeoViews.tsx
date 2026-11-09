/* eslint-disable @next/next/no-img-element -- Reviewed city photos from the public portal-university-photos bucket; no arbitrary image proxy. */
import Link from "next/link";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/kit/StatusBadge";
import { CITY_PHOTO_PATH, type BrowseCity } from "@/lib/catalog-geography";
import { UNIVERSITY_LEVEL_LABELS, UNIVERSITY_LEVELS, type PublishedUniversity } from "@/lib/platform-university-catalog";
import { isStudyCountryCode } from "@/lib/study-countries";
import { cityHref, countryHref, type CityGroup } from "@/lib/university-geo-groups";
import { catalogueProgramCount, programsWord } from "@/lib/v3/university-view";

import { UniversityPhoto } from "../universities/UniversityPhoto";

export const universitiesWord = (count: number): string => {
  const tens = count % 100, ones = count % 10;
  if (ones === 1 && tens !== 11) return "вуз";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "вуза";
  return "вузов";
};

const CARD = "relative grid min-w-0 content-start overflow-hidden rounded-card border border-border bg-surface hover:bg-surface-2";
const CARD_LINK = "t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline hover:underline-offset-4";

export function BackLink({ href, children }: Readonly<{ href: string; children: React.ReactNode }>) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4">
      <Icon name="arrow-left" size={16} />{children}
    </Link>
  );
}

export type CountryCardModel = Readonly<{ code: string; name: string; count: number | null }>;

export function CountryCards({ countries }: Readonly<{ countries: readonly CountryCardModel[] }>) {
  return (
    <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3" data-testid="university-country-cards">
      {countries.map((country) => (
        <li key={country.code} className={`${CARD} gap-1 p-4`} data-country={country.code}>
          <IntentPrefetchLink href={countryHref(country.code)} className={CARD_LINK}>{country.name}</IntentPrefetchLink>
          <span className="t-meta text-fg-2">
            {country.count === null ? "Число вузов не определено" : `${country.count} ${universitiesWord(country.count)}`}
          </span>
          {isStudyCountryCode(country.code) ? null : <span className="mt-1"><StatusBadge label="Не показывается студентам" /></span>}
        </li>
      ))}
    </ul>
  );
}

/** Карточки городов страны. Фото и текст есть только у города из справочника (читает менеджер каталога). */
export function CityCards({ code, groups, cities, photoBase, canEdit }: Readonly<{
  code: string;
  groups: readonly CityGroup<PublishedUniversity>[];
  cities: readonly BrowseCity[];
  photoBase: string | null;
  canEdit: boolean;
}>) {
  return (
    <ul className="grid list-none grid-cols-1 items-start gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3" data-testid="university-city-cards">
      {groups.map((group) => {
        const city = group.key === null ? undefined : cities.find((entry) => entry.key === group.key);
        const photo = city?.photo && photoBase && CITY_PHOTO_PATH.test(city.photo.path) ? `${photoBase}${city.photo.path}` : null;
        const summary = city?.summaryRu ?? null;
        return (
          <li key={group.key ?? "none"} className={CARD} data-city={group.key ?? "none"}>
            {photo ? <img src={photo} alt="" loading="lazy" width={city?.photo?.width} height={city?.photo?.height} className="aspect-[16/9] w-full border-b border-border bg-surface-2 object-cover" /> : null}
            <div className="grid min-w-0 gap-1 p-4">
              <IntentPrefetchLink href={cityHref(code, group.key)} className={CARD_LINK}>{group.label}</IntentPrefetchLink>
              <span className="t-meta text-fg-2">{group.items.length} {universitiesWord(group.items.length)}</span>
              {summary ? <p className="line-clamp-3 t-body-compact text-fg-2">{summary}</p> : null}
              {canEdit && city ? (
                // Выше растянутой ссылки карточки: отдельная цель нажатия для менеджера.
                <Link href={`/universities/cities?city=${city.key}`} className="relative z-10 mt-1 inline-flex min-h-11 w-fit items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">Править город</Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function levelsLine(university: PublishedUniversity): string {
  const present = new Set(university.content.programs.map((program) => program.level));
  return UNIVERSITY_LEVELS.filter((level) => present.has(level)).map((level) => UNIVERSITY_LEVEL_LABELS[level]).join(", ");
}

function UniversityRow({ university }: Readonly<{ university: PublishedUniversity }>) {
  const programs = catalogueProgramCount(university, "");
  const meta = [programs > 0 ? `${programs} ${programsWord(programs)}` : "", levelsLine(university)].filter(Boolean).join(" · ");
  return (
    <li data-university-row={university.id} className="relative flex min-w-0 items-center gap-3 border-b border-border py-2 last:border-b-0 hover:bg-surface-2">
      <UniversityPhoto content={university.content} variant="thumb" />
      <div className="min-w-0">
        <IntentPrefetchLink href={`/universities/${university.id}`} title={university.content.name}
          className="line-clamp-2 break-words t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline hover:underline-offset-4">{university.content.name}</IntentPrefetchLink>
        {meta ? <span className="block truncate t-meta text-fg-2">{meta}</span> : null}
      </div>
    </li>
  );
}

/** Вузы одним списком (город): строки с фото, названием-ссылкой и уровнями. */
export function UniversityRows({ items }: Readonly<{ items: readonly PublishedUniversity[] }>) {
  return (
    <ul className="m-0 list-none rounded-card border border-border bg-surface px-3" data-testid="university-geo-rows">
      {items.map((university) => <UniversityRow key={university.id} university={university} />)}
    </ul>
  );
}

/** «Списком»: все вузы страны, города А→Я, вузы внутри А→Я, «Город не указан» последним. */
export function CountryGroupedList({ code, groups }: Readonly<{ code: string; groups: readonly CityGroup<PublishedUniversity>[] }>) {
  return (
    <div className="grid gap-6" data-testid="university-country-list">
      {groups.map((group) => (
        <section key={group.key ?? "none"} aria-labelledby={`geo-city-${group.key ?? "none"}`} data-city-group={group.key ?? "none"} className="grid gap-2">
          <h2 id={`geo-city-${group.key ?? "none"}`} className="flex flex-wrap items-baseline gap-x-2 t-section text-fg">
            <IntentPrefetchLink href={cityHref(code, group.key)} className="hover:underline hover:underline-offset-4">{group.label}</IntentPrefetchLink>
            <span className="t-meta text-fg-2">{group.items.length}</span>
          </h2>
          <UniversityRows items={group.items} />
        </section>
      ))}
    </div>
  );
}
