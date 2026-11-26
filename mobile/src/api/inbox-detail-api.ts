// Чтения экранов решения во «Входящих»: ответ куратора, решение по документу программы, решение по комплекту и прежние
// обращения к куратору. Те же RPC и те же строгие разборщики, что у страниц веба (/portal/notifications/[id],
// /portal/document-notifications/[id], /portal/package-notifications/[id] и «Прежние вопросы куратору»): чистые модули
// `@web/lib/...`, своего разбора здесь нет. Все функции STABLE, поэтому читаются GET. Транспорт приходит аргументом.
import {
  caseOperationUuid,
  decodeCaseHelpPage,
  type CaseHelpPage,
  type CaseHelpRequest,
  type HelpCursor,
} from "@web/lib/platform-admissions-support-contract";
import {
  parseApplicationDocumentNotification,
  type ApplicationDocumentCursor,
  type ApplicationDocumentNotification,
  type ApplicationDocumentTarget,
} from "@web/lib/portal/application-documents";
import {
  parseApplicationPackageDetail,
  parseApplicationPackageNotification,
  parseApplicationPackageReviewHistory,
  type ApplicationPackageDetail,
  type ApplicationPackageNotification,
  type ApplicationPackageReviewHistory,
} from "@web/lib/portal/application-packages";

import { PortalDecodeError } from "@/domain/portal-source";
import { rpcRead, type RpcTransport } from "@/lib/rpc";

/** Идентификатор уведомления из адреса экрана: UUID, иначе экран не обращается к серверу (веб: `notFound()`). */
export function isNotificationId(value: unknown): value is string {
  return caseOperationUuid(value);
}

/** Веб-разборщик сообщает о плохой форме обычной ошибкой; приложение различает форму данных своим типом. */
function decoded<T>(decode: () => T | null): T {
  let value: T | null;
  try {
    value = decode();
  } catch {
    throw new PortalDecodeError();
  }
  if (value === null) throw new PortalDecodeError();
  return value;
}

export type HelpReply = Readonly<{ request: CaseHelpRequest; readAt: string | null }>;

/**
 * Ответ куратора по уведомлению `case_help_answer` (`student_portal_help_reply_v1`, веб readStudentHelpReply): одно
 * отвеченное обращение и время, когда уведомление отмечено прочитанным.
 */
export async function readHelpReply(transport: RpcTransport, notificationId: string, studentCaseId: string): Promise<HelpReply> {
  if (!isNotificationId(notificationId)) throw new PortalDecodeError();
  const data = await rpcRead(transport, "student_portal_help_reply_v1", { p_notification_id: notificationId }, { get: true });
  const page = decoded(() => decodeCaseHelpPage(data, studentCaseId));
  const request = page.items[0];
  const readAt = data !== null && typeof data === "object" && "readAt" in data ? (data as { readAt: unknown }).readAt : undefined;
  if (page.items.length !== 1 || !request || request.status !== "answered") throw new PortalDecodeError();
  if (readAt !== null && (typeof readAt !== "string" || !Number.isFinite(Date.parse(readAt)))) throw new PortalDecodeError();
  return { request, readAt };
}

/**
 * Страница прежних обращений к куратору (`case_help_workspace_v1`, веб CaseHelpWorkspace с `student`): новые первыми,
 * по 50; `nextCursor` ведёт к более ранним. Первая страница: курсор опускается (GET не передаёт null).
 */
export async function readCaseHelpPage(transport: RpcTransport, studentCaseId: string, cursor: HelpCursor | null = null): Promise<CaseHelpPage> {
  const data = await rpcRead(
    transport,
    "case_help_workspace_v1",
    { p_case_id: studentCaseId, p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null },
    { get: true },
  );
  return decoded(() => decodeCaseHelpPage(data, studentCaseId));
}

/** Решение по документу программы (`student_application_document_notification_v1`, веб readStudentApplicationDocumentNotification). */
export async function readDocumentNotification(transport: RpcTransport, notificationId: string, studentCaseId: string): Promise<ApplicationDocumentNotification> {
  if (!isNotificationId(notificationId)) throw new PortalDecodeError();
  const data = await rpcRead(transport, "student_application_document_notification_v1", { p_notification_id: notificationId }, { get: true });
  return decoded(() => parseApplicationDocumentNotification(data, notificationId, studentCaseId));
}

/** Решение по комплекту (`application_package_notification_v1`, веб readStudentApplicationPackageNotification). */
export async function readPackageNotification(transport: RpcTransport, notificationId: string, studentCaseId: string): Promise<ApplicationPackageNotification> {
  if (!isNotificationId(notificationId)) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_package_notification_v1", { p_notification_id: notificationId }, { get: true });
  return decoded(() => parseApplicationPackageNotification(data, notificationId, studentCaseId));
}

/** Состав комплекта (`application_package_detail_v1`, веб readApplicationPackageDetailAction). */
export async function readPackageDetail(transport: RpcTransport, target: ApplicationDocumentTarget, packageId: string): Promise<ApplicationPackageDetail> {
  const data = await rpcRead(
    transport,
    "application_package_detail_v1",
    { p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_package_id: packageId },
    { get: true },
  );
  return decoded(() => parseApplicationPackageDetail(data, target, packageId));
}

/**
 * История решений по комплекту (`application_package_review_history_v1`, веб readApplicationPackageReviewHistoryAction): по 20,
 * новые первыми, `nextCursor` ведёт к более ранним. Курсор здесь объект (jsonb), поэтому вызов идёт POST: GET не передал бы
 * объект в строке запроса.
 */
export async function readPackageReviewHistory(
  transport: RpcTransport,
  target: ApplicationDocumentTarget,
  packageId: string,
  cursor: ApplicationDocumentCursor | null = null,
): Promise<ApplicationPackageReviewHistory> {
  const data = await rpcRead(
    transport,
    "application_package_review_history_v1",
    { p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_package_id: packageId, p_cursor: cursor, p_limit: 20 },
    { get: false },
  );
  return decoded(() => parseApplicationPackageReviewHistory(data, target, packageId));
}
