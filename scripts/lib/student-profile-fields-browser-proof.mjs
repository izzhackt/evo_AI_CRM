#!/usr/bin/env node
// Bounded synthetic acceptance on the harness-owned local Auth/DB/application.
// Upstream synthetic data uses normal authenticated Sales→Admissions commands;
// Profile/export creation uses the product UI. One captured command is explicitly
// replayed against the real session-bound HTTP route; no mocked responses/grants.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import postgres from "postgres";
import { parse } from "smol-toml";
import { PROFILE_FIELDS, PROFILE_GROUP_LABELS, PROFILE_REQUIRED_FIELD_KEYS } from "../../src/lib/student-profile-fields.ts";
import { normalizeDocumentExportReceipt, normalizeDocumentExportWorkspaceV2 } from "../../src/lib/document-export-artifacts.ts";
import { DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_PACKAGE_MAX_BYTES } from "../../src/lib/document-export-artifact-contract.ts";
import { exportBucketMimeTypesValid, PackageProofError, provePersistedPackage } from "./document-package-browser-proof.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TEMPLATE_HASH = "2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0";
const DRAFT_WARNING = "ЧЕРНОВИК — данные требуют проверки; не для подачи";
const EXPORT_BUCKET = "platform-document-exports";
export const SYNTHETIC_REQUIRED_VALUES = Object.freeze({
  student_first_name: "Амина", student_last_name: "Пример", date_of_birth: "2008-04-12",
  nationality: "Kyrgyzstan", passport_number: "QA0001234",
  permanent_address: "Example Street 10, Bishkek", mobile_phone: "+1 202 555 0101",
  student_email: "student-profile@example.test", field_major: "Computer Science",
});
export const SYNTHETIC_EXPECTED_VALUES = Object.freeze({
  ...SYNTHETIC_REQUIRED_VALUES, mobile_phone: "+12025550101",
});
export class ProofError extends Error { constructor(code) { super(code); this.code = code; } }
export function requireProof(condition, code) { if (!condition) throw new ProofError(code); }
const RUNTIME_FRAMES = ["PreparePartnerPacketForm", "PartnerPacketsPanel", "StudentProfileExportHistory",
  "StudentProfileExportList", "StudentProfileFields", "ProfileAdmissionsWorkspace", "CaseOperationsForms",
  "StudentProfileWorkspace", "StudentProfileFieldsPanel", "StudentProfileField", "StaffLogin", "V3Shell"];
const RUNTIME_ATTRIBUTES = ["disabled", "aria-busy", "id", "htmlFor", "className", "value", "checked", "open"];
const RUNTIME_CATEGORIES = ["OTHER_RUNTIME_ERROR", "HYDRATION_ATTRIBUTES", "HYDRATION_CONTENT", "HTML_NESTING",
  "CONTROLLED_INPUT", "REACT_KEY", "CHUNK_LOAD", "CSP", "RESOURCE_LOAD", "NETWORK", "REACT_RENDER_LOOP", "REACT_HOOKS"];
const RUNTIME_PAGES = ["profile_primary", "profile_second", "profile_cold", "profile_other", "package_fresh"];
const RUNTIME_STAGES = new Set(["UNAVAILABLE", "CONFIGURATION", "EXPORT_BUCKET", "FIXTURE", "PROFILE_BASELINE",
  "LOGIN_DOCUMENT", "LOGIN_EMAIL", "LOGIN_PASSWORD", "LOGIN_SUBMIT", "AUTHENTICATED_SHELL", "ACTUAL_ROLE",
  "PROFILE_NAVIGATION", "PROFILE_URL", "PROFILE_TITLE", "PROFILE_START_CONTROL", "PROFILE_READ_ONLY", "START_PROFILE",
  "DRAFT_DOWNLOAD", "CONFIRM_REQUIRED_AND_EXTENDED", "CONFIRMED_EMPTY", "STALE_SECOND_EDITOR", "FINAL_REFRESH_DOCUMENT",
  "FINAL_REFRESH_FIELD_EDITOR", "FINAL_REFRESH_FIELD_VALUE", "FINAL_REFRESH_CONFIRMED_EMPTY", "FINAL_REFRESH_EXPORT_READY",
  "EXACT_REQUEST_REPLAY", "COLD_EXPORT_HISTORY", "PACKAGE_APPLICATION_FIXTURE", "PACKAGE_UI_PREPARATION",
  "PACKAGE_SSR_PREPARATION_CONTROLS", "PACKAGE_UI_OPEN_PANEL", "PACKAGE_UI_SELECT_APPLICATION", "PACKAGE_UI_SELECT_FINAL",
  "PACKAGE_UI_SAVE_CLICK", "PACKAGE_UI_SAVE_READBACK", "PACKAGE_UI_OPEN_SAVED_COMPOSITION", "PACKAGE_UI_GENERATION",
  "PACKAGE_STORAGE_DOWNLOAD", "PACKAGE_FRESH_LOGIN", "PACKAGE_COLD_HISTORY"]);
