import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { computePackageRulesHash, resolveDocumentPackage } from "../src/lib/document-package.ts";
import { buildDocumentPackageZip, buildPartnerPacketZip } from "../src/lib/server/document-package.ts";
import { fixture, generatedFixture, id } from "./fixtures/document-package.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function partnerFixture() {
  const first = Buffer.from("Synthetic opaque original"), second = Buffer.from("Synthetic saved Word artifact");
  return { snapshot: { packetId: id(801), caseId: id(802), inputSha256: "a".repeat(64), mode: "draft", sources: [
    { id: id(803), kind: "original", sha256: sha(first), sizeBytes: first.length, mimeType: "application/pdf", name: "../../Original.pdf", mode: null },
    { id: id(804), kind: "generated", sha256: sha(second), sizeBytes: second.length,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "Generated.docx", mode: "draft" },
  ] }, buffers: [{ itemId: id(803), bytes: first }, { itemId: id(804), bytes: second }] };
}
test("persisted partner ZIP includes every selected opaque input with safe UUID paths and deterministic manifest", () => {
  const { snapshot, buffers } = partnerFixture();
  const result = buildPartnerPacketZip(snapshot, buffers), zip = new PizZip(result.bytes);
  assert.deepEqual(Object.keys(zip.files).sort(), ["README.txt", "manifest.json", `original/${id(803)}.pdf`, `generated/${id(804)}.docx`].sort());
  for (const [index, path] of [`original/${id(803)}.pdf`, `generated/${id(804)}.docx`].entries())
    assert.deepEqual(zip.file(path).asNodeBuffer(), buffers[index].bytes);
  assert.equal(result.sha256, sha(result.bytes));
  assert.deepEqual(result.bytes, buildPartnerPacketZip({ ...snapshot, sources: [...snapshot.sources].reverse() }, [...buffers].reverse()).bytes);
  assert.equal(result.manifest.items.length, 2);
  assert.ok(!JSON.stringify(result.manifest).includes("bucket"));
});
test("partner ZIP rejects missing, corrupt, duplicate, oversized and draft-in-final selections without omissions", () => {
  const { snapshot, buffers } = partnerFixture();
  for (const selected of [buffers.slice(0, 1), [buffers[0], buffers[0]], [buffers[0], { ...buffers[1], bytes: Buffer.from("wrong") }]])
    assert.throws(() => buildPartnerPacketZip(snapshot, selected));
  assert.throws(() => buildPartnerPacketZip({ ...snapshot, mode: "final" }, buffers));
  const big = Buffer.alloc(25 * 1024 * 1024), digest = sha(big);
  const large = snapshot.sources.map((source, index) => ({ ...source, kind: "original", mode: null, mimeType: "application/pdf",
    name: String(index), sizeBytes: big.length, sha256: digest }));
  assert.throws(() => buildPartnerPacketZip({ ...snapshot, sources: large }, large.map(source => ({ itemId: source.id, bytes: big }))), { code: "package_too_large" });
  assert.throws(() => buildPartnerPacketZip({ ...snapshot, sources: Array(51).fill(snapshot.sources[0]) }, Array(51).fill(buffers[0])));
});
async function inputFixture() {
  const document = await PDFDocument.create(); document.addPage([200, 200]).drawText("Synthetic original");
  const bytes = Buffer.from(await document.save()), snapshot = await fixture(), item = snapshot.items[0];
  item.source.sizeBytes = bytes.length; item.source.sha256 = sha(bytes); item.review.sourceSha256 = sha(bytes);
  snapshot.currentDocumentVersions[0].sha256 = sha(bytes);
  return { bytes, snapshot };
}
test("a real ZIP contains byte-identical reviewed original plus exactly two deterministic metadata entries", async () => {
  const { snapshot, bytes } = await inputFixture(), before = Buffer.from(bytes);
  const resolution = await resolveDocumentPackage(snapshot, 1);
  const output = await buildDocumentPackageZip(resolution, [{ itemId: id(6), bytes }], { mode: "final" });
  const zip = new PizZip(output.bytes), path = `documents/original/${id(6)}.pdf`;
  assert.deepEqual(Object.keys(zip.files).sort(), [path, "manifest.json", "README.txt"].sort());
  assert.deepEqual(zip.file(path).asNodeBuffer(), before);
  assert.deepEqual(bytes, before); assert.equal(output.sha256, sha(output.bytes));
  assert.equal(output.manifestSha256, sha(zip.file("manifest.json").asNodeBuffer()));
  assert.equal(output.manifest.contentReady, true);
  assert.equal(output.manifest.items[0].status, "included");
  assert.equal(output.manifest.items[0].source.ref.versionId, id(8));
  assert.deepEqual(JSON.parse(zip.file("manifest.json").asText()), output.manifest);
  assert.equal("persisted" in output, false);
  const repeated = await buildDocumentPackageZip(resolution, [{ itemId: id(6), bytes }], { mode: "final" });
  assert.deepEqual(output.bytes, repeated.bytes);
});

