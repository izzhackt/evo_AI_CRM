/**
 * Обзор экзамена над разделом «CSCA» (решение владельца 17.10.2026): строгий
 * разбор src/content/csca/overview.json и манифеста фото
 * src/content/csca/photos.json. Факты экзамена подтвердил владелец; прошедшие
 * даты из его текста (регистрация 5..14 февраля 2026 и сессии 21.12.2025,
 * 25.01.2026, 15.03.2026) не показываются: вопрос о датах ведёт к блоку
 * сессий, который читается из базы (286, календарь csca.cn с датой проверки).
 *
 * Тот же файл позже читает iPhone, поэтому вся структура (таблицы, вопросы,
 * подписи столбцов) лежит в JSON, а не в словаре веба. Файлы проверяются при
 * импорте: неверный файл ломает сборку и тесты, а не показывает студенту
 * неполный обзор. Модуль клиент-безопасный (без server-only и Supabase).
 */
import overviewRaw from "../../content/csca/overview.json" with { type: "json" };
import photosRaw from "../../content/csca/photos.json" with { type: "json" };

export type CscaOverviewLocale = "ru" | "ky";
export type L10n = Readonly<{ ru: string; ky: string }>;

export const CSCA_EVO_STATUSES = ["available", "later", "none"] as const;
export type CscaEvoStatus = (typeof CSCA_EVO_STATUSES)[number];

export type CscaOverviewSubject = Readonly<{
  key: string;
  nameEn: string;
  name: L10n | null;
  language: L10n;
  minutes: number;
  questions: number;
  scoreMin: number;
  scoreMax: number;
  evo: CscaEvoStatus;
}>;
export type CscaOverviewGroup = Readonly<{ key: string; nameEn: string; name: L10n; subjects: readonly CscaOverviewSubject[] }>;
export type CscaOverviewFeeRow = Readonly<{ key: string; label: L10n; minSubjects: number; maxSubjects: number | null; fee: number }>;
export type CscaOverviewFaqItem = Readonly<{
  id: string;
  question: L10n;
  answer: readonly L10n[];
  /** Ответ ведёт к блоку сессий; без блока на странице вместо ответа `withoutSessions`. */
  link: Readonly<{ target: "sessions"; label: L10n; withoutSessions: L10n }> | null;
}>;
export type CscaOverview = Readonly<{
  schemaVersion: 1;
  contentVersion: number;
  confirmedOn: string;
  kyStatus: "needs_native_proofreading" | "proofread";
  exam: Readonly<{ short: "CSCA"; nameEn: string; subjectsTotal: number; universitiesTotal: number }>;
  summary: L10n;
  intro: readonly L10n[];
  audience: Readonly<{
    title: L10n;
    needed: Readonly<{ label: L10n; text: L10n }>;
    notNeeded: Readonly<{ label: L10n; text: L10n }>;
  }>;
  subjects: Readonly<{
    title: L10n;
    columns: Readonly<Record<"subject" | "language" | "duration" | "questions" | "scoreRange" | "evo", L10n>>;
    formats: Readonly<{ minutes: L10n; scoreRange: L10n }>;
    evoStatus: Readonly<Record<CscaEvoStatus, L10n>>;
    groups: readonly CscaOverviewGroup[];
  }>;
  fees: Readonly<{
    title: L10n;
    currency: "CNY";
    columns: Readonly<{ subjects: L10n; fee: L10n }>;
    rows: readonly CscaOverviewFeeRow[];
  }>;
  faq: Readonly<{ title: L10n; items: readonly CscaOverviewFaqItem[] }>;
  photos: Readonly<{ hero: string; audience: string }>;
  sources: readonly Readonly<{ id: string; kind: "owner"; title: string; checkedOn: string; omitted?: string }>[];
}>;

export type CscaPhotoFile = Readonly<{ path: string; format: "webp" | "jpeg"; width: number; height: number; bytes: number; sha256: string }>;
export type CscaPhoto = Readonly<{
  key: string;
  alt: L10n;
  author: string;
  authorUrl: string;
  sourceName: "Pexels";
  sourceUrl: string;
  sourceTitle: string;
  licence: string;
  licenceUrl: string;
  attributionRequired: boolean;
  uploadedOn: string;
  fetchedOn: string;
  objectPosition: string;
  files: readonly CscaPhotoFile[];
}>;

