/**
 * «Путь поступления» на «Главной» (S4, план docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md
 * §8): строгий разбор файлов src/content/timelines/*.json и выбор того, что
 * видит студент. Контракт для веба и iPhone: docs/portal/country-timeline-contract.md.
 *
 * Те же семь файлов iPhone берёт ресурсами bundle (ios/project.yml), поэтому
 * правила выбора здесь и в Swift одни: только `approved` страна показывается
 * своим таймлайном, иначе общий маршрут (undecided.json) с названием страны;
 * пункты `verify` скрыты; после `validUntil` тексты с годом заменяются своим
 * вариантом `undated` (или скрываются, где это разрешено).
 *
 * Файлы проверяются при импорте: неверный файл ломает сборку и тесты, а не
 * показывает студенту неполный путь. Модуль клиент-безопасный (без
 * server-only и Supabase), но импортировать его лучше в серверных
 * компонентах: в клиент уходит только выбранный и локализованный путь.
 */
import cn from "../../content/timelines/cn.json" with { type: "json" };
import my from "../../content/timelines/my.json" with { type: "json" };
import ae from "../../content/timelines/ae.json" with { type: "json" };
import tr from "../../content/timelines/tr.json" with { type: "json" };
import it from "../../content/timelines/it.json" with { type: "json" };
import cz from "../../content/timelines/cz.json" with { type: "json" };
import undecided from "../../content/timelines/undecided.json" with { type: "json" };
import { STUDY_COUNTRY_CODES, studyCountryName } from "../study-countries.ts";

/** Значение выбора «Пока не решил» в RPC выбора страны (284) и здесь. */
export const TIMELINE_UNDECIDED = "UNDECIDED";

/** Ключи файлов: шесть стран в порядке продукта и общий маршрут. */
export const COUNTRY_TIMELINE_FILE_KEYS: readonly string[] = Object.freeze([
  ...STUDY_COUNTRY_CODES.map((code) => code.toLowerCase()),
  "undecided",
]);

export type TimelineLocale = "ru" | "ky";
export type L10n = Readonly<{ ru: string; ky: string }>;
/** Текст студенту; `undated` есть ровно у текстов с годом (см. правила). */
export type TimelineText = Readonly<{ ru: string; ky: string; undated?: L10n | null }>;

export const TIMELINE_STATUSES = ["draft", "owner_review", "approved"] as const;
export const TIMELINE_STAGE_KEYS = [
  "intake",
  "profile_and_route",
  "documents",
  "applications",
  "decisions",
  "visa_and_predeparture",
  "arrival_and_adaptation",
] as const;
export const TIMELINE_WHO = ["student", "evo", "university", "embassy"] as const;
export const TIMELINE_APP_MODULES = ["csca"] as const;

export type TimelineStatus = (typeof TIMELINE_STATUSES)[number];
export type TimelineStageKey = (typeof TIMELINE_STAGE_KEYS)[number];
export type TimelineWho = (typeof TIMELINE_WHO)[number];
export type TimelineAppModule = (typeof TIMELINE_APP_MODULES)[number];

