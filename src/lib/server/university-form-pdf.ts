import "server-only";
// Pure renderer port from EVO Docs 6e7cf741; run inside a hard resource-isolated runtime before public integration.
import { createHash } from "node:crypto";
import fs from "node:fs";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFFont, PDFInvalidObject, PDFName, PDFNumber, PDFObject, PDFPage, PDFRawStream, degrees, rgb } from "pdf-lib";
import { getUniversityFormAssignments, type UniversityFormResolution, type UniversityPdfPageSize, type UniversityPdfPosition } from "../university-form-fields.ts";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_OBJECTS = 30000;
const MAX_FIELDS = 500;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 11;
const PADDING = 1;
const FONT_PATH = new URL("../../../assets/fonts/NotoSans-Regular.ttf", import.meta.url);
const FONT_SHA256 = "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5";
const ACTIVE_KEYS = new Set(["JavaScript", "JS", "Launch", "EmbeddedFiles", "XFA", "RichMediaContent", "RichMediaSettings", "Collection", "AA"]);
const ACTIVE_ACTIONS = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToR", "GoToE", "Rendition", "Sound", "Movie", "SetOCGState"]);
let fontBytes: Buffer | undefined;

type PdfValue = UniversityPdfPosition & { readonly value: string };
type PageBox = { x: number; y: number; width: number; height: number };
type OpenPdf = { document: PDFDocument; pages: PDFPage[]; boxes: PageBox[]; warnings: string[] };

export class UniversityPdfError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "UniversityPdfError"; }
}
export interface UniversityPdfInspection {
  readonly sha256: string;
  readonly pageSizes: readonly UniversityPdfPageSize[];
  readonly warnings: readonly string[];
}

// PDF-lib uses bottom-left page coordinates. This boundary exposes the visible
// CropBox in points from its top-left corner, matching the review preview.
export async function inspectUniversityPdf(bytes: Buffer): Promise<UniversityPdfInspection> {
  const source = captureBytes(bytes);
  const { boxes, warnings } = await openPdf(source);
  return Object.freeze({ sha256: createHash("sha256").update(source).digest("hex"),
    pageSizes: Object.freeze(boxes.map(({ width, height }) => Object.freeze({ width, height }))), warnings: Object.freeze(warnings) });
}

/** Field/mapping readiness is not public export authorization or a complete layout approval. */
export async function fillUniversityPdf(bytes: Buffer, resolution: UniversityFormResolution, options: { draft: boolean }): Promise<Buffer> {
  if (typeof options?.draft !== "boolean") throw new UniversityPdfError("invalid_form_values");
  const draft = options.draft;
  const assignments = getUniversityFormAssignments(resolution, draft ? "draft" : "final");
  const source = captureBytes(bytes);
  if (resolution.templateFormat !== "pdf" || createHash("sha256").update(source).digest("hex") !== resolution.templateSha256) throw new UniversityPdfError("form_pdf_mapping_mismatch");
  const { document, pages, boxes } = await openPdf(source);
  if (resolution.pageSizes.length !== boxes.length || resolution.pageSizes.some((page, index) => page.width !== boxes[index].width || page.height !== boxes[index].height)) throw new UniversityPdfError("form_pdf_mapping_mismatch");
  if (resolution.values.length > MAX_FIELDS) throw new UniversityPdfError("invalid_form_values");
  // Empty/manual fields still occupy their reviewed rectangles. Do not validate
  // only rendered assignments: that could write into an omitted signature box.
  const positions = new Map(resolution.values.map(item => [item.slotId, validatePosition(item.position, boxes)]));
  const allPositions = Array.from(positions.values());
  for (let index = 0; index < allPositions.length; index++) {
    const a = allPositions[index];
    for (const b of allPositions.slice(index + 1)) {
      if (a.page === b.page && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) throw new UniversityPdfError("form_pdf_positions_overlap");
    }
  }
  const validated = [...assignments].sort((a, b) => a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0)
    .map(item => validateValue({ ...positions.get(item.slotId)!, value: item.value }));
  if (validated.reduce((sum, item) => sum + Array.from(item.value).length, 0) > 50000) throw new UniversityPdfError("form_values_too_large");
  try {
    document.registerFontkit(fontkit);
    if (!fontBytes) {
      const candidate = fs.readFileSync(FONT_PATH);
      if (createHash("sha256").update(candidate).digest("hex") !== FONT_SHA256) throw new UniversityPdfError("form_pdf_font_unavailable");
      fontBytes = candidate;
    }
    const metrics = fontkit.create(fontBytes);
    for (const item of validated) assertGlyphs(item.value, metrics);
    if (draft) assertGlyphs("DRAFT / ЧЕРНОВИК\nDRAFT — НЕ ДЛЯ ПОДАЧИ", metrics);
    const font = await document.embedFont(fontBytes, { subset: true, customName: "EvoUniversityNotoSans" });
    for (let index = 0; index < validated.length; index++) {
      const item = validated[index], box = boxes[item.page - 1], page = pages[item.page - 1];
      if (item.characterCount !== undefined) {
        drawCharacters(page, box, item, font, metrics);
        continue;
      }
      const layout = fitText(item.value, item.width - PADDING * 2, item.height - PADDING * 2, font, metrics);
      if (!layout) throw new UniversityPdfError("form_pdf_text_overflow");
      const ascent = font.heightAtSize(layout.size, { descender: false });
      const y = box.y + box.height - item.y - PADDING - ascent;
      layout.lines.forEach((line, lineIndex) => page.drawText(line, { x: box.x + item.x + PADDING, y: y - lineIndex * layout.lineHeight, size: layout.size, font, color: rgb(0, 0, 0) }));
    }
    if (draft) pages.forEach((page, index) => addDraftNotice(page, boxes[index], font));
    const output = Buffer.from(await document.save({ useObjectStreams: true, updateFieldAppearances: false }));
    if (output.length > MAX_BYTES) throw new UniversityPdfError("form_pdf_size_invalid");
    assertPassivePdf(document);
    return output;
  } catch (error) {
    if (error instanceof UniversityPdfError) throw error;
    throw new UniversityPdfError("form_pdf_export_failed");
  }
}