// ---------------------------------------------------------------------------
// Правила текста (те же у «Пути поступления»: без тире, без обещаний, без дат).
// ---------------------------------------------------------------------------

/** Длинное, короткое и цифровое тире, знак минуса. */
export const CSCA_OVERVIEW_DASHES = /[‒-―−]/u;
/** Год 19xx/20xx или дата дд.мм.гггг: в тексте обзора дат нет совсем (прошедшие даты владельца не показываются). */
export const CSCA_OVERVIEW_DATE = /(?<!\d)(?:19|20)\d{2}(?!\d)|(?<!\d)\d{1,2}\.\d{1,2}\.\d{2,4}(?!\d)/u;
/** Обещания и «партнёрство» (план v2 §9.5, DESIGN модуля §6). */
export const CSCA_OVERVIEW_FORBIDDEN: readonly RegExp[] = Object.freeze([
  /гарант/iu,
  /кепилд/iu,
  /100\s*%/u,
  /точно\s+(?:сда|пост|получ)/iu,
  /сөзсүз/iu,
  /партн[её]р/iu,
  /official\s+partner/iu,
  /официальн\p{L}*\s+партн/iu,
  /проходн\p{L}*\s+балл/iu,
  /перцентил/iu,
]);
/** Разряды через обычный пробел: строка рвётся посередине суммы. */
const DIGIT_GROUP_SPACE = /\d[^\S  ]\d{3}(?!\d)/u;
const LETTERS = /[\p{L}]+/gu;
const LATIN = /[A-Za-zÀ-ɏ]/u;
const CYRILLIC = /[Ѐ-ӿ]/u;
/** Латинский термин с кыргызским окончанием («CSCнын», «EVOдо») допустим. */
const LATIN_WITH_SUFFIX = /^[A-Za-zÀ-ɏ]+[Ѐ-ӿ]+$/u;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u;
const KEY = /^[a-z][a-z0-9-]{0,39}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
/** Файлы фото рядом с манифестом: src/content/csca/photos/<ключ>-<ширина>.<webp|jpg>. */
const PHOTO_PATH = /^photos\/([a-z][a-z0-9-]*)-(\d{3,4})\.(webp|jpg)$/u;
const HTTPS = /^https:\/\/[^\s]+$/u;

class CscaOverviewError extends Error {
  constructor(file: string, path: string, reason: string) {
    super(`csca ${file}: ${path}: ${reason}`);
    this.name = "CscaOverviewError";
  }
}

type Ctx = Readonly<{ file: string; fail: (path: string, reason: string) => never }>;

function context(file: string): Ctx {
  return { file, fail: (path, reason) => { throw new CscaOverviewError(file, path, reason); } };
}

function record(ctx: Ctx, value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) ctx.fail(path, "not an object");
  const row = value as Record<string, unknown>;
  for (const key of required) if (!(key in row)) ctx.fail(path, `missing ${key}`);
  for (const key of Object.keys(row)) {
    if (!required.includes(key) && !optional.includes(key)) ctx.fail(path, `unknown key ${key}`);
  }
  return row;
}

function list(ctx: Ctx, value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) ctx.fail(path, `needs ${min}..${max} entries`);
  return value as unknown[];
}

function int(ctx: Ctx, value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) ctx.fail(path, `not an integer ${min}..${max}`);
  return value as number;
}

function isoDate(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) ctx.fail(path, "not a YYYY-MM-DD date");
  return value as string;
}

function key(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value !== "string" || !KEY.test(value)) ctx.fail(path, "not a key");
  return value as string;
}

function https(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value !== "string" || !HTTPS.test(value)) ctx.fail(path, "not an https URL");
  return value as string;
}

/** Обычная строка без тире и лишних пробелов (метаданные, английские названия). */
function plain(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || /\s{2,}/u.test(value)) {
    ctx.fail(path, "empty or untrimmed text");
  }
  if (CSCA_OVERVIEW_DASHES.test(value as string)) ctx.fail(path, "em or en dash");
  return value as string;
}

