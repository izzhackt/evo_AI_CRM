/** Private manager source excerpts, never inspection receipts or rendered HTML. */
export const UNIVERSITY_TEMPLATE_PREVIEW_PAGE_SIZE = 10;
export const UNIVERSITY_TEMPLATE_PREVIEW_POLICY = "evo-university-template-preview-v1";
export const UNIVERSITY_TEMPLATE_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type UniversityTemplatePreviewSlot = Readonly<{
  id: string; text: string; context: string; kind: "blank" | "label";
  editable: boolean; manualReason: string | null; truncated: boolean;
}>;
export type UniversityTemplateSourcePreview = Readonly<{
  status: "preview"; policyVersion: typeof UNIVERSITY_TEMPLATE_PREVIEW_POLICY;
  sha256: string; byteLength: number; mimeType: typeof UNIVERSITY_TEMPLATE_DOCX_MIME;
  /** Transient normalized-manifest digest, not the persisted JSONB receipt digest. */
  manifestDigest: string; offset: number; totalSlots: number; nextOffset: number | null;
  slots: readonly UniversityTemplatePreviewSlot[];
}>;
export type UniversityTemplatePreviewExpectation = Readonly<{
  sha256: string; byteLength: number; manifestDigest: string; offset: number;
  slots: readonly Readonly<{ id: string; editable: boolean }>[];
}>;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}

/** Validate the whole response before returning any untrusted source text. */
export function parseUniversityTemplateSourcePreview(value: unknown, expected: UniversityTemplatePreviewExpectation): UniversityTemplateSourcePreview | null {
  const total = expected.slots.length, offset = expected.offset;
  if (!Number.isInteger(offset) || offset < 0 || offset >= total || total < 1 || total > 3000
    || !/^[a-f0-9]{64}$/.test(expected.sha256) || !/^[a-f0-9]{64}$/.test(expected.manifestDigest)
    || !Number.isInteger(expected.byteLength) || expected.byteLength < 1 || expected.byteLength > 20 * 1024 * 1024) return null;
  const count = Math.min(UNIVERSITY_TEMPLATE_PREVIEW_PAGE_SIZE, total - offset);
  const next = offset + count < total ? offset + count : null;
  if (!record(value) || !keys(value, "byteLength,manifestDigest,mimeType,nextOffset,offset,policyVersion,sha256,slots,status,totalSlots")
    || value.status !== "preview" || value.policyVersion !== UNIVERSITY_TEMPLATE_PREVIEW_POLICY
    || value.sha256 !== expected.sha256 || value.byteLength !== expected.byteLength || value.mimeType !== UNIVERSITY_TEMPLATE_DOCX_MIME
    || value.manifestDigest !== expected.manifestDigest || value.offset !== offset || value.totalSlots !== total
    || value.nextOffset !== next || !Array.isArray(value.slots) || value.slots.length !== count) return null;
  const slots: UniversityTemplatePreviewSlot[] = [];
  for (const [index, row] of value.slots.entries()) {
    const trusted = expected.slots[offset + index];
    if (!record(row) || !keys(row, "context,editable,id,kind,manualReason,text,truncated")
      || row.id !== `p-${offset + index + 1}` || row.id !== trusted.id || row.editable !== trusted.editable
      || typeof row.editable !== "boolean" || typeof row.text !== "string" || row.text.length > 1200
      || typeof row.context !== "string" || row.context.length > 600 || (row.kind !== "blank" && row.kind !== "label")
      || typeof row.truncated !== "boolean" || !(row.manualReason === null || typeof row.manualReason === "string" && row.manualReason.length <= 240)
      || (row.editable ? row.manualReason !== null : typeof row.manualReason !== "string" || row.manualReason.length === 0)) return null;
    slots.push(Object.freeze({ id: row.id, text: row.text, context: row.context, kind: row.kind,
      editable: row.editable, manualReason: row.manualReason as string | null, truncated: row.truncated }));
  }
  return Object.freeze({ status: "preview", policyVersion: UNIVERSITY_TEMPLATE_PREVIEW_POLICY, sha256: expected.sha256,
    byteLength: expected.byteLength, mimeType: UNIVERSITY_TEMPLATE_DOCX_MIME, manifestDigest: expected.manifestDigest,
    offset, totalSlots: total, nextOffset: next, slots: Object.freeze(slots) });
}
