"use server";

import { revalidatePath } from "next/cache";

import {
  CLASSIFIED_GROUP_LABEL, confidenceBand, documentKindLabel, isAmoUnsortedGroup, isDocumentKindKey, type DocumentKindKey,
} from "./document-classification";
import { sortingRequestId } from "./document-sorting-ids";
import { isStaffPreview, staffCan, staffHasPermission } from "./platform-access.ts";
import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import { requirePlatformStaffActor } from "./platform-guards";
import { getPlatformCaseDocumentWorkspace } from "./platform-private-documents";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";
import { readCaseDocumentSuggestions } from "./v3/document-suggestions-source";

// «Принять» файл из amoCRM как вид документа (миграция 333): перенос в пункт чек-листа и одобрение делают СУЩЕСТВУЮЩИЕ команды
// с их правами (change_document_slot_metadata: document.manage; review_document_version: documents.write), затем решение
// куратора записывается отдельно от подсказки ИИ. Идентификаторы команд выводятся из версии файла и вида, поэтому повтор
// после обрыва ничего не двоит.

export type DocumentSortingOutcome =
  | "saved" | "invalid" | "forbidden" | "stale" | "target_exists" | "file_unavailable" | "partly_saved" | "unavailable";
export type DocumentSortingResult = Readonly<{ outcome: DocumentSortingOutcome }>;
export type DocumentSortingBulkResult = Readonly<{ outcome: "done" | "invalid" | "forbidden" | "unavailable"; accepted: number; failed: number; skipped: number }>;

