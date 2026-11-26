// RPC документов программы: отправка на проверку, сохранённые версии файла, история. Веб: `application-documents-actions.ts`
// (`submit`, `readApplicationDocumentReusableVersionsAction`, `readApplicationDocumentHistoryAction`). Ответ принимают
// только строгие разборщики веба; загрузка файла идёт не через RPC, а через маршрут портала (`features/preparations/native.ts`).
import {
  applicationDocumentFailure,
  parseApplicationDocumentCursor,
  parseApplicationDocumentHistoryPage,
  parseApplicationDocumentReusableVersionsPage,
  parseApplicationDocumentSubmitIntent,
  parseApplicationDocumentSubmitReceipt,
  parseApplicationDocumentTarget,
  parseApplicationDocumentVersionCursor,
  type ApplicationDocumentCursor,
  type ApplicationDocumentFailureResult,
  type ApplicationDocumentHistoryPage,
  type ApplicationDocumentReusableVersionsPage,
  type ApplicationDocumentSubmitResult,
  type ApplicationDocumentVersionCursor,
} from "@web/lib/portal/application-documents";
import { universityIntakeId } from "@web/lib/platform-university-catalog";

import { callRpc, failureForParser } from "@/api/preparations-rpc";
import { PortalDecodeError } from "@/domain/portal-source";
import { rpcRead, type RpcTransport } from "@/lib/rpc";

const RETRIES = 2;
/** Страницы истории и сохранённых файлов: по двадцать, как на сайте. */
export const DOCUMENT_PAGE_SIZE = 20;

const refused = (reason: "invalid" | "unavailable"): ApplicationDocumentFailureResult => ({ ok: false, reason, resolution: "retain" });

/**
 * «Отправить на проверку»: `submit_application_document_v1`. Запрос приходит замороженным (с `requestId`); повтор при обрыве
 * идёт с теми же аргументами. Итог как у серверного действия веба: точный отказ базы с признаком «не записано» или «неизвестно».
 */
export async function submitApplicationDocument(transport: RpcTransport, value: unknown, options: Readonly<{ wait?: (attempt: number) => Promise<void> }> = {}): Promise<ApplicationDocumentSubmitResult> {
  const intent = parseApplicationDocumentSubmitIntent(value);
  if (!intent) return refused("invalid");
  const outcome = await callRpc(
    transport,
    "submit_application_document_v1",
    {
      p_student_case_id: intent.studentCaseId,
      p_application_id: intent.applicationId,
      p_requirements_revision_id: intent.requirementsRevisionId,
      p_requirement_item_id: intent.requirementItemId,
      p_selection: intent.selection,
      p_expected_previous_submission_id: intent.expectedPreviousSubmissionId,
      p_request_id: intent.requestId,
    },
    { retries: RETRIES, wait: options.wait },
  );
  // Ответа не было: запись могла дойти, исход неизвестен.
  if (!outcome.ok) return outcome.transport ? refused("unavailable") : applicationDocumentFailure(failureForParser(outcome.failure), "submit");
  const receipt = parseApplicationDocumentSubmitReceipt(outcome.data, intent);
  return receipt ? { ok: true, receipt } : refused("unavailable");
}

/** Страница сохранённых версий файла по требованию (`application_document_reusable_versions_v1`). Бросает при сбое чтения или чужой форме. */
export async function readReusableVersions(
  transport: RpcTransport,
  input: Readonly<{ studentCaseId: string; applicationId: string; requirementItemId: string }>,
  cursor: ApplicationDocumentVersionCursor | null = null,
): Promise<ApplicationDocumentReusableVersionsPage> {
  const target = parseApplicationDocumentTarget({ studentCaseId: input.studentCaseId, applicationId: input.applicationId });
  if (!target || !universityIntakeId(input.requirementItemId) || (cursor !== null && !parseApplicationDocumentVersionCursor(cursor))) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_document_reusable_versions_v1", {
    p_student_case_id: target.studentCaseId,
    p_application_id: target.applicationId,
    p_requirement_item_id: input.requirementItemId,
    p_cursor: cursor,
    p_limit: DOCUMENT_PAGE_SIZE,
  });
  const page = parseApplicationDocumentReusableVersionsPage(data, target, input.requirementItemId);
  if (!page) throw new PortalDecodeError();
  return page;
}

/** Страница истории документов: по требованию или по всей программе (`requirementItemId: null`). */
export async function readDocumentHistory(
  transport: RpcTransport,
  input: Readonly<{ studentCaseId: string; applicationId: string; requirementItemId: string | null }>,
  cursor: ApplicationDocumentCursor | null = null,
): Promise<ApplicationDocumentHistoryPage> {
  const target = parseApplicationDocumentTarget({ studentCaseId: input.studentCaseId, applicationId: input.applicationId });
  const item = input.requirementItemId;
  if (!target || (item !== null && !universityIntakeId(item)) || (cursor !== null && !parseApplicationDocumentCursor(cursor))) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_document_history_v1", {
    p_student_case_id: target.studentCaseId,
    p_application_id: target.applicationId,
    p_requirement_item_id: item,
    p_cursor: cursor,
    p_limit: DOCUMENT_PAGE_SIZE,
  });
  const page = parseApplicationDocumentHistoryPage(data, target, item);
  if (!page) throw new PortalDecodeError();
  return page;
}