export type TimelineOffset = Readonly<{ value: number; unit: "week" | "month" }>;
export type TimelineTiming = Readonly<{
  from: TimelineOffset;
  to: TimelineOffset;
  label: TimelineText;
  basis: "owner_guide" | "official" | "evo_internal" | "estimate";
}>;
export type TimelineItem = Readonly<{
  id: string;
  who: TimelineWho;
  status: "confirmed" | "verify";
  text: TimelineText;
  note?: TimelineText;
  appliesTo?: TimelineText;
  sources: readonly string[];
}>;
export type TimelineLink = Readonly<{ id: string; label: L10n; url: string; appModule?: TimelineAppModule }>;
export type TimelineStep = Readonly<{
  id: string;
  order: number;
  stageKeys: readonly TimelineStageKey[];
  title: TimelineText;
  summary: TimelineText;
  timing: TimelineTiming | null;
  checklist: readonly TimelineItem[];
  note?: TimelineText;
  doneWhen: TimelineText;
  links?: readonly TimelineLink[];
  sources: readonly string[];
}>;
export type TimelineSource = Readonly<{
  id: string;
  kind: "owner_guide" | "evo_internal" | "official" | "university" | "secondary";
  title: string;
  url?: string;
  checkedOn: string;
}>;
export type CountryTimelineFile = Readonly<{
  schemaVersion: 1;
  contentVersion: number;
  country: string;
  name: L10n;
  status: TimelineStatus;
  updatedOn: string;
  validUntil: string;
  kyStatus: "needs_native_proofreading" | "proofread";
  intake: Readonly<{ model: "annual" | "rolling" | "none"; reference: string | null; label: TimelineText; note?: TimelineText }>;
  disclaimers: Readonly<{ timing: L10n; documents: L10n; decisions: L10n }>;
  steps: readonly TimelineStep[];
  sources: readonly TimelineSource[];
}>;

// ---------------------------------------------------------------------------
// Правила текста (те же проверяет тест контента и описывает контракт).
// ---------------------------------------------------------------------------

/** Абсолютная дата: год 19xx/20xx или полная дата дд.мм.гггг. */
export const ABSOLUTE_DATE = /(?<!\d)(?:19|20)\d{2}(?!\d)|(?<!\d)\d{1,2}\.\d{1,2}\.\d{2,4}(?!\d)/u;
/** Длинное и короткое тире, цифровое тире и знак минуса (план, правила текста). */
const DASHES = /[‒-―−]/u;
/** Обещания (план §8.1). В оговорке `decisions` есть только отрицание «не гарантирует». */
export const FORBIDDEN_PROMISES: readonly RegExp[] = Object.freeze([
  /гарантир/iu,
  /100\s*%/u,
  /точно\s+получ/iu,
  /кепилд/iu,
  /сөзсүз\s+аласыз/iu,
]);
/** Внутренние сведения, которых студент не видит (план §8.1, guides.md §8). */
export const INTERNAL_MARKERS: readonly RegExp[] = Object.freeze([
  /ОЗО/u,
  /отдел\p{L}*\s+продаж/iu,
  /регламент/iu,
  /плейбук/iu,
  /скрипт/iu,
  /агентск/iu,
  /EDUPRCHINA/iu,
  /промокод|скидк/iu,
  /[^\s@]+@[^\s@]+\.[^\s@]+/u,
  /\+\d[\d\s()-]{7,}/u,
]);
/** Внутренние пути никогда не попадают в файл: он целиком лежит в bundle iPhone. */
const INTERNAL_PATHS = /~\/|Downloads|EVO_Знания|\.docx|\.pdf\b|supabase\/admissions-content/u;
const LETTERS = /[\p{L}]+/gu;
const LATIN = /[A-Za-zÀ-ɏ]/u;
const CYRILLIC = /[Ѐ-ӿ]/u;
/** Латинский термин с кыргызским окончанием («HSKга», «Universitalyде») допустим. */
const LATIN_WITH_SUFFIX = /^[A-Za-zÀ-ɏ]+[Ѐ-ӿ]+$/u;

const DISCLAIMER_MARKERS = Object.freeze({
  timing: { ru: /^Сроки ориентировочные/u, ky: /^Мөөнөттөр болжолдуу/u },
  documents: { ru: /^Окончательный список документов зависит от /u, ky: /^Документтердин акыркы тизмеси /u },
  decisions: { ru: /^Решение о зачислении.*; EVO их не гарантирует\.$/u, ky: /; EVO буларга кепилдик бербейт\.$/u },
});

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;
const SOURCE_ID = /^[A-Z0-9][A-Z0-9-]{0,31}$/u;
const LINK_ID = /^[a-z][a-z0-9-]{0,31}$/u;

