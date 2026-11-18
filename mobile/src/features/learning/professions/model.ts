// Логика раздела «Профессии» для приложения: те же правила, что на сайте (PORT-4c, правки 10–11.11.2026).
// «Подходят вам», группы и поиск берутся из общего модуля веба profession-guide; здесь только то, что на
// сайте делает сервер: профиль из собственного теста интересов и разбор связей «где учиться» по каталогу.
import { formatPortalString } from "@web/lib/portal/i18n";
import {
  programNextStartMonth,
  programTuition,
  type OrvisProfile,
  type ProfessionProgramRow,
  type ProgramTuition,
} from "@web/lib/portal/profession-guide";
import { isOrvisScaleId, type OrvisScaleId, type ProfessionLinkedProgramRef } from "@web/lib/portal/professions";
import { formatMinorAmount, formatUsd } from "@web/lib/portal/university-costs";
import type { IndexUniversity, StudentUniversityDetail } from "@web/lib/portal/university-index";
import type { AssessmentAttempt } from "@web/lib/student-assessment-contract";

import type { Lang } from "@/i18n";

/** Профиль собственного завершённого orvis92 (как `readOwnOrvisState` на сервере); нет шкал - нет профиля. */
export function orvisProfileFromAttempt(attempt: AssessmentAttempt | null | undefined): OrvisProfile | null {
  const result = attempt?.result?.orvis;
  if (!result || result.scales.length === 0) return null;
  const means: Partial<Record<OrvisScaleId, number>> = {};
  for (const item of result.scales) if (isOrvisScaleId(item.scale)) means[item.scale] = item.mean;
  return { means, topScales: result.topScales.filter(isOrvisScaleId) };
}

/** Вузы индекса, на которые ссылаются связи карточки (по ключу фото), без повторов. */
export function institutionIdsForRefs(refs: readonly ProfessionLinkedProgramRef[], universities: readonly IndexUniversity[]): string[] {
  const wanted = new Set(refs.map((ref) => ref.institution_photo_key));
  return [...new Set(universities.filter((item) => item.photoKey !== null && wanted.has(item.photoKey)).map((item) => item.id))];
}

/**
 * Строки «Где учиться в EVO» (то же, что `readProfessionPrograms` веба): вуз и программа ищутся в каталоге;
 * не найден - честная строка без ссылки, цены и даты, не выдумка.
 */
export function resolveProgramRows(
  refs: readonly ProfessionLinkedProgramRef[],
  details: readonly StudentUniversityDetail[],
  now: Date,
): ProfessionProgramRow[] {
  return refs.map((ref) => {
    const detail = details.find((item) => item.university.content.photoKey === ref.institution_photo_key);
    if (!detail) {
      return { ref, institutionId: null, institutionName: null, countryName: null, programFound: false, favored: false, tuition: null, nextStartMonth: null };
    }
    const program = detail.university.content.programs.find((item) => item.title === ref.program_hint) ?? null;
    return {
      ref,
      institutionId: detail.university.id,
      institutionName: detail.university.content.name,
      countryName: detail.country.name,
      programFound: program !== null,
      favored: detail.favored,
      tuition: programTuition(detail.costs?.rows ?? [], program),
      nextStartMonth: program ? programNextStartMonth(program, now) : null,
    };
  });
}

/** «Март 2027»: месяц в именительном и год (как таблица веба). */
export function monthLabel(value: string, lang: Lang): string {
  const date = new Date(`${value}-01T12:00:00Z`);
  const month = new Intl.DateTimeFormat(lang === "ky" ? "ky" : "ru", { month: "long", timeZone: "UTC" }).format(date);
  return `${month.charAt(0).toLocaleUpperCase()}${month.slice(1)} ${value.slice(0, 4)}`;
}

/** Цена за год: USD или «≈ $…» по ориентиру, иначе в валюте вуза. */
export function tuitionLabel(tuition: ProgramTuition, lang: Lang, approx: string): string {
  if (tuition.currency === "USD" || tuition.usdMin !== null) {
    const min = tuition.currency === "USD" ? formatMinorAmount(tuition.minMinor, tuition.exponent, lang) : formatUsd(tuition.usdMin as number, lang);
    const maxValue = tuition.currency === "USD"
      ? (tuition.maxMinor === null ? null : formatMinorAmount(tuition.maxMinor, tuition.exponent, lang))
      : (tuition.usdMax === null ? null : formatUsd(tuition.usdMax, lang));
    const amount = `$${min}${maxValue ? `–${maxValue}` : ""}`;
    return tuition.currency === "USD" ? amount : formatPortalString(approx, { amount });
  }
  const min = formatMinorAmount(tuition.minMinor, tuition.exponent, lang);
  const max = tuition.maxMinor === null ? "" : `–${formatMinorAmount(tuition.maxMinor, tuition.exponent, lang)}`;
  return `${min}${max} ${tuition.currency}`;
}
