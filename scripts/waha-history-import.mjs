#!/usr/bin/env node
// EVO operator CLI: import a fixed window of WhatsApp history (default the last
// 7 days) from WAHA into the CRM Inbox. Part 2 of the history import; the
// database lane (migration 260) is part 1. Runbook: docs/runbooks/whatsapp-history-import.md
//
//   docker exec -i evo-crm-app-1 node scripts/waha-history-import.mjs sync-status --working-since <ISO> --watch
//   docker exec -i evo-crm-app-1 node scripts/waha-history-import.mjs preview --window-to <ISO> --out /tmp/history-preview.jsonl
//   docker exec -i evo-crm-app-1 node scripts/waha-history-import.mjs apply --window-to <ISO> --only-chats-file /tmp/pilot.txt
//   docker exec -i evo-crm-app-1 node scripts/waha-history-import.mjs apply --window-to <ISO> --exclude-chats-file /tmp/personal.txt --preview-file /tmp/history-preview.jsonl
//
// It runs INSIDE the app container and reads the Supabase credentials the app
// already has. The WAHA API key is taken from the Vault runtime binding through
// the same service-role RPC the app's manual send and live status probe use
// (platform.resolve_manual_send_waha_runtime); it is never read from argv,
// never printed and never written anywhere.
//
// Hard rules (each one is a test):
//  * WAHA is only ever READ: GET /api/sessions/crm_primary,
//    GET /api/crm_primary/chats/all/messages (always downloadMedia=false) and
//    GET /api/crm_primary/lids/<lid>. No POST/PUT/DELETE, no media download, no
//    read/seen marker, no send. A request outside that allow-list throws before
//    it leaves the process.
//  * Output carries counts, enums and opaque run ids only: never a chat id, a
//    phone number, a push name, a message text or a key. The only file that holds
//    personal data is the `preview` file (mode 0600, created exclusively, to be
//    deleted after the review).
//  * The import cannot be undone inside the app (migration 260), hence: preview,
//    owner review, a pilot of a few chats, then the rest. `apply` refuses to run
//    without an explicit selection (--only-chats-file, --exclude-chats-file,
//    --max-chats or --all-chats).
//  * Zero dependencies: only node: built-ins, so the file is copied into the
//    runner image as is (see Dockerfile).
//
// WAHA contract (read from devlikeapro/waha at tag 2026.9.2, engine GOWS):
//  * GET /api/{session}/chats/{chatId}/messages, chatId "all" lists every chat:
//    src/api/chats.controller.ts:51 (route prefix) and :126-145 (handler); the
//    GOWS engine skips the jid filter for "all": src/core/engines/gows/
//    session.gows.core.ts:2731.
//  * filter.timestamp.gte / .lte are inclusive Unix SECONDS: src/structures/
//    chats.dto.ts:35 and :44; GOWS passes them to the store at session.gows.core.ts:2749-2756.
//  * limit defaults to 10 (chats.dto.ts:106), so limit is always sent (it has no
//    upper bound in the DTO, chats.dto.ts:102-123); sortBy and
//    sortOrder: chats.dto.ts:114 and src/structures/pagination.dto.ts; downloadMedia:
//    chats.dto.ts:123 (always false here).
//  * Reactions, poll votes, protocol and key-distribution messages are dropped
//    AFTER the SQL LIMIT/OFFSET (session.gows.core.ts:2785 with :2950-2976), so a
//    page can be short or even empty in the middle of the window.
//  * The gows-plus store (WAHA 2026.9.2 pins v1.0.48; read at v1.0.47) sorts by
//    the whole-second timestamp ONLY (src/storage/sqlstorage/message.go:83-84),
//    so rows with equal timestamps can change places between two requests and
//    offset paging can lose or repeat them. The scan therefore never pages by
//    offset: see scanWindow (disjoint time slices at offset 0, settled by two
//    consecutive limits returning the same ids).
//  * In a direct chat GOWS reports from = the chat in BOTH directions and
//    to = null (session.gows.core.ts:3487-3495); source is app|api by device
//    (:3186-3195); the raw id is built from fromMe, chat and message id (:3506-3514).
//  * @lid chats carry no phone in history; GET /api/{session}/lids/{lid} answers
//    {lid, pn|null} (src/api/lids.controller.ts:69-90, gows core :2599-2610).
//  * GET /api/sessions/{session}: status, engine, me {id, lid, jid} (src/api/
//    sessions.controller.ts:80, src/structures/sessions.dto.ts:469-484, src/core/
//    manager.core.ts:585-618).

import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGET_SESSION = "crm_primary";
export const TARGET_BASE_URL = "http://evo-crm-waha:3000";

export const RPC = Object.freeze({
  resolveRuntime: "resolve_manual_send_waha_runtime",
  begin: "begin_waha_history_window_run",
  page: "project_waha_history_window_page",
  finish: "finish_waha_history_window_run",
  preview: "preview_waha_history_window_chat",
});
const ALLOWED_RPC_NAMES = new Set(Object.values(RPC));

const ALLOW_LOCAL_ENVIRONMENT_NAME = "EVO_WAHA_HISTORY_ALLOW_LOCAL_SUPABASE";
const REF_CONTEXT = "evo-waha-history-ref:v1:";
const PREVIEW_FORMAT = "evo-waha-history-preview/1";

export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 31;
export const DEFAULT_WAHA_PAGE_SIZE = 200;
export const DEFAULT_RPC_PAGE_SIZE = 200;
// The database refuses a page above 500 messages or 5 MiB of jsonb; the JSON
// text budget below leaves a wide margin for the jsonb form.
export const RPC_PAGE_MAX_MESSAGES = 500;
export const RPC_PAGE_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_WAHA_PAUSE_MS = 150;
const DEFAULT_RPC_PAUSE_MS = 100;
const DEFAULT_MAX_WINDOW_MESSAGES = 200_000;
// Window scan: disjoint time slices, each read at offset 0 with a growing limit
// until two consecutive limits return the same ids (see scanWindow).
export const DEFAULT_WAHA_SLICE_SECONDS = 3600;
const SCAN_LIMIT_FACTOR = 5;
export const SCAN_MAX_LIMIT = 12_500;
const MAX_SCAN_REQUESTS = 40_000;
const DUPLICATE_RESPONSE_RETRIES = 2;
const MAX_LID_LOOKUPS = 5_000;
const MAX_LIST_FILE_BYTES = 5 * 1024 * 1024;
const MAX_WAHA_RESPONSE_BYTES = 48 * 1024 * 1024;
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
const MAX_RPC_ERROR_BYTES = 16 * 1024;
const RPC_TIMEOUT_MS = 20_000;
const RPC_PAGE_TIMEOUT_MS = 60_000;
const WAHA_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = Object.freeze([500, 1_500, 4_000]);
const MAX_FUTURE_WINDOW_SECONDS = 240;
const STABLE_MIN_WORKING_MINUTES = 10;
const STABLE_MIN_INTERVAL_SECONDS = 180;
const DEFAULT_INTERVAL_SECONDS = 180;

// Closed enums copied from the WAHA docs; any other value is reported as
// UNKNOWN so a hostile response can never inject text into the operator output.
const WAHA_STATUSES = new Set([
  "STOPPED",
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "FAILED",
  "PASSKEY_REQUIRED",
  "PASSKEY_CONFIRMATION_REQUIRED",
]);
const WAHA_ENGINES = new Set(["WEBJS", "WPP", "NOWEB", "GOWS"]);
// Only GOWS is read: chats/all/messages is implemented and checked for it; WEBJS/WPP
// keep only what the browser has loaded, and NOWEB's in-memory store cannot list
// every chat (NOWEB's SQL/Mongo stores can, but nothing here has verified them).
const HISTORY_ENGINES = new Set(["GOWS"]);
const CHAT_OUTCOMES = new Set([
  "import_new",
  "import_existing",
  "skip_nothing_eligible",
  "skip_outbound_only",
  "skip_foreign_conversation",
  "skip_unsupported_chat",
]);
// The chat stays readable after these outcomes; after any other one the rest
// of the chat is NOT sent (a later page could create the conversation without
// the outbound messages that were skipped before its first inbound message).
const CONTINUE_OUTCOMES = new Set([
  "import_new",
  "import_existing",
  "skip_nothing_eligible",
]);

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const LOCAL_SUPABASE_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,512}$/;
const DIRECT_CHAT = /^[0-9]{5,32}@(?:c\.us|lid)$/u;
const PHONE_CHAT = /^[1-9][0-9]{6,14}@c\.us$/u;
const ME_ID = /^[0-9]{5,32}(?::[0-9]{1,5})?@(?:c\.us|lid|s\.whatsapp\.net)$/u;
const CHAT_REF = /^c-[0-9a-f]{16}$/u;
const SQLSTATE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/u;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const UNSAFE_NAME_CHARS =
  /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/gu;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const ERROR_MESSAGES = Object.freeze({
  usage: "usage error; run with --help",
  invalid_environment: "operator environment is invalid",
  interrupted: "interrupted; the run was paused and can be resumed",
  rpc_timeout: "Supabase RPC timed out",
  rpc_transport_failed: "Supabase RPC transport failed",
  rpc_unauthorized: "Supabase rejected the server credential",
  rpc_forbidden: "the database refused the request (service role or intake owner)",
  rpc_not_found: "the RPC is missing; the schema is not at migration 260",
  rpc_rejected: "Supabase RPC rejected the request",
  rpc_response_too_large: "Supabase RPC response is too large",
  rpc_response_invalid: "Supabase RPC response is invalid",
  waha_binding_missing: "the Vault WAHA runtime binding is missing or not ready",
  waha_binding_invalid: "the WAHA runtime binding does not target crm_primary",
  waha_key_rejected: "WAHA rejected the API key",
  waha_unreachable: "WAHA did not answer",
  waha_not_found: "WAHA does not know this request",
  waha_rejected: "WAHA rejected the request",
  waha_response_invalid: "WAHA answered with an unexpected shape",
  waha_response_too_large: "a WAHA response exceeded the size limit",
  waha_request_forbidden: "refusing a WAHA request outside the read-only allow-list",
  session_not_working: "the WAHA session is not WORKING",
  session_me_missing: "WAHA did not report the session's own account",
  engine_unsupported: "history can only be read from the GOWS engine",
  scan_unstable: "WAHA returned an inconsistent history (duplicate or unsettled rows); nothing was imported from this scan",
  window_to_required: "a real import needs an explicit --window-to (pin the same value on every step)",
  list_file_empty: "a chat list file names no chat; use --all-chats to select every chat explicitly",
  window_invalid: "the history window is invalid",
  window_too_large: "the history window holds too many messages; use a shorter window",
  out_file_exists: "the output file already exists; delete it first",
  out_file_failed: "the output file could not be written",
  list_file_invalid: "a chat list or preview file is unreadable",
  list_ref_unmatched: "a listed chat is not in this window",
  list_window_mismatch: "the list was made for another window; use the same --window-to",
  chat_not_reviewed: "a chat of this window is not in the preview file",
  selection_required: "name the chats to import (--only-chats-file, --exclude-chats-file or --all-chats; --max-chats only limits a selection)",
  unfinished_run_exists: "an unfinished history run exists; resume it with --resume <run_id>",
  resume_mismatch: "the unfinished run does not match --resume",
  ref_collision: "two chats produced the same reference",
  output_failed: "operator output failed",
});

