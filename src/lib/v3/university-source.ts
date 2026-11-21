import { staffHasPermission, isStaffPreview } from "../platform-access.ts";
import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { parseUniversityContent, parseUniversityDrafts, parseUniversityPage, universityUuid, type UniversityContent, type UniversityFilters, type PublishedUniversity } from "../platform-university-catalog";
import { createSupabaseServerClient } from "../supabase/server";
import { parseStaffUniversityCountries } from "../university-staff-countries.ts";
import { parseManageDraftPage, parseManageIndex, parseManageCursor, type ManageIndex } from "../university-manage-contract.ts";
import { parseUniversityListRead, universityListItem, type UniversityListItem } from "../university-list-item.ts";
import chinaContent from "../server/university-catalog-reviewed-china.json";
import malaysiaContent from "../server/university-catalog-reviewed-malaysia.json";
import europeContent from "../server/university-catalog-reviewed-europe.json";
import turkeyContent from "../server/university-catalog-reviewed-turkey.json";
import internationalContent from "../server/university-catalog-reviewed-international.json";
import otherContent from "../server/university-catalog-reviewed-other.json";

export const EMPTY_UNIVERSITY_FILTERS: UniversityFilters = { query: "", country: "", level: "", offset: 0 };
const args = (filters: UniversityFilters, id: string | null) => ({ p_query: filters.query || null, p_country: filters.country || null, p_level: filters.level || null, p_offset: filters.offset, p_institution_id: id });
export async function readStaffUniversities(actor: ActivePlatformActor, filters = EMPTY_UNIVERSITY_FILTERS, id: string | null = null) {
  if (!staffHasPermission(actor, "catalog.read") || (id !== null && !universityUuid(id))) throw new Error("Catalogue unavailable");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_university_catalog", { p_organization_id: actor.organizationId, ...args(filters, id) });
  const page = !error && parseUniversityPage(data);
  if (!page || (id !== null && page.items.some((item) => item.id !== id))) throw new Error("Catalogue unavailable");
  return page;
}
export type StaffUniversityCatalogue =
  | Readonly<{ kind: "complete"; items: readonly UniversityListItem[] }>
  | Readonly<{ kind: "server"; items: readonly UniversityListItem[]; nextOffset: number | null }>;
/**
 * Весь отфильтрованный каталог для «Университетов» сотрудников (Э6; миграция 364): лёгкие строки одним вызовом
 * `staff_university_catalog_rows_v1` — одна проверка права и одна сборка последних версий на запрос, без программ
 * целиком (число программ по уровням и только открытые и объявленные наборы для «ближайшего срока»). Порядок по
 * сроку и деление на страницы — у страницы, как прежде. Ответ одного вызова — один снимок каталога, поэтому прежнее
 * повторное чтение «каталог изменился посреди чтения» не нужно. Больше 1 200 вузов по фильтру — прежняя страница
 * сервера по названию (полные карточки), без общего числа.
 *
 * Замер 20.11.2026 (production, 269 вузов, 3 580 программ): прежнее полное чтение — 10 вызовов по 30 вузов,
 * 138–200 мс в базе и 3,14 МБ; лёгкое — один вызов на 91 КБ (замер после выпуска — docs/PLAN_CHANGES.md).
 */
