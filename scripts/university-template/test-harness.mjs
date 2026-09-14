import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm, access, stat, readdir } from "node:fs/promises";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import PizZip from "pizzip";
import { inspectUniversityTemplate, previewUniversityTemplateSource } from "./adapter.mjs";

const ROOT = "/opt/evo-university-template-runtime";
const launcher = `${ROOT}/launcher`, diagnostic = `${ROOT}/launcher.test`;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const rejected = code => ({ status: "rejected", code });
const inspect = (bytes, mimeType = DOCX, signal = new AbortController().signal) => inspectUniversityTemplate({ bytes, mimeType, expectedSha256: sha(bytes) }, { signal });
const preview = (bytes, expectedManifest, offset = 0, signal = new AbortController().signal) =>
  previewUniversityTemplateSource({ bytes, mimeType: DOCX, expectedSha256: sha(bytes), expectedManifest, offset }, { signal });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
function docx({ body = p("Name:") + p("Signature:") + p("PRIVATE SYNTHETIC SENTINEL"), extra = {} } = {}) {
  const zip = new PizZip();
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ...extra,
  };
  for (const [name, value] of Object.entries(parts)) zip.file(name, value, { createFolders: false, date: new Date(2000, 0, 1) });
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
async function pdf(pages = 1, amend = () => {}) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage([300, 400]);
  amend(document);
  return Buffer.from(await document.save());
}
function wire(bytes, mimeType = DOCX, change = {}) {
  return Buffer.concat([Buffer.from(`${JSON.stringify({ byteLength: bytes.length, expectedSha256: sha(bytes), mimeType, ...change })}\n`), bytes]);
}
async function run(binary, args = [], input = null, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
async function childPid(supervisor, phase) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const pid = (await readFile(`/proc/${supervisor.pid}/task/${supervisor.pid}/children`, "utf8")).trim();
      if (/^\d+$/.test(pid) && (!phase || (await readFile(`/proc/${pid}/comm`, "utf8")).trim() === phase)) return pid;
    } catch {}
    await wait(10);
  }
  assert.fail("owned inspector did not enter expected phase");
}
async function gone(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await access(`/proc/${pid}`); } catch { return true; }
    await wait(10);
  }
  return false;
}

test("actual template image owns immutable entrypoints and enforces network/files/FD/environment limits", async () => {
  assert.equal(process.platform, "linux"); assert.equal(process.version, "v22.23.1"); assert.equal(process.getuid(), 1001);
  for (const name of ["launcher", "bootstrap.mjs", "seal.node", "inspect.mjs"]) {
    const info = await stat(`${ROOT}/${name}`); assert.equal(info.uid, 0); assert.equal(info.mode & 0o022, 0);
  }
  await writeFile("/tmp/evo-document-outside", "synthetic-outside-sentinel", { mode: 0o644 });
  const result = await run(diagnostic, ["policy"], null, { EVO_DOCUMENT_TEST_SECRET: "synthetic-environment-sentinel" });
  assert.equal(result.code, 0); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { policy: "enforced", memory: 2147483648, cpu: 10, fd: 64 });
  assert.equal((await run(launcher, ["policy"])).code, 64);
});

test("actual sealed template parser returns only exact DOCX hash and minimal manual/editable slots", async () => {
  const bytes = docx(), hash = sha(bytes), result = await inspect(bytes);
  assert.deepEqual(result, { status: "verified", sha256: hash, byteLength: bytes.length, mimeType: DOCX,
    policyVersion: "evo-university-template-v1", manifest: { format: "docx", slots: [
      { id: "p-1", editable: true }, { id: "p-2", editable: false }, { id: "p-3", editable: false },
    ], pageSizes: [] } });
  assert.equal(sha(bytes), hash);
  assert.equal(JSON.stringify(result).includes("SENTINEL"), false);
  assert.ok(Object.isFrozen(result.manifest.slots[0]));
});

test("actual passive PDF inspection preserves exact visible pages without manufacturing editable slots", async () => {
  const bytes = await pdf(2, document => document.getPage(0).setCropBox(10, 20, 250, 300));
  assert.deepEqual(await inspect(bytes, "application/pdf"), { status: "verified", sha256: sha(bytes), byteLength: bytes.length,
    mimeType: "application/pdf", policyVersion: "evo-university-template-v1",
    manifest: { format: "pdf", slots: [], pageSizes: [{ width: 250, height: 300 }, { width: 300, height: 400 }] } });
});