export class WahaHistoryImportError extends Error {
  constructor(code, detail = {}) {
    super(ERROR_MESSAGES[code] ?? "WAHA history import failed");
    this.name = "WahaHistoryImportError";
    this.code = code;
    this.retryable = detail.retryable === true;
    this.sqlstate =
      typeof detail.sqlstate === "string" && SQLSTATE.test(detail.sqlstate)
        ? detail.sqlstate
        : null;
    this.runId =
      typeof detail.runId === "string" && CANONICAL_UUID.test(detail.runId)
        ? detail.runId
        : null;
    // The opaque reference (an HMAC, never the chat id) of the chat whose page failed.
    this.chatRef =
      typeof detail.chatRef === "string" && CHAT_REF.test(detail.chatRef) ? detail.chatRef : null;
  }
}

function fail(code, detail) {
  throw new WahaHistoryImportError(code, detail);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deriveUuid(...parts) {
  const bytes = createHash("sha256")
    .update(parts.map(String).join("\u0000"), "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultSleep(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function isoFromSeconds(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function addCounts(target, source) {
  if (!isObject(source)) return;
  for (const [key, value] of Object.entries(source)) {
    if (/^[a-z_]{1,48}$/u.test(key) && Number.isSafeInteger(value) && value >= 0) {
      target[key] = (target[key] ?? 0) + value;
    }
  }
}

function bump(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function sortedObject(source) {
  return Object.fromEntries(
    Object.entries(source).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
}

function normalizeJid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;
  return trimmed.replace(/:[0-9]+@/u, "@").replace(/@s\.whatsapp\.net$/u, "@c.us");
}

function displayName(value) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(UNSAFE_NAME_CHARS, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned === "" ? null : cleaned;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function requireCanonicalUuid(value, code = "invalid_environment") {
  if (
    typeof value !== "string" ||
    !CANONICAL_UUID.test(value) ||
    value === "00000000-0000-0000-0000-000000000000"
  ) {
    fail(code);
  }
  return value;
}

function jwtRole(value) {
  const segments = value.split(".");
  if (segments.length !== 3 || segments[1] === "") return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    return isObject(payload) ? payload.role : null;
  } catch {
    return null;
  }
}

export function loadEnvironment(environment, { needMembership = false } = {}) {
  if (!isObject(environment)) fail("invalid_environment");
  const allowLocal = environment[ALLOW_LOCAL_ENVIRONMENT_NAME] === "1";
  const origin = environment.NEXT_PUBLIC_SUPABASE_URL;
  const originAllowed =
    typeof origin === "string" &&
    (SUPABASE_ORIGIN.test(origin) || (allowLocal && LOCAL_SUPABASE_ORIGIN.test(origin)));
  if (!originAllowed) fail("invalid_environment");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail("invalid_environment");
  }
  if (
    parsed.origin !== origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    fail("invalid_environment");
  }
  const key = environment.EVO_PLATFORM_SUPABASE_SECRET_KEY;
  if (
    typeof key !== "string" ||
    !(SUPABASE_SECRET_KEY.test(key) || jwtRole(key) === "service_role")
  ) {
    fail("invalid_environment");
  }
  const membershipRaw = environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID;
  let intakeMembershipId = null;
  if (needMembership || (typeof membershipRaw === "string" && membershipRaw !== "")) {
    intakeMembershipId = requireCanonicalUuid(membershipRaw);
  }
  return Object.freeze({
    supabaseOrigin: origin,
    supabaseSecretKey: key,
    organizationId: requireCanonicalUuid(environment.EVO_PLATFORM_ORGANIZATION_ID),
    intakeMembershipId,
  });
}

// ---------------------------------------------------------------------------
// Bounded HTTP
// ---------------------------------------------------------------------------

async function readBoundedText(response, signal, maxBytes, tooLargeCode, invalidCode, timeoutCode) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined) {
    if (!/^\d+$/u.test(declared)) fail(invalidCode);
    if (Number(declared) > maxBytes) fail(tooLargeCode);
  }
  if (!response.body || typeof response.body.getReader !== "function") fail(invalidCode);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let abortListener;
  const aborted = new Promise((_, reject) => {
    abortListener = () => reject(new WahaHistoryImportError(timeoutCode, { retryable: true }));
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  });
  aborted.catch(() => {});
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        fail(tooLargeCode);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof WahaHistoryImportError) throw error;
    fail(signal.aborted ? timeoutCode : invalidCode, { retryable: signal.aborted });
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function parseJson(text, invalidCode) {
  try {
    return JSON.parse(text);
  } catch {
    fail(invalidCode);
  }
}

// ---------------------------------------------------------------------------
// Supabase RPC transport
// ---------------------------------------------------------------------------

