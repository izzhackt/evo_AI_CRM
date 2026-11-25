// Подбор программ вуза (веб #1447, ProgramList.tsx и Detail.tsx): чистые функции без React Native поверх общего
// `program-facets.ts` (направление, месяцы, длительность и правило «неизвестное не прячет программу»). Здесь только то, что
// веб собирает на сервере в Detail.tsx: строки подбора, варианты полей с числом программ, подписи.
import { PROGRAM_DURATIONS, PROGRAM_FIELDS, programFacets, programMatches, visiblePrograms, type ProgramFacets, type ProgramPick } from "@web/lib/portal/program-facets";
import { matchesSearch } from "@web/lib/portal/university-search";
import type { UniversityContent, UniversityLevel, UniversityProgram } from "@web/lib/platform-university-catalog";
import { formatPortalString } from "@web/lib/portal/i18n";
import { countForm } from "@web/lib/portal/university-index";
import { universityLevelKey, universityLevels } from "@web/lib/portal/universities";

import type { Lang } from "@/i18n";

import type { UniversityStrings } from "./model";

/** У вуза с таким числом программ и меньше подбора нет: карточек и так немного (веб: `FILTER_FROM` в ProgramList.tsx). */
export const FILTER_FROM = 4;

/** Поле подбора и пустой выбор (`""` - «Все»). */
export type Facet = keyof ProgramPick;
export const FACETS: readonly Facet[] = ["level", "field", "month", "duration"];
export const NO_PICK: ProgramPick = { level: "", field: "", month: "", duration: "" };

/** Программа с признаками подбора. */
export type ProgramRow = Readonly<{
  program: UniversityProgram;
  facets: ProgramFacets;
  level: UniversityLevel;
  /** Текст для поиска: название и описание (веб: `${program.title} ${program.summary}`). */
  search: string;
}>;

export function programRows(programs: readonly UniversityProgram[]): readonly ProgramRow[] {
  return programs.map((program) => ({ program, facets: programFacets(program), level: program.level, search: `${program.title} ${program.summary}` }));
}

/** Признаки строки в виде, который понимает `programMatches`. */
const asItem = (row: ProgramRow) => ({ ...row.facets, level: row.level });

export type PickerOption = Readonly<{ value: string; label: string }>;
export type PickerOptions = Readonly<Record<Facet, readonly PickerOption[]>>;

const MONTH_FALLBACK_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;

/**
 * Название месяца: у веба `Intl.DateTimeFormat(ky|ru, { month: "long" })`. На телефоне Hermes может не знать «ky» (U7 аудита) и тогда
 * подставил бы английское название, поэтому язык проверяется, а без поддержки берётся русское написание (в CLDR у «ky» те же слова)
 * и, если Intl нет вовсе, таблица.
 */
export function monthName(month: number, lang: Lang): string {
  const date = new Date(Date.UTC(2026, month - 1, 15));
  const tags = lang === "ky" ? ["ky", "ru"] : ["ru"];
  for (const tag of tags) {
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([tag]).length === 0) continue;
      const label = new Intl.DateTimeFormat(tag, { month: "long", timeZone: "UTC" }).format(date);
      if (label) return label.charAt(0).toUpperCase() + label.slice(1);
    } catch {
      // этот язык не поддержан: пробуем следующий
    }
  }
  return MONTH_FALLBACK_RU[month - 1] ?? String(month);
}

/** Варианты полей, которые есть у вуза: уровни по шкале, направления и длительности по порядку, месяцы по году (веб: `programOptions`). */
export function programOptions(rows: readonly ProgramRow[], content: UniversityContent, strings: UniversityStrings, lang: Lang): PickerOptions {
  const months = [...new Set(rows.flatMap((row) => row.facets.months))].sort((a, b) => a - b);
  return {
    level: universityLevels(content).map((level) => ({ value: level, label: strings[universityLevelKey(level)] })),
    field: PROGRAM_FIELDS.filter((field) => rows.some((row) => row.facets.field === field)).map((field) => ({ value: field, label: strings[`programField.${field}`] })),
    month: months.map((value) => ({ value: String(value), label: monthName(value, lang) })),
    duration: PROGRAM_DURATIONS.filter((duration) => rows.some((row) => row.facets.duration === duration)).map((duration) => ({ value: duration, label: strings[`programDuration.${duration}`] })),
  };
}

/** «1 программа», «3 программы», «64 программы» (веб: `programCountLabel`; у кыргызского одна форма). */
export function programCountLabel(count: number, strings: UniversityStrings, lang: Lang): string {
  const form = lang === "ky" ? "many" : countForm(count);
  return formatPortalString(strings[`count.program.${form}`], { count: String(count) });
}

export type PickerView = Readonly<{
  /** Строки после поиска и всех выбранных полей. */
  shown: readonly ProgramRow[];
  /** Строки, которые рисуются: без выбора первые четыре, с выбором или после «Показать все» - все подходящие. */
  visible: readonly ProgramRow[];
  /** Что-то выбрано или введён запрос. */
  active: boolean;
  /** Сколько программ дадут поле и вариант при остальных выбранных полях (веб: `count`). */
  count: (facet: Facet, value: string) => number;
}>;

/** Результат подбора (веб: ProgramList.tsx). Запрос - уже обрезанный от пробелов. */
export function pickPrograms(rows: readonly ProgramRow[], query: string, picked: ProgramPick, expanded: boolean, filter: boolean): PickerView {
  const found = query ? rows.filter((row) => matchesSearch(row.search, query)) : rows;
  const shown = found.filter((row) => programMatches(asItem(row), picked));
  const active = Boolean(query || picked.level || picked.field || picked.month || picked.duration);
  const visible = filter ? visiblePrograms(shown, active, expanded) : shown;
  return { shown, visible, active, count: (facet, value) => found.filter((row) => programMatches(asItem(row), { ...picked, [facet]: value })).length };
}

/** Начало обучения для карточки: подписи наборов без повторов через « · » (веб: `starts` в Detail.tsx). */
export function programStarts(program: UniversityProgram): string {
  return [...new Set(program.intakes.map((intake) => intake.label))].join(" · ");
}