test("draft omissions are explicit and never fulfill required slots; final does not silently drop bytes", async () => {
  const { snapshot, bytes } = await inputFixture();
  snapshot.items[0].review = null;
  const resolution = await resolveDocumentPackage(snapshot, 1);
  const output = await buildDocumentPackageZip(resolution, [], { mode: "draft" });
  assert.deepEqual(Object.keys(new PizZip(output.bytes).files).sort(), ["README.txt", "manifest.json"]);
  assert.equal(output.manifest.contentReady, false); assert.equal(output.manifest.items[0].required, true);
  assert.equal(output.manifest.items[0].status, "omitted"); assert.equal(output.manifest.items[0].path, null);
  assert.ok(output.manifest.items[0].checks.includes("review_missing"));
  await assert.rejects(buildDocumentPackageZip(resolution, [], { mode: "final" }), { code: "package_not_content_ready" });
  await assert.rejects(buildDocumentPackageZip(resolution, [{ itemId: id(6), bytes }], { mode: "draft" }), { code: "invalid_package_buffers" });
});

test("unavailable or changed exact bytes are omitted with a reason and block final", async () => {
  const { snapshot, bytes } = await inputFixture(), resolution = await resolveDocumentPackage(snapshot, 1);
  for (const [input, code] of [[[], "source_bytes_missing"], [[{ itemId: id(6), bytes: Buffer.concat([bytes, Buffer.from("\n")]) }], "source_integrity_failed"]]) {
    const draft = await buildDocumentPackageZip(resolution, input, { mode: "draft" });
    assert.equal(draft.manifest.contentReady, false); assert.equal(draft.manifest.items[0].status, "omitted");
    assert.ok(draft.manifest.checks.some(check => check.code === code));
    assert.equal(new PizZip(draft.bytes).file(`documents/original/${id(6)}.pdf`), null);
    await assert.rejects(buildDocumentPackageZip(resolution, input, { mode: "final" }), { code: "package_not_content_ready" });
  }
});

test("generated DOCX is copied as an opaque original artifact without changing its inner ZIP", async () => {
  const docx = new PizZip();
  docx.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  docx.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic reviewed form</w:t></w:r></w:p></w:body></w:document>');
  const bytes = docx.generate({ type: "nodebuffer", compression: "DEFLATE" });
  const snapshot = await generatedFixture("university_form_export"), item = snapshot.items[0];
  const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  Object.assign(snapshot.rules.slots[0], { allowedMimeTypes: [mime], maxBytes: null });
  snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  Object.assign(item.source, { mimeType: mime, sha256: sha(bytes), sizeBytes: bytes.length });
  item.source.export.artifactSha256 = sha(bytes);
  Object.assign(item.review, { sourceSha256: sha(bytes), rulesSha256: snapshot.rules.sha256 });
  const output = await buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), [{ itemId: item.id, bytes }], { mode: "final" });
  assert.deepEqual(new PizZip(output.bytes).file(`university_form_export/${item.id}.docx`).asNodeBuffer(), bytes);
  item.source.export.mode = "draft";
  const draft = await buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), [{ itemId: item.id, bytes }], { mode: "draft" });
  assert.equal(draft.manifest.items[0].status, "included"); assert.equal(draft.manifest.contentReady, false);
  assert.ok(draft.manifest.items[0].checks.includes("source_is_draft"));
});

