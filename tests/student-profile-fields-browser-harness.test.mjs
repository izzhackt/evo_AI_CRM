import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import PizZip from "pizzip";
import { captureProfileExportResponse, profileBodyTransportCategory, profileBodyProtocolMethod, profileRequestFailureCategory, profileBodyTransportDiagnosticLine, profileBrowserRuntimeDiagnostic, profileBrowserRuntimeDiagnosticLine, localOrigin, proofExceptionCategory, proofPathClass, proofLoginErrorCode, writeFailureEvidence, summarizeStudentProfileAppLog, verifyDocumentExportBucket, verifyStoredDocumentExport, SYNTHETIC_EXPECTED_VALUES, SYNTHETIC_REQUIRED_VALUES } from "../scripts/lib/student-profile-fields-browser-proof.mjs";
import { verifyPersistedPackageZip, verifyPackageStorage } from "../scripts/lib/document-package-browser-proof.mjs";
import { safeProfileTransportLifecycle, profileTransportLifecycleDiagnosticLine, observeProfileTransportLifecycle } from "../scripts/lib/student-profile-fields-browser-proof.mjs";
import { profileExportUiState } from "../scripts/lib/student-profile-fields-browser-proof.mjs";
import { studentProfileFileMessage } from "../src/lib/v3/wording.ts";
import { PROFILE_FIELDS, PROFILE_REQUIRED_FIELD_KEYS } from "../src/lib/student-profile-fields.ts";
import { DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_EXPORT_MIME, DOCUMENT_EXPORT_TEMPLATE_SHA256, DOCUMENT_PACKAGE_MAX_BYTES, DOCUMENT_PACKAGE_MIME } from "../src/lib/document-export-artifact-contract.ts";

const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
const runnerUrl = new URL("../scripts/lib/student-profile-fields-browser-proof.mjs", import.meta.url);
const captureEvents = ["requestfinished", "requestfailed", "framenavigated"];
function capturePage(overrides) {
  const frame = {};
  return Object.assign(new EventEmitter(), { mainFrame: () => frame, isClosed: () => false,
    context: () => ({ browser: () => ({ isConnected: () => true }) }), ...overrides });
}
function assertCaptureListenersRemoved(page) {
  for (const event of captureEvents) assert.equal(page.listenerCount(event), 0, event);
}

test("transport lifecycle projects bounded enums and rejects coercible/private fields", () => {
  const event = { ms: 12, event: "POST_FAILED", phase: "DRAFT", detail: null };
  const value = { schema: "evo-profile-transport-lifecycle/v1", events: [event], droppedEvents: 0,
    ignoredHmrFrames: 1, serverLogAvailable: true, serverCategories: ["ECONNRESET"] };
  assert.deepEqual(safeProfileTransportLifecycle({ ...value, raw: "private-value", url: "https://example.test/private",
    events: [{ ...event, raw: "private-value" }], serverCategories: ["ECONNRESET", ["ABORTED"], "private-value"] }), value);
  for (const patch of [{ event: ["POST_FAILED"] }, { phase: ["DRAFT"] }, { ms: "12" }, { ms: -1 },
    { ms: Infinity }, { detail: "private-value" }, { event: "HMR_FRAME", detail: ["reloadPage"] },
    { event: "HMR_FRAME", detail: null }]) {
    assert.equal(safeProfileTransportLifecycle({ ...value, events: [{ ...event, ...patch }] }), null);
  }
  for (const invalid of [null, [], {}, { ...value, schema: [value.schema] }, { ...value, droppedEvents: "0" },
    { ...value, ignoredHmrFrames: -1 }, { ...value, serverLogAvailable: "true" }, { ...value, serverCategories: {} }]) {
    assert.equal(profileTransportLifecycleDiagnosticLine(invalid), "STUDENT_PROFILE_FIELDS_TRANSPORT_LIFECYCLE:UNAVAILABLE");
  }
  const bounded = safeProfileTransportLifecycle({ ...value, events: Array(270).fill(event) });
  assert.equal(bounded.events.length, 256); assert.equal(bounded.droppedEvents, 14);
  assert.equal(safeProfileTransportLifecycle({ ...value, droppedEvents: Number.MAX_SAFE_INTEGER, events: Array(270).fill(event) }), null);
  assert.doesNotMatch(profileTransportLifecycleDiagnosticLine({ ...value, raw: "private-value" }), /private-value/u);
});

test("passive lifecycle observer follows exact request identity and disposes all listeners", async () => {
  // Unit boundary only: no simulated browser/provider success is acceptance.
  const page = capturePage({});
  const socket = Object.assign(new EventEmitter(), { url: () => "ws://127.0.0.1:43210/_next/hmr?private-value" });
  const exportUrl = "http://127.0.0.1:43210/export";
  const request = { url: () => exportUrl, method: () => "POST", isNavigationRequest: () => false };
  const observer = await observeProfileTransportLifecycle(page, exportUrl, () => "DRAFT_GENERATE_POST_RESPONSE");
  page.emit("request", { ...request, method: () => "GET" });
  page.emit("response", { request: () => request });
  assert.equal(observer.snapshot().events.length, 0);
  page.emit("request", request); page.emit("response", { request: () => request });
  page.emit("requestfailed", { ...request }); // Same URL, not the same captured request.
  page.emit("requestfailed", request);
  page.emit("request", { ...request, method: () => "GET", isNavigationRequest: () => true, frame: () => page.mainFrame() });
  page.emit("websocket", socket);
  for (const sessionId of ["private-one", "private-two"]) socket.emit("framereceived", {
    payload: JSON.stringify({ type: "turbopack-connected", data: { sessionId }, raw: "private-value" }) });
  socket.emit("framereceived", { payload: JSON.stringify({ type: ["reloadPage"], raw: "private-value" }) });
  socket.emit("framereceived", { payload: Buffer.from("private-value") });
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.events.map(item => item.event), ["POST_START", "POST_RESPONSE", "POST_FAILED",
    "NAVIGATION_START", "HMR_OPEN", "HMR_FRAME", "HMR_FRAME", "HMR_SESSION_CHANGED"]);
  assert.equal(snapshot.ignoredHmrFrames, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|127\.0\.0\.1|sessionId/u);
  observer.dispose();
  assert.deepEqual(page.eventNames(), []); assert.deepEqual(socket.eventNames(), []);
  page.emit("request", request);
  assert.deepEqual(observer.snapshot(), snapshot);
});

test("opt-in lifecycle CI output reprojects private file and preserves command and fatal gates", () => {
  const directory = mkdtempSync(join(tmpdir(), "evo-profile-lifecycle-unit-"));
  try {
    const value = { schema: "evo-profile-transport-lifecycle/v1", events: [{ ms: 1, event: "POST_FAILED", phase: "DRAFT", detail: null }],
      droppedEvents: 0, ignoredHmrFrames: 0, serverLogAvailable: false, serverCategories: [] };
    writeFileSync(join(directory, "transport-lifecycle.json"), JSON.stringify({ ...value, raw: "private-value" }));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", runnerUrl.pathname, "--print-transport-lifecycle-diagnostic"],
      { encoding: "utf8", env: { ...process.env, EVO_D2_EVIDENCE_DIR: directory } });
    assert.equal(result.status, 0); assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(profileTransportLifecycleDiagnosticLine(value)));
    assert.doesNotMatch(result.stderr, /private-value/u);
    const runner = readFileSync(runnerUrl, "utf8");
    assert.match(runner, /if \(process\.env\.EVO_D2_TRANSPORT_LIFECYCLE_DIAGNOSTIC === "1"\) transportLifecycle = await observeProfileTransportLifecycle/u);
    assert.match(harness, /if \[\[ "\$\{EVO_D2_TRANSPORT_LIFECYCLE_DIAGNOSTIC:-0\}" == "1" \]\]/u);
    assert.ok(harness.includes('fail "The bounded real Student Profile browser proof failed; no live business acceptance is implied"'));
    const workflow = readFileSync(new URL("../.github/workflows/evo-platform-ci.yml", import.meta.url), "utf8");
    assert.equal((workflow.match(/EVO_D2_TRANSPORT_LIFECYCLE_DIAGNOSTIC:/gu) ?? []).length, 1);
    assert.match(workflow, /timeout-minutes: 35\n        env:\n          EVO_D2_TRANSPORT_LIFECYCLE_DIAGNOSTIC: "1"\n        run: npm run test:database:local/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("profile response capture reads the same POST body before a deferred click completes", async () => {
  // This verifies orchestration at the Playwright boundary, not a Chromium race.
  const exportUrl = "http://127.0.0.1:43210/export";
  let finishClick, bodyReads = 0, clicks = 0, waits = 0, settled = false;
  const clickPending = new Promise(resolve => { finishClick = resolve; });
  const body = { artifact: { id: "unit-only" } };
  const response = { url: () => exportUrl, request: () => ({ method: () => "POST" }), status: () => 200,
    body: async () => { bodyReads++; return Buffer.from(JSON.stringify(body)); },
    json: async () => { bodyReads++; return body; } };
  const stages = [];
  const page = capturePage({ waitForResponse: async predicate => {
    waits++;
    assert.equal(predicate({ ...response, url: () => `${exportUrl}/other` }), false);
    assert.equal(predicate({ ...response, request: () => ({ method: () => "GET" }) }), false);
    assert.equal(predicate(response), true);
    return response;
  } });
  const pending = captureProfileExportResponse(page, { click: () => { clicks++; return clickPending; } }, exportUrl, stage => stages.push(stage));
  pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bodyReads, 1, "capture must not await click completion before reading the body");
    assert.equal(settled, false, "capture must still await the original click");
    assert.deepEqual(stages, ["RESPONSE_BODY_READ"]);
  } finally { finishClick(); }
  assert.deepEqual(await pending, { response, body });
  assert.equal(waits, 1); assert.equal(clicks, 1); assert.equal(bodyReads, 1);
  assertCaptureListenersRemoved(page);
});