/** Строка, которую видит студент: все правила текста. */
function studentString(ctx: Ctx, value: unknown, path: string): string {
  const text = plain(ctx, value, path);
  if (DIGIT_GROUP_SPACE.test(text)) ctx.fail(path, "digit groups need U+00A0 or U+202F");
  if (CSCA_OVERVIEW_DATE.test(text)) ctx.fail(path, "a date in student text");
  for (const word of text.match(LETTERS) ?? []) {
    if (LATIN.test(word) && CYRILLIC.test(word) && !LATIN_WITH_SUFFIX.test(word)) ctx.fail(path, `mixed script word ${word}`);
  }
  for (const pattern of CSCA_OVERVIEW_FORBIDDEN) if (pattern.test(text)) ctx.fail(path, `forbidden wording ${pattern}`);
  return text;
}

function l10n(ctx: Ctx, value: unknown, path: string): L10n {
  const row = record(ctx, value, path, ["ru", "ky"]);
  return Object.freeze({ ru: studentString(ctx, row.ru, `${path}.ru`), ky: studentString(ctx, row.ky, `${path}.ky`) });
}

function template(ctx: Ctx, value: unknown, path: string, slots: readonly string[]): L10n {
  const text = l10n(ctx, value, path);
  for (const locale of ["ru", "ky"] as const) {
    const found = [...text[locale].matchAll(/\{([a-z]+)\}/gu)].map((match) => match[1]).sort();
    if (found.join(",") !== [...slots].sort().join(",")) ctx.fail(`${path}.${locale}`, `needs exactly the slots ${slots.join(", ")}`);
  }
  return text;
}

function unique(ctx: Ctx, values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) ctx.fail(path, "duplicate key");
}

// ---------------------------------------------------------------------------
// Манифест фото.
// ---------------------------------------------------------------------------

