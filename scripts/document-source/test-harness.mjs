import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm, access, stat } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { inspectDocumentSource } from "./adapter.mjs";

const launcher = "/opt/evo-document-runtime/launcher";
const diagnostic = "/opt/evo-document-runtime/launcher.test";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const inspect = (bytes, mimeType, signal = new AbortController().signal) => inspectDocumentSource({ bytes, mimeType, expectedSha256: sha(bytes) }, { signal });
const rejected = code => ({ status: "rejected", code });
async function pdf(pages = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage([300, 400]);
  return Buffer.from(await document.save());
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
function wire(bytes, mimeType) { return Buffer.concat([Buffer.from(`${JSON.stringify({ byteLength: bytes.length, expectedSha256: sha(bytes), mimeType })}\n`), bytes]); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("real image context, fixed production entrypoint and actual Landlock/seccomp/limits", async () => {
  assert.equal(process.platform, "linux"); assert.equal(process.version, "v22.23.1"); assert.equal(process.getuid(), 1001);
  for (const path of [launcher, "/opt/evo-document-runtime/inspect.mjs", "/opt/evo-document-runtime/node_modules/sharp/package.json"]) {
    const info = await stat(path); assert.equal(info.uid, 0); assert.equal(info.mode & 0o022, 0);
  }
  await writeFile("/tmp/evo-document-outside", "synthetic-outside-sentinel", { mode: 0o644 });
  const result = await run(diagnostic, ["policy"], null, { EVO_DOCUMENT_TEST_SECRET: "synthetic-environment-sentinel" });
  assert.equal(result.code, 0); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { policy: "enforced", memory: 2147483648, cpu: 10, fd: 64 });
  assert.equal((await run(launcher, ["policy"])).code, 64);
});

test("actual production inspector verifies complete synthetic PDF/JPEG/PNG with exact receipt", async () => {
  const samples = [[await pdf(2), "application/pdf", 2],
    [await sharp({ create: { width: 80, height: 50, channels: 3, background: "white" } }).jpeg().toBuffer(), "image/jpeg", 1],
    [await sharp({ create: { width: 80, height: 50, channels: 4, background: "white" } }).png().toBuffer(), "image/png", 1]];
  for (const [bytes, mimeType, pageCount] of samples) {
    const result = await inspect(bytes, mimeType);
    assert.deepEqual(result, { status: "verified", sha256: sha(bytes), byteLength: bytes.length, mimeType, pageCount, policyVersion: "document-source-v1" });
  }
});

test("PDF page ceiling and genuine password-encrypted PDF are checked inside the sandbox", async () => {
  assert.equal((await inspect(await pdf(20), "application/pdf")).status, "verified");
  assert.deepEqual(await inspect(await pdf(21), "application/pdf"), rejected("document_not_eligible"));
  const directory = await mkdtemp("/tmp/evo-document-encryption-");
  try {
    await writeFile(`${directory}/input.pdf`, await pdf());
    execFileSync("/usr/bin/qpdf", ["--encrypt", "synthetic-owner", "synthetic-user", "256", "--", `${directory}/input.pdf`, `${directory}/encrypted.pdf`], { env: {}, stdio: "ignore" });
    assert.deepEqual(await inspect(await readFile(`${directory}/encrypted.pdf`), "application/pdf"), rejected("document_not_eligible"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("image limits require full decoding and reject unreadable or mismatched input", async () => {
  for (const [width, height] of [[20_001, 1], [7000, 6000]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
    assert.deepEqual(await inspect(bytes, "image/png"), rejected("document_not_eligible"));
  }
  const boundary = await sharp({ create: { width: 20_000, height: 2000, channels: 3, background: "white" } }).png().toBuffer();
  assert.equal((await inspect(boundary, "image/png")).status, "verified");
  const jpeg = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).jpeg().toBuffer();
  assert.deepEqual(await inspect(jpeg.subarray(0, Math.floor(jpeg.length / 2)), "image/jpeg"), rejected("document_not_eligible"));
  assert.deepEqual(await inspect(jpeg, "image/png"), rejected("document_not_eligible"));
  assert.deepEqual(await inspect(Buffer.from("%PDF-1.7\nunreadable"), "application/pdf"), rejected("document_not_eligible"));
});

test("byte/hash bounds are checked at both boundaries, and caller mutation cannot replace captured bytes", async () => {
  const maximum = Buffer.alloc(25 * 1024 * 1024, 32); (await pdf()).copy(maximum);
  const maximumResult = await inspect(maximum, "application/pdf");
  assert.equal(maximumResult.status, "verified"); assert.equal(maximumResult.byteLength, maximum.length);
  const bytes = await pdf(), originalHash = sha(bytes);
  const result = inspect(bytes, "application/pdf"); bytes[0] = 0;
  assert.equal((await result).sha256, originalHash);
  assert.deepEqual(await inspect(Buffer.alloc(25 * 1024 * 1024 + 1), "application/pdf"), rejected("document_not_eligible"));
  assert.deepEqual(await inspectDocumentSource({ bytes: await pdf(), mimeType: "application/pdf", expectedSha256: "0".repeat(64) }, { signal: new AbortController().signal }), rejected("document_not_eligible"));
  const altered = wire(await pdf(), "application/pdf"); altered[altered.length - 1] ^= 1;
  assert.deepEqual(JSON.parse((await run(launcher, [], altered)).stdout), rejected("document_not_eligible"));
});

test("real OS address-space limit and stdout ceiling are enforced", async () => {
  assert.deepEqual(JSON.parse((await run(diagnostic, ["memory"])).stdout), { memory: "bounded" });
  assert.deepEqual(JSON.parse((await run(diagnostic, ["output"])).stdout), rejected("source_unavailable"));
});

test("CPU and independent wall-clock limits actually terminate bounded diagnostic processes", async () => {
  let started = performance.now();
  const cpu = JSON.parse((await run(diagnostic, ["cpu"])).stdout);
  assert.equal(cpu.signal, 9); assert.equal(cpu.deadline, false); assert.ok(cpu.cpuMilliseconds >= 9000);
  assert.ok(performance.now() - started >= 8000); assert.ok(performance.now() - started < 17_000);
  started = performance.now();
  const wall = JSON.parse((await run(diagnostic, ["wall"])).stdout);
  assert.equal(wall.signal, 9); assert.equal(wall.deadline, true); assert.ok(wall.cpuMilliseconds < 1000);
  assert.ok(performance.now() - started >= 14_000); assert.ok(performance.now() - started < 18_000);
});

test("parent death kills the inspector; actual adapter abort releases concurrency without success", async () => {
  const child = spawn(diagnostic, ["wall"], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => child.once("close", resolve));
  let children = "";
  for (let count = 0; count < 100 && !children; count++) {
    try { children = (await readFile(`/proc/${child.pid}/task/${child.pid}/children`, "utf8")).trim(); } catch {}
    if (!children) await wait(10);
  }
  assert.match(children, /^\d+$/); child.kill("SIGKILL"); await closed;
  let gone = false;
  for (let count = 0; count < 100; count++) {
    try { await access(`/proc/${children}`); } catch { gone = true; break; }
    await wait(10);
  }
  assert.equal(gone, true, "no orphan inspector process survives supervisor death");
  const signal = new AbortController(), pending = inspect(await pdf(20), "application/pdf", signal.signal);
  signal.abort(); assert.deepEqual(await pending, rejected("source_unavailable"));
  assert.equal((await inspect(await pdf(), "application/pdf")).status, "verified");
});
