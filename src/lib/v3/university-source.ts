import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { parseUniversityContent, parseUniversityDrafts, parseUniversityPage, universityUuid, type UniversityFilters, type PublishedUniversity } from "../platform-university-catalog";
import { createSupabaseServerClient } from "../supabase/server";
import chinaContent from "../server/university-catalog-reviewed-china.json";
import malaysiaContent from "../server/university-catalog-reviewed-malaysia.json";
import europeContent from "../server/university-catalog-reviewed-europe.json";
import turkeyContent from "../server/university-catalog-reviewed-turkey.json";
import internationalContent from "../server/university-catalog-reviewed-international.json";
import otherContent from "../server/university-catalog-reviewed-other.json";

export const EMPTY_UNIVERSITY_FILTERS: UniversityFilters = { query: "", country: "", level: "", offset: 0 };
const args = (filters: UniversityFilters, id: string | null) => ({ p_query: filters.query || null, p_country: filters.country || null, p_level: filters.level || null, p_offset: filters.offset, p_institution_id: id });
export async function readStaffUniversities(actor: ActivePlatformActor, filters = EMPTY_UNIVERSITY_FILTERS, id: string | null = null) {
  if (!["admin", "sales", "admissions"].includes(actor.authorityRole) || (id !== null && !universityUuid(id))) throw new Error("Catalogue unavailable");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_university_catalog", { p_organization_id: actor.organizationId, ...args(filters, id) });
  const page = !error && parseUniversityPage(data);
  if (!page || (id !== null && page.items.some((item) => item.id !== id))) throw new Error("Catalogue unavailable");
  return page;
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
  if (actor.authorityRole !== "admin" || actor.presentationRole !== "admin") throw new Error("Catalogue unavailable");
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
  if (actor.authorityRole !== "admin" || (id !== null && !universityUuid(id))) throw new Error("Drafts unavailable");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("admin_university_catalog_drafts", { p_organization_id: actor.organizationId, p_draft_id: id });
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
