/**
 * Ctrl+K / ⌘K (Э7 плана редизайна): разделы, действие «Создать задачу» и
 * поиск студентов и лидов. Файл чистый — без запросов и без React: разделы
 * отбирает `buildV3Navigation` (права маршрутов), поиск получает чтения
 * снаружи (`command-palette-actions.ts` — настоящие, тест — синтетические).
 * Правило одно: в результатах только то, что роль может открыть той же
 * страницей. Студенты — роли с `admissions.read` и только дела с полным
 * доступом; лиды — роли с `sales.read`; обе ведут в `/v3/profile`, чей
 * маршрут тоже должен быть открыт. Просмотр роли — по правам роли
 * (`staffPresentationCan`), как у страниц.
 */
import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffCanAccessRoute, staffPresentationCan } from "../platform-access.ts";
import type { V3Navigation, V3NavigationLink } from "./navigation.ts";

/** Поиск начинается с двух символов: один символ находит почти всех. */
export const PALETTE_MIN_QUERY = 2;
/** Строк в группе результатов; больше — «уточните запрос». */
export const PALETTE_GROUP_LIMIT = 6;
export const PALETTE_MAX_QUERY = 200;

export type PaletteRow = Readonly<{ id: string; label: string; meta: string | null; href: string }>;
export type PaletteGroupRead = Readonly<{
  /** hidden — роли группа не положена; unavailable — чтение не удалось. */
  status: "ready" | "hidden" | "unavailable";
  rows: readonly PaletteRow[];
  /** Совпадений больше, чем показано. */
  more: boolean;
}>;
export type PaletteSearch = Readonly<{
  status: "ready" | "invalid";
  query: string;
  students: PaletteGroupRead;
  leads: PaletteGroupRead;
}>;

export type PaletteStudentCase = Readonly<{
  access: "full" | "sales_summary";
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  targetDegree: string | null;
  state: "pending" | "active" | "closed";
}>;
export type PaletteLead = Readonly<{ leadId: string; clientDisplayName: string | null }>;

/** Чтения поиска: запрос и предел строк; «ещё» — есть ли следующая страница. */
export type PaletteReaders = Readonly<{
  students: (actor: ActivePlatformActor, query: string, limit: number) => Promise<Readonly<{ rows: readonly PaletteStudentCase[]; hasNext: boolean }>>;
  leads: (actor: ActivePlatformActor, query: string, limit: number) => Promise<Readonly<{ rows: readonly PaletteLead[]; hasNext: boolean }>>;
}>;

export function paletteSearchAccess(actor: ActivePlatformActor): Readonly<{ students: boolean; leads: boolean }> {
  const profile = staffCanAccessRoute(actor, "/v3/profile");
  return {
    students: profile && staffPresentationCan(actor, "admissions.read"),
    leads: profile && staffPresentationCan(actor, "sales.read"),
  };
}

const CONTROL = /[\u0000-\u001f\u007f]/u;

/** null — запрос не годится (короче двух символов, длиннее предела, управляющие символы). */
export function paletteQuery(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL.test(value)) return null;
  const query = value.trim().replace(/\s+/gu, " ");
  return query.length >= PALETTE_MIN_QUERY && query.length <= PALETTE_MAX_QUERY ? query : null;
}

const STATE_WORD: Readonly<Record<PaletteStudentCase["state"], string | null>> = {
  active: null,
  pending: "ожидает начала",
  closed: "закрыто",
};

export function paletteStudentRow(row: PaletteStudentCase): PaletteRow {
  const meta = [row.targetCountry, row.targetDegree, STATE_WORD[row.state]].filter(Boolean).join(" · ");
  return {
    id: row.studentCaseId,
    label: row.studentDisplayName,
    meta: meta || null,
    href: `/v3/profile?case=${encodeURIComponent(row.studentCaseId)}`,
  };
}

export function paletteLeadRow(row: PaletteLead): PaletteRow {
  // Почта и телефон вместо имени не показываются: имени нет — так и сказано.
  return {
    id: row.leadId,
    label: row.clientDisplayName ?? "Лид без имени",
    meta: null,
    href: `/v3/profile?id=${encodeURIComponent(row.leadId)}`,
  };
}

const HIDDEN: PaletteGroupRead = Object.freeze({ status: "hidden", rows: Object.freeze([]), more: false });
const UNAVAILABLE: PaletteGroupRead = Object.freeze({ status: "unavailable", rows: Object.freeze([]), more: false });

async function readGroup<Row>(
  allowed: boolean,
  read: () => Promise<Readonly<{ rows: readonly Row[]; hasNext: boolean }>>,
  keep: (row: Row) => boolean,
  toRow: (row: Row) => PaletteRow,
): Promise<PaletteGroupRead> {
  if (!allowed) return HIDDEN;
  try {
    const page = await read();
    const rows = page.rows.filter(keep);
    return {
      status: "ready",
      rows: rows.slice(0, PALETTE_GROUP_LIMIT).map(toRow),
      more: page.hasNext || rows.length > PALETTE_GROUP_LIMIT,
    };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Поиск Ctrl+K. Каждая группа читается только если роль её открывает;
 * студенты — только дела с полным доступом (краткая сводка продаж дело не
 * открывает). Сбой одной группы не гасит другую.
 */
export async function searchCommandPalette(actor: ActivePlatformActor, value: unknown, readers: PaletteReaders): Promise<PaletteSearch> {
  const query = paletteQuery(value);
  if (query === null) return { status: "invalid", query: typeof value === "string" ? value : "", students: HIDDEN, leads: HIDDEN };
  const access = paletteSearchAccess(actor);
  // Одна строка сверх предела — чтобы честно сказать «есть ещё».
  const limit = PALETTE_GROUP_LIMIT + 1;
  const [students, leads] = await Promise.all([
    readGroup(access.students, () => readers.students(actor, query, limit), (row) => row.access === "full", paletteStudentRow),
    readGroup(access.leads, () => readers.leads(actor, query, limit), () => true, paletteLeadRow),
  ]);
  return { status: "ready", query, students, leads };
}

export type PaletteDestination = Readonly<{ id: string; label: string; group: string; href: string }>;

/**
 * Разделы меню, которые роль открывает, — те же ссылки, что в меню
 * (`buildV3Navigation`), с названием отдела для различения.
 */
export function paletteDestinations(navigation: Pick<V3Navigation, "home" | "groups" | "common" | "settings">): readonly PaletteDestination[] {
  const entry = (group: string) => (link: V3NavigationLink): PaletteDestination => ({ id: link.id, label: link.label, group, href: link.href });
  return [
    ...(navigation.home ? [entry("")(navigation.home)] : []),
    ...navigation.groups.flatMap((group) => group.links.map(entry(group.label))),
    ...navigation.common.map(entry("Общее")),
    ...(navigation.settings ? [entry("")(navigation.settings)] : []),
  ];
}

function fold(value: string): string {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е");
}

/** Совпадение по началу любого слова названия или отдела: «зад» → «Задачи», «вор» → обе «Воронки». */
export function paletteMatches(query: string, ...texts: readonly string[]): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return texts.some((text) => fold(text).split(/[\s«»"().,·—-]+/u).some((word) => word.startsWith(needle)) || fold(text).startsWith(needle));
}

/** Ctrl+K / ⌘K на любой раскладке: русская «л» — та же клавиша K (`code`). */
export function isPaletteShortcut(event: Readonly<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
    && (event.key.toLowerCase() === "k" || event.code === "KeyK");
}
