"use server";

import { revalidatePath } from "next/cache";

import {
  acceptKindLabel, CLASSIFIED_GROUP_LABEL, confidenceBand, dedupeAppliesTo, isAcceptKindKey, isAmoUnsortedGroup, isDocumentKindKey,
  isFinanceKind, matchStandardKindLabel, normalizeCustomDocumentLabel, type AcceptKindKey,
} from "./document-classification";
import { MAX_BULK_ACCEPT, sortingRequestId } from "./document-sorting-ids";
import { isStaffPreview, staffCan, staffHasPermission } from "./platform-access.ts";
import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import { requirePlatformStaffActor } from "./platform-guards";
import { getPlatformCaseDocumentWorkspace } from "./platform-private-documents";
import { exactActionStringFields } from "./server/action-form-fields";
import { financeWritable, sendDocumentToFinance } from "./server/document-finance-handoff";
import { createSupabaseServerClient } from "./supabase/server";
import { readCaseDocumentSuggestions } from "./v3/document-suggestions-source";

// «Принять» файл из amoCRM как вид документа (миграция 333): перенос в пункт чек-листа и одобрение делают СУЩЕСТВУЮЩИЕ команды
// с их правами (change_document_slot_metadata: document.manage; review_document_version: documents.write), затем решение
// куратора записывается отдельно от подсказки ИИ. Идентификаторы команд выводятся из версии файла и вида, поэтому повтор
// после обрыва ничего не двоит.

export type DocumentSortingOutcome =
  | "saved" | "decision_not_recorded" | "invalid" | "forbidden" | "stale" | "target_exists" | "file_unavailable" | "partly_saved" | "unavailable"
  | "finance_forbidden" | "finance_failed";
export type DocumentSortingResult = Readonly<{ outcome: DocumentSortingOutcome }>;
export type DocumentSortingBulkResult = Readonly<{ outcome: "done" | "invalid" | "forbidden" | "unavailable"; accepted: number; failed: number; skipped: number; unrecorded: number }>;


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

async function resolveDecision(actor: Actor, client: Client, studentCaseId: string, versionId: string, kind: AcceptKindKey, requestKind: string): Promise<boolean> {
  // Запись решения: один повтор (тот же идентификатор, повтор безопасен).
  for (let attempt = 0; attempt < 2; attempt++) {
    const resolved = await client.schema("platform").rpc("staff_resolve_document_suggestion_v1", {
      p_organization_id: actor.organizationId, p_student_case_id: studentCaseId, p_document_version_id: versionId, p_kind_key: kind,
      p_request_id: sortingRequestId(versionId, requestKind, "resolve"),
    });
    if (!resolved.error && record(resolved.data) && typeof resolved.data.resolution === "string") return true;
  }
  return false;
}

