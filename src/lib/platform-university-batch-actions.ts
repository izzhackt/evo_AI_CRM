"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { universityUuid, type UniversityActionState } from "./platform-university-catalog";
import { universityBatchRequestId, universityContentHash } from "./server/university-catalog-batch";
import { createSupabaseServerClient } from "./supabase/server";
import { reviewedUniversityTemplates } from "./v3/university-source";

/** One explicitly confirmed, frozen template; existing Admin RPCs own all writes. */
export async function publishReviewedUniversityAction(input: unknown): Promise<UniversityActionState["status"]> {
  const actor = await requirePlatformStaffActor();
  if (actor.authorityRole !== "admin" || actor.presentationRole !== "admin") return "forbidden";
  if (!input || typeof input !== "object" || Array.isArray(input)) return "invalid";
  const row = input as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "baseVersion,confirmed,hash,institutionId,key"
    || row.confirmed !== true || typeof row.key !== "string" || row.key.length > 150
    || typeof row.hash !== "string" || !/^[0-9a-f]{64}$/.test(row.hash)
    || !Number.isSafeInteger(row.baseVersion) || Number(row.baseVersion) < 0 || Number(row.baseVersion) > Number.MAX_SAFE_INTEGER - 1
    || !(row.institutionId === null || universityUuid(row.institutionId))) return "invalid";
  try {
    const template = reviewedUniversityTemplates().find((entry) => entry.key === row.key);
    if (!template || universityContentHash(template.content) !== row.hash) return "stale";
    const scope = [actor.organizationId, actor.membershipId, row.key, row.hash, row.institutionId as string | null, row.baseVersion as number];
    const client = await createSupabaseServerClient();
    const errorStatus = (code: string): UniversityActionState["status"] => code === "42501" ? "forbidden" : code === "40001" ? "stale" : code === "23505" ? "request_conflict" : code === "22023" ? "invalid" : "unavailable";
    const receiptValid = (data: unknown, requestId: string, status: string, draftId?: string) => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      const value = data as Record<string, unknown>;
      return Object.keys(value).sort().join() === "draftId,institutionId,requestId,status"
        && value.requestId === requestId && value.status === status && !!universityUuid(value.draftId)
        && (value.institutionId === null || !!universityUuid(value.institutionId))
        && (!draftId || value.draftId === draftId)
        && (row.institutionId === null || value.institutionId === row.institutionId)
        && (status !== "published" || !!value.institutionId);
    };
    const stageId = universityBatchRequestId(scope, "stage");
    const staged = await client.schema("platform").rpc("stage_university_catalog_publication", {
      p_organization_id: actor.organizationId, p_request_id: stageId,
      p_institution_id: row.institutionId, p_base_version: row.baseVersion,
      p_content: template.content,
      p_reason: `Проверенный каталог 2026-09: ${row.key}; SHA256 ${row.hash}`,
    });
    if (staged.error) return errorStatus(staged.error.code);
    if (!receiptValid(staged.data, stageId, "saved")) return "unavailable";
    const publishId = universityBatchRequestId(scope, "publish");
    const published = await client.schema("platform").rpc("review_university_catalog_publication", {
      p_organization_id: actor.organizationId, p_request_id: publishId,
      p_draft_id: staged.data.draftId, p_decision: "publish",
    });
    if (published.error) return errorStatus(published.error.code);
    if (!receiptValid(published.data, publishId, "published", staged.data.draftId)) return "unavailable";
    revalidatePath("/v3/universities");
    revalidatePath("/portal/universities");
    revalidatePath("/preview/student/universities");
    revalidatePath(`/v3/universities/${published.data.institutionId}`);
    revalidatePath(`/portal/universities/${published.data.institutionId}`);
    revalidatePath(`/preview/student/universities/${published.data.institutionId}`);
    return "published";
  } catch { return "unavailable"; }
}
