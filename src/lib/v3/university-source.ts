import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { parseUniversityContent, parseUniversityDrafts, parseUniversityPage, universityUuid, type UniversityFilters } from "../platform-university-catalog";
import { createSupabaseServerClient } from "../supabase/server";
import reviewedContent from "../server/university-catalog-reviewed-content.json";

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
  return reviewedContent.map((entry) => {
    const content = parseUniversityContent(entry.content);
    if (!content) throw new Error("Reviewed catalogue template invalid");
    return { key: entry.key, content };
  });
}