function safeRuntimeStage(stage) {
  if (typeof stage !== "string") return "UNAVAILABLE";
  if (RUNTIME_STAGES.has(stage)) return stage;
  const parts = stage.match(/^(COLD_DRAFT|COLD_FINAL|DRAFT|FINAL)_(.+)$/u);
  try { if (parts) return profileExportDiagnosticStage(parts[1], parts[2]); } catch { /* Not an allowed stage. */ }
  return "UNAVAILABLE";
}
function safeRuntimeDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !["page", "console"].includes(item.kind)
      || !RUNTIME_CATEGORIES.includes(item.category) || !RUNTIME_PAGES.includes(item.page)
      || !["NEXT_RUNTIME", "APPLICATION", "OTHER"].includes(item.source)) return [];
    return [{ kind: item.kind, category: item.category, stage: safeRuntimeStage(item.stage), page: item.page, source: item.source,
      frames: RUNTIME_FRAMES.filter(frame => Array.isArray(item.frames) && item.frames.includes(frame)),
      attributes: RUNTIME_ATTRIBUTES.filter(attribute => Array.isArray(item.attributes) && item.attributes.includes(attribute)),
      httpStatus: Number.isSafeInteger(item.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599 ? item.httpStatus : null }];
  });
}
export function profileBrowserRuntimeDiagnosticLine(snapshot) {
  const diagnostics = snapshot?.schema === "evo-student-profile-browser-failure/v1" ? safeRuntimeDiagnostics(snapshot.runtimeDiagnostics) : [];
  return `STUDENT_PROFILE_FIELDS_RUNTIME_DIAGNOSTIC:${diagnostics.length ? JSON.stringify(diagnostics) : "UNAVAILABLE"}`;
}
export function profileBrowserRuntimeDiagnostic({ kind, text, location, stage, page }) {
  // Exact event text/location stay in memory; emit only fixed categories and identifiers.
  const message = typeof text === "string" ? text : "";
  let category = "OTHER_RUNTIME_ERROR";
  if (/A tree hydrated but some attributes/u.test(message)) category = "HYDRATION_ATTRIBUTES";
  else if (/Hydration failed|Text content did not match|server rendered HTML didn't match/u.test(message)) category = "HYDRATION_CONTENT";
  else if (/cannot (?:be a child|contain a nested)|validateDOMNesting|In HTML,/u.test(message)) category = "HTML_NESTING";
  else if (/uncontrolled input to be controlled|controlled input to be uncontrolled/u.test(message)) category = "CONTROLLED_INPUT";
  else if (/unique ["']key["'] prop|same key/u.test(message)) category = "REACT_KEY";
  else if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/u.test(message)) category = "CHUNK_LOAD";
  else if (/Content Security Policy|Content-Security-Policy/u.test(message)) category = "CSP";
  else if (/Failed to load resource/u.test(message)) category = "RESOURCE_LOAD";
  else if (/Failed to fetch|NetworkError|ERR_NETWORK|ERR_CONNECTION/u.test(message)) category = "NETWORK";
  else if (/Maximum update depth|Too many re-renders/u.test(message)) category = "REACT_RENDER_LOOP";
  else if (/Invalid hook call|Rendered (?:more|fewer) hooks/u.test(message)) category = "REACT_HOOKS";
  const resource = typeof location?.url === "string" ? location.url : "";
  const source = resource.includes("node_modules_next") || resource.includes("next/dist") ? "NEXT_RUNTIME"
    : resource.includes("src_") || resource.includes("/src/") ? "APPLICATION" : "OTHER";
  const attributes = RUNTIME_ATTRIBUTES
    .filter(attribute => new RegExp(`^[+-]\\s+${attribute}=`, "mu").test(message));
  const status = message.match(/server responded with a status of ([1-5][0-9]{2})\b/u)?.[1];
  return { kind: kind === "page" ? "page" : "console", category,
    stage: safeRuntimeStage(stage), page: RUNTIME_PAGES.includes(page) ? page : "profile_other", source,
    frames: RUNTIME_FRAMES.filter(frame => message.includes(frame)), attributes,
    httpStatus: status ? Number(status) : null };
}
const BODY_TRANSPORT_CATEGORIES = new Set(["RESOURCE_MISSING", "RESOURCE_DATA_MISSING", "RESOURCE_EVICTED", "TARGET_OR_SESSION_CLOSED",
  "REQUEST_ABORTED", "REDIRECT_BODY_UNAVAILABLE", "OTHER_PROTOCOL_ERROR", "OTHER_BODY_ERROR"]);
const BODY_PROTOCOL_METHODS = ["Network.getResponseBody", "Network.loadNetworkResource", "IO.read", "IO.close", "NONE", "OTHER"];
const REQUEST_FAILURE_CODES = ["ERR_ABORTED", "ERR_FAILED", "ERR_TIMED_OUT", "ERR_EMPTY_RESPONSE",
  "ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED", "ERR_CONNECTION_ABORTED", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_FAILED",
  "ERR_CONTENT_LENGTH_MISMATCH", "ERR_INCOMPLETE_CHUNKED_ENCODING", "ERR_CONTENT_DECODING_FAILED", "ERR_INVALID_RESPONSE",
  "ERR_HTTP2_PROTOCOL_ERROR", "ERR_HTTP2_SERVER_REFUSED_STREAM", "ERR_QUIC_PROTOCOL_ERROR", "ERR_HTTP_RESPONSE_CODE_FAILURE",
  "ERR_BLOCKED_BY_CLIENT", "ERR_BLOCKED_BY_RESPONSE", "ERR_BLOCKED_BY_ORB", "ERR_ACCESS_DENIED", "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED", "ERR_NAME_NOT_RESOLVED", "ERR_ADDRESS_UNREACHABLE", "ERR_INSUFFICIENT_RESOURCES",
  "ERR_NETWORK_IO_SUSPENDED", "ERR_CACHE_MISS", "ERR_CACHE_READ_FAILURE", "ERR_RESPONSE_HEADERS_TRUNCATED"];
const REQUEST_FAILURE_CATEGORIES = new Set([...REQUEST_FAILURE_CODES, "NONE", "OTHER"]);
export function profileRequestFailureCategory(failure) {
  if (failure === null) return "NONE";
  const text = typeof failure?.errorText === "string" ? failure.errorText : "";
  return REQUEST_FAILURE_CODES.find(code => text === `net::${code}`) ?? "OTHER";
}
export function profileBodyProtocolMethod(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return BODY_PROTOCOL_METHODS.slice(0, 4).find(method => message.includes(`Protocol error (${method}):`))
    ?? (/Protocol error/u.test(message) ? "OTHER" : "NONE");
}
export function profileBodyTransportCategory(error) {
  // Never retain the raw protocol message: it may contain URLs or private values.
  const message = typeof error?.message === "string" ? error.message : "";
  if (/No resource with given identifier found|Missing content of resource for given requestId/u.test(message)) return "RESOURCE_MISSING";
  if (/No data found for resource with given identifier/u.test(message)) return "RESOURCE_DATA_MISSING";
  if (/evicted from inspector cache/iu.test(message)) return "RESOURCE_EVICTED";
  if (/Target.*closed|Session.*closed|has been closed/iu.test(message)) return "TARGET_OR_SESSION_CLOSED";
  if (/net::ERR_ABORTED|request aborted/iu.test(message)) return "REQUEST_ABORTED";
  if (/Response body is unavailable for redirect responses/u.test(message)) return "REDIRECT_BODY_UNAVAILABLE";
  return /Protocol error/u.test(message) ? "OTHER_PROTOCOL_ERROR" : "OTHER_BODY_ERROR";
}
function safeBodyTransportDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !BODY_TRANSPORT_CATEGORIES.has(value.category)
    || !BODY_PROTOCOL_METHODS.includes(value.protocolMethod) || !REQUEST_FAILURE_CATEGORIES.has(value.requestFailure)
    || !Number.isSafeInteger(value.mainFrameNavigations) || value.mainFrameNavigations < 0
    || ["requestFinished", "requestFailed", "pageAlive", "browserAlive"].some(key => typeof value[key] !== "boolean")) return null;
  return { category: value.category, protocolMethod: value.protocolMethod, requestFailure: value.requestFailure,
    requestFinished: value.requestFinished, requestFailed: value.requestFailed,
    mainFrameNavigations: value.mainFrameNavigations, pageAlive: value.pageAlive, browserAlive: value.browserAlive };
}
export function profileBodyTransportDiagnosticLine(snapshot) {
  const prefix = "STUDENT_PROFILE_FIELDS_BODY_TRANSPORT_DIAGNOSTIC:";
  const diagnostic = safeBodyTransportDiagnostic(snapshot?.transportDiagnostic);
  if (snapshot?.schema !== "evo-student-profile-browser-failure/v1" || snapshot.exceptionCategory !== "PROOF_ASSERTION"
    || !["DRAFT_BODY_TRANSPORT", "FINAL_BODY_TRANSPORT"].includes(snapshot.stage) || !diagnostic) return `${prefix}UNAVAILABLE`;
  return `${prefix}${JSON.stringify({ stage: snapshot.stage, ...diagnostic })}`;
}
function printBodyTransportDiagnostic() {
  let snapshot;
  try {
    const file = resolve(env("EVO_D2_EVIDENCE_DIR"), "failure.json");
    const stat = lstatSync(file);
    if (stat.isFile() && stat.size <= 64 * 1024) snapshot = JSON.parse(readFileSync(file, "utf8"));
  } catch { /* Missing/malformed evidence must not reveal paths or replace the original failure. */ }
  process.stderr.write(`${profileBodyTransportDiagnosticLine(snapshot)}\n`);
  process.stderr.write(`${profileBrowserRuntimeDiagnosticLine(snapshot)}\n`);
  if (process.env.EVO_D2_TRANSPORT_LIFECYCLE_DIAGNOSTIC === "1") printTransportLifecycleDiagnostic();
}

const LIFECYCLE_EVENTS = new Set(["NAVIGATION_START", "NAVIGATION_COMMIT",
  "POST_START", "POST_RESPONSE", "POST_FINISHED", "POST_FAILED", "HMR_OPEN", "HMR_FRAME", "HMR_SESSION_CHANGED", "HMR_CLOSE", "HMR_ERROR", "HMR_FULL_RELOAD"]);
const LIFECYCLE_HMR_TYPES = new Set(["addedPage", "removedPage", "reloadPage", "serverComponentChanges", "staticParamsChanged",
  "middlewareChanges", "clientChanges", "serverOnlyChanges", "sync", "built", "building", "turbopack-message", "serverError", "turbopack-connected"]);
const LIFECYCLE_SERVER_PATTERNS = { ABORTED: /(?:^|\n)\s*(?:⨯\s*)?Error: aborted(?:\s|$)/u,
  PIPE_RESPONSE: /failed to pipe response/iu, ECONNRESET: /\bECONNRESET\b/u, PREMATURE_CLOSE: /\bERR_STREAM_PREMATURE_CLOSE\b/u,
  SOCKET_HANG_UP: /socket hang up/iu, HMR_FULL_RELOAD: /Fast Refresh.*full reload/iu,
  WORKER_EXIT: /worker.*(?:exited|SIGKILL|SIGTERM)/iu, FETCH_TERMINATED: /TypeError: terminated/u, CHUNK_LOAD: /ChunkLoadError/u };