export async function readStaffUniversityCatalogue(actor: ActivePlatformActor, filters: UniversityFilters): Promise<StaffUniversityCatalogue> {
  if (!staffHasPermission(actor, "catalog.read")) throw new Error("Catalogue unavailable");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_university_catalog_rows_v1", {
    p_organization_id: actor.organizationId, p_query: filters.query || null, p_country: filters.country || null, p_level: filters.level || null,
  });
  const read = !error && parseUniversityListRead(data, actor.organizationId);
  if (!read) throw new Error("Catalogue unavailable");
  if (read.complete) return { kind: "complete", items: read.items };
  const page = await readStaffUniversities(actor, filters);
  return { kind: "server", items: page.items.map(universityListItem), nextOffset: page.nextOffset };
}
export async function readStaffUniversityCountries(actor: ActivePlatformActor) {
  if (!staffHasPermission(actor, "catalog.read")) throw new Error("Catalogue unavailable");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_university_catalog_countries", { p_organization_id: actor.organizationId });
  const facet = !error && parseStaffUniversityCountries(data, actor.organizationId);
  if (!facet) throw new Error("Catalogue unavailable");
  return facet;
}
export async function readStudentUniversities(_actor: ActiveStudentPortalActor, filters = EMPTY_UNIVERSITY_FILTERS, id: string | null = null) {
  if (id !== null && !universityUuid(id)) throw new Error("Catalogue unavailable");
  const client = await createSupabaseServerClient();
  // The RPC derives the organization from the live Student identity, never a form.
  const { data, error } = await client.schema("platform").rpc("student_university_catalog", args(filters, id));
  const page = !error && parseUniversityPage(data);
  if (!page || (id !== null && page.items.some((item) => item.id !== id))) throw new Error("Catalogue unavailable");
  return page;
}
/** Bounded complete snapshot for explicit Admin review, never a partial fallback. */
export async function readUniversityBatchSnapshot(actor: ActivePlatformActor): Promise<PublishedUniversity[]> {
  if (!staffHasPermission(actor, "catalog.import.manage") || isStaffPreview(actor)) throw new Error("Catalogue unavailable");
  const items: PublishedUniversity[] = [], seen = new Set<string>();
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await readStaffUniversities(actor, { ...EMPTY_UNIVERSITY_FILTERS, offset });
    for (const item of page.items) {
      if (seen.has(item.id)) throw new Error("Catalogue changed during review");
      seen.add(item.id); items.push(item);
    }
    if (page.nextOffset === null) return items;
    if (page.nextOffset <= offset) throw new Error("Catalogue pagination invalid");
    offset = page.nextOffset;
  }
  throw new Error("Catalogue exceeds batch review limit");
}
export async function readUniversityDrafts(actor: ActivePlatformActor, id: string | null = null) {
  if (!staffHasPermission(actor, "catalog.import.manage") || (id !== null && !universityUuid(id))) throw new Error("Drafts unavailable");
  const client = await createSupabaseServerClient();
  const args = { p_organization_id: actor.organizationId, p_draft_id: id };
  // The release requires 211. Never fall back to the filtered legacy reader:
  // a stale schema cache could otherwise hide technical drafts as a success.
  const { data, error } = await client.schema("platform").rpc("admin_university_catalog_drafts_with_review_kind", args);
  const drafts = !error && parseUniversityDrafts(data);
  if (!drafts || (id !== null && drafts.some((draft) => draft.id !== id))) throw new Error("Drafts unavailable");
  return drafts;
}
/**
 * Editorial templates for an actual Admin review; never a published fallback.
 * Шесть пакетов (~4,9 МБ) разбираются один раз на процесс при первом вызове: данные собраны в сборку и не меняются,
 * поэтому повторный разбор на каждый запрос ничего не давал. Страница управления зовёт это только в режимах, где
 * шаблоны нужны. Ошибка разбора не запоминается: следующий вызов проверит заново.
 */
let reviewedTemplates: readonly Readonly<{ key: string; content: UniversityContent }>[] | null = null;
export function reviewedUniversityTemplates(): readonly Readonly<{ key: string; content: UniversityContent }>[] {
  if (reviewedTemplates) return reviewedTemplates;
  const seen = new Set<string>();
  const parsed = [...chinaContent, ...malaysiaContent, ...europeContent, ...turkeyContent, ...internationalContent, ...otherContent].map((entry) => {
    const content = parseUniversityContent(entry.content);
    if (!content || seen.has(entry.key)) throw new Error("Reviewed catalogue template invalid");
    seen.add(entry.key);
    return Object.freeze({ key: entry.key, content });
  });
  reviewedTemplates = Object.freeze(parsed);
  return reviewedTemplates;
}

/**
 * Имя проверенного шаблона по ключу фото (key = photoKey у всех 143 шаблонов)
 * — только подсказка для точечного поиска `student_university_catalog` по
 * имени. Совпадение решает строгое сравнение photoKey в ответе базы, а не
 * этот словарь.
 */
let reviewedNamesByPhotoKey: ReadonlyMap<string, string> | null = null;
export function reviewedUniversityNameForPhotoKey(photoKey: string): string | null {
  if (!reviewedNamesByPhotoKey) {
    const names = new Map<string, string>();
    for (const entry of [...chinaContent, ...malaysiaContent, ...europeContent, ...turkeyContent, ...internationalContent, ...otherContent]) {
      const name = (entry.content as { name?: unknown }).name;
      if (typeof name === "string" && name.trim() && !names.has(entry.key)) names.set(entry.key, name);
    }
    reviewedNamesByPhotoKey = names;
  }
  return reviewedNamesByPhotoKey.get(photoKey) ?? null;
}

/** Complete filtered pending queue via additive238; never fall back to the first50 reader. */
export async function readUniversityManageDraftPage(actor: ActivePlatformActor, index: ManageIndex) {
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage") || !parseManageIndex(index.q, index.cursor)) throw new Error("Drafts unavailable");
  const cursor = index.cursor ? parseManageCursor(index.cursor, index.q) : null;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_university_catalog_draft_page", {
    p_organization_id: actor.organizationId, p_query: index.q,
    p_cursor_created_at: cursor?.createdAt ?? null, p_cursor_id: cursor?.id ?? null,
  });
  const page = !error && parseManageDraftPage(data, actor.organizationId, index);
  if (!page) throw new Error("Drafts unavailable");
  return page;
}