const MAX_BULK = 200;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorOutcome(error: unknown): DocumentSortingOutcome {
  if (!record(error)) return "unavailable";
  const message = typeof error.message === "string" ? error.message : "";
  if (error.code === "PT409" || message === "document_slot_version_conflict"
    || message === "Only the current submitted document version can be reviewed" || message === "Removed document slots are immutable") return "stale";
  if (message === "Approval requires verified integrity and clean malware state" || message === "A verified ClamAV proof is required for approval") return "file_unavailable";
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023") return "invalid";
  return "unavailable";
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Actor = Awaited<ReturnType<typeof requirePlatformStaffActor>>;

async function acceptOne(actor: Actor, client: Client, studentCaseId: string, slotId: string, versionId: string, kind: DocumentKindKey): Promise<DocumentSortingOutcome> {
  const workspace = await getPlatformCaseDocumentWorkspace(actor, studentCaseId, { client });
  if (workspace.caseState !== "active") return "forbidden";
  const slot = workspace.slots.find((item) => item.documentSlotId === slotId);
  if (!slot || slot.currentVersionId !== versionId) return "stale";
  const label = documentKindLabel(kind);
  const relabelled = slot.requirementLabel === label && slot.groupLabel === CLASSIFIED_GROUP_LABEL;
  if (!relabelled) {
    // Только ещё не разобранный пользовательский пункт группы «Из amoCRM…» «На проверке».
    if (slot.intentKind !== "custom" || !isAmoUnsortedGroup(slot.groupLabel) || slot.status !== "submitted") return "stale";
    // В чек-листе уже есть пустой пункт этого вида: файл не подменяет его молча, куратор решает сам.
    if (workspace.slots.some((item) => item.documentSlotId !== slotId && item.requirementLabel === label && item.currentVersionId === null)) return "target_exists";
    const moved = await client.schema("platform").rpc("change_document_slot_metadata", {
      p_organization_id: actor.organizationId, p_student_case_id: studentCaseId, p_document_slot_id: slotId, p_label: label,
      p_group_label: CLASSIFIED_GROUP_LABEL, p_expected_version: String(slot.version),
      p_reason: "Файл из amoCRM разобран по чек-листу", p_request_id: sortingRequestId(versionId, kind, "metadata"),
    });
    if (moved.error) return errorOutcome(moved.error);
  }
  if (slot.status !== "approved") {
    const reviewed = await client.schema("platform").rpc("review_document_version", {
      p_organization_id: actor.organizationId, p_document_version_id: versionId, p_decision: "approved", p_reason: null,
      p_request_id: sortingRequestId(versionId, kind, "review"),
    });
    // Перенос уже выполнен: файл лежит в нужном пункте «На проверке», его можно принять обычной кнопкой строки.
    if (reviewed.error) return errorOutcome(reviewed.error) === "file_unavailable" ? "file_unavailable" : "partly_saved";
  }
  const resolved = await client.schema("platform").rpc("staff_resolve_document_suggestion_v1", {
    p_organization_id: actor.organizationId, p_student_case_id: studentCaseId, p_document_version_id: versionId, p_kind_key: kind,
    p_request_id: sortingRequestId(versionId, kind, "resolve"),
  });
  // Решение - след для разбора, не условие: файл уже перенесён и принят.
  void resolved;
  return "saved";
}

function allowed(actor: Actor): boolean {
  return !isStaffPreview(actor) && staffHasPermission(actor, "document.manage") && staffCan(actor, "documents.write");
}
function revalidate(): void {
  revalidatePath("/profile");
  revalidatePath("/main");
  revalidatePath("/knowledge");
}

/** Один файл: «Принять как …» или выбор другого вида. */
export async function acceptDocumentKindAction(form: FormData): Promise<DocumentSortingResult> {
  const actor = await requirePlatformStaffActor();
  if (!allowed(actor)) return { outcome: "forbidden" };
  const fields = exactActionStringFields(form, ["student_case_id", "document_slot_id", "document_version_id", "kind_key"]);
  if (!fields) return { outcome: "invalid" };
  const caseId = parsePlatformAdmissionsUuid(fields.get("student_case_id")?.trim() ?? "");
  const slotId = parsePlatformAdmissionsUuid(fields.get("document_slot_id")?.trim() ?? "");
  const versionId = parsePlatformAdmissionsUuid(fields.get("document_version_id")?.trim() ?? "");
  const kind = fields.get("kind_key")?.trim() ?? "";
  if (!caseId || !slotId || !versionId || !isDocumentKindKey(kind)) return { outcome: "invalid" };
  try {
    const client = await createSupabaseServerClient();
    const outcome = await acceptOne(actor, client, caseId, slotId, versionId, kind);
    if (outcome === "saved" || outcome === "partly_saved") revalidate();
    return { outcome };
  } catch {
    return { outcome: "unavailable" };
  }
}

/**
 * «Принять все уверенные»: только файлы, которые куратор видел в списке (version_ids), и только те, что СЕЙЧАС подсказаны
 * в полосе «уверенно» (подсказки перечитываются: без согласия студента их нет). Остальное не трогается.
 */
export async function acceptConfidentDocumentKindsAction(form: FormData): Promise<DocumentSortingBulkResult> {
  const none = (outcome: DocumentSortingBulkResult["outcome"]): DocumentSortingBulkResult => ({ outcome, accepted: 0, failed: 0, skipped: 0 });
  const actor = await requirePlatformStaffActor();
  if (!allowed(actor)) return none("forbidden");
  const fields = exactActionStringFields(form, ["student_case_id", "version_ids"]);
  if (!fields) return none("invalid");
  const caseId = parsePlatformAdmissionsUuid(fields.get("student_case_id")?.trim() ?? "");
  const ids = (fields.get("version_ids") ?? "").split(",").map((item) => parsePlatformAdmissionsUuid(item.trim()));
  if (!caseId || ids.length < 1 || ids.length > MAX_BULK || ids.some((id) => id === null) || new Set(ids).size !== ids.length) return none("invalid");
  try {
    const suggestions = await readCaseDocumentSuggestions(actor, caseId);
    if (!suggestions) return none("unavailable");
    const client = await createSupabaseServerClient();
    let accepted = 0; let failed = 0; let skipped = 0;
    for (const id of ids as string[]) {
      const item = suggestions.aiAllowed ? suggestions.items.find((entry) => entry.documentVersionId === id) : undefined;
      if (!item || item.kind === "other" || !isDocumentKindKey(item.kind) || confidenceBand(item.kind, item.confidence) !== "confident") { skipped++; continue; }
      const outcome = await acceptOne(actor, client, caseId, item.documentSlotId, id, item.kind);
      if (outcome === "saved") accepted++; else failed++;
    }
    if (accepted > 0) revalidate();
    return { outcome: "done", accepted, failed, skipped };
  } catch {
    return none("unavailable");
  }
}
