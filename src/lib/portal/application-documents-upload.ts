import {
  APPLICATION_DOCUMENT_MAX_FILE_BYTES, applicationDocumentCanonical, applicationDocumentExact, applicationDocumentRecord,
  applicationDocumentUploadHeaderFromIntent, parseApplicationDocumentItemTarget, parseApplicationDocumentUploadHeader,
  parseApplicationDocumentUploadIntent, parseApplicationDocumentUploadReceipt,
  type ApplicationDocumentItemTarget, type ApplicationDocumentUploadHeader, type ApplicationDocumentUploadIntent,
  type ApplicationDocumentUploadResult, type ApplicationDocumentFailure,
} from "./application-documents.ts";

export const APPLICATION_DOCUMENT_UPLOAD_HEADER = "X-EVO-Upload-Intent";
export const APPLICATION_DOCUMENT_UPLOAD_HEADER_MAX = 8192;
export const APPLICATION_DOCUMENT_UPLOAD_METADATA_MAX = 6144;
export const APPLICATION_DOCUMENT_TRANSPORT_FILENAME = "upload";
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
export function encodeApplicationDocumentUploadHeader(value: ApplicationDocumentUploadHeader): string | null {
  const header = parseApplicationDocumentUploadHeader(value);
  if (!header) return null;
  const bytes = new TextEncoder().encode(applicationDocumentCanonical(header));
  if (bytes.byteLength > APPLICATION_DOCUMENT_UPLOAD_METADATA_MAX) return null;
  const encoded = base64url(bytes);
  return encoded.length <= APPLICATION_DOCUMENT_UPLOAD_HEADER_MAX ? encoded : null;
}
export function decodeApplicationDocumentUploadHeader(value: unknown): ApplicationDocumentUploadHeader | null {
  if (typeof value !== "string" || !value.length || value.length > APPLICATION_DOCUMENT_UPLOAD_HEADER_MAX
    || /^[A-Za-z0-9_-]+$/u.exec(value)?.[0] !== value || value.length % 4 === 1) return null;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (bytes.byteLength > APPLICATION_DOCUMENT_UPLOAD_METADATA_MAX || base64url(bytes) !== value) return null;
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    // JSON key order/escaping are not command identity. SQL compares the full
    // normalized closed object; the surrounding base64url encoding is canonical.
    return parseApplicationDocumentUploadHeader(JSON.parse(decoded));
  } catch { return null; }
}
export async function applicationDocumentFileSha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function freezeApplicationDocumentUploadIntent(target: ApplicationDocumentItemTarget, file: File, requestId?: string): Promise<ApplicationDocumentUploadIntent | null> {
  const currentTarget = parseApplicationDocumentItemTarget(target);
  if (!currentTarget || !(file instanceof File) || file.size < 1 || file.size > APPLICATION_DOCUMENT_MAX_FILE_BYTES) return null;
  try {
    const bytes = await file.arrayBuffer();
    const sha256Hex = await applicationDocumentFileSha256(bytes);
    return parseApplicationDocumentUploadIntent({ protocolVersion: 1, ...currentTarget, requestId: requestId ?? crypto.randomUUID(),
      file: { originalFilename: file.name, declaredMimeType: file.type, byteSize: String(bytes.byteLength), sha256Hex } });
  } catch { return null; }
}
export async function applicationDocumentUploadFileMatches(intent: ApplicationDocumentUploadIntent, file: File): Promise<boolean> {
  const parsed = parseApplicationDocumentUploadIntent(intent);
  if (!parsed || !(file instanceof File) || file.name !== parsed.file.originalFilename || file.type !== parsed.file.declaredMimeType
    || String(file.size) !== parsed.file.byteSize) return false;
  try { return await applicationDocumentFileSha256(await file.arrayBuffer()) === parsed.file.sha256Hex; } catch { return false; }
}
function failure(reason: ApplicationDocumentFailure): ApplicationDocumentUploadResult { return { ok: false, reason, resolution: "retain" }; }
export async function uploadApplicationDocumentFile(input: Readonly<{
  audience: "student" | "staff"; intent: ApplicationDocumentUploadIntent; file: File; onProgress?: (percent: number) => void;
}>): Promise<ApplicationDocumentUploadResult> {
  const intent = parseApplicationDocumentUploadIntent(input.intent);
  if (!intent || !["student", "staff"].includes(input.audience) || !await applicationDocumentUploadFileMatches(intent, input.file)) return failure("invalid");
  const header = encodeApplicationDocumentUploadHeader(applicationDocumentUploadHeaderFromIntent(intent));
  if (!header) return failure("invalid");
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", input.audience === "student" ? "/api/portal/application-document-uploads" : "/api/v3/application-document-uploads");
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Idempotency-Key", intent.requestId);
    xhr.setRequestHeader(APPLICATION_DOCUMENT_UPLOAD_HEADER, header);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) { try { input.onProgress?.(Math.round(event.loaded / event.total * 100)); } catch { /* Display callbacks never change upload outcome. */ } }
    };
    xhr.onload = () => {
      const errorBody = applicationDocumentRecord(xhr.response);
      const detail = errorBody && applicationDocumentExact(errorBody, ["error"]) ? applicationDocumentRecord(errorBody.error) : null;
      const known = ["invalid", "forbidden", "request_conflict", "stale_context", "case_ineligible", "application_ineligible", "file_unavailable", "busy", "lease_expired", "file_too_large", "unsupported_type", "malware_detected", "rate_limited", "unavailable"];
      if (xhr.status >= 400 && xhr.status <= 599 && detail && applicationDocumentExact(detail, ["code", "resolution"])
        && known.includes(String(detail.code)) && ["retain", "not_written"].includes(String(detail.resolution))) {
        resolve({ ok: false, reason: detail.code as ApplicationDocumentFailure,
          resolution: detail.resolution === "not_written" && !["forbidden", "request_conflict"].includes(String(detail.code)) ? "not_written" : "retain" });
        return;
      }
      if (xhr.status === 201) {
        const body = applicationDocumentRecord(xhr.response);
        const receipt = body && applicationDocumentExact(body, ["upload"]) ? parseApplicationDocumentUploadReceipt(body.upload, intent) : null;
        resolve(receipt ? { ok: true, receipt } : failure("unavailable"));
        return;
      }
      const mapped: Record<number, ApplicationDocumentFailure> = { 400: "invalid", 403: "forbidden", 409: "request_conflict", 413: "file_too_large", 415: "unsupported_type", 422: "malware_detected", 429: "rate_limited" };
      resolve(failure(mapped[xhr.status] ?? "unavailable"));
    };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => resolve(failure("unavailable"));
    const form = new FormData();
    form.append("file", input.file, APPLICATION_DOCUMENT_TRANSPORT_FILENAME);
    try { xhr.send(form); } catch { resolve(failure("unavailable")); }
  });
}


