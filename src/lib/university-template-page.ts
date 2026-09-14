export const UNIVERSITY_TEMPLATE_PAGE_POLICY = "evo-university-template-page-v1";
export const UNIVERSITY_TEMPLATE_PAGE_RENDERER = "pdfjs-6.3.289-canvas-1.0.9";
export const UNIVERSITY_TEMPLATE_PAGE_MAX_PNG = 20 * 1024 * 1024;
export const UNIVERSITY_TEMPLATE_PAGE_MAX_METADATA = 4096;
export const UNIVERSITY_TEMPLATE_PAGE_MAX_FRAME = 12 + UNIVERSITY_TEMPLATE_PAGE_MAX_METADATA + UNIVERSITY_TEMPLATE_PAGE_MAX_PNG;

export type UniversityTemplatePageMetadata = Readonly<{
  status: "rendered"; policyVersion: typeof UNIVERSITY_TEMPLATE_PAGE_POLICY;
  rendererId: typeof UNIVERSITY_TEMPLATE_PAGE_RENDERER; mimeType: "application/pdf";
  sha256: string; byteLength: number; manifestDigest: string; page: number; pageCount: number;
  widthPt: number; heightPt: number; pixelWidth: number; pixelHeight: number;
  pngByteLength: number; pngSha256: string;
}>;
export type UniversityTemplatePageExpectation = Readonly<{
  sha256: string; byteLength: number; manifestDigest: string; page: number;
  pageSizes: readonly Readonly<{ width: number; height: number }>[];
}>;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Fixed raster geometry; never accepts a caller-supplied zoom/rotation policy. */
export function universityTemplatePagePixels(widthPt: number, heightPt: number): Readonly<{ pixelWidth: number; pixelHeight: number }> | null {
  if (typeof widthPt !== "number" || typeof heightPt !== "number" || !Number.isFinite(widthPt) || !Number.isFinite(heightPt)
    || widthPt < 72 || heightPt < 72 || widthPt > 3000 || heightPt > 3000) return null;
  const scale = Math.min(2, 2048 / Math.max(widthPt, heightPt));
  return Object.freeze({ pixelWidth: Math.floor(widthPt * scale), pixelHeight: Math.floor(heightPt * scale) });
}

/** Data-only guard. PNG byte/hash validation remains in the server transport adapter. */
export function parseUniversityTemplatePageMetadata(value: unknown, expected: UniversityTemplatePageExpectation): UniversityTemplatePageMetadata | null {
  if (!record(expected) || !hash(expected.sha256) || !hash(expected.manifestDigest) || !Number.isInteger(expected.byteLength)
    || expected.byteLength < 12 || expected.byteLength > UNIVERSITY_TEMPLATE_PAGE_MAX_PNG || !Array.isArray(expected.pageSizes)
    || expected.pageSizes.length < 1 || expected.pageSizes.length > 100 || !Number.isInteger(expected.page)
    || expected.page < 1 || expected.page > expected.pageSizes.length
    || expected.pageSizes.some(page => !record(page) || typeof page.width !== "number" || typeof page.height !== "number"
      || !universityTemplatePagePixels(page.width, page.height))) return null;
  const selected = expected.pageSizes[expected.page - 1], pixels = universityTemplatePagePixels(selected.width, selected.height)!;
  if (!record(value) || Object.keys(value).sort().join(",") !== "byteLength,heightPt,manifestDigest,mimeType,page,pageCount,pixelHeight,pixelWidth,pngByteLength,pngSha256,policyVersion,rendererId,sha256,status,widthPt"
    || value.status !== "rendered" || value.policyVersion !== UNIVERSITY_TEMPLATE_PAGE_POLICY || value.rendererId !== UNIVERSITY_TEMPLATE_PAGE_RENDERER
    || value.mimeType !== "application/pdf" || value.sha256 !== expected.sha256 || value.byteLength !== expected.byteLength
    || value.manifestDigest !== expected.manifestDigest || value.page !== expected.page || value.pageCount !== expected.pageSizes.length
    || value.widthPt !== selected.width || value.heightPt !== selected.height || value.pixelWidth !== pixels.pixelWidth || value.pixelHeight !== pixels.pixelHeight
    || typeof value.pngByteLength !== "number" || !Number.isInteger(value.pngByteLength) || value.pngByteLength < 33
    || value.pngByteLength > UNIVERSITY_TEMPLATE_PAGE_MAX_PNG || !hash(value.pngSha256)) return null;
  return Object.freeze({ status: "rendered", policyVersion: UNIVERSITY_TEMPLATE_PAGE_POLICY, rendererId: UNIVERSITY_TEMPLATE_PAGE_RENDERER,
    mimeType: "application/pdf", sha256: expected.sha256, byteLength: expected.byteLength, manifestDigest: expected.manifestDigest,
    page: expected.page, pageCount: expected.pageSizes.length, widthPt: selected.width, heightPt: selected.height,
    ...pixels, pngByteLength: value.pngByteLength, pngSha256: value.pngSha256 });
}
