/**
 * Один список стран продукта (решение владельца 16.10.2026): CN, MY, AE, TR,
 * IT, CZ в этом порядке и «Пока не решил» для форм, которым он нужен.
 *
 * Источник один: `study-countries.json`. Этот модуль читает его для веба и
 * CRM; iPhone берёт тот же файл ресурсом bundle (`ios/project.yml`); база
 * держит коды в `platform_private.study_country_codes()` (миграция 282), и
 * тесты сверяют её с этим файлом. Направления сотрудников (CN, MY, EUROPE,
 * AE, TR) и гражданство анкеты (все ISO-страны) это не этот список.
 *
 * Файл клиент-безопасный: без server-only и без Supabase.
 */
import source from "./study-countries.json" with { type: "json" };

export type StudyCountryLocale = "ru" | "ky";

type StudyCountryEntry = Readonly<{ code: string; ru: string; ky: string; website: string }>;

const ISO_CODE = /^[A-Z]{2}$/;

function entry(value: unknown, code: RegExp): StudyCountryEntry {
  if (typeof value !== "object" || value === null) throw new Error("study-countries.json: invalid entry");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "code,ky,ru,website") throw new Error("study-countries.json: invalid keys");
  for (const key of ["code", "ru", "ky", "website"] as const) {
    const text = row[key];
    if (typeof text !== "string" || text.length === 0 || text !== text.trim()) throw new Error(`study-countries.json: invalid ${key}`);
  }
  if (!code.test(row.code as string)) throw new Error("study-countries.json: invalid code");
  return Object.freeze({ code: row.code as string, ru: row.ru as string, ky: row.ky as string, website: row.website as string });
}

// Проверка формы при импорте: неверный файл ломает сборку и тесты, а не
// тихо показывает неполный список.
const COUNTRIES: readonly StudyCountryEntry[] = Object.freeze(source.countries.map((row) => entry(row, ISO_CODE)));
const UNDECIDED: StudyCountryEntry = entry(source.undecided, /^undecided$/);
if (COUNTRIES.length === 0
  || new Set(COUNTRIES.map((row) => row.code)).size !== COUNTRIES.length
  || new Set([...COUNTRIES, UNDECIDED].map((row) => row.website)).size !== COUNTRIES.length + 1) {
  throw new Error("study-countries.json: duplicate codes or website values");
}

/** Коды стран в порядке продукта. */
export const STUDY_COUNTRY_CODES: readonly string[] = Object.freeze(COUNTRIES.map((row) => row.code));

/** Значение «Пока не решил» в формах, которым оно нужно. Это не страна. */
export const STUDY_COUNTRY_UNDECIDED = UNDECIDED.code;

/** True только для кода страны из списка продукта (не для «Пока не решил»). */
export function isStudyCountryCode(value: unknown): value is string {
  return typeof value === "string" && STUDY_COUNTRY_CODES.includes(value);
}

/**
 * Название страны списка или «Пока не решил» на языке интерфейса; `null`
 * для любого другого значения (вызывающий решает, что показать).
 */
export function studyCountryName(code: string, locale: string = "ru"): string | null {
  const row = code === UNDECIDED.code ? UNDECIDED : COUNTRIES.find((item) => item.code === code);
  if (!row) return null;
  return locale === "ky" ? row.ky : row.ru;
}

export type StudyCountryOption = Readonly<{ code: string; label: string }>;

/** Варианты выбора в порядке продукта; «Пока не решил» последним, если форме он нужен. */
export function studyCountryOptions(
  locale: string = "ru",
  options: Readonly<{ undecided?: boolean }> = {},
): readonly StudyCountryOption[] {
  const rows = options.undecided ? [...COUNTRIES, UNDECIDED] : COUNTRIES;
  return rows.map((row) => ({ code: row.code, label: locale === "ky" ? row.ky : row.ru }));
}

/**
 * Значения, которые шлёт форма сайта с новым списком: шесть стран и
 * «Undecided». Приёмник CRM принимает и прежние значения
 * (`website-enquiry-contract.ts`, план §6.4).
 */
export const WEBSITE_STUDY_COUNTRY_VALUES: readonly string[] = Object.freeze([
  ...COUNTRIES.map((row) => row.website),
  UNDECIDED.website,
]);

/** Значение формы сайта → код страны или «undecided»; `null` для остального. */
export function studyCountryFromWebsiteValue(value: string): string | null {
  return [...COUNTRIES, UNDECIDED].find((row) => row.website === value)?.code ?? null;
}
