/**
 * Список «Университетов» в «Новом виде»: страница читает каталог теми же чтениями, а здесь он превращается в строки таблицы,
 * меню «Страна» и «Уровень» и ссылки страниц. Серверный файл: фото (`UniversityPhoto`) и названия стран собирает сервер.
 */
import { UNIVERSITY_LEVELS, UNIVERSITY_LEVEL_LABELS, type UniversityFilters } from "@/lib/platform-university-catalog";
import { staffUniversityCountryOptions } from "@/lib/university-staff-countries";
import { isStudyCountryCode } from "@/lib/study-countries";
import { catalogueProgramCount, formatCatalogueDay, type CataloguePage } from "@/lib/v3/university-view";

import type { LinkFilterBarData } from "../list-next/link-filters-model";
import { UniversityPhoto } from "../universities/UniversityPhoto";
import { universityCountry } from "../universities/UniversityCatalogue";
import type { UniversityListPage, UniversityListProps, UniversityListRow } from "./university-list-types";

const BASE = "/v3/universities";
const STALE_CARD_DAYS = 45;
const DAY_MS = 86_400_000;

/** Адрес каталога с фильтрами; пустые не пишутся, страница — смещением. */
export function universitiesHref(filters: Readonly<{ query: string; country: string; level: string }>, offset = 0): string {
  const params = new URLSearchParams({ ...(filters.query ? { q: filters.query } : {}), ...(filters.country ? { country: filters.country } : {}), ...(filters.level ? { level: filters.level } : {}) });
  if (offset > 0) params.set("offset", String(offset));
  const tail = params.toString();
  return tail ? `${BASE}?${tail}` : BASE;
}

function staleOn(verifiedOn: string, today: string): string | null {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${verifiedOn}T00:00:00Z`)) / DAY_MS;
  return Number.isFinite(days) && days > STALE_CARD_DAYS ? formatCatalogueDay(verifiedOn, today) : null;
}

export function universityListRows(page: CataloguePage, level: UniversityFilters["level"], today: string): UniversityListRow[] {
  return page.rows.map(({ university, deadline }) => ({
    id: university.id,
    name: university.content.name,
    city: university.content.city,
    country: universityCountry(university.content.country),
    programs: catalogueProgramCount(university, level),
    staleOn: staleOn(university.content.verifiedOn, today),
    verifiedOn: university.content.verifiedOn,
    hidden: !isStudyCountryCode(university.content.country),
    thumb: <UniversityPhoto content={university.content} variant="thumb" />,
    deadline: deadline ? {
      dateTime: deadline.dateTime, text: deadline.text, zone: deadline.timezone, verifiedOn: deadline.verifiedOn, word: deadline.word,
      program: deadline.program, intake: deadline.intake, sameDateCount: deadline.sameDateCount,
    } : null,
  }));
}

export function universityFilterBar(filters: UniversityFilters, countries: readonly string[]): LinkFilterBarData {
  const country = staffUniversityCountryOptions(countries, filters.country)
    .map((option) => ({ code: option.code, label: `${universityCountry(option.code)}${option.unavailable ? " — нет опубликованных карточек" : ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  const href = (next: Partial<Pick<UniversityFilters, "country" | "level">>) => universitiesHref({ query: filters.query, country: filters.country, level: filters.level, ...next });
  return {
    menus: [
      { key: "country", label: "Страна", valueLabel: filters.country ? country.find((option) => option.code === filters.country)?.label ?? filters.country : null,
        options: [{ key: "all", label: "Все страны", href: href({ country: "" }), selected: filters.country === "" },
          ...country.map((option) => ({ key: option.code, label: option.label, href: href({ country: option.code }), selected: filters.country === option.code }))] },
      { key: "level", label: "Уровень", valueLabel: filters.level ? UNIVERSITY_LEVEL_LABELS[filters.level] : null,
        options: [{ key: "all", label: "Все уровни", href: href({ level: "" }), selected: filters.level === "" },
          ...UNIVERSITY_LEVELS.map((level) => ({ key: level, label: UNIVERSITY_LEVEL_LABELS[level], href: href({ level }), selected: filters.level === level }))] },
    ],
    resetHref: filters.query || filters.country || filters.level ? BASE : null,
  };
}

export function universityListProps(page: CataloguePage, filters: UniversityFilters, countries: readonly string[], canManage: boolean, today: string): UniversityListProps {
  const filtered = Boolean(filters.query || filters.country || filters.level);
  const paging: UniversityListPage = {
    first: page.first, last: page.last, total: page.total, order: page.order,
    previousHref: page.previousOffset !== null ? universitiesHref(filters, page.previousOffset) : null,
    nextHref: page.nextOffset !== null ? universitiesHref(filters, page.nextOffset) : null,
  };
  return {
    rows: universityListRows(page, filters.level, today),
    page: paging,
    query: filters.query,
    searchHidden: { country: filters.country || null, level: filters.level || null },
    filters: universityFilterBar(filters, countries),
    canManage,
    empty: {
      title: page.first === 0 && page.previousOffset !== null ? "На этой странице университетов нет" : "Пока нет опубликованных карточек по этому запросу",
      description: `${filtered ? "Попробуйте убрать фильтры." : ""}${canManage ? " В управлении каталогом можно проверить источники и опубликовать карточку." : " Новые сведения появятся после проверки и публикации."}`.trim(),
      backHref: paging.previousHref,
    },
  };
}
