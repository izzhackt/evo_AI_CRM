import { Fragment, type ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import type { UniversityProgram } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  costsShowUsd,
  formatMinorAmount,
  formatUnitsPerUsd,
  formatUsd,
  fxSourceLabel,
  groupCostRows,
  splitCostNote,
  summarizeCosts,
} from "@/lib/portal/university-costs";
import { localizedText, type CostRow, type UniversityCosts } from "@/lib/portal/university-index";
import { universityDateLabel, universityLevelKey } from "@/lib/portal/universities";

/**
 * Блок «Стоимость» страницы вуза (S3, план 4.5 и 7.3). Рисуется только при
 * опубликованных строках: вызывающий передаёт `costs !== null`. Таблица:
 * что, период, сумма в валюте вуза, ориентир в USD (если он есть хотя бы у
 * одной строки). Под таблицей учебный год, источник, курс с датой и
 * источником курса. Название агентства студенту не показывается.
 */

type Strings = PortalStrings<"universities">;

const NBSP = "\u00a0";

/** Дата «16 октября 2026 г.» в конце предложения не даёт двух точек. */
function sentenceEnd(value: string): string {
  return value.replace(/\.\.$/u, ".");
}

/** «16 октября 2026 г.»: «г.» не уходит на новую строку. */
function dateLabel(value: string, locale: Locale): string {
  return universityDateLabel(value, locale).replace(/ (г\.)$/u, `${NBSP}$1`);
}

/** Сумма или диапазон: числа моноширинным (данные), слова «от … до» обычным текстом. */
function amountNode(min: string, max: string | null, strings: Strings): ReactNode {
  if (max === null) return <span className="pt-costs-num">{min}</span>;
  return strings.costRange.split(/(\{min\}|\{max\})/u).map((part, index) => {
    if (part === "{min}") return <span key={index} className="pt-costs-num">{min}</span>;
    if (part === "{max}") return <span key={index} className="pt-costs-num">{max}</span>;
    return part;
  });
}

function rowAmount(row: CostRow, strings: Strings, locale: Locale): ReactNode {
  const min = formatMinorAmount(row.amountMinMinor, row.exponent, locale);
  const max = row.amountMaxMinor === null ? null : formatMinorAmount(row.amountMaxMinor, row.exponent, locale);
  return <>{amountNode(min, max, strings)}{NBSP}<span className="pt-costs-num">{row.currency}</span></>;
}

function rowUsd(row: CostRow, strings: Strings, locale: Locale): ReactNode {
  if (row.currency === "USD") return strings.costUsdSame;
  if (row.usdApproxMin === null) return strings.costUsdMissing;
  const min = formatUsd(row.usdApproxMin, locale);
  const max = row.usdApproxMax === null ? null : formatUsd(row.usdApproxMax, locale);
  const [before, after] = strings.costApprox.split("{amount}");
  return <>{before}{amountNode(min, max, strings)}{after}</>;
}

function languageLabel(code: string, strings: Strings): string {
  const key = `costLanguage.${code}`;
  return Object.hasOwn(strings, key)
    ? strings[key as keyof Strings]
    : formatPortalString(strings.costLanguageOther, { code: code.toUpperCase() });
}

function rowLabel(
  row: CostRow,
  programs: readonly UniversityProgram[],
  strings: Strings,
  locale: Locale,
): Readonly<{ label: string; details: string | null }> {
  const note = row.note ? splitCostNote(localizedText(row.note, locale)) : [];
  if (row.kind === "tuition") {
    const program = row.programId ? programs.find((entry) => entry.id === row.programId) : undefined;
    const base = program?.title
      ?? (row.studyLevel ? strings[universityLevelKey(row.studyLevel)] : strings["costKind.tuition"]);
    const label = row.teachingLanguage ? `${base}, ${languageLabel(row.teachingLanguage, strings)}` : base;
    return { label, details: note.length ? note.join(" · ") : null };
  }
  if (note.length === 0) return { label: strings[`costKind.${row.kind}`], details: null };
  const [first, ...rest] = note;
  return { label: first, details: rest.length ? rest.join(" · ") : null };
}

