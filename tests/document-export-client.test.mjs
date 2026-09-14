import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as client from "../src/lib/document-export-client.ts";
import * as contract from "../src/lib/document-export-artifact-contract.ts";
import * as wording from "../src/lib/v3/wording.ts";

const CASE = "10000000-0000-4000-8000-000000000001";
const PROFILE = "10000000-0000-4000-8000-000000000002";
const REQUEST = "10000000-0000-4000-8000-000000000003";
const ARTIFACT = "10000000-0000-4000-8000-000000000004";
const HASH = "a".repeat(64);
const DATA = new Uint8Array([80, 75, 3, 4]); // Synthetic transport bytes, not a rendered DOCX acceptance.
const command = Object.freeze({ mode: "final", expected_workspace_revision: HASH, request_id: REQUEST });
function artifact(changes = {}) {
  return {
    id: ARTIFACT, student_case_id: CASE, student_profile_id: PROFILE, profile_revision: 1,
    workspace_revision: HASH, input_snapshot_sha256: HASH, field_reviews_sha256: HASH,
    kind: "student_profile", mode: "final", state: "ready", template_sha256: contract.DOCUMENT_EXPORT_TEMPLATE_SHA256,
    renderer_version: contract.DOCUMENT_EXPORT_RENDERER_VERSION, created_at: "2026-09-13T10:00:00Z", ready_at: "2026-09-13T10:00:01Z",
    output_sha256: createHash("sha256").update(DATA).digest("hex"), output_bytes: DATA.byteLength,
    mime_type: contract.DOCUMENT_EXPORT_MIME, receipt_id: REQUEST, failure_code: null, historical: false, can_download: true, ...changes,
  };
}
function workspace(artifacts = []) {
  return { schema_version: 1, student_case_id: CASE, profile: { id: PROFILE, revision: 1 }, workspace_revision: HASH,
    can_export: true, artifacts };
}
function pending(changes = {}) {
  return artifact({ state: "pending", ready_at: null, output_sha256: null, output_bytes: null, receipt_id: null, can_download: false, ...changes });
}

test("cold workspace loads only the current session's exact case and preserves historical saved files", async t => {
  const data = workspace([artifact({ historical: true })]);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, `/api/v3/student-cases/${CASE}/document-exports`);
    assert.equal(options.method, "GET"); assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store");
    assert.equal(options.body, undefined);
    return Response.json(data);
  });
  assert.deepEqual(await client.readDocumentExportWorkspace(CASE), { status: "loaded", workspace: data });
  assert.equal(calls, 1);
  assert.equal(client.documentExportWorkspaceMatches(data, CASE, data.profile), true);
  assert.equal(client.documentExportWorkspaceMatches(data, CASE, { ...data.profile, revision: 2 }), false);
  assert.equal(client.documentExportWorkspaceMatches({ ...data, can_export: false }, CASE, data.profile), false);
});

test("an ambiguous create has one request only; explicit replay preserves the exact immutable command", async t => {
  const calls = [];
  let downloads = 0;
  t.mock.method(globalThis.crypto, "randomUUID", () => { throw new Error("Transport cannot invent a new command"); });
  t.mock.method(URL, "createObjectURL", () => { downloads++; throw new Error("Create must not download"); });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error("Synthetic lost response");
    return Response.json({ artifact: artifact() });
  });
  const unknown = await client.createDocumentExport(CASE, command);
  assert.deepEqual(unknown, { status: "export_unavailable", uncertain: true, artifact: null });
  assert.equal(calls.length, 1);
  assert.deepEqual(await client.createDocumentExport(CASE, command), { status: "received", uncertain: false, artifact: artifact() });
  assert.equal(calls.length, 2); assert.equal(calls[0].options.body, calls[1].options.body);
  for (const { url, options } of calls) {
    assert.equal(url, `/api/v3/student-cases/${CASE}/document-exports`);
    assert.equal(options.method, "POST"); assert.equal(options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(options.body), command);
  }
  assert.equal(downloads, 0);
});

