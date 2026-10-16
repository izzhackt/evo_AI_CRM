/**
 * Индекс университетов студента и страница вуза одним вызовом (миграция 283,
 * контракт docs/catalog/geography-costs-contract.md, раздел 2).
 *
 * Разборщики ответов `student_university_index_v1` и
 * `student_university_detail_v1` и чистые помощники экранов «Страны →
 * города → вузы». Неверная обёртка ответа даёт null: экран честно говорит
 * «не удалось загрузить». Неверная карточка города, вуза, поле страны или
 * строка стоимости отбрасывается по одному с записью в журнал сервера
 * (`CatalogParseReporter`), остальной каталог показывается. Тексты и ссылки
 * проверяются тем же правилом, что в базе (`src/lib/catalog-text.ts`).
 *
 * Файл клиент-безопасный: без server-only и без Supabase (поиск по названию
 * работает в браузере на этом же коде).
 */
import type { Locale } from "../i18n-data.ts";
import {
  UNIVERSITY_LEVELS,
  UNIVERSITY_PHOTOS,
  parseUniversityPage,
  universityDate,
  universityUuid,
  type PublishedUniversity,
  type UniversityLevel,
  type UniversityPhotoKey,
} from "../platform-university-catalog.ts";
import {
  catalogPhotoSourceMatches,
  catalogText,
  catalogUrl,
  type CatalogPhotoSource,
} from "../catalog-text.ts";
import { STUDY_COUNTRY_CODES, studyCountryName } from "../study-countries.ts";
import { parseCatalogPreparations, type CatalogPreparation } from "./catalog-preparations.ts";
import { parseConsultationReceipt, type ConsultationReceipt } from "./consultation.ts";

export type LocalizedText = Readonly<{ ru: string; ky: string }>;

/** Фото страны или города: объект бакета `portal-university-photos` с атрибуцией. */
export type GeographyPhoto = Readonly<{
  path: string;
  width: number;
  height: number;
  author: string;
  authorUrl: string | null;
  sourceName: CatalogPhotoSource;
  sourceUrl: string;
  license: string;
  licenseUrl: string | null;
}>;

export type IndexCountry = Readonly<{
  code: string;
  name: LocalizedText;
  photo: GeographyPhoto | null;
  summary: LocalizedText | null;
  universityCount: number;
  cityCount: number;
}>;

export type CityFact = Readonly<{ ru: string; ky: string; sourceUrl: string; verifiedOn: string }>;

export type IndexCity = Readonly<{
  key: string;
  country: string;
  name: LocalizedText;
  photo: GeographyPhoto;
  summary: LocalizedText;
  fact: CityFact;
  universityCount: number;
}>;

export type IndexIntake = Readonly<{ deadline: string | null; start: string | null; startMonth: string | null }>;

export type IndexUniversity = Readonly<{
  id: string;
  name: string;
  country: string;
  cityKey: string | null;
  cityLabel: string | null;
  levels: readonly UniversityLevel[];
  photoKey: UniversityPhotoKey | null;
  intakes: readonly IndexIntake[];
  hasCosts: boolean;
}>;

export type StudentUniversityIndex = Readonly<{
  version: string;
  countries: readonly IndexCountry[];
  cities: readonly IndexCity[];
  universities: readonly IndexUniversity[];
}>;

export type StudentUniversityIndexResponse =
  | Readonly<{ notModified: true; version: string }>
  | Readonly<{ notModified: false; index: StudentUniversityIndex }>;

