// Блок «Стоимость» как данные для экрана: те же правила, что в вебе (CostTable.tsx и
// university-costs.ts): сумма в валюте вуза, ориентир USD уже округлён сервером, колонка USD
// только если он есть хотя бы у одной строки, внизу учебный год, источник, курс с датой.
import { formatPortalString } from "@web/lib/portal/i18n";
import {
  costsShowUsd,
  formatMinorAmount,
  formatUnitsPerUsd,
  formatUsd,
  fxSourceLabel,
  groupCostRows,
  splitCostNote,
  summarizeCosts,
} from "@web/lib/portal/university-costs";
import { localizedText, type CostRow, type UniversityCosts } from "@web/lib/portal/university-index";
import type { UniversityProgram } from "@web/lib/platform-university-catalog";
import { universityDateLabel, universityLevelKey } from "@web/lib/portal/universities";

import type { Lang } from "@/i18n";

import type { UniversityStrings } from "./model";

export type CostRowView = Readonly<{ id: string; label: string; details: string | null; period: string; amount: string; usd: string | null }>;
export type CostView = Readonly<{
  showUsd: boolean;
  groups: readonly Readonly<{ title: string; rows: readonly CostRowView[] }>[];
  notes: readonly string[];
  officialUrls: readonly string[];
}>;

function range(min: string, max: string | null, strings: UniversityStrings): string {
  return max === null ? min : formatPortalString(strings.costRange, { min, max });
}

function languageLabel(code: string, strings: UniversityStrings): string {
  const key = `costLanguage.${code}`;
  return Object.hasOwn(strings, key) ? strings[key as keyof UniversityStrings] : formatPortalString(strings.costLanguageOther, { code: code.toUpperCase() });
}

export function rowAmount(row: CostRow, strings: UniversityStrings, lang: Lang): string {
  const min = formatMinorAmount(row.amountMinMinor, row.exponent, lang);
  const max = row.amountMaxMinor === null ? null : formatMinorAmount(row.amountMaxMinor, row.exponent, lang);
  return `${range(min, max, strings)} ${row.currency}`;
}

/** Ориентир в USD: «уже в USD» для самой валюты USD, «≈ …» с округлением сервера, null без курса. */
export function rowUsd(row: CostRow, strings: UniversityStrings, lang: Lang): string | null {
  if (row.currency === "USD") return strings.costUsdSame;
  if (row.usdApproxMin === null) return null;
  const min = formatUsd(row.usdApproxMin, lang);
  const max = row.usdApproxMax === null ? null : formatUsd(row.usdApproxMax, lang);
  return `${strings.costApprox.replace("{amount}", range(min, max, strings))} USD`;
}

function rowLabel(row: CostRow, programs: readonly UniversityProgram[], strings: UniversityStrings, lang: Lang) {
  const note = row.note ? splitCostNote(localizedText(row.note, lang)) : [];
  if (row.kind === "tuition") {
    const program = row.programId ? programs.find((entry) => entry.id === row.programId) : undefined;
    const base = program?.title ?? (row.studyLevel ? strings[universityLevelKey(row.studyLevel)] : strings["costKind.tuition"]);
    return { label: row.teachingLanguage ? `${base}, ${languageLabel(row.teachingLanguage, strings)}` : base, details: note.length ? note.join(" · ") : null };
  }
  if (note.length === 0) return { label: strings[`costKind.${row.kind}`], details: null };
  const [first, ...rest] = note;
  return { label: first as string, details: rest.length ? rest.join(" · ") : null };
}

const nbsp = (value: string) => value.replace(/ (г\.)$/u, " $1");

export function buildCostView(costs: UniversityCosts, programs: readonly UniversityProgram[], strings: UniversityStrings, lang: Lang): CostView {
  const summary = summarizeCosts(costs);
  const showUsd = costsShowUsd(costs.rows);
  const groups = groupCostRows(costs.rows).map((group) => ({
    title: strings[`costKind.${group.kind}`],
    rows: group.rows.map((row): CostRowView => {
      const { label, details } = rowLabel(row, programs, strings, lang);
      return { id: row.id, label, details, period: strings[`costPeriod.${row.period}`], amount: rowAmount(row, strings, lang), usd: showUsd ? rowUsd(row, strings, lang) : null };
    }),
  }));
  const sourceNames = summary.sourceKinds.map((kind) => (kind === "agency" ? strings.costSourceAgency : kind === "evo_document" ? strings.costSourceEvo : strings.costSourceOfficial));
  const [before = "", after = ""] = strings.costSources.split("{sources}");
  const sources = `${before}${sourceNames.join(strings.costYearsJoin)}${formatPortalString(after, { date: nbsp(universityDateLabel(summary.verifiedOn, lang)) })}`.replace(/\.\.$/u, ".");
  const notes: string[] = [];
  if (summary.academicYears.length > 0) notes.push(`${formatPortalString(strings.costYears, { years: summary.academicYears.join(strings.costYearsJoin) })} ${sources}`);
  else notes.push(sources);
  if (summary.rates.length > 0) {
    notes.push(
      formatPortalString(strings.costRates, {
        rates: summary.rates
          .map((rate) => formatPortalString(strings.costRate, { value: formatUnitsPerUsd(rate.unitsPerUsd, lang), currency: rate.currency, source: fxSourceLabel(rate.sourceName, lang), date: nbsp(universityDateLabel(rate.asOf, lang)) }))
          .join("; "),
      }),
    );
  }
  notes.push(strings.costFinal);
  return { showUsd, groups, notes, officialUrls: summary.officialUrls };
}
