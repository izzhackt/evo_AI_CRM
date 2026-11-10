"use server";
import { staffHasPermission, isStaffPreview } from "./platform-access.ts";
import { revalidatePath, revalidateTag } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { STUDENT_UNIVERSITY_INDEX_TAG } from "./portal/university-index-tag.ts";
import { universityUuid, type UniversityActionState } from "./platform-university-catalog";
import { universityBatchRequestId, universityContentHash, universityMissingIntakeIds, withStableUniversityIntakeIds } from "./server/university-catalog-batch";
import { createSupabaseServerClient } from "./supabase/server";
import { readUniversityBatchSnapshot, reviewedUniversityTemplates } from "./v3/university-source";

/** One explicitly confirmed, frozen template; existing Admin RPCs own all writes. */
export async function publishReviewedUniversityAction(input: unknown): Promise<UniversityActionState["status"]> {
  const actor = await requirePlatformStaffActor();
  if (!staffHasPermission(actor, "catalog.import.manage") || isStaffPreview(actor)) return "forbidden";
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
    revalidatePath("/universities");
    revalidatePath("/portal/universities");
    revalidatePath(`/universities/${published.data.institutionId}`);
    revalidatePath(`/portal/universities/${published.data.institutionId}`);
    revalidateTag(STUDENT_UNIVERSITY_INDEX_TAG, { expire: 0 });
    return "published";
  } catch { return "unavailable"; }
}

export type UniversityIntakeIdsBatchResult = Readonly<{
  status: "done" | "forbidden" | "unavailable";
  /** Вузов, чьи наборы получили идентификаторы в этом запуске. */
  identified: number;
  /** Вузов, где не вышло (версию поменяли параллельно, сбой); повторный запуск продолжит с них. */
  failed: readonly string[];
  /** Вузов без идентификаторов, до которых этот запуск не дошёл (не больше 25 за раз). */
  remaining: number;
}>;

/** За один запуск - не больше стольких вузов: две команды на вуз, ответ должен успеть до таймаута прокси. */
const INTAKE_IDS_PER_RUN = 25;

/**
 * «Проставить номера наборам» (10.11.2026, владелец: «программа плюс интейки чтобы выбирались»). Пока у набора нет
 * постоянного идентификатора, студент не может выбрать программу (`Detail`: «Выбор этого набора пока недоступен»). Для
 * каждой опубликованной карточки без идентификаторов - та же техническая версия, что у ручной формы (`stage_intake_ids`):
 * сведения и даты не меняются, база проверяет «только идентификаторы» (211), затем публикация тем же Admin. Номера запросов
 * и идентификаторы выводятся из вуза и версии: повтор после сбоя не задваивает и продолжает с тех, где не вышло.
 */
export async function identifyAllUniversityIntakesAction(input: unknown): Promise<UniversityIntakeIdsBatchResult> {
  const actor = await requirePlatformStaffActor();
  if (!staffHasPermission(actor, "catalog.import.manage") || isStaffPreview(actor)) return { status: "forbidden", identified: 0, failed: [], remaining: 0 };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).join() !== "confirmed" || (input as { confirmed: unknown }).confirmed !== true) {
    return { status: "forbidden", identified: 0, failed: [], remaining: 0 };
  }
  let published;
  try { published = await readUniversityBatchSnapshot(actor); } catch { return { status: "unavailable", identified: 0, failed: [], remaining: 0 }; }
  const client = await createSupabaseServerClient();
  let identified = 0;
  const failed: string[] = [];
  const missing = published.filter((item) => universityMissingIntakeIds(item.content) > 0);
  for (const university of missing.slice(0, INTAKE_IDS_PER_RUN)) {
    const content = withStableUniversityIntakeIds(university.content, university.id, university.version);
    const scope = [actor.organizationId, actor.membershipId, "intake-ids", university.id, university.version];
    try {
      const stageId = universityBatchRequestId(scope, "stage");
      const staged = await client.schema("platform").rpc("stage_university_intake_identity_publication", {
        p_organization_id: actor.organizationId, p_request_id: stageId, p_institution_id: university.id,
        p_base_version: university.version, p_content: content,
        p_reason: "Добавление постоянных идентификаторов наборов без изменения сведений и дат проверки источников",
      });
      const draftId = !staged.error && staged.data && typeof staged.data === "object" ? (staged.data as Record<string, unknown>).draftId : null;
      if (staged.error || typeof draftId !== "string" || !universityUuid(draftId)) { failed.push(university.content.name); continue; }
      const publishId = universityBatchRequestId(scope, "publish");
      const done = await client.schema("platform").rpc("review_university_catalog_publication", {
        p_organization_id: actor.organizationId, p_request_id: publishId, p_draft_id: draftId, p_decision: "publish",
      });
      const status = !done.error && done.data && typeof done.data === "object" ? (done.data as Record<string, unknown>).status : null;
      if (status !== "published") { failed.push(university.content.name); continue; }
      identified += 1;
      revalidatePath(`/universities/${university.id}`);
      revalidatePath(`/portal/universities/${university.id}`);
    } catch { failed.push(university.content.name); }
  }
  revalidatePath("/universities");
  revalidatePath("/universities/manage");
  revalidatePath("/portal/universities");
  revalidateTag(STUDENT_UNIVERSITY_INDEX_TAG, { expire: 0 });
  return { status: "done", identified, failed, remaining: Math.max(0, missing.length - INTAKE_IDS_PER_RUN) };
}
