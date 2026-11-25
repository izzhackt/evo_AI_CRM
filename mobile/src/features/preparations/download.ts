// Скачивание файла документа программы: GET `/api/portal/application-document-downloads` с Bearer, ответ 302 на подписанный адрес
// хранилища, дальше как у обычных документов. Два шага (Bearer только на портал, хранилище без заголовков доступа), проверка
// типа и размера и запись в кэш - это `downloadFile` экрана «Документы». Здесь только свой адрес первого шага: запрос к
// маршруту обычных документов подменяется запросом к маршруту программы, остальное (в том числе переход в хранилище) идёт как есть.
import type { ApplicationDocumentItemTarget } from "@web/lib/portal/application-documents";

import { downloadFile, downloadPath, type DownloadDeps, type DownloadResult } from "@/features/documents/download";

export const APPLICATION_DOWNLOAD_PATH = "/api/portal/application-document-downloads";

const QUERY_KEYS = ["studentCaseId", "applicationId", "requirementsRevisionId", "requirementItemId", "documentSlotId"] as const;

/** Адрес маршрута: ровно шесть параметров, как требует сервер (цель требования и версия файла). */
export function applicationDownloadUrl(baseUrl: string, target: ApplicationDocumentItemTarget, documentVersionId: string): string {
  const query = [...QUERY_KEYS.map((key) => [key, target[key]] as const), ["documentVersionId", documentVersionId] as const]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${baseUrl}${APPLICATION_DOWNLOAD_PATH}?${query}`;
}

export function downloadApplicationFile(
  deps: DownloadDeps,
  target: ApplicationDocumentItemTarget,
  documentVersionId: string,
  fileName: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const probe = `${deps.baseUrl}${downloadPath({ kind: "version", versionId: documentVersionId })}`;
  const real = applicationDownloadUrl(deps.baseUrl, target, documentVersionId);
  return downloadFile({ ...deps, fetchImpl: (input, init) => deps.fetchImpl(input === probe ? real : input, init) }, { kind: "version", versionId: documentVersionId }, fileName, mimeType, signal);
}