function captureBytes(bytes: Buffer): Buffer {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > MAX_BYTES) throw new UniversityPdfError("form_pdf_size_invalid");
  return Buffer.from(bytes);
}

async function openPdf(bytes: Buffer): Promise<OpenPdf> {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > MAX_BYTES || !/^%PDF-[12]\.\d/u.test(bytes.subarray(0, 12).toString("latin1"))) throw new UniversityPdfError("form_pdf_size_invalid");
  let document: PDFDocument;
  try { document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true, capNumbers: true }); }
  catch (error) {
    if (error instanceof Error && /encrypt|password/iu.test(error.message)) throw new UniversityPdfError("form_pdf_encrypted");
    throw new UniversityPdfError("invalid_form_pdf");
  }
  if (document.isEncrypted || document.context.trailerInfo.Encrypt) throw new UniversityPdfError("form_pdf_encrypted");
  let pages: PDFPage[], boxes: PageBox[];
  try {
    assertPassivePdf(document);
    assertPageTree(document);
    pages = document.getPages();
    if (!pages.length || pages.length > MAX_PAGES) throw new UniversityPdfError("form_pdf_page_limit");
    boxes = pages.map(page => {
      if (page.getRotation().angle !== 0) throw new UniversityPdfError("form_pdf_rotation_unsupported");
      const unit = page.node.lookup(PDFName.of("UserUnit"));
      if (unit && (!(unit instanceof PDFNumber) || unit.asNumber() !== 1)) throw new UniversityPdfError("form_pdf_units_unsupported");
      const crop = page.getCropBox(), media = page.getMediaBox();
      if (![crop.x, crop.y, crop.width, crop.height, media.x, media.y, media.width, media.height].every(Number.isFinite) || crop.width <= 0 || crop.height <= 0 || media.width <= 0 || media.height <= 0) throw new UniversityPdfError("form_pdf_page_size_invalid");
      // Match the preview's visible page: intersect CropBox with MediaBox.
      const x = Math.max(crop.x, media.x), y = Math.max(crop.y, media.y);
      const box = { x, y, width: Math.min(crop.x + crop.width, media.x + media.width) - x, height: Math.min(crop.y + crop.height, media.y + media.height) - y };
      if (box.width < 72 || box.height < 72 || box.width > 3000 || box.height > 3000) throw new UniversityPdfError("form_pdf_page_size_invalid");
      return box;
    });
    const acroForm = document.catalog.lookup(PDFName.of("AcroForm"));
    if (acroForm instanceof PDFDict) {
      const fields = acroForm.lookup(PDFName.of("Fields"));
      if (!(fields instanceof PDFArray) || fields.size() > 0) throw new UniversityPdfError("form_pdf_interactive_unsupported");
    } else if (acroForm) throw new UniversityPdfError("form_pdf_interactive_unsupported");
  } catch (error) {
    if (error instanceof UniversityPdfError) throw error;
    throw new UniversityPdfError("invalid_form_pdf");
  }
  const warnings = [
    "Текст добавляется в явно сопоставленные области исходного PDF. Фон, страницы и подписи бланка сохраняются; проверьте результат перед подачей.",
    "Подписи, согласия, фотографии и флажки оформляются вручную. Их нельзя направлять в текстовые области подстановки.",
    `Координаты заданы в пунктах от верхнего левого угла видимой страницы; автоматический размер текста ${MIN_FONT_SIZE}–${MAX_FONT_SIZE} pt. Непомещающийся текст блокирует экспорт.`,
  ];
  return { document, pages, boxes, warnings };
}