test("profile response capture preserves strict status and envelope checks with safe body failures", async () => {
  const cases = [
    { status: 202, text: '{"artifact":{}}', code: "PERSISTENT_EXPORT_NOT_READY", reads: 0 },
    { text: "null", code: "PERSISTENT_RESPONSE_INVALID" },
    { text: "[]", code: "PERSISTENT_RESPONSE_INVALID" },
    { text: "[{}]", code: "PERSISTENT_RESPONSE_INVALID" },
    { text: "{}", code: "PERSISTENT_RESPONSE_INVALID" },
    { text: '"artifact"', code: "PERSISTENT_RESPONSE_INVALID" },
    { text: '{"artifact":{},"extra":"private-sentinel"}', code: "PERSISTENT_RESPONSE_INVALID" },
    { text: "", code: "BODY_INVALID_JSON" },
    { text: "private-sentinel", code: "BODY_INVALID_JSON" },
    { transport: true, code: "BODY_TRANSPORT" },
  ];
  for (const item of cases) {
    let reads = 0;
    const stages = [];
    const page = capturePage({ waitForResponse: async () => ({
      status: () => item.status ?? 200,
      request: () => ({ failure: () => null }),
      body: async () => { reads++; if (item.transport) throw new Error("private-sentinel"); return Buffer.from(item.text); },
    }) });
    await assert.rejects(captureProfileExportResponse(page, { click: async () => {} }, "http://127.0.0.1:43210/export", stage => stages.push(stage)), error => {
      assert.equal(error.code, item.code); assert.equal(error.message, item.code);
      assert.equal(Object.hasOwn(error, "cause"), false);
      return true;
    });
    assert.equal(reads, item.reads ?? 1);
    if (item.code.startsWith("BODY_")) assert.deepEqual(stages, ["RESPONSE_BODY_READ", item.code]);
    assertCaptureListenersRemoved(page);
  }
  const clickError = new Error("unit click failure");
  const page = capturePage({ waitForResponse: async () => ({
    status: () => 200, body: async () => Buffer.from('{"artifact":{}}'),
  }) });
  await assert.rejects(captureProfileExportResponse(page, { click: async () => { throw clickError; } }, "http://127.0.0.1:43210/export", () => {}), error => error === clickError);
  assertCaptureListenersRemoved(page);
});

test("body transport classification retains only static categories", () => {
  const cases = [
    ["Protocol error (Network.getResponseBody): No resource with given identifier found", "RESOURCE_MISSING"],
    ["Missing content of resource for given requestId", "RESOURCE_MISSING"],
    ["Protocol error (Network.getResponseBody): No data found for resource with given identifier", "RESOURCE_DATA_MISSING"],
    ["Request content was evicted from inspector cache", "RESOURCE_EVICTED"],
    ["Target page, context or browser has been closed", "TARGET_OR_SESSION_CLOSED"],
    ["Protocol error: Session closed", "TARGET_OR_SESSION_CLOSED"],
    ["net::ERR_ABORTED", "REQUEST_ABORTED"],
    ["Response body is unavailable for redirect responses", "REDIRECT_BODY_UNAVAILABLE"],
    ["Protocol error (Network.getResponseBody): unknown", "OTHER_PROTOCOL_ERROR"],
    ["private-value https://example.test/secret", "OTHER_BODY_ERROR"],
  ];
  for (const [message, category] of cases) assert.equal(profileBodyTransportCategory(new Error(message)), category);
  for (const error of [null, undefined, "private-value", {}, { message: ["net::ERR_ABORTED"] }]) {
    assert.equal(profileBodyTransportCategory(error), "OTHER_BODY_ERROR");
    assert.equal(profileBodyProtocolMethod(error), "NONE");
  }
  for (const method of ["Network.getResponseBody", "Network.loadNetworkResource", "IO.read", "IO.close"]) {
    assert.equal(profileBodyProtocolMethod(new Error(`Protocol error (${method}): private-value https://example.test/private`)), method);
  }
  assert.equal(profileBodyProtocolMethod(new Error("Protocol error (private-value): private-value")), "OTHER");
  assert.equal(profileRequestFailureCategory(null), "NONE");
  for (const code of ["ERR_ABORTED", "ERR_CONTENT_LENGTH_MISMATCH", "ERR_INCOMPLETE_CHUNKED_ENCODING", "ERR_CONNECTION_RESET",
    "ERR_BLOCKED_BY_ORB", "ERR_INSUFFICIENT_RESOURCES", "ERR_FAILED", "ERR_RESPONSE_HEADERS_TRUNCATED"]) {
    assert.equal(profileRequestFailureCategory({ errorText: `net::${code}` }), code);
  }
  for (const failure of [undefined, {}, [], { errorText: ["net::ERR_ABORTED"] }, { errorText: {} },
    { errorText: "net::ERR_ABORTED private-value" }, { errorText: "private-value https://example.test/private" }]) {
    assert.equal(profileRequestFailureCategory(failure), "OTHER");
  }
});

test("body transport evidence tracks the exact response request and removes listeners", async () => {
  for (const primaryEvent of ["requestfinished", "requestfailed"]) {
    let failureReads = 0, unrelatedFailureReads = 0;
    const request = { failure: () => { failureReads++; return primaryEvent === "requestfailed" ? { errorText: "net::ERR_CONTENT_LENGTH_MISMATCH" } : null; } };
    const unrelatedRequest = { failure: () => { unrelatedFailureReads++; return { errorText: "net::ERR_ABORTED" }; } };
    const page = capturePage({ waitForResponse: async () => ({ status: () => 200, request: () => request,
      body: async () => {
        page.emit("requestfinished", unrelatedRequest); page.emit("requestfailed", unrelatedRequest);
        page.emit(primaryEvent, request);
        page.emit("framenavigated", {}); page.emit("framenavigated", page.mainFrame());
        throw new Error("Protocol error (Network.getResponseBody): No resource with given identifier found private-value");
      } }) });
    await assert.rejects(captureProfileExportResponse(page, { click: async () => {} }, "http://127.0.0.1:43210/export", () => {}), error => {
      assert.equal(error.code, "BODY_TRANSPORT");
      assert.equal(error.message, "BODY_TRANSPORT");
      assert.equal(Object.hasOwn(error, "cause"), false);
      assert.deepEqual(error.transportDiagnostic, { category: "RESOURCE_MISSING", protocolMethod: "Network.getResponseBody",
        requestFailure: primaryEvent === "requestfailed" ? "ERR_CONTENT_LENGTH_MISMATCH" : "NONE", requestFinished: primaryEvent === "requestfinished",
        requestFailed: primaryEvent === "requestfailed", mainFrameNavigations: 1, pageAlive: true, browserAlive: true });
      assert.doesNotMatch(JSON.stringify(error), /private-value/u);
      return true;
    });
    assert.equal(failureReads, 1); assert.equal(unrelatedFailureReads, 0);
    assertCaptureListenersRemoved(page);
  }
  const page = capturePage({ waitForResponse: async () => { throw new Error("wait failure"); } });
  await assert.rejects(captureProfileExportResponse(page, { click: async () => {} }, "http://127.0.0.1:43210/export", () => {}), /wait failure/u);
  assertCaptureListenersRemoved(page);
});