test("known pending and failed receipts retain their artifact identity, including non-success HTTP", async t => {
  for (const [status, saved] of [[202, pending()], [202, pending({ state: "unknown" })], [503, pending({ state: "failed", failure_code: "storage_unavailable" })]]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ artifact: saved }, { status }));
    assert.deepEqual(await client.createDocumentExport(CASE, command), { status: "received", uncertain: false, artifact: saved });
  }
});

test("explicit reconciliation binds known artifact and preserves its request on unknown outcome", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ error: "export_unavailable" }, { status: 503 }) : Response.json({ artifact: artifact() });
  });
  assert.equal((await client.reconcileDocumentExport(CASE, ARTIFACT, REQUEST)).uncertain, true);
  assert.equal(calls.length, 1);
  assert.equal((await client.reconcileDocumentExport(CASE, ARTIFACT, REQUEST)).artifact.id, ARTIFACT);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal(calls[0].url, `/api/v3/student-cases/${CASE}/document-exports/${ARTIFACT}/reconcile`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { request_id: REQUEST });
});

test("safe fixed errors distinguish definite rejection from unconfirmed creation without leaking raw data", async t => {
  for (const [status, error, uncertain] of [[401, "authentication_required", false], [403, "forbidden", false],
    [409, "source_changed", false], [409, "artifact_pending", true], [409, "request_conflict", false], [503, "export_unavailable", true]]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error }, { status }); });
    assert.deepEqual(await client.createDocumentExport(CASE, command), { status: error, uncertain, artifact: null });
    assert.equal(calls, 1); assert.ok(wording.studentProfileFileMessage(error));
  }
  for (const value of [{ error: "PRIVATE_DETAIL" }, { artifact: { ...artifact(), private_source: "PRIVATE_DETAIL" } },
    { artifact: artifact({ workspace_revision: "b".repeat(64) }) }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(value));
    assert.deepEqual(await client.createDocumentExport(CASE, command), { status: "export_unavailable", uncertain: true, artifact: null });
  }
  assert.equal(wording.studentProfileFileMessage("PRIVATE_DETAIL"), null);
});

test("repeat downloads GET identical saved bytes, verify receipt hash and never call create", async t => {
  const calls = []; const blobs = []; const revoked = [];
  let clicks = 0; let removed = 0;
  const anchor = { href: "", download: "", click() { clicks++; }, remove() { removed++; } };
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body: { appendChild(value) { assert.equal(value, anchor); } }, createElement(tag) { assert.equal(tag, "a"); return anchor; },
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", blob => { blobs.push(blob); return "blob:synthetic-export"; });
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  t.mock.method(globalThis, "setTimeout", callback => { callback(); return 0; });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(DATA, { headers: { "content-type": contract.DOCUMENT_EXPORT_MIME, "content-length": String(DATA.length) } });
  });
  for (let i = 0; i < 2; i++) assert.equal(await client.downloadDocumentExport(CASE, artifact({ historical: true })), "downloaded");
  assert.equal(calls.length, 2); assert.equal(clicks, 2); assert.equal(removed, 2);
  for (const call of calls) {
    assert.equal(call.url, `/api/v3/student-cases/${CASE}/document-exports/${ARTIFACT}/download`);
    assert.equal(call.options.method, "GET"); assert.equal(call.options.body, undefined);
  }
  assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()), DATA);
  assert.deepEqual(new Uint8Array(await blobs[1].arrayBuffer()), DATA);
  assert.deepEqual(revoked, ["blob:synthetic-export", "blob:synthetic-export"]);
});

test("incomplete, unauthorized, mismatching or JSON download responses never trigger a browser file", async t => {
  let calls = 0; let downloads = 0;
  t.mock.method(URL, "createObjectURL", () => { downloads++; throw new Error("Unexpected file"); });
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: "forbidden" }, { status: 403 }); });
  assert.equal(await client.downloadDocumentExport(CASE, artifact({ can_download: false })), "forbidden");
  assert.equal(await client.downloadDocumentExport(CASE, pending()), "forbidden");
  assert.equal(calls, 0);
  assert.equal(await client.downloadDocumentExport(CASE, artifact()), "forbidden");
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": contract.DOCUMENT_EXPORT_MIME } }));
  assert.equal(await client.downloadDocumentExport(CASE, artifact()), "integrity_failed");
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "not a file" }));
  assert.equal(await client.downloadDocumentExport(CASE, artifact()), "integrity_failed");
  assert.equal(downloads, 0);
});