function assertPassivePdf(document: PDFDocument): void {
  const indirect = document.context.enumerateIndirectObjects();
  if (indirect.length > MAX_OBJECTS) throw new UniversityPdfError("form_pdf_too_complex");
  const pending: PDFObject[] = indirect.map(([, object]) => object);
  const seen = new Set<PDFObject>();
  while (pending.length) {
    const object = pending.pop()!;
    if (seen.has(object)) continue;
    seen.add(object);
    if (seen.size > MAX_OBJECTS * 8) throw new UniversityPdfError("form_pdf_too_complex");
    if (object instanceof PDFInvalidObject) throw new UniversityPdfError("invalid_form_pdf");
    const dictionary = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    if (dictionary) {
      if (dictionary.has(PDFName.of("ByteRange")) || ["Sig", "DocTimeStamp"].includes(pdfName(dictionary.lookup(PDFName.of("Type")))) || pdfName(dictionary.lookup(PDFName.of("FT"))) === "Sig" || dictionary.has(PDFName.of("DocMDP"))) throw new UniversityPdfError("form_pdf_signed");
      if (pdfName(dictionary.lookup(PDFName.of("Subtype"))) === "Widget") throw new UniversityPdfError("form_pdf_interactive_unsupported");
      if (ACTIVE_ACTIONS.has(pdfName(dictionary.lookup(PDFName.of("S")))) || ["RichMedia", "Movie", "Sound", "FileAttachment", "Screen"].includes(pdfName(dictionary.lookup(PDFName.of("Subtype"))))) throw new UniversityPdfError("form_pdf_active_content");
      for (const [key, value] of dictionary.entries()) {
        if (ACTIVE_KEYS.has(key.decodeText())) throw new UniversityPdfError("form_pdf_active_content");
        pending.push(value);
      }
    } else if (object instanceof PDFArray) pending.push(...object.asArray());
  }
}

// Reject cycles and excessive tree depth before pdf-lib recursively enumerates pages.
function assertPageTree(document: PDFDocument): void {
  const pending: { object: PDFObject | undefined; depth: number }[] = [{ object: document.catalog.get(PDFName.of("Pages")), depth: 0 }];
  const seen = new Set<PDFObject>();
  let count = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    const object = document.context.lookup(entry.object);
    if (!(object instanceof PDFDict) || seen.has(object) || entry.depth > 100) throw new UniversityPdfError("invalid_form_pdf");
    seen.add(object);
    if (seen.size > MAX_PAGES * 10) throw new UniversityPdfError("form_pdf_too_complex");
    const type = pdfName(object.lookup(PDFName.of("Type")));
    if (type === "Page") {
      if (++count > MAX_PAGES) throw new UniversityPdfError("form_pdf_page_limit");
    } else if (type === "Pages") {
      const kids = object.lookup(PDFName.of("Kids"));
      if (!(kids instanceof PDFArray) || !kids.size()) throw new UniversityPdfError("invalid_form_pdf");
      pending.push(...kids.asArray().map(child => ({ object: child, depth: entry.depth + 1 })));
    } else throw new UniversityPdfError("invalid_form_pdf");
  }
}

function validatePosition(item: UniversityPdfPosition | undefined, boxes: PageBox[]): UniversityPdfPosition {
  if (!item || !Number.isInteger(item.page) || item.page < 1 || item.page > boxes.length) throw new UniversityPdfError("form_pdf_page_not_found");
  const box = boxes[item.page - 1];
  if (![item.x, item.y, item.width, item.height].every(Number.isFinite) || item.x < 0 || item.y < 0 || item.width < 12 || item.height < 12 || item.x + item.width > box.width || item.y + item.height > box.height) throw new UniversityPdfError("form_pdf_position_invalid");
  if (item.characterCount !== undefined && (!Number.isInteger(item.characterCount) || item.characterCount < 1 || item.characterCount > 120 || item.width / item.characterCount < 5)) throw new UniversityPdfError("form_pdf_cells_invalid");
  return item;
}

function validateValue(item: PdfValue): PdfValue {
  if (typeof item.value !== "string" || !item.value.trim() || Array.from(item.value).length > 1000 || /[\u0000-\u0009\u000b-\u001f\u007f\ufffe\uffff\p{Surrogate}]/u.test(item.value)) throw new UniversityPdfError("invalid_form_value");
  if (item.characterCount !== undefined && /\n/u.test(item.value)) throw new UniversityPdfError("form_pdf_cells_invalid");
  return item;
}