export const COST_KINDS = ["tuition", "accommodation", "application_fee", "insurance", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_PERIODS = ["year", "semester", "month", "week", "day", "once", "program"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];
export type CostSourceKind = "official" | "agency" | "evo_document";

export type CostRow = Readonly<{
  id: string;
  kind: CostKind;
  period: CostPeriod;
  studyLevel: UniversityLevel | null;
  programId: string | null;
  teachingLanguage: string | null;
  currency: string;
  exponent: number;
  amountMinMinor: number;
  amountMaxMinor: number | null;
  usdApproxMin: number | null;
  usdApproxMax: number | null;
  academicYear: string | null;
  note: LocalizedText | null;
  source: Readonly<{ kind: "official"; url: string }> | Readonly<{ kind: "agency" | "evo_document"; url: null }>;
  verifiedOn: string;
}>;

export type FxRate = Readonly<{ currency: string; unitsPerUsd: number; asOf: string; sourceName: string }>;

export type UniversityCosts = Readonly<{ rows: readonly CostRow[]; fxRates: readonly FxRate[] }>;

export type DetailCity = Readonly<{
  key: string;
  country: string;
  name: LocalizedText;
  photo: GeographyPhoto;
  summary: LocalizedText;
  fact: CityFact;
}>;

export type StudentUniversityDetail = Readonly<{
  university: PublishedUniversity;
  country: Readonly<{ code: string; name: LocalizedText }>;
  city: DetailCity | null;
  favored: boolean;
  openConsultation: ConsultationReceipt | null;
  preparations: Readonly<{ studentCaseId: string; items: readonly CatalogPreparation[] }> | null;
  costs: UniversityCosts | null;
}>;

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

/**
 * Что разборщик отбросил или заменил (review S3 веба, F12): неверная
 * карточка страны, города, вуза или строка стоимости больше не роняет весь
 * каталог. Город пропускается (его вузы уходят в «Другие вузы страны»),
 * строка стоимости опускается, фото или текст страны становятся пустыми,
 * а сервер пишет строку журнала. Ключи только каталожные (код страны, ключ
 * города, id вуза или строки, валюта): личных данных нет.
 */
export type CatalogParseIssue = Readonly<{
  item: "country" | "city" | "university" | "cost" | "costs" | "fx_rate";
  key: string | null;
  reason: string;
}>;
export type CatalogParseReporter = (issue: CatalogParseIssue) => void;

const ignore: CatalogParseReporter = () => {};

type Row = Record<string, unknown>;
/** Значение или причина отказа (имя поля). */
type Parsed<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: string }>;
const good = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (reason: string): Parsed<never> => ({ ok: false, reason });

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function exact(row: Row, keys: readonly string[]): boolean {
  const present = Object.keys(row);
  return present.length === keys.length && present.every((key) => keys.includes(key));
}

/** Текст каталога 283: то же правило, что `catalog_text_ok` в базе. */
const text = catalogText;

/**
 * Название вуза и строка его города приходят из карточки вуза (148,
 * `university_text`): разбор не строже базы, иначе одна карточка вычеркнула
 * бы вуз из каталога.
 */