test("receipt updates keep one row per artifact and preserve older immutable files", () => {
  const older = artifact({ id: "10000000-0000-4000-8000-000000000005", created_at: "2026-09-12T10:00:00Z", historical: true });
  const updated = client.updateDocumentExportHistory(workspace([pending(), older]), artifact());
  assert.deepEqual(updated.artifacts, [artifact(), older]);
  assert.deepEqual(client.updateDocumentExportHistory(updated, artifact()), updated);
});

test("receiving a new export does not silently discard older history rows", () => {
  const older = Array.from({ length: 101 }, (_, i) => artifact({
    id: `10000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
    created_at: "2026-09-12T10:00:00Z", historical: true,
  }));
  const updated = client.updateDocumentExportHistory(workspace(older), artifact());
  assert.equal(updated.artifacts.length, 102);
  assert.deepEqual(new Set(updated.artifacts.map(row => row.id)), new Set([ARTIFACT, ...older.map(row => row.id)]));
});

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, resolve = require) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const disclosure = compile("src/components/v3/settings/StaffDisclosure.tsx");
const formPanel = compile("src/components/v3/profile/UniversityFormExportPanel.tsx", id => {
  if (id === "@/lib/document-export-client") return client;
  if (id === "@/lib/v3/wording") return wording;
  return require(id);
});
const ui = compile("src/components/v3/profile/StudentProfileExportHistory.tsx", id => {
  if (id === "@/lib/document-export-client") return client;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "../settings/StaffDisclosure") return disclosure;
  if (id === "./UniversityFormExportPanel") return formPanel;
  return require(id);
});
const noAction = () => { throw new Error("SSR markup proof does not execute a command"); };
test("actual saved-history SSR shows historical/current modes, explicit download/reconcile and no raw keys", () => {
  const html = renderToStaticMarkup(createElement(ui.StudentProfileExportList, {
    artifacts: [artifact({ historical: true }), pending({ id: REQUEST, mode: "draft" })], busy: false,
    uncertainReconciles: [REQUEST], onDownload: noAction, onReconcile: noAction,
  }));
  for (const label of ["Сохранённые файлы", "Предыдущая версия анкеты", "Текущая версия анкеты", "Скачать файл", "Повторить проверку", "Черновик"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /stored_unverified|workspace_revision|input_snapshot|10000000|aaaaaaaaaaaa/);
  assert.match(html, /min-h-11/);
});
test("actual empty/busy history SSR and shared editor guard remain explicit; no polling is introduced", () => {
  const empty = renderToStaticMarkup(createElement(ui.StudentProfileExportList, {
    artifacts: [], busy: false, uncertainReconciles: [], onDownload: noAction, onReconcile: noAction,
  }));
  assert.ok(empty.includes(wording.studentProfileFiles.empty));
  const busy = renderToStaticMarkup(createElement(ui.StudentProfileExportList, {
    artifacts: [artifact(), pending({ id: REQUEST })], busy: true, uncertainReconciles: [], onDownload: noAction, onReconcile: noAction,
  }));
  assert.match(busy, /<button[^>]*disabled=""[^>]*>Скачать файл/);
  assert.match(busy, /<button[^>]*disabled=""[^>]*>Проверить сохранение/);
  const source = read("src/components/v3/profile/StudentProfileExportHistory.tsx");
  assert.doesNotMatch(source, /setInterval|setTimeout|localStorage|sessionStorage|profile-exports/);
  assert.match(source, /execute\(unresolvedCommand.command\)/);
  assert.match(source, /unresolvedCommand.studentCaseId !== studentCaseId/);
  assert.match(source, /reconcileRequests.current.get\(artifact.id\) \?\? crypto.randomUUID\(\)/);
  assert.match(source, /commandInFlightRef.current = true/);
  assert.match(read("src/components/v3/profile/StudentProfileFields.tsx"), /commandInFlightRef=\{commandInFlight\}/);
});