export function safeProfileTransportLifecycle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== "evo-profile-transport-lifecycle/v1" || !Array.isArray(value.events)
    || !Array.isArray(value.serverCategories) || typeof value.serverLogAvailable !== "boolean"
    || ["droppedEvents", "ignoredHmrFrames"].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) return null;
  const events = [];
  for (const item of value.events.slice(-256)) {
    if (!item || !LIFECYCLE_EVENTS.has(item.event) || !["DRAFT", "FINAL", "OTHER"].includes(item.phase)
      || !Number.isSafeInteger(item.ms) || item.ms < 0
      || (item.event === "HMR_FRAME" ? !LIFECYCLE_HMR_TYPES.has(item.detail) : item.detail !== null)) return null;
    events.push({ ms: item.ms, event: item.event, phase: item.phase, detail: item.detail });
  }
  const droppedEvents = value.droppedEvents + Math.max(0, value.events.length - 256);
  if (!Number.isSafeInteger(droppedEvents)) return null;
  return { schema: value.schema, events, droppedEvents,
    ignoredHmrFrames: value.ignoredHmrFrames,
    serverLogAvailable: value.serverLogAvailable,
    serverCategories: Object.keys(LIFECYCLE_SERVER_PATTERNS).filter(key => value.serverCategories.includes(key)) };
}
export function profileTransportLifecycleDiagnosticLine(value) {
  const safe = safeProfileTransportLifecycle(value);
  return `STUDENT_PROFILE_FIELDS_TRANSPORT_LIFECYCLE:${safe ? JSON.stringify(safe) : "UNAVAILABLE"}`;
}
function printTransportLifecycleDiagnostic() {
  let value;
  try {
    const file = resolve(env("EVO_D2_EVIDENCE_DIR"), "transport-lifecycle.json");
    const stat = lstatSync(file);
    if (!stat.isSymbolicLink() && stat.isFile() && stat.size <= 64 * 1024) value = JSON.parse(readFileSync(file, "utf8"));
  } catch { /* Optional evidence never replaces the original test verdict. */ }
  process.stderr.write(`${profileTransportLifecycleDiagnosticLine(value)}\n`);
}
export async function observeProfileTransportLifecycle(page, exportUrl, readStage) {
  const started = performance.now(); const events = []; const disposers = []; const captured = new Set();
  let sessionId, droppedEvents = 0, ignoredHmrFrames = 0, active = true;
  const record = (event, detail = null) => {
    if (!active || !LIFECYCLE_EVENTS.has(event)) return;
    const stage = readStage();
    events.push({ ms: Math.round(performance.now() - started), event,
      phase: stage.startsWith("DRAFT_") ? "DRAFT" : stage.startsWith("FINAL_") ? "FINAL" : "OTHER", detail });
    if (events.length > 256) { events.shift(); droppedEvents += 1; }
  };
  const on = (target, name, fn) => { target.on(name, fn); disposers.push(() => target.off(name, fn)); };
  const dispose = () => { active = false; for (const off of disposers) off(); };
  on(page, "request", request => {
    if (request.isNavigationRequest()) {
      try { if (request.frame() === page.mainFrame()) record("NAVIGATION_START"); } catch {}
    }
    if (request.url() === exportUrl && request.method() === "POST") { captured.add(request); record("POST_START"); }
  });
  on(page, "response", response => { if (captured.has(response.request())) record("POST_RESPONSE"); });
  on(page, "requestfinished", request => { if (captured.has(request)) record("POST_FINISHED"); });
  on(page, "requestfailed", request => { if (captured.has(request)) record("POST_FAILED"); });
  on(page, "framenavigated", frame => { if (frame === page.mainFrame()) record("NAVIGATION_COMMIT"); });
  on(page, "console", message => { if (/Fast Refresh.*full reload/iu.test(message.text())) record("HMR_FULL_RELOAD"); });
  on(page, "websocket", socket => {
    let url; try { url = new URL(socket.url()); } catch { return; }
    const expected = new URL(exportUrl);
    if (url.host !== expected.host || url.pathname !== "/_next/hmr") return;
    record("HMR_OPEN");
    on(socket, "close", () => record("HMR_CLOSE")); on(socket, "socketerror", () => record("HMR_ERROR"));
    on(socket, "framereceived", frame => {
      if (typeof frame.payload !== "string" || frame.payload.length > 1024 * 1024) { ignoredHmrFrames += 1; return; }
      let message; try { message = JSON.parse(frame.payload); } catch { ignoredHmrFrames += 1; return; }
      if (!LIFECYCLE_HMR_TYPES.has(message?.type)) { ignoredHmrFrames += 1; return; }
      record("HMR_FRAME", message.type);
      if (message.type === "turbopack-connected" && ["string", "number"].includes(typeof message.data?.sessionId)) {
        if (sessionId !== undefined && sessionId !== message.data.sessionId) record("HMR_SESSION_CHANGED");
        sessionId = message.data.sessionId;
      }
    });
  });
  return { dispose, snapshot: () => safeProfileTransportLifecycle({ schema: "evo-profile-transport-lifecycle/v1",
    events, droppedEvents, ignoredHmrFrames, serverCategories: [], serverLogAvailable: false }) };
}
function writeTransportLifecycle(probe, config) {
  try {
    probe.dispose();
    const value = probe.snapshot();
    try {
      const runtimeDir = realpathSync(env("EVO_D2_RUNTIME_DIR")), logPath = env("EVO_D2_APP_LOG");
      requireProof(/\/evo-database-foundation\.[A-Za-z0-9]+$/u.test(runtimeDir)
        && !lstatSync(logPath).isSymbolicLink() && lstatSync(logPath).isFile()
        && realpathSync(logPath) === resolve(runtimeDir, "app.log") && lstatSync(logPath).size <= 4 * 1024 * 1024, "APP_LOG_NOT_OWNED");
      const raw = readFileSync(logPath, "utf8");
      value.serverCategories = Object.entries(LIFECYCLE_SERVER_PATTERNS).filter(([, pattern]) => pattern.test(raw)).map(([key]) => key);
      value.serverLogAvailable = true;
    } catch { /* An unavailable server log must not erase the browser chronology. */ }
    writeFileSync(resolve(config.evidenceDir, "transport-lifecycle.json"), JSON.stringify(safeProfileTransportLifecycle(value)), { mode: 0o600, flag: "wx" });
  } catch { process.stderr.write("STUDENT_PROFILE_FIELDS_TRANSPORT_LIFECYCLE:UNAVAILABLE\n"); }
}
export async function captureProfileExportResponse(page, button, exportUrl, mark) {
  const finishedRequests = new Set(), failedRequests = new Set();
  let mainFrameNavigations = 0;
  const finished = request => { finishedRequests.add(request); };
  const failed = request => { failedRequests.add(request); };
  const navigated = frame => { if (frame === page.mainFrame()) mainFrameNavigations += 1; };
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  page.on("framenavigated", navigated);
  try {
    // Capture this exact POST immediately. No refetch/retry or replacement response.
    const [captured] = await Promise.all([
      page.waitForResponse(response => response.url() === exportUrl && response.request().method() === "POST").then(async response => {
        requireProof(response.status() === 200, "PERSISTENT_EXPORT_NOT_READY");
        mark("RESPONSE_BODY_READ");
        let bytes;
        try { bytes = await response.body(); }
        catch (error) {
          const request = response.request();
          const transportError = new ProofError("BODY_TRANSPORT");
          transportError.transportDiagnostic = { category: profileBodyTransportCategory(error),
            protocolMethod: profileBodyProtocolMethod(error), requestFailure: profileRequestFailureCategory(request.failure()),
            requestFinished: finishedRequests.has(request), requestFailed: failedRequests.has(request), mainFrameNavigations,
            pageAlive: !page.isClosed(), browserAlive: page.context().browser()?.isConnected() === true };
          mark("BODY_TRANSPORT"); throw transportError;
        }
        let body;
        try { body = JSON.parse(bytes.toString("utf8")); }
        catch { mark("BODY_INVALID_JSON"); throw new ProofError("BODY_INVALID_JSON"); }
        requireProof(body !== null && typeof body === "object" && !Array.isArray(body)
          && Object.keys(body).length === 1 && Object.hasOwn(body, "artifact"), "PERSISTENT_RESPONSE_INVALID");
        return { response, body };
      }),
      button.click(),
    ]);
    return captured;
  } finally {
    page.off("requestfinished", finished);
    page.off("requestfailed", failed);
    page.off("framenavigated", navigated);
  }
}
export function profileExportDiagnosticStage(phase, step) {
  requireProof(["DRAFT", "FINAL", "COLD_DRAFT", "COLD_FINAL"].includes(phase) && [
    "GENERATE_SNAPSHOT", "GENERATE_INVENTORY_BEFORE", "GENERATE_BUTTON_READY", "GENERATE_POST_RESPONSE",
    "GENERATE_RECEIPT", "GENERATE_HISTORY_ROW", "GENERATE_SAVED_MESSAGE", "GENERATE_INVENTORY_AFTER",
    "RESPONSE_BODY_READ", "BODY_TRANSPORT", "BODY_INVALID_JSON", "RECEIPT_NORMALIZE", "COMMAND_READ", "RECEIPT_COMPARE",
    "DOWNLOAD_INVENTORY_BEFORE", "DOWNLOAD_ROW_COUNT", "DOWNLOAD_ROW_READY", "DOWNLOAD_EVENT",
    "DOWNLOAD_FAILURE_CHECK", "DOWNLOAD_FILE_PATH", "DOWNLOAD_DOCX_VERIFY", "DOWNLOAD_STORED_ROW",
    "DOWNLOAD_STORAGE_READBACK", "DOWNLOAD_STORAGE_BYTES", "DOWNLOAD_GRANT", "DOWNLOAD_INVENTORY_AFTER",
    "DOWNLOAD_EVIDENCE_WRITE",
  ].includes(step), "EXPORT_DIAGNOSTIC_STAGE_INVALID");
  return `${phase}_${step}`;
}
export function proofScope(kind = "student-profile-fields") {
  if (kind === "university-template-ingress") return { kind, prefix: "EVO_D4_TEMPLATE", marker: "UNIVERSITY_TEMPLATE_INGRESS" };
  requireProof(["student-profile-fields", "document-recognition"].includes(kind), "PROOF_SCOPE_INVALID");
  return { kind, prefix: kind === "document-recognition" ? "EVO_D3" : "EVO_D2",
    marker: kind === "document-recognition" ? "DOCUMENT_RECOGNITION" : "STUDENT_PROFILE_FIELDS" };
}
function env(name) { const value = process.env[name]; requireProof(typeof value === "string" && value.length > 0, "ENVIRONMENT_MISSING"); return value; }
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  requireProof(!result.error && result.status === 0, "LOCAL_RUNTIME_INSPECTION_FAILED");
  return result.stdout.trim();
}
export function localOrigin(raw) {
  const url = new URL(raw);
  requireProof(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "LOCAL_ORIGIN_INVALID");
  return url.origin;
}

export function proofPathClass(raw, appOrigin) {
  let url;
  try { url = new URL(raw); } catch { return "UNAVAILABLE"; }
  if (url.origin !== appOrigin) return "OTHER_ORIGIN";
  return ({ "/login": "LOGIN", "/v3/main": "MAIN", "/v3/profile": "PROFILE",
    "/platform-pending": "PENDING_ACCESS", "/auth/staff": "STAFF_CALLBACK" })[url.pathname] ?? "OTHER_APP_PATH";
}

export function proofExceptionCategory(error) {
  if (error instanceof ProofError || error instanceof PackageProofError) return "PROOF_ASSERTION";
  // Classify only known Playwright failure shapes. Never retain its raw message,
  // which can include request URLs, selectors or private page values.
  const message = typeof error?.message === "string" ? error.message : "";
  if (message.includes("net::ERR_ABORTED")) return "NAVIGATION_ABORTED";
  if (message.includes("strict mode violation")) return "LOCATOR_AMBIGUOUS";
  if (message.includes("toHaveAttribute")) return "ATTRIBUTE_EXPECTATION";
  const categories = { TimeoutError: "TIMEOUT", AssertionError: "ASSERTION", TypeError: "TYPE_ERROR", Error: "ERROR" };
  return Object.hasOwn(categories, error?.name) ? categories[error.name] : "OTHER_ERROR";
}

export function proofLoginErrorCode(value) {
  return ["accessDenied", "authUnavailable", "staffAccessDenied"].includes(value) ? value : null;
}