export function parseCscaOverviewPhotos(value: unknown): readonly CscaPhoto[] {
  const ctx = context("photos.json");
  const root = record(ctx, value, "$", ["schemaVersion", "rules", "photos"]);
  if (root.schemaVersion !== 1) ctx.fail("$.schemaVersion", "not 1");
  plain(ctx, root.rules, "$.rules");
  const photos = list(ctx, root.photos, "$.photos", 1, 12).map((entry, index): CscaPhoto => {
    const path = `$.photos[${index}]`;
    const row = record(ctx, entry, path, [
      "key", "alt", "author", "authorUrl", "sourceName", "sourceUrl", "sourceTitle", "licence", "licenceUrl",
      "attributionRequired", "uploadedOn", "fetchedOn", "licenceCheck", "visualCheck", "people", "locationEvidence",
      "objectPosition", "original", "files",
    ]);
    const photoKey = key(ctx, row.key, `${path}.key`);
    if (row.sourceName !== "Pexels") ctx.fail(`${path}.sourceName`, "only Pexels photos are cleared for this set");
    if (typeof row.attributionRequired !== "boolean") ctx.fail(`${path}.attributionRequired`, "not a boolean");
    for (const field of ["licenceCheck", "visualCheck", "people", "locationEvidence", "author", "sourceTitle", "licence"] as const) {
      plain(ctx, row[field], `${path}.${field}`);
    }
    if (typeof row.objectPosition !== "string" || !/^\d{1,3}% \d{1,3}%$/u.test(row.objectPosition)) {
      ctx.fail(`${path}.objectPosition`, "not an x% y% position");
    }
    const original = record(ctx, row.original, `${path}.original`, ["width", "height", "bytes", "sha256", "downloadUrl"]);
    int(ctx, original.width, `${path}.original.width`, 1600, 20000);
    int(ctx, original.height, `${path}.original.height`, 1000, 20000);
    int(ctx, original.bytes, `${path}.original.bytes`, 1, 100_000_000);
    if (typeof original.sha256 !== "string" || !SHA256.test(original.sha256)) ctx.fail(`${path}.original.sha256`, "not a sha256");
    https(ctx, original.downloadUrl, `${path}.original.downloadUrl`);
    const files = list(ctx, row.files, `${path}.files`, 2, 8).map((file, fileIndex): CscaPhotoFile => {
      const filePath = `${path}.files[${fileIndex}]`;
      const fileRow = record(ctx, file, filePath, ["path", "format", "width", "height", "bytes", "sha256"]);
      const found = typeof fileRow.path === "string" ? PHOTO_PATH.exec(fileRow.path) : null;
      if (!found || found[1] !== photoKey) ctx.fail(`${filePath}.path`, "not photos/<key>-<width>.<webp|jpg>");
      const match = found as RegExpExecArray;
      const format = match[3] === "jpg" ? "jpeg" : "webp";
      if (fileRow.format !== format) ctx.fail(`${filePath}.format`, "does not match the extension");
      const width = int(ctx, fileRow.width, `${filePath}.width`, 120, 2400);
      if (String(width) !== match[2]) ctx.fail(`${filePath}.width`, "does not match the file name");
      const height = int(ctx, fileRow.height, `${filePath}.height`, 60, 2400);
      if (typeof fileRow.sha256 !== "string" || !SHA256.test(fileRow.sha256)) ctx.fail(`${filePath}.sha256`, "not a sha256");
      return Object.freeze({
        path: fileRow.path as string,
        format,
        width,
        height,
        bytes: int(ctx, fileRow.bytes, `${filePath}.bytes`, 1, 400_000),
        sha256: fileRow.sha256 as string,
      });
    });
    unique(ctx, files.map((file) => file.path), `${path}.files`);
    if (!files.some((file) => file.format === "jpeg")) ctx.fail(`${path}.files`, "needs a JPEG fallback");
    if (!files.some((file) => file.format === "webp")) ctx.fail(`${path}.files`, "needs a WebP source");
    return Object.freeze({
      key: photoKey,
      alt: l10n(ctx, row.alt, `${path}.alt`),
      author: row.author as string,
      authorUrl: https(ctx, row.authorUrl, `${path}.authorUrl`),
      sourceName: "Pexels" as const,
      sourceUrl: https(ctx, row.sourceUrl, `${path}.sourceUrl`),
      sourceTitle: row.sourceTitle as string,
      licence: row.licence as string,
      licenceUrl: https(ctx, row.licenceUrl, `${path}.licenceUrl`),
      attributionRequired: row.attributionRequired as boolean,
      uploadedOn: isoDate(ctx, row.uploadedOn, `${path}.uploadedOn`),
      fetchedOn: isoDate(ctx, row.fetchedOn, `${path}.fetchedOn`),
      objectPosition: row.objectPosition as string,
      files: Object.freeze(files),
    });
  });
  unique(ctx, photos.map((photo) => photo.key), "$.photos");
  return Object.freeze(photos);
}

// ---------------------------------------------------------------------------
// Обзор.
// ---------------------------------------------------------------------------

function subject(ctx: Ctx, value: unknown, path: string): CscaOverviewSubject {
  const row = record(ctx, value, path, ["key", "nameEn", "name", "language", "minutes", "questions", "scoreMin", "scoreMax", "evo"]);
  const scoreMin = int(ctx, row.scoreMin, `${path}.scoreMin`, 0, 1000);
  const scoreMax = int(ctx, row.scoreMax, `${path}.scoreMax`, 1, 1000);
  if (scoreMax <= scoreMin) ctx.fail(path, "score range is empty");
  const nameEn = plain(ctx, row.nameEn, `${path}.nameEn`);
  if (CYRILLIC.test(nameEn)) ctx.fail(`${path}.nameEn`, "not an English name");
  if (!CSCA_EVO_STATUSES.includes(row.evo as CscaEvoStatus)) ctx.fail(`${path}.evo`, `not one of ${CSCA_EVO_STATUSES.join(", ")}`);
  return Object.freeze({
    key: key(ctx, row.key, `${path}.key`),
    nameEn,
    name: row.name === null ? null : l10n(ctx, row.name, `${path}.name`),
    language: l10n(ctx, row.language, `${path}.language`),
    minutes: int(ctx, row.minutes, `${path}.minutes`, 1, 600),
    questions: int(ctx, row.questions, `${path}.questions`, 1, 1000),
    scoreMin,
    scoreMax,
    evo: row.evo as CscaEvoStatus,
  });
}

