import { UNIVERSITY_TEMPLATE_MAX_BYTES, UNIVERSITY_TEMPLATE_MIME, type UniversityTemplateMime } from "./university-form-registry.ts";
import { normalizeUniversityTemplateIngressReceipt, normalizeUniversityTemplateInspectionMetadata, templateIngressUuid,
  type UniversityTemplateIngressReceipt } from "./university-template-ingress.ts";

export type UniversityTemplateFile = Readonly<{ file: File; sha256: string; byteSize: number; mime: UniversityTemplateMime }>;
export class UniversityTemplateRequestRejectedError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "UniversityTemplateRequestRejectedError"; }
}
export function universityTemplateSourceUrl(templateId: string, versionId: string): string {
  return `/api/v3/university-forms/${templateIngressUuid(templateId)}/versions/${templateIngressUuid(versionId)}/source`;
}
/** A declaration for reservation, never a scanner or native-inspection proof. */
export async function prepareUniversityTemplateFile(file: File): Promise<UniversityTemplateFile> {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > UNIVERSITY_TEMPLATE_MAX_BYTES) throw new Error("file_invalid");
  const mime = file.type || (/\.pdf$/iu.test(file.name) ? UNIVERSITY_TEMPLATE_MIME[0]
    : /\.docx$/iu.test(file.name) ? UNIVERSITY_TEMPLATE_MIME[1] : "");
  if (!UNIVERSITY_TEMPLATE_MIME.includes(mime as UniversityTemplateMime)) throw new Error("file_invalid");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new Error("file_invalid");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return Object.freeze({ file, sha256, byteSize: file.size, mime: mime as UniversityTemplateMime });
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("response_unavailable");
  const body = await response.text();
  if (body.length > 262144) throw new Error("response_unavailable");
  const value: unknown = JSON.parse(body);
  if (!response.ok) {
    if ([400, 401, 403, 409, 413, 415, 422].includes(response.status)
      && value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).join() === "error"
      && "error" in value && typeof value.error === "string"
      && ["authentication_required", "forbidden", "invalid_request", "stale_revision", "request_conflict", "source_changed",
        "access_changed", "archived", "expired", "not_active", "not_inspected", "source_too_large", "unsupported_media_type"].includes(value.error))
      throw new UniversityTemplateRequestRejectedError(value.error);
    throw new Error("response_unavailable");
  }
  return value;
}
export async function uploadUniversityTemplateFile(templateId: string, versionId: string, requestId: string,
  revision: number, source: UniversityTemplateFile, signal: AbortSignal): Promise<UniversityTemplateIngressReceipt> {
  const response = await fetch(universityTemplateSourceUrl(templateId, versionId), {
    method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    headers: { "Content-Type": source.mime, "Idempotency-Key": templateIngressUuid(requestId), "If-Match": `"${revision}"` },
    body: source.file,
  });
  const receipt = normalizeUniversityTemplateIngressReceipt(await json(response), templateId, versionId);
  if ((response.status === 202 && receipt.state === "verified") || receipt.request_id !== requestId || receipt.sha256 !== source.sha256 || receipt.byte_size !== source.byteSize)
    throw new Error("response_unavailable");
  return receipt;
}
export async function readUniversityTemplateStatus(templateId: string, versionId: string, signal: AbortSignal) {
  const response = await fetch(`${universityTemplateSourceUrl(templateId, versionId)}/status`, {
    credentials: "same-origin", cache: "no-store", redirect: "error", signal,
  });
  return normalizeUniversityTemplateInspectionMetadata(await json(response), templateId, versionId);
}
export async function reconcileUniversityTemplateUpload(templateId: string, versionId: string,
  operation: "cancel" | "reconcile", intent: Readonly<{ request_id: string; expected_revision: number; reason: string }>, signal: AbortSignal) {
  const response = await fetch(`${universityTemplateSourceUrl(templateId, versionId)}/${operation}`, {
    method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent),
  });
  // A returned ingress receipt identifies the original upload request, not the
  // separate reconcile/cancel intent, so do not compare those request IDs.
  const receipt = normalizeUniversityTemplateIngressReceipt(await json(response), templateId, versionId);
  if (response.status === 202 && receipt.state === "verified") throw new Error("response_unavailable");
  return receipt;
}