class TimelineContentError extends Error {
  constructor(file: string, path: string, reason: string) {
    super(`timeline ${file}: ${path}: ${reason}`);
    this.name = "TimelineContentError";
  }
}

type Ctx = Readonly<{ file: string; fail: (path: string, reason: string) => never }>;

function record(ctx: Ctx, value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) ctx.fail(path, "not an object");
  const row = value as Record<string, unknown>;
  for (const key of required) if (!(key in row)) ctx.fail(path, `missing ${key}`);
  for (const key of Object.keys(row)) {
    if (!required.includes(key) && !optional.includes(key)) ctx.fail(path, `unknown key ${key}`);
  }
  return row;
}

function oneOf<T extends string>(ctx: Ctx, value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) ctx.fail(path, `not one of ${allowed.join(", ")}`);
  return value as T;
}

function isoDate(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    ctx.fail(path, "not a YYYY-MM-DD date");
  }
  return value as string;
}

function plain(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || /\s{2,}/u.test(value)) {
    ctx.fail(path, "empty or untrimmed text");
  }
  if (DASHES.test(value as string)) ctx.fail(path, "em or en dash");
  if (INTERNAL_PATHS.test(value as string)) ctx.fail(path, "internal path");
  return value as string;
}

/** Строка, которую видит студент: все правила текста. */
function studentString(ctx: Ctx, value: unknown, path: string, options: Readonly<{ promisesChecked?: boolean }> = {}): string {
  const text = plain(ctx, value, path);
  for (const word of text.match(LETTERS) ?? []) {
    if (LATIN.test(word) && CYRILLIC.test(word) && !LATIN_WITH_SUFFIX.test(word)) ctx.fail(path, `mixed script word ${word}`);
  }
  if (!options.promisesChecked) {
    for (const pattern of FORBIDDEN_PROMISES) if (pattern.test(text)) ctx.fail(path, `forbidden promise ${pattern}`);
  }
  for (const pattern of INTERNAL_MARKERS) if (pattern.test(text)) ctx.fail(path, `internal detail ${pattern}`);
  return text;
}

/** L10n без дат: название, оговорки, подписи ссылок. */
function l10n(ctx: Ctx, value: unknown, path: string, options: Readonly<{ promisesChecked?: boolean }> = {}): L10n {
  const row = record(ctx, value, path, ["ru", "ky"]);
  const ru = studentString(ctx, row.ru, `${path}.ru`, options);
  const ky = studentString(ctx, row.ky, `${path}.ky`, options);
  if (ABSOLUTE_DATE.test(ru) || ABSOLUTE_DATE.test(ky)) ctx.fail(path, "absolute date in an undated field");
  return Object.freeze({ ru, ky });
}

/**
 * Текст с возможной датой. Есть год → обязателен `undated`: замена без даты,
 * или `null` (только где `hideable`: поле или пункт скрывается после
 * validUntil). Нет года → `undated` запрещён.
 */
function text(ctx: Ctx, value: unknown, path: string, hideable: boolean): TimelineText {
  const row = record(ctx, value, path, ["ru", "ky"], ["undated"]);
  const ru = studentString(ctx, row.ru, `${path}.ru`);
  const ky = studentString(ctx, row.ky, `${path}.ky`);
  const dated = ABSOLUTE_DATE.test(ru) || ABSOLUTE_DATE.test(ky);
  if (!dated) {
    if ("undated" in row) ctx.fail(path, "undated variant for a text without a date");
    return Object.freeze({ ru, ky });
  }
  if (!("undated" in row)) ctx.fail(path, "a text with a date needs an undated variant");
  if (row.undated === null) {
    if (!hideable) ctx.fail(path, "this field cannot be hidden after validUntil");
    return Object.freeze({ ru, ky, undated: null });
  }
  return Object.freeze({ ru, ky, undated: l10n(ctx, row.undated, `${path}.undated`) });
}