function mentions(ctx: Ctx, text: L10n, path: string, numbers: readonly number[]): void {
  for (const locale of ["ru", "ky"] as const) {
    for (const number of numbers) {
      if (!new RegExp(`(?<!\\d)${number}(?!\\d)`, "u").test(text[locale])) ctx.fail(`${path}.${locale}`, `does not say ${number}`);
    }
  }
}

export function parseCscaOverview(value: unknown, photoKeys: ReadonlySet<string>): CscaOverview {
  const ctx = context("overview.json");
  const root = record(ctx, value, "$", [
    "schemaVersion", "contentVersion", "confirmedOn", "kyStatus", "exam", "summary", "intro", "audience",
    "subjects", "fees", "faq", "photos", "sources",
  ]);
  if (root.schemaVersion !== 1) ctx.fail("$.schemaVersion", "not 1");
  if (root.kyStatus !== "needs_native_proofreading" && root.kyStatus !== "proofread") ctx.fail("$.kyStatus", "unknown");

  const examRow = record(ctx, root.exam, "$.exam", ["short", "nameEn", "subjectsTotal", "universitiesTotal"]);
  if (examRow.short !== "CSCA") ctx.fail("$.exam.short", "not CSCA");
  const exam = Object.freeze({
    short: "CSCA" as const,
    nameEn: plain(ctx, examRow.nameEn, "$.exam.nameEn"),
    subjectsTotal: int(ctx, examRow.subjectsTotal, "$.exam.subjectsTotal", 1, 20),
    universitiesTotal: int(ctx, examRow.universitiesTotal, "$.exam.universitiesTotal", 1, 5000),
  });

  const audienceRow = record(ctx, root.audience, "$.audience", ["title", "needed", "notNeeded"]);
  const verdict = (entry: unknown, path: string) => {
    const row = record(ctx, entry, path, ["label", "text"]);
    return Object.freeze({ label: l10n(ctx, row.label, `${path}.label`), text: l10n(ctx, row.text, `${path}.text`) });
  };
  const audience = Object.freeze({
    title: l10n(ctx, audienceRow.title, "$.audience.title"),
    needed: verdict(audienceRow.needed, "$.audience.needed"),
    notNeeded: verdict(audienceRow.notNeeded, "$.audience.notNeeded"),
  });

  const subjectsRow = record(ctx, root.subjects, "$.subjects", ["title", "columns", "formats", "evoStatus", "groups"]);
  const columnsRow = record(ctx, subjectsRow.columns, "$.subjects.columns", ["subject", "language", "duration", "questions", "scoreRange", "evo"]);
  const columns = Object.freeze(Object.fromEntries(Object.keys(columnsRow).map((name) => [name, l10n(ctx, columnsRow[name], `$.subjects.columns.${name}`)]))) as CscaOverview["subjects"]["columns"];
  const formatsRow = record(ctx, subjectsRow.formats, "$.subjects.formats", ["minutes", "scoreRange"]);
  const statusRow = record(ctx, subjectsRow.evoStatus, "$.subjects.evoStatus", CSCA_EVO_STATUSES);
  const groups = list(ctx, subjectsRow.groups, "$.subjects.groups", 1, 6).map((entry, index): CscaOverviewGroup => {
    const path = `$.subjects.groups[${index}]`;
    const row = record(ctx, entry, path, ["key", "nameEn", "name", "subjects"]);
    return Object.freeze({
      key: key(ctx, row.key, `${path}.key`),
      nameEn: plain(ctx, row.nameEn, `${path}.nameEn`),
      name: l10n(ctx, row.name, `${path}.name`),
      subjects: Object.freeze(list(ctx, row.subjects, `${path}.subjects`, 1, 10).map((item, itemIndex) => subject(ctx, item, `${path}.subjects[${itemIndex}]`))),
    });
  });
  unique(ctx, groups.map((group) => group.key), "$.subjects.groups");
  const allSubjects = groups.flatMap((group) => group.subjects);
  unique(ctx, allSubjects.map((entry) => entry.key), "$.subjects.groups[].subjects");
  if (allSubjects.length !== exam.subjectsTotal) ctx.fail("$.exam.subjectsTotal", "does not match the subjects table");

  const feesRow = record(ctx, root.fees, "$.fees", ["title", "currency", "columns", "rows"]);
  if (feesRow.currency !== "CNY") ctx.fail("$.fees.currency", "not CNY");
  const feeColumns = record(ctx, feesRow.columns, "$.fees.columns", ["subjects", "fee"]);
  const feeRows = list(ctx, feesRow.rows, "$.fees.rows", 1, 6).map((entry, index): CscaOverviewFeeRow => {
    const path = `$.fees.rows[${index}]`;
    const row = record(ctx, entry, path, ["key", "label", "minSubjects", "maxSubjects", "fee"]);
    const minSubjects = int(ctx, row.minSubjects, `${path}.minSubjects`, 1, 20);
    const maxSubjects = row.maxSubjects === null ? null : int(ctx, row.maxSubjects, `${path}.maxSubjects`, minSubjects, 20);
    return Object.freeze({
      key: key(ctx, row.key, `${path}.key`),
      label: l10n(ctx, row.label, `${path}.label`),
      minSubjects,
      maxSubjects,
      fee: int(ctx, row.fee, `${path}.fee`, 1, 100_000),
    });
  });
  unique(ctx, feeRows.map((row) => row.key), "$.fees.rows");
  // Строки покрывают 1..∞ предметов подряд, последняя открыта сверху.
  feeRows.forEach((row, index) => {
    const expectedMin = index === 0 ? 1 : (feeRows[index - 1].maxSubjects ?? Number.NaN) + 1;
    if (row.minSubjects !== expectedMin) ctx.fail(`$.fees.rows[${index}].minSubjects`, "rows must cover 1.. subjects without gaps");
    if ((row.maxSubjects === null) !== (index === feeRows.length - 1)) ctx.fail(`$.fees.rows[${index}].maxSubjects`, "only the last row is open");
    if (row.minSubjects > exam.subjectsTotal) ctx.fail(`$.fees.rows[${index}]`, "more subjects than the exam has");
    if (!new RegExp(`(?<!\\d)${row.minSubjects}(?!\\d)`, "u").test(row.label.ru)) ctx.fail(`$.fees.rows[${index}].label`, "label does not name its count");
  });

  const faqRow = record(ctx, root.faq, "$.faq", ["title", "items"]);
  const faqItems = list(ctx, faqRow.items, "$.faq.items", 1, 12).map((entry, index): CscaOverviewFaqItem => {
    const path = `$.faq.items[${index}]`;
    const row = record(ctx, entry, path, ["id", "question", "answer", "link"]);
    const question = l10n(ctx, row.question, `${path}.question`);
    if (!question.ru.endsWith("?") || !question.ky.endsWith("?")) ctx.fail(`${path}.question`, "a question ends with ?");
    let link: CscaOverviewFaqItem["link"] = null;
    if (row.link !== null) {
      const linkRow = record(ctx, row.link, `${path}.link`, ["target", "label", "withoutSessions"]);
      if (linkRow.target !== "sessions") ctx.fail(`${path}.link.target`, "only the sessions block is a target");
      link = Object.freeze({
        target: "sessions" as const,
        label: l10n(ctx, linkRow.label, `${path}.link.label`),
        withoutSessions: l10n(ctx, linkRow.withoutSessions, `${path}.link.withoutSessions`),
      });
    }
    return Object.freeze({
      id: key(ctx, row.id, `${path}.id`),
      question,
      answer: Object.freeze(list(ctx, row.answer, `${path}.answer`, 1, 4).map((part, partIndex) => l10n(ctx, part, `${path}.answer[${partIndex}]`))),
      link,
    });
  });
  unique(ctx, faqItems.map((item) => item.id), "$.faq.items");

  const photosRow = record(ctx, root.photos, "$.photos", ["hero", "audience"]);
  for (const slot of ["hero", "audience"] as const) {
    if (typeof photosRow[slot] !== "string" || !photoKeys.has(photosRow[slot] as string)) ctx.fail(`$.photos.${slot}`, "not a photo of the manifest");
  }

  const sources = list(ctx, root.sources, "$.sources", 1, 8).map((entry, index) => {
    const path = `$.sources[${index}]`;
    const row = record(ctx, entry, path, ["id", "kind", "title", "checkedOn"], ["omitted"]);
    if (row.kind !== "owner") ctx.fail(`${path}.kind`, "only owner-confirmed facts are in the overview");
    return Object.freeze({
      id: plain(ctx, row.id, `${path}.id`),
      kind: "owner" as const,
      title: plain(ctx, row.title, `${path}.title`),
      checkedOn: isoDate(ctx, row.checkedOn, `${path}.checkedOn`),
      ...(row.omitted === undefined ? {} : { omitted: plain(ctx, row.omitted, `${path}.omitted`) }),
    });
  });

  const overview: CscaOverview = Object.freeze({
    schemaVersion: 1 as const,
    contentVersion: int(ctx, root.contentVersion, "$.contentVersion", 1, 10_000),
    confirmedOn: isoDate(ctx, root.confirmedOn, "$.confirmedOn"),
    kyStatus: root.kyStatus as CscaOverview["kyStatus"],
    exam,
    summary: l10n(ctx, root.summary, "$.summary"),
    intro: Object.freeze(list(ctx, root.intro, "$.intro", 1, 4).map((entry, index) => l10n(ctx, entry, `$.intro[${index}]`))),
    audience,
    subjects: Object.freeze({
      title: l10n(ctx, subjectsRow.title, "$.subjects.title"),
      columns,
      formats: Object.freeze({
        minutes: template(ctx, formatsRow.minutes, "$.subjects.formats.minutes", ["n"]),
        scoreRange: template(ctx, formatsRow.scoreRange, "$.subjects.formats.scoreRange", ["max", "min"]),
      }),
      evoStatus: Object.freeze(Object.fromEntries(CSCA_EVO_STATUSES.map((status) => [status, l10n(ctx, statusRow[status], `$.subjects.evoStatus.${status}`)]))) as CscaOverview["subjects"]["evoStatus"],
      groups: Object.freeze(groups),
    }),
    fees: Object.freeze({
      title: l10n(ctx, feesRow.title, "$.fees.title"),
      currency: "CNY" as const,
      columns: Object.freeze({ subjects: l10n(ctx, feeColumns.subjects, "$.fees.columns.subjects"), fee: l10n(ctx, feeColumns.fee, "$.fees.columns.fee") }),
      rows: Object.freeze(feeRows),
    }),
    faq: Object.freeze({ title: l10n(ctx, faqRow.title, "$.faq.title"), items: Object.freeze(faqItems) }),
    photos: Object.freeze({ hero: photosRow.hero as string, audience: photosRow.audience as string }),
    sources: Object.freeze(sources),
  });

  // Сводка и «Кому нужен» повторяют цифры таблиц, а не придумывают свои.
  mentions(ctx, overview.summary, "$.summary", [exam.universitiesTotal, exam.subjectsTotal, ...feeRows.map((row) => row.fee)]);
  mentions(ctx, overview.audience.needed.text, "$.audience.needed.text", [exam.universitiesTotal]);
  return overview;
}