function contentText(value: unknown, max: number): value is string {
  return typeof value === "string" && /[^ ]/u.test(value) && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function localized(value: unknown, max: number): LocalizedText | null {
  const row = record(value);
  if (!row || !exact(row, ["ru", "ky"]) || !text(row.ru, max) || !text(row.ky, max)) return null;
  return { ru: row.ru, ky: row.ky };
}

const PHOTO_KEYS = ["path", "width", "height", "author", "authorUrl", "sourceName", "sourceUrl", "license", "licenseUrl"] as const;

function photo(value: unknown, scope: "countries" | "cities"): GeographyPhoto | null {
  const row = record(value);
  if (!row || !exact(row, PHOTO_KEYS)) return null;
  const pattern = new RegExp(`^geography/${scope}/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\\.(?:jpg|png|webp|avif)$`, "u");
  if (typeof row.path !== "string" || !pattern.test(row.path)
    || !Number.isSafeInteger(row.width) || Number(row.width) < 1 || Number(row.width) > 99999
    || !Number.isSafeInteger(row.height) || Number(row.height) < 1 || Number(row.height) > 99999
    || !text(row.author, 200) || !(row.authorUrl === null || catalogUrl(row.authorUrl))
    || !catalogUrl(row.sourceUrl) || !catalogPhotoSourceMatches(row.sourceName, row.sourceUrl)
    || !text(row.license, 120) || !(row.licenseUrl === null || catalogUrl(row.licenseUrl))) return null;
  return {
    path: row.path,
    width: row.width as number,
    height: row.height as number,
    author: row.author,
    authorUrl: row.authorUrl as string | null,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    license: row.license,
    licenseUrl: row.licenseUrl as string | null,
  };
}

function fact(value: unknown): CityFact | null {
  const row = record(value);
  if (!row || !exact(row, ["ru", "ky", "sourceUrl", "verifiedOn"]) || !text(row.ru, 200) || !text(row.ky, 200)
    || !catalogUrl(row.sourceUrl) || !universityDate(row.verifiedOn)) return null;
  return { ru: row.ru, ky: row.ky, sourceUrl: row.sourceUrl, verifiedOn: row.verifiedOn };
}

const CITY_KEY = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$/u;

function cityKeyOf(value: unknown): string | null {
  const row = record(value);
  return row && typeof row.key === "string" && CITY_KEY.test(row.key) ? row.key : null;
}

function city(value: unknown, withCount: boolean): Parsed<DetailCity & { universityCount?: number }> {
  const row = record(value);
  const keys = ["key", "country", "name", "photo", "summary", "fact", ...(withCount ? ["universityCount"] : [])];
  if (!row || !exact(row, keys)) return bad("keys");
  if (typeof row.key !== "string" || !CITY_KEY.test(row.key)) return bad("key");
  if (typeof row.country !== "string" || !STUDY_COUNTRY_CODES.includes(row.country)) return bad("country");
  const name = localized(row.name, 100);
  if (!name) return bad("name");
  const cityPhoto = photo(row.photo, "cities");
  if (!cityPhoto) return bad("photo");
  const summary = localized(row.summary, 300);
  if (!summary) return bad("summary");
  const cityFact = fact(row.fact);
  if (!cityFact) return bad("fact");
  return good({
    key: row.key,
    country: row.country,
    name,
    photo: cityPhoto,
    summary,
    fact: cityFact,
    ...(withCount && count(row.universityCount) ? { universityCount: row.universityCount } : {}),
  });
}

function month(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
}

function intake(value: unknown): IndexIntake | null {
  const row = record(value);
  if (!row || !exact(row, ["deadline", "start", "startMonth"])
    || !(row.deadline === null || universityDate(row.deadline))
    || !(row.start === null || universityDate(row.start))
    || !(row.startMonth === null || month(row.startMonth))) return null;
  return { deadline: row.deadline as string | null, start: row.start as string | null, startMonth: row.startMonth as string | null };
}

const UNIVERSITY_KEYS = ["id", "name", "country", "cityKey", "cityLabel", "levels", "photoKey", "intakes", "hasCosts"] as const;

/**
 * Краткая карточка вуза. Без id, названия и страны вуза нет; остальное
 * деградирует по полю: неверный набор дат даёт «даты уточняются», неверный
 * ключ города или подпись города уводят вуз в «Другие вузы страны».
 */
function university(value: unknown, report: CatalogParseReporter): Parsed<IndexUniversity> {
  const row = record(value);
  if (!row) return bad("shape");
  const id = universityUuid(row.id);
  if (!id) return bad("id");
  if (!contentText(row.name, 300)) return bad("name");
  if (typeof row.country !== "string" || !STUDY_COUNTRY_CODES.includes(row.country)) return bad("country");
  const note = (reason: string) => report({ item: "university", key: id, reason });
  if (!exact(row, UNIVERSITY_KEYS)) note("keys");
  let cityKey: string | null = null;
  if (row.cityKey !== null && row.cityKey !== undefined) {
    if (typeof row.cityKey === "string" && CITY_KEY.test(row.cityKey)) cityKey = row.cityKey;
    else note("cityKey");
  }
  let cityLabel: string | null = null;
  if (row.cityLabel !== null && row.cityLabel !== undefined) {
    if (contentText(row.cityLabel, 200)) cityLabel = row.cityLabel;
    else note("cityLabel");
  }
  const rawLevels = Array.isArray(row.levels) ? row.levels : [];
  if (!Array.isArray(row.levels) || rawLevels.some((level) => !UNIVERSITY_LEVELS.includes(level as UniversityLevel))
    || new Set(rawLevels).size !== rawLevels.length) note("levels");
  const intakes: IndexIntake[] = [];
  if (Array.isArray(row.intakes) && row.intakes.length <= 400) {
    for (const entry of row.intakes) {
      const parsed = intake(entry);
      if (!parsed) {
        // Один неверный срок: честное «даты уточняются», а не чужой срок.
        note("intakes");
        intakes.length = 0;
        break;
      }
      intakes.push(parsed);
    }
  } else note("intakes");
  if (typeof row.hasCosts !== "boolean") note("hasCosts");
  // Ключ фото, которого нет в библиотеке этой сборки: честная заглушка
  // «фото не добавлено», а не отказ всего каталога.
  const photoKey = typeof row.photoKey === "string" && Object.hasOwn(UNIVERSITY_PHOTOS, row.photoKey)
    ? row.photoKey as UniversityPhotoKey
    : null;
  return good({
    id,
    name: row.name,
    country: row.country,
    cityKey,
    cityLabel,
    levels: UNIVERSITY_LEVELS.filter((level) => rawLevels.includes(level)),
    photoKey,
    intakes,
    hasCosts: row.hasCosts === true,
  });
}

function version(value: unknown): value is string {
  return text(value, 100);
}

const COUNTRY_KEYS = ["code", "name", "photo", "summary", "universityCount", "cityCount"] as const;

/** Карточка страны: код и порядок обязательны (282), остальное деградирует. */
function country(item: Row, code: string, report: CatalogParseReporter): Omit<IndexCountry, "universityCount" | "cityCount"> {
  const note = (reason: string) => report({ item: "country", key: code, reason });
  if (!exact(item, COUNTRY_KEYS)) note("keys");
  let name = localized(item.name, 100);
  if (!name) {
    note("name");
    name = { ru: studyCountryName(code, "ru") ?? code, ky: studyCountryName(code, "ky") ?? code };
  }
  let countryPhoto: GeographyPhoto | null = null;
  if (item.photo !== null && item.photo !== undefined) {
    countryPhoto = photo(item.photo, "countries");
    if (!countryPhoto) note("photo");
  }
  let summary: LocalizedText | null = null;
  if (item.summary !== null && item.summary !== undefined) {
    summary = localized(item.summary, 300);
    if (!summary) note("summary");
  }
  return { code, name, photo: countryPhoto, summary };
}

/**
 * Разбор `student_university_index_v1`. Отказ всего индекса (null) только
 * при неверной обёртке: ключи ответа, версия, шесть стран в порядке
 * продукта. Неверный город, вуз или поле страны отбрасываются по одному
 * (`report`), счётчики считаются по тому, что осталось (приёмка 7.6.2).
 */
export function parseStudentUniversityIndexResponse(value: unknown, report: CatalogParseReporter = ignore): StudentUniversityIndexResponse | null {
  const row = record(value);
  if (!row) return null;
  if (row.notModified === true) {
    return exact(row, ["notModified", "version"]) && version(row.version)
      ? { notModified: true, version: row.version }
      : null;
  }
  if (row.notModified !== false || !exact(row, ["notModified", "version", "countries", "cities", "universities"])
    || !version(row.version) || !Array.isArray(row.countries) || !Array.isArray(row.cities)
    || !Array.isArray(row.universities) || row.universities.length > 5000 || row.cities.length > 1000
    || row.countries.length !== STUDY_COUNTRY_CODES.length) return null;

  // Страны всегда шесть и в порядке продукта (282).
  const countryItems: Row[] = [];
  for (const [index, entry] of row.countries.entries()) {
    const item = record(entry);
    if (!item || item.code !== STUDY_COUNTRY_CODES[index]) return null;
    countryItems.push(item);
  }

  const cities: (DetailCity & { universityCount?: number })[] = [];
  const cityCountry = new Map<string, string>();
  for (const entry of row.cities) {
    const parsed = city(entry, true);
    const key = parsed.ok ? parsed.value.key : cityKeyOf(entry);
    if (!parsed.ok) {
      report({ item: "city", key, reason: parsed.reason });
      continue;
    }
    if (cityCountry.has(parsed.value.key)) {
      report({ item: "city", key, reason: "duplicate" });
      continue;
    }
    cityCountry.set(parsed.value.key, parsed.value.country);
    cities.push(parsed.value);
  }

  const universities: IndexUniversity[] = [];
  const ids = new Set<string>();
  for (const entry of row.universities) {
    const parsed = university(entry, report);
    if (!parsed.ok) {
      report({ item: "university", key: universityUuid(record(entry)?.id), reason: parsed.reason });
      continue;
    }
    let item = parsed.value;
    if (ids.has(item.id)) {
      report({ item: "university", key: item.id, reason: "duplicate" });
      continue;
    }
    // Город, которого нет в индексе или который другой страны: вуз в
    // «Другие вузы страны».
    if (item.cityKey !== null && cityCountry.get(item.cityKey) !== item.country) {
      report({ item: "university", key: item.id, reason: "city" });
      item = { ...item, cityKey: null };
    }
    ids.add(item.id);
    universities.push(item);
  }

  // Счётчики выдачи сходятся с её же списками: сумма вузов по странам равна
  // числу вузов, город считает свои вузы (приёмка 7.6.2). Расхождение с
  // числами сервера только пишется в журнал.
  const indexCities: IndexCity[] = [];
  for (const entry of cities) {
    const own = universities.filter((item) => item.cityKey === entry.key).length;
    if (own === 0) {
      report({ item: "city", key: entry.key, reason: "empty" });
      continue;
    }
    if (entry.universityCount !== own) report({ item: "city", key: entry.key, reason: "count" });
    indexCities.push({ ...entry, universityCount: own });
  }
  const countries: IndexCountry[] = countryItems.map((item, index) => {
    const code = STUDY_COUNTRY_CODES[index]!;
    const universityCount = universities.filter((entry) => entry.country === code).length;
    const cityCount = indexCities.filter((entry) => entry.country === code).length;
    if (item.universityCount !== universityCount || item.cityCount !== cityCount) report({ item: "country", key: code, reason: "count" });
    return { ...country(item, code, report), universityCount, cityCount };
  });

  return { notModified: false, index: { version: row.version, countries, cities: indexCities, universities } };
}

const COST_KEYS = [
  "id", "kind", "period", "studyLevel", "programId", "teachingLanguage", "currency", "exponent",
  "amountMinMinor", "amountMaxMinor", "usdApproxMin", "usdApproxMax", "academicYear", "note", "source", "verifiedOn",
] as const;

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function costRow(value: unknown): Parsed<CostRow> {
  const row = record(value);
  if (!row || !exact(row, COST_KEYS)) return bad("keys");
  const id = universityUuid(row.id);
  if (!id) return bad("id");
  if (!COST_KINDS.includes(row.kind as CostKind)) return bad("kind");
  if (!COST_PERIODS.includes(row.period as CostPeriod)) return bad("period");
  if (!(row.studyLevel === null || UNIVERSITY_LEVELS.includes(row.studyLevel as UniversityLevel))) return bad("studyLevel");
  if (!(row.programId === null || (typeof row.programId === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(row.programId)))) return bad("programId");
  if (!(row.teachingLanguage === null || (typeof row.teachingLanguage === "string" && /^[a-z]{2}$/u.test(row.teachingLanguage)))) return bad("teachingLanguage");
  if (typeof row.currency !== "string" || !/^[A-Z]{3}$/u.test(row.currency)) return bad("currency");
  if (!Number.isSafeInteger(row.exponent) || Number(row.exponent) < 0 || Number(row.exponent) > 4) return bad("exponent");
  if (!amount(row.amountMinMinor) || !(row.amountMaxMinor === null || (amount(row.amountMaxMinor) && row.amountMaxMinor > row.amountMinMinor))) return bad("amount");
  if (!(row.usdApproxMin === null || amount(row.usdApproxMin)) || !(row.usdApproxMax === null || amount(row.usdApproxMax))
    || (row.usdApproxMax !== null && (row.amountMaxMinor === null || row.usdApproxMin === null))) return bad("usd");
  if (!(row.academicYear === null || (typeof row.academicYear === "string" && /^20\d{2}(?:\/\d{2})?$/u.test(row.academicYear)))) return bad("academicYear");
  const note = row.note === null ? null : localized(row.note, 300);
  if (row.note !== null && !note) return bad("note");
  const source = record(row.source);
  if (!source || !exact(source, ["kind", "url"])
    || !(source.kind === "official" ? catalogUrl(source.url) : ((source.kind === "agency" || source.kind === "evo_document") && source.url === null))) return bad("source");
  if (!universityDate(row.verifiedOn)) return bad("verifiedOn");
  return good({
    id,
    kind: row.kind as CostKind,
    period: row.period as CostPeriod,
    studyLevel: row.studyLevel as UniversityLevel | null,
    programId: row.programId as string | null,
    teachingLanguage: row.teachingLanguage as string | null,
    currency: row.currency,
    exponent: row.exponent as number,
    amountMinMinor: row.amountMinMinor,
    amountMaxMinor: row.amountMaxMinor as number | null,
    usdApproxMin: row.usdApproxMin as number | null,
    usdApproxMax: row.usdApproxMax as number | null,
    academicYear: row.academicYear as string | null,
    note,
    source: source.kind === "official"
      ? { kind: "official", url: source.url as string }
      : { kind: source.kind as "agency" | "evo_document", url: null },
    verifiedOn: row.verifiedOn,
  });
}

function fxRate(value: unknown): FxRate | null {
  const row = record(value);
  if (!row || !exact(row, ["currency", "unitsPerUsd", "asOf", "sourceName"])
    || typeof row.currency !== "string" || !/^[A-Z]{3}$/u.test(row.currency)
    || typeof row.unitsPerUsd !== "number" || !Number.isFinite(row.unitsPerUsd) || row.unitsPerUsd <= 0
    || !universityDate(row.asOf) || !text(row.sourceName, 200)) return null;
  return { currency: row.currency, unitsPerUsd: row.unitsPerUsd, asOf: row.asOf, sourceName: row.sourceName };
}

/**
 * Блок «Стоимость»: неверная строка или курс опускаются по одному; строка
 * без своего курса теряет ориентир в USD (сумма без названного курса не
 * показывается); не осталось строк: блока нет.
 */
function costs(value: unknown, report: CatalogParseReporter): UniversityCosts | null {
  if (value === null) return null;
  const row = record(value);
  if (!row || !exact(row, ["rows", "fxRates"]) || !Array.isArray(row.rows) || !Array.isArray(row.fxRates)) {
    report({ item: "costs", key: null, reason: "shape" });
    return null;
  }
  const rows: CostRow[] = [];
  const ids = new Set<string>();
  for (const entry of row.rows.slice(0, 500)) {
    const parsed = costRow(entry);
    if (!parsed.ok) {
      report({ item: "cost", key: universityUuid(record(entry)?.id), reason: parsed.reason });
      continue;
    }
    if (ids.has(parsed.value.id)) {
      report({ item: "cost", key: parsed.value.id, reason: "duplicate" });
      continue;
    }
    ids.add(parsed.value.id);
    rows.push(parsed.value);
  }
  if (row.rows.length > 500) report({ item: "costs", key: null, reason: "rows" });
  const fxRates: FxRate[] = [];
  for (const entry of row.fxRates.slice(0, 50)) {
    const parsed = fxRate(entry);
    const currency = typeof record(entry)?.currency === "string" ? String(record(entry)?.currency).slice(0, 3) : null;
    if (!parsed || fxRates.some((rate) => rate.currency === parsed.currency)) {
      report({ item: "fx_rate", key: currency, reason: parsed ? "duplicate" : "invalid" });
      continue;
    }
    fxRates.push(parsed);
  }
  const rated = new Set(fxRates.map((rate) => rate.currency));
  const shown = rows.map((entry) => {
    if (entry.usdApproxMin === null || rated.has(entry.currency)) return entry;
    report({ item: "cost", key: entry.id, reason: "rate" });
    return { ...entry, usdApproxMin: null, usdApproxMax: null };
  });
  if (shown.length === 0) {
    report({ item: "costs", key: null, reason: "empty" });
    return null;
  }
  return { rows: shown, fxRates };
}

/**
 * Разбор `student_university_detail_v1`. `expectedId`: вуз из адреса
 * страницы: ответ о другом вузе считается сбоем, а не подменой. Карточка
 * вуза, страна, избранное, консультация и подготовки строгие (null при
 * отклонении); город и стоимость деградируют по одному (`report`).
 */
export function parseStudentUniversityDetail(value: unknown, expectedId: string, report: CatalogParseReporter = ignore): StudentUniversityDetail | null {
  const row = record(value);
  if (!row || !exact(row, ["university", "country", "city", "favored", "openConsultation", "preparations", "costs"])) return null;
  const page = parseUniversityPage({ items: [row.university], nextOffset: null });
  const item = page?.items[0];
  const countryRow = record(row.country);
  const openConsultation = row.openConsultation === null ? null : parseConsultationReceipt(row.openConsultation);
  if (!item || item.id !== expectedId || !countryRow || countryRow.code !== item.content.country
    || typeof countryRow.code !== "string" || !STUDY_COUNTRY_CODES.includes(countryRow.code)
    || typeof row.favored !== "boolean"
    || (row.openConsultation !== null && !openConsultation)) return null;
  const code = countryRow.code;
  let countryName = exact(countryRow, ["code", "name"]) ? localized(countryRow.name, 100) : null;
  if (!countryName) {
    report({ item: "country", key: code, reason: "name" });
    countryName = { ru: studyCountryName(code, "ru") ?? code, ky: studyCountryName(code, "ky") ?? code };
  }
  let detailCity: DetailCity | null = null;
  if (row.city !== null) {
    const parsed = city(row.city, false);
    if (!parsed.ok) report({ item: "city", key: cityKeyOf(row.city), reason: parsed.reason });
    else if (parsed.value.country !== code) report({ item: "city", key: parsed.value.key, reason: "country" });
    else detailCity = parsed.value;
  }
  let preparations: StudentUniversityDetail["preparations"] = null;
  if (row.preparations !== null) {
    const prep = record(row.preparations);
    const studentCaseId = universityUuid(prep?.studentCaseId);
    if (!prep || !exact(prep, ["studentCaseId", "items"]) || !studentCaseId) return null;
    const items = parseCatalogPreparations(prep.items, studentCaseId);
    if (!items || items.some((entry) => entry.institutionId !== item.id)) return null;
    preparations = { studentCaseId, items };
  }
  return {
    university: item,
    country: { code, name: countryName },
    city: detailCity,
    favored: row.favored,
    openConsultation,
    preparations,
    costs: costs(row.costs, report),
  };
}

// ---------------------------------------------------------------------------
// Помощники экранов
// ---------------------------------------------------------------------------

export function localizedText(value: LocalizedText, locale: Locale): string {
  return locale === "ky" ? value.ky : value.ru;
}

/** Адрес страны: код в нижнем регистре: /portal/universities/country/cn. */
export function countrySlug(code: string): string {
  return code.toLowerCase();
}

/** Код страны продукта по сегменту адреса; null: неверный адрес. */
export function countryCodeFromSlug(slug: string): string | null {
  return /^[a-z]{2}$/u.test(slug) && STUDY_COUNTRY_CODES.includes(slug.toUpperCase()) ? slug.toUpperCase() : null;
}

export const UNIVERSITIES_BASE = "/portal/universities";

export function countryHref(code: string, view: "cities" | "map" = "cities"): string {
  return `${UNIVERSITIES_BASE}/country/${countrySlug(code)}${view === "map" ? "?view=map" : ""}`;
}

export function cityHref(code: string, cityKey: string): string {
  return `${UNIVERSITIES_BASE}/country/${countrySlug(code)}/${cityKey}`;
}

export function universityHref(id: string): string {
  return `${UNIVERSITIES_BASE}/${id}`;
}

function collator(locale: Locale): Intl.Collator {
  return new Intl.Collator(locale === "ky" ? "ky" : "ru");
}

/** Города страны: больше вузов выше, затем по названию на языке интерфейса. */
export function countryCities(index: StudentUniversityIndex, code: string, locale: Locale): readonly IndexCity[] {
  const compare = collator(locale);
  return index.cities
    .filter((entry) => entry.country === code)
    .sort((a, b) => b.universityCount - a.universityCount
      || compare.compare(localizedText(a.name, locale), localizedText(b.name, locale)));
}

/** Вузы страны без опубликованного города: блок «Другие вузы страны». */
export function countryUniversitiesWithoutCity(index: StudentUniversityIndex, code: string): readonly IndexUniversity[] {
  return index.universities.filter((entry) => entry.country === code && entry.cityKey === null);
}

export function cityUniversities(index: StudentUniversityIndex, cityKey: string): readonly IndexUniversity[] {
  return index.universities.filter((entry) => entry.cityKey === cityKey);
}

export { normalizeUniversitySearch, searchUniversities } from "./university-search.ts";

export type NearestIndexIntake = Readonly<{ kind: "deadline" | "start" | "startMonth"; value: string }>;

/**
 * «Ближайший набор» по датам индекса тем же правилом, что
 * `nearestUniversityIntake` для полной карточки: сначала ближайший будущий
 * срок подачи, иначе ближайшее начало (дата раньше месяца без даты).
 */
export function nearestIndexIntake(intakes: readonly IndexIntake[], now: Date): NearestIndexIntake | null {
  const today = now.toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  let deadline: string | null = null;
  let start: string | null = null;
  let startMonth: string | null = null;
  for (const entry of intakes) {
    if (entry.deadline && entry.deadline >= today && (deadline === null || entry.deadline < deadline)) deadline = entry.deadline;
    if (entry.start && entry.start >= today && (start === null || entry.start < start)) start = entry.start;
    if (!entry.start && entry.startMonth && entry.startMonth >= thisMonth
      && (startMonth === null || entry.startMonth < startMonth)) startMonth = entry.startMonth;
  }
  if (deadline !== null) return { kind: "deadline", value: deadline };
  if (start !== null && (startMonth === null || start.slice(0, 7) <= startMonth)) return { kind: "start", value: start };
  if (startMonth !== null) return { kind: "startMonth", value: startMonth };
  return null;
}

/** Склонение счётчика по правилам русского; у кыргызского форма одна. */
export function countForm(value: number): "one" | "few" | "many" {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

export type LegacyUniversitiesRoute =
  | Readonly<{ kind: "page"; query: string }>
  | Readonly<{ kind: "redirect"; href: string }>
  | Readonly<{ kind: "invalid" }>;

/**
 * Адрес `/portal/universities?…`: новый вид: только необязательный `q`
 * (поиск по названию). Прежние адреса списка и карты (`view`, `country`,
 * `level`, `offset`) ведут на новые экраны: карта страны остаётся картой
 * страны, поиск остаётся поиском (план 7.3).
 */
export function resolveUniversitiesRoute(params: Readonly<Record<string, string | string[] | undefined>>): LegacyUniversitiesRoute {
  const keys = Object.keys(params).filter((key) => params[key] !== undefined);
  if (keys.some((key) => !["q", "view", "country", "level", "offset"].includes(key) || Array.isArray(params[key]))) {
    return { kind: "invalid" };
  }
  const value = (key: string) => (typeof params[key] === "string" ? params[key] as string : "");
  const query = value("q");
  const view = value("view");
  const country = value("country");
  const level = value("level");
  const offset = value("offset");
  if (query.length > 100 || /[\u0000-\u001f\u007f]/u.test(query)
    || (params.view !== undefined && view !== "map" && view !== "list")
    || (country !== "" && !STUDY_COUNTRY_CODES.includes(country))
    || (level !== "" && !UNIVERSITY_LEVELS.includes(level as UniversityLevel))
    || (offset !== "" && !/^(?:0|[1-9]\d{0,4})$/u.test(offset))) return { kind: "invalid" };
  const legacy = keys.some((key) => key !== "q");
  const trimmed = query.trim();
  if (!legacy) return { kind: "page", query };
  if (trimmed !== "") return { kind: "redirect", href: `${UNIVERSITIES_BASE}?${new URLSearchParams({ q: trimmed })}` };
  if (country !== "") return { kind: "redirect", href: countryHref(country, view === "map" ? "map" : "cities") };
  return { kind: "redirect", href: UNIVERSITIES_BASE };
}