// This is an allowlist, not a raw-log redactor. Unknown text is never retained.
const SERVER_ERROR_CLASSES = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError",
  "PlatformStudentHandoffRepositoryError", "PlatformAdmissionsRepositoryError", "PlatformCaseOperationsRepositoryError",
  "PlatformStudentProfileRepositoryError", "PlatformStudentProfileFieldsError", "PlatformPrivateDocumentsRepositoryError",
  "PlatformContractRepositoryError", "PlatformFinanceControlRepositoryError", "HandoffResponseError"]);
const SERVER_STATIC_MESSAGES = new Set(["Platform Student handoff data is unavailable.",
  "Platform admissions data is unavailable.", "Platform case operations data is unavailable.",
  "Platform student profile data is unavailable.", "Student profile fields are unavailable",
  "Platform private-document data is unavailable.", "Platform contract workspace is unavailable.",
  "Platform finance control data is unavailable.", "Handoff response is unavailable.",
  "case_access_unavailable", "case_operations_response_invalid",
  "V3 profile document workspace does not match the requested case.",
  "V3 profile contract workspace does not match the requested case.",
  "V3 profile handoff context does not match the requested case.",
  "V3 profile handoff lead does not match the canonical case link."]);
const SERVER_FRAME_FILES = new Set(["src/lib/platform-student-handoff.ts", "src/lib/platform-admissions.ts",
  "src/lib/platform-case-operations.ts", "src/lib/platform-student-profile.ts", "src/lib/platform-student-profile-fields.ts",
  "src/lib/platform-private-documents.ts", "src/lib/platform-contract-workflow.ts", "src/lib/platform-finance-control.ts",
  "src/lib/platform-handoff-acknowledgement.ts", "src/lib/v3/profile-source.ts", "src/app/(v3)/v3/profile/page.tsx"]);
const SERVER_FRAME_FUNCTIONS = new Set(["failure", "fail", "invalidShape", "oneRow", "failClosed", "requireExactRecord",
  "getPlatformStudentCaseHandoffContext", "normalizePlatformStudentCaseHandoffContext", "normalizeStarterTaskItem",
  "getPlatformCaseFinanceControl", "getPlatformStudentProfile", "getPlatformStudentProfileFields",
  "getPlatformCaseDocumentWorkspace", "getPlatformCaseContractWorkspace", "listPlatformApplicationsForStudentCase",
  "getPlatformCaseVisa", "getHandoffAcknowledgement", "loadFullCase", "readCaseProfile", "readLeadProfile", "readProfileTarget"]);

export function summarizeStudentProfileAppLog(raw) {
  const errorClasses = new Set(); const staticMessages = new Set(); const repositoryFrames = new Map();
  for (const rawLine of String(raw).split("\n")) {
    if (rawLine.length > 4096) continue;
    const line = rawLine.trim();
    const header = /^(?:⨯\s*)?(?:Error \[([A-Za-z]+)\]|([A-Za-z]+)):\s*(.*)$/u.exec(line);
    if (header && SERVER_ERROR_CLASSES.has(header[1] ?? header[2])) {
      errorClasses.add(header[1] ?? header[2]);
      const staticMessage = header[3].replace(/ \{$/u, "");
      if (SERVER_STATIC_MESSAGES.has(staticMessage)) staticMessages.add(staticMessage);
    }
    const frame = /^at (?:async )?([A-Za-z][A-Za-z0-9]*) \((.*):(\d{1,7}):(\d{1,7})\)$/u.exec(line);
    if (!frame || !SERVER_FRAME_FUNCTIONS.has(frame[1]) || repositoryFrames.size >= 12) continue;
    const file = [...SERVER_FRAME_FILES].find(candidate => frame[2] === candidate || frame[2].endsWith(`/${candidate}`));
    if (!file) continue;
    const item = { function: frame[1], file, line: Number(frame[3]), column: Number(frame[4]) };
    repositoryFrames.set(JSON.stringify(item), item);
  }
  return { errorClasses: [...errorClasses].sort(), staticMessages: [...staticMessages].sort(), repositoryFrames: [...repositoryFrames.values()] };
}

export function writeOwnedAppLogDiagnostic(kind = "student-profile-fields") {
  const scope = proofScope(kind);
  try {
    const runtimeDir = realpathSync(env(`${scope.prefix}_RUNTIME_DIR`));
    const logPath = env(`${scope.prefix}_APP_LOG`); const evidencePath = env(`${scope.prefix}_EVIDENCE_DIR`);
    const evidenceDir = realpathSync(evidencePath);
    requireProof(/\/evo-database-foundation\.[A-Za-z0-9]+$/u.test(runtimeDir)
      && !lstatSync(logPath).isSymbolicLink() && lstatSync(logPath).isFile()
      && realpathSync(logPath) === resolve(runtimeDir, "app.log") && lstatSync(logPath).size <= 4 * 1024 * 1024,
    "APP_LOG_NOT_OWNED");
    requireProof(evidenceDir.startsWith(`${REPO}/output/${scope.kind}/`)
      && /^[a-f0-9]{40}\/foundation-[0-9]+-[0-9]+$/u.test(evidenceDir.slice(`${REPO}/output/${scope.kind}/`.length))
      && !lstatSync(evidencePath).isSymbolicLink(), "EVIDENCE_DIRECTORY_INVALID");
    const summary = summarizeStudentProfileAppLog(readFileSync(logPath, "utf8"));
    writeFileSync(resolve(evidenceDir, "server-failure.json"), JSON.stringify({
      schema: scope.kind === "document-recognition" ? "evo-document-recognition-server-failure/v1" : "evo-student-profile-server-failure/v1", synthetic: true, businessAcceptance: false,
      rawLogRetained: false, ...summary,
    }, null, 2), { mode: 0o600, flag: "wx" });
    process.stdout.write(`${scope.marker}_SERVER_DIAGNOSTIC:SAVED\n`);
    process.stdout.write(`${scope.marker}_SERVER_DETAIL:${JSON.stringify(summary)}\n`);
  } catch {
    process.stderr.write(`${scope.marker}_SERVER_DIAGNOSTIC:UNAVAILABLE\n`);
    process.exitCode = 1;
  }
}

export async function writeFailureEvidence({ config, page, stage, error, http, browserErrors, browserWarningCount, counts, runtimeDiagnostics = [] }) {
  if (!config) return;
  const snapshot = { schema: config.proofKind === "university-template-ingress" ? "evo-university-template-ingress-browser-failure/v1"
    : config.proofKind === "document-recognition" ? "evo-document-recognition-browser-failure/v1" : "evo-student-profile-browser-failure/v1", synthetic: true, businessAcceptance: false,
    stage, exceptionCategory: proofExceptionCategory(error), pathClass: "UNAVAILABLE", http,
    consoleErrorCount: counts.console, pageErrorCount: counts.page, browserWarningCount,
    browserErrorCodes: [...browserErrors].sort(), shellPresent: null, actualAdminShell: null,
    passwordControlPresent: null, loginErrorPresent: null, loginErrorCode: null, loginFormPending: null, profileStartControlPresent: null,
    frameworkOverlayPresent: null, screenshotSaved: false };
  const safeRuntime = safeRuntimeDiagnostics(runtimeDiagnostics);
  if (safeRuntime.length) snapshot.runtimeDiagnostics = safeRuntime;
  if (error?.code === "BODY_TRANSPORT") {
    const diagnostic = safeBodyTransportDiagnostic(error.transportDiagnostic);
    if (diagnostic) snapshot.transportDiagnostic = diagnostic;
  }
  if (page && !page.isClosed()) {
    try {
      snapshot.pathClass = proofPathClass(page.url(), config.appOrigin);
      const shell = page.getByTestId("v3-shell");
      snapshot.shellPresent = await shell.count() === 1;
      if (snapshot.shellPresent) snapshot.actualAdminShell = await shell.getAttribute("data-system-role") === "admin"
        && await shell.getAttribute("data-presentation-role") === "actual";
      snapshot.passwordControlPresent = await page.locator('input[type="password"]').count() > 0;
      snapshot.loginErrorPresent = await page.locator("#login-error").count() > 0;
      if (snapshot.loginErrorPresent) {
        const code = await page.locator("#login-error").getAttribute("data-auth-error");
        snapshot.loginErrorCode = proofLoginErrorCode(code);
      }
      const loginForm = page.locator('form[aria-labelledby="login-title"]');
      if (await loginForm.count() === 1) snapshot.loginFormPending = await loginForm.getAttribute("aria-busy") === "true";
      snapshot.profileStartControlPresent = await page.getByRole("button", { name: "Начать анкету", exact: true }).count() > 0;
      snapshot.frameworkOverlayPresent = await page.locator("[data-nextjs-dialog-overlay], [data-nextjs-error-dialog]").count() > 0;
      // Never capture the login screen or a framework error containing raw diagnostics.
      // The only eligible pages belong to this verified isolated synthetic fixture.
      if (snapshot.actualAdminShell && ["MAIN", "PROFILE"].includes(snapshot.pathClass)
        && !snapshot.passwordControlPresent && !snapshot.frameworkOverlayPresent) {
        await page.screenshot({ path: resolve(config.evidenceDir, "failure.png"), fullPage: false,
          timeout: 5_000, mask: [page.locator("input, textarea")] });
        snapshot.screenshotSaved = true;
      }
    } catch { /* A failed page inspection cannot replace the original stage. */ }
  }
  writeFileSync(resolve(config.evidenceDir, "failure.json"), JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: "wx" });
}