export const CSCA_OVERVIEW_PHOTOS: readonly CscaPhoto[] = parseCscaOverviewPhotos(photosRaw);
export const CSCA_OVERVIEW: CscaOverview = parseCscaOverview(
  overviewRaw,
  new Set(CSCA_OVERVIEW_PHOTOS.map((photo) => photo.key)),
);

export function cscaOverviewPhoto(photoKey: string): CscaPhoto {
  const photo = CSCA_OVERVIEW_PHOTOS.find((entry) => entry.key === photoKey);
  if (!photo) throw new CscaOverviewError("photos.json", "$", `no photo ${photoKey}`);
  return photo;
}

/** WebP по возрастанию ширины и JPEG-запасной вариант (самый узкий). */
export function cscaPhotoSources(photo: CscaPhoto): Readonly<{ webp: readonly CscaPhotoFile[]; fallback: CscaPhotoFile }> {
  const webp = photo.files.filter((file) => file.format === "webp").sort((a, b) => a.width - b.width);
  const fallback = photo.files.filter((file) => file.format === "jpeg").sort((a, b) => a.width - b.width)[0];
  return { webp, fallback };
}

/** `srcset` из файлов манифеста; адрес файла даёт сборка (статический импорт). */
export function cscaPhotoSrcSet(files: readonly CscaPhotoFile[], url: (path: string) => string): string {
  return files.map((file) => `${url(file.path)} ${file.width}w`).join(", ");
}

