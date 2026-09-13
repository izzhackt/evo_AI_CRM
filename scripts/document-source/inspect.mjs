import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const MAX_BYTES = 25 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png"];
const rejected = code => ({ status: "rejected", code });
function reject() { throw new Error("document_not_eligible"); }

// No paths/URLs, output text, provider configuration or arbitrary parser options.
function request() {
  const chunks = []; let size = 0;
  // Read only the inherited input descriptor. process.stdin's libuv socket
  // discovery needs network syscalls that are intentionally unavailable here.
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
  if (!header || typeof header !== "object" || Object.keys(header).sort().join(",") !== "byteLength,expectedSha256,mimeType"
      || !TYPES.includes(header.mimeType) || !/^[a-f0-9]{64}$/.test(header.expectedSha256)
      || !Number.isInteger(header.byteLength) || header.byteLength < 1 || header.byteLength > MAX_BYTES) reject();
  const bytes = wire.subarray(separator + 1);
  if (bytes.length !== header.byteLength || createHash("sha256").update(bytes).digest("hex") !== header.expectedSha256) reject();
  return { header, bytes };
}
function singlePng(bytes) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    if (length > bytes.length - offset - 12 || type === "acTL") reject();
    offset += length + 12;
    if (type === "IEND") return;
  }
  reject();
}
async function inspect({ header, bytes }) {
  let pageCount;
  if (header.mimeType === "application/pdf") {
    if (!/^%PDF-[12]\.[0-9]/.test(bytes.subarray(0, 8).toString("ascii"))) reject();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    pageCount = pdf.getPageCount();
    if (pdf.isEncrypted || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20) reject();
  } else {
    const png = header.mimeType === "image/png";
    if (png) {
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) reject();
      singlePng(bytes);
    } else if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) reject();
    sharp.cache(false); sharp.concurrency(1);
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000, limitInputChannels: 4, sequentialRead: true });
    const metadata = await image.metadata();
    const { width, height } = metadata;
    if (metadata.format !== (png ? "png" : "jpeg") || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > 20_000 || height > 20_000 || width * height > 40_000_000
      || (metadata.pages !== undefined && metadata.pages !== 1)) reject();
    // Metadata is not pixel validation. Materialize all bounded pixels without rewriting the original.
    const decoded = await image.raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== width || decoded.info.height !== height || decoded.info.channels > 4
      || decoded.data.length !== width * height * decoded.info.channels) reject();
    pageCount = 1;
  }
  return { status: "verified", sha256: header.expectedSha256, byteLength: bytes.length,
    mimeType: header.mimeType, pageCount, policyVersion: "document-source-v1" };
}
try {
  process.stdout.write(`${JSON.stringify(await inspect(request()))}\n`);
} catch {
  process.stdout.write(`${JSON.stringify(rejected("document_not_eligible"))}\n`);
}
