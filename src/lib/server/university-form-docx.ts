import "server-only";
// Adapted from EVO Docs university-docx.ts at 6e7cf741; no mutable service or I/O port.
import { crc32, inflateRawSync } from "node:zlib";
import path from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import type { UniversityFormSlot } from "../university-form-fields.ts";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_XML_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_PARAGRAPHS = 3000;
const MAX_VALUE_LENGTH = 1000;
const SUPPORTED_RELATIONSHIPS = new Set([
  ...["officeDocument", "extended-properties", "custom-properties", "styles", "numbering", "settings", "webSettings", "fontTable", "theme", "header", "footer", "footnotes", "endnotes", "comments", "image", "hyperlink"].map(type => `${OFFICE_REL}/${type}`),
  `${REL}/metadata/core-properties`,
]);
const BLANK = /^[\s_＿]*$/u;
const CHECK_MARK = /[□☐☑☒✓✔○◯]/u;
const SIGNING = /\b(?:signature|signed|consent|declaration|declare|affirm|attest|pledge|undertaking|commitment|agreement|authorization|power\s+of\s+attorney)\b|\bi\s+(?:hereby|certify|agree|shall\s+abide)\b|授权|委托|签字|签名|声明|承诺|保证|同意|подпис|соглас|деклара|обязуюсь|доверенност/iu;
const PHOTO = /\b(?:photo|photograph|picture|portrait)\b|照片|相片|фото/iu;
const OFFICIAL = /\b(?:official\s+use|office\s+use|admission\s+office\s+only)\b|审核意见|审批意见/iu;

export class UniversityDocxError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "UniversityDocxError"; }
}

type CompressedEntry = {
  uncompressedSize: number;
  compressedSize: number;
  compressionMethod: string;
  crc32: number;
  getCompressedContent: () => Uint8Array;
};
type XmlDocument = Document & { readonly documentElement: Element };
type OpenForm = {
  zip: PizZip;
  document: XmlDocument;
  body: Element;
  paragraphs: Element[];
  slots: UniversityFormSlot[];
  warnings: string[];
};

export function inspectUniversityDocx(bytes: Buffer): { slots: UniversityFormSlot[]; warnings: string[] } {
  const { slots, warnings } = openForm(bytes);
  return { slots, warnings };
}

export function fillUniversityDocx(
  bytes: Buffer,
  values: readonly { readonly slotId: string; readonly value: string }[],
  options: { draft: boolean },
): Buffer {
  const form = openForm(bytes);
  if (!Array.isArray(values) || values.length > form.slots.length || typeof options?.draft !== "boolean") {
    throw new UniversityDocxError("invalid_form_values");
  }
  const seen = new Set<string>();
  for (const item of values) {
    if (!item || typeof item.slotId !== "string" || seen.has(item.slotId)) {
      throw new UniversityDocxError("duplicate_form_slot");
    }
    seen.add(item.slotId);
    const index = form.slots.findIndex(slot => slot.id === item.slotId);
    const slot = form.slots[index];
    if (!slot) throw new UniversityDocxError("form_slot_not_found");
    if (!slot.editable) throw new UniversityDocxError("form_slot_manual");
    if (typeof item.value !== "string" || !item.value.trim() || [...item.value].length > MAX_VALUE_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\p{Surrogate}]/u.test(item.value)) {
      throw new UniversityDocxError("invalid_form_value");
    }
    writeValue(form.paragraphs[index], item.value, slot.kind);
  }
  if (options.draft) addDraftNotice(form);
  const outputXml = new XMLSerializer().serializeToString(form.document);
  parseXml(Buffer.from(outputXml));
  form.zip.file("word/document.xml", outputXml);
  const output = deterministicPackage(form.zip);
  // This proves package/XML integrity and bounds, not visual layout or authority.
  openForm(output);
  return output;
}

