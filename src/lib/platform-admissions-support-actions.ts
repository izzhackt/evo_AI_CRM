"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { requireStudentPortalActor } from "./student-portal-guards";
import { caseOperationsRpc, readCaseHelp } from "./v3/case-operations-source";
import { caseOperationText, caseOperationUuid, caseOperationVersion, decodePartnerPacket,
  type CaseOperationFailure, type CaseOperationResult, type HelpCursor } from "./platform-admissions-support-contract";

function failure(code: CaseOperationFailure): CaseOperationResult {
  const messages = {
    invalid: "Проверьте заполнение. Для пакета можно выбирать только принятые и проверенные файлы.",
    denied: "Действие недоступно. Проверьте доступ к делу.", stale: "Данные изменились. Сверьте актуальный ответ перед повтором.",
    request_conflict: "Запрос уже использован. Сверьте данные перед новым действием.",
    unavailable: "Результат пока не подтверждён. Повторите тот же запрос — введённое сохранено.",
  };
  return { ok: false, code, message: messages[code] };
}
function errorResult(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return failure(code === "42501" ? "denied" : code === "22023" ? "invalid" : code === "40001" ? "stale" : code === "23505" ? "request_conflict" : "unavailable");
}
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)) ? row : null;
}
function helpReceipt(data: unknown, requestId: string, caseId: string): CaseOperationResult {
  const row = fields(data, ["id", "caseId", "version", "requestId"]);
  return row && row.requestId === requestId && row.caseId === caseId && caseOperationUuid(row.id) && caseOperationVersion(row.version)
    ? { ok: true, id: row.id, requestId } : failure("unavailable");
}
export async function preparePartnerPacketAction(input: unknown): Promise<CaseOperationResult> {
  try {
    const actor = await requirePlatformStaffActor();
    if (actor.presentationRole === "sales" || actor.presentationRole !== actor.authorityRole) return failure("denied");
    const row = fields(input, ["caseId", "applicationId", "versionIds", "requestId"]);
    if (!row || !caseOperationUuid(row.caseId) || !caseOperationUuid(row.applicationId) || !caseOperationUuid(row.requestId)
      || !Array.isArray(row.versionIds) || !row.versionIds.length || row.versionIds.length > 50 || !row.versionIds.every(caseOperationUuid)
      || new Set(row.versionIds).size !== row.versionIds.length) return failure("invalid");
    const packet = decodePartnerPacket(await caseOperationsRpc("prepare_partner_packet_v1", {
      p_case_id: row.caseId, p_application_id: row.applicationId, p_version_ids: row.versionIds, p_request_id: row.requestId,
    }));
    if (packet.caseId !== row.caseId || packet.applicationId !== row.applicationId || packet.requestId !== row.requestId
      || packet.files.length !== row.versionIds.length || packet.files.some(file => !(row.versionIds as string[]).includes(file.versionId))) return failure("unavailable");
    return { ok: true, id: packet.id, requestId: packet.requestId };
  } catch (error) { return errorResult(error); }
}
export async function createCaseHelpAction(input: unknown): Promise<CaseOperationResult> {
  try {
    const actor = await requireStudentPortalActor();
    const row = fields(input, ["subject", "body", "requestId"]);
    if (!row || !caseOperationText(row.subject, 160) || !caseOperationText(row.body, 4000) || !caseOperationUuid(row.requestId)) return failure("invalid");
    return helpReceipt(await caseOperationsRpc("create_case_help_request_v1", {
      p_subject: row.subject.trim(), p_body: row.body.trim(), p_request_id: row.requestId,
    }), row.requestId, actor.studentCaseId);
  } catch (error) { return errorResult(error); }
}
export async function answerCaseHelpAction(input: unknown): Promise<CaseOperationResult> {
  try {
    const actor = await requirePlatformStaffActor();
    if (actor.presentationRole === "sales" || actor.presentationRole !== actor.authorityRole) return failure("denied");
    const row = fields(input, ["caseId", "id", "answer", "version", "requestId"]);
    if (!row || !caseOperationUuid(row.caseId) || !caseOperationUuid(row.id) || !caseOperationUuid(row.requestId)
      || !caseOperationText(row.answer, 4000) || !caseOperationVersion(row.version)) return failure("invalid");
    const result = helpReceipt(await caseOperationsRpc("answer_case_help_request_v1", { p_case_id: row.caseId, p_help_id: row.id,
      p_answer: row.answer.trim(), p_expected_version: row.version, p_request_id: row.requestId,
    }), row.requestId, row.caseId);
    if (result.ok) revalidatePath("/portal", "layout");
    return result;
  } catch (error) { return errorResult(error); }
}
export async function loadCaseHelpAction(caseId: string, cursor: HelpCursor | null, student: boolean) {
  try {
    if (!caseOperationUuid(caseId) || (cursor && (!caseOperationUuid(cursor.id) || typeof cursor.at !== "string" || cursor.at.length > 40 || !Number.isFinite(Date.parse(cursor.at))))) return { ok: false as const };
    const actor = student ? await requireStudentPortalActor() : await requirePlatformStaffActor();
    return { ok: true as const, page: await readCaseHelp(actor, caseId, cursor) };
  } catch { return { ok: false as const }; }
}
