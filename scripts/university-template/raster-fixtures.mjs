// Synthetic test fixtures only. Neither PDF input nor these encoders run in Next.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

const ROOT = "/opt/evo-university-template-runtime";
// Lossless 16x16 solid-red JP2, generated from scratch with Pillow/OpenJPEG2.5.4.
const JPX = "AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAEAAAABAAAwcHAAAAAAAPY29scgEAAAAAABAAAACqanAyY/9P/1EALwAAAAAAEAAAABAAAAAAAAAAAAAAABAAAAAQAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAQEBAAB/1wAEEBASEhQSEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAAJgAB/5PPtAQA34AIB9+ACAeAgICAgICAgICAgID/2Q==";
function stream(document, page, content) {
  page.node.addContentStream(document.context.register(document.context.stream(content)));
}
async function base(width = 400, height = 250) {
  const document = await PDFDocument.create(), page = document.addPage([width, height]);
  const label = await document.embedFont(StandardFonts.Helvetica);
  document.setCreationDate(new Date("2000-01-01T00:00:00Z")); document.setModificationDate(new Date("2000-01-01T00:00:00Z"));
  return { document, page, label };
}
function cffCid(metrics, glyphId) {
  if (!glyphId) return 0;
  const charset = metrics["CFF "].topDict.charset;
  if (charset.version === 0) return charset.glyphs[glyphId - 1];
  assert.ok(charset.version === 1 || charset.version === 2);
  const range = charset.ranges.find(range => range.offset <= glyphId - 1 && glyphId - 1 <= range.offset + range.nLeft);
  assert.ok(range); return range.first + glyphId - 1 - range.offset;
}
export async function rasterFixture(kind) {
  const { document, page, label } = await base();
  page.drawText(`Synthetic ${kind} fixture`, { x: 20, y: 220, size: 14, font: label });
  if (["embedded-cjk", "malformed-cjk", "unsupported-full-cjk"].includes(kind)) {
    document.registerFontkit(fontkit);
    const filename = kind === "embedded-cjk" ? "NotoSansSC-Regular.otf" : "NotoSansCJKsc-Regular.otf";
    const fontBytes = await readFile(`${ROOT}/public-fixtures/${filename}`);
    const font = await document.embedFont(fontBytes, { subset: kind === "malformed-cjk" });
    const text = "中文大学 / 日本語 / 申请表";
    if (kind === "malformed-cjk") page.drawText(text, { x: 20, y: 145, size: 22, font });
    if (kind !== "malformed-cjk") {
      await document.flush();
      const root = document.context.lookup(font.ref), descendant = document.context.lookup(root.lookup(PDFName.of("DescendantFonts")).get(0));
      const descriptor = descendant.lookup(PDFName.of("FontDescriptor"));
      // Full OTF bytes are OpenType, not a bare CIDFontType0C CFF stream.
      const file = descriptor.get(PDFName.of("FontFile3")) ?? descriptor.get(PDFName.of("FontFile2"));
      descriptor.delete(PDFName.of("FontFile2")); descriptor.set(PDFName.of("FontFile3"), file);
      descendant.set(PDFName.of("Subtype"), PDFName.of("CIDFontType0"));
      document.context.lookup(file).dict.set(PDFName.of("Subtype"), PDFName.of("OpenType"));
      // A CID-keyed regional CFF has gaps: glyph-array IDs are NOT its CIDs.
      // Encode actual CFF CIDs and bind both widths and Unicode to those CIDs.
      const metrics = fontkit.create(fontBytes);
      const glyphs = [...text].map(character => {
        const codepoint = character.codePointAt(0), glyph = metrics.glyphForCodePoint(codepoint), cid = cffCid(metrics, glyph.id);
        assert.ok(glyph.id > 0 && Number.isInteger(cid) && cid > 0 && cid <= 65535);
        return { cid, codepoint, width: glyph.advanceWidth * 1000 / metrics.unitsPerEm };
      });
      const unique = [...new Map(glyphs.map(glyph => [glyph.cid, glyph])).values()].sort((a, b) => a.cid - b.cid);
      const hex = value => value.toString(16).padStart(4, "0");
      descendant.set(PDFName.of("W"), document.context.obj(unique.flatMap(glyph => [glyph.cid, [glyph.width]])));
      descendant.delete(PDFName.of("CIDToGIDMap"));
      const unicode = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /SyntheticCJK def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${unique.length} beginbfchar\n${unique.map(glyph => `<${hex(glyph.cid)}> <${hex(glyph.codepoint)}>`).join("\n")}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end\n`;
      root.set(PDFName.of("ToUnicode"), document.context.register(document.context.stream(unicode)));
      page.node.setFontDictionary(PDFName.of("CJKFixture"), font.ref);
      stream(document, page, `q 0 0 0 rg BT /CJKFixture 22 Tf 20 145 Td <${glyphs.map(glyph => hex(glyph.cid)).join("")}> Tj ET Q\n`);
    }
  } else if (kind === "type3") {
    const glyph = document.context.register(document.context.stream("600 0 0 0 600 700 d1\n0 0 m 300 700 l 600 0 l h f\n"));
    const font = document.context.register(document.context.obj({ Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 600, 700],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { A: glyph }, Encoding: { Type: "Encoding", Differences: [65, "A"] },
      FirstChar: 65, LastChar: 65, Widths: [600], Resources: {} }));
    page.node.setFontDictionary(PDFName.of("TriangleFont"), font);
    stream(document, page, "q 0 0 0 rg BT /TriangleFont 80 Tf 50 80 Td (A) Tj ET Q\n");
  } else if (kind === "external-cmap") {
    const bytes = await readFile(`${ROOT}/fill-proof/assets/fonts/NotoSans-Regular.ttf`);
    document.registerFontkit(fontkit);
    const font = await document.embedFont(bytes, { subset: false });
    await document.flush();
    const root = document.context.lookup(font.ref);
    root.set(PDFName.of("Encoding"), PDFName.of("UniGB-UCS2-H"));
    const descendant = document.context.lookup(root.lookup(PDFName.of("DescendantFonts")).get(0));
    descendant.set(PDFName.of("CIDSystemInfo"), document.context.obj({ Registry: PDFString.of("Adobe"), Ordering: PDFString.of("GB1"), Supplement: 5 }));
    // UniGB maps U+0041/U+0042 to Adobe-GB1 CIDs34/35; explicit glyph mapping.
    const metrics = fontkit.create(bytes), map = Buffer.alloc(36 * 2);
    map.writeUInt16BE(metrics.glyphForCodePoint(65).id, 34 * 2); map.writeUInt16BE(metrics.glyphForCodePoint(66).id, 35 * 2);
    descendant.set(PDFName.of("CIDToGIDMap"), document.context.register(document.context.flateStream(map)));
    descendant.set(PDFName.of("W"), document.context.obj([34, [65, 66].map(code => metrics.glyphForCodePoint(code).advanceWidth * 1000 / metrics.unitsPerEm)]));
    page.node.setFontDictionary(PDFName.of("CMapFont"), font.ref);
    stream(document, page, "q 0 0 0 rg BT /CMapFont 42 Tf 30 100 Td <00410042> Tj ET Q\n");
  } else if (kind === "jpeg-jpx-mask" || kind === "malformed-jpx") {
    const { createCanvas } = createRequire(import.meta.url)(`${ROOT}/node_modules/@napi-rs/canvas`);
    const canvas = createCanvas(16, 16), context = canvas.getContext("2d");
    context.fillStyle = "#ff0000"; context.fillRect(0, 0, 16, 16);
    page.drawImage(await document.embedJpg(canvas.toBuffer("image/jpeg")), { x: 20, y: 100, width: 64, height: 64 });
    const jpx = document.context.register(document.context.stream(kind === "malformed-jpx" ? Buffer.from("invalid JPEG2000") : Buffer.from(JPX, "base64"),
      { Type: "XObject", Subtype: "Image", Width: 16, Height: 16, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "JPXDecode" }));
    page.node.setXObject(PDFName.of("Jpx"), jpx); stream(document, page, "q 64 0 0 64 110 100 cm /Jpx Do Q\n");
    context.clearRect(0, 0, 16, 16); context.fillStyle = "rgba(0,0,255,0.5)"; context.fillRect(0, 0, 16, 16);
    page.drawRectangle({ x: 200, y: 100, width: 64, height: 64, color: rgb(0, 1, 0) });
    page.drawImage(await document.embedPng(canvas.toBuffer("image/png")), { x: 200, y: 100, width: 64, height: 64 });
  } else throw new Error("Unknown synthetic raster fixture");
  return Buffer.from(await document.save());
}