function deterministicPackage(source: PizZip): Buffer {
  const zip = new PizZip();
  const names = Object.keys(source.files).sort();
  if (names.length > MAX_ENTRIES) throw new UniversityDocxError("form_archive_too_large");
  let expanded = 0, xmlBytes = 0;
  for (const name of names) {
    const entry = source.files[name];
    const bytes = entry.dir ? Buffer.alloc(0) : entry.asNodeBuffer();
    expanded += bytes.length;
    if (bytes.length > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) throw new UniversityDocxError("form_archive_too_large");
    if (/(?:\.xml|\.rels)$/iu.test(name)) {
      xmlBytes += bytes.length;
      if (bytes.length > MAX_XML_BYTES || xmlBytes > MAX_TOTAL_XML_BYTES) throw new UniversityDocxError("form_xml_too_large");
    }
    // PizZip encodes local Date components into DOS fields: fixed local midnight
    // (not UTC midnight) produces identical metadata in every server timezone.
    zip.file(name, bytes, { dir: entry.dir, createFolders: false, date: new Date(2000, 0, 1), comment: "", dosPermissions: entry.dir ? 16 : 0 });
  }
  const output = zip.generate({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS", comment: "" });
  if (output.length > MAX_ZIP_BYTES) throw new UniversityDocxError("form_size_invalid");
  return output;
}

function openForm(bytes: Buffer): OpenForm {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_ZIP_BYTES) {
    throw new UniversityDocxError("form_size_invalid");
  }
  const centralEntries = zipEntryCount(bytes);
  let zip: PizZip;
  try { zip = new PizZip(bytes, { checkCRC32: false }); }
  catch { throw new UniversityDocxError("invalid_form_docx"); }
  const names = Object.keys(zip.files);
  if (names.length !== centralEntries || names.length > MAX_ENTRIES) {
    throw new UniversityDocxError("invalid_form_archive");
  }
  const decoded = new Map<string, Buffer>();
  let expanded = 0;
  let xmlBytes = 0;
  const seenNames = new Set<string>();
  for (const name of names) {
    const folded = name.toLocaleLowerCase("en-US");
    if (!name || name.startsWith("/") || name.includes("\\") || /(?:^|\/)\.\.?\//u.test(name) || /[\u0000-\u001f]/u.test(name) || seenNames.has(folded)) {
      throw new UniversityDocxError("invalid_form_archive");
    }
    seenNames.add(folded);
    if (/vbaproject|vba\/|activex|(?:^|\/)embeddings\/|(?:^|\/)oleobject|_xmlsignatures/iu.test(name)) {
      throw new UniversityDocxError("active_form_content");
    }
    const entry = zip.files[name];
    if (entry.dir) continue;
    const compressed = (entry as unknown as { _data: CompressedEntry })._data;
    if (!compressed || !Number.isSafeInteger(compressed.uncompressedSize) || compressed.uncompressedSize < 0 || compressed.uncompressedSize > MAX_ENTRY_BYTES || !Number.isSafeInteger(compressed.compressedSize) || compressed.compressedSize < 0 || compressed.compressedSize > bytes.length) {
      throw new UniversityDocxError("form_archive_too_large");
    }
    expanded += compressed.uncompressedSize;
    if (expanded > MAX_EXPANDED_BYTES) throw new UniversityDocxError("form_archive_too_large");
    const isXml = /(?:\.xml|\.rels)$/iu.test(name);
    if (isXml) {
      xmlBytes += compressed.uncompressedSize;
      if (compressed.uncompressedSize > MAX_XML_BYTES || xmlBytes > MAX_TOTAL_XML_BYTES) throw new UniversityDocxError("form_xml_too_large");
    }
    // Inflate with a hard native bound before PizZip's lazy decompressor can allocate
    // an unbounded output from a forged central-directory size.
    let content: Buffer;
    try {
      const data = Buffer.from(compressed.getCompressedContent());
      if (data.length !== compressed.compressedSize) throw new Error("compressed size");
      if (compressed.compressionMethod === "\x00\x00") content = data;
      else if (compressed.compressionMethod === "\x08\x00") content = inflateRawSync(data, { maxOutputLength: Math.max(1, compressed.uncompressedSize) });
      else throw new Error("compression method");
      if (content.length !== compressed.uncompressedSize || crc32(content) !== (compressed.crc32 >>> 0)) throw new Error("checksum");
    } catch { throw new UniversityDocxError("invalid_form_archive"); }
    decoded.set(name, content);
  }
  for (const required of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
    if (!decoded.has(required)) throw new UniversityDocxError("invalid_form_docx");
  }
  let main: XmlDocument | null = null;
  for (const [name, content] of decoded) {
    if (!/(?:\.xml|\.rels)$/iu.test(name)) continue;
    const xml = parseXml(content);
    assertPassiveXml(xml, name);
    if (name.endsWith(".rels")) assertRelationships(xml, name, decoded);
    if (name === "[Content_Types].xml" && (xml.documentElement?.namespaceURI !== CONTENT_TYPES || xml.documentElement.localName !== "Types")) throw new UniversityDocxError("invalid_form_docx");
    if (name === "word/document.xml") main = xml;
  }
  if (!main || main.documentElement.namespaceURI !== W || main.documentElement.localName !== "document") {
    throw new UniversityDocxError("unsupported_form_document");
  }
  const body = descendants(main, "body")[0];
  if (!body || body.parentNode !== main.documentElement) throw new UniversityDocxError("invalid_form_docx");
  const paragraphs = descendants(main, "p");
  if (!paragraphs.length || paragraphs.length > MAX_PARAGRAPHS) throw new UniversityDocxError("form_too_complex");
  const complexFields = fieldParagraphs(main);
  const tables = descendants(main, "tbl");
  const slots = paragraphs.map((paragraph, index) => inspectSlot(paragraph, index, paragraphs, tables, complexFields));
  const warnings: string[] = ["Заполняются только выбранные позиции основной части DOCX. После экспорта проверьте переносы и расположение значений в исходном бланке."];
  if (names.some(name => /^word\/(?:header|footer)\d*\.xml$/u.test(name))) warnings.push("Колонтитулы сохранены без изменений и не включены в сопоставление.");
  const manualCount = slots.filter(slot => !slot.editable).length;
  warnings.push(`Автоматическое заполнение доступно для ${slots.length - manualCount} из ${slots.length} позиций; остальные оставлены для просмотра или ручной работы.`);
  if (slots.some(slot => slot.manualReason?.includes("несколько полей"))) warnings.push("Есть абзацы с несколькими полями в одной строке. Заполните их вручную: разделение значений автоматически не выполняется.");
  if (slots.some(slot => slot.manualReason?.includes("Подписи"))) warnings.push("Подписи, согласия и заявления не заполняются. Их должен проверить и оформить сам заявитель.");
  if (slots.some(slot => slot.manualReason?.includes("Выбор"))) warnings.push("Флажки и варианты выбора оставлены без отметок; выбор не выводится из текстовых данных анкеты.");
  if (complexFields.size || descendants(main, "sdt").length) warnings.push("Поля Word и элементы управления содержимым не поддерживаются для подстановки; соответствующие позиции заблокированы.");
  return { zip, document: main, body, paragraphs, slots, warnings };
}

function zipEntryCount(bytes: Buffer): number {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (bytes.readUInt32LE(0) !== 0x04034b50 || end < 0 || end + 22 > bytes.length || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) {
    throw new UniversityDocxError("invalid_form_archive");
  }
  const count = bytes.readUInt16LE(end + 10);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== count || count < 1 || count > MAX_ENTRIES || bytes.readUInt32LE(end + 12) === 0xffffffff || bytes.readUInt32LE(end + 16) === 0xffffffff) {
    throw new UniversityDocxError("unsupported_form_archive");
  }
  const start = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12);
  if (start + size !== end) throw new UniversityDocxError("invalid_form_archive");
  return count;
}

