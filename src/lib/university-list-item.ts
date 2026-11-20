/**
 * Лёгкая строка каталога «Университетов» сотрудников (миграция 364, `staff_university_catalog_rows_v1`): то, что
 * рисуют список, страны, страна и город, без программ целиком. Программы с открытым или объявленным набором приходят
 * только ради «ближайшего срока» (`staffUniversityDeadline`), остальное — число программ по уровням. Карточку целиком
 * читает только страница вуза. Модуль нейтральный (без server-only): сервер и тесты зовут одни и те же функции.
 */
import {
  UNIVERSITY_LEVELS, UNIVERSITY_MAX_PROGRAMS, UNIVERSITY_PHOTOS, universityDate, universityPublicUrl, universityText, universityUuid,
  type PublishedUniversity, type UniversityContent, type UniversityIntake, type UniversityLevel, type UniversityPhotoKey, type UniversityProgram,
} from "./platform-university-catalog.ts";

/** Набор, из которого считается срок: поля правила `staffUniversityDeadline` и подписи строки. */
export type UniversityDeadlineIntake = Readonly<Pick<UniversityIntake, "label" | "applicationDeadline" | "deadlineTime" | "timezone" | "status" | "verifiedOn" | "sourceUrl">>;
export type UniversityDeadlineProgram = Readonly<Pick<UniversityProgram, "id" | "level" | "title"> & { intakes: readonly UniversityDeadlineIntake[] }>;
export type UniversityListItem = Readonly<{
  id: string;
  version: number;
  publishedAt: string;
  content: Readonly<Pick<UniversityContent, "name" | "country" | "city" | "verifiedOn" | "photoKey">>;
  /** Программ по уровням; уровня без программ нет. */
  levels: Readonly<Partial<Record<UniversityLevel, number>>>;
  /** Программы с открытым или объявленным набором и только эти наборы, в порядке карточки. */
  deadlinePrograms: readonly UniversityDeadlineProgram[];
}>;
/** Весь отфильтрованный каталог или «больше предела»: тогда страница читает прежние страницы сервера по названию. */
export type UniversityListRead = Readonly<{ complete: true; items: readonly UniversityListItem[] }> | Readonly<{ complete: false }>;

/** Предел одного ответа — как у SQL 364 (прежнее полное чтение: 40 страниц по 30). */
export const UNIVERSITY_LIST_LIMIT = 1200;

const live = (intake: Pick<UniversityIntake, "status">) => intake.status === "open" || intake.status === "announced";

/** Та же проекция из полной карточки, что у SQL 364: страница сервера по названию и тесты. */
export function universityListItem(university: PublishedUniversity): UniversityListItem {
  const { content } = university;
  const levels: Partial<Record<UniversityLevel, number>> = {};
  const deadlinePrograms: UniversityDeadlineProgram[] = [];
  for (const program of content.programs) {
    levels[program.level] = (levels[program.level] ?? 0) + 1;
    const intakes = program.intakes.filter(live).map(({ label, applicationDeadline, deadlineTime, timezone, status, verifiedOn, sourceUrl }) =>
      ({ label, applicationDeadline, deadlineTime, timezone, status, verifiedOn, sourceUrl }));
    if (intakes.length > 0) deadlinePrograms.push({ id: program.id, level: program.level, title: program.title, intakes });
  }
  return {
    id: university.id, version: university.version, publishedAt: university.publishedAt,
    content: { name: content.name, country: content.country, city: content.city, verifiedOn: content.verifiedOn, photoKey: content.photoKey },
    levels, deadlinePrograms,
  };
}

/** Сколько программ в карточке; с фильтром уровня — сколько программ этого уровня. */
export function listItemProgramCount(item: UniversityListItem, level: UniversityLevel | ""): number {
  if (level) return item.levels[level] ?? 0;
  return UNIVERSITY_LEVELS.reduce((total, key) => total + (item.levels[key] ?? 0), 0);
}

type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null);
const exact = (row: Row, keys: readonly string[]) => Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
const isLevel = (value: unknown): value is UniversityLevel => typeof value === "string" && (UNIVERSITY_LEVELS as readonly string[]).includes(value);