test("export UI diagnostic classifies only exact product status wording", () => {
  for (const state of ["ready", "unknown", "creating"]) {
    const message = studentProfileFileMessage(state);
    assert.equal(typeof message, "string");
    assert.equal(profileExportUiState([message]), state.toUpperCase());
    assert.equal(profileExportUiState([`${message} private-value`]), "OTHER");
  }
  assert.equal(profileExportUiState([]), "ABSENT");
  for (const message of ["", "private-value", "READY", studentProfileFileMessage("loading")]) {
    assert.equal(profileExportUiState([message]), "OTHER");
  }
  for (const invalid of [null, undefined, {}, "private-value", [null], [{}], ["one", "two"]]) {
    assert.equal(profileExportUiState(invalid), "UNAVAILABLE");
  }
});

test("body transport CI printer strictly projects safe JSON and rejects malformed fields", async () => {
  const transportDiagnostic = { category: "RESOURCE_MISSING", protocolMethod: "Network.getResponseBody", requestFailure: "NONE", requestFinished: true, requestFailed: false,
    mainFrameNavigations: 0, pageAlive: true, browserAlive: true };
  const snapshot = { schema: "evo-student-profile-browser-failure/v1", stage: "DRAFT_BODY_TRANSPORT",
    exceptionCategory: "PROOF_ASSERTION", transportDiagnostic };
  const expected = `STUDENT_PROFILE_FIELDS_BODY_TRANSPORT_DIAGNOSTIC:${JSON.stringify({ stage: snapshot.stage, ...transportDiagnostic })}`;
  assert.equal(profileBodyTransportDiagnosticLine({ ...snapshot, rawBody: "private-value", url: "https://example.test/private",
    transportDiagnostic: { ...transportDiagnostic, message: "private-value" } }), expected);
  for (const invalid of [null, [], {}, { ...snapshot, stage: "private-value" },
    { ...snapshot, schema: "other" }, { ...snapshot, exceptionCategory: "ERROR" },
    ...[{ category: ["RESOURCE_MISSING"] }, { category: "private-value" }, { requestFinished: "true" },
      ...[undefined, null, [], {}, ["Network.getResponseBody"], "private-value"].map(protocolMethod => ({ protocolMethod })),
      ...[undefined, null, [], {}, ["ERR_ABORTED"], "private-value"].map(requestFailure => ({ requestFailure })),
      { requestFailed: null }, { pageAlive: {} }, { browserAlive: [] },
      { mainFrameNavigations: -1 }, { mainFrameNavigations: 0.5 }, { mainFrameNavigations: Infinity }]
      .map(patch => ({ ...snapshot, transportDiagnostic: { ...transportDiagnostic, ...patch } }))]) {
    assert.equal(profileBodyTransportDiagnosticLine(invalid), "STUDENT_PROFILE_FIELDS_BODY_TRANSPORT_DIAGNOSTIC:UNAVAILABLE");
  }
  const evidenceDir = mkdtempSync(join(tmpdir(), "evo-profile-transport-diagnostic-unit-"));
  try {
    const error = Object.assign(new Error("private-value"), { code: "BODY_TRANSPORT",
      transportDiagnostic: { ...transportDiagnostic, message: "private-value" } });
    await writeFailureEvidence({ config: { evidenceDir }, page: null, stage: snapshot.stage, error,
      http: {}, browserErrors: new Set(), browserWarningCount: 0, counts: { page: 0, console: 0 } });
    const persisted = readFileSync(join(evidenceDir, "failure.json"), "utf8");
    assert.deepEqual(JSON.parse(persisted).transportDiagnostic, { ...transportDiagnostic, exportUiState: "UNAVAILABLE" });
    assert.doesNotMatch(persisted, /private-value/u);
    const printedDiagnostic = { ...transportDiagnostic, exportUiState: "READY" };
    writeFileSync(join(evidenceDir, "failure.json"), JSON.stringify({ ...snapshot, rawBody: "private-value", transportDiagnostic: printedDiagnostic }));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", runnerUrl.pathname, "--print-body-transport-diagnostic"],
      { encoding: "utf8", env: { ...process.env, EVO_D2_EVIDENCE_DIR: evidenceDir } });
    assert.equal(result.status, 0); assert.equal(result.stdout, "");
    const expectedPrinted = `STUDENT_PROFILE_FIELDS_BODY_TRANSPORT_DIAGNOSTIC:${JSON.stringify({ stage: snapshot.stage, ...printedDiagnostic })}`;
    assert.match(result.stderr, new RegExp(expectedPrinted.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(result.stderr, /private-value|example\.test/u);
    assert.ok(harness.includes("--print-body-transport-diagnostic"));
  } finally { rmSync(evidenceDir, { recursive: true, force: true }); }
  for (const exportUiState of ["READY", "UNKNOWN", "CREATING", "OTHER", "ABSENT", "UNAVAILABLE"]) {
    const projected = profileBodyTransportDiagnosticLine({ ...snapshot, transportDiagnostic: { ...transportDiagnostic, exportUiState } });
    assert.equal(projected, `STUDENT_PROFILE_FIELDS_BODY_TRANSPORT_DIAGNOSTIC:${JSON.stringify({ stage: snapshot.stage, ...transportDiagnostic, exportUiState })}`);
  }
  for (const exportUiState of [undefined, null, [], {}, ["READY"], "private-value"]) {
    assert.equal(profileBodyTransportDiagnosticLine({ ...snapshot, transportDiagnostic: { ...transportDiagnostic, exportUiState } }),
      "STUDENT_PROFILE_FIELDS_BODY_TRANSPORT_DIAGNOSTIC:UNAVAILABLE");
  }
});

test("template failure evidence retains categories, never credential values or raw errors", async () => {
  for (const code of ["accessDenied", "authUnavailable", "staffAccessDenied"]) assert.equal(proofLoginErrorCode(code), code);
  for (const value of [null, undefined, {}, "private-value", "https://example.test/private", ["accessDenied"]]) assert.equal(proofLoginErrorCode(value), null);
  const diagnostic = profileBrowserRuntimeDiagnostic({ kind: "console", stage: "PACKAGE_UI_SAVE_READBACK", page: "profile_cold",
    text: 'A tree hydrated but some attributes private-value\n PreparePartnerPacketForm\n+ aria-busy="private-value"\n- disabled="private-value"',
    location: { url: "https://example.test/node_modules_next/runtime.js?token=private-value" } });
  assert.deepEqual(diagnostic, { kind: "console", category: "HYDRATION_ATTRIBUTES", stage: "PACKAGE_UI_SAVE_READBACK",
    page: "profile_cold", source: "NEXT_RUNTIME", frames: ["PreparePartnerPacketForm"], attributes: ["disabled", "aria-busy"], httpStatus: null });
  for (const [text, category] of [
    ["Hydration failed", "HYDRATION_CONTENT"], ["In HTML, <p> cannot contain a nested <div>", "HTML_NESTING"],
    ["uncontrolled input to be controlled", "CONTROLLED_INPUT"], ['unique "key" prop', "REACT_KEY"],
    ["ChunkLoadError", "CHUNK_LOAD"], ["Content Security Policy", "CSP"], ["Failed to fetch", "NETWORK"],
    ["Maximum update depth", "REACT_RENDER_LOOP"], ["Rendered fewer hooks", "REACT_HOOKS"],
    ["Failed to load resource: the server responded with a status of 403 private-value", "RESOURCE_LOAD"],
    ["private-value", "OTHER_RUNTIME_ERROR"],
  ]) {
    const result = profileBrowserRuntimeDiagnostic({ kind: "page", text, stage: "COLD_FINAL_DOWNLOAD_EVENT", page: "package_fresh" });
    assert.equal(result.category, category); assert.equal(result.stage, "COLD_FINAL_DOWNLOAD_EVENT");
    assert.equal(result.httpStatus, category === "RESOURCE_LOAD" ? 403 : null);
    assert.doesNotMatch(JSON.stringify(result), /private-value/u);
  }
  const runtimeSnapshot = { schema: "evo-student-profile-browser-failure/v1", runtimeDiagnostics: [diagnostic] };
  const expectedRuntimeLine = `STUDENT_PROFILE_FIELDS_RUNTIME_DIAGNOSTIC:${JSON.stringify([diagnostic])}`;
  assert.equal(profileBrowserRuntimeDiagnosticLine({ ...runtimeSnapshot, raw: "private-value", runtimeDiagnostics: [{ ...diagnostic,
    raw: "private-value", frames: [...diagnostic.frames, "private-value"], attributes: [...diagnostic.attributes, "private-value"] }] }), expectedRuntimeLine);
  for (const field of ["kind", "category", "source", "page"]) for (const value of [null, {}, [], [diagnostic[field]], "private-value"]) {
    assert.equal(profileBrowserRuntimeDiagnosticLine({ ...runtimeSnapshot, runtimeDiagnostics: [{ ...diagnostic, [field]: value }] }), "STUDENT_PROFILE_FIELDS_RUNTIME_DIAGNOSTIC:UNAVAILABLE");
  }
  const projected = JSON.parse(profileBrowserRuntimeDiagnosticLine({ ...runtimeSnapshot,
    runtimeDiagnostics: [{ ...diagnostic, stage: "PRIVATE_VALUE", httpStatus: "403", frames: {}, attributes: [] }] }).split("DIAGNOSTIC:")[1]);
  assert.equal(projected[0].stage, "UNAVAILABLE"); assert.equal(projected[0].httpStatus, null); assert.deepEqual(projected[0].frames, []);
  assert.equal(JSON.parse(profileBrowserRuntimeDiagnosticLine({ ...runtimeSnapshot, runtimeDiagnostics: Array(20).fill(diagnostic) }).split("DIAGNOSTIC:")[1]).length, 12);
  const evidenceDir = mkdtempSync(join(tmpdir(), "evo-template-diagnostic-unit-"));
  try {
    await writeFailureEvidence({ config: { proofKind: "university-template-ingress", evidenceDir }, page: null,
      stage: "LOGIN_SUBMIT", error: new Error("private-value"), http: { LOGIN: 200, MAIN: null },
      browserErrors: new Set(), browserWarningCount: 0, counts: { page: 0, console: 0 },
      runtimeDiagnostics: [{ ...diagnostic, raw: "private-value" }] });
    const raw = readFileSync(join(evidenceDir, "failure.json"), "utf8"), evidence = JSON.parse(raw);
    assert.equal(evidence.schema, "evo-university-template-ingress-browser-failure/v1");
    assert.equal(evidence.businessAcceptance, false); assert.equal(evidence.screenshotSaved, false);
    assert.equal(evidence.exceptionCategory, "ERROR"); assert.equal(evidence.loginErrorCode, null);
    assert.equal(evidence.loginFormPending, null); assert.doesNotMatch(raw, /private-value/u);
    assert.deepEqual(evidence.runtimeDiagnostics, [diagnostic]);
    writeFileSync(join(evidenceDir, "failure.json"), JSON.stringify({ ...runtimeSnapshot, raw: "private-value" }));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", runnerUrl.pathname, "--print-body-transport-diagnostic"],
      { encoding: "utf8", env: { ...process.env, EVO_D2_EVIDENCE_DIR: evidenceDir } });
    assert.equal(result.status, 0); assert.equal(result.stdout, ""); assert.ok(result.stderr.includes(expectedRuntimeLine));
    assert.doesNotMatch(result.stderr, /private-value|example\.test/u);
  } finally { rmSync(evidenceDir, { recursive: true, force: true }); }
});