function parseXml(bytes: Buffer): XmlDocument {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new UniversityDocxError("unsupported_form_encoding"); }
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) throw new UniversityDocxError("unsafe_form_xml");
  if (/\bencoding\s*=\s*["'](?!utf-8["']|UTF-8["'])/u.test(text.slice(0, 150))) throw new UniversityDocxError("unsupported_form_encoding");
  let invalid = false;
  let document: Document;
  try {
    document = new DOMParser({ onError: () => { invalid = true; } }).parseFromString(text, "application/xml");
  } catch { throw new UniversityDocxError("invalid_form_xml"); }
  if (invalid || !document.documentElement || document.getElementsByTagName("parsererror").length || Array.from(document.childNodes).filter(node => node.nodeType === 1).length !== 1) throw new UniversityDocxError("invalid_form_xml");
  return document as XmlDocument;
}

function relationshipTarget(part: string, target: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { throw new UniversityDocxError("unsupported_form_relationship"); }
  if (!decoded || /[\\\u0000-\u001f?#:]/u.test(decoded)) throw new UniversityDocxError("unsupported_form_relationship");
  const owner = part === "_rels/.rels" ? "" : part.replace(/(?:^|\/)_rels\/([^/]+)\.rels$/u, "/$1").replace(/^\//u, "");
  const resolved = path.posix.normalize(decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(path.posix.dirname(owner), decoded));
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../") || resolved.startsWith("/")) throw new UniversityDocxError("unsupported_form_relationship");
  return resolved;
}

function assertRelationships(document: Document, part: string, decoded: ReadonlyMap<string, Buffer>): void {
  const root = document.documentElement;
  if (!root || root.namespaceURI !== REL || root.localName !== "Relationships"
    || (part !== "_rels/.rels" && !/(?:^|\/)_rels\/[^/]+\.rels$/u.test(part))) throw new UniversityDocxError("invalid_form_relationships");
  if (part !== "_rels/.rels") {
    const owner = part.replace(/(?:^|\/)_rels\/([^/]+)\.rels$/u, "/$1").replace(/^\//u, "");
    if (!decoded.has(owner)) throw new UniversityDocxError("invalid_form_relationships");
  }
  const ids = new Set<string>();
  let mainCount = 0;
  for (const relation of Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1)) {
    const id = relation.getAttribute("Id") ?? "", type = relation.getAttribute("Type") ?? "", target = relation.getAttribute("Target") ?? "";
    const mode = relation.getAttribute("TargetMode");
    if (relation.namespaceURI !== REL || relation.localName !== "Relationship" || !id || ids.has(id)) throw new UniversityDocxError("invalid_form_relationships");
    ids.add(id);
    if (!SUPPORTED_RELATIONSHIPS.has(type)) throw new UniversityDocxError("unsupported_form_relationship");
    if (mode === "External") {
      if (type !== `${OFFICE_REL}/hyperlink` || !/^(?:https?:\/\/|mailto:)/iu.test(target)) throw new UniversityDocxError("external_form_content");
      try { const url = new URL(target); if (!["https:", "http:", "mailto:"].includes(url.protocol)) throw new Error(); }
      catch { throw new UniversityDocxError("external_form_content"); }
      continue;
    }
    if (mode && mode !== "Internal") throw new UniversityDocxError("unsupported_form_relationship");
    const resolved = relationshipTarget(part, target);
    if (!decoded.has(resolved)) throw new UniversityDocxError("invalid_form_relationships");
    if (type === `${OFFICE_REL}/officeDocument`) {
      if (part !== "_rels/.rels" || resolved !== "word/document.xml") throw new UniversityDocxError("unsupported_form_document");
      mainCount++;
    }
  }
  if (part === "_rels/.rels" && mainCount !== 1) throw new UniversityDocxError("invalid_form_relationships");
}

function assertPassiveXml(document: Document, part: string): void {
  const instructions = descendants(document, "instrText").map(element => element.textContent ?? "").join("") + descendants(document, "fldSimple").map(element => element.getAttributeNS(W, "instr") ?? "").join(" ");
  if (/\b(?:DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|DATABASE|LINK)\b/iu.test(instructions)) throw new UniversityDocxError("active_form_content");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (["OLEObject", "object", "altChunk", "control"].includes(element.localName ?? "")) throw new UniversityDocxError("active_form_content");
    const contentType = element.getAttribute("ContentType") ?? "";
    if (/macroenabled|vba|activex|oleobject/iu.test(contentType)) throw new UniversityDocxError("active_form_content");
    if (element.localName === "Relationship" && element.namespaceURI === REL) {
      const type = element.getAttribute("Type") ?? "", target = element.getAttribute("Target") ?? "";
      if (/oleObject|vbaProject|activeX|attachedTemplate|aFChunk|\/control$|\/package$/iu.test(type)) throw new UniversityDocxError("active_form_content");
      if (element.getAttribute("TargetMode") === "External" && (!type.endsWith("/hyperlink") || !/^(?:https?:|mailto:)/iu.test(target))) throw new UniversityDocxError("external_form_content");
    }
    if (part === "word/settings.xml" && element.namespaceURI === W && element.localName === "documentProtection" && /^(?:1|true|on)$/iu.test(element.getAttributeNS(W, "enforcement") ?? "")) throw new UniversityDocxError("protected_form");
  }
}

function inspectSlot(paragraph: Element, index: number, paragraphs: Element[], tables: Element[], fields: Set<Element>): UniversityFormSlot {
  const raw = paragraphText(paragraph), text = compact(raw);
  const cell = ancestor(paragraph, "tc"), row = cell ? ancestor(cell, "tr") : null;
  const table = row ? ancestor(row, "tbl") : null;
  let label = "", location = `Абзац ${index + 1}`, nearby = "";
  if (cell && row && table) {
    const rows = children(table, "tr"), cells = children(row, "tc");
    const rowIndex = rows.indexOf(row), cellIndex = cells.indexOf(cell);
    location = `Таблица ${tables.indexOf(table) + 1}, строка ${rowIndex + 1}, ячейка ${cellIndex + 1}`;
    const ownText = cellText(cell);
    label = BLANK.test(ownText) ? "" : compact(ownText);
    if (!label) {
      if (!isMergedContinuation(cell)) label = compact(cells.slice(0, cellIndex).reverse().map(cellText).find(value => !BLANK.test(value)) ?? "");
      if (!label) {
        const column = cellColumn(cell, cells);
        for (let previous = rowIndex - 1; previous >= 0 && !label; previous--) {
          const above = children(rows[previous], "tc");
          const matched = above.find(candidate => cellColumn(candidate, above) === column);
          if (matched && !BLANK.test(cellText(matched))) label = compact(cellText(matched));
        }
      }
    }
    nearby = cells.map(cellText).map(compact).filter(Boolean).join(" | ").slice(0, 280);
  } else {
    for (let previous = index - 1; previous >= Math.max(0, index - 3); previous--) {
      const candidate = compact(paragraphText(paragraphs[previous]));
      if (candidate) { nearby = candidate.slice(0, 180); break; }
    }
  }
  const context = [location, label ? `Поле: ${label.slice(0, 220)}` : "", nearby ? `Рядом: ${nearby}` : ""].filter(Boolean).join(" · ");
  let reason = manualReason(paragraph, cell, label, text, fields);
  const kind = BLANK.test(raw) ? "blank" : "label";
  if (!reason && kind === "blank" && (!cell || !label)) reason = "Пустой разделитель без однозначной подписи поля. Заполните вручную в исходном бланке.";
  if (!reason && kind === "label") {
    const labelText = raw.replace(/[\s_＿]+$/u, "");
    if ((labelText.match(/[:：]/gu) ?? []).length > 1) reason = "В этом абзаце несколько полей. Их нужно заполнить вручную по отдельности.";
    else if (!/[:：]$/u.test(labelText) || labelText.length > 140 || /\b(?:instructions|requirements|information|background|record|study\s+plan)\s*[:：]$/iu.test(labelText) || /^\s*\d+[.)]/u.test(labelText)) reason = "Текст или заголовок бланка. Для подстановки выберите пустую позицию с подписью.";
    else if (cell && descendants(cell, "p").some(item => item !== paragraph && BLANK.test(paragraphText(item)))) reason = "Подпись поля. Для значения выберите пустой абзац в этой же ячейке.";
  }
  return { id: `p-${index + 1}`, text: text.slice(0, 1200), context, kind, editable: reason === null, manualReason: reason };
}

function manualReason(paragraph: Element, cell: Element | null, label: string, text: string, fields: Set<Element>): string | null {
  const scope = `${label} ${text}`;
  if (SIGNING.test(scope)) return "Подписи, согласия и заявления оформляет заявитель вручную.";
  if (PHOTO.test(scope)) return "Фотографию необходимо добавить и проверить вручную.";
  if (cell && isMergedContinuation(cell)) return "Продолжение объединённой ячейки: выберите исходную позицию сверху или заполните её вручную.";
  if (OFFICIAL.test(scope)) return "Этот раздел предназначен для заполнения университетом.";
  const target = cell ?? paragraph;
  if (CHECK_MARK.test(scope) || descendants(target, "sym").length || descendants(target, "checkBox").length || descendants(target, "checkbox").length) return "Выбор и флажки отмечаются вручную, без автоматического предположения ответа.";
  if (fields.has(paragraph) || ancestor(paragraph, "sdt") || descendants(paragraph, "sdt").length || descendants(paragraph, "fldSimple").length) return "Поле Word или элемент управления содержимым: подстановка в эту конструкцию не поддерживается.";
  if (ancestor(paragraph, "txbxContent") || descendants(paragraph, "drawing").length || descendants(paragraph, "pict").length) return "Графическая область или текстовое поле требует ручного редактирования.";
  if (["ins", "del", "moveFrom", "moveTo", "hyperlink"].some(name => ancestor(paragraph, name) || descendants(paragraph, name).length)) return "Позиция содержит ссылку или исправления Word. Проверьте и заполните её вручную.";
  return null;
}

function fieldParagraphs(document: Document): Set<Element> {
  const result = new Set<Element>();
  let depth = 0;
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.namespaceURI !== W) continue;
    if (element.localName === "p" && depth > 0) result.add(element);
    if (element.localName === "fldChar" || element.localName === "instrText") {
      const paragraph = ancestor(element, "p");
      if (paragraph) result.add(paragraph);
      if (element.getAttributeNS(W, "fldCharType") === "begin") depth++;
      if (element.getAttributeNS(W, "fldCharType") === "end") depth = Math.max(0, depth - 1);
    }
  }
  return result;
}