test("neutral names, caller ordering and mode are reflected by deterministic manifests", async () => {
  const { snapshot, bytes } = await inputFixture(), other = structuredClone(snapshot.items[0]);
  other.id = id(30); other.slotId = id(31); other.review.itemId = id(30);
  snapshot.rules.slots.push({ ...snapshot.rules.slots[0], id: id(31), required: false });
  snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  snapshot.items.push(other); snapshot.items.forEach(item => { item.review.rulesSha256 = snapshot.rules.sha256; item.source.originalFilename = "Synthetic private filename.pdf"; });
  const input = snapshot.items.map(item => ({ itemId: item.id, bytes }));
  const first = await buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), input, { mode: "final" });
  snapshot.items.reverse(); snapshot.rules.slots.reverse();
  const reversed = await buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), input.reverse(), { mode: "final" });
  assert.deepEqual(first.bytes, reversed.bytes);
  assert.equal(JSON.stringify(first.manifest).includes("private filename"), false);
  const draft = await buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), input, { mode: "draft" });
  assert.notEqual(first.manifest.inputSha256, draft.manifest.inputSha256); assert.notEqual(first.sha256, draft.sha256);
  snapshot.items.find(item => item.id === id(30)).selected = false;
  const optional = await buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), input.filter(item => item.itemId === id(6)), { mode: "final" });
  assert.equal(optional.manifest.contentReady, true);
  assert.deepEqual(optional.manifest.items.find(item => item.id === id(30)).checks, ["not_selected"]);
});

test("ZIP timestamps and bytes stay identical across ordinary host timezones", async () => {
  const { bytes } = await inputFixture();
  const code = `import { createHash } from 'node:crypto';
    import { fixture, id } from './tests/fixtures/document-package.mjs';
    import { resolveDocumentPackage } from './src/lib/document-package.ts';
    import { buildDocumentPackageZip } from './src/lib/server/document-package.ts';
    const bytes = Buffer.from(process.argv[1], 'base64'), snapshot = await fixture();
    const hash = createHash('sha256').update(bytes).digest('hex');
    Object.assign(snapshot.items[0].source, {sha256:hash,sizeBytes:bytes.length});
    snapshot.items[0].review.sourceSha256=hash; snapshot.currentDocumentVersions[0].sha256=hash;
    process.stdout.write((await buildDocumentPackageZip(await resolveDocumentPackage(snapshot,1),[{itemId:id(6),bytes}],{mode:'final'})).sha256);`;
  const hashes = ["UTC", "Asia/Bishkek", "America/Los_Angeles"].map(TZ => {
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--experimental-strip-types", "--input-type=module", "-e", code, bytes.toString("base64")],
      { cwd: new URL("..", import.meta.url), env: { ...process.env, TZ }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  });
  assert.equal(new Set(hashes).size, 1);
});

test("the builder requires its immutable resolution and preflights source collection bounds", async () => {
  const { snapshot, bytes } = await inputFixture(), result = await resolveDocumentPackage(snapshot, 1);
  await assert.rejects(buildDocumentPackageZip(structuredClone(result), [], { mode: "final" }), { code: "invalid_package_resolution" });
  await assert.rejects(buildDocumentPackageZip(result, [{ itemId: id(6), bytes }, { itemId: id(6), bytes }], { mode: "final" }), { code: "invalid_package_buffers" });
  await assert.rejects(buildDocumentPackageZip(result, [{ itemId: id(6), bytes: Buffer.alloc(25 * 1024 * 1024 + 1) }], { mode: "final" }), { code: "package_source_too_large" });
});

async function repeatedItems(snapshot, count) {
  const first = structuredClone(snapshot.items[0]), slot = { ...snapshot.rules.slots[0], maxBytes: null };
  snapshot.rules.slots = []; snapshot.items = [];
  for (let index = 0; index < count; index++) {
    const item = structuredClone(first); item.id = id(300 + index); item.slotId = id(400 + index); item.review.itemId = item.id;
    snapshot.items.push(item); snapshot.rules.slots.push({ ...slot, id: item.slotId });
  }
  snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  snapshot.items.forEach(item => { item.review.rulesSha256 = snapshot.rules.sha256; });
  return snapshot;
}

test("aggregate actual bytes are rejected in preflight without allocating a full archive", async () => {
  const snapshot = await repeatedItems(await fixture(), 3), bytes = Buffer.alloc(25 * 1024 * 1024);
  await assert.rejects(buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), snapshot.items.map(item => ({ itemId: item.id, bytes })), { mode: "final" }), { code: "package_too_large" });
});

test("40 assets remain a ceiling, not permission to exceed the independent 64 KiB manifest limit", async () => {
  const snapshot = await repeatedItems(await generatedFixture("university_form_export"), 40);
  await assert.rejects(buildDocumentPackageZip(await resolveDocumentPackage(snapshot, 1), [], { mode: "draft" }), { code: "package_manifest_too_large" });
});