function offset(ctx: Ctx, value: unknown, path: string): TimelineOffset {
  const row = record(ctx, value, path, ["value", "unit"]);
  if (!Number.isInteger(row.value) || Math.abs(row.value as number) > 104) ctx.fail(`${path}.value`, "not an integer offset");
  return Object.freeze({ value: row.value as number, unit: oneOf(ctx, row.unit, `${path}.unit`, ["week", "month"] as const) });
}

function sourceRefs(ctx: Ctx, value: unknown, path: string, known: ReadonlySet<string>, used: Set<string>): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) ctx.fail(path, "needs at least one source");
  const refs = value as unknown[];
  if (new Set(refs).size !== refs.length) ctx.fail(path, "duplicate source");
  for (const ref of refs) {
    if (typeof ref !== "string" || !known.has(ref)) ctx.fail(path, `unknown source ${String(ref)}`);
    used.add(ref as string);
  }
  return Object.freeze([...(refs as string[])]);
}

/**
 * Строгий разбор одного файла. `key`: имя файла без `.json` (`cn` … `cz`,
 * `undecided`). Любое отклонение от схемы бросает ошибку с путём поля.
 */
export function parseCountryTimelineFile(value: unknown, key: string): CountryTimelineFile {
  const ctx: Ctx = { file: key, fail: (path, reason) => { throw new TimelineContentError(key, path, reason); } };
  if (!COUNTRY_TIMELINE_FILE_KEYS.includes(key)) ctx.fail("$", "unknown file key");
  const general = key === "undecided";
  const root = record(ctx, value, "$", ["schemaVersion", "contentVersion", "country", "name", "status", "updatedOn",
    "validUntil", "kyStatus", "intake", "disclaimers", "steps", "sources"]);
  if (root.schemaVersion !== 1) ctx.fail("$.schemaVersion", "not 1");
  if (!Number.isInteger(root.contentVersion) || (root.contentVersion as number) < 1) ctx.fail("$.contentVersion", "not a positive integer");
  const country = general ? TIMELINE_UNDECIDED : key.toUpperCase();
  if (root.country !== country) ctx.fail("$.country", `not ${country}`);
  const name = l10n(ctx, root.name, "$.name");
  if (!general && (name.ru !== studyCountryName(country, "ru") || name.ky !== studyCountryName(country, "ky"))) {
    ctx.fail("$.name", "differs from src/lib/study-countries.json");
  }
  const status = oneOf(ctx, root.status, "$.status", TIMELINE_STATUSES);
  if (general && status !== "approved") ctx.fail("$.status", "the general route must be approved");
  const updatedOn = isoDate(ctx, root.updatedOn, "$.updatedOn");
  const validUntil = isoDate(ctx, root.validUntil, "$.validUntil");
  if (validUntil <= updatedOn) ctx.fail("$.validUntil", "not after updatedOn");
  const kyStatus = oneOf(ctx, root.kyStatus, "$.kyStatus", ["needs_native_proofreading", "proofread"] as const);

  const intakeRow = record(ctx, root.intake, "$.intake", ["model", "reference", "label"], ["note"]);
  const model = oneOf(ctx, intakeRow.model, "$.intake.model", ["annual", "rolling", "none"] as const);
  if ((model === "none") !== general) ctx.fail("$.intake.model", "only the general route has no dates");
  if (model === "annual" ? typeof intakeRow.reference !== "string" || !ISO_MONTH.test(intakeRow.reference) : intakeRow.reference !== null) {
    ctx.fail("$.intake.reference", model === "annual" ? "not YYYY-MM" : "must be null");
  }
  const intake = Object.freeze({
    model,
    reference: intakeRow.reference as string | null,
    label: text(ctx, intakeRow.label, "$.intake.label", false),
    ...("note" in intakeRow ? { note: text(ctx, intakeRow.note, "$.intake.note", true) } : {}),
  });

  const disclaimerRow = record(ctx, root.disclaimers, "$.disclaimers", ["timing", "documents", "decisions"]);
  const disclaimers = Object.freeze({
    timing: l10n(ctx, disclaimerRow.timing, "$.disclaimers.timing"),
    documents: l10n(ctx, disclaimerRow.documents, "$.disclaimers.documents"),
    decisions: l10n(ctx, disclaimerRow.decisions, "$.disclaimers.decisions", { promisesChecked: true }),
  });
  for (const part of ["timing", "documents", "decisions"] as const) {
    for (const lang of ["ru", "ky"] as const) {
      if (!DISCLAIMER_MARKERS[part][lang].test(disclaimers[part][lang])) ctx.fail(`$.disclaimers.${part}.${lang}`, "not the required disclaimer");
    }
  }
  // Оговорка о решениях содержит только отрицание; других обещаний в ней нет.
  for (const lang of ["ru", "ky"] as const) {
    const rest = disclaimers.decisions[lang].replace(/EVO их не гарантирует\.$|EVO буларга кепилдик бербейт\.$/u, "");
    for (const pattern of FORBIDDEN_PROMISES) if (pattern.test(rest)) ctx.fail(`$.disclaimers.decisions.${lang}`, "promise outside the negation");
  }

  if (!Array.isArray(root.sources) || root.sources.length === 0) ctx.fail("$.sources", "not a non-empty array");
  const sources = (root.sources as unknown[]).map((raw, index): TimelineSource => {
    const path = `$.sources[${index}]`;
    const row = record(ctx, raw, path, ["id", "kind", "title", "checkedOn"], ["url"]);
    if (typeof row.id !== "string" || !SOURCE_ID.test(row.id)) ctx.fail(`${path}.id`, "not a source id");
    const kind = oneOf(ctx, row.kind, `${path}.kind`, ["owner_guide", "evo_internal", "official", "university", "secondary"] as const);
    const internal = kind === "owner_guide" || kind === "evo_internal";
    if (internal && "url" in row) ctx.fail(`${path}.url`, "an internal source has no address in the file");
    if (!internal && (typeof row.url !== "string" || !/^https:\/\/[^\s]+$/u.test(row.url))) ctx.fail(`${path}.url`, "an external source needs an https url");
    return Object.freeze({
      id: row.id as string, kind, title: plain(ctx, row.title, `${path}.title`),
      ...(internal ? {} : { url: row.url as string }), checkedOn: isoDate(ctx, row.checkedOn, `${path}.checkedOn`),
    });
  });
  const knownSources = new Set(sources.map((source) => source.id));
  if (knownSources.size !== sources.length) ctx.fail("$.sources", "duplicate source id");
  const usedSources = new Set<string>();

  if (!Array.isArray(root.steps) || root.steps.length < 5 || root.steps.length > 8) ctx.fail("$.steps", "needs 5 to 8 steps");
  const itemIds = new Set<string>();
  const steps = (root.steps as unknown[]).map((raw, index): TimelineStep => {
    const path = `$.steps[${index}]`;
    const row = record(ctx, raw, path, ["id", "order", "stageKeys", "title", "summary", "timing", "checklist", "doneWhen", "sources"],
      ["note", "links"]);
    const order = index + 1;
    if (row.order !== order) ctx.fail(`${path}.order`, `not ${order}`);
    if (typeof row.id !== "string" || !new RegExp(`^${key}-${order}-[a-z0-9]+(?:-[a-z0-9]+)*$`, "u").test(row.id)) ctx.fail(`${path}.id`, "not <file>-<order>-<slug>");
    if (!Array.isArray(row.stageKeys) || row.stageKeys.length === 0 || new Set(row.stageKeys).size !== row.stageKeys.length) {
      ctx.fail(`${path}.stageKeys`, "needs distinct stage keys");
    }
    const stageKeys = Object.freeze((row.stageKeys as unknown[]).map((stage, n) => oneOf(ctx, stage, `${path}.stageKeys[${n}]`, TIMELINE_STAGE_KEYS)));
    let timing: TimelineTiming | null = null;
    if (general) {
      if (row.timing !== null) ctx.fail(`${path}.timing`, "the general route has no timing");
    } else {
      const t = record(ctx, row.timing, `${path}.timing`, ["from", "to", "label", "basis"]);
      const from = offset(ctx, t.from, `${path}.timing.from`);
      const to = offset(ctx, t.to, `${path}.timing.to`);
      if (from.unit !== to.unit || from.value > to.value) ctx.fail(`${path}.timing`, "from and to differ in unit or are reversed");
      const basis = oneOf(ctx, t.basis, `${path}.timing.basis`, ["owner_guide", "official", "evo_internal", "estimate"] as const);
      if (status === "approved" && basis === "estimate") ctx.fail(`${path}.timing.basis`, "an approved timeline has no estimated timing");
      timing = Object.freeze({ from, to, label: text(ctx, t.label, `${path}.timing.label`, false), basis });
    }
    if (!Array.isArray(row.checklist) || row.checklist.length === 0) ctx.fail(`${path}.checklist`, "needs at least one item");
    const checklist = Object.freeze((row.checklist as unknown[]).map((rawItem, n): TimelineItem => {
      const itemPath = `${path}.checklist[${n}]`;
      const item = record(ctx, rawItem, itemPath, ["id", "who", "status", "text", "sources"], ["note", "appliesTo"]);
      if (typeof item.id !== "string" || !new RegExp(`^${key}-${order}-\\d{2}$`, "u").test(item.id) || itemIds.has(item.id)) {
        ctx.fail(`${itemPath}.id`, "not a unique <file>-<order>-<NN>");
      }
      itemIds.add(item.id as string);
      return Object.freeze({
        id: item.id as string,
        who: oneOf(ctx, item.who, `${itemPath}.who`, TIMELINE_WHO),
        status: oneOf(ctx, item.status, `${itemPath}.status`, ["confirmed", "verify"] as const),
        text: text(ctx, item.text, `${itemPath}.text`, true),
        ...("note" in item ? { note: text(ctx, item.note, `${itemPath}.note`, true) } : {}),
        ...("appliesTo" in item ? { appliesTo: text(ctx, item.appliesTo, `${itemPath}.appliesTo`, false) } : {}),
        sources: sourceRefs(ctx, item.sources, `${itemPath}.sources`, knownSources, usedSources),
      });
    }));
    // Шаг никогда не остаётся пустым: ни из-за `verify`, ни после validUntil.
    if (!checklist.some((item) => item.status === "confirmed" && item.text.undated !== null)) {
      ctx.fail(`${path}.checklist`, "needs a confirmed item that stays after validUntil");
    }
    let links: readonly TimelineLink[] | undefined;
    if ("links" in row) {
      if (!Array.isArray(row.links) || row.links.length === 0) ctx.fail(`${path}.links`, "not a non-empty array");
      links = Object.freeze((row.links as unknown[]).map((rawLink, n): TimelineLink => {
        const linkPath = `${path}.links[${n}]`;
        const link = record(ctx, rawLink, linkPath, ["id", "label", "url"], ["appModule"]);
        if (typeof link.id !== "string" || !LINK_ID.test(link.id)) ctx.fail(`${linkPath}.id`, "not a link id");
        if (typeof link.url !== "string" || !/^https:\/\/[^\s]+$/u.test(link.url)) ctx.fail(`${linkPath}.url`, "not an https url");
        return Object.freeze({
          id: link.id as string, label: l10n(ctx, link.label, `${linkPath}.label`), url: link.url as string,
          ...("appModule" in link ? { appModule: oneOf(ctx, link.appModule, `${linkPath}.appModule`, TIMELINE_APP_MODULES) } : {}),
        });
      }));
      if (new Set(links.map((link) => link.id)).size !== links.length) ctx.fail(`${path}.links`, "duplicate link id");
    }
    return Object.freeze({
      id: row.id as string, order, stageKeys,
      title: text(ctx, row.title, `${path}.title`, false),
      summary: text(ctx, row.summary, `${path}.summary`, false),
      timing, checklist,
      ...("note" in row ? { note: text(ctx, row.note, `${path}.note`, true) } : {}),
      doneWhen: text(ctx, row.doneWhen, `${path}.doneWhen`, false),
      ...(links ? { links } : {}),
      sources: sourceRefs(ctx, row.sources, `${path}.sources`, knownSources, usedSources),
    });
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length) ctx.fail("$.steps", "duplicate step id");
  for (const source of sources) if (!usedSources.has(source.id)) ctx.fail("$.sources", `unused source ${source.id}`);

  return Object.freeze({
    schemaVersion: 1, contentVersion: root.contentVersion as number, country, name, status, updatedOn, validUntil, kyStatus,
    intake, disclaimers, steps: Object.freeze(steps), sources: Object.freeze(sources),
  });
}

const RAW: Readonly<Record<string, unknown>> = { cn, my, ae, tr, it, cz, undecided };

/** Все семь файлов, разобранные при импорте. */
export const COUNTRY_TIMELINES: Readonly<Record<string, CountryTimelineFile>> = Object.freeze(
  Object.fromEntries(COUNTRY_TIMELINE_FILE_KEYS.map((key) => [key, parseCountryTimelineFile(RAW[key], key)])),
);

// ---------------------------------------------------------------------------
// Выбор и локализация
// ---------------------------------------------------------------------------

/** Подписи «кто делает» (SCHEMA, одинаковые на вебе и iPhone). */
export const TIMELINE_WHO_LABELS: Readonly<Record<TimelineWho, L10n>> = Object.freeze({
  student: { ru: "Студент", ky: "Студент" },
  evo: { ru: "EVO", ky: "EVO" },
  university: { ru: "Вуз", ky: "Университет" },
  embassy: { ru: "Посольство", ky: "Элчилик" },
});

export type TimelineChoice = string;

/** True для шести кодов стран и `UNDECIDED`. */
export function isTimelineChoice(value: unknown): value is TimelineChoice {
  return value === TIMELINE_UNDECIDED || (typeof value === "string" && STUDY_COUNTRY_CODES.includes(value));
}

export type TimelineViewItem = Readonly<{
  id: string;
  who: TimelineWho;
  whoLabel: string;
  text: string;
  note: string | null;
  appliesTo: string | null;
}>;
export type TimelineViewLink = Readonly<{ id: string; label: string; href: string; external: boolean }>;
export type TimelineViewStep = Readonly<{
  id: string;
  order: number;
  stageKeys: readonly TimelineStageKey[];
  title: string;
  summary: string;
  timing: string | null;
  note: string | null;
  doneWhen: string;
  items: readonly TimelineViewItem[];
  links: readonly TimelineViewLink[];
}>;
export type CountryTimelineView = Readonly<{
  /** Выбор студента: код страны или `UNDECIDED`. */
  choice: TimelineChoice;
  /** `country`: таймлайн страны; `general`: общий маршрут (не решил или страна не подтверждена). */
  kind: "country" | "general";
  countryCode: string | null;
  /** Название выбранной страны (study-countries.json); `null` для «Пока не решил». */
  countryName: string | null;
  /** Какой файл показан: `cn` … `cz` или `undecided`. */
  file: string;
  contentVersion: number;
  /** После validUntil тексты с годом заменены вариантом без даты. */
  datesHidden: boolean;
  intake: Readonly<{ label: string; note: string | null }>;
  steps: readonly TimelineViewStep[];
  /** Три оговорки в порядке: сроки, документы, решения. */
  disclaimers: readonly [string, string, string];
  kyNeedsProofreading: boolean;
}>;

export type SelectCountryTimelineOptions = Readonly<{
  locale?: string;
  /** Сегодня, YYYY-MM-DD (todayForTimeline()). */
  today: string;
  /** Внутренние маршруты модулей приложения, например { csca: "/portal/csca" }; нет ключа: внешний адрес. */
  modules?: Readonly<Partial<Record<TimelineAppModule, string>>>;
}>;

/** Сегодняшняя дата студента (Бишкек) в виде YYYY-MM-DD. */
export function todayForTimeline(now: Date = new Date(), timeZone = "Asia/Bishkek"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Что видит студент для выбора `choice` (код страны или `UNDECIDED`):
 * `approved` файл страны, иначе общий маршрут с названием страны; пункты
 * `verify` скрыты; после validUntil тексты с годом заменены `undated`
 * (`null` скрывает поле или пункт). Неизвестный выбор → `null` (интерфейс
 * показывает карточку «Выберите страну»).
 */
export function selectCountryTimeline(choice: unknown, options: SelectCountryTimelineOptions): CountryTimelineView | null {
  if (!isTimelineChoice(choice)) return null;
  if (typeof options.today !== "string" || !ISO_DATE.test(options.today)) throw new TypeError("today must be YYYY-MM-DD");
  const lang: TimelineLocale = options.locale === "ky" ? "ky" : "ru";
  const countryCode = choice === TIMELINE_UNDECIDED ? null : choice;
  const countryFile = countryCode ? COUNTRY_TIMELINES[countryCode.toLowerCase()] : undefined;
  const timeline = countryFile && countryFile.status === "approved" ? countryFile : COUNTRY_TIMELINES.undecided;
  const datesHidden = options.today > timeline.validUntil;
  // Текст на языке студента; `undefined` = скрыть (после validUntil с undated: null).
  const show = (value: TimelineText): string | undefined => {
    if (!datesHidden || !("undated" in value)) return value[lang];
    return value.undated ? value.undated[lang] : undefined;
  };
  const required = (value: TimelineText): string => {
    const shown = show(value);
    if (shown === undefined) throw new Error("timeline: a required text was hidden");
    return shown;
  };
  const optional = (value: TimelineText | undefined): string | null => (value ? show(value) ?? null : null);

  const steps = timeline.steps.map((step): TimelineViewStep => ({
    id: step.id,
    order: step.order,
    stageKeys: step.stageKeys,
    title: required(step.title),
    summary: required(step.summary),
    timing: step.timing ? required(step.timing.label) : null,
    note: optional(step.note),
    doneWhen: required(step.doneWhen),
    items: step.checklist
      .filter((item) => item.status === "confirmed" && show(item.text) !== undefined)
      .map((item) => ({
        id: item.id,
        who: item.who,
        whoLabel: TIMELINE_WHO_LABELS[item.who][lang],
        text: required(item.text),
        note: optional(item.note),
        appliesTo: item.appliesTo ? required(item.appliesTo) : null,
      })),
    links: (step.links ?? []).map((link) => {
      const internal = link.appModule ? options.modules?.[link.appModule] : undefined;
      return { id: link.id, label: link.label[lang], href: internal ?? link.url, external: internal === undefined };
    }),
  }));
  return Object.freeze({
    choice,
    kind: timeline === countryFile ? "country" : "general",
    countryCode,
    countryName: countryCode ? studyCountryName(countryCode, lang) : null,
    file: timeline === countryFile ? countryCode!.toLowerCase() : "undecided",
    contentVersion: timeline.contentVersion,
    datesHidden,
    intake: { label: required(timeline.intake.label), note: optional(timeline.intake.note) },
    steps,
    disclaimers: [timeline.disclaimers.timing[lang], timeline.disclaimers.documents[lang], timeline.disclaimers.decisions[lang]] as const,
    kyNeedsProofreading: timeline.kyStatus !== "proofread",
  });
}