function writeValue(paragraph: Element, value: string, kind: UniversityFormSlot["kind"]): void {
  const document = paragraph.ownerDocument!;
  const texts = descendants(paragraph, "t").filter(node => ancestor(node, "p") === paragraph);
  let target: Element | undefined;
  if (kind === "blank") {
    target = texts[0];
    for (const text of texts) text.textContent = "";
  } else {
    // Replace only the trailing blank placeholder, preserving every label run.
    for (let i = texts.length - 1; i >= 0; i--) {
      const text = texts[i], original = text.textContent ?? "";
      if (BLANK.test(original)) { text.textContent = ""; target = text; }
      else { text.textContent = original.replace(/[\s_＿]+$/u, ""); break; }
    }
  }
  if (!target) {
    const run = wordElement(document, paragraph, "r");
    const previousRuns = children(paragraph, "r");
    const style = previousRuns.length ? children(previousRuns[previousRuns.length - 1], "rPr")[0] : children(children(paragraph, "pPr")[0], "rPr")[0];
    if (style) run.appendChild(style.cloneNode(true));
    target = wordElement(document, paragraph, "t");
    run.appendChild(target); paragraph.appendChild(run);
  }
  target.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  const chunks = `${kind === "label" ? " " : ""}${value}`.split(/(\r\n|\r|\n|\t)/u);
  target.textContent = chunks[0];
  let cursor: Node = target;
  for (let index = 1; index < chunks.length; index++) {
    const chunk = chunks[index];
    const node = wordElement(document, paragraph, chunk === "\t" ? "tab" : /^[\r\n]+$/u.test(chunk) ? "br" : "t");
    if (node.localName === "t") { node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); node.textContent = chunk; }
    cursor.parentNode!.insertBefore(node, cursor.nextSibling); cursor = node;
  }
}

