import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import { inspectUniversityDocx } from "../../src/lib/server/university-form-docx.ts";
import { inspectUniversityPdf } from "../../src/lib/server/university-form-pdf.ts";
import { UNIVERSITY_TEMPLATE_PREVIEW_PAGE_SIZE, UNIVERSITY_TEMPLATE_PREVIEW_POLICY } from "../../src/lib/university-template-preview.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 20 * 1024 * 1024;
function reject() { throw new Error("template_not_eligible"); }
function request() {
  const chunks = []; let size = 0;
  for (;;) {
    const chunk = Buffer.alloc(64 * 1024);
    const length = readSync(0, chunk, 0, chunk.length, null);
    if (length === 0) break;
    size += length;
    if (size > MAX_BYTES + 512) reject();
    chunks.push(chunk.subarray(0, length));
  }
  const wire = Buffer.concat(chunks, size), separator = wire.indexOf(10);
  if (separator < 1 || separator > 511) reject();
  const header = JSON.parse(wire.subarray(0, separator).toString("utf8"));
  if (!header || typeof header !== "object" || Array.isArray(header)
    || ![DOCX, "application/pdf"].includes(header.mimeType) || !/^[a-f0-9]{64}$/.test(header.expectedSha256)
    || !Number.isInteger(header.byteLength) || header.byteLength < 1 || header.byteLength > MAX_BYTES) reject();
  const keys = Object.keys(header).sort().join(",");
  if (keys !== "byteLength,expectedSha256,mimeType" && (keys !== "byteLength,expectedSha256,mimeType,offset,operation"
    || header.operation !== "source-preview" || header.mimeType !== DOCX
    || !Number.isInteger(header.offset) || header.offset < 0 || header.offset > 2999)) reject();
  const bytes = wire.subarray(separator + 1);
  if (bytes.length !== header.byteLength || createHash("sha256").update(bytes).digest("hex") !== header.expectedSha256) reject();
  return { header, bytes };
}
// No library diagnostics may cross; only explicit preview responses contain source excerpts.
for (const method of ["log", "warn", "error", "info", "debug"]) console[method] = () => {};
try {
  const { header, bytes } = request();
  let manifest;
  if (header.mimeType === DOCX) {
    const inspected = inspectUniversityDocx(bytes);
    manifest = { format: "docx", slots: inspected.slots.map(({ id, editable }) => ({ id, editable })), pageSizes: [] };
    if (header.operation === "source-preview") {
      const { offset } = header, totalSlots = inspected.slots.length;
      if (offset >= totalSlots) reject();
      const slots = inspected.slots.slice(offset, offset + UNIVERSITY_TEMPLATE_PREVIEW_PAGE_SIZE).map(slot => ({
        id: slot.id, text: slot.text.slice(0, 1200), context: slot.context.slice(0, 600), kind: slot.kind,
        editable: slot.editable, manualReason: slot.manualReason === null ? null : slot.manualReason.slice(0, 240),
        truncated: slot.truncated || slot.text.length > 1200 || slot.context.length > 600 || (slot.manualReason?.length ?? 0) > 240,
      }));
      process.stdout.write(`${JSON.stringify({ status: "preview", policyVersion: UNIVERSITY_TEMPLATE_PREVIEW_POLICY,
        sha256: header.expectedSha256, byteLength: bytes.length, mimeType: DOCX,
        manifestDigest: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), offset, totalSlots,
        nextOffset: offset + slots.length < totalSlots ? offset + slots.length : null, slots })}\n`);
    }
  } else {
    const inspected = await inspectUniversityPdf(bytes);
    // Rectangles/manual fields are reviewed mappings, not facts discovered by PDF inspection.
    manifest = { format: "pdf", slots: [], pageSizes: inspected.pageSizes };
  }
  if (header.operation !== "source-preview") process.stdout.write(`${JSON.stringify({ status: "verified", sha256: header.expectedSha256, byteLength: bytes.length,
    mimeType: header.mimeType, policyVersion: "evo-university-template-v1", manifest })}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({ status: "rejected", code: "template_not_eligible" })}\n`);
}
