import {
  universityDate,
  universityIntakeLabel,
  type PublishedUniversity,
  type UniversityFilters,
  type UniversityIntake,
} from "../platform-university-catalog.ts";
import { staffUniversityDeadline } from "../university-staff-deadline.ts";

/**
 * «Университеты» сотрудников (Э6 плана редизайна, 27.09.2026): плотная
 * таблица со сроками вместо карточек. Чистые правила без чтений и без React:
 * порядок каталога, страницы, срок строки словом, состояние набора и строка
 * авторства фото по-русски. Сервер и тест зовут одни и те же функции.
 */

/** Строк на странице — как у чтения `staff_university_catalog` (30). */
export const UNIVERSITY_PAGE_SIZE = 30;

/** Срок словом, как у блока `DueWord`: «сегодня», «завтра», «через 18 дн». */
export type CatalogueDueWord = Readonly<{ text: string; tone: "today" | "upcoming" }>;

const ZONE = /^[A-Za-z_]+\/[A-Za-z0-9_+/-]+$/;

/** Действительный часовой пояс записи набора: IANA-имя, UTC или GMT. */
export function catalogueZone(timezone: string | null): timezone is string {
  if (!timezone || /^(posix|right)\//.test(timezone)) return false;
  if (timezone !== "UTC" && timezone !== "GMT" && !ZONE.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Сегодняшний день в поясе набора (как у `staffUniversityDeadline`); null — пояс или время негодны. */
export function catalogueZoneToday(timezone: string | null, now: Date): string | null {
  if (!catalogueZone(timezone) || !Number.isFinite(now.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const at = (key: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === key)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")}`;
}

/** «15.10»; год двумя цифрами — только если он не текущий: «15.01.27». */
export function formatCatalogueDay(day: string, today: string): string {
  const [year, month, date] = day.split("-");
  return year === today.slice(0, 4) ? `${date}.${month}` : `${date}.${month}.${year.slice(2)}`;
}

function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Слово срока, который ещё не прошёл: «сегодня», «завтра», «через N дн». */
export function catalogueDueWord(deadline: string, today: string): CatalogueDueWord | null {
  const distance = dayDistance(today, deadline);
  if (!Number.isFinite(distance) || distance < 0) return null;
  if (distance === 0) return { text: "сегодня", tone: "today" };
  return { text: distance === 1 ? "завтра" : `через ${distance} дн`, tone: "upcoming" };
}

export type UniversityDeadlineView = Readonly<{
  /** Значение `<time dateTime>`: день срока. */
  dateTime: string;
  /** «15.10» или «15.10 23:59» — в поясе набора. */
  text: string;
  timezone: string;
  word: CatalogueDueWord | null;
  program: string;
  intake: string;
  /** Дата проверки срока по источнику. */
  verifiedOn: string;
  /** Других наборов с этой же датой. */
  sameDateCount: number;
}>;

/**
 * Ближайший подтверждённый срок строки: правило `staffUniversityDeadline`
 * (открытый или объявленный набор, проверенная дата, пояс, источник; срок ещё
 * не прошёл в поясе набора) и его подача — дата, слово, программа.
 */
export function universityDeadlineView(
  university: PublishedUniversity,
  level: UniversityFilters["level"],
  now: Date,
): UniversityDeadlineView | null {
  const deadline = staffUniversityDeadline(university.content.programs, level, now);
  if (!deadline) return null;
  const timezone = deadline.intake.timezone ?? "";
  const today = catalogueZoneToday(timezone, now);
  if (!today) return null;
  const time = deadline.intake.deadlineTime ? ` ${deadline.intake.deadlineTime}` : "";
  return {
    dateTime: deadline.applicationDeadline,
    text: `${formatCatalogueDay(deadline.applicationDeadline, today)}${time}`,
    timezone,
    word: catalogueDueWord(deadline.applicationDeadline, today),
    program: deadline.program.title,
    intake: deadline.intake.label,
    verifiedOn: deadline.intake.verifiedOn,
    sameDateCount: deadline.sameDateCount,
  };
}

export type UniversityCatalogueRow = Readonly<{
  university: PublishedUniversity;
  deadline: UniversityDeadlineView | null;
}>;

const byName = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/**
 * Порядок по умолчанию: сначала ближайший подтверждённый срок, при равной
 * дате — название; без срока — по названию после всех со сроком. Порядок
 * общий для всего прочитанного каталога, а не внутри страницы.
 */
export function sortCatalogueRows(
  items: readonly PublishedUniversity[],
  level: UniversityFilters["level"],
  now: Date,
): UniversityCatalogueRow[] {
  return items
    .map((university) => ({ university, deadline: universityDeadlineView(university, level, now) }))
    .sort((a, b) => {
      if (a.deadline && b.deadline && a.deadline.dateTime !== b.deadline.dateTime) return a.deadline.dateTime < b.deadline.dateTime ? -1 : 1;
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && b.deadline) return 1;
      return byName.compare(a.university.content.name, b.university.content.name)
        || (a.university.id < b.university.id ? -1 : a.university.id > b.university.id ? 1 : 0);
    });
}

export type CataloguePage = Readonly<{
  rows: readonly UniversityCatalogueRow[];
  /** Сколько университетов по фильтру — только из полного чтения. */
  total: number | null;
  /** Номер первой строки страницы (с 1); 0 — строк нет. */
  first: number;
  last: number;
  previousOffset: number | null;
  nextOffset: number | null;
  /** «deadline» — общий порядок по сроку; «name» — страницы сервера по названию. */
  order: "deadline" | "name";
}>;

/** Страница полного отсортированного каталога; смещение за концом — пустая страница с «Назад». */
export function catalogueSortedPage(rows: readonly UniversityCatalogueRow[], offset: number): CataloguePage {
  const slice = rows.slice(offset, offset + UNIVERSITY_PAGE_SIZE);
  return {
    rows: slice,
    total: rows.length,
    first: slice.length ? offset + 1 : 0,
    last: offset + slice.length,
    previousOffset: offset > 0 ? Math.max(0, Math.min(offset - UNIVERSITY_PAGE_SIZE, Math.floor(Math.max(rows.length - 1, 0) / UNIVERSITY_PAGE_SIZE) * UNIVERSITY_PAGE_SIZE)) : null,
    nextOffset: offset + UNIVERSITY_PAGE_SIZE < rows.length ? offset + UNIVERSITY_PAGE_SIZE : null,
    order: "deadline",
  };
}

/**
 * Каталог больше предела полного чтения: прежние страницы сервера по
 * названию. Сроки у строк есть, общего числа нет — его не выдумываем.
 */
export function catalogueServerPage(
  items: readonly PublishedUniversity[],
  offset: number,
  nextOffset: number | null,
  level: UniversityFilters["level"],
  now: Date,
): CataloguePage {
  return {
    rows: items.map((university) => ({ university, deadline: universityDeadlineView(university, level, now) })),
    total: null,
    first: items.length ? offset + 1 : 0,
    last: offset + items.length,
    previousOffset: offset > 0 ? Math.max(0, offset - UNIVERSITY_PAGE_SIZE) : null,
    nextOffset,
    order: "name",
  };
}

/** Сколько программ в карточке; с фильтром уровня — сколько программ этого уровня. */
export function catalogueProgramCount(university: PublishedUniversity, level: UniversityFilters["level"]): number {
  return level ? university.content.programs.filter((program) => program.level === level).length : university.content.programs.length;
}

/** «1 программа», «3 программы», «12 программ». */
export function programsWord(count: number): string {
  const tens = count % 100, ones = count % 10;
  if (ones === 1 && tens !== 11) return "программа";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "программы";
  return "программ";
}

/* ------------------------------------------------------------ Наборы */

export type IntakeDeadlineView = Readonly<{
  dateTime: string;
  /** «15.10.26» — день срока в поясе набора; год — только если не текущий. */
  text: string;
  /** «23:59, Asia/Kuala_Lumpur» — время и пояс, если они опубликованы. */
  zone: string | null;
  /** Слово — только у срока, который ещё не прошёл и у открытого или объявленного набора. */
  word: CatalogueDueWord | null;
}>;

/** Срок подачи набора для таблицы детали; null — источник срока не называет. */
export function intakeDeadlineView(intake: UniversityIntake, now: Date): IntakeDeadlineView | null {
  if (!intake.applicationDeadline || !universityDate(intake.applicationDeadline)) return null;
  const today = catalogueZoneToday(intake.timezone, now) ?? now.toISOString().slice(0, 10);
  const zone = intake.timezone ? [intake.deadlineTime, intake.timezone].filter(Boolean).join(", ") : intake.deadlineTime;
  const passed = intakeDeadlinePassed(intake, now);
  const live = (intake.status === "open" || intake.status === "announced") && passed === false;
  return {
    dateTime: intake.applicationDeadline,
    text: formatCatalogueDay(intake.applicationDeadline, today),
    zone: zone || null,
    word: live ? catalogueDueWord(intake.applicationDeadline, catalogueZoneToday(intake.timezone, now) ?? today) : null,
  };
}

/**
 * Прошёл ли опубликованный срок в поясе набора; null — установить нельзя
 * (нет срока или пояса). Правило — то же, что у `universityIntakeLabel`:
 * день пояса и граница минуты включительно.
 */
export function intakeDeadlinePassed(intake: UniversityIntake, now: Date): boolean | null {
  if (!intake.applicationDeadline || !catalogueZone(intake.timezone) || !Number.isFinite(now.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: intake.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const at = (key: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === key)?.value ?? "";
  const day = `${at("year")}-${at("month")}-${at("day")}`;
  return intake.applicationDeadline < day
    || (intake.applicationDeadline === day && intake.deadlineTime !== null && intake.deadlineTime <= `${at("hour")}:${at("minute")}`);
}

/**
 * Состояние набора — прежняя подпись `universityIntakeLabel`, без изменений
 * (ревью #1079): набор без срока или без пояса не может ни открыться, ни
 * истечь по сроку — «Срок приёма нужно уточнить», как у main и в кабинете
 * студента; «по данным источника» остаётся. Неподтверждённые наборы
 * (`unknown`, `needs_reconfirmation`) в просмотре не показываются вовсе
 * (решение владельца 11.09, #729), поэтому подписи для них нет.
 */
export function intakeStateLabel(intake: UniversityIntake, now: Date): string | null {
  if (intake.status !== "open" && intake.status !== "announced" && intake.status !== "closed") return null;
  return universityIntakeLabel(intake, now);
}

/** Наборы, которые показываются: известные по источнику. */
export function shownIntakes(intakes: readonly UniversityIntake[]): UniversityIntake[] {
  return intakes.filter((intake) => intake.status === "announced" || intake.status === "open" || intake.status === "closed");
}

/** Начало обучения: день «28.09.26» (моно) или месяц словами «сентябрь 2026». */
export function intakeStartView(intake: UniversityIntake, today: string): Readonly<{ dateTime: string; text: string; mono: boolean }> | null {
  if (intake.startDate && universityDate(intake.startDate)) {
    return { dateTime: intake.startDate, text: formatCatalogueDay(intake.startDate, today), mono: true };
  }
  if (intake.startMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(intake.startMonth)) {
    const text = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${intake.startMonth}-01T12:00:00Z`));
    return { dateTime: intake.startMonth, text: text.replace(/\s*г\.$/u, ""), mono: false };
  }
  return null;
}

/* -------------------------------------------------------- Авторство фото */

/**
 * Пометки лицензий фото по-русски (Э6): короткая строка авторства под фото.
 * Имена лицензий CC и авторов остаются как в источнике; английские пометки о
 * праве встраивания переведены по смыслу, без изменения условий. Неизвестная
 * пометка показывается как есть — правду не подменяем догадкой.
 */
const LICENSE_RU: Readonly<Record<string, string>> = {
  "Public domain": "общественное достояние",
  "Public domain (PD-self)": "общественное достояние",
  "Public domain (author release)": "общественное достояние",
  "CC BY 3.0 pl": "CC BY 3.0 PL",
  "Official-source embedding; no reuse license stated": "с официального сайта, лицензия не указана",
  "Official related-school source embedding; no reuse license stated": "с сайта связанной школы, лицензия не указана",
  "Official shared-campus source embedding; no reuse license stated": "с сайта общего кампуса, лицензия не указана",
  "Official partner-source embedding; no reuse license stated": "с сайта партнёра, лицензия не указана",
  "All rights reserved; official-source embedding": "все права защищены, с официального сайта",
  "© Rights holder; supplier-source embedding; no reuse license stated": "© правообладатель, с сайта поставщика, лицензия не указана",
};

export function photoLicenseRu(license: string): string {
  return LICENSE_RU[license] ?? license;
}

/**
 * Автор фото по-русски (ревью #1079): имя автора или вуза — как в
 * источнике, английские пометки при нём переведены по смыслу, тем же
 * оборотом, что уже у русских записей библиотеки («— официальный сайт;
 * фотограф не указан»). Неизвестная пометка показывается как есть.
 */
const AUTHOR_RU: readonly (readonly [RegExp, string])[] = [
  [/\s*\(official website; photographer not stated\)$/u, " — официальный сайт; фотограф не указан"],
  [/\s*\(photographer not named\)$/u, " — фотограф не указан"],
  [/^Photographs by\s+/u, ""],
  [/^Czech Wikipedia user\s+(.+)$/u, "$1, участник чешской Википедии"],
  [/^(.+?)\s+at English Wikipedia$/u, "$1, участник английской Википедии"],
];

export function photoAuthorRu(author: string): string {
  return AUTHOR_RU.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), author);
}
