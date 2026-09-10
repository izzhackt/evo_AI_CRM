"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseUniversityContent, universityUuid, type UniversityActionState } from "./platform-university-catalog";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

export async function mutateUniversityCatalogAction(previous: UniversityActionState, form: FormData): Promise<UniversityActionState> {
  const actor = await requirePlatformStaffActor();
  let requestId = universityUuid(form.get("request_id")) ?? previous.requestId;
  const result = (status: UniversityActionState["status"], draftId: string | null = null, institutionId: string | null = null): UniversityActionState => ({ status, requestId, draftId, institutionId });
  if (actor.authorityRole !== "admin" || actor.presentationRole !== "admin") return result("forbidden");
  const fields = exactActionStringFields(form, ["operation", "request_id", "institution_id", "base_version", "content", "reason", "draft_id", "confirmed"]);
  if (!fields || !universityUuid(fields.get("request_id"))) return result("invalid");
  requestId = fields.get("request_id")!;
  const operation = fields.get("operation"), targetId = fields.get("institution_id") || null;
  const draftId = fields.get("draft_id") || null;
  if (targetId !== null && !universityUuid(targetId)) return result("invalid");
  let rpc: string, args: Record<string, unknown>;
  if (operation === "stage") {
    let parsed: unknown;
    const raw = fields.get("content")!;
    if (raw.length > 250_000 || !/^(0|[1-9]\d{0,15})$/.test(fields.get("base_version")!) || draftId !== null || fields.get("confirmed") !== "") return result("invalid");
    try { parsed = JSON.parse(raw); } catch { return result("invalid"); }
    const content = parseUniversityContent(parsed), version = Number(fields.get("base_version")), reason = fields.get("reason")!.trim();
    if (!content || !Number.isSafeInteger(version) || version < 0 || version > Number.MAX_SAFE_INTEGER - 1 || !reason || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) return result("invalid");
    rpc = "stage_university_catalog_publication";
    args = { p_institution_id: targetId, p_base_version: version, p_content: content, p_reason: reason };
  } else if (operation === "publish" || operation === "reject") {
    if (!universityUuid(draftId) || fields.get("confirmed") !== "yes" || targetId !== null || fields.get("content") !== "" || fields.get("reason") !== "" || fields.get("base_version") !== "") return result("invalid");
    rpc = "review_university_catalog_publication";
    args = { p_draft_id: draftId, p_decision: operation };
  } else return result("invalid");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc(rpc, { ...args, p_organization_id: actor.organizationId, p_request_id: requestId });
    if (error) return result(error.code === "42501" ? "forbidden" : error.code === "40001" ? "stale" : error.code === "23505" ? "request_conflict" : error.code === "22023" ? "invalid" : "unavailable");
    const expected = operation === "stage" ? "saved" : operation === "publish" ? "published" : "rejected";
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).sort().join() !== "draftId,institutionId,requestId,status" || data.requestId !== requestId || data.status !== expected || !universityUuid(data.draftId) || !(data.institutionId === null || universityUuid(data.institutionId)) || (draftId && data.draftId !== draftId) || (targetId && data.institutionId !== targetId) || (expected === "published" && !data.institutionId)) return result("unavailable");
    revalidatePath("/v3/universities");
    revalidatePath("/v3/universities/manage");
    revalidatePath("/portal/universities");
    if (data.institutionId) {
      revalidatePath(`/v3/universities/${data.institutionId}`);
      revalidatePath(`/portal/universities/${data.institutionId}`);
    }
    return result(expected, data.draftId, data.institutionId);
  } catch { return result("unavailable"); }
}