const fill = (text: string, slots: Readonly<Record<string, string>>) =>
  text.replace(/\{([a-z]+)\}/gu, (match, name: string) => (Object.hasOwn(slots, name) ? slots[name] : match));

export function cscaMinutesLabel(overview: CscaOverview, minutes: number, locale: CscaOverviewLocale): string {
  return fill(overview.subjects.formats.minutes[locale], { n: String(minutes) });
}

export function cscaScoreRangeLabel(overview: CscaOverview, entry: Pick<CscaOverviewSubject, "scoreMin" | "scoreMax">, locale: CscaOverviewLocale): string {
  return fill(overview.subjects.formats.scoreRange[locale], { min: String(entry.scoreMin), max: String(entry.scoreMax) });
}

export const CSCA_SUBJECT_FACT_KEYS = ["language", "duration", "questions", "scoreRange"] as const;
export type CscaSubjectFact = Readonly<{ key: (typeof CSCA_SUBJECT_FACT_KEYS)[number]; label: string; value: string }>;

/** Четыре факта предмета из таблицы: язык, время, число вопросов, шкала. */
export function cscaSubjectFacts(overview: CscaOverview, subject: CscaOverviewSubject, locale: CscaOverviewLocale): CscaSubjectFact[] {
  const columns = overview.subjects.columns;
  const values: Record<CscaSubjectFact["key"], string> = {
    language: subject.language[locale],
    duration: cscaMinutesLabel(overview, subject.minutes, locale),
    questions: String(subject.questions),
    scoreRange: cscaScoreRangeLabel(overview, subject, locale),
  };
  return CSCA_SUBJECT_FACT_KEYS.map((key) => ({ key, label: columns[key][locale], value: values[key] }));
}

