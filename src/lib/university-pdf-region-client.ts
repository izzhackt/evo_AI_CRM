import type { UniversityFormMapping, UniversityPdfPageSize, UniversityPdfPosition } from "./university-form-fields.ts";
import { parseUniversityTemplatePageMetadata, UNIVERSITY_TEMPLATE_PAGE_MAX_METADATA, type UniversityTemplatePageExpectation } from "./university-template-page.ts";

/** Browser-side binding/size checks; never a substitute for source inspection. */
export async function readUniversityPdfPage(response: Response, expected: UniversityTemplatePageExpectation, signal: AbortSignal) {
  const fail = (): never => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => {}); throw new Error("page_unavailable"); };
  const header = response.headers.get("x-evo-template-page");
  if (!response.ok || response.headers.get("content-type") !== "image/png" || !header
    || header.length > UNIVERSITY_TEMPLATE_PAGE_MAX_METADATA || !/^[\x20-\x7e]+$/u.test(header) || !response.body) return fail();
  let metadata;
  try { metadata = parseUniversityTemplatePageMetadata(JSON.parse(header), expected); } catch { return fail(); }
  if (!metadata || response.headers.get("content-length") !== String(metadata.pngByteLength)) return fail();
  const reader = response.body.getReader(), bytes = new Uint8Array(metadata.pngByteLength);
  let length = 0, finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) return fail();
      const chunk = await reader.read();
      if (signal.aborted) return fail();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > bytes.byteLength) return fail();
      bytes.set(chunk.value, length); length += chunk.value.byteLength;
    }
    if (length !== bytes.byteLength) return fail();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
    const view = new DataView(bytes.buffer);
    if (signal.aborted || hash !== metadata.pngSha256 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a
      || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452
      || view.getUint32(16) !== metadata.pixelWidth || view.getUint32(20) !== metadata.pixelHeight) return fail();
    finished = true;
    return { metadata, bytes };
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const rounded = (value: number) => Math.round(value * 100) / 100;
export function universityPdfPoint(clientX: number, clientY: number, box: Readonly<{ left: number; top: number; width: number; height: number }>, size: UniversityPdfPageSize) {
  if (![clientX, clientY, box.left, box.top, box.width, box.height, size.width, size.height].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0 || size.width <= 0 || size.height <= 0) return null;
  return { x: Math.min(size.width, rounded(Math.max(0, (clientX - box.left) * size.width / box.width))),
    y: Math.min(size.height, rounded(Math.max(0, (clientY - box.top) * size.height / box.height))) };
}
export function universityPdfDrag(start: Readonly<{ x: number; y: number }>, end: Readonly<{ x: number; y: number }>, page: number): UniversityPdfPosition | null {
  const dx = Math.abs(end.x - start.x), dy = Math.abs(end.y - start.y);
  const width = Math.min(dx, rounded(dx)), height = Math.min(dy, rounded(dy));
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || !Number.isInteger(page) || page < 1 || width < 12 || height < 12) return null;
  return { page, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
}
export function universityPdfRegionError(mappings: readonly UniversityFormMapping[], pages: readonly UniversityPdfPageSize[]): "bounds" | "overlap" | "cells" | null {
  if (mappings.length > 500) return "bounds";
  const seen: UniversityPdfPosition[] = [];
  for (const field of mappings) {
    const p = field.position, size = p && pages[p.page - 1];
    if (!p || !Number.isInteger(p.page) || !size || ![p.x, p.y, p.width, p.height].every(Number.isFinite)
      || p.x < 0 || p.y < 0 || p.width < 12 || p.height < 12 || p.x + p.width > size.width || p.y + p.height > size.height) return "bounds";
    if (p.characterCount !== undefined && (!Number.isInteger(p.characterCount) || p.characterCount < 1
      || p.characterCount > 120 || p.width / p.characterCount < 5)) return "cells";
    if (seen.some(q => q.page === p.page && p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height)) return "overlap";
    seen.push(p);
  }
  return null;
}