export function configuration(kind = "student-profile-fields") {
  const scope = proofScope(kind);
  const profileOnly = scope.kind === "student-profile-fields";
  const deferAcceptance = profileOnly ? process.env.EVO_D2_DEFER_ACCEPTANCE ?? "0" : "0";
  requireProof(["0", "1"].includes(deferAcceptance), "ACCEPTANCE_MODE_INVALID");
  const appOrigin = localOrigin(env(`${scope.prefix}_APP_ORIGIN`));
  const apiOrigin = localOrigin(env("NEXT_PUBLIC_SUPABASE_URL"));
  const workdir = realpathSync(env(`${scope.prefix}_SUPABASE_WORKDIR`));
  requireProof(/\/evo-database-foundation\.[^/]+\/local-supabase$/u.test(workdir), "LOCAL_WORKDIR_INVALID");
  const config = parse(readFileSync(resolve(workdir, "supabase/config.toml"), "utf8"));
  const projectId = config.project_id;
  requireProof(typeof projectId === "string" && /^evo-local-[a-f0-9]{16}$/u.test(projectId), "LOCAL_PROJECT_INVALID");
  const dbUrl = new URL(env("SUPABASE_DB_URL"));
  requireProof(dbUrl.protocol === "postgresql:" && ["127.0.0.1", "localhost"].includes(dbUrl.hostname)
    && Number(dbUrl.port) === config.db.port && dbUrl.pathname === "/postgres" && !dbUrl.search && !dbUrl.hash
    && Number(new URL(apiOrigin).port) === config.api.port && config.auth.site_url === appOrigin, "LOCAL_ENDPOINT_MISMATCH");
  requireProof(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith("unix://"), "LOCAL_RUNTIME_NOT_OWNED");
  const context = run("docker", ["context", "show"]);
  requireProof(run("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"] ).startsWith("unix://"), "LOCAL_RUNTIME_NOT_OWNED");
  if (process.platform === "darwin") requireProof(context === "orbstack" && run("orb", ["status"]) === "Running", "ORBSTACK_REQUIRED");
  for (const service of ["db", "kong", "storage"]) {
    const container = JSON.parse(run("docker", ["inspect", `supabase_${service}_${projectId}`]))[0];
    requireProof(container.State.Running && container.Config.Labels["com.supabase.cli.project"] === projectId
      && container.Config.Labels["com.supabase.cli.workdir"] === workdir, "LOCAL_RUNTIME_NOT_OWNED");
    if (service === "storage") continue; // Storage is reached through verified local Kong.
    const port = service === "db" ? "5432/tcp" : "8000/tcp";
    const bindings = container.NetworkSettings.Ports[port] ?? [];
    requireProof(bindings.some(binding => ["127.0.0.1", "0.0.0.0", "::"].includes(binding.HostIp)
      && Number(binding.HostPort) === (service === "db" ? config.db.port : config.api.port)), "LOCAL_ENDPOINT_MISMATCH");
  }
  const evidenceDir = realpathSync(env(`${scope.prefix}_EVIDENCE_DIR`));
  const relative = evidenceDir.slice(`${REPO}/output/${scope.kind}/`.length);
  requireProof(evidenceDir.startsWith(`${REPO}/output/${scope.kind}/`) && /^[a-f0-9]{40}\/foundation-[0-9]+-[0-9]+$/u.test(relative)
    && !lstatSync(env(`${scope.prefix}_EVIDENCE_DIR`)).isSymbolicLink() && readdirSync(evidenceDir).length === 0, "EVIDENCE_DIRECTORY_INVALID");
  const organizationId = env(`${scope.prefix}_ORGANIZATION_ID`);
  requireProof(UUID.test(organizationId), "ORGANIZATION_INVALID");
  const email = env("EVO_STAFF_AUTH_ADMIN_EMAIL");
  requireProof(/^admin-[a-z0-9-]+@evo\.local\.test$/u.test(email), "SYNTHETIC_ADMIN_REQUIRED");
  return { appOrigin, apiOrigin, dbUrl: dbUrl.toString(), evidenceDir, organizationId, email, proofKind: scope.kind,
    password: env("EVO_STAFF_AUTH_ADMIN_PASSWORD"), publishableKey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    projectId, ...(profileOnly ? { storageServiceKey: env("EVO_D2_STORAGE_SERVICE_KEY"),
      deferAcceptance: deferAcceptance === "1" } : {}) };
}

export async function seedCase(sql, config, client, onStage) {
  const [actor] = await sql`
    SELECT member.id AS membership_id, profile.auth_user_id
    FROM platform.organization_memberships AS member
    JOIN platform.profiles AS profile ON profile.id = member.profile_id
    JOIN auth.users AS auth_user ON auth_user.id = profile.auth_user_id
    WHERE member.organization_id = ${config.organizationId}::uuid
      AND lower(auth_user.email) = ${config.email} AND member.is_system_admin
      AND member.status = 'active' AND profile.status = 'active'
  `;
  requireProof(actor && UUID.test(actor.membership_id), "BOOTSTRAPPED_ADMIN_REQUIRED");
  const login = async () => {
    const session = await client.auth.signInWithPassword({ email: config.email, password: config.password });
    requireProof(!session.error && session.data.user?.id === actor.auth_user_id, "REAL_ADMIN_AUTH_FAILED");
  };
  await login();
  const rpc = async (name, args) => {
    const response = await client.schema("platform").rpc(name, args);
    requireProof(!response.error, "CANONICAL_FIXTURE_RPC_FAILED"); return response.data;
  };
  const command = async (name, args) => {
    const requestId = randomUUID(); const result = await rpc(name, { ...args, p_request_id: requestId });
    requireProof(result && (result.request_id === undefined || result.request_id === requestId), "CANONICAL_FIXTURE_RECEIPT_INVALID");
    return result;
  };
  const recognition = config.proofKind === "document-recognition";
  const reason = recognition ? "Fictional isolated D3 pre-dispatch acceptance; no customer agreement, funds or provider call"
    : "Fictional isolated D2 profile acceptance; no customer agreement or funds";
  const day = new Date().toISOString().slice(0, 10); const changedPermissions = [];
  const personalPermission = async (key, granted) => {
    const receipt = await command("change_membership_permission", { p_organization_id: config.organizationId,
      p_membership_id: actor.membership_id, p_permission_key: key, p_granted: granted, p_reason: reason });
    requireProof(receipt.organization_id === config.organizationId && receipt.membership_id === actor.membership_id
      && receipt.permission_key === key && receipt.granted === granted, "FIXTURE_PERSONAL_GRANT_INVALID");
    await login();
  };
  try {
    onStage("FIXTURE_PERSONAL_PERMISSIONS");
    const directory = await rpc("staff_workspace_directory", { p_organization_id: config.organizationId });
    const members = directory?.members?.filter(member => member.membership_id === actor.membership_id);
    requireProof(members?.length === 1, "FIXTURE_ADMIN_DIRECTORY_INVALID");
    for (const [key, field] of [["contract.evidence.confirm", "contract_confirmation_granted"],
      ["finance.first.payment.confirm", "first_payment_confirmation_granted"]]) {
      requireProof(typeof members[0][field] === "boolean", "FIXTURE_PERSONAL_STATE_INVALID");
      if (!members[0][field]) { changedPermissions.push(key); await personalPermission(key, true); }
    }
    onStage("FIXTURE_LEAD");
    const lead = await command("create_manual_sales_lead", { p_organization_id: config.organizationId,
      p_display_name: recognition ? "D3 Synthetic Browser Student" : "D2 Synthetic Browser Student", p_phone: null,
      p_email: `${recognition ? "d3" : "d2"}-${randomUUID()}@evo.local.test`,
      p_source_key: "other", p_owner_membership_id: actor.membership_id, p_interest_direction: "CN",
      p_next_action: reason, p_next_action_due_date: day });
    requireProof(lead.status === "saved" && UUID.test(lead.lead_id), "FIXTURE_LEAD_INVALID");
    const leadId = lead.lead_id;
    const rows = await rpc("staff_sales_lead_detail", { p_lead_id: leadId });
    requireProof(rows?.length === 1 && rows[0].lead_id === leadId && rows[0].stage_key === "new"
      && rows[0].current_owner_membership_id === actor.membership_id && Number.isSafeInteger(rows[0].workflow_version), "FIXTURE_LEAD_READ_INVALID");
    onStage("FIXTURE_QUALIFY");
    const qualified = await command("mutate_sales_lead_workflow", { p_lead_id: leadId,
      p_expected_workflow_version: rows[0].workflow_version, p_stage_key: "qualified", p_owner_membership_id: actor.membership_id,
      p_next_action_text: reason, p_next_action_due_date: day, p_clear_next_action: false, p_reason: reason });
    requireProof(qualified.lead_id === leadId && qualified.stage_key === "qualified"
      && qualified.workflow_version === rows[0].workflow_version + 1, "FIXTURE_QUALIFICATION_INVALID");
    const readGate = async () => {
      const gates = await rpc("staff_lead_admissions_gate", { p_lead_id: leadId });
      requireProof(gates?.length === 1 && gates[0].lead_id === leadId && gates[0].organization_id === config.organizationId
        && Number.isSafeInteger(gates[0].gate_version), "FIXTURE_GATE_INVALID"); return gates[0];
    };
    onStage("FIXTURE_CONTRACT");
    const initialGate = await readGate();
    await command("mutate_lead_admissions_gate", { p_lead_id: leadId, p_expected_gate_version: initialGate.gate_version,
      p_action: "confirm_contract", p_amount: 1, p_currency: "USD", p_due_date: day, p_received_date: null,
      p_evidence_reference: "Fictional local contract: no customer agreement", p_reason: reason });
    const contractGate = await readGate();
    requireProof(contractGate.contract_confirmed && contractGate.gate_version === initialGate.gate_version + 1, "FIXTURE_CONTRACT_INVALID");
    onStage("FIXTURE_PAYMENT");
    await command("mutate_lead_admissions_gate", { p_lead_id: leadId, p_expected_gate_version: contractGate.gate_version,
      p_action: "confirm_first_payment", p_amount: null, p_currency: null, p_due_date: null, p_received_date: day,
      p_evidence_reference: "Fictional local payment: no funds transferred", p_reason: reason });
    const gate = await readGate();
    requireProof(gate.gate_version === contractGate.gate_version + 1 && gate.gate_state === "satisfied"
      && gate.normal_handoff_allowed === true, "FIXTURE_PAYMENT_INVALID");
    onStage("FIXTURE_HANDOFF");
    const handoff = await command("handoff_lead_to_admissions", { p_lead_id: leadId,
      p_expected_gate_version: gate.gate_version, p_admissions_owner_membership_id: actor.membership_id,
      p_handoff_mode: "normal", p_reason: reason });
    requireProof(UUID.test(handoff.case_id) && handoff.case_state === "active"
      && handoff.admissions_owner_membership_id === actor.membership_id, "FIXTURE_HANDOFF_INVALID");
    const handoffRows = await rpc("staff_student_case_handoff_context", { p_student_case_id: handoff.case_id });
    requireProof(handoffRows?.length === 1 && handoffRows[0].student_case_id === handoff.case_id
      && handoffRows[0].organization_id === config.organizationId && handoffRows[0].lead_id === leadId
      && handoffRows[0].starter_tasks?.length === 3, "FIXTURE_HANDOFF_READ_INVALID");
    return { caseId: handoff.case_id, actor };
  } finally {
    // Personal evidence grants belong only to this disposable Admin; restore them
    // before the D2 UI work. No role catalogue, employee, or provider is changed.
    for (const key of changedPermissions.reverse()) await personalPermission(key, false);
  }
}

