import "server-only";

import { sortingRequestId } from "../document-sorting-ids.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

// «Договор» и «Чек об оплате» при приёме файла в разборе документов (миграции 348–349, решение владельца 08.11.2026).
// Объект Storage копируется ВНУТРИ того же бакета (copy на стороне Storage, байты не читаются) в путь, который читают готовые
// маршруты скачивания 189. Имя нового объекта вычисляется из версии файла: повтор приёма находит тот же объект и ту же запись,
// второго договора или чека не появляется. Право сотрудника проверяется ДО этого вызова (`financeWritable`): те же двери, что у
// маршрутов загрузки договора и чека в «Деньги».

const BUCKET_ID = "platform-documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UserClient = Awaited<ReturnType<typeof import("../supabase/server.ts").createSupabaseServerClient>>;
export type FinanceHandoffActor = Readonly<{ organizationId: string; membershipId: string }>;
export type FinanceHandoffResult = "ok" | "failed";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** То же условие, что у загрузки договора и чека в 189: блок «Договор и оплата» читается и `can_write` истинно. */
export async function financeWritable(client: UserClient, organizationId: string, studentCaseId: string): Promise<boolean> {
  const { data, error } = await client.schema("platform").rpc("staff_case_agreement_v1", { p_student_case_id: studentCaseId });
  return !error && record(data) && data.organization_id === organizationId && data.can_write === true;
}

export async function sendDocumentToFinance(
  actor: FinanceHandoffActor, studentCaseId: string, versionId: string, kind: "contract" | "payment_receipt",
): Promise<FinanceHandoffResult> {
  if (!UUID.test(versionId) || !UUID.test(studentCaseId)) return "failed";
  const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const sourceResponse = await service.schema("platform").rpc("finance_document_source_v1", {
    p_organization_id: actor.organizationId, p_student_case_id: studentCaseId, p_document_version_id: versionId,
  });
  const source = sourceResponse.data;
  if (sourceResponse.error || !record(source) || typeof source.object_name !== "string" || typeof source.original_filename !== "string"
    || typeof source.declared_mime_type !== "string" || typeof source.sha256_hex !== "string"
    || typeof source.byte_size !== "number" && typeof source.byte_size !== "string") return "failed";

  const prefix = kind === "contract" ? "case-contracts" : "payment-receipts";
  const objectName = `${prefix}/${actor.organizationId}/${studentCaseId}/${versionId.toLowerCase()}`;
  const copied = await service.storage.from(BUCKET_ID).copy(source.object_name, objectName);
  // Объект уже есть: прежний приём дошёл до копирования, имя вычислено из той же версии - тот же файл.
  if (copied.error && !/exist|duplicate/i.test(String(copied.error.message))) return "failed";

  const common = {
    p_organization_id: actor.organizationId,
    p_original_filename: source.original_filename,
    p_declared_mime_type: source.declared_mime_type,
    p_byte_size: Number(source.byte_size),
    p_sha256_hex: source.sha256_hex,
    p_storage_object_name: objectName,
    p_request_id: sortingRequestId(versionId, kind, "finance"),
  };
  const recorded = kind === "contract"
    ? await service.schema("platform").rpc("record_case_contract_file_metadata", {
      ...common, p_student_case_id: studentCaseId, p_uploaded_by_membership_id: actor.membershipId,
    })
    : await service.schema("platform").rpc("record_pending_receipt_v1", {
      ...common, p_student_case_id: studentCaseId, p_document_version_id: versionId, p_queued_by_membership_id: actor.membershipId,
    });
  return recorded.error ? "failed" : "ok";
}