/** Набор строки — те же проверки, что у полного разбора карточки (`parseUniversityContent`), но только живые статусы. */
function deadlineIntake(value: unknown): UniversityDeadlineIntake | null {
  const row = object(value);
  if (!row || !exact(row, ["label", "applicationDeadline", "deadlineTime", "timezone", "status", "verifiedOn", "sourceUrl"])
    || !universityText(row.label, 200) || !(row.applicationDeadline === null || universityDate(row.applicationDeadline))
    || !(row.deadlineTime === null || (typeof row.deadlineTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.deadlineTime)))
    || !(row.timezone === null || universityText(row.timezone, 100))
    || (row.deadlineTime !== null && (row.applicationDeadline === null || row.timezone === null))
    || (row.status !== "open" && row.status !== "announced") || !universityPublicUrl(row.sourceUrl) || !universityDate(row.verifiedOn)) return null;
  try { if (row.timezone !== null) new Intl.DateTimeFormat("en", { timeZone: row.timezone }); } catch { return null; }
  return {
    label: row.label, applicationDeadline: row.applicationDeadline, deadlineTime: row.deadlineTime as string | null,
    timezone: row.timezone, status: row.status, verifiedOn: row.verifiedOn, sourceUrl: row.sourceUrl,
  };
}

function deadlineProgram(value: unknown, seen: Set<string>): UniversityDeadlineProgram | null {
  const row = object(value);
  if (!row || !exact(row, ["id", "level", "title", "intakes"]) || !universityText(row.id, 64) || !/^[a-z0-9][a-z0-9-]*$/.test(row.id)
    || seen.has(row.id) || !isLevel(row.level) || !universityText(row.title, 300)
    || !Array.isArray(row.intakes) || row.intakes.length < 1 || row.intakes.length > 12) return null;
  const intakes: UniversityDeadlineIntake[] = [];
  for (const entry of row.intakes) {
    const intake = deadlineIntake(entry);
    if (!intake) return null;
    intakes.push(intake);
  }
  seen.add(row.id);
  return { id: row.id, level: row.level, title: row.title, intakes };
}

function listItem(value: unknown): UniversityListItem | null {
  const row = object(value), content = object(row?.content), levels = object(row?.levels), id = universityUuid(row?.id);
  if (!row || !exact(row, ["id", "version", "publishedAt", "content", "levels", "deadlinePrograms"]) || !id
    || !Number.isSafeInteger(row.version) || Number(row.version) < 1
    || typeof row.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.publishedAt) || Number.isNaN(Date.parse(row.publishedAt))
    || !content || !exact(content, ["name", "country", "city", "verifiedOn", "photoKey"])
    || !universityText(content.name, 300) || !universityText(content.country, 2) || !/^[A-Z]{2}$/.test(content.country)
    || !(content.city === null || universityText(content.city, 200)) || !universityDate(content.verifiedOn)
    || !(content.photoKey === null || (typeof content.photoKey === "string" && Object.hasOwn(UNIVERSITY_PHOTOS, content.photoKey)))
    || !levels || !Array.isArray(row.deadlinePrograms)) return null;
  const counts: Partial<Record<UniversityLevel, number>> = {};
  let total = 0;
  for (const [level, count] of Object.entries(levels)) {
    if (!isLevel(level) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return null;
    counts[level] = count;
    total += count;
  }
  if (total < 1 || total > UNIVERSITY_MAX_PROGRAMS) return null;
  const seen = new Set<string>(), deadlinePrograms: UniversityDeadlineProgram[] = [];
  for (const entry of row.deadlinePrograms) {
    const program = deadlineProgram(entry, seen);
    if (!program || !counts[program.level]) return null;
    deadlinePrograms.push(program);
  }
  return {
    id, version: row.version as number, publishedAt: row.publishedAt,
    content: { name: content.name, country: content.country, city: content.city as string | null, verifiedOn: content.verifiedOn, photoKey: content.photoKey as UniversityPhotoKey | null },
    levels: counts, deadlinePrograms,
  };
}

/** Ответ `staff_university_catalog_rows_v1`: своя организация, точные ключи; неверный ответ — ошибка чтения, а не пустой каталог. */
export function parseUniversityListRead(value: unknown, organizationId: string): UniversityListRead | null {
  const row = object(value);
  if (!row || !exact(row, ["organizationId", "complete", "items"]) || row.organizationId !== organizationId
    || typeof row.complete !== "boolean" || !Array.isArray(row.items) || row.items.length > UNIVERSITY_LIST_LIMIT) return null;
  if (!row.complete) return row.items.length === 0 ? { complete: false } : null;
  const items: UniversityListItem[] = [], ids = new Set<string>();
  for (const entry of row.items) {
    const item = listItem(entry);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id);
    items.push(item);
  }
  return { complete: true, items };
}