async function callRpcOnce(context, rpcName, body, { timeoutMs, maxResponseBytes }) {
  const headers = {
    Accept: "application/json",
    "Accept-Profile": "platform",
    apikey: context.supabaseSecretKey,
    "Content-Profile": "platform",
    "Content-Type": "application/json",
  };
  // A legacy service_role JWT is also sent as a bearer token; the sb_secret_
  // format must not be.
  if (jwtRole(context.supabaseSecretKey) === "service_role") {
    headers.Authorization = `Bearer ${context.supabaseSecretKey}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await context.fetchImpl(
        `${context.supabaseOrigin}/rest/v1/rpc/${rpcName}`,
        {
          method: "POST",
          headers,
          redirect: "error",
          signal: controller.signal,
          body: JSON.stringify(body),
        },
      );
    } catch {
      fail(controller.signal.aborted ? "rpc_timeout" : "rpc_transport_failed", {
        retryable: true,
      });
    }
    if (!response) fail("rpc_rejected");
    if (response.status === 200) {
      const text = await readBoundedText(
        response,
        controller.signal,
        maxResponseBytes,
        "rpc_response_too_large",
        "rpc_response_invalid",
        "rpc_timeout",
      );
      return parseJson(text, "rpc_response_invalid");
    }
    // Only the SQLSTATE of an error body is ever read: PostgREST puts row
    // details in `message`/`details`, which must not reach the operator.
    let sqlstate = null;
    try {
      const text = await readBoundedText(
        response,
        controller.signal,
        MAX_RPC_ERROR_BYTES,
        "rpc_rejected",
        "rpc_rejected",
        "rpc_timeout",
      );
      const parsed = JSON.parse(text);
      if (isObject(parsed) && typeof parsed.code === "string" && SQLSTATE.test(parsed.code)) {
        sqlstate = parsed.code;
      }
    } catch {
      sqlstate = null;
    }
    const status = response.status;
    if (sqlstate === "42501") fail("rpc_forbidden", { sqlstate });
    if (status === 401 || status === 403) fail("rpc_unauthorized", { sqlstate });
    if (status === 404) fail("rpc_not_found", { sqlstate });
    const transientClass =
      sqlstate !== null && /^(?:08|53|57)/u.test(sqlstate);
    if (
      status === 429 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      (status >= 500 && (sqlstate === null || transientClass))
    ) {
      fail("rpc_transport_failed", { retryable: true, sqlstate });
    }
    fail("rpc_rejected", { sqlstate });
  } finally {
    clearTimeout(timer);
  }
}

export async function callRpc(
  context,
  rpcName,
  body,
  { timeoutMs = RPC_TIMEOUT_MS, maxResponseBytes = MAX_RPC_RESPONSE_BYTES } = {},
) {
  if (!ALLOWED_RPC_NAMES.has(rpcName)) fail("usage");
  if (typeof context.fetchImpl !== "function") fail("usage");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callRpcOnce(context, rpcName, body, { timeoutMs, maxResponseBytes });
    } catch (error) {
      if (
        !(error instanceof WahaHistoryImportError) ||
        !error.retryable ||
        attempt >= RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await context.sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * The WAHA key and target from the Vault runtime binding, exactly as the app's
 * manual send resolves them. The key stays inside this object.
 */
export async function resolveWahaRuntime(context) {
  const rows = await callRpc(
    context,
    RPC.resolveRuntime,
    { p_organization_id: context.organizationId },
    { maxResponseBytes: 64 * 1024 },
  );
  if (!Array.isArray(rows)) fail("rpc_response_invalid");
  if (rows.length === 0) fail("waha_binding_missing");
  if (rows.length !== 1 || !isObject(rows[0])) fail("rpc_response_invalid");
  const row = rows[0];
  const key = row.waha_api_key;
  if (
    typeof key !== "string" ||
    key.trim() !== key ||
    Buffer.byteLength(key, "utf8") < 16 ||
    Buffer.byteLength(key, "utf8") > 4096 ||
    /[\r\n\0]/u.test(key)
  ) {
    fail("waha_binding_invalid");
  }
  if (row.waha_session_name !== TARGET_SESSION || row.waha_base_url !== TARGET_BASE_URL) {
    fail("waha_binding_invalid");
  }
  return Object.freeze({ apiKey: key, baseUrl: TARGET_BASE_URL });
}

// ---------------------------------------------------------------------------
// WAHA client (read-only)
// ---------------------------------------------------------------------------

const ALLOWED_WAHA_PATHS = Object.freeze([
  /^\/api\/sessions\/crm_primary$/u,
  /^\/api\/crm_primary\/chats\/all\/messages$/u,
  /^\/api\/crm_primary\/lids\/[0-9]{5,32}@lid$/u,
]);

export function isAllowedWahaPath(pathname) {
  return typeof pathname === "string" && ALLOWED_WAHA_PATHS.some((pattern) => pattern.test(pathname));
}

export function createWahaClient({ baseUrl, apiKey, fetchImpl, sleep, pauseMs }) {
  if (typeof fetchImpl !== "function") fail("usage");
  let lastRequestAt = 0;

  async function getJson(pathname, params, { notFoundIsNull = false } = {}) {
    if (!isAllowedWahaPath(pathname)) fail("waha_request_forbidden");
    const query = new URLSearchParams(params);
    if (pathname.endsWith("/messages") && query.get("downloadMedia") !== "false") {
      fail("waha_request_forbidden");
    }
    const url = `${baseUrl}${pathname}${query.size > 0 ? `?${query}` : ""}`;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WAHA_TIMEOUT_MS);
      try {
        const wait = pauseMs - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        let response;
        try {
          response = await fetchImpl(url, {
            method: "GET",
            headers: { Accept: "application/json", "X-Api-Key": apiKey },
            redirect: "error",
            signal: controller.signal,
          });
        } catch {
          fail("waha_unreachable", { retryable: true });
        }
        if (!response) fail("waha_unreachable", { retryable: true });
        const status = response.status;
        if (status === 200) {
          const text = await readBoundedText(
            response,
            controller.signal,
            MAX_WAHA_RESPONSE_BYTES,
            "waha_response_too_large",
            "waha_response_invalid",
            "waha_unreachable",
          );
          return parseJson(text, "waha_response_invalid");
        }
        void response.body?.cancel?.().catch?.(() => {});
        if (status === 401 || status === 403) fail("waha_key_rejected");
        if (status === 404) {
          if (notFoundIsNull) return null;
          fail("waha_not_found");
        }
        if (status === 422 || status === 409) fail("session_not_working");
        if (status === 429 || status >= 500) fail("waha_unreachable", { retryable: true });
        fail("waha_rejected");
      } catch (error) {
        if (
          !(error instanceof WahaHistoryImportError) ||
          !error.retryable ||
          attempt >= RETRY_DELAYS_MS.length
        ) {
          throw error;
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return Object.freeze({
    async getSessionInfo() {
      const body = await getJson(`/api/sessions/${TARGET_SESSION}`, []);
      if (!isObject(body)) fail("waha_response_invalid");
      const status =
        typeof body.status === "string" && WAHA_STATUSES.has(body.status)
          ? body.status
          : "UNKNOWN";
      const rawEngine = isObject(body.engine) ? body.engine.engine : body.engine;
      const engine =
        typeof rawEngine === "string" && WAHA_ENGINES.has(rawEngine) ? rawEngine : "UNKNOWN";
      const me = {};
      if (isObject(body.me)) {
        for (const field of ["id", "lid", "jid"]) {
          const value = body.me[field];
          if (typeof value === "string" && ME_ID.test(value)) me[field] = value;
        }
      }
      return Object.freeze({ status, engine, me: Object.freeze(me) });
    },
    async getWindowPage({ fromSeconds, toSeconds, limit, offset }) {
      const body = await getJson(`/api/${TARGET_SESSION}/chats/all/messages`, [
        ["filter.timestamp.gte", String(fromSeconds)],
        ["filter.timestamp.lte", String(toSeconds)],
        ["sortBy", "timestamp"],
        ["sortOrder", "asc"],
        ["limit", String(limit)],
        ["offset", String(offset)],
        ["downloadMedia", "false"],
      ]);
      if (!Array.isArray(body)) fail("waha_response_invalid");
      return body;
    },
    async getLidPhone(lid) {
      const body = await getJson(`/api/${TARGET_SESSION}/lids/${lid}`, [], {
        notFoundIsNull: true,
      });
      if (body === null) return null;
      if (!isObject(body)) fail("waha_response_invalid");
      return typeof body.pn === "string" ? body.pn : null;
    },
  });
}

// ---------------------------------------------------------------------------
// Messages and chats
// ---------------------------------------------------------------------------

function pruneUndefined(source) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function clip(value, maximum) {
  return typeof value === "string" ? value.slice(0, maximum) : undefined;
}

function nonEmpty(value) {
  return isObject(value) && Object.keys(value).length > 0 ? value : undefined;
}

/**
 * The REST message reduced to the fields migration 260 keeps (its
 * waha_history_allowlist_message): the database drops everything else, so the
 * reduction only saves memory and request size (a GOWS message carries its
 * protobuf body, quoted message and thumbnails). Bodies are never cut: the
 * database refuses a body above 100000 characters instead of storing half.
 */
export function slimMessage(raw) {
  const data = isObject(raw._data) ? raw._data : {};
  const info = isObject(data.Info) ? data.Info : {};
  const inner = isObject(data.Message) ? data.Message : {};
  const slim = pruneUndefined({
    id: clip(raw.id, 1000),
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : undefined,
    from: clip(raw.from, 256),
    to: clip(raw.to, 256),
    fromMe: typeof raw.fromMe === "boolean" ? raw.fromMe : undefined,
    source: clip(raw.source, 16),
    body: typeof raw.body === "string" ? raw.body : undefined,
    hasMedia: typeof raw.hasMedia === "boolean" ? raw.hasMedia : undefined,
    media: isObject(raw.media)
      ? pruneUndefined({
          mimetype: clip(raw.media.mimetype, 128),
          filename: clip(raw.media.filename, 256),
        })
      : undefined,
  });
  const slimData = pruneUndefined({
    type: clip(data.type, 32),
    mimetype: clip(data.mimetype, 128),
    filename: clip(data.filename, 256),
    from: clip(data.from, 256),
    to: clip(data.to, 256),
    id: isObject(data.id) ? nonEmpty(pruneUndefined({ remote: clip(data.id.remote, 256) })) : undefined,
    notifyName: clip(data.notifyName, 200),
    pushName: clip(data.pushName, 200),
    Info: nonEmpty(
      pruneUndefined({
        Chat: clip(info.Chat, 256),
        Sender: clip(info.Sender, 256),
        IsFromMe: typeof info.IsFromMe === "boolean" ? info.IsFromMe : undefined,
        SenderAlt: clip(info.SenderAlt, 256),
        RecipientAlt: clip(info.RecipientAlt, 256),
        PushName: clip(info.PushName, 200),
      }),
    ),
    key: isObject(data.key)
      ? nonEmpty(pruneUndefined({ remoteJidAlt: clip(data.key.remoteJidAlt, 256) }))
      : undefined,
    Message: nonEmpty(
      pruneUndefined({
        stickerMessage: isObject(inner.stickerMessage) ? {} : undefined,
        documentMessage: isObject(inner.documentMessage) ? {} : undefined,
        audioMessage: isObject(inner.audioMessage)
          ? inner.audioMessage.PTT === true
            ? { PTT: true }
            : {}
          : undefined,
        imageMessage: isObject(inner.imageMessage) ? {} : undefined,
        videoMessage: isObject(inner.videoMessage)
          ? inner.videoMessage.gifPlayback === true
            ? { gifPlayback: true }
            : {}
          : undefined,
        ptvMessage: isObject(inner.ptvMessage) ? {} : undefined,
      }),
    ),
  });
  if (Object.keys(slimData).length > 0) slim._data = slimData;
  return slim;
}

/** The phone of an @lid chat as the alternative field the live webhook carries. */
export function withPhoneAlternative(slim, phoneChat) {
  const data = isObject(slim._data) ? { ...slim._data } : {};
  const info = isObject(data.Info) ? { ...data.Info } : {};
  const field = slim.fromMe === true ? "RecipientAlt" : "SenderAlt";
  if (typeof info[field] !== "string" || info[field] === "") info[field] = phoneChat;
  data.Info = info;
  return { ...slim, _data: data };
}

/**
 * The direct chat of one WAHA REST message, or null for a group, Status,
 * broadcast list or channel. GOWS reports from = the chat in both directions
 * and to = null; NOWEB reports to = the chat for a message the account sent.
 */
export function chatKeyOf(raw) {
  if (typeof raw.participant === "string" && raw.participant !== "") return null;
  const from = normalizeJid(raw.from);
  const to = normalizeJid(raw.to);
  const candidate = raw.fromMe === true && to !== null ? to : from;
  return candidate !== null && DIRECT_CHAT.test(candidate) ? candidate : null;
}

function ownIdSet(me) {
  const own = new Set();
  for (const value of [me?.id, me?.lid, me?.jid]) {
    const normalized = normalizeJid(value);
    if (normalized !== null) own.add(normalized);
  }
  return own;
}

export function createChatIndex({ ownIds = new Set(), fromSeconds, toSeconds, retain = true }) {
  const chats = new Map();
  const stats = {
    rows: 0,
    invalid: 0,
    outside_window: 0,
    direction_unverified: 0,
    non_direct: 0,
    own_chat: 0,
    duplicate: 0,
    crm_send: 0,
    api_source: 0,
    kept: 0,
  };

  function add(raw) {
    stats.rows += 1;
    if (!isObject(raw)) {
      stats.invalid += 1;
      return "invalid";
    }
    // Ids are compared trimmed, as the database does: two whitespace variants of
    // one id are one message.
    const id = typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id.trim() : null;
    const timestamp =
      typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
        ? Math.floor(raw.timestamp)
        : null;
    if (id === null || timestamp === null || timestamp < 1230768000 || timestamp > 4102444800) {
      stats.invalid += 1;
      return "invalid";
    }
    if (timestamp > toSeconds) {
      stats.outside_window += 1;
      return "beyond";
    }
    if (timestamp < fromSeconds) {
      stats.outside_window += 1;
      return "before";
    }
    if (typeof raw.fromMe !== "boolean") {
      stats.direction_unverified += 1;
      return "direction_unverified";
    }
    const key = chatKeyOf(raw);
    if (key === null) {
      stats.non_direct += 1;
      return "non_direct";
    }
    if (ownIds.has(key)) {
      stats.own_chat += 1;
      return "own_chat";
    }
    const source = typeof raw.source === "string" ? raw.source.trim().toLowerCase() : "";
    let chat = chats.get(key);
    if (!chat) {
      chat = {
        key,
        kind: key.endsWith("@lid") ? "lid" : "c_us",
        ids: new Set(),
        messages: [],
        inbound: 0,
        outbound: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        pushName: null,
        pushNameTimestamp: -1,
      };
      chats.set(key, chat);
    }
    if (chat.ids.has(id)) {
      stats.duplicate += 1;
      return "duplicate";
    }
    chat.ids.add(id);
    // The CRM's own API sends (and API-source inbound) are skipped by the
    // database anyway; they are counted here and never sent.
    if (source === "api") {
      stats.crm_send += raw.fromMe ? 1 : 0;
      stats.api_source += raw.fromMe ? 0 : 1;
      return "api";
    }
    if (raw.fromMe) chat.outbound += 1;
    else chat.inbound += 1;
    chat.firstTimestamp =
      chat.firstTimestamp === null ? timestamp : Math.min(chat.firstTimestamp, timestamp);
    chat.lastTimestamp =
      chat.lastTimestamp === null ? timestamp : Math.max(chat.lastTimestamp, timestamp);
    stats.kept += 1;
    if (retain) {
      const slim = slimMessage(raw);
      slim.id = id;
      chat.messages.push(slim);
      if (!raw.fromMe && timestamp >= chat.pushNameTimestamp) {
        const name = displayName(slim._data?.Info?.PushName ?? slim._data?.notifyName ?? slim._data?.pushName);
        if (name !== null) {
          chat.pushName = name;
          chat.pushNameTimestamp = timestamp;
        }
      }
    }
    return "kept";
  }

  function finalize() {
    const ordered = [...chats.values()];
    for (const chat of ordered) {
      chat.messages.sort((left, right) =>
        left.timestamp !== right.timestamp
          ? left.timestamp - right.timestamp
          : left.id < right.id
            ? -1
            : 1,
      );
    }
    // Most recent chat first; the order is a pure function of the window's
    // content, so a resumed run (cursor = position in this list) sees the same
    // list. Chats that never carry a kept message (only API sends) are listed
    // last and never selected.
    ordered.sort((left, right) => {
      const l = left.lastTimestamp ?? -1;
      const r = right.lastTimestamp ?? -1;
      if (l !== r) return r - l;
      return left.key < right.key ? -1 : 1;
    });
    ordered.forEach((chat, position) => {
      chat.index = position;
    });
    return ordered;
  }

  return Object.freeze({ add, finalize, stats, chats });
}

class SliceSaturated extends Error {}

function trimmedId(raw) {
  return isObject(raw) && typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id.trim() : null;
}

function sameIds(left, right) {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * Read the whole window through chats/all/messages, tie-safe and without relying
 * on offset paging.
 *
 * Why not offset paging: WAHA/gows-plus sorts by the whole-second timestamp only,
 * so rows with equal timestamps can change places between two requests (rows are
 * lost or repeated at a page boundary), and reactions, poll votes and protocol
 * rows are dropped AFTER the SQL LIMIT, so a page can be short or empty in the
 * middle of the window and its true row count is invisible.
 *
 * What is done instead: the window is cut into disjoint slices of whole seconds
 * (every request is gte = slice start, lte = slice end, offset 0, so equal
 * timestamps inside a slice are returned together in any order). A slice is
 * accepted only when two consecutive requests, the second with a 5x larger limit,
 * return exactly the same ids; if not (the limit cut the slice, or hidden
 * non-message rows pushed real rows out), the limit grows again, and a slice that
 * is still unsettled at the largest limit (or whose response is too large) is
 * split in two. A single second that cannot settle, a row that appears in two
 * slices, a row repeated inside one response, or a response outside the slice
 * (a server that ignores the filter) fails with an error instead of importing a
 * partial window. There is no stop-on-empty rule: every second of the window is
 * covered by exactly one slice. Residual risk (documented): hundreds of
 * consecutive non-message rows inside one slice hiding real rows from both of two
 * consecutive limits.
 */
export async function scanWindow({
  waha,
  index,
  fromSeconds,
  toSeconds,
  baseLimit,
  sliceSeconds = DEFAULT_WAHA_SLICE_SECONDS,
  maxLimit = SCAN_MAX_LIMIT,
  maxMessages,
  signal,
}) {
  const stats = { requests: 0, slices: 0, splits: 0, retries: 0 };
  const seen = new Set();

  async function fetchSlice(start, end, limit) {
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) fail("interrupted");
      if (stats.requests >= MAX_SCAN_REQUESTS) fail("window_too_large");
      stats.requests += 1;
      let rows;
      try {
        rows = await waha.getWindowPage({
          fromSeconds: start,
          toSeconds: end,
          limit,
          offset: 0,
        });
      } catch (error) {
        if (error instanceof WahaHistoryImportError && error.code === "waha_response_too_large") {
          throw new SliceSaturated();
        }
        throw error;
      }
      const ids = new Map();
      const anonymous = [];
      let repeated = false;
      for (const raw of rows) {
        if (
          isObject(raw) &&
          typeof raw.timestamp === "number" &&
          Number.isFinite(raw.timestamp) &&
          (raw.timestamp < start || raw.timestamp >= end + 1)
        ) {
          // The server did not apply the window filter: nothing it returns can be trusted to be complete.
          fail("waha_response_invalid");
        }
        const id = trimmedId(raw);
        if (id === null) {
          anonymous.push(raw);
        } else if (ids.has(id)) {
          repeated = true;
        } else {
          ids.set(id, raw);
        }
      }
      if (!repeated) return { ids, anonymous };
      stats.retries += 1;
      if (attempt >= DUPLICATE_RESPONSE_RETRIES) fail("scan_unstable");
    }
  }

  async function readSlice(start, end) {
    const union = new Map();
    let previous = null;
    let limit = baseLimit;
    for (;;) {
      const { ids, anonymous } = await fetchSlice(start, end, limit);
      const current = new Set(ids.keys());
      for (const [id, raw] of ids) if (!union.has(id)) union.set(id, raw);
      if (previous !== null && sameIds(previous, current)) return [...union.values(), ...anonymous];
      previous = current;
      if (limit >= maxLimit) throw new SliceSaturated();
      limit = Math.min(limit * SCAN_LIMIT_FACTOR, maxLimit);
    }
  }

  async function processSlice(start, end) {
    let rows;
    try {
      rows = await readSlice(start, end);
    } catch (error) {
      if (!(error instanceof SliceSaturated)) throw error;
      if (start >= end) fail("scan_unstable");
      stats.splits += 1;
      const middle = Math.floor((start + end) / 2);
      await processSlice(start, middle);
      await processSlice(middle + 1, end);
      return;
    }
    stats.slices += 1;
    for (const raw of rows) {
      const id = trimmedId(raw);
      if (id !== null) {
        // Slices are disjoint: one id in two slices means the timestamps are not stable.
        if (seen.has(id)) fail("scan_unstable");
        seen.add(id);
      }
      index.add(raw);
    }
    if (index.stats.rows > maxMessages) fail("window_too_large");
  }

  for (let start = fromSeconds; start <= toSeconds; start += sliceSeconds) {
    await processSlice(start, Math.min(start + sliceSeconds - 1, toSeconds));
  }
  return { requests: stats.requests, slices: stats.slices, splits: stats.splits, retries: stats.retries };
}

// ---------------------------------------------------------------------------
// Chat references, lists and selection
// ---------------------------------------------------------------------------

export function chatRef(secret, chatKey) {
  return `c-${createHmac("sha256", secret).update(`${REF_CONTEXT}${chatKey}`, "utf8").digest("hex").slice(0, 16)}`;
}

function assignRefs(chats, secret) {
  const seen = new Set();
  for (const chat of chats) {
    chat.ref = chatRef(secret, chat.key);
    if (seen.has(chat.ref)) fail("ref_collision");
    seen.add(chat.ref);
  }
}

/**
 * A chat list: either a plain text file (one reference per line, `#` comments)
 * or lines of the preview file (JSON with `ref`; the `meta` line names the
 * window it was made for).
 */
export function parseChatList(text) {
  const refs = new Set();
  let meta = null;
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.length > 4096) fail("list_file_invalid");
    if (trimmed.startsWith("{")) {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        fail("list_file_invalid");
      }
      if (isObject(parsed) && isObject(parsed.meta)) {
        if (parsed.meta.format !== PREVIEW_FORMAT) fail("list_file_invalid");
        meta = parsed.meta;
        continue;
      }
      if (!isObject(parsed) || typeof parsed.ref !== "string" || !CHAT_REF.test(parsed.ref)) {
        fail("list_file_invalid");
      }
      refs.add(parsed.ref);
      continue;
    }
    const token = trimmed.split(/\s+/u)[0];
    if (!CHAT_REF.test(token)) fail("list_file_invalid");
    refs.add(token);
  }
  return { refs, meta };
}

