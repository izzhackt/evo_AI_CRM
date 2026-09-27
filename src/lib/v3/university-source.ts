import { staffHasPermission, isStaffPreview } from "../platform-access.ts";
import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { parseUniversityContent, parseUniversityDrafts, parseUniversityPage, universityUuid, type UniversityFilters, type UniversityPage, type PublishedUniversity } from "../platform-university-catalog";
import { createSupabaseServerClient } from "../supabase/server";
import { parseStaffUniversityCountries } from "../university-staff-countries.ts";
import { parseManageDraftPage, parseManageIndex, parseManageCursor, type ManageIndex } from "../university-manage-contract.ts";
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
/** Страниц по 30 в полном чтении каталога для общего порядка по сроку (до 1 200 университетов). */
const CATALOGUE_SORT_PAGES = 40;
const CATALOGUE_SORT_BATCH = 4;
const CATALOGUE_PAGE = 30;
export type StaffUniversityCatalogue =
  | Readonly<{ kind: "complete"; items: readonly PublishedUniversity[] }>
  | Readonly<{ kind: "server"; page: UniversityPage }>;
/** Каталог изменился посреди чтения (строка пришла дважды): чтение повторяется один раз. */
class CatalogueChangedError extends Error {
  constructor() { super("Catalogue changed during read"); }
}
async function readWholeCatalogue(actor: ActivePlatformActor, filters: UniversityFilters): Promise<StaffUniversityCatalogue> {
  const items: PublishedUniversity[] = [], seen = new Set<string>();
  /** true — страница последняя. */
  const take = (page: UniversityPage, offset: number) => {
    for (const item of page.items) {
      if (seen.has(item.id)) throw new CatalogueChangedError();
      seen.add(item.id); items.push(item);
    }
    if (page.nextOffset === null) return true;
    if (page.nextOffset !== offset + CATALOGUE_PAGE) throw new Error("Catalogue pagination invalid");
    return false;
  };
  // Первая страница — одна: каталог до 30 строк читается одним запросом.
  if (take(await readStaffUniversities(actor, { ...filters, offset: 0 }), 0)) return { kind: "complete", items };
  // Дальше — по четыре страницы сразу: 143 университета — 1 + 4 запроса.
  for (let first = 1; first < CATALOGUE_SORT_PAGES; first += CATALOGUE_SORT_BATCH) {
    const offsets = Array.from({ length: Math.min(CATALOGUE_SORT_BATCH, CATALOGUE_SORT_PAGES - first) }, (_, index) => (first + index) * CATALOGUE_PAGE);
    const pages = await Promise.all(offsets.map((offset) => readStaffUniversities(actor, { ...filters, offset })));
    for (const [index, page] of pages.entries()) {
      if (take(page, offsets[index])) return { kind: "complete", items };
    }
  }
  return { kind: "server", page: await readStaffUniversities(actor, filters) };
}
/**
 * Весь отфильтрованный каталог для «Университетов» сотрудников (Э6): порядок
 * по ближайшему сроку общий, поэтому страница читает все страницы того же
 * чтения `staff_university_catalog` и делит их сама. Первая страница читается
 * одна, остальные — по четыре сразу, без чтений за концом каталога. Каталог
 * за пределом — прежняя страница сервера по названию, без общего числа.
 * Каталог, изменившийся посреди чтения (Admin публикует карточку, строка
 * пришла дважды), читается ещё раз; второй сбой — ошибка чтения, а не молча
 * склеенный список.
 *
 * Замер 27.09.2026 (локальный Supabase Postgres 17.6.1.143 из
 * `resolve-postgres-test-image.sh`, 249 миграций, 143 проверенные карточки,
 * опубликованные функциями stage/review; Apple M4 Max): один вызов
 * `staff_university_catalog` — 4,1–4,8 мс, всё чтение из пяти вызовов —
 * 19,5–23 мс на сервере. Сеть и PostgREST production не измерялись.
 */
export async function readStaffUniversityCatalogue(actor: ActivePlatformActor, filters: UniversityFilters): Promise<StaffUniversityCatalogue> {
  try {
    return await readWholeCatalogue(actor, filters);
  } catch (error) {
    if (!(error instanceof CatalogueChangedError)) throw error;
    return readWholeCatalogue(actor, filters);
  }
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
/** Editorial templates for an actual Admin review; never a published fallback. */
export function reviewedUniversityTemplates() {
  const seen = new Set<string>();
  return [...chinaContent, ...malaysiaContent, ...europeContent, ...turkeyContent, ...internationalContent, ...otherContent].map((entry) => {
    const content = parseUniversityContent(entry.content);
    if (!content || seen.has(entry.key)) throw new Error("Reviewed catalogue template invalid");
    seen.add(entry.key);
    return { key: entry.key, content };
  });
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