export function verifyDocx(bytes, template, { draft, expectedValues }) {
  requireProof(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 5 * 1024 * 1024, "DOCX_SIZE_INVALID");
  const hash = value => createHash("sha256").update(value).digest("hex");
  requireProof(hash(template) === TEMPLATE_HASH, "REFERENCE_TEMPLATE_CHANGED");
  const original = new PizZip(template); const actual = new PizZip(bytes);
  const keys = Object.keys(original.files).sort();
  requireProof(JSON.stringify(Object.keys(actual.files).sort()) === JSON.stringify(keys), "DOCX_PACKAGE_CHANGED");
  for (const key of keys) if (key !== "word/document.xml") requireProof(actual.files[key].asNodeBuffer().equals(original.files[key].asNodeBuffer()), "DOCX_PRESERVE_PART_CHANGED");
  const doc = new DOMParser().parseFromString(actual.file("word/document.xml").asText(), "application/xml");
  const text = Array.from(doc.getElementsByTagName("w:t"), node => node.textContent ?? "").join("\n");
  requireProof(doc.getElementsByTagName("w:tbl").length === 19 && doc.getElementsByTagName("w:sectPr").length === 1, "DOCX_STRUCTURE_CHANGED");
  requireProof(text.includes(DRAFT_WARNING) === draft, "DOCX_DRAFT_MARKER_INVALID");
  for (const value of Object.values(expectedValues)) requireProof(text.includes(value), "DOCX_CONFIRMED_VALUE_MISSING");
  return { sha256: hash(bytes), bytes: bytes.length, draft, tableCount: 19 };
}

/** Read-only prerequisite: never create or repair a bucket from this proof. */
export function verifyDocumentExportBucket(bucket) {
  requireProof(bucket?.id === EXPORT_BUCKET && bucket.public === false
    && bucket.file_size_limit === DOCUMENT_PACKAGE_MAX_BYTES
    && exportBucketMimeTypesValid(bucket.allowed_mime_types), "EXPORT_BUCKET_NOT_READY");
}

/** Independent Storage bytes must agree with both the safe receipt and durable row. */
export function verifyStoredDocumentExport(bytes, receipt, stored, organizationId) {
  requireProof(receipt.state === "ready" && receipt.can_download && stored?.state === "ready"
    && stored.id === receipt.id && stored.receipt_id === receipt.receipt_id
    && stored.student_case_id === receipt.student_case_id && stored.organization_id === organizationId
    && Number(stored.profile_revision) === receipt.profile_revision && stored.mode === receipt.mode
    && stored.template_sha256 === TEMPLATE_HASH && stored.workspace_revision === receipt.workspace_revision
    && stored.input_snapshot_sha256 === receipt.input_snapshot_sha256, "PERSISTENT_RECEIPT_MISMATCH");
  requireProof(stored.bucket_id === EXPORT_BUCKET && stored.bucket_public === false
    && Number(stored.bucket_limit) === DOCUMENT_PACKAGE_MAX_BYTES
    && exportBucketMimeTypesValid(stored.bucket_mimes)
    && UUID.test(stored.storage_object_id) && stored.object_name === `${organizationId}/${receipt.student_case_id}/${receipt.id}.docx`,
  "PERSISTENT_STORAGE_BOUNDARY_INVALID");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  requireProof(bytes.length > 0 && bytes.length <= DOCUMENT_EXPORT_MAX_BYTES
    && bytes.length === receipt.output_bytes && bytes.length === Number(stored.output_bytes)
    && sha256 === receipt.output_sha256 && sha256 === stored.output_sha256, "PERSISTENT_STORAGE_BYTES_MISMATCH");
  return { sha256, bytes: bytes.length, persisted: true, privateStorageReadback: true };
}