/** Downloads through the ordinary same-origin grant/one-use consumption route. */
export async function downloadApplicationDocumentFile(input: Readonly<{
  audience: "student" | "staff"; target: ApplicationDocumentItemTarget; documentVersionId: string;
}>): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; reason: ApplicationDocumentFailure }>> {
  const target = parseApplicationDocumentItemTarget(input.target);
  if (!target || !["student", "staff"].includes(input.audience)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input.documentVersionId)) return { ok: false, reason: "invalid" };
  try {
    const query = new URLSearchParams({ ...target, documentVersionId: input.documentVersionId });
    const response = await fetch(`/api/${input.audience === "student" ? "portal" : "v3"}/application-document-downloads?${query}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return { ok: false, reason: response.status === 401 || response.status === 403 ? "forbidden" : "unavailable" };
    const blob = await response.blob();
    if (!blob.size || blob.size > APPLICATION_DOCUMENT_MAX_FILE_BYTES) return { ok: false, reason: "unavailable" };
    // Do not interpolate a server-controlled filename into markup or a path.
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const candidate = disposition.match(/filename="([^"\r\n]*)"/iu)?.[1];
    const name = candidate && !/[\p{Cc}/\\]/u.test(candidate) && candidate.length <= 255 ? candidate : "document";
    const url = URL.createObjectURL(blob);
    try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); }
    finally { URL.revokeObjectURL(url); }
    return { ok: true };
  } catch { return { ok: false, reason: "unavailable" }; }
}