export function CostTable({
  costs,
  programs,
  strings,
  locale,
  newTab,
}: {
  costs: UniversityCosts;
  programs: readonly UniversityProgram[];
  strings: Strings;
  locale: Locale;
  newTab: string;
}) {
  const groups = groupCostRows(costs.rows);
  const showUsd = costsShowUsd(costs.rows);
  const summary = summarizeCosts(costs);
  const columns = showUsd ? 4 : 3;
  const sourceParts = summary.sourceKinds.map((kind) => {
    if (kind === "agency") return <Fragment key={kind}>{strings.costSourceAgency}</Fragment>;
    if (kind === "evo_document") return <Fragment key={kind}>{strings.costSourceEvo}</Fragment>;
    if (summary.officialUrls.length === 1) {
      return (
        <a key={kind} href={summary.officialUrls[0]} target="_blank" rel="noopener noreferrer">
          {strings.costSourceOfficial}
          <span className="pt-sr-only"> {newTab}</span>
        </a>
      );
    }
    return (
      <Fragment key={kind}>
        {strings.costSourceOfficial}
        {summary.officialUrls.length > 1 ? (
          <>
            {" ("}
            {summary.officialUrls.map((url, index) => (
              <Fragment key={url}>
                {index > 0 ? ", " : null}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {formatPortalString(strings.costSourcePage, { number: String(index + 1) })}
                  <span className="pt-sr-only"> {newTab}</span>
                </a>
              </Fragment>
            ))}
            {")"}
          </>
        ) : null}
      </Fragment>
    );
  });
  const [sourcesBefore, sourcesAfter] = strings.costSources.split("{sources}");

  return (
    <section aria-labelledby="portal-university-costs" className="pt-costs">
      <h2 id="portal-university-costs" className="pt-section-title">{strings.costsHeading}</h2>
      <div className="pt-costs-frame">
        <table className="pt-costs-table">
          <caption className="pt-sr-only">{strings.costsCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{strings.costColItem}</th>
              <th scope="col" className="pt-costs-period">{strings.costColPeriod}</th>
              <th scope="col" className="pt-costs-amount">{strings.costColAmount}</th>
              {showUsd ? <th scope="col" className="pt-costs-usd">{strings.costColUsd}</th> : null}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.kind}>
              <tr className="pt-costs-group">
                <th scope="rowgroup" colSpan={columns}>{strings[`costKind.${group.kind}`]}</th>
              </tr>
              {group.rows.map((row) => {
                const { label, details } = rowLabel(row, programs, strings, locale);
                const period = strings[`costPeriod.${row.period}`];
                return (
                  <tr key={row.id}>
                    <th scope="row" className="pt-costs-item">
                      <span className="pt-costs-label">{label}</span>
                      {details ? <span className="pt-costs-detail">{details}</span> : null}
                    </th>
                    <td className="pt-costs-period">{period}</td>
                    <td className="pt-costs-amount">
                      <span className="pt-costs-figure">{rowAmount(row, strings, locale)}</span>
                      {/* Телефон: ориентир и период под суммой, их колонки скрыты. */}
                      {showUsd && row.usdApproxMin !== null ? (
                        <span className="pt-costs-usd-inline">{rowUsd(row, strings, locale)}{NBSP}USD</span>
                      ) : null}
                      <span className="pt-costs-period-inline">{period}</span>
                    </td>
                    {showUsd ? (
                      <td className={`pt-costs-usd${row.usdApproxMin === null ? " pt-costs-usd-none" : ""}`}>
                        {rowUsd(row, strings, locale)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <div className="pt-costs-notes">
        <p>
          {summary.academicYears.length > 0 ? (
            <>{formatPortalString(strings.costYears, { years: summary.academicYears.join(strings.costYearsJoin) })} </>
          ) : null}
          {sourcesBefore}
          {sourceParts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 ? strings.costYearsJoin : null}
              {part}
            </Fragment>
          ))}
          {sentenceEnd(formatPortalString(sourcesAfter ?? "", { date: dateLabel(summary.verifiedOn, locale) }))}
        </p>
        {summary.rates.length > 0 ? (
          <p>
            {formatPortalString(strings.costRates, {
              rates: summary.rates.map((rate) => formatPortalString(strings.costRate, {
                value: formatUnitsPerUsd(rate.unitsPerUsd, locale),
                currency: rate.currency,
                source: fxSourceLabel(rate.sourceName, locale),
                date: dateLabel(rate.asOf, locale),
              })).join("; "),
            })}
          </p>
        ) : null}
        <p>{strings.costFinal}</p>
      </div>
    </section>
  );
}