function assertGlyphs(text: string, metrics: Font): void {
  for (const character of text) {
    if (character === "\n" || character === " ") continue;
    const codePoint = character.codePointAt(0)!;
    const glyph = metrics.glyphForCodePoint(codePoint);
    if (!metrics.hasGlyphForCodePoint(codePoint) || glyph.id === 0 || !glyph.path.toSVG() || /\p{Cf}/u.test(character)) throw new UniversityPdfError("form_pdf_character_unsupported");
  }
  for (const line of text.split("\n")) {
    const run = metrics.layout(line);
    if (run.direction === "rtl" || run.positions.some(position => position.xOffset !== 0 || position.yOffset !== 0 || position.yAdvance !== 0)) throw new UniversityPdfError("form_pdf_shaping_unsupported");
    if (run.glyphs.some(glyph => glyph.id === 0 || (!glyph.path.toSVG() && !glyph.codePoints.every(point => point === 32)))) throw new UniversityPdfError("form_pdf_character_unsupported");
  }
}

// The exact nominal glyph advances used by pdf-lib, plus visible ink extents.
function inkFits(text: string, size: number, width: number, metrics: Font, offset = 0): boolean {
  let pen = 0;
  const scale = size / metrics.unitsPerEm;
  for (const glyph of metrics.layout(text).glyphs) {
    if (glyph.path.toSVG() && ((pen + glyph.bbox.minX) * scale + offset < -PADDING || (pen + glyph.bbox.maxX) * scale + offset > width + PADDING
      || glyph.bbox.maxY > metrics.ascent || glyph.bbox.minY < metrics.descent)) return false;
    pen += glyph.advanceWidth;
  }
  return true;
}

function drawCharacters(page: PDFPage, box: PageBox, item: PdfValue, font: PDFFont, metrics: Font): void {
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(item.value), segment => segment.segment);
  if (characters.length > item.characterCount!) throw new UniversityPdfError("form_pdf_text_overflow");
  const cellWidth = item.width / item.characterCount!;
  let size = MAX_FONT_SIZE;
  for (; size >= MIN_FONT_SIZE; size -= 0.25) {
    if (font.heightAtSize(size) <= item.height - PADDING * 2 && characters.every(character => {
      const width = font.widthOfTextAtSize(character, size);
      return width <= cellWidth - PADDING * 2 && inkFits(character, size, cellWidth - PADDING * 2, metrics, (cellWidth - width) / 2 - PADDING);
    })) break;
  }
  if (size < MIN_FONT_SIZE) throw new UniversityPdfError("form_pdf_text_overflow");
  const topPadding = (item.height - font.heightAtSize(size)) / 2;
  const y = box.y + box.height - item.y - topPadding - font.heightAtSize(size, { descender: false });
  characters.forEach((character, characterIndex) => page.drawText(character, { x: box.x + item.x + characterIndex * cellWidth + (cellWidth - font.widthOfTextAtSize(character, size)) / 2, y, size, font, color: rgb(0, 0, 0) }));
}

function fitText(text: string, width: number, height: number, font: PDFFont, metrics: Font): { lines: string[]; size: number; lineHeight: number } | null {
  for (let size = MAX_FONT_SIZE; size >= MIN_FONT_SIZE; size -= 0.25) {
    const lines: string[] = [];
    let tooWide = false;
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.match(/ +|[^ ]+/gu) ?? []) {
        if (font.widthOfTextAtSize(word, size) > width) { tooWide = true; break; }
        const proposed = line + word;
        if (font.widthOfTextAtSize(proposed, size) <= width) line = proposed;
        else { lines.push(line); line = word; }
      }
      if (tooWide) break;
      lines.push(line);
    }
    const fontHeight = font.heightAtSize(size), lineHeight = Math.max(size * 1.25, fontHeight);
    if (!tooWide && fontHeight + (lines.length - 1) * lineHeight <= height && lines.every(line => inkFits(line, size, width, metrics))) return { lines, size, lineHeight };
  }
  return null;
}

function addDraftNotice(page: PDFPage, box: PageBox, font: PDFFont): void {
  const label = "DRAFT / ЧЕРНОВИК";
  const size = Math.min(40, (box.width * 0.7) / font.widthOfTextAtSize(label, 1));
  page.drawText(label, { x: box.x + box.width * 0.17, y: box.y + box.height * 0.42, size, font, rotate: degrees(28), color: rgb(0.7, 0.12, 0.2), opacity: 0.2 });
  const note = "DRAFT — НЕ ДЛЯ ПОДАЧИ";
  const noteSize = Math.min(9, (box.width - 24) / font.widthOfTextAtSize(note, 1));
  page.drawText(note, { x: box.x + 12, y: box.y + box.height - 12, size: noteSize, font, color: rgb(0.7, 0.12, 0.2) });
}

function pdfName(object: PDFObject | undefined): string { return object instanceof PDFName ? object.decodeText() : ""; }