function draftParagraph(document: Document, source: Element): Element {
  const paragraph = wordElement(document, source, "p"), properties = wordElement(document, source, "pPr");
  const spacing = wordElement(document, source, "spacing"); spacing.setAttributeNS(W, "w:after", "0"); spacing.setAttributeNS(W, "w:before", "0"); properties.appendChild(spacing);
  paragraph.appendChild(properties);
  const run = wordElement(document, source, "r"), style = wordElement(document, source, "rPr");
  style.appendChild(wordElement(document, source, "b"));
  const color = wordElement(document, source, "color"); color.setAttributeNS(W, "w:val", "9C243C"); style.appendChild(color);
  const size = wordElement(document, source, "sz"); size.setAttributeNS(W, "w:val", "16"); style.appendChild(size);
  run.appendChild(style);
  const text = wordElement(document, source, "t"); text.textContent = "DRAFT / ЧЕРНОВИК — НЕ ДЛЯ ПОДАЧИ. Проверьте пропуски и бланк.";
  run.appendChild(text); paragraph.appendChild(run); return paragraph;
}

function addDraftNotice(form: OpenForm): void {
  // Keep the body flow intact. A body-first notice pushed the signature of the
  // real one-page Guizhou form onto a separate page. Headers mark every page.
  const serializer = new XMLSerializer();
  const relPath = "word/_rels/document.xml.rels";
  const relBytes = form.zip.file(relPath)?.asNodeBuffer() ?? Buffer.from(`<Relationships xmlns="${REL}"/>`);
  const relationships = parseXml(relBytes);
  const root = relationships.documentElement;
  const existing = Array.from(root.getElementsByTagNameNS(REL, "Relationship"));
  let number = 1;
  while (form.zip.file(`word/evo-draft-header-${number}.xml`) || existing.some(item => item.getAttribute("Id") === `rIdEvoDraft${number}`)) number++;
  const draftPart = `word/evo-draft-header-${number}.xml`, draftId = `rIdEvoDraft${number}`;
  const header = parseXml(Buffer.from(`<w:hdr xmlns:w="${W}"/>`));
  header.documentElement.appendChild(draftParagraph(header, header.documentElement));
  form.zip.file(draftPart, serializer.serializeToString(header));
  const relationship = relationships.createElementNS(REL, "Relationship");
  relationship.setAttribute("Id", draftId); relationship.setAttribute("Type", `${OFFICE_REL}/header`); relationship.setAttribute("Target", path.posix.basename(draftPart)); root.appendChild(relationship);
  const contentTypes = parseXml(form.zip.file("[Content_Types].xml")!.asNodeBuffer());
  const override = contentTypes.createElementNS(CONTENT_TYPES, "Override"); override.setAttribute("PartName", `/${draftPart}`); override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"); contentTypes.documentElement.appendChild(override);
  const sections = descendants(form.document, "sectPr");
  if (!sections.length) { const section = wordElement(form.document, form.body, "sectPr"); form.body.appendChild(section); sections.push(section); }
  const inherited: Record<string, string> = { default: draftId, first: draftId, even: draftId };
  const marked = new Set<string>([draftId]);
  for (const section of sections) {
    for (const type of ["default", "first", "even"]) {
      let reference = children(section, "headerReference").find(item => item.getAttributeNS(W, "type") === type);
      if (reference) inherited[type] = reference.getAttributeNS(OFFICE_REL, "id") ?? "";
      else {
        reference = wordElement(form.document, section, "headerReference"); reference.setAttributeNS(W, "w:type", type); reference.setAttributeNS(OFFICE_REL, "r:id", inherited[type]); section.insertBefore(reference, section.firstChild);
      }
      const id = inherited[type];
      if (marked.has(id)) continue;
      const relationship = existing.find(item => item.getAttribute("Id") === id && item.getAttribute("Type") === `${OFFICE_REL}/header`);
      const target = relationship?.getAttribute("Target");
      const part = target ? relationshipTarget(relPath, target) : "";
      const bytes = target ? form.zip.file(part)?.asNodeBuffer() : undefined;
      if (!bytes) throw new UniversityDocxError("invalid_form_header");
      const existingHeader = parseXml(bytes);
      if (existingHeader.documentElement.namespaceURI !== W || existingHeader.documentElement.localName !== "hdr") throw new UniversityDocxError("invalid_form_header");
      existingHeader.documentElement.insertBefore(draftParagraph(existingHeader, existingHeader.documentElement), existingHeader.documentElement.firstChild);
      form.zip.file(part, serializer.serializeToString(existingHeader)); marked.add(id);
    }
  }
  form.zip.file(relPath, serializer.serializeToString(relationships));
  form.zip.file("[Content_Types].xml", serializer.serializeToString(contentTypes));
}