async function acceptOne(
  actor: Actor, client: Client, studentCaseId: string, slotId: string, versionId: string, requestedKind: AcceptKindKey, requestedLabel: string | null = null,
): Promise<DocumentSortingOutcome> {
  // «Другое…» с названием стандартного вида («Паспорт», «passport», «Чек»…) - это сам этот вид: те же правила, что при выборе из списка
  // (повтор пункта с таким названием, деньги, право). Второй документ под своей подписью не заводится. Сведение делается здесь, в
  // единственном месте приёма, а не в форме: клиент не может его обойти.
  const standard = requestedKind === "other" && requestedLabel !== null ? matchStandardKindLabel(requestedLabel) : null;
  const kind: AcceptKindKey = standard ?? requestedKind;
  const customLabel = standard ? null : requestedLabel;
  const label = kind === "other" ? customLabel : acceptKindLabel(kind);
  if (kind !== "not_needed" && !label) return "invalid";
  // Договор уходит в «Деньги» с теми же правами, что у загрузки там (can_write блока 189). Нет права - приём отказывает целиком,
  // до любых изменений: молчаливого пропуска нет. «Чек» сюда не входит: отправка чека в список «Чеки ждут оплату» - действие с
  // документом (право разбора файлов, его держит команда базы record_pending_receipt_v1), а ПРИВЯЗКА к оплате остаётся денежным действием
  // (allocate_pending_receipt_v1: право записи оплаты дела).
  if (kind === "contract" && !(await financeWritable(client, actor.organizationId, studentCaseId))) return "finance_forbidden";
  const workspace = await getPlatformCaseDocumentWorkspace(actor, studentCaseId, { client });
  if (workspace.caseState !== "active") return "forbidden";
  const slot = workspace.slots.find((item) => item.documentSlotId === slotId);
  if (!slot || slot.currentVersionId !== versionId) return "stale";
  // requestKind различает названия «Другое…»: другое название - другая команда, тот же - безопасный повтор.
  const requestKind = kind === "other" ? `other:${label}` : kind;

  if (kind === "not_needed") {
    // «Не нужное»: решение записывается, пункт скрывается мягким удалением (removed_at); файл остаётся в архиве удалённых пунктов.
    if (slot.intentKind !== "custom" || !isAmoUnsortedGroup(slot.groupLabel) || slot.status !== "submitted") return "stale";
    if (!(await resolveDecision(actor, client, studentCaseId, versionId, kind, requestKind))) return "unavailable";
    const removed = await client.schema("platform").rpc("remove_document_slot", {
      p_organization_id: actor.organizationId, p_student_case_id: studentCaseId, p_document_slot_id: slotId, p_expected_version: String(slot.version),
      p_reason: "Отмечено как не нужное при разборе файлов", p_request_id: sortingRequestId(versionId, requestKind, "metadata"),
    });
    return removed.error ? errorOutcome(removed.error) : "saved";
  }

  const relabelled = slot.requirementLabel === label && slot.groupLabel === CLASSIFIED_GROUP_LABEL;
  if (!relabelled) {
    // Только ещё не разобранный пользовательский пункт группы «Из amoCRM…» «На проверке».
    if (slot.intentKind !== "custom" || !isAmoUnsortedGroup(slot.groupLabel) || slot.status !== "submitted") return "stale";
    // Пункт с таким названием уже есть (пустой или с файлом): второго «Паспорта» не заводим и файл в чужой пункт молча не вливаем.
    // Самое безопасное: отказ с пояснением, куратор сам решает, что делать с двумя файлами. Виды, которых по природе несколько
    // (чек об оплате, договор, своё название), проверку не проходят: у них одинаковые названия - обычное дело.
    if (dedupeAppliesTo(kind) && workspace.slots.some((item) => item.documentSlotId !== slotId && item.requirementLabel === label)) return "target_exists";
  }
  // Договор / чек: сначала «Деньги». Сбой здесь - файл ещё в списке разбора, повтор безопасен (имя объекта и запись вычислены из версии).
  if (isFinanceKind(kind)) {
    const handoff = await sendDocumentToFinance({ organizationId: actor.organizationId, membershipId: actor.membershipId }, studentCaseId, versionId, kind);
    if (handoff !== "ok") return "finance_failed";
  }
  if (!relabelled) {
    const moved = await client.schema("platform").rpc("change_document_slot_metadata", {
      p_organization_id: actor.organizationId, p_student_case_id: studentCaseId, p_document_slot_id: slotId, p_label: label,
      p_group_label: CLASSIFIED_GROUP_LABEL, p_expected_version: String(slot.version),
      p_reason: "Файл из amoCRM разобран по чек-листу", p_request_id: sortingRequestId(versionId, requestKind, "metadata"),
    });
    if (moved.error) return errorOutcome(moved.error);
  }
  if (slot.status !== "approved") {
    const reviewed = await client.schema("platform").rpc("review_document_version", {
      p_organization_id: actor.organizationId, p_document_version_id: versionId, p_decision: "approved", p_reason: null,
      p_request_id: sortingRequestId(versionId, requestKind, "review"),
    });
    // Перенос уже выполнен: файл лежит в нужном пункте «На проверке», его можно принять обычной кнопкой строки.
    if (reviewed.error) return errorOutcome(reviewed.error) === "file_unavailable" ? "file_unavailable" : "partly_saved";
  }
  // Файл уже перенесён и принят, поэтому неудача записи решения - не откат, а отдельный итог «принят, отметка не записалась».
  return (await resolveDecision(actor, client, studentCaseId, versionId, kind, requestKind)) ? "saved" : "decision_not_recorded";
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
  const fields = exactActionStringFields(form, ["student_case_id", "document_slot_id", "document_version_id", "kind_key", "custom_label"]);
  if (!fields) return { outcome: "invalid" };
  const caseId = parsePlatformAdmissionsUuid(fields.get("student_case_id")?.trim() ?? "");
  const slotId = parsePlatformAdmissionsUuid(fields.get("document_slot_id")?.trim() ?? "");
  const versionId = parsePlatformAdmissionsUuid(fields.get("document_version_id")?.trim() ?? "");
  const kind = fields.get("kind_key")?.trim() ?? "";
  if (!caseId || !slotId || !versionId || !isAcceptKindKey(kind)) return { outcome: "invalid" };
  // Своё название только у «Другое…»: обрезка, 1–120 знаков, без управляющих символов. У других видов поле должно быть пустым.
  const rawLabel = fields.get("custom_label") ?? "";
  const customLabel = kind === "other" ? normalizeCustomDocumentLabel(rawLabel) : null;
  if (kind === "other" ? customLabel === null : rawLabel !== "") return { outcome: "invalid" };
  try {
    const client = await createSupabaseServerClient();
    const outcome = await acceptOne(actor, client, caseId, slotId, versionId, kind, customLabel);
    if (outcome === "saved" || outcome === "partly_saved" || outcome === "decision_not_recorded") revalidate();
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
  const none = (outcome: DocumentSortingBulkResult["outcome"]): DocumentSortingBulkResult => ({ outcome, accepted: 0, failed: 0, skipped: 0, unrecorded: 0 });
  const actor = await requirePlatformStaffActor();
  if (!allowed(actor)) return none("forbidden");
  const fields = exactActionStringFields(form, ["student_case_id", "version_ids"]);
  if (!fields) return none("invalid");
  const caseId = parsePlatformAdmissionsUuid(fields.get("student_case_id")?.trim() ?? "");
  const ids = (fields.get("version_ids") ?? "").split(",").map((item) => parsePlatformAdmissionsUuid(item.trim()));
  if (!caseId || ids.length < 1 || ids.length > MAX_BULK_ACCEPT || ids.some((id) => id === null) || new Set(ids).size !== ids.length) return none("invalid");
  try {
    const suggestions = await readCaseDocumentSuggestions(actor, caseId);
    if (!suggestions) return none("unavailable");
    const client = await createSupabaseServerClient();
    let accepted = 0; let failed = 0; let skipped = 0; let unrecorded = 0;
    for (const id of ids as string[]) {
      const item = suggestions.aiAllowed ? suggestions.items.find((entry) => entry.documentVersionId === id) : undefined;
      if (!item || item.kind === "other" || !isDocumentKindKey(item.kind) || confidenceBand(item.kind, item.confidence) !== "confident") { skipped++; continue; }
      const outcome = await acceptOne(actor, client, caseId, item.documentSlotId, id, item.kind);
      if (outcome === "saved") accepted++;
      else if (outcome === "decision_not_recorded") { accepted++; unrecorded++; }
      else failed++;
    }
    if (accepted > 0) revalidate();
    return { outcome: "done", accepted, failed, skipped, unrecorded };
  } catch {
    return none("unavailable");
  }
}
