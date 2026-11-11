"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type { ProfessionProgramRow, ProgramTuition } from "@/lib/portal/profession-guide";
import { formatMinorAmount, formatUsd } from "@/lib/portal/university-costs";
import { setUniversityFavoriteAction } from "@/lib/portal/university-favorites-actions";

type Strings = PortalStrings<"professions">;

/**
 * «Где учиться в EVO» (разбор владельца 10.11.2026, п. 4): программы
 * каталога с ценой за год, ближайшим набором и избранным вуза. Избранное —
 * то же, что у карточки вуза (миграция 195); строки одного вуза делят одно
 * состояние. Нет цены или набора — «—» с текстом для скринридера.
 */
export function ProfessionProgramsTable({
  rows,
  locale,
  strings,
}: {
  rows: readonly ProfessionProgramRow[];
  locale: Locale;
  strings: Strings;
}) {
  const [favored, setFavored] = useState<Record<string, boolean>>(() => Object.fromEntries(
    rows.flatMap((row) => (row.institutionId ? [[row.institutionId, row.favored]] : [])),
  ));
  const missing = <><span aria-hidden="true">—</span><span className="pt-sr-only">{strings.valueMissing}</span></>;
  return (
    <table className="pt-prof-programs">
      <thead>
        <tr>
          <th scope="col">{strings.colProgram}</th>
          <th scope="col">{strings.colCountry}</th>
          <th scope="col">{strings.colCost}</th>
          <th scope="col">{strings.colIntake}</th>
          <th scope="col"><span className="pt-sr-only">{strings.colFavorite}</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.ref.institution_photo_key}-${row.ref.program_hint}`}>
            <th scope="row" className="pt-prof-program-cell">
              {row.institutionId ? (
                <Link className="pt-prof-program-uni" href={`/portal/universities/${row.institutionId}`} lang="en">
                  {row.institutionName}
                </Link>
              ) : null}
              <span className="pt-prof-program-name" lang="en">{row.ref.program_hint}</span>
              {row.institutionId === null ? (
                <span className="pt-prof-program-note">{strings.universityMissing}</span>
              ) : !row.programFound ? (
                <span className="pt-prof-program-note">{strings.programMissing}</span>
              ) : null}
            </th>
            <td data-label={strings.colCountry}>{row.countryName ? row.countryName[locale === "ky" ? "ky" : "ru"] : missing}</td>
            <td data-label={strings.colCost} className="pt-data">
              {row.tuition ? tuitionLabel(row.tuition, locale, strings) : missing}
            </td>
            <td data-label={strings.colIntake}>
              {row.nextStartMonth ? monthLabel(row.nextStartMonth, locale) : missing}
            </td>
            <td className="pt-prof-program-action">
              {row.institutionId ? (
                <FavoriteButton
                  institutionId={row.institutionId}
                  name={row.institutionName ?? ""}
                  favored={favored[row.institutionId] ?? false}
                  onChange={(next) => setFavored((map) => ({ ...map, [row.institutionId as string]: next }))}
                  strings={strings}
                />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** «Март 2027»: месяц в именительном и год, без «г.» (как в драфте владельца). */
function monthLabel(value: string, locale: Locale): string {
  const date = new Date(`${value}-01T12:00:00Z`);
  const month = new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", { month: "long", timeZone: "UTC" }).format(date);
  return `${month.charAt(0).toLocaleUpperCase()}${month.slice(1)} ${value.slice(0, 4)}`;
}

function tuitionLabel(tuition: ProgramTuition, locale: Locale, strings: Strings): string {
  if (tuition.currency === "USD" || tuition.usdMin !== null) {
    const min = tuition.currency === "USD" ? formatMinorAmount(tuition.minMinor, tuition.exponent, locale) : formatUsd(tuition.usdMin as number, locale);
    const maxValue = tuition.currency === "USD"
      ? (tuition.maxMinor === null ? null : formatMinorAmount(tuition.maxMinor, tuition.exponent, locale))
      : (tuition.usdMax === null ? null : formatUsd(tuition.usdMax, locale));
    const amount = `$${min}${maxValue ? `–${maxValue}` : ""}`;
    return tuition.currency === "USD" ? amount : formatPortalString(strings.approx, { amount });
  }
  const min = formatMinorAmount(tuition.minMinor, tuition.exponent, locale);
  const max = tuition.maxMinor === null ? "" : `–${formatMinorAmount(tuition.maxMinor, tuition.exponent, locale)}`;
  return `${min}${max} ${tuition.currency}`;
}

function FavoriteButton({ institutionId, name, favored, onChange, strings }: {
  institutionId: string;
  name: string;
  favored: boolean;
  onChange: (favored: boolean) => void;
  strings: Strings;
}) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <span className="pt-prof-fav">
      <button
        type="button"
        className="pt-btn-ghost pt-prof-fav-btn"
        aria-pressed={favored}
        aria-label={`${favored ? strings.favoriteRemove : strings.favoriteAdd} — ${name}`}
        disabled={pending}
        onClick={() => {
          const next = !favored;
          onChange(next);
          setFailed(false);
          startTransition(async () => {
            const result = await setUniversityFavoriteAction(institutionId, next);
            if (result.ok) onChange(result.favored);
            else {
              onChange(!next);
              setFailed(true);
            }
          });
        }}
      >
        <Heart size={16} aria-hidden="true" fill={favored ? "currentColor" : "none"} />
        <span aria-hidden="true">{favored ? strings.favoriteAdded : strings.favoriteAdd}</span>
      </button>
      {failed ? <span role="alert" className="pt-favorite-error">{strings.favoriteError}</span> : null}
    </span>
  );
}