test("3000 actual DOCX slots fit the dedicated 128KiB protocol; 3001 cannot pass", async () => {
  const bytes = docx({ body: p("Name:").repeat(3000) }), result = await inspect(bytes);
  assert.equal(result.status, "verified"); assert.equal(result.manifest.slots.length, 3000);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) > 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024);
  const last = await preview(bytes, result.manifest, 2990);
  assert.equal(last.status, "preview"); assert.equal(last.totalSlots, 3000);
  assert.equal(last.slots[9].id, "p-3000"); assert.equal(last.nextOffset, null);
  assert.deepEqual(await inspect(docx({ body: p("Name:").repeat(3001) })), rejected("template_not_eligible"));
});

test("actual source preview returns exact text/context/manual rows with stable complete pagination", async () => {
  const cell = text => `<w:tc>${p(text)}</w:tc>`;
  const bytes = docx({ body: `<w:tbl><w:tr>${cell("Family name")}${cell("___")}</w:tr></w:tbl>`
    + p("Signature:") + Array.from({ length: 18 }, (_, index) => p(`Field ${index + 1}:`)).join("") });
  const source = await inspect(bytes); assert.equal(source.status, "verified");
  const first = await preview(bytes, source.manifest), second = await preview(bytes, source.manifest, 10), last = await preview(bytes, source.manifest, 20);
  for (const result of [first, second, last]) {
    assert.equal(result.status, "preview"); assert.equal(result.sha256, source.sha256); assert.equal(result.byteLength, bytes.length);
    assert.equal(result.manifestDigest, sha(Buffer.from(JSON.stringify(source.manifest))));
    assert.equal(result.totalSlots, 21); assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
  }
  assert.equal(first.nextOffset, 10); assert.equal(second.nextOffset, 20); assert.equal(last.nextOffset, null);
  assert.deepEqual([...first.slots, ...second.slots, ...last.slots].map(slot => slot.id), source.manifest.slots.map(slot => slot.id));
  assert.equal(first.slots[1].text, "___"); assert.equal(first.slots[1].editable, true); assert.equal(first.slots[1].kind, "blank");
  assert.match(first.slots[1].context, /Таблица 1, строка 1, ячейка 2/); assert.match(first.slots[1].context, /Family name/);
  assert.equal(first.slots[2].editable, false); assert.match(first.slots[2].manualReason, /вручную/);
  assert.equal(first.slots[0].truncated, false);
  assert.ok(Object.isFrozen(first.slots[0]));
  const tampered = structuredClone(source.manifest); tampered.slots[20].editable = !tampered.slots[20].editable;
  assert.deepEqual(await preview(bytes, tampered), rejected("source_unavailable")); // Difference outside requested page still rejects.
  const pending = preview(bytes, source.manifest), oldHash = sha(bytes); bytes[0] = 0;
  assert.equal((await pending).sha256, oldHash);
});

test("actual preview marks preexisting paragraph, label and nearby clipping and retains Unicode as plain text", async () => {
  const cell = text => `<w:tc>${p(text)}</w:tc>`;
  const bytes = docx({ body: p("X".repeat(1301)) + p("Name:") + p("&lt;img src=&quot;x&quot;&gt; 中文 Имя")
    + `<w:tbl><w:tr>${cell("L".repeat(230))}${cell("___")}</w:tr>`
    + `<w:tr>${cell("A".repeat(120))}${cell("B".repeat(120))}${cell("C".repeat(120))}</w:tr></w:tbl>` });
  const source = await inspect(bytes), result = await preview(bytes, source.manifest);
  assert.equal(result.status, "preview"); assert.equal(result.slots[0].text.length, 1200); assert.equal(result.slots[0].truncated, true);
  assert.equal(result.slots[1].truncated, true); // Previous paragraph was clipped to180.
  assert.equal(result.slots[2].text, '<img src="x"> 中文 Имя');
  assert.equal(result.slots[3].truncated, true); // Own label clipped to220, before preview projection.
  assert.equal(result.slots[4].truncated, true); // Empty cell inherits that clipped label.
  assert.equal(result.slots[5].truncated, true); // Row context clipped to280 despite each label being short.
  assert.equal(JSON.stringify(source).includes("truncated"), false);
  assert.equal(JSON.stringify(source).includes("中文"), false);
});

