// Скачивание файла через bearer-маршруты портала (веб: ответ 307 на подписанный URL
// хранилища; `fetch` идёт по перенаправлению сам). Логика без нативных модулей: запись
// файла и сетевой вызов приходят аргументами, поэтому проверяется тестами с поддельным fetch.
// Права и срок ссылки решает сервер; адрес подписанного URL приложение не хранит и не показывает.
import { MAX_UPLOAD_BYTES, safeFileName } from "@/domain/documents-model";
import type { CaseFileKind } from "@/domain/portal-source";

/** Виды файлов маршрута case-files: договор и чеки дела, чек студента и QR реквизитов оплаты. */
export type CaseFileDownloadKind = CaseFileKind | "student_receipt" | "payment_details_qr";

export type DownloadTarget =
  | Readonly<{ kind: "version"; versionId: string }>
  | Readonly<{ kind: "case-file"; fileKind: CaseFileDownloadKind; fileId: string }>;

export type DownloadErrorKey = "docs.errorSession" | "docs.downloadForbidden" | "docs.downloadUnavailable" | "docs.downloadFailed" | "errorNetwork";

export type DownloadResult = Readonly<{ ok: true; uri: string; name: string }> | Readonly<{ ok: false; error: DownloadErrorKey }>;

export function downloadPath(target: DownloadTarget): string {
  return target.kind === "version"
    ? `/api/portal/document-versions/${encodeURIComponent(target.versionId)}/download`
    : `/api/portal/case-files/${target.fileKind}/${encodeURIComponent(target.fileId)}/download`;
}

type FetchInit = { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal?: AbortSignal };
type FetchResult = Pick<Response, "status" | "ok" | "headers" | "arrayBuffer">;

export type DownloadDeps = Readonly<{
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Обновить сессию (один раз при 401) и вернуть новый токен; `null`: обновить не удалось. */
  refreshToken?: () => Promise<string | null>;
  /** Запрос без автоматического перехода по перенаправлениям (`redirect: "manual"`). */
  fetchImpl: (input: string, init: FetchInit) => Promise<FetchResult>;
  /** Записать байты в кэш приложения и вернуть file:// URI. */
  writeFile: (name: string, bytes: Uint8Array) => Promise<string>;
}>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function originOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
  return match ? `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}` : null;
}

/**
 * Куда ведёт перенаправление портала: абсолютный http(s) адрес ДРУГОГО происхождения, чем портал.
 * Подписанный адрес хранилища несёт доступ в самом адресе; Bearer на него уходить не должен.
 */
export function storageTarget(location: string | null, portalBase: string): string | null {
  if (!location) return null;
  const target = originOf(location);
  const portal = originOf(portalBase);
  if (!target || !portal || target === portal) return null;
  return location;
}

function contentTypeMatches(contentType: string | null, mimeTypes: readonly string[]): boolean {
  const type = (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  // Хранилище иногда отдаёт octet-stream; JSON и HTML означают страницу ошибки, а не файл.
  return mimeTypes.some((mimeType) => type === mimeType.toLowerCase()) || type === "application/octet-stream" || type === "binary/octet-stream";
}

/** Тип по ответу хранилища, если он из списка допустимых; иначе первый из списка. */
function resolvedMime(contentType: string | null, mimeTypes: readonly string[]): string {
  const type = (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  return mimeTypes.find((mimeType) => mimeType.toLowerCase() === type) ?? mimeTypes[0] ?? "application/octet-stream";
}

/**
 * Два шага. 1) Портал с Bearer и `redirect: "manual"`: ответ 307 с `Location` на подписанный адрес
 * хранилища (прочитать адрес можно, только не идя по нему сами). 2) Хранилище БЕЗ Authorization.
 * Bearer уходит только на портал; на 401 сессия обновляется один раз.
 */
export async function downloadFile(deps: DownloadDeps, target: DownloadTarget, fileName: string, mimeType: string | readonly string[], signal?: AbortSignal): Promise<DownloadResult> {
  const mimeTypes = typeof mimeType === "string" ? [mimeType] : mimeType;
  let token = await deps.getToken();
  if (!token) return { ok: false, error: "docs.errorSession" };
  const portalUrl = `${deps.baseUrl}${downloadPath(target)}`;
  const hop = (bearer: string) => deps.fetchImpl(portalUrl, { method: "GET", headers: { Authorization: `Bearer ${bearer}`, Accept: "*/*" }, redirect: "manual", signal });
  let response: FetchResult;
  try {
    response = await hop(token);
    if (response.status === 401 && deps.refreshToken) {
      token = await deps.refreshToken();
      if (!token) return { ok: false, error: "docs.errorSession" };
      response = await hop(token);
    }
  } catch {
    return { ok: false, error: "errorNetwork" };
  }
  if (response.status === 401) return { ok: false, error: "docs.errorSession" };
  if (response.status === 403) return { ok: false, error: "docs.downloadForbidden" };
  if (REDIRECT_STATUSES.has(response.status)) {
    const storageUrl = storageTarget(response.headers.get("location"), deps.baseUrl);
    if (!storageUrl) return { ok: false, error: "docs.downloadFailed" };
    try {
      // Второй шаг: подписанный адрес, никаких заголовков доступа.
      response = await deps.fetchImpl(storageUrl, { method: "GET", headers: { Accept: "*/*" }, redirect: "manual", signal });
    } catch {
      return { ok: false, error: "errorNetwork" };
    }
    if (REDIRECT_STATUSES.has(response.status)) return { ok: false, error: "docs.downloadFailed" };
  }
  if (!response.ok) return { ok: false, error: "docs.downloadUnavailable" };
  if (!contentTypeMatches(response.headers.get("content-type"), mimeTypes)) return { ok: false, error: "docs.downloadFailed" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, error: "errorNetwork" };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "docs.downloadFailed" };
  const name = safeFileName(fileName, resolvedMime(response.headers.get("content-type"), mimeTypes));
  try {
    return { ok: true, uri: await deps.writeFile(name, bytes), name };
  } catch {
    return { ok: false, error: "docs.downloadFailed" };
  }
}