function readChatListFile(path) {
  let text;
  try {
    if (statSync(path).size > MAX_LIST_FILE_BYTES) fail("list_file_invalid");
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof WahaHistoryImportError) throw error;
    fail("list_file_invalid");
  }
  const list = parseChatList(text);
  // An empty or comment-only file would select (or exclude) nothing without saying so.
  if (list.refs.size === 0) fail("list_file_empty");
  return list;
}

function checkListWindow(list, window) {
  if (
    list.meta &&
    (list.meta.window_from !== window.from || list.meta.window_to !== window.to)
  ) {
    fail("list_window_mismatch");
  }
}

function checkListMatched(list, chatsByRef) {
  for (const ref of list.refs) {
    if (!chatsByRef.has(ref)) fail("list_ref_unmatched");
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function parseIsoInstantSeconds(value) {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) fail("window_invalid");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail("window_invalid");
  return Math.floor(milliseconds / 1000);
}

export function computeWindow({ days, windowTo, now }) {
  const nowSeconds = Math.floor(now().getTime() / 1000);
  const toSeconds = windowTo === null || windowTo === undefined
    ? nowSeconds
    : parseIsoInstantSeconds(windowTo);
  const spanDays = days ?? DEFAULT_DAYS;
  if (!Number.isInteger(spanDays) || spanDays < 1 || spanDays > MAX_DAYS) fail("window_invalid");
  if (toSeconds > nowSeconds + MAX_FUTURE_WINDOW_SECONDS) fail("window_invalid");
  const fromSeconds = toSeconds - spanDays * 86_400;
  return Object.freeze({
    fromSeconds,
    toSeconds,
    from: isoFromSeconds(fromSeconds),
    to: isoFromSeconds(toSeconds),
    toDefaulted: windowTo === null || windowTo === undefined,
  });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * Split one chat's chronological messages into database pages. The first page
 * of a chat is extended up to its first customer message when that fits
 * (migration 260 creates a conversation from a chat's first inbound message and
 * would otherwise lose the outbound messages that precede it). Returns
 * {pages, dropped, firstInboundUnreachable}.
 */
export function buildPages(messages, startOffset, { pageSize, maxMessages, maxBytes, firstPageMinimum }) {
  const pages = [];
  let current = null;
  let dropped = 0;
  const limitFor = (isFirst) =>
    isFirst && startOffset === 0 ? Math.min(maxMessages, Math.max(pageSize, firstPageMinimum)) : pageSize;
  for (let position = startOffset; position < messages.length; position += 1) {
    const size = Buffer.byteLength(JSON.stringify(messages[position]), "utf8") + 1;
    if (size > maxBytes) {
      dropped += 1;
      if (current) current.endOffset = position + 1;
      continue;
    }
    if (
      current &&
      (current.messages.length >= limitFor(pages.length === 0) || current.bytes + size > maxBytes)
    ) {
      pages.push(current);
      current = null;
    }
    if (!current) current = { startOffset: position, endOffset: position, messages: [], bytes: 0 };
    current.messages.push(messages[position]);
    current.bytes += size;
    current.endOffset = position + 1;
  }
  if (current) pages.push(current);
  if (pages.length > 0) pages[pages.length - 1].endOffset = messages.length;
  return { pages, dropped };
}

function firstInboundMinimum(chat) {
  const position = chat.messages.findIndex((message) => message.fromMe === false);
  return position < 0 ? 0 : position + 1;
}

// ---------------------------------------------------------------------------
// Shared preparation: preflight, scan, selection
// ---------------------------------------------------------------------------

function assertSessionReady(session) {
  if (session.status !== "WORKING") fail("session_not_working");
  if (!HISTORY_ENGINES.has(session.engine)) fail("engine_unsupported");
}

function buildContext({ environment, config, fetchImpl, sleep }) {
  return {
    supabaseOrigin: config.supabaseOrigin,
    supabaseSecretKey: config.supabaseSecretKey,
    organizationId: config.organizationId,
    intakeMembershipId: config.intakeMembershipId,
    fetchImpl,
    sleep,
    environment,
  };
}

async function openSession({ context, wahaFetchImpl, sleep, wahaPauseMs, requireMe = true }) {
  const runtime = await resolveWahaRuntime(context);
  const waha = createWahaClient({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    fetchImpl: wahaFetchImpl,
    sleep,
    pauseMs: wahaPauseMs,
  });
  const session = await waha.getSessionInfo();
  assertSessionReady(session);
  if (requireMe && typeof session.me.id !== "string") fail("session_me_missing");
  return { waha, session };
}

async function readWindow({
  waha,
  session,
  window,
  pageSize,
  sliceSeconds,
  maxMessages,
  signal,
  retain,
}) {
  const index = createChatIndex({
    ownIds: ownIdSet(session.me),
    fromSeconds: window.fromSeconds,
    toSeconds: window.toSeconds,
    retain,
  });
  const scan = await scanWindow({
    waha,
    index,
    fromSeconds: window.fromSeconds,
    toSeconds: window.toSeconds,
    baseLimit: pageSize,
    sliceSeconds,
    maxMessages,
    signal,
  });
  return { index, scan, chats: index.finalize() };
}

function runOptions({ session, includeOutboundOnly, leadMode }) {
  const me = {};
  for (const field of ["id", "lid", "jid"]) {
    if (typeof session.me[field] === "string") me[field] = session.me[field];
  }
  return {
    include_outbound_only: includeOutboundOnly === true,
    lead_mode: leadMode ?? "promote",
    me,
  };
}

function isCandidate(chat, includeOutboundOnly) {
  return chat.messages.length > 0 && (chat.inbound > 0 || includeOutboundOnly === true);
}

/** Phone of an @lid chat from WAHA's own mapping; null when it knows none or it is the own number. */
async function resolveChatPhone({ chat, waha, ownIds, state }) {
  if (chat.kind !== "lid") return null;
  if (chat.phoneResolved) return chat.phone;
  if (state.lookups >= MAX_LID_LOOKUPS) {
    chat.phoneResolved = true;
    chat.phone = null;
    return null;
  }
  state.lookups += 1;
  const raw = await waha.getLidPhone(chat.key);
  const normalized = normalizeJid(raw);
  chat.phoneResolved = true;
  chat.phone =
    normalized !== null && PHONE_CHAT.test(normalized) && !ownIds.has(normalized)
      ? normalized
      : null;
  return chat.phone;
}

function chatMessagesForDatabase(chat) {
  return chat.phone ? chat.messages.map((message) => withPhoneAlternative(message, chat.phone)) : chat.messages;
}

function lastDigits(chat) {
  const source = chat.kind === "c_us" ? chat.key : chat.phone;
  if (typeof source !== "string") return null;
  const digits = source.split("@")[0];
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function numberOrZero(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function validatePreviewVerdict(value) {
  if (!isObject(value)) fail("rpc_response_invalid");
  const outcome = typeof value.chat_outcome === "string" && CHAT_OUTCOMES.has(value.chat_outcome)
    ? value.chat_outcome
    : "unknown";
  const skipped = {};
  addCounts(skipped, value.skipped);
  return {
    outcome,
    chatKind: value.chat_kind === "lid" ? "lid" : value.chat_kind === "c_us" ? "c_us" : "unsupported",
    wouldCreateConversation: value.would_create_conversation === true,
    conversationExists: value.conversation_exists === true,
    matchesActiveClient: value.matches_active_client_phone === true,
    lidChatHasPhone: value.lid_chat_has_phone === true,
    received: numberOrZero(value.received),
    wouldImport: numberOrZero(value.would_import),
    wouldImportInbound: numberOrZero(value.would_import_inbound),
    wouldImportOutbound: numberOrZero(value.would_import_outbound),
    wouldImportMedia: numberOrZero(value.would_import_media),
    alreadyBound: numberOrZero(value.already_bound),
    skipped,
  };
}

async function previewFirstPage({ context, chat, window, options, pageSize, includeOutboundOnly }) {
  const messages = chatMessagesForDatabase(chat);
  const { pages } = buildPages(messages, 0, {
    pageSize,
    maxMessages: RPC_PAGE_MAX_MESSAGES,
    maxBytes: RPC_PAGE_MAX_BYTES,
    firstPageMinimum: includeOutboundOnly ? 0 : firstInboundMinimum(chat),
  });
  const first = pages[0];
  if (!first) return { verdict: null, pageCount: 0 };
  const response = await callRpc(
    context,
    RPC.preview,
    {
      p_organization_id: context.organizationId,
      p_waha_session_name: TARGET_SESSION,
      p_raw_chat_id: chat.key,
      p_messages: first.messages,
      p_window_from: window.from,
      p_window_to: window.to,
      p_options: options,
    },
    { timeoutMs: RPC_PAGE_TIMEOUT_MS },
  );
  const rest = buildPages(messages, first.endOffset, {
    pageSize,
    maxMessages: RPC_PAGE_MAX_MESSAGES,
    maxBytes: RPC_PAGE_MAX_BYTES,
    firstPageMinimum: 0,
  });
  return {
    verdict: validatePreviewVerdict(response),
    pageCount: 1 + rest.pages.length,
  };
}

function newPreviewTotals() {
  return {
    chats_total: 0,
    chats_candidates: 0,
    chats_outbound_only: 0,
    chats_lid: 0,
    chats_lid_with_phone: 0,
    chats_existing_client_match: 0,
    chats_multi_page: 0,
    messages_inbound: 0,
    messages_outbound: 0,
    first_page_would_import: 0,
    first_page_would_import_inbound: 0,
    first_page_would_import_outbound: 0,
    first_page_would_import_media: 0,
    first_page_already_bound: 0,
    later_page_messages: 0,
    by_outcome: {},
    skipped: {},
  };
}

function tallyVerdict(totals, chat, verdict, pageCount) {
  bump(totals.by_outcome, verdict.outcome);
  totals.first_page_would_import += verdict.wouldImport;
  totals.first_page_would_import_inbound += verdict.wouldImportInbound;
  totals.first_page_would_import_outbound += verdict.wouldImportOutbound;
  totals.first_page_would_import_media += verdict.wouldImportMedia;
  totals.first_page_already_bound += verdict.alreadyBound;
  addCounts(totals.skipped, verdict.skipped);
  if (verdict.matchesActiveClient) totals.chats_existing_client_match += 1;
  if (pageCount > 1) {
    totals.chats_multi_page += 1;
    totals.later_page_messages += Math.max(0, chat.messages.length - verdict.received);
  }
}

function localStats(index, chats, includeOutboundOnly) {
  return {
    window_rows: index.stats.rows,
    kept_messages: index.stats.kept,
    direct_chats: chats.length,
    candidate_chats: chats.filter((chat) => isCandidate(chat, includeOutboundOnly)).length,
    skipped_local: sortedObject({
      invalid: index.stats.invalid,
      outside_window: index.stats.outside_window,
      direction_unverified: index.stats.direction_unverified,
      non_direct: index.stats.non_direct,
      own_chat: index.stats.own_chat,
      duplicate: index.stats.duplicate,
      crm_send: index.stats.crm_send,
      api_source: index.stats.api_source,
    }),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function syncStatus({
  environment,
  fetchImpl,
  wahaFetchImpl,
  sleep,
  now,
  days,
  windowTo,
  workingSince,
  watch,
  intervalSeconds,
  pageSize,
  sliceSeconds,
  maxMessages,
  wahaPauseMs,
  signal,
}) {
  const config = loadEnvironment(environment);
  const context = buildContext({ environment, config, fetchImpl, sleep });
  const window = computeWindow({ days, windowTo, now });
  const workingSinceSeconds =
    workingSince === null || workingSince === undefined
      ? null
      : parseIsoInstantSeconds(workingSince);
  const { waha, session: firstSession } = await openSession({
    context,
    wahaFetchImpl,
    sleep,
    wahaPauseMs,
    requireMe: false,
  });

  async function snapshot() {
    const session = await waha.getSessionInfo();
    const observedAt = now();
    const { index, scan, chats } = await readWindow({
      waha,
      session,
      window,
      pageSize,
      sliceSeconds,
      maxMessages,
      signal,
      retain: false,
    });
    return {
      observedAtMs: observedAt.getTime(),
      session,
      counts: {
        window_rows: index.stats.rows,
        kept_messages: index.stats.kept,
        direct_chats: chats.length,
        inbound: chats.reduce((sum, chat) => sum + chat.inbound, 0),
        outbound: chats.reduce((sum, chat) => sum + chat.outbound, 0),
        non_direct_messages: index.stats.non_direct,
        scan_requests: scan.requests,
      scan_slices: scan.slices,
      scan_splits: scan.splits,
      },
    };
  }

  const first = await snapshot();
  let second = null;
  if (watch) {
    const wait = Math.max(1, intervalSeconds) * 1000;
    await sleep(wait);
    second = await snapshot();
  }
  const comparable = ["window_rows", "kept_messages", "direct_chats", "inbound", "outbound"];
  const identical = second
    ? comparable.every((field) => first.counts[field] === second.counts[field])
    : null;
  const betweenSeconds = second
    ? Math.round((second.observedAtMs - first.observedAtMs) / 1000)
    : null;
  const lastObserved = (second ?? first).observedAtMs;
  const workingMinutes =
    workingSinceSeconds === null
      ? null
      : Math.floor((lastObserved / 1000 - workingSinceSeconds) / 60);
  const reasons = [];
  if (!second) reasons.push("no_second_snapshot");
  if (workingMinutes === null) reasons.push("working_since_unknown");
  else if (workingMinutes < STABLE_MIN_WORKING_MINUTES) reasons.push("working_under_10_minutes");
  if (second && identical === false) reasons.push("counts_changed");
  if (second && betweenSeconds < STABLE_MIN_INTERVAL_SECONDS) reasons.push("interval_under_3_minutes");
  if ((second ?? first).session.status !== "WORKING") reasons.push("session_not_working");
  const stable = reasons.length === 0;
  return Object.freeze({
    output: {
      ok: true,
      mode: "sync-status",
      session_status: (second ?? first).session.status,
      engine: firstSession.engine,
      window_from: window.from,
      window_to: window.to,
      counts: (second ?? first).counts,
      heuristic: {
        working_minutes: workingMinutes,
        snapshots: second ? 2 : 1,
        seconds_between_snapshots: betweenSeconds,
        counts_identical: identical,
        stable,
        reasons,
      },
      note: "heuristic only: WAHA gives no completion signal for the history sync",
    },
    exitCode: stable ? 0 : 3,
  });
}

export async function previewCommand({
  environment,
  fetchImpl,
  wahaFetchImpl,
  sleep,
  now,
  days,
  windowTo,
  outPath,
  includeOutboundOnly,
  leadMode,
  pageSize,
  wahaPageSize,
  sliceSeconds,
  maxMessages,
  wahaPauseMs,
  rpcPauseMs,
  signal,
}) {
  const config = loadEnvironment(environment);
  const context = buildContext({ environment, config, fetchImpl, sleep });
  const window = computeWindow({ days, windowTo, now });
  const { waha, session } = await openSession({ context, wahaFetchImpl, sleep, wahaPauseMs });
  const options = runOptions({ session, includeOutboundOnly, leadMode });
  const { index, scan, chats } = await readWindow({
    waha,
    session,
    window,
    pageSize: wahaPageSize,
    sliceSeconds,
    maxMessages,
    signal,
    retain: true,
  });
  assignRefs(chats, config.supabaseSecretKey);
  const ownIds = ownIdSet(session.me);
  const lidState = { lookups: 0 };
  const totals = newPreviewTotals();
  totals.chats_total = chats.length;
  const lines = [];
  for (const chat of chats) {
    if (!isCandidate(chat, includeOutboundOnly)) {
      if (chat.messages.length > 0) totals.chats_outbound_only += 1;
      continue;
    }
    if (signal?.aborted) fail("interrupted");
    totals.chats_candidates += 1;
    totals.messages_inbound += chat.inbound;
    totals.messages_outbound += chat.outbound;
    const phone = await resolveChatPhone({ chat, waha, ownIds, state: lidState });
    if (chat.kind === "lid") {
      totals.chats_lid += 1;
      if (phone !== null) totals.chats_lid_with_phone += 1;
    }
    const { verdict, pageCount } = await previewFirstPage({
      context,
      chat,
      window,
      options,
      pageSize,
      includeOutboundOnly,
    });
    if (verdict === null) continue;
    tallyVerdict(totals, chat, verdict, pageCount);
    lines.push({
      ref: chat.ref,
      name: chat.pushName,
      last4: lastDigits(chat),
      kind: chat.kind,
      inbound: chat.inbound,
      outbound: chat.outbound,
      first_at: isoFromSeconds(chat.firstTimestamp),
      last_at: isoFromSeconds(chat.lastTimestamp),
      pages: pageCount,
      outcome: verdict.outcome,
      existing_conversation: verdict.conversationExists,
      existing_client_match: verdict.matchesActiveClient,
    });
    await sleep(rpcPauseMs);
  }
  const meta = {
    meta: {
      format: PREVIEW_FORMAT,
      window_from: window.from,
      window_to: window.to,
      generated_at: now().toISOString(),
      include_outbound_only: options.include_outbound_only,
      engine: session.engine,
      candidate_chats: lines.length,
    },
  };
  const outMode = writePrivateFile(
    outPath,
    [meta, ...lines].map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  return Object.freeze({
    output: {
      ok: true,
      mode: "preview",
      window_from: window.from,
      window_to: window.to,
      window_to_defaulted: window.toDefaulted,
      engine: session.engine,
      out_file_written: true,
      out_file_lines: lines.length,
      out_file_mode: outMode,
      ...localStats(index, chats, includeOutboundOnly),
      scan_requests: scan.requests,
      scan_slices: scan.slices,
      scan_splits: scan.splits,
      totals: {
        ...totals,
        by_outcome: sortedObject(totals.by_outcome),
        skipped: sortedObject(totals.skipped),
      },
      next: "owner reviews the file, marks personal chats, then delete the file",
    },
    exitCode: 0,
  });
}

/** Create the preview file exclusively with mode 0600 (never overwrite, never world-readable). */
function writePrivateFile(path, content) {
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    fail(error?.code === "EEXIST" ? "out_file_exists" : "out_file_failed");
  }
  try {
    fchmodSync(descriptor, 0o600);
    writeSync(descriptor, content);
  } catch {
    closeSync(descriptor);
    try {
      unlinkSync(path);
    } catch {
      // Nothing else to do.
    }
    fail("out_file_failed");
  }
  closeSync(descriptor);
  return (statSync(path).mode & 0o777).toString(8).padStart(4, "0");
}

function newApplyTotals() {
  return {
    chats_total: 0,
    chats_selected: 0,
    chats_processed: 0,
    chats_imported: 0,
    chats_stopped_early: 0,
    chats_first_inbound_unreachable: 0,
    conversations_created: 0,
    pages_sent: 0,
    projected: 0,
    projected_inbound: 0,
    projected_outbound: 0,
    projected_media: 0,
    already_bound: 0,
    messages_dropped_oversize: 0,
    by_outcome: {},
    skipped: {},
  };
}

function validatePageResponse(value) {
  if (!isObject(value)) fail("rpc_response_invalid");
  const outcome =
    typeof value.chat_outcome === "string" && CHAT_OUTCOMES.has(value.chat_outcome)
      ? value.chat_outcome
      : "unknown";
  const skipped = {};
  addCounts(skipped, value.skipped);
  return {
    outcome,
    conversationCreated: value.conversation_created === true,
    projected: numberOrZero(value.projected),
    projectedInbound: numberOrZero(value.projected_inbound),
    projectedOutbound: numberOrZero(value.projected_outbound),
    projectedMedia: numberOrZero(value.projected_media),
    alreadyBound: numberOrZero(value.already_bound),
    skipped,
  };
}

function validateBeginResponse(value) {
  if (!isObject(value)) fail("rpc_response_invalid");
  if (
    typeof value.run_id !== "string" ||
    !CANONICAL_UUID.test(value.run_id) ||
    typeof value.resumed !== "boolean" ||
    !Number.isSafeInteger(value.chat_offset) ||
    value.chat_offset < 0 ||
    !Number.isSafeInteger(value.message_offset) ||
    value.message_offset < 0
  ) {
    fail("rpc_response_invalid");
  }
  return {
    runId: value.run_id,
    resumed: value.resumed,
    chatOffset: value.chat_offset,
    messageOffset: value.message_offset,
  };
}

function validateFinishResponse(value) {
  if (!isObject(value) || !isObject(value.totals)) fail("rpc_response_invalid");
  const totals = {};
  addCounts(totals, value.totals);
  const skipped = {};
  addCounts(skipped, value.totals.skipped);
  return { state: value.state === "paused" ? "paused" : "completed", totals, skipped };
}

async function finishRun(context, runId, outcome) {
  return validateFinishResponse(
    await callRpc(context, RPC.finish, {
      p_organization_id: context.organizationId,
      p_run_id: runId,
      p_outcome: outcome,
      p_request_id: randomUUID(),
    }),
  );
}

export async function applyCommand({
  environment,
  fetchImpl,
  wahaFetchImpl,
  sleep,
  now,
  days,
  windowTo,
  includeOutboundOnly,
  leadMode,
  onlyChatsFile,
  excludeChatsFile,
  previewFile,
  maxChats,
  allChats,
  dryRun,
  resumeRunId,
  pageSize,
  wahaPageSize,
  sliceSeconds,
  maxMessages,
  wahaPauseMs,
  rpcPauseMs,
  signal,
  progress,
}) {
  // --max-chats only limits a selection; alone it would pick "the freshest chats", personal ones included.
  const hasSelection = onlyChatsFile !== null || excludeChatsFile !== null || allChats === true;
  if (!dryRun && !hasSelection) fail("selection_required");
  if (!dryRun && (windowTo === null || windowTo === undefined)) fail("window_to_required");
  if (resumeRunId !== null) {
    requireCanonicalUuid(resumeRunId, "usage");
    if (windowTo === null || windowTo === undefined) fail("usage");
    if (dryRun) fail("usage");
  }
  const config = loadEnvironment(environment, { needMembership: !dryRun });
  const context = buildContext({ environment, config, fetchImpl, sleep });
  const window = computeWindow({ days, windowTo, now });

  const only = onlyChatsFile === null ? null : readChatListFile(onlyChatsFile);
  const exclude = excludeChatsFile === null ? null : readChatListFile(excludeChatsFile);
  const reviewed = previewFile === null ? null : readChatListFile(previewFile);
  for (const list of [only, exclude, reviewed]) {
    if (list) checkListWindow(list, window);
  }
  if (reviewed && !reviewed.meta) fail("list_file_invalid");

  const { waha, session } = await openSession({ context, wahaFetchImpl, sleep, wahaPauseMs });
  const options = runOptions({ session, includeOutboundOnly, leadMode });
  const { index, scan, chats } = await readWindow({
    waha,
    session,
    window,
    pageSize: wahaPageSize,
    sliceSeconds,
    maxMessages,
    signal,
    retain: true,
  });
  assignRefs(chats, config.supabaseSecretKey);
  const chatsByRef = new Map(chats.map((chat) => [chat.ref, chat]));
  for (const list of [only, exclude]) {
    if (list) checkListMatched(list, chatsByRef);
  }
  const candidates = chats.filter((chat) => isCandidate(chat, includeOutboundOnly));
  if (reviewed) {
    for (const chat of candidates) {
      if (!reviewed.refs.has(chat.ref)) fail("chat_not_reviewed");
    }
  }
  for (const chat of chats) {
    chat.selected =
      isCandidate(chat, includeOutboundOnly) &&
      (only === null || only.refs.has(chat.ref)) &&
      (exclude === null || !exclude.refs.has(chat.ref));
  }
  const selected = chats.filter((chat) => chat.selected);
  const ownIds = ownIdSet(session.me);
  const lidState = { lookups: 0 };
  const totals = newApplyTotals();
  totals.chats_total = chats.length;
  totals.chats_selected = selected.length;
  const baseOutput = {
    ok: true,
    mode: dryRun ? "apply-dry-run" : "apply",
    window_from: window.from,
    window_to: window.to,
    window_to_defaulted: window.toDefaulted,
    engine: session.engine,
    include_outbound_only: options.include_outbound_only,
    lead_mode: options.lead_mode,
    ...localStats(index, chats, includeOutboundOnly),
    scan_requests: scan.requests,
      scan_slices: scan.slices,
      scan_splits: scan.splits,
    selection: {
      only_list: only !== null,
      exclude_list: exclude !== null,
      preview_file_checked: reviewed !== null,
      excluded_by_list: exclude === null
        ? 0
        : candidates.filter((chat) => exclude.refs.has(chat.ref)).length,
      max_chats: maxChats,
    },
  };

  if (dryRun) {
    const dry = newPreviewTotals();
    let counted = 0;
    for (const chat of selected) {
      if (maxChats !== null && counted >= maxChats) break;
      if (signal?.aborted) fail("interrupted");
      await resolveChatPhone({ chat, waha, ownIds, state: lidState });
      const { verdict, pageCount } = await previewFirstPage({
        context,
        chat,
        window,
        options,
        pageSize,
        includeOutboundOnly,
      });
      if (verdict === null) continue;
      tallyVerdict(dry, chat, verdict, pageCount);
      if (verdict.outcome === "import_new" || verdict.outcome === "import_existing") counted += 1;
      await sleep(rpcPauseMs);
    }
    return Object.freeze({
      output: {
        ...baseOutput,
        totals: {
          chats_selected: selected.length,
          chats_checked: Object.values(dry.by_outcome).reduce((sum, value) => sum + value, 0),
          chats_multi_page: dry.chats_multi_page,
          chats_existing_client_match: dry.chats_existing_client_match,
          first_page_would_import: dry.first_page_would_import,
          first_page_would_import_inbound: dry.first_page_would_import_inbound,
          first_page_would_import_outbound: dry.first_page_would_import_outbound,
          first_page_would_import_media: dry.first_page_would_import_media,
          first_page_already_bound: dry.first_page_already_bound,
          later_page_messages: dry.later_page_messages,
          by_outcome: sortedObject(dry.by_outcome),
          skipped: sortedObject(dry.skipped),
        },
        note: "dry run: nothing was written; a re-run after an import reports would_import 0",
      },
      exitCode: 0,
    });
  }

  // -- real run ------------------------------------------------------------
  const begin = validateBeginResponse(
    await callRpc(context, RPC.begin, {
      p_organization_id: context.organizationId,
      p_waha_session_name: TARGET_SESSION,
      p_engine: session.engine,
      p_intake_sales_membership_id: context.intakeMembershipId,
      p_window_from: window.from,
      p_window_to: window.to,
      p_options: options,
      p_request_id: randomUUID(),
    }),
  );
  if (resumeRunId === null && begin.resumed) {
    await finishQuietly(context, begin.runId, "paused");
    fail("unfinished_run_exists", { runId: begin.runId });
  }
  if (resumeRunId !== null && (!begin.resumed || begin.runId !== resumeRunId)) {
    // `begin` opened a fresh, empty run instead of the one named: close it.
    if (!begin.resumed) await finishQuietly(context, begin.runId, "completed");
    else await finishQuietly(context, begin.runId, "paused");
    fail("resume_mismatch", { runId: begin.runId });
  }

  let outcome = "completed";
  let failure = null;
  try {
    await runImport({
      context,
      chats,
      begin,
      totals,
      maxChats,
      pageSize,
      includeOutboundOnly,
      waha,
      ownIds,
      lidState,
      sleep,
      rpcPauseMs,
      signal,
      progress,
    });
  } catch (error) {
    failure = error;
    outcome = "paused";
  }
  let finished = null;
  try {
    finished = await finishRun(context, begin.runId, outcome);
  } catch (finishError) {
    if (failure === null) throw finishError;
  }
  if (failure !== null) {
    if (failure instanceof WahaHistoryImportError && failure.runId === null) {
      failure.runId = begin.runId;
    }
    throw failure;
  }
  return Object.freeze({
    output: {
      ...baseOutput,
      run_id: begin.runId,
      resumed: begin.resumed,
      state: finished.state,
      totals: {
        ...totals,
        by_outcome: sortedObject(totals.by_outcome),
        skipped: sortedObject(totals.skipped),
      },
      run_totals: { ...finished.totals, skipped: sortedObject(finished.skipped) },
      next: "verify with: apply --dry-run (same window and lists) - would_import must be 0",
    },
    exitCode: 0,
  });
}

async function finishQuietly(context, runId, outcome) {
  try {
    await finishRun(context, runId, outcome);
  } catch {
    // The caller reports the original problem.
  }
}

async function runImport({
  context,
  chats,
  begin,
  totals,
  maxChats,
  pageSize,
  includeOutboundOnly,
  waha,
  ownIds,
  lidState,
  sleep,
  rpcPauseMs,
  signal,
  progress,
}) {
  let importedChats = 0;
  let processed = 0;
  const selected = chats.filter((chat) => chat.selected);
  for (const chat of chats) {
    if (!chat.selected || chat.index < begin.chatOffset) continue;
    if (maxChats !== null && importedChats >= maxChats) break;
    if (signal?.aborted) fail("interrupted");
    const startOffset = chat.index === begin.chatOffset ? begin.messageOffset : 0;
    if (startOffset >= chat.messages.length) continue;
    await resolveChatPhone({ chat, waha, ownIds, state: lidState });
    const messages = chatMessagesForDatabase(chat);
    const firstPageMinimum = includeOutboundOnly ? 0 : firstInboundMinimum(chat);
    if (startOffset === 0 && firstPageMinimum > RPC_PAGE_MAX_MESSAGES) {
      // The conversation would be created by a later page and the messages
      // before the first customer message would be lost: leave the chat out.
      totals.chats_first_inbound_unreachable += 1;
      continue;
    }
    const { pages, dropped } = buildPages(messages, startOffset, {
      pageSize,
      maxMessages: RPC_PAGE_MAX_MESSAGES,
      maxBytes: RPC_PAGE_MAX_BYTES,
      firstPageMinimum,
    });
    totals.messages_dropped_oversize += dropped;
    if (pages.length === 0) continue;
    processed += 1;
    totals.chats_processed += 1;
    let chatImported = false;
    for (let position = 0; position < pages.length; position += 1) {
      if (position > 0 && signal?.aborted) fail("interrupted");
      const page = pages[position];
      const isLast = position === pages.length - 1;
      const next = isLast
        ? { chat: chat.index + 1, message: 0 }
        : { chat: chat.index, message: page.endOffset };
      const result = await sendPage({
        context,
        runId: begin.runId,
        chat,
        page,
        next,
      });
      totals.pages_sent += 1;
      if (position === 0 && startOffset === 0) bump(totals.by_outcome, result.outcome);
      totals.projected += result.projected;
      totals.projected_inbound += result.projectedInbound;
      totals.projected_outbound += result.projectedOutbound;
      totals.projected_media += result.projectedMedia;
      totals.already_bound += result.alreadyBound;
      if (result.conversationCreated) totals.conversations_created += 1;
      addCounts(totals.skipped, result.skipped);
      if (result.outcome === "import_new" || result.outcome === "import_existing") {
        chatImported = true;
      }
      if (!isLast && !CONTINUE_OUTCOMES.has(result.outcome)) {
        // Leave the rest of this chat unsent and move the durable cursor past
        // it with an empty page, so a resume cannot send its later pages.
        totals.chats_stopped_early += 1;
        await sendPage({
          context,
          runId: begin.runId,
          chat,
          page: { startOffset: page.endOffset, endOffset: chat.messages.length, messages: [], bytes: 0 },
          next: { chat: chat.index + 1, message: 0 },
        });
        totals.pages_sent += 1;
        break;
      }
      await sleep(rpcPauseMs);
    }
    if (chatImported) {
      importedChats += 1;
      totals.chats_imported += 1;
    }
    if (typeof progress === "function" && processed % 10 === 0) {
      progress({
        event: "progress",
        chats_processed: processed,
        chats_selected: selected.length,
        projected: totals.projected,
      });
    }
  }
}

async function sendPage({ context, runId, chat, page, next }) {
  const contentSha = sha256Hex(JSON.stringify(page.messages));
  const requestId = deriveUuid(
    "page",
    runId,
    chat.index,
    page.startOffset,
    page.endOffset,
    next.chat,
    next.message,
    contentSha,
  );
  let response;
  try {
    response = await callRpc(
      context,
      RPC.page,
      {
        p_organization_id: context.organizationId,
        p_run_id: runId,
        p_waha_session_name: TARGET_SESSION,
        p_raw_chat_id: chat.key,
        p_messages: page.messages,
        p_next_chat_offset: next.chat,
        p_next_message_offset: next.message,
        p_request_id: requestId,
      },
      { timeoutMs: RPC_PAGE_TIMEOUT_MS },
    );
  } catch (error) {
    // Name the failing chat by its opaque reference so the operator can find it
    // in the preview file; the chat id itself never leaves this process.
    if (error instanceof WahaHistoryImportError && error.chatRef === null && CHAT_REF.test(chat.ref)) {
      error.chatRef = chat.ref;
    }
    throw error;
  }
  return validatePageResponse(response);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = `Usage:
  node scripts/waha-history-import.mjs sync-status [--working-since ISO] [--watch] [--interval-seconds N] [window]
  node scripts/waha-history-import.mjs preview --out FILE [--include-outbound-only] [window]
  node scripts/waha-history-import.mjs apply selection [--include-outbound-only] [--lead-mode promote|none] --window-to ISO [--days N]
  node scripts/waha-history-import.mjs apply --dry-run [selection] [window]
  node scripts/waha-history-import.mjs apply --resume RUN_ID --window-to ISO selection ...

window:     --days N (1-31, default ${DEFAULT_DAYS})  --window-to ISO (default: now; REQUIRED for a real apply)
selection:  --only-chats-file F | --exclude-chats-file F | --all-chats   (a list file must name at least one chat)
            --max-chats N  limits a selection (alone it selects nothing)
            --preview-file F  (every chat of the window must be in the reviewed preview file)
tuning:     --page-size N (database page, 1-500, default ${DEFAULT_RPC_PAGE_SIZE})  --waha-page-size N (first read limit, default ${DEFAULT_WAHA_PAGE_SIZE})
            --waha-slice-seconds N (default ${DEFAULT_WAHA_SLICE_SECONDS})  --waha-pause-ms N  --rpc-pause-ms N  --max-window-messages N

Read-only against WAHA (GET only, downloadMedia=false; GOWS engine). The history
cannot be removed from the CRM afterwards: run preview, review it, pilot with
--only-chats-file (or --exclude-chats-file with --max-chats), then import the rest.
--window-to must not be later than the moment WhatsApp intake was enabled (and
not later than the first message the CRM sent); pin the same value for every
step. Output: one JSON line (counts only; no chat id, number, name or text).
Environment: NEXT_PUBLIC_SUPABASE_URL, EVO_PLATFORM_SUPABASE_SECRET_KEY,
EVO_PLATFORM_ORGANIZATION_ID, EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID
(apply). The WAHA key comes from the Vault runtime binding.
Exit codes: 0 ok, 1 error (JSON on stderr), 2 usage, 3 sync-status not stable.
`;

const VALUE_FLAGS = new Set([
  "--days",
  "--window-to",
  "--out",
  "--only-chats-file",
  "--exclude-chats-file",
  "--preview-file",
  "--max-chats",
  "--resume",
  "--lead-mode",
  "--page-size",
  "--waha-page-size",
  "--waha-pause-ms",
  "--waha-slice-seconds",
  "--rpc-pause-ms",
  "--max-window-messages",
  "--working-since",
  "--interval-seconds",
]);
const BOOLEAN_FLAGS = new Set([
  "--dry-run",
  "--include-outbound-only",
  "--all-chats",
  "--watch",
  "--help",
  "-h",
]);

function parseInteger(value, minimum, maximum) {
  if (typeof value !== "string" || !/^[0-9]{1,9}$/u.test(value)) fail("usage");
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) fail("usage");
  return parsed;
}

export function parseArguments(argv) {
  const parsed = { command: null, flags: new Map(), help: false };
  for (let position = 0; position < argv.length; position += 1) {
    let argument = argv[position];
    if (position === 0 && !argument.startsWith("-")) {
      if (!["sync-status", "preview", "apply"].includes(argument)) fail("usage");
      parsed.command = argument;
      continue;
    }
    let inline = null;
    const equals = argument.indexOf("=");
    if (argument.startsWith("--") && equals > 0) {
      inline = argument.slice(equals + 1);
      argument = argument.slice(0, equals);
    }
    if (BOOLEAN_FLAGS.has(argument)) {
      if (inline !== null) fail("usage");
      if (argument === "--help" || argument === "-h") parsed.help = true;
      else parsed.flags.set(argument, true);
      continue;
    }
    if (VALUE_FLAGS.has(argument)) {
      const value = inline ?? argv[position + 1];
      if (typeof value !== "string" || (inline === null && value.startsWith("--"))) fail("usage");
      if (inline === null) position += 1;
      if (parsed.flags.has(argument)) fail("usage");
      parsed.flags.set(argument, value);
      continue;
    }
    // Any other token, including a pasted secret, is a usage error and is
    // never echoed back.
    fail("usage");
  }
  if (!parsed.help && parsed.command === null) fail("usage");
  return parsed;
}

function flagValue(flags, name) {
  return flags.has(name) ? flags.get(name) : null;
}

function allowedFlags(command) {
  const common = [
    "--days",
    "--window-to",
    "--waha-page-size",
    "--waha-slice-seconds",
    "--waha-pause-ms",
    "--max-window-messages",
  ];
  if (command === "sync-status") {
    return new Set([...common, "--working-since", "--watch", "--interval-seconds"]);
  }
  if (command === "preview") {
    return new Set([
      ...common,
      "--out",
      "--include-outbound-only",
      "--lead-mode",
      "--page-size",
      "--rpc-pause-ms",
    ]);
  }
  return new Set([
    ...common,
    "--only-chats-file",
    "--exclude-chats-file",
    "--preview-file",
    "--max-chats",
    "--all-chats",
    "--dry-run",
    "--include-outbound-only",
    "--lead-mode",
    "--resume",
    "--page-size",
    "--rpc-pause-ms",
  ]);
}

function writeJsonLine(stream, value) {
  if (!stream || typeof stream.write !== "function") fail("output_failed");
  try {
    stream.write(`${JSON.stringify(value)}\n`);
  } catch {
    fail("output_failed");
  }
}

export async function runCli({
  argv = process.argv.slice(2),
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch,
  wahaFetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  now = () => new Date(),
  signal = undefined,
} = {}) {
  try {
    const parsed = parseArguments(argv);
    if (parsed.help) {
      stdout.write(USAGE);
      return 0;
    }
    const { command, flags } = parsed;
    const allowed = allowedFlags(command);
    for (const name of flags.keys()) {
      if (!allowed.has(name)) fail("usage");
    }
    const leadModeRaw = flagValue(flags, "--lead-mode");
    if (leadModeRaw !== null && !["promote", "none"].includes(leadModeRaw)) fail("usage");
    const common = {
      environment,
      fetchImpl,
      wahaFetchImpl,
      sleep,
      now,
      signal,
      days: flags.has("--days") ? parseInteger(flags.get("--days"), 1, MAX_DAYS) : null,
      windowTo: flagValue(flags, "--window-to"),
      wahaPageSize: flags.has("--waha-page-size")
        ? parseInteger(flags.get("--waha-page-size"), 1, 500)
        : DEFAULT_WAHA_PAGE_SIZE,
      sliceSeconds: flags.has("--waha-slice-seconds")
        ? parseInteger(flags.get("--waha-slice-seconds"), 1, 86_400)
        : DEFAULT_WAHA_SLICE_SECONDS,
      wahaPauseMs: flags.has("--waha-pause-ms")
        ? parseInteger(flags.get("--waha-pause-ms"), 0, 60_000)
        : DEFAULT_WAHA_PAUSE_MS,
      maxMessages: flags.has("--max-window-messages")
        ? parseInteger(flags.get("--max-window-messages"), 1, 2_000_000)
        : DEFAULT_MAX_WINDOW_MESSAGES,
    };
    const databasePageSize = flags.has("--page-size")
      ? parseInteger(flags.get("--page-size"), 1, RPC_PAGE_MAX_MESSAGES)
      : DEFAULT_RPC_PAGE_SIZE;
    const rpcPauseMs = flags.has("--rpc-pause-ms")
      ? parseInteger(flags.get("--rpc-pause-ms"), 0, 60_000)
      : DEFAULT_RPC_PAUSE_MS;

    let result;
    if (command === "sync-status") {
      result = await syncStatus({
        ...common,
        pageSize: common.wahaPageSize,
        workingSince: flagValue(flags, "--working-since"),
        watch: flags.get("--watch") === true,
        intervalSeconds: flags.has("--interval-seconds")
          ? parseInteger(flags.get("--interval-seconds"), 1, 3600)
          : DEFAULT_INTERVAL_SECONDS,
      });
    } else if (command === "preview") {
      const outPath = flagValue(flags, "--out");
      if (outPath === null || outPath === "") fail("usage");
      result = await previewCommand({
        ...common,
        pageSize: databasePageSize,
        rpcPauseMs,
        outPath,
        includeOutboundOnly: flags.get("--include-outbound-only") === true,
        leadMode: leadModeRaw,
      });
    } else {
      result = await applyCommand({
        ...common,
        pageSize: databasePageSize,
        rpcPauseMs,
        includeOutboundOnly: flags.get("--include-outbound-only") === true,
        leadMode: leadModeRaw,
        onlyChatsFile: flagValue(flags, "--only-chats-file"),
        excludeChatsFile: flagValue(flags, "--exclude-chats-file"),
        previewFile: flagValue(flags, "--preview-file"),
        maxChats: flags.has("--max-chats") ? parseInteger(flags.get("--max-chats"), 1, 100_000) : null,
        allChats: flags.get("--all-chats") === true,
        dryRun: flags.get("--dry-run") === true,
        resumeRunId: flagValue(flags, "--resume"),
        progress: (event) => {
          try {
            writeJsonLine(stderr, event);
          } catch {
            // Progress is best effort.
          }
        },
      });
    }
    writeJsonLine(stdout, result.output);
    return result.exitCode;
  } catch (error) {
    const known = error instanceof WahaHistoryImportError;
    const code = known ? error.code : "operator_failed";
    const body = { ok: false, error_code: code };
    if (known && error.sqlstate !== null) body.sqlstate = error.sqlstate;
    if (known && error.runId !== null) body.run_id = error.runId;
    if (known && error.chatRef !== null) body.chat_ref = error.chatRef;
    try {
      stderr.write(`${JSON.stringify(body)}\n`);
    } catch {
      // Nothing else can be reported safely.
    }
    return code === "usage" ? 2 : 1;
  }
}

const isMain =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isMain) {
  const controller = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) {
    process.once(name, () => controller.abort());
  }
  const exitCode = await runCli({ signal: controller.signal });
  // Let buffered output reach the pipe, then leave.
  await new Promise((done) => process.stderr.write("", () => done()));
  await new Promise((done) => process.stdout.write("", () => done()));
  process.exit(exitCode);
}