function compact(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function descendants(node: Document | Element, local: string): Element[] { return Array.from(node.getElementsByTagNameNS(W, local)); }
function children(node: Node | undefined, local: string): Element[] {
  if (!node) return [];
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).namespaceURI === W && (child as Element).localName === local);
}
function ancestor(node: Node, local: string): Element | null {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) if (parent.nodeType === 1 && (parent as Element).namespaceURI === W && (parent as Element).localName === local) return parent as Element;
  return null;
}
function paragraphText(paragraph: Element): string { return descendants(paragraph, "t").filter(text => ancestor(text, "p") === paragraph).map(text => text.textContent ?? "").join(""); }
function cellText(cell: Element): string { return descendants(cell, "p").filter(paragraph => ancestor(paragraph, "tc") === cell).map(paragraphText).join(" "); }
function cellColumn(cell: Element, cells: Element[]): number {
  return cells.slice(0, cells.indexOf(cell)).reduce((column, previous) => column + Number(children(children(previous, "tcPr")[0], "gridSpan")[0]?.getAttributeNS(W, "val") ?? 1), 0);
}
function isMergedContinuation(cell: Element): boolean {
  const merge = children(children(cell, "tcPr")[0], "vMerge")[0];
  return Boolean(merge && merge.getAttributeNS(W, "val") !== "restart");
}
function wordElement(document: Document, source: Element, local: string): Element { return document.createElementNS(W, `${source.prefix || "w"}:${local}`); }