async function main() {
  let stage = "CONFIGURATION"; let browser; let sql; let client; let config; let diagnosticPage;
  let transportLifecycle;
  const browserErrors = new Set(); let browserWarningCount = 0;
  const runtimeDiagnostics = [];
  const counts = { console: 0, page: 0 }; const http = { LOGIN: null, MAIN: null, PROFILE: null };
  const recordBrowserError = (kind, text, location, pageTag) => {
    browserErrors.add(kind === "page" ? "PAGE_ERROR" : "CONSOLE_ERROR"); counts[kind] += 1;
    if (runtimeDiagnostics.length < 12) runtimeDiagnostics.push(profileBrowserRuntimeDiagnostic({ kind, text, location, stage, page: pageTag }));
  };
  try {
    config = configuration();
    requireProof(PROFILE_REQUIRED_FIELD_KEYS.length === 9 && PROFILE_REQUIRED_FIELD_KEYS.every(key => Object.hasOwn(SYNTHETIC_REQUIRED_VALUES, key)), "REQUIRED_FIELDS_CHANGED");
    // The service client is local, process-only and used exclusively for independent
    // Storage readback. All profile values still come from the staff session/UI.
    stage = "EXPORT_BUCKET";
    const storage = createClient(config.apiOrigin, config.storageServiceKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
    const bucket = await storage.getBucket(EXPORT_BUCKET);
    requireProof(!bucket.error, "EXPORT_BUCKET_NOT_READY");
    verifyDocumentExportBucket(bucket.data);
    sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
    stage = "FIXTURE";
    client = createClient(config.apiOrigin, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { caseId } = await seedCase(sql, config, client, nextStage => { stage = nextStage; });
    stage = "PROFILE_BASELINE";
    const snapshot = async () => {
      const result = await client.schema("platform").rpc("staff_student_profile_fields", { p_student_case_id: caseId });
      requireProof(!result.error && result.data?.student_case_id === caseId, "PROFILE_SNAPSHOT_FAILED");
      return result.data;
    };
    const field = async key => (await snapshot()).fields.find(item => item.field_key === key);
    requireProof((await snapshot()).profile === null, "PROFILE_NOT_ABSENT");
    const [initialCase] = await sql`SELECT applied_country_requirement_version_id FROM platform.student_cases WHERE id = ${caseId}::uuid`;
    requireProof(initialCase.applied_country_requirement_version_id === null, "CHECKLIST_NOT_ABSENT");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    let observedPageCount = 0;
    context.on("page", page => {
      const pageTag = ["profile_primary", "profile_second", "profile_cold"][observedPageCount++] ?? "profile_other";
      page.on("pageerror", error => recordBrowserError("page", error.stack ?? error.message, undefined, pageTag));
      page.on("console", message => {
        if (message.type() === "error") recordBrowserError("console", message.text(), message.location(), pageTag);
        if (message.type() === "warning") browserWarningCount += 1;
      });
    });
    context.on("response", response => {
      const key = proofPathClass(response.url(), config.appOrigin);
      if (Object.hasOwn(http, key)) http[key] = response.status();
    });
    // No fulfilled/mocked traffic. Third-party origins are simply not exercised.
    await context.route("**/*", route => [config.appOrigin, config.apiOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage(); diagnosticPage = page; page.setDefaultTimeout(30_000);
    if (process.env.EVO_D2_TRANSPORT_LIFECYCLE_DIAGNOSTIC === "1") transportLifecycle = await observeProfileTransportLifecycle(
      page, `${config.appOrigin}/api/v3/student-cases/${caseId}/document-exports`, () => stage);
    stage = "LOGIN_DOCUMENT";
    await page.goto(`${config.appOrigin}/login`, { waitUntil: "domcontentloaded" });
    stage = "LOGIN_EMAIL";
    await page.locator("#staff-email").fill(config.email);
    stage = "LOGIN_PASSWORD";
    await page.locator("#staff-password").fill(config.password);
    stage = "LOGIN_SUBMIT";
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    stage = "AUTHENTICATED_SHELL";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-system-role", "admin");
    stage = "ACTUAL_ROLE";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-presentation-role", "actual");
    const profileUrl = `${config.appOrigin}/v3/profile?case=${caseId}&tab=anketa`;
    stage = "PROFILE_NAVIGATION";
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    stage = "PROFILE_URL";
    await expect(page).toHaveURL(profileUrl);
    stage = "PROFILE_TITLE";
    requireProof((await page.title()).includes("EVO Admissions CRM"), "PAGE_TITLE_INVALID");
    stage = "PROFILE_START_CONTROL";
    await page.getByRole("button", { name: "Начать анкету", exact: true }).waitFor();
    stage = "PROFILE_READ_ONLY";
    requireProof((await snapshot()).profile === null, "PROFILE_READ_CREATED_STATE");
    stage = "START_PROFILE";
    await page.getByRole("button", { name: "Начать анкету", exact: true }).click();
    await expect.poll(async () => (await snapshot()).profile?.revision).toBe(1);
    await expect(page.getByRole("button", { name: "Начать анкету", exact: true })).toHaveCount(0);
    const template = readFileSync(resolve(REPO, "assets/templates/student-profile.docx"));
    const exportUrl = `${config.appOrigin}/api/v3/student-cases/${caseId}/document-exports`;
    const savedRow = (target, mode) => target.locator('[aria-label="Сохранённые файлы"]')
      .getByRole("listitem").filter({ has: target.getByText(mode === "draft" ? "Черновик" : "Финальная анкета", { exact: true }) });
    const inventory = async () => ({
      artifacts: await sql`SELECT id, request_id, state, receipt_id, profile_revision, workspace_revision,
          input_snapshot_sha256, output_sha256, output_bytes, object_name, ready_at
        FROM platform_private.document_export_artifacts
        WHERE organization_id = ${config.organizationId}::uuid AND student_case_id = ${caseId}::uuid ORDER BY id`,
      objects: await sql`SELECT id, name, updated_at FROM storage.objects
        WHERE bucket_id = ${EXPORT_BUCKET} AND name LIKE ${`${config.organizationId}/${caseId}/%`} ORDER BY id`,
      events: await sql`SELECT event.id, event.event_kind FROM platform_private.document_export_events AS event
        JOIN platform_private.document_export_artifacts AS artifact ON artifact.id = event.artifact_id
        WHERE artifact.organization_id = ${config.organizationId}::uuid AND artifact.student_case_id = ${caseId}::uuid ORDER BY event.id`,
    });
    const generate = async mode => {
      const phase = mode === "draft" ? "DRAFT" : "FINAL";
      const mark = step => { stage = profileExportDiagnosticStage(phase, step); };
      mark("GENERATE_SNAPSHOT");
      const before = await snapshot();
      mark("GENERATE_INVENTORY_BEFORE");
      const previous = await inventory();
      let automaticDownload = false;
      const observeDownload = () => { automaticDownload = true; };
      page.on("download", observeDownload);
      const button = page.getByRole("button", { name: mode === "draft" ? "Сформировать черновик" : "Сформировать финальную анкету", exact: true });
      mark("GENERATE_BUTTON_READY");
      await expect(button).toBeEnabled();
      mark("GENERATE_POST_RESPONSE");
      const { response, body } = await captureProfileExportResponse(page, button, exportUrl, mark);
      mark("RECEIPT_NORMALIZE");
      const receipt = normalizeDocumentExportReceipt(body.artifact, caseId);
      mark("COMMAND_READ");
      const command = response.request().postDataJSON();
      mark("RECEIPT_COMPARE");
      requireProof(receipt.state === "ready" && receipt.can_download && receipt.mode === mode
        && receipt.profile_revision === before.profile.revision && receipt.student_profile_id === before.profile.id
        && command.mode === mode && command.expected_workspace_revision === receipt.workspace_revision
        && UUID.test(command.request_id), "PERSISTENT_RECEIPT_MISMATCH");
      mark("GENERATE_HISTORY_ROW");
      await expect(savedRow(page, mode).getByText(/ · Сохранён$/u)).toBeVisible();
      mark("GENERATE_SAVED_MESSAGE");
      await expect(page.getByText("Файл сохранён. Теперь его можно скачать.", { exact: true })).toBeVisible();
      page.off("download", observeDownload);
      requireProof(!automaticDownload, "GENERATION_DOWNLOADED_AUTOMATICALLY");
      mark("GENERATE_INVENTORY_AFTER");
      const current = await inventory();
      requireProof(current.artifacts.length === previous.artifacts.length + 1 && current.objects.length === previous.objects.length + 1,
        "PERSISTENT_EXPORT_COUNT_INVALID");
      return { receipt, command };
    };
    const downloadSaved = async (target, receipt, values, filename, phase) => {
      const mark = step => { stage = profileExportDiagnosticStage(phase, step); };
      mark("DOWNLOAD_INVENTORY_BEFORE");
      const previous = await inventory();
      const row = savedRow(target, receipt.mode);
      mark("DOWNLOAD_ROW_COUNT");
      await expect(row).toHaveCount(1);
      mark("DOWNLOAD_ROW_READY");
      await expect(row.getByText(/ · Сохранён$/u)).toBeVisible();
      mark("DOWNLOAD_EVENT");
      const [file] = await Promise.all([target.waitForEvent("download"), row.getByRole("button", { name: "Скачать файл", exact: true }).click()]);
      mark("DOWNLOAD_FAILURE_CHECK");
      requireProof(await file.failure() === null, "BROWSER_DOWNLOAD_FAILED");
      mark("DOWNLOAD_FILE_PATH");
      const bytes = readFileSync(await file.path());
      mark("DOWNLOAD_DOCX_VERIFY");
      const proof = verifyDocx(bytes, template, { draft: receipt.mode === "draft", expectedValues: values });
      mark("DOWNLOAD_STORED_ROW");
      const [stored] = await sql`SELECT artifact.id, artifact.organization_id, artifact.student_case_id, artifact.state,
          artifact.receipt_id, artifact.profile_revision, artifact.mode, artifact.workspace_revision, artifact.input_snapshot_sha256,
          artifact.output_sha256, artifact.output_bytes, artifact.template_sha256, artifact.bucket_id, artifact.object_name,
          object.id AS storage_object_id, bucket.public AS bucket_public, bucket.file_size_limit AS bucket_limit,
          bucket.allowed_mime_types AS bucket_mimes
        FROM platform_private.document_export_artifacts AS artifact
        JOIN storage.objects AS object ON object.bucket_id = artifact.bucket_id AND object.name = artifact.object_name
        JOIN storage.buckets AS bucket ON bucket.id = object.bucket_id
        WHERE artifact.id = ${receipt.id}::uuid AND artifact.organization_id = ${config.organizationId}::uuid
          AND artifact.student_case_id = ${caseId}::uuid`;
      verifyStoredDocumentExport(bytes, receipt, stored, config.organizationId);
      mark("DOWNLOAD_STORAGE_READBACK");
      const readback = await storage.from(EXPORT_BUCKET).download(stored.object_name);
      requireProof(!readback.error && readback.data, "PERSISTENT_STORAGE_READBACK_FAILED");
      mark("DOWNLOAD_STORAGE_BYTES");
      const storedBytes = Buffer.from(await readback.data.arrayBuffer());
      const storageProof = verifyStoredDocumentExport(storedBytes, receipt, stored, config.organizationId);
      requireProof(storedBytes.equals(bytes), "PERSISTENT_DOWNLOAD_BYTES_CHANGED");
      mark("DOWNLOAD_GRANT");
      const [grant] = await sql`SELECT count(*)::integer AS verified FROM platform_private.document_export_download_grants
        WHERE artifact_id = ${receipt.id}::uuid AND consumed_at IS NOT NULL AND completion ->> 'verified' = 'true'`;
      requireProof(grant.verified > 0, "PERSISTENT_DOWNLOAD_NOT_VERIFIED");
      mark("DOWNLOAD_INVENTORY_AFTER");
      requireProof(JSON.stringify(await inventory()) === JSON.stringify(previous), "DOWNLOAD_CHANGED_ARTIFACT_HISTORY");
      mark("DOWNLOAD_EVIDENCE_WRITE");
      writeFileSync(resolve(config.evidenceDir, filename), bytes, { mode: 0o600, flag: "wx" });
      return { ...proof, ...storageProof };
    };
    stage = "DRAFT_DOWNLOAD";
    await expect(page.getByRole("button", { name: "Сформировать финальную анкету", exact: true })).toBeDisabled();
    const draftExport = await generate("draft");
    const draft = await downloadSaved(page, draftExport.receipt, {}, "draft.docx", "DRAFT");
    const openField = async (target, key) => {
      const definition = PROFILE_FIELDS.find(item => item.key === key);
      const group = target.getByRole("button", { name: new RegExp(`^${PROFILE_GROUP_LABELS[definition.group]} ·`) });
      if (await group.getAttribute("aria-expanded") !== "true") await group.click();
      const toggle = target.locator(`button[aria-controls="profile-field-${key}-editor"]`);
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      return target.locator(`#profile-field-${key}-editor`);
    };
    const confirm = async (target, key, value, expectedValue = value) => {
      const editor = await openField(target, key);
      await editor.locator(`#profile-field-${key}`).fill(value);
      await editor.getByRole("button", { name: "Подтвердить значение", exact: true }).click();
      await expect.poll(async () => { const current = await field(key); return current?.review_state === "confirmed" && current.value === expectedValue; }).toBe(true);
      await expect(editor.getByRole("button", { name: "Использовать актуальное", exact: true })).toHaveCount(0);
    };
    stage = "CONFIRM_REQUIRED_AND_EXTENDED";
    for (const [key, value] of Object.entries(SYNTHETIC_REQUIRED_VALUES)) await confirm(page, key, value, SYNTHETIC_EXPECTED_VALUES[key]);
    await confirm(page, "education_1_school_name", "Example Secondary School");
    stage = "CONFIRMED_EMPTY";
    const emptyEditor = await openField(page, "mother_employer");
    await emptyEditor.getByRole("button", { name: "Оставить поле пустым", exact: true }).click();
    await emptyEditor.getByRole("button", { name: "Подтвердить пустое значение", exact: true }).click();
    await expect.poll(async () => { const current = await field("mother_employer"); return current?.review_state === "confirmed" && current.value === null && current.reviewed_at !== null; }).toBe(true);
    stage = "STALE_SECOND_EDITOR";
    const second = await context.newPage(); diagnosticPage = second; second.setDefaultTimeout(30_000);
    await second.goto(profileUrl, { waitUntil: "domcontentloaded" });
    const secondEditor = await openField(second, "student_last_name");
    const unsaved = "Локальная правка";
    await secondEditor.locator("#profile-field-student_last_name").fill(unsaved);
    await confirm(page, "student_last_name", "Актуальная фамилия");
    const confirmedByFirst = await snapshot();
    await secondEditor.getByRole("button", { name: "Подтвердить значение", exact: true }).click();
    await expect(second.getByRole("button", { name: "Обновить анкету", exact: true })).toBeVisible();
    await expect(secondEditor.locator("#profile-field-student_last_name")).toHaveValue(unsaved);
    requireProof(JSON.stringify(await snapshot()) === JSON.stringify(confirmedByFirst), "STALE_WRITE_CHANGED_DATABASE");
    await second.getByRole("button", { name: "Обновить анкету", exact: true }).click();
    await expect(secondEditor.getByRole("button", { name: "Сверено, оставить мои правки", exact: true })).toBeVisible();
    await expect(secondEditor.locator("#profile-field-student_last_name")).toHaveValue(unsaved);
    await secondEditor.getByRole("button", { name: "Сверено, оставить мои правки", exact: true }).click();
    await secondEditor.getByRole("button", { name: "Подтвердить значение", exact: true }).click();
    await expect.poll(async () => (await field("student_last_name"))?.value).toBe(unsaved);
    requireProof((await field("student_first_name")).value === SYNTHETIC_REQUIRED_VALUES.student_first_name
      && (await field("student_first_name")).review_state === "confirmed", "OTHER_CONFIRMATION_LOST");
    stage = "FINAL_REFRESH_DOCUMENT";
    diagnosticPage = page;
    await page.reload({ waitUntil: "domcontentloaded" });
    stage = "FINAL_REFRESH_FIELD_EDITOR";
    const refreshedEditor = await openField(page, "student_last_name");
    stage = "FINAL_REFRESH_FIELD_VALUE";
    await expect(refreshedEditor.locator("#profile-field-student_last_name")).toHaveValue(unsaved);
    stage = "FINAL_REFRESH_CONFIRMED_EMPTY";
    requireProof((await field("mother_employer")).review_state === "confirmed" && (await field("mother_employer")).value === null, "CONFIRMED_EMPTY_NOT_PERSISTED");
    const finalValues = { ...SYNTHETIC_EXPECTED_VALUES, student_last_name: unsaved, education_1_school_name: "Example Secondary School" };
    stage = "FINAL_REFRESH_EXPORT_READY";
    await expect(page.getByRole("button", { name: "Сформировать финальную анкету", exact: true })).toBeEnabled();
    const finalExport = await generate("final");
    const final = await downloadSaved(page, finalExport.receipt, finalValues, "final.docx", "FINAL");
    stage = "EXACT_REQUEST_REPLAY";
    const beforeReplay = await inventory();
    // A real retry, with the original browser command and current session cookies.
    const replay = await page.request.post(exportUrl, { data: finalExport.command, headers: { origin: config.appOrigin } });
    requireProof(replay.status() === 200, "PERSISTENT_REPLAY_FAILED");
    const replayReceipt = normalizeDocumentExportReceipt((await replay.json()).artifact, caseId, finalExport.receipt.id);
    requireProof(JSON.stringify(replayReceipt) === JSON.stringify(finalExport.receipt)
      && JSON.stringify(await inventory()) === JSON.stringify(beforeReplay), "PERSISTENT_REPLAY_DUPLICATED_OR_CHANGED");
    stage = "COLD_EXPORT_HISTORY";
    const cold = await context.newPage(); diagnosticPage = cold; cold.setDefaultTimeout(30_000);
    const [historyResponse] = await Promise.all([
      cold.waitForResponse(response => response.url() === `${exportUrl}?schema_version=2` && response.request().method() === "GET"),
      cold.goto(profileUrl, { waitUntil: "domcontentloaded" }),
    ]);
    requireProof(historyResponse.status() === 200, "PERSISTENT_COLD_HISTORY_FAILED");
    const history = normalizeDocumentExportWorkspaceV2(await historyResponse.json(), caseId);
    requireProof(history.artifacts.length === 2, "PERSISTENT_COLD_HISTORY_COUNT_INVALID");
    requireProof(history.artifacts.every(row => row.kind === "student_profile"), "PERSISTENT_COLD_HISTORY_KIND_INVALID");
    const historicalDraft = history.artifacts.find(row => row.id === draftExport.receipt.id);
    const currentFinal = history.artifacts.find(row => row.id === finalExport.receipt.id);
    requireProof(historicalDraft?.historical && currentFinal && !currentFinal.historical, "PERSISTENT_HISTORY_REVISION_INVALID");
    await expect(savedRow(cold, "draft").getByText(/^Предыдущая версия анкеты ·/u)).toBeVisible();
    await expect(savedRow(cold, "final").getByText(/^Текущая версия анкеты ·/u)).toBeVisible();
    const coldDraft = await downloadSaved(cold, historicalDraft, {}, "draft-history.docx", "COLD_DRAFT");
    const coldFinal = await downloadSaved(cold, currentFinal, finalValues, "final-history.docx", "COLD_FINAL");
    requireProof(coldDraft.sha256 === draft.sha256 && coldFinal.sha256 === final.sha256
      && JSON.stringify(await inventory()) === JSON.stringify(beforeReplay), "PERSISTENT_COLD_HISTORY_CHANGED_BYTES");
    await cold.screenshot({ path: resolve(config.evidenceDir, "export-history.png"), fullPage: true });
    const persistedPackage = await provePersistedPackage({ browser, page: cold, client, storage, sql, config, caseId,
      finalReceipt: finalExport.receipt, draftReceipt: draftExport.receipt, inventory,
      onStage: value => { stage = value; }, onPage: target => { diagnosticPage = target; },
      onBrowserError: (kind, text, location) => recordBrowserError(kind, text, location, "package_fresh"),
      onBrowserWarning: () => { browserWarningCount += 1; } });
    diagnosticPage = cold;
    await expect(page.locator("[data-nextjs-dialog-overlay], [data-nextjs-error-dialog]")).toHaveCount(0);
    requireProof(browserErrors.size === 0, "BROWSER_RUNTIME_ERRORS");
    await page.screenshot({ path: resolve(config.evidenceDir, "profile-ready.png"), fullPage: true });
    const [databaseState] = await sql`SELECT count(profile.id)::integer AS profiles, max(profile.revision)::integer AS revision
      FROM platform.student_profiles AS profile WHERE profile.student_case_id = ${caseId}::uuid`;
    requireProof(databaseState.profiles === 1 && databaseState.revision === 14, "PROFILE_IDENTITY_OR_REVISION_INVALID");
    const receipt = { schema: "evo-student-profile-browser-proof/v3",
      synthetic: true, businessAcceptance: false, localProjectId: config.projectId, realAdminAuth: true,
      absentProfileWithoutChecklist: true, requiredFieldsConfirmed: 9, extendedFieldConfirmed: true,
      confirmedEmptyPersisted: true, staleEditDraftPreserved: true, otherConfirmationPreserved: true,
      pageIdentityVerified: true, frameworkOverlayAbsent: true, browserErrorCount: 0, browserWarningCount,
      profiles: databaseState.profiles, revision: databaseState.revision, draft, final,
      persistentArtifacts: 3, profileArtifacts: 2, packageArtifacts: 1, persistedPackage,
      generationSeparateFromDownload: true, exactRequestReplayWithoutDuplicate: true,
      coldHistorySameBytes: true, historicalDraftDownload: true, downloadsCreateNoArtifacts: true,
      lostReplyReconciliationExercised: false };
    writeFileSync(resolve(config.evidenceDir, config.deferAcceptance ? "acceptance.pending.json" : "acceptance.json"),
      JSON.stringify(config.deferAcceptance ? { ...receipt, cleanupVerified: false } : receipt, null, 2), { mode: 0o600, flag: "wx" });
    process.stdout.write(config.deferAcceptance ? "STUDENT_PROFILE_FIELDS_BROWSER_RECORDED\n" : "STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED\n");
  } catch (error) {
    try { await writeFailureEvidence({ config, page: diagnosticPage, stage, error, http, browserErrors, browserWarningCount, counts, runtimeDiagnostics }); }
    catch { process.stderr.write("STUDENT_PROFILE_FIELDS_BROWSER_DIAGNOSTIC:UNAVAILABLE\n"); }
    // Never print raw Playwright/Postgres/provider errors, DOM, URLs or credentials.
    process.stderr.write(`STUDENT_PROFILE_FIELDS_BROWSER_ERROR:${error instanceof ProofError || error instanceof PackageProofError ? error.code : stage}\n`);
    process.exitCode = 1;
  } finally {
    if (transportLifecycle && config) writeTransportLifecycle(transportLifecycle, config);
    await browser?.close().catch(() => {});
    client?.auth.stopAutoRefresh();
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--summarize-owned-app-log") writeOwnedAppLogDiagnostic();
  else if (process.argv[2] === "--print-body-transport-diagnostic") printBodyTransportDiagnostic();
  else if (process.argv[2] === "--print-transport-lifecycle-diagnostic") printTransportLifecycleDiagnostic();
  else await main();
}
