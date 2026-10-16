/**
 * Выбор страны студента для «Пути поступления» (миграция 284, план §8.3):
 * строгий разбор ответа `student_country_choice_v1()` и
 * `set_student_country_choice_v1(p_country, p_request_id)`. Форма ответа
 * описана в docs/portal/country-timeline-contract.md; iPhone разбирает её так
 * же. Файл клиент-безопасный: без server-only и без Supabase.
 */
import { STUDY_COUNTRY_CODES } from "../study-countries.ts";
import { TIMELINE_UNDECIDED, type TimelineChoice } from "./country-timeline.ts";

/** Откуда выбор: сохранён студентом, из анкеты, из дела или его нет. */
export const COUNTRY_CHOICE_SOURCES = ["saved", "application", "case", "none"] as const;
export type CountryChoiceSource = (typeof COUNTRY_CHOICE_SOURCES)[number];

export type StudentCountryChoice = Readonly<{
  /** Код страны или `UNDECIDED`; `null` только при source = none. */
  country: TimelineChoice | null;
  source: CountryChoiceSource;
  /** Когда студент сохранил выбор; только при source = saved. */
  savedAt: string | null;
}>;

/** Значения, которые принимает `set_student_country_choice_v1`. */
export const COUNTRY_CHOICE_VALUES: readonly string[] = Object.freeze([...STUDY_COUNTRY_CODES, TIMELINE_UNDECIDED]);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Строгий разбор ответа обеих RPC. Любое отклонение формы → `null`
 * (вызывающий показывает честную ошибку, а не выдуманную страну).
 */
export function parseStudentCountryChoice(value: unknown): StudentCountryChoice | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "country,savedAt,source") return null;
  const { country, source, savedAt } = row;
  if (typeof source !== "string" || !(COUNTRY_CHOICE_SOURCES as readonly string[]).includes(source)) return null;
  if (source === "saved") {
    if (typeof country !== "string" || !COUNTRY_CHOICE_VALUES.includes(country)) return null;
    if (typeof savedAt !== "string" || !TIMESTAMP.test(savedAt) || Number.isNaN(Date.parse(savedAt))) return null;
    return Object.freeze({ country, source, savedAt });
  }
  if (savedAt !== null) return null;
  if (source === "none") return country === null ? Object.freeze({ country: null, source, savedAt: null }) : null;
  // Вывод по умолчанию: только одна из шести стран, «Пока не решил» не выводится.
  if (typeof country !== "string" || !STUDY_COUNTRY_CODES.includes(country)) return null;
  return Object.freeze({ country, source: source as CountryChoiceSource, savedAt: null });
}