test("actual child rejects invalid preview operation, offset and PDF; source/manifest mutation cannot substitute binding", async () => {
  const bytes = docx(), source = await inspect(bytes);
  for (const change of [{ operation: "render", offset: 0 }, { operation: "source-preview", offset: -1 },
    { operation: "source-preview", offset: 0.5 }, { operation: "source-preview", offset: 3000 },
    { operation: "source-preview", offset: 3 }, { operation: "source-preview", offset: 0, limit: 1 }]) {
    assert.deepEqual(JSON.parse((await run(launcher, [], wire(bytes, DOCX, change))).stdout), rejected("template_not_eligible"));
  }
  assert.deepEqual(JSON.parse((await run(launcher, [], wire(await pdf(), "application/pdf", { operation: "source-preview", offset: 0 }))).stdout), rejected("template_not_eligible"));
  const mutable = structuredClone(source.manifest), pending = preview(bytes, mutable);
  mutable.slots[0].editable = false;
  assert.equal((await pending).status, "preview");
  const controller = new AbortController(), active = preview(bytes, source.manifest, 0, controller.signal);
  assert.deepEqual(await inspect(bytes), rejected("source_unavailable"));
  assert.deepEqual(await preview(bytes, source.manifest), rejected("source_unavailable"));
  controller.abort(); assert.deepEqual(await active, rejected("source_unavailable"));
  assert.equal((await preview(bytes, source.manifest)).status, "preview");
});

test("actual DOCX parser rejects malformed XML, active archive content and excessive entry expansion", async () => {
  for (const bytes of [Buffer.from("PK-not-a-template"), docx({ extra: { "word/vbaProject.bin": Buffer.from("synthetic macro sentinel") } }),
    docx({ extra: { "word/document.xml": '<!DOCTYPE x [<!ENTITY x "unsafe">]><x/>' } }),
    docx({ extra: { "word/embeddings/oleObject1.bin": Buffer.from("synthetic OLE") } }),
    docx({ extra: { "word/oversize.xml": Buffer.alloc(5 * 1024 * 1024 + 1, 32) } })]) {
    assert.deepEqual(await inspect(bytes), rejected("template_not_eligible"));
  }
});

test("actual PDF parser rejects active, signed, interactive and malformed documents", async () => {
  const active = await pdf(1, document => document.catalog.set(PDFName.of("JavaScript"), PDFString.of("synthetic")));
  const signed = await pdf(1, document => document.catalog.set(PDFName.of("ByteRange"), document.context.obj([0, 1, 2, 3])));
  const interactive = await pdf(1, document => document.getForm().createTextField("synthetic").addToPage(document.getPage(0)));
  for (const bytes of [active, signed, interactive, Buffer.from("%PDF-1.7\nunreadable")]) {
    assert.deepEqual(await inspect(bytes, "application/pdf"), rejected("template_not_eligible"));
  }
});

