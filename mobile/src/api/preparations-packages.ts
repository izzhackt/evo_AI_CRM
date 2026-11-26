// RPC комплекта программы: отправка комплекта, проверка исхода, комплект подробно, история комплектов и решений. Веб:
// `application-packages-actions.ts`. Ответ принимают только строгие разборщики веба; отказы записи различаются по тексту
// ошибки сервера через общий `applicationPackageFailure` (текст нужен только для выбора причины из закрытого списка).
import {
  applicationPackageFailure,
  parseApplicationPackageDetail,
  parseApplicationPackageHistory,
  parseApplicationPackageRecovery,
  parseApplicationPackageReviewHistory,
  parseApplicationPackageSubmitIntent,
  parseApplicationPackageSubmitReceipt,
  type ApplicationPackageDetail,
  type ApplicationPackageFailureResult,
  type ApplicationPackageHistory,
  type ApplicationPackageRecoveryResult,
  type ApplicationPackageReviewHistory,
  type ApplicationPackageSubmitResult,
} from "@web/lib/portal/application-packages";
import {
  parseApplicationDocumentCursor,
  parseApplicationDocumentTarget,
  type ApplicationDocumentCursor,
} from "@web/lib/portal/application-documents";
import { universityIntakeId } from "@web/lib/platform-university-catalog";

import { callRpc, failureForParser } from "@/api/preparations-rpc";
import { DOCUMENT_PAGE_SIZE } from "@/api/preparations-documents";
import { PortalDecodeError } from "@/domain/portal-source";
import { rpcRead, type RpcTransport } from "@/lib/rpc";

const RETRIES = 2;
const refused = (reason: "invalid" | "unavailable"): ApplicationPackageFailureResult => ({ ok: false, reason, resolution: "retain" });
const wrapperOutcome = (failure: Parameters<typeof failureForParser>[0]) => applicationPackageFailure(failureForParser(failure));

/**
 * «Отправить комплект в EVO»: `application_package_submit_v1`. Запрос замороженный (с `requestId`), повтор при обрыве идёт с теми
 * же аргументами. Ответ принимается только как точная квитанция на этот запрос.
 */
export async function submitApplicationPackage(transport: RpcTransport, value: unknown, options: Readonly<{ wait?: (attempt: number) => Promise<void> }> = {}): Promise<ApplicationPackageSubmitResult> {
  const intent = parseApplicationPackageSubmitIntent(value);
  if (!intent) return refused("invalid");
  const outcome = await callRpc(transport, "application_package_submit_v1", { p_intent: intent }, { retries: RETRIES, wait: options.wait });
  // Ответа не было: комплект мог записаться, исход неизвестен.
  if (!outcome.ok) return outcome.transport ? refused("unavailable") : wrapperOutcome(outcome.failure);
  const receipt = parseApplicationPackageSubmitReceipt(outcome.data, intent);
  return receipt ? { ok: true, receipt } : refused("unavailable");
}

/** «Проверить результат»: `application_package_recover_v1` отвечает, записан ли комплект с этим `requestId` (`committed` или `not_written`). */
export async function recoverApplicationPackage(transport: RpcTransport, value: unknown, options: Readonly<{ wait?: (attempt: number) => Promise<void> }> = {}): Promise<ApplicationPackageRecoveryResult> {
  const intent = parseApplicationPackageSubmitIntent(value);
  if (!intent) return refused("invalid");
  const outcome = await callRpc(transport, "application_package_recover_v1", { p_operation: "submit", p_intent: intent }, { retries: RETRIES, wait: options.wait });
  if (!outcome.ok) return outcome.transport ? refused("unavailable") : wrapperOutcome(outcome.failure);
  const recovery = parseApplicationPackageRecovery(outcome.data, "submit", intent);
  return recovery ? { ok: true, recovery } : refused("unavailable");
}

function target(input: Readonly<{ studentCaseId: string; applicationId: string }>) {
  const parsed = parseApplicationDocumentTarget({ studentCaseId: input.studentCaseId, applicationId: input.applicationId });
  if (!parsed) throw new PortalDecodeError();
  return parsed;
}

/** Комплект подробно (`application_package_detail_v1`). Бросает при сбое чтения или чужой форме. */
export async function readPackageDetail(transport: RpcTransport, input: Readonly<{ studentCaseId: string; applicationId: string }>, packageId: string): Promise<ApplicationPackageDetail> {
  const scope = target(input);
  if (!universityIntakeId(packageId)) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_package_detail_v1", { p_student_case_id: scope.studentCaseId, p_application_id: scope.applicationId, p_package_id: packageId });
  const detail = parseApplicationPackageDetail(data, scope, packageId);
  if (!detail) throw new PortalDecodeError();
  return detail;
}

/** Страница истории комплектов программы (`application_package_history_v1`). */
export async function readPackageHistory(transport: RpcTransport, input: Readonly<{ studentCaseId: string; applicationId: string }>, cursor: ApplicationDocumentCursor | null = null): Promise<ApplicationPackageHistory> {
  const scope = target(input);
  if (cursor !== null && !parseApplicationDocumentCursor(cursor)) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_package_history_v1", { p_student_case_id: scope.studentCaseId, p_application_id: scope.applicationId, p_cursor: cursor, p_limit: DOCUMENT_PAGE_SIZE });
  const history = parseApplicationPackageHistory(data, scope);
  if (!history) throw new PortalDecodeError();
  return history;
}

/** Страница истории решений по комплекту (`application_package_review_history_v1`). */
export async function readPackageReviewHistory(transport: RpcTransport, input: Readonly<{ studentCaseId: string; applicationId: string }>, packageId: string, cursor: ApplicationDocumentCursor | null = null): Promise<ApplicationPackageReviewHistory> {
  const scope = target(input);
  if (!universityIntakeId(packageId) || (cursor !== null && !parseApplicationDocumentCursor(cursor))) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_package_review_history_v1", {
    p_student_case_id: scope.studentCaseId,
    p_application_id: scope.applicationId,
    p_package_id: packageId,
    p_cursor: cursor,
    p_limit: DOCUMENT_PAGE_SIZE,
  });
  const history = parseApplicationPackageReviewHistory(data, scope, packageId);
  if (!history) throw new PortalDecodeError();
  return history;
}