/**
 * Узкая версия таблицы предметов (review раунда 1, F3): факт, одинаковый у
 * всех предметов группы, показывается один раз над её списком, у предмета
 * остаются только отличия. Данные те же, что в таблице, новых нет.
 */
export function cscaGroupFacts(overview: CscaOverview, group: CscaOverviewGroup, locale: CscaOverviewLocale): Readonly<{
  shared: CscaSubjectFact[];
  bySubject: Readonly<Record<string, CscaSubjectFact[]>>;
}> {
  const facts = group.subjects.map((subject) => cscaSubjectFacts(overview, subject, locale));
  const sharedKeys = new Set(CSCA_SUBJECT_FACT_KEYS.filter((key, index) =>
    facts.every((list) => list[index].value === facts[0][index].value)));
  return {
    shared: facts[0].filter((fact) => sharedKeys.has(fact.key)),
    bySubject: Object.fromEntries(group.subjects.map((subject, index) =>
      [subject.key, facts[index].filter((fact) => !sharedKeys.has(fact.key))])),
  };
}

/**
 * Начал ли студент заниматься: есть ответ, урок, тест или банк ошибок. Тогда
 * обзор по умолчанию свёрнут в одну строку; свой выбор зритель меняет кнопкой
 * «Об экзамене», устройство помнит его в cookie (`csca-overview-choice.ts`).
 */
export function cscaHasStarted(home: Readonly<{
  topics: readonly Readonly<{ windowAnswers: number; lessonCompleted: boolean }>[];
  lessons: readonly Readonly<{ completed: boolean; draftAttemptId: string | null }>[];
  tests: readonly Readonly<{ draft: unknown; lastResult: unknown }>[];
  review: Readonly<{ activeCount: number }>;
}>): boolean {
  return home.topics.some((topic) => topic.windowAnswers > 0 || topic.lessonCompleted)
    || home.lessons.some((lesson) => lesson.completed || lesson.draftAttemptId !== null)
    || home.tests.some((test) => test.draft !== null || test.lastResult !== null)
    || home.review.activeCount > 0;
}
