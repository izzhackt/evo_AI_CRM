// Скачивание файла через bearer-маршруты портала (веб: ответ 307 на подписанный URL
// хранилища; `fetch` идёт по перенаправлению сам). Логика без нативных модулей: запись
// файла и сетевой вызов приходят аргументами, поэтому проверяется тестами с поддельным fetch.
// Права и срок ссылки решает сервер; адрес подписанного URL приложение не хранит и не показывает.
import { MAX_UPLOAD_BYTES, safeFileName } from "@/domain/documents-model";
import type { CaseFileKind } from "@/domain/portal-source";

export type DownloadTarget =
  | Readonly<{ kind: "version"; versionId: string }>
  | Readonly<{ kind: "case-file"; fileKind: CaseFileKind; fileId: string }>;

export type DownloadErrorKey = "docs.errorSession" | "docs.downloadForbidden" | "docs.downloadUnavailable" | "docs.downloadFailed" | "errorNetwork";

export type DownloadResult = Readonly<{ ok: true; uri: string; name: string }> | Readonly<{ ok: false; error: DownloadErrorKey }>;

export function downloadPath(target: DownloadTarget): string {
  return target.kind === "version"
    ? `/api/portal/document-versions/${encodeURIComponent(target.versionId)}/download`
    : `/api/portal/case-files/${target.fileKind}/${encodeURIComponent(target.fileId)}/download`;
}

export type DownloadDeps = Readonly<{
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl: (input: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Pick<Response, "status" | "ok" | "headers" | "arrayBuffer">>;
  /** Записать байты в кэш приложения и вернуть file:// URI. */
  writeFile: (name: string, bytes: Uint8Array) => Promise<string>;
}>;

function contentTypeMatches(contentType: string | null, mimeType: string): boolean {
  const type = (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  // Хранилище иногда отдаёт octet-stream; JSON и HTML означают страницу ошибки, а не файл.
  return type === mimeType.toLowerCase() || type === "application/octet-stream" || type === "binary/octet-stream";
}

export async function downloadFile(deps: DownloadDeps, target: DownloadTarget, fileName: string, mimeType: string, signal?: AbortSignal): Promise<DownloadResult> {
  const token = await deps.getToken();
  if (!token) return { ok: false, error: "docs.errorSession" };
  let response: Awaited<ReturnType<DownloadDeps["fetchImpl"]>>;
  try {
    response = await deps.fetchImpl(`${deps.baseUrl}${downloadPath(target)}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "*/*" }, signal });
  } catch {
    return { ok: false, error: "errorNetwork" };
  }
  if (response.status === 401) return { ok: false, error: "docs.errorSession" };
  if (response.status === 403) return { ok: false, error: "docs.downloadForbidden" };
  if (!response.ok) return { ok: false, error: "docs.downloadUnavailable" };
  if (!contentTypeMatches(response.headers.get("content-type"), mimeType)) return { ok: false, error: "docs.downloadFailed" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, error: "errorNetwork" };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "docs.downloadFailed" };
  const name = safeFileName(fileName, mimeType);
  try {
    return { ok: true, uri: await deps.writeFile(name, bytes), name };
  } catch {
    return { ok: false, error: "docs.downloadFailed" };
  }
}