test("genuine password-encrypted PDF and actual 100/101-page limits are enforced", async () => {
  assert.equal((await inspect(await pdf(100), "application/pdf")).status, "verified");
  assert.deepEqual(await inspect(await pdf(101), "application/pdf"), rejected("template_not_eligible"));
  const directory = await mkdtemp("/tmp/evo-template-encryption-");
  try {
    await writeFile(`${directory}/input.pdf`, await pdf());
    execFileSync("/usr/bin/qpdf", ["--encrypt", "synthetic-owner", "synthetic-user", "256", "--", `${directory}/input.pdf`, `${directory}/encrypted.pdf`], { env: {}, stdio: "ignore" });
    assert.deepEqual(await inspect(await readFile(`${directory}/encrypted.pdf`), "application/pdf"), rejected("template_not_eligible"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("byte bounds, SHA, MIME and closed protocol checked inside production child as well as adapter", async () => {
  const bytes = docx();
  for (const change of [{ expectedSha256: "0".repeat(64) }, { byteLength: bytes.length + 1 }, { mimeType: "image/png" }, { unexpected: true }]) {
    assert.deepEqual(JSON.parse((await run(launcher, [], wire(bytes, DOCX, change))).stdout), rejected("template_not_eligible"));
  }
  assert.deepEqual(await inspect(bytes, "application/pdf"), rejected("template_not_eligible"));
  const maximum = Buffer.alloc(20 * 1024 * 1024, 32); (await pdf()).copy(maximum);
  assert.equal((await inspect(maximum, "application/pdf")).status, "verified");
  assert.deepEqual(await inspect(Buffer.alloc(20 * 1024 * 1024 + 1)), rejected("template_not_eligible"));
  assert.deepEqual(JSON.parse((await run(launcher, [], wire(Buffer.alloc(20 * 1024 * 1024 + 1)))).stdout), rejected("template_not_eligible"));
  const original = sha(bytes), pending = inspect(bytes); bytes[0] = 0;
  assert.equal((await pending).sha256, original);
});

test("actual production bootstrap installs required TSYNC seal in every Node thread before input", async () => {
  const supervisor = spawn(launcher, [], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => supervisor.once("close", resolve)); supervisor.stdin.on("error", () => {});
  const filters = status => Number(status.match(/^Seccomp_filters:\s*(\d+)/m)?.[1]);
  try {
    const baseline = filters(await readFile(`/proc/${supervisor.pid}/status`, "utf8"));
    const pid = await childPid(supervisor); let sealed = false;
    for (let count = 0; count < 200 && !sealed; count++) {
      try {
        const maps = await readFile(`/proc/${pid}/maps`, "utf8"), threads = await readdir(`/proc/${pid}/task`);
        const statuses = await Promise.all(threads.map(tid => readFile(`/proc/${pid}/task/${tid}/status`, "utf8")));
        sealed = maps.includes(`${ROOT}/seal.node`) && threads.length > 1 && statuses.every(value => filters(value) === baseline + 2);
      } catch {}
      if (!sealed) await wait(10);
    }
    assert.equal(sealed, true);
  } finally { supervisor.kill("SIGKILL"); await closed; }
});

test("missing required addon and real kernel seal denial fail before input", async () => {
  assert.deepEqual(await readFile(`${ROOT}/bootstrap.mjs`), await readFile(`${ROOT}/missing-addon/bootstrap.mjs`));
  for (const mode of ["missing-addon", "seal-unavailable"]) {
    const supervisor = spawn(diagnostic, [mode], { env: {}, stdio: ["pipe", "pipe", "ignore"] });
    supervisor.stdin.on("error", () => {}); let output = "";
    supervisor.stdout.on("data", chunk => { output += chunk; });
    const closed = new Promise(resolve => supervisor.once("close", resolve));
    const timer = setTimeout(() => supervisor.kill("SIGKILL"), 3000);
    try { assert.equal(await closed, 0); assert.deepEqual(JSON.parse(output), rejected("source_unavailable")); }
    finally { clearTimeout(timer); supervisor.kill("SIGKILL"); await closed; }
  }
});

test("fcntl signalling and same-thread-group re-exec cannot escape the actual native policy", async () => {
  assert.deepEqual(JSON.parse((await run(diagnostic, ["async-signals"])).stdout), {
    probe: { ownerDenied: true, signalDenied: true, asyncDenied: true }, receivedSignals: 0,
  });
  const supervisor = spawn(diagnostic, ["thread-reexec"], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => supervisor.once("close", resolve));
  try {
    const pid = await childPid(supervisor, "evo-exec-denied");
    supervisor.kill("SIGKILL"); await closed; assert.equal(await gone(pid), true);
  } finally { supervisor.kill("SIGKILL"); await closed; }
});

test("actual OS address-space and dedicated stdout ceiling remain hard limits", async () => {
  assert.deepEqual(JSON.parse((await run(diagnostic, ["memory"])).stdout), { memory: "bounded" });
  assert.deepEqual(JSON.parse((await run(diagnostic, ["output"])).stdout), rejected("source_unavailable"));
});

test("actual CPU and independent wall-clock deadlines terminate owned diagnostic processes", async () => {
  let started = performance.now();
  const cpu = JSON.parse((await run(diagnostic, ["cpu"])).stdout);
  assert.equal(cpu.signal, 9); assert.equal(cpu.deadline, false); assert.ok(cpu.cpuMilliseconds >= 9000);
  assert.ok(performance.now() - started >= 8000); assert.ok(performance.now() - started < 17_000);
  started = performance.now();
  const wall = JSON.parse((await run(diagnostic, ["wall"])).stdout);
  assert.equal(wall.signal, 9); assert.equal(wall.deadline, true); assert.ok(wall.cpuMilliseconds < 1000);
  assert.ok(performance.now() - started >= 14_000); assert.ok(performance.now() - started < 18_000);
});

test("parent death leaves no orphan, and adapter cancellation releases its concurrency gate", async () => {
  const supervisor = spawn(diagnostic, ["wall"], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => supervisor.once("close", resolve));
  try {
    const pid = await childPid(supervisor); supervisor.kill("SIGKILL"); await closed;
    assert.equal(await gone(pid), true);
  } finally { supervisor.kill("SIGKILL"); await closed; }
  const signal = new AbortController(), pending = inspect(docx(), DOCX, signal.signal);
  assert.deepEqual(await inspect(docx()), rejected("source_unavailable"));
  assert.deepEqual(await preview(docx(), { format: "docx", slots: [{ id: "p-1", editable: true }], pageSizes: [] }), rejected("source_unavailable"));
  signal.abort(); assert.deepEqual(await pending, rejected("source_unavailable"));
  assert.equal((await inspect(docx())).status, "verified");
});