test("profile-only acceptance waits for owned cleanup and fails closed on stop or absence-readback failure", () => {
  const newStart = harness.indexOf("student_profile_cleanup() {");
  const start = newStart < 0 ? harness.indexOf("cleanup() {") : newStart;
  const functions = harness.slice(start, harness.indexOf("\ntrap cleanup EXIT", start));
  for (const failure of ["supabase-stop", "remaining-container", "remaining-network", "remaining-volume", "container-read", "network-read", "volume-read", "original-exit", "proof-not-ready", "malformed-pending", "wrong-project", "missing-package-proof", "wrong-package-hash", "wrong-package-size", "wrong-package-count", ""]) {
    const root = mkdtempSync(join(tmpdir(), "evo-profile-cleanup-unit-"));
    try {
      const evidence = join(root, "evidence"); mkdirSync(evidence);
      const ownedTmp = join(root, "evo-database-foundation.synthetic"); mkdirSync(ownedTmp);
      const lock = join(root, "lock"); mkdirSync(lock); writeFileSync(join(lock, "pid"), "123\n");
      writeFileSync(join(evidence, "acceptance.pending.json"), JSON.stringify({
        schema: "evo-student-profile-browser-proof/v3", synthetic: true, businessAcceptance: false,
        localProjectId: "evo-local-0123456789abcdef", cleanupVerified: false, realAdminAuth: true,
        persistentArtifacts: 3, profileArtifacts: 2, packageArtifacts: 1,
        persistedPackage: { realUiPreparation: true, realUiGeneration: true, privateStorageReadback: true,
          selectedEntryBytesVerified: true, finalExcludesDraft: true, freshLoginHistorySameBytes: true,
          downloadsCreateNoArtifacts: true, sha256: "a".repeat(64), bytes: 512, selectedEntries: 1 },
        generationSeparateFromDownload: true, exactRequestReplayWithoutDuplicate: true,
        coldHistorySameBytes: true, historicalDraftDownload: true, downloadsCreateNoArtifacts: true,
      }));
      if (failure === "malformed-pending") writeFileSync(join(evidence, "acceptance.pending.json"), "{");
      if (failure === "wrong-project") {
        const pending = JSON.parse(readFileSync(join(evidence, "acceptance.pending.json"), "utf8"));
        writeFileSync(join(evidence, "acceptance.pending.json"), JSON.stringify({ ...pending, localProjectId: "evo-local-fedcba9876543210" }));
      }
      if (["missing-package-proof", "wrong-package-hash", "wrong-package-size", "wrong-package-count"].includes(failure)) {
        const pending = JSON.parse(readFileSync(join(evidence, "acceptance.pending.json"), "utf8"));
        if (failure === "missing-package-proof") delete pending.persistedPackage;
        if (failure === "wrong-package-hash") pending.persistedPackage.sha256 = "not-a-hash";
        if (failure === "wrong-package-size") pending.persistedPackage.bytes = DOCUMENT_PACKAGE_MAX_BYTES + 1;
        if (failure === "wrong-package-count") pending.packageArtifacts = 0;
        writeFileSync(join(evidence, "acceptance.pending.json"), JSON.stringify(pending));
      }
      // Exercise the actual EXIT functions. Only local command boundaries are
      // synthetic: this never calls a Docker daemon, database or provider.
      const result = spawnSync("bash", ["-c", `set -Eeuo pipefail
${functions}
npx() { [[ "$FAILURE" != supabase-stop ]]; }
docker() {
  case "$1 $2" in
    'ps -a')
      [[ "$FAILURE" != container-read ]] || return 1
      [[ "$FAILURE" != remaining-container ]] || echo supabase_db_evo-local-0123456789abcdef;;
    'network ls')
      [[ "$FAILURE" != network-read ]] || return 1
      [[ "$FAILURE" != remaining-network ]] || echo supabase_network_evo-local-0123456789abcdef;;
    'volume ls')
      [[ "$FAILURE" != volume-read ]] || return 1
      [[ "$FAILURE" != remaining-volume ]] || echo supabase_storage_evo-local-0123456789abcdef;;
    *) return 91;;
  esac
}
document_recognition_only=0
student_profile_fields_only=1; student_profile_project_id=evo-local-0123456789abcdef
student_profile_evidence_dir="$EVIDENCE"; student_profile_proof_ready=1
[[ "$FAILURE" != proof-not-ready ]] || student_profile_proof_ready=0
supabase_started=1; supabase_workdir="$OWNED_TMP/local-supabase"
app_pid=""; waha_pid=""; clamav_container_name=""; clamav_signature_volume=""
tmp_dir="$OWNED_TMP"; repo_root="$ROOT"; node_bin="$NODE"
supabase_lock_acquired=1; supabase_lock_dir="$LOCK"; supabase_lock_pid_file="$LOCK/pid"
runtime_inventory_cleanup=0
trap cleanup EXIT
[[ "$FAILURE" != original-exit ]] || exit 1
exit 0
`], { encoding: "utf8", timeout: 5000, env: { ...process.env, FAILURE: failure, EVIDENCE: evidence,
        OWNED_TMP: ownedTmp, ROOT: root, NODE: process.execPath, LOCK: lock, TMPDIR: root } });
      assert.equal(result.status, failure ? 1 : 0, `${failure || "success"}: ${result.stderr}`);
      assert.equal(result.stdout.includes("STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED"), !failure, failure);
      assert.equal(existsSync(join(evidence, "acceptance.json")), !failure, failure);
      const invalidReceipt = ["malformed-pending", "wrong-project", "missing-package-proof", "wrong-package-hash", "wrong-package-size", "wrong-package-count"].includes(failure);
      if (failure && !["original-exit", "proof-not-ready"].includes(failure) && !invalidReceipt) {
        assert.ok(existsSync(ownedTmp));
        assert.ok(existsSync(join(evidence, "acceptance.pending.json")));
        assert.match(result.stderr, /STUDENT_PROFILE_FIELDS_CLEANUP_FAILED/u);
      } else {
        assert.equal(existsSync(ownedTmp), false);
        assert.equal(existsSync(lock), false);
        if (!failure) assert.equal(JSON.parse(readFileSync(join(evidence, "acceptance.json"), "utf8")).cleanupVerified, true);
        if (invalidReceipt) assert.match(result.stderr, /STUDENT_PROFILE_FIELDS_RECEIPT_FINALIZATION_FAILED/u);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("cleanup for all other foundation modes remains byte-identical", () => {
  const marker = "  # Existing full/staff/admissions cleanup remains unchanged below.\n";
  const start = harness.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const body = harness.slice(start, harness.indexOf("\n}\ntrap cleanup EXIT", start));
  assert.equal(createHash("sha256").update(body).digest("hex"), "366d0877f9a5d2a199479edcaaf0523b5060e8eeec0dac169ef084dd58ac178d");
});

test("local export bucket is checked before any synthetic business mutation", () => {
  const valid = { id: "platform-document-exports", public: false, file_size_limit: DOCUMENT_PACKAGE_MAX_BYTES, allowed_mime_types: [DOCUMENT_EXPORT_MIME, "application/pdf", DOCUMENT_PACKAGE_MIME] };
  assert.doesNotThrow(() => verifyDocumentExportBucket(valid));
  for (const change of [{ id: "platform-documents" }, { public: true }, { file_size_limit: 25 * 1024 * 1024 }, { allowed_mime_types: ["application/pdf"] }, { allowed_mime_types: null }]) {
    assert.throws(() => verifyDocumentExportBucket({ ...valid, ...change }), /EXPORT_BUCKET_NOT_READY/u);
  }
  assert.throws(() => verifyDocumentExportBucket(null), /EXPORT_BUCKET_NOT_READY/u);
  const runner = readFileSync(runnerUrl, "utf8");
  const check = runner.indexOf("verifyDocumentExportBucket(bucket.data)");
  assert.ok(check > runner.indexOf("await storage.getBucket(EXPORT_BUCKET)"));
  assert.ok(check < runner.indexOf("await seedCase("));
});

test("local endpoints require explicit loopback HTTP ports and no credentials or paths", () => {
  assert.equal(localOrigin("http://127.0.0.1:43210/"), "http://127.0.0.1:43210");
  assert.equal(localOrigin("http://localhost:43211"), "http://localhost:43211");
  for (const origin of ["https://example.test", "http://localhost", "http://127.0.0.1:3000/private",
    "http://name:secret@localhost:4000", "http://localhost:4000/?q=value", "http://localhost:4000/#fragment"]) {
    assert.throws(() => localOrigin(origin));
  }
});

test("synthetic scenario covers exactly the real nine required bounded fields", () => {
  assert.equal(PROFILE_REQUIRED_FIELD_KEYS.length, 9);
  assert.deepEqual(Object.keys(SYNTHETIC_REQUIRED_VALUES).sort(), [...PROFILE_REQUIRED_FIELD_KEYS].sort());
  assert.equal(SYNTHETIC_REQUIRED_VALUES.mobile_phone, "+1 202 555 0101");
  assert.deepEqual(SYNTHETIC_EXPECTED_VALUES, { ...SYNTHETIC_REQUIRED_VALUES, mobile_phone: "+12025550101" });
  for (const [key, value] of Object.entries(SYNTHETIC_REQUIRED_VALUES)) {
    const definition = PROFILE_FIELDS.find(field => field.key === key);
    assert.ok(value.length > 0 && [...value].length <= definition.maxLength);
  }
});

test("D2 bounded mode follows local Auth bootstrap and exits before unrelated suites", () => {
  assert.match(harness, /--student-profile-fields-only/u);
  const start = harness.indexOf('if [[ "$student_profile_fields_only" == "1" ]]', harness.indexOf('\ncd "$repo_root"'));
  assert.ok(start > harness.indexOf("LOCAL_SUPABASE_ADMIN_BOOTSTRAPPED"));
  const branch = harness.slice(start, harness.indexOf("\nfi", start));
  assert.match(branch, /start_app configured unavailable blocked provider-not-authorized enabled/u);
  assert.match(branch, /student_profile_fields_browser_assert/u);
  assert.match(branch, /assert_no_secret_or_payload_logs/u);
  assert.match(branch, /exit 0/u);
  assert.doesNotMatch(branch, /provision_local_staff|start_clamav_scanner|start_isolated_waha_service|v3_browser_gate/u);
  assert.match(harness, /trap cleanup EXIT/u);
  assert.match(harness, /stop --no-backup/u);
});

test("bounded Admissions mode preserves real setup and the end-of-workflow Storage receipt", () => {
  const start = harness.indexOf('if [[ "$admissions_workflow_only" == "1" ]]');
  assert.ok(start > harness.indexOf("\nprovision_local_staff_and_fixtures\n"));
  assert.ok(start > harness.indexOf("\nstart_clamav_scanner\n"));
  const end = harness.indexOf("\nfi\nsupabase_staff_auth_browser_assert configured", start);
  assert.ok(end > start);
  const branch = harness.slice(start, end);
  assert.match(branch, /supabase_staff_auth_browser_assert configured 'real contract, payment and handoff open one Supabase Student 360 with role-safe access\|Admissions manages one real private company file through V3'/u);
  assert.ok(branch.indexOf("verify_p4_admissions_storage_acceptance") > branch.indexOf("supabase_staff_auth_browser_assert"));
  assert.ok(branch.indexOf("assert_no_secret_or_payload_logs") > branch.indexOf("verify_p4_admissions_storage_acceptance"));
  assert.match(branch, /summarizeStudentProfileAppLog/u);
  assert.match(branch, /statSync\(logPath\)\.size <= 4 \* 1024 \* 1024/u);
  assert.match(branch, /no full-gate pass is implied/u);
  assert.match(branch, /echo "LOCAL_ADMISSIONS_WORKFLOW_VERIFIED"\n  exit 0/u);
  assert.doesNotMatch(branch, /V3 Supabase Auth, canonical-data and browser quality gate passed/u);
  assert.match(harness.slice(end), /\nfi\nsupabase_staff_auth_browser_assert configured\nv3_browser_gate/u);
});

test("D2 runner uses real login and product field actions, not request mocks or Auth bypass", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /#staff-email/u);
  assert.match(runner, /#staff-password/u);
  assert.match(runner, /Войти в CRM/u);
  assert.match(runner, /Начать анкету/u);
  assert.match(runner, /Подтвердить значение/u);
  assert.match(runner, /Подтвердить пустое значение/u);
  assert.match(runner, /Сверено, оставить мои правки/u);
  assert.match(runner, /current\.value === expectedValue/u);
  assert.match(runner, /confirm\(page, key, value, SYNTHETIC_EXPECTED_VALUES\[key\]\)/u);
  assert.match(runner, /const finalValues = \{ \.\.\.SYNTHETIC_EXPECTED_VALUES/u);
  assert.doesNotMatch(runner, /route\.fulfill|addInitScript|setStorageState|generateLink|setSession|auth\.admin|\.rpc\("(?:start|review|begin|complete)_student_profile/u);
});

test("the full release proof exercises D2 once after existing no-mutation checks on the same stack", () => {
  const fullStart = harness.indexOf("\nstart_clamav_scanner\nstart_isolated_waha_service\nstart_app configured configured local-service");
  assert.ok(fullStart > 0);
  const configured = harness.slice(fullStart, harness.indexOf("\nstop_app\nstart_app configured unavailable", fullStart));
  assert.equal(configured.match(/^student_profile_fields_browser_assert$/gm)?.length, 1);
  assert.ok(configured.indexOf("student_profile_fields_browser_assert")
    > configured.indexOf("platform_communications_browser_assert configured"));
  assert.ok(configured.lastIndexOf("assert_no_secret_or_payload_logs")
    > configured.indexOf("student_profile_fields_browser_assert"));
  assert.equal(configured.match(/^start_app /gm)?.length, 2);
});

test("D2 proof binds isolated Docker ownership, ready receipts and real persistent bytes", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /com\.supabase\.cli\.workdir/u);
  assert.match(runner, /com\.supabase\.cli\.project/u);
  assert.match(runner, /LOCAL_RUNTIME_NOT_OWNED/u);
  assert.match(runner, /waitForEvent\("download"/u);
  assert.match(runner, /\["db", "kong", "storage"\]/u);
  assert.match(runner, /platform_private\.document_export_artifacts/u);
  assert.match(runner, /JOIN storage\.objects/u);
  assert.match(runner, /storage\.from\(EXPORT_BUCKET\)\.download\(stored\.object_name\)/u);
  assert.match(runner, /storedBytes\.equals\(bytes\)/u);
  assert.match(runner, /document_export_download_grants/u);
  assert.doesNotMatch(runner, /student_profile_export_attempts|Скачать черновик|Скачать финальную анкету/u);
  assert.match(runner, /output_sha256/u);
  assert.match(runner, /word\/document\.xml/u);
  assert.match(runner, /STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED/u);
  assert.match(runner, /page\.on\("pageerror"/u);
  assert.match(runner, /page\.on\("console"/u);
  assert.match(runner, /BROWSER_RUNTIME_ERRORS/u);
  assert.match(runner, /PAGE_TITLE_INVALID/u);
  assert.doesNotMatch(runner, /console\.(?:log|error)\(error|process\.stderr\.write\(error/u);
});

test("persistent UI proof separates generation, exact replay and cold historical downloads without regeneration", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  for (const label of ["Сформировать черновик", "Сформировать финальную анкету", "Скачать файл", "Сохранённые файлы",
    "Предыдущая версия анкеты", "Текущая версия анкеты"]) assert.ok(runner.includes(label), label);
  assert.match(runner, /GENERATION_DOWNLOADED_AUTOMATICALLY/u);
  assert.match(runner, /postDataJSON\(\)/u);
  assert.match(runner, /page\.request\.post\(exportUrl, \{ data: finalExport\.command, headers: \{ origin: config\.appOrigin \}/u);
  assert.match(runner, /PERSISTENT_REPLAY_DUPLICATED_OR_CHANGED/u);
  assert.match(runner, /const cold = await context\.newPage\(\)/u);
  assert.match(runner, /cold\.waitForResponse\(response => response\.url\(\) === `\$\{exportUrl\}\?schema_version=2` && response\.request\(\)\.method\(\) === "GET"\)/u);
  assert.match(runner, /normalizeDocumentExportWorkspaceV2\(await historyResponse\.json\(\), caseId\)/u);
  assert.match(runner, /history\.artifacts\.length === 2/u);
  assert.match(runner, /history\.artifacts\.every\(row => row\.kind === "student_profile"\)/u);
  assert.match(runner, /coldDraft\.sha256 === draft\.sha256 && coldFinal\.sha256 === final\.sha256/u);
  assert.match(runner, /DOWNLOAD_CHANGED_ARTIFACT_HISTORY/u);
  assert.match(runner, /lostReplyReconciliationExercised: false/u);
  const hook = harness.slice(harness.indexOf("student_profile_fields_browser_assert()"), harness.indexOf('\ncd "$repo_root"'));
  assert.match(hook, /EVO_D2_STORAGE_SERVICE_KEY="\$supabase_service_role_key"/u);
  assert.match(hook, /for secret in "\$supabase_service_role_key"/u);
  assert.doesNotMatch(runner, /storage\.from\([^)]*\)\.(?:upload|update|remove)|\.rpc\("(?:prepare|begin|seal|complete|reconcile)_document_export/u);
});

test("profile export timeout stages distinguish refresh, generation and each warm or cold download boundary", async () => {
  const runner = readFileSync(runnerUrl, "utf8");
  const boundaries = (block, pairs) => {
    let previous = -1;
    for (const [marker, operation] of pairs) {
      const start = block.indexOf(marker, previous + 1), end = block.indexOf(operation, start + marker.length);
      assert.ok(start > previous && end > start, `${marker} must precede ${operation}`);
      previous = end;
    }
  };
  boundaries(runner.slice(runner.indexOf('stage = "FINAL_REFRESH_DOCUMENT"'), runner.indexOf('stage = "EXACT_REQUEST_REPLAY"')), [
    ['stage = "FINAL_REFRESH_DOCUMENT"', 'await page.reload('],
    ['stage = "FINAL_REFRESH_FIELD_EDITOR"', 'await openField('],
    ['stage = "FINAL_REFRESH_FIELD_VALUE"', '.toHaveValue(unsaved)'],
    ['stage = "FINAL_REFRESH_CONFIRMED_EMPTY"', 'await field("mother_employer")'],
    ['stage = "FINAL_REFRESH_EXPORT_READY"', '.toBeEnabled()'],
  ]);
  const generate = runner.slice(runner.indexOf("const generate = async"), runner.indexOf("const downloadSaved = async"));
  boundaries(generate, [
    ['mark("GENERATE_SNAPSHOT")', 'await snapshot()'], ['mark("GENERATE_INVENTORY_BEFORE")', 'await inventory()'],
    ['mark("GENERATE_BUTTON_READY")', 'await expect(button).toBeEnabled()'],
    ['mark("GENERATE_POST_RESPONSE")', 'await captureProfileExportResponse(page, button, exportUrl, mark)'],
    ['mark("RECEIPT_NORMALIZE")', 'normalizeDocumentExportReceipt(body.artifact, caseId)'],
    ['mark("COMMAND_READ")', 'response.request().postDataJSON()'],
    ['mark("RECEIPT_COMPARE")', 'requireProof(receipt.state === "ready"'],
    ['mark("GENERATE_HISTORY_ROW")', 'await expect(savedRow('],
    ['mark("GENERATE_SAVED_MESSAGE")', 'Файл сохранён. Теперь его можно скачать.'],
    ['mark("GENERATE_INVENTORY_AFTER")', 'await inventory()'],
  ]);
  boundaries(captureProfileExportResponse.toString(), [['mark("RESPONSE_BODY_READ")', 'await response.body()']]);
  const download = runner.slice(runner.indexOf("const downloadSaved = async"), runner.indexOf('stage = "DRAFT_DOWNLOAD"'));
  boundaries(download, [
    ['mark("DOWNLOAD_INVENTORY_BEFORE")', 'await inventory()'], ['mark("DOWNLOAD_ROW_COUNT")', '.toHaveCount(1)'],
    ['mark("DOWNLOAD_ROW_READY")', '.toBeVisible()'], ['mark("DOWNLOAD_EVENT")', 'await Promise.all('],
    ['mark("DOWNLOAD_FAILURE_CHECK")', 'await file.failure()'], ['mark("DOWNLOAD_FILE_PATH")', 'await file.path()'],
    ['mark("DOWNLOAD_DOCX_VERIFY")', 'verifyDocx('], ['mark("DOWNLOAD_STORED_ROW")', 'await sql`'],
    ['mark("DOWNLOAD_STORAGE_READBACK")', 'storage.from(EXPORT_BUCKET).download('],
    ['mark("DOWNLOAD_STORAGE_BYTES")', 'await readback.data.arrayBuffer()'], ['mark("DOWNLOAD_GRANT")', 'await sql`'],
    ['mark("DOWNLOAD_INVENTORY_AFTER")', 'await inventory()'], ['mark("DOWNLOAD_EVIDENCE_WRITE")', 'writeFileSync('],
  ]);
  for (const [file, phase] of [["draft.docx", "DRAFT"], ["final.docx", "FINAL"],
    ["draft-history.docx", "COLD_DRAFT"], ["final-history.docx", "COLD_FINAL"]]) assert.ok(runner.includes(`"${file}", "${phase}")`));
  assert.match(generate, /mode === "draft" \? "DRAFT" : "FINAL"/u);
  for (const block of [generate, download]) assert.match(block, /stage = profileExportDiagnosticStage\(phase, step\)/u);
  const { profileExportDiagnosticStage } = await import(runnerUrl.href);
  assert.equal(profileExportDiagnosticStage("DRAFT", "GENERATE_POST_RESPONSE"), "DRAFT_GENERATE_POST_RESPONSE");
  for (const step of ["RESPONSE_BODY_READ", "BODY_TRANSPORT", "BODY_INVALID_JSON", "RECEIPT_NORMALIZE", "COMMAND_READ", "RECEIPT_COMPARE"]) {
    assert.equal(profileExportDiagnosticStage("DRAFT", step), `DRAFT_${step}`);
    assert.equal(profileExportDiagnosticStage("FINAL", step), `FINAL_${step}`);
  }
  assert.equal(profileExportDiagnosticStage("DRAFT", "GENERATE_RECEIPT"), "DRAFT_GENERATE_RECEIPT");
  assert.equal(profileExportDiagnosticStage("FINAL", "DOWNLOAD_EVENT"), "FINAL_DOWNLOAD_EVENT");
  assert.equal(profileExportDiagnosticStage("COLD_DRAFT", "DOWNLOAD_STORAGE_BYTES"), "COLD_DRAFT_DOWNLOAD_STORAGE_BYTES");
  assert.equal(profileExportDiagnosticStage("COLD_FINAL", "DOWNLOAD_GRANT"), "COLD_FINAL_DOWNLOAD_GRANT");
  for (const value of ["private-value", "https://example.test/private", null, undefined, {}, ["DRAFT"], [["DRAFT"]]]) {
    assert.throws(() => profileExportDiagnosticStage(value, "DOWNLOAD_EVENT"), /EXPORT_DIAGNOSTIC_STAGE_INVALID/u);
    assert.throws(() => profileExportDiagnosticStage("DRAFT", value), /EXPORT_DIAGNOSTIC_STAGE_INVALID/u);
  }
});

function persistentFixture() {
  const id = "aaaa0000-0000-4000-8000-000000000001";
  const organizationId = "aaaa0000-0000-4000-8000-000000000002";
  const caseId = "aaaa0000-0000-4000-8000-000000000003";
  const bytes = Buffer.from("synthetic stored bytes");
  const receipt = { id, student_case_id: caseId, receipt_id: "aaaa0000-0000-4000-8000-000000000004",
    state: "ready", can_download: true, profile_revision: 14, mode: "final", workspace_revision: "b".repeat(64),
    input_snapshot_sha256: "c".repeat(64), output_sha256: createHash("sha256").update(bytes).digest("hex"), output_bytes: bytes.length };
  const stored = { ...receipt, organization_id: organizationId, template_sha256: DOCUMENT_EXPORT_TEMPLATE_SHA256,
    bucket_id: "platform-document-exports", bucket_public: false, bucket_limit: DOCUMENT_PACKAGE_MAX_BYTES,
    bucket_mimes: [DOCUMENT_EXPORT_MIME, "application/pdf", DOCUMENT_PACKAGE_MIME], storage_object_id: "aaaa0000-0000-4000-8000-000000000005",
    object_name: `${organizationId}/${caseId}/${id}.docx` };
  return { bytes, receipt, stored, organizationId };
}

test("Storage proof requires identical ready receipt, private object scope and downloaded bytes", () => {
  const { bytes, receipt, stored, organizationId } = persistentFixture();
  assert.deepEqual(verifyStoredDocumentExport(bytes, receipt, stored, organizationId), {
    sha256: receipt.output_sha256, bytes: bytes.length, persisted: true, privateStorageReadback: true,
  });
  for (const change of [{ state: "pending" }, { can_download: false }, { profile_revision: 15 },
    { id: "aaaa0000-0000-4000-8000-000000000006" }, { workspace_revision: "d".repeat(64) }]) {
    assert.throws(() => verifyStoredDocumentExport(bytes, { ...receipt, ...change }, stored, organizationId), /PERSISTENT_RECEIPT_MISMATCH/u);
  }
  for (const change of [{ bucket_public: true }, { bucket_limit: 25 * 1024 * 1024 }, { bucket_mimes: ["application/pdf"] },
    { bucket_id: "platform-documents" }, { object_name: "wrong/object.docx" }, { storage_object_id: null }]) {
    assert.throws(() => verifyStoredDocumentExport(bytes, receipt, { ...stored, ...change }, organizationId), /PERSISTENT_STORAGE_BOUNDARY_INVALID/u);
  }
  assert.throws(() => verifyStoredDocumentExport(Buffer.from("different bytes"), receipt, stored, organizationId), /PERSISTENT_STORAGE_BYTES_MISMATCH/u);
  assert.throws(() => verifyStoredDocumentExport(bytes, receipt, { ...stored, output_sha256: "0".repeat(64) }, organizationId), /PERSISTENT_STORAGE_BYTES_MISMATCH/u);
  assert.throws(() => verifyStoredDocumentExport(bytes, receipt, null, organizationId), /PERSISTENT_RECEIPT_MISMATCH/u);
  const oversized = Buffer.alloc(DOCUMENT_EXPORT_MAX_BYTES + 1);
  const output = { output_bytes: oversized.length, output_sha256: createHash("sha256").update(oversized).digest("hex") };
  assert.throws(() => verifyStoredDocumentExport(oversized, { ...receipt, ...output }, { ...stored, ...output }, organizationId),
    /PERSISTENT_STORAGE_BYTES_MISMATCH/u); // Raising the shared bucket never raises the profile output cap.
});

function packageFixture() {
  const { receipt: profileReceipt, organizationId } = persistentFixture();
  const source = { id: "aaaa0000-0000-4000-8000-000000000011", kind: "generated", mode: "final", bytes: Buffer.from("existing final DOCX bytes") };
  const receipt = { ...profileReceipt, kind: "package", mime_type: DOCUMENT_PACKAGE_MIME,
    package: { id: "aaaa0000-0000-4000-8000-000000000012", application_id: "aaaa0000-0000-4000-8000-000000000013", item_count: 1 } };
  const manifest = { schemaVersion: 1, rendererVersion: "evo-partner-packet-zip-v1", packetId: receipt.package.id,
    studentCaseId: receipt.student_case_id, inputSha256: receipt.input_snapshot_sha256, mode: "final",
    items: [{ id: source.id, kind: source.kind, mode: source.mode, path: `generated/${source.id}.docx`,
      mimeType: DOCUMENT_EXPORT_MIME, sizeBytes: source.bytes.length, sha256: createHash("sha256").update(source.bytes).digest("hex") }] };
  const zip = new PizZip();
  zip.file(manifest.items[0].path, source.bytes, { createFolders: false });
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("README.txt", "This is not a submission or delivery receipt.");
  const seal = () => {
    const bytes = zip.generate({ type: "nodebuffer" });
    return { bytes, receipt: { ...receipt, output_bytes: bytes.length, output_sha256: createHash("sha256").update(bytes).digest("hex") } };
  };
  return { ...seal(), organizationId, source, manifest, zip, seal };
}

test("package proof decodes exact selected bytes and rejects added, changed or draft contents", () => {
  const fixture = packageFixture();
  assert.deepEqual(verifyPersistedPackageZip(fixture.bytes, fixture.receipt, [fixture.source]), {
    sha256: fixture.receipt.output_sha256, bytes: fixture.bytes.length, selectedEntries: 1,
    selectedEntryBytesVerified: true, finalExcludesDraft: true,
  });
  assert.throws(() => verifyPersistedPackageZip(fixture.bytes, fixture.receipt, [{ ...fixture.source, mode: "draft" }]), /PACKAGE_SELECTION_INVALID/u);
  for (const mutation of ["extra", "bytes", "manifest-hash", "manifest-case", "draft-warning"]) {
    const f = packageFixture();
    if (mutation === "extra") f.zip.file("generated/unselected-draft.docx", "draft", { createFolders: false });
    if (mutation === "bytes") f.zip.file(f.manifest.items[0].path, "altered output", { createFolders: false });
    if (mutation === "manifest-hash") { f.manifest.items[0].sha256 = "0".repeat(64); f.zip.file("manifest.json", JSON.stringify(f.manifest)); }
    if (mutation === "manifest-case") { f.manifest.studentCaseId = f.organizationId; f.zip.file("manifest.json", JSON.stringify(f.manifest)); }
    if (mutation === "draft-warning") f.zip.file("README.txt", "DRAFT. This is not a submission or delivery receipt.");
    const changed = f.seal(); // Even a matching outer hash must not hide wrong ZIP contents.
    assert.throws(() => verifyPersistedPackageZip(changed.bytes, changed.receipt, [f.source]), /PACKAGE_(?:ENTRIES_CHANGED|ENTRY_BYTES_CHANGED|MANIFEST_SOURCE_MISMATCH|MANIFEST_MISMATCH|FINAL_LABEL_INVALID)/u, mutation);
  }
  assert.throws(() => verifyPersistedPackageZip(fixture.bytes, { ...fixture.receipt, output_sha256: "0".repeat(64) }, [fixture.source]), /PACKAGE_OUTPUT_MISMATCH/u);
});

test("package storage proof binds private object, current receipt and independent readback hash", () => {
  const { bytes, receipt, organizationId } = packageFixture();
  const stored = { ...persistentFixture().stored, ...receipt, organization_id: organizationId,
    application_id: receipt.package.application_id, package_id: receipt.package.id,
    object_name: `${organizationId}/${receipt.student_case_id}/${receipt.id}.zip` };
  assert.doesNotThrow(() => verifyPackageStorage(bytes, receipt, stored, organizationId));
  for (const change of [{ kind: "student_profile" }, { state: "pending" }, { package_id: organizationId },
    { application_id: organizationId }, { workspace_revision: "0".repeat(64) }]) {
    assert.throws(() => verifyPackageStorage(bytes, receipt, { ...stored, ...change }, organizationId), /PACKAGE_STORED_RECEIPT_MISMATCH/u);
  }
  for (const change of [{ bucket_public: true }, { bucket_limit: DOCUMENT_EXPORT_MAX_BYTES },
    { bucket_mimes: [DOCUMENT_PACKAGE_MIME] }, { object_name: "wrong/object.zip" }]) {
    assert.throws(() => verifyPackageStorage(bytes, receipt, { ...stored, ...change }, organizationId), /PACKAGE_PRIVATE_STORAGE_INVALID/u);
  }
  assert.throws(() => verifyPackageStorage(Buffer.from("different"), receipt, stored, organizationId), /PACKAGE_STORED_BYTES_MISMATCH/u);
});

test("package fixture supplies the exact current canonical application RPC signature", () => {
  const proof = readFileSync(new URL("../scripts/lib/document-package-browser-proof.mjs", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/118_platform_university_application_geography.sql", import.meta.url), "utf8");
  const signature = migration.match(/CREATE FUNCTION platform\.create_university_application\(([\s\S]*?)\)\s*RETURNS JSONB/u)?.[1];
  const payload = proof.match(/rpc\("create_university_application", \{([\s\S]*?)\}\);/u)?.[1];
  assert.ok(signature && payload);
  const required = [...signature.matchAll(/\b(p_[a-z_]+)\s+[A-Za-z]/gu)].map(match => match[1]).sort();
  const supplied = [...payload.matchAll(/\b(p_[a-z_]+):/gu)].map(match => match[1]).sort();
  assert.equal(required.length, 13);
  assert.deepEqual(supplied, required);
  assert.match(payload, /p_is_primary: false/u);
  for (const key of ["p_university_deadline_on", "p_country", "p_degree"]) assert.ok(payload.includes(`${key}: null`), key);
});

test("persisted ZIP runs after profile cold checks using UI and a fresh real login, not renderer or Storage writes", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  const proof = readFileSync(new URL("../scripts/lib/document-package-browser-proof.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("await provePersistedPackage(") > runner.indexOf('"PERSISTENT_COLD_HISTORY_CHANGED_BYTES"'));
  assert.match(runner, /persistentArtifacts: 3, profileArtifacts: 2, packageArtifacts: 1, persistedPackage/u);
  assert.match(proof, /rpc\("create_university_application"/u);
  assert.match(proof, /getByRole\("combobox", \{ name: "Заявление", exact: true \}\)/u);
  assert.match(proof, /toHaveValue\(applicationId\)/u);
  assert.doesNotMatch(proof, /getByLabel\("Заявление", \{ exact: true \}\)/u);
  for (const label of ["Зафиксировать пакет", "Сохранить финальный ZIP", "Скачать файл", "Войти в CRM"]) assert.ok(proof.includes(label));
  assert.match(proof, /browser\.newContext\(/u);
  assert.match(proof, /fresh\.locator\("#staff-password"\)\.fill\(config\.password\)/u);
  assert.match(proof, /history\.artifacts\.length === 3/u);
  assert.match(proof, /PACKAGE_DOWNLOAD_CHANGED_HISTORY/u);
  assert.match(proof, /storedBytes\.equals\(bytes\)/u);
  assert.doesNotMatch(proof, /route\.fulfill|storage\.from\([^)]*\)\.(?:upload|update|remove)|\.rpc\("(?:prepare|begin|seal|complete|reconcile)_document_export|buildPersistedDocumentPackageZip|storageState\s*:/u);
});

test("failure evidence separates login from profile rendering and never emits raw diagnostic payloads", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  const login = runner.indexOf('stage = "LOGIN_DOCUMENT"');
  const submit = runner.indexOf('stage = "LOGIN_SUBMIT"');
  const shell = runner.indexOf('stage = "AUTHENTICATED_SHELL"');
  const navigation = runner.indexOf('stage = "PROFILE_NAVIGATION"');
  const readiness = runner.indexOf('stage = "PROFILE_START_CONTROL"');
  assert.ok(login >= 0 && submit > login && shell > submit && navigation > shell && readiness > navigation);
  assert.match(runner, /"failure\.json"/u);
  assert.match(runner, /"failure\.png"/u);
  assert.match(runner, /await writeFailureEvidence/u);
  assert.match(runner, /mask: \[page\.locator\("input, textarea"\)\]/u);
  assert.match(runner, /!snapshot\.passwordControlPresent/u);
  let withoutClassifiers = runner;
  // Only pure fixed-enum classifiers and this exact event-to-classifier handoff
  // may inspect a message. Raw capture remains forbidden in the snapshot writer.
  for (const classify of [proofExceptionCategory, profileBodyTransportCategory, profileBodyProtocolMethod, profileBrowserRuntimeDiagnostic]) {
    const classifier = classify.toString();
    assert.equal(runner.split(classifier).length, 2);
    assert.doesNotMatch(classifier, /writeFile|console\.|stdout|stderr|spawn|fetch\(/u);
    withoutClassifiers = withoutClassifiers.replace(classifier, "");
  }
  const eventHandoff = 'page.on("pageerror", error => recordBrowserError("page", error.stack ?? error.message, undefined, pageTag));';
  assert.equal(withoutClassifiers.split(eventHandoff).length, 2);
  withoutClassifiers = withoutClassifiers.replace(eventHandoff, "");
  assert.doesNotMatch(withoutClassifiers, /(?:error|message)\.(?:stack|message)|page\.content\(|storageState\(/u);
});

test("safe diagnostic classes discard query strings, credentials, exception text and stack", () => {
  const origin = "http://127.0.0.1:43210";
  assert.equal(proofPathClass(`${origin}/v3/profile?case=synthetic&token=not-for-output`, origin), "PROFILE");
  assert.equal(proofPathClass(`${origin}/login?error=private-detail`, origin), "LOGIN");
  assert.equal(proofPathClass("https://example.test/private", origin), "OTHER_ORIGIN");
  assert.equal(proofPathClass("not a URL", origin), "UNAVAILABLE");
  assert.equal(proofExceptionCategory(new TypeError("private text")), "TYPE_ERROR");
  assert.equal(proofExceptionCategory({ name: "TimeoutError", message: "private text", stack: "private stack" }), "TIMEOUT");
  assert.equal(proofExceptionCategory({ name: "CustomFailure", message: "private text" }), "OTHER_ERROR");
});

test("server diagnostics retain only known static errors and repository stack locations", () => {
  const summary = summarizeStudentProfileAppLog([
    " ⨯ Error [PlatformStudentHandoffRepositoryError]: Platform Student handoff data is unavailable. {",
    "    at failure (src/lib/platform-student-handoff.ts:342:9)",
    "    at oneRow (/private/tmp/secret-directory/src/lib/platform-student-handoff.ts:1197:12)",
    "    at unknownSensitiveName (src/lib/platform-student-handoff.ts:1200:4)",
    "    at privateValue (https://private.example.test/token:50:2)",
    "  private diagnostic payload with secret sentinel and private@example.test",
    "Error: private payload must never be retained",
    "TypeError: Platform Student handoff data is unavailable. appended-secret",
    "GET /v3/profile?case=private-id&token=private-token 500",
  ].join("\n"));
  assert.deepEqual(summary.errorClasses, ["Error", "PlatformStudentHandoffRepositoryError", "TypeError"]);
  assert.deepEqual(summary.staticMessages, ["Platform Student handoff data is unavailable."]);
  assert.deepEqual(summary.repositoryFrames, [
    { function: "failure", file: "src/lib/platform-student-handoff.ts", line: 342, column: 9 },
    { function: "oneRow", file: "src/lib/platform-student-handoff.ts", line: 1197, column: 12 },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /secret|private|password|bearer|https:|GET|appended/u);
  assert.deepEqual(summarizeStudentProfileAppLog("random customer data"), {
    errorClasses: [], staticMessages: [], repositoryFrames: [],
  });
});

test("D2 failure extracts the owned application log before cleanup and keeps raw logs private", () => {
  const block = harness.slice(harness.indexOf("student_profile_fields_browser_assert()"), harness.indexOf('\ncd "$repo_root"'));
  const extraction = block.indexOf("--summarize-owned-app-log");
  assert.ok(extraction > 0 && extraction < block.indexOf('fail "The bounded real Student Profile'));
  assert.match(block, /EVO_D2_APP_LOG="\$app_log"/u);
  assert.match(block, /EVO_D2_RUNTIME_DIR="\$tmp_dir"/u);
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /"server-failure\.json"/u);
  assert.match(runner, /APP_LOG_NOT_OWNED/u);
  assert.match(runner, /process\.stdout\.write\(`\$\{scope\.marker\}_SERVER_DETAIL:\$\{JSON\.stringify\(summary\)\}\\n`\)/u);
  assert.doesNotMatch(block, /(?:cat|tail|sed).*\$app_log/u);
});

test("upstream synthetic case uses normal canonical handoff instead of missing handoff rows", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  for (const command of ["create_manual_sales_lead", "mutate_sales_lead_workflow", "confirm_contract",
    "confirm_first_payment", "handoff_lead_to_admissions", "staff_student_case_handoff_context"]) {
    assert.ok(runner.includes(`"${command}"`), command);
  }
  assert.match(runner, /p_handoff_mode: "normal"/u);
  assert.match(runner, /Fictional local payment: no funds transferred/u);
  assert.match(runner, /PROFILE_NOT_ABSENT/u);
  assert.match(runner, /CHECKLIST_NOT_ABSENT/u);
  assert.doesNotMatch(runner, /INSERT INTO platform\.(?:record_scopes|student_cases|sales_admissions_handoffs)|exceptional_override/u);
});
