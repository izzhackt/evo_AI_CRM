/**
 * Представление блока «Стоимость» страницы вуза (план 4.5, контракт
 * docs/catalog/geography-costs-contract.md, 2.2; решения владельца
 * 16.10.2026). Сумма в валюте вуза, ориентир в USD уже округлён сервером,
 * под таблицей источник и курс с датой и источником курса.
 *
 * Нет опубликованных строк: нет блока совсем: здесь нет и не будет текста
 * на случай отсутствия данных. Файл клиент-безопасный.
 */
import type { Locale } from "../i18n-data.ts";
import { UNIVERSITY_LEVELS } from "../platform-university-catalog.ts";
import {
  COST_KINDS,
  COST_PERIODS,
  type CostKind,
  type CostRow,
  type CostSourceKind,
  type FxRate,
  type UniversityCosts,
} from "./university-index.ts";

function numberTag(locale: Locale): "ru" | "ky" {
  return locale === "ky" ? "ky" : "ru";
}

/** Сумма в минорных единицах → строка числа без валюты («15 000», «12,50»). */
export function formatMinorAmount(minor: number, exponent: number, locale: Locale): string {
  const scale = 10 ** exponent;
  const whole = Math.trunc(minor / scale);
  const fraction = minor - whole * scale;
  const format = new Intl.NumberFormat(numberTag(locale), {
    minimumFractionDigits: fraction === 0 ? 0 : exponent,
    maximumFractionDigits: fraction === 0 ? 0 : exponent,
  });
  return format.format(fraction === 0 ? whole : minor / scale);
}

/** Целые USD ориентира («2 240»). */
export function formatUsd(value: number, locale: Locale): string {
  return new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 0 }).format(value);
}

/** «1 USD = x»: до пяти значащих цифр («6,691», «49,418», «3,6725»). */
export function formatUnitsPerUsd(value: number, locale: Locale): string {
  return new Intl.NumberFormat(numberTag(locale), { maximumSignificantDigits: 5 }).format(value);
}

export type CostGroup = Readonly<{ kind: CostKind; rows: readonly CostRow[] }>;

const LEVEL_ORDER: readonly string[] = UNIVERSITY_LEVELS;

/** Строки по видам в порядке продукта; внутри вида: порядок сервера. */
export function groupCostRows(rows: readonly CostRow[]): readonly CostGroup[] {
  return COST_KINDS
    .map((kind) => ({
      kind,
      rows: rows
        .filter((row) => row.kind === kind)
        .sort((a, b) => (a.studyLevel === null ? -1 : LEVEL_ORDER.indexOf(a.studyLevel))
          - (b.studyLevel === null ? -1 : LEVEL_ORDER.indexOf(b.studyLevel))
          || (a.programId ?? "").localeCompare(b.programId ?? "")
          || (a.teachingLanguage ?? "").localeCompare(b.teachingLanguage ?? "")
          || COST_PERIODS.indexOf(a.period) - COST_PERIODS.indexOf(b.period)
          || a.amountMinMinor - b.amountMinMinor),
    }))
    .filter((group) => group.rows.length > 0);
}

/**
 * Пояснение строки делится на подпись и уточнения: «Двухместная комната;
 * Цена за одного человека» → подпись «Двухместная комната», уточнение
 * «Цена за одного человека».
 */
export function splitCostNote(note: string): readonly string[] {
  return note.split(/;\s*/u).map((part) => part.trim()).filter(Boolean);
}

/** Колонка «≈ USD» есть, только если хотя бы у одной строки есть ориентир. */
export function costsShowUsd(rows: readonly CostRow[]): boolean {
  return rows.some((row) => row.usdApproxMin !== null);
}

export type CostSummary = Readonly<{
  /** Учебные годы строк без повторов, новые первыми; пусто: часть «Ориентир на» не печатается. */
  academicYears: readonly string[];
  /** Виды источников в порядке: сайт университета, агентства, материалы EVO. */
  sourceKinds: readonly CostSourceKind[];
  /** Адреса официальных страниц стоимости без повторов, в порядке строк. */
  officialUrls: readonly string[];
  /** Самая поздняя дата проверки строк. */
  verifiedOn: string;
  /** Курсы валют, которые есть в строках (USD курса не имеет). */
  rates: readonly FxRate[];
}>;

const SOURCE_ORDER: readonly CostSourceKind[] = ["official", "agency", "evo_document"];

export function summarizeCosts(costs: UniversityCosts): CostSummary {
  const years = [...new Set(costs.rows.map((row) => row.academicYear).filter((year): year is string => year !== null))]
    .sort((a, b) => b.localeCompare(a));
  const kinds = new Set(costs.rows.map((row) => row.source.kind));
  const officialUrls = [...new Set(costs.rows.flatMap((row) => (row.source.kind === "official" ? [row.source.url] : [])))];
  const verifiedOn = costs.rows.reduce((latest, row) => (row.verifiedOn > latest ? row.verifiedOn : latest), costs.rows[0].verifiedOn);
  const currencies = new Set(costs.rows.map((row) => row.currency));
  return {
    academicYears: years,
    sourceKinds: SOURCE_ORDER.filter((kind) => kinds.has(kind)),
    officialUrls,
    verifiedOn,
    rates: costs.fxRates.filter((rate) => currencies.has(rate.currency) && rate.currency !== "USD"),
  };
}

/**
 * Короткая подпись источника курса для студента. Admin записывает полное
 * название (в сиде 16.10.2026: английское название ЕЦБ или ЦБ ОАЭ);
 * неизвестный источник показывается как записан.
 */
export function fxSourceLabel(sourceName: string, locale: Locale): string {
  if (/^European Central Bank\b/u.test(sourceName)) return locale === "ky" ? "Европа борбордук банкы" : "ЕЦБ";
  if (/^Central Bank of the UAE\b/u.test(sourceName)) return locale === "ky" ? "БАЭнин Борбордук банкы" : "ЦБ ОАЭ";
  return sourceName;
}
