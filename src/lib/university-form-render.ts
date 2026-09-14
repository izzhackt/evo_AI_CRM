import { formInputHash, formInputRecord, formInputUuid, normalizeUniversityFormInput, type FormInput } from "./university-form-export-contract.ts";

export const UNIVERSITY_FORM_RENDER_MAX_CAPSULE = 2 * 1024 * 1024;
export const UNIVERSITY_FORM_RENDER_MAX_BYTES = 20 * 1024 * 1024;
export const UNIVERSITY_FORM_RENDER_MAX_METADATA = 4096;
export const UNIVERSITY_FORM_RENDER_MAX_FRAME = 12 + UNIVERSITY_FORM_RENDER_MAX_METADATA + UNIVERSITY_FORM_RENDER_MAX_BYTES;
export const UNIVERSITY_FORM_RENDER_POLICY = "evo-university-form-render-v1";
export const UNIVERSITY_FORM_RENDER_CAPSULE_DOMAIN = "evo-university-form-request-v1\u0000";
export type FormRenderBinding = Readonly<{ artifactId: string; preparationId: string; inputSnapshotSha256: string;
  generatedInputSha256: string; fieldReviewsSha256: string }>;
export type FormRenderRequest = Readonly<{ operation: "render-form-v1"; binding: FormRenderBinding; formInput: FormInput }>;
export const UNIVERSITY_FORM_RENDER_FAILURES = ["invalid_input", "binding_mismatch", "template_not_eligible", "form_not_ready", "text_overflow",
  "character_unsupported", "shaping_unsupported", "output_too_large", "source_unavailable"] as const;
export type FormRenderFailure = typeof UNIVERSITY_FORM_RENDER_FAILURES[number];
export type FormRenderRejection = Readonly<{ status: "rejected"; code: FormRenderFailure }>;
export const UNIVERSITY_FORM_RENDER_STATES = ["confirmed", "confirmed_empty", "missing", "unconfirmed", "conflict", "invalid", "manual"] as const;
export type FormRenderCounts = Readonly<Record<typeof UNIVERSITY_FORM_RENDER_STATES[number], number>>;
export type FormRenderWarning = "layout_review_required" | "manual_fields_unchanged" | "unresolved_fields_omitted" | "draft_notice";
export type FormRenderMetadata = FormRenderBinding & Readonly<{
  status: "rendered"; policyVersion: typeof UNIVERSITY_FORM_RENDER_POLICY; capsuleSha256: string;
  templateSha256: string; sourceByteLength: number; manifestSha256: string; manifestDigest: string;
  mode: "draft" | "final"; mimeType: FormInput["source_mime_type"]; rendererVersion: FormInput["renderer_version"];
  rendererId: "pizzip-3.2.0-xmldom-0.9.12" | "pdf-lib-1.17.1-fontkit-1.1.1";
  fontSha256: string | null; pageCount: number | null; outputByteLength: number; outputSha256: string;
  counts: FormRenderCounts; warnings: readonly FormRenderWarning[];
}>;
export type FormRenderExpectation = Readonly<{ request: FormRenderRequest; capsuleSha256: string; manifestDigest: string }>;

export function universityFormRenderWarnings(counts: FormRenderCounts, mode: "draft" | "final"): readonly FormRenderWarning[] {
  const warnings: FormRenderWarning[] = ["layout_review_required"];
  if (counts.manual > 0) warnings.push("manual_fields_unchanged");
  if (counts.confirmed_empty + counts.missing + counts.unconfirmed + counts.conflict + counts.invalid > 0) warnings.push("unresolved_fields_omitted");
  if (mode === "draft") warnings.push("draft_notice");
  return Object.freeze(warnings.sort());
}
export function parseUniversityFormRenderMetadata(value: unknown, expected: FormRenderExpectation): FormRenderMetadata | null {
  try {
    const { request, capsuleSha256, manifestDigest } = expected, f = request.formInput;
    const row = formInputRecord(value, ["status", "policyVersion", "artifactId", "preparationId", "inputSnapshotSha256", "generatedInputSha256", "fieldReviewsSha256",
      "capsuleSha256", "templateSha256", "sourceByteLength", "manifestSha256", "manifestDigest", "mode", "mimeType", "rendererVersion", "rendererId", "fontSha256",
      "pageCount", "outputByteLength", "outputSha256", "counts", "warnings"]);
    const constants = { ...request.binding, status: "rendered", policyVersion: UNIVERSITY_FORM_RENDER_POLICY, capsuleSha256: formInputHash(capsuleSha256),
      templateSha256: f.template.sha256, sourceByteLength: f.source_byte_size, manifestSha256: f.manifest_sha256, manifestDigest: formInputHash(manifestDigest),
      mode: f.mode, mimeType: f.source_mime_type, rendererVersion: f.renderer_version,
      rendererId: f.template.manifest.format === "pdf" ? "pdf-lib-1.17.1-fontkit-1.1.1" : "pizzip-3.2.0-xmldom-0.9.12",
      fontSha256: f.font_sha256, pageCount: f.template.manifest.format === "pdf" ? f.template.manifest.pageSizes.length : null } as const;
    if (!Object.entries(constants).every(([key, value]) => row[key] === value)) return null;
    if (typeof row.outputByteLength !== "number" || !Number.isSafeInteger(row.outputByteLength) || row.outputByteLength < 1 || row.outputByteLength > UNIVERSITY_FORM_RENDER_MAX_BYTES) return null;
    const rawCounts = formInputRecord(row.counts, UNIVERSITY_FORM_RENDER_STATES), counts = {} as Record<typeof UNIVERSITY_FORM_RENDER_STATES[number], number>;
    for (const state of UNIVERSITY_FORM_RENDER_STATES) {
      const count = rawCounts[state];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > f.mapping.mappings.length) return null;
      counts[state] = count;
    }
    if (Object.values(counts).reduce((a, b) => a + b, 0) !== f.mapping.mappings.length
      || (f.mode === "final" && counts.manual + counts.unconfirmed + counts.conflict + counts.invalid !== 0)) return null;
    const warnings = universityFormRenderWarnings(counts, f.mode);
    if (!Array.isArray(row.warnings) || row.warnings.length !== warnings.length || row.warnings.some((warning, i) => warning !== warnings[i])) return null;
    return Object.freeze({ ...constants, outputByteLength: row.outputByteLength, outputSha256: formInputHash(row.outputSha256), counts: Object.freeze(counts), warnings });
  } catch { return null; }
}

export function normalizeUniversityFormRequest(value: unknown): FormRenderRequest {
  const row = formInputRecord(value, ["operation", "binding", "formInput"]);
  if (row.operation !== "render-form-v1") throw new Error("invalid_form_input");
  const b = formInputRecord(row.binding, ["artifactId", "preparationId", "inputSnapshotSha256", "generatedInputSha256", "fieldReviewsSha256"]);
  return Object.freeze({ operation: "render-form-v1", formInput: normalizeUniversityFormInput(row.formInput), binding: Object.freeze({
    artifactId: formInputUuid(b.artifactId), preparationId: formInputUuid(b.preparationId), inputSnapshotSha256: formInputHash(b.inputSnapshotSha256),
    generatedInputSha256: formInputHash(b.generatedInputSha256), fieldReviewsSha256: formInputHash(b.fieldReviewsSha256),
  }) });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Transport encoding only, not SQL bw1 or persisted generated-input identity. */
export function encodeUniversityFormCapsule(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(canonical(normalizeUniversityFormRequest(value)));
  if (bytes.length > UNIVERSITY_FORM_RENDER_MAX_CAPSULE) throw new Error("invalid_form_input");
  return bytes;
}
