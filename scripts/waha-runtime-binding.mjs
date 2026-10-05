#!/usr/bin/env node
// EVO operator CLI for the Supabase Vault-backed WAHA runtime binding.
//
// The CRM reads the plain WAHA API key for manual replies and the live
// connection probe from a Vault secret created by the service-role RPC
// platform.provision_manual_send_waha_runtime (migration 081, retargeted to
// crm_primary by migration 102). This script is the only supported way to
// create, rotate or check that binding on production. It runs INSIDE the app
// container, so it reads the Supabase credentials the app already has:
//
//   docker exec -i evo-crm-app-1 node scripts/waha-runtime-binding.mjs check
//   printf '%s' "$KEY" | docker exec -i evo-crm-app-1 \
//     node scripts/waha-runtime-binding.mjs provision --key-stdin --dry-run
//
// Hard rules: the WAHA key is read only from stdin (--key-stdin) or the
// EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY environment variable, never from argv;
// it is never printed, logged or echoed in an error; output carries only
// booleans, enums and the binding version (no key hash, no fingerprint);
// the session is always crm_primary and the base URL always
// http://evo-crm-waha:3000. Zero dependencies: only node: built-ins, so the
// file is copied into the runner image as is (see Dockerfile).
//
// Runbook: docs/runbooks/whatsapp-go-live.md

import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGET_SESSION = "crm_primary";
export const TARGET_BASE_URL = "http://evo-crm-waha:3000";
export const PROVISION_RPC_NAME = "provision_manual_send_waha_runtime";
export const CONFIGURATION_RPC_NAME = "manual_send_waha_runtime_configuration";

const ALLOWED_RPC_NAMES = new Set([PROVISION_RPC_NAME, CONFIGURATION_RPC_NAME]);
const KEY_ENVIRONMENT_NAME = "EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY";
const ALLOW_LOCAL_ENVIRONMENT_NAME = "EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE";
const MAX_RPC_RESPONSE_BYTES = 64 * 1024;
const MAX_WAHA_RESPONSE_BYTES = 512 * 1024;
const RPC_TIMEOUT_MS = 10_000;
const WAHA_TIMEOUT_MS = 5_000;
const STDIN_TIMEOUT_MS = 10_000;
const MIN_KEY_BYTES = 16;
const MAX_KEY_BYTES = 4096;

const RESPONSE_KEYS = Object.freeze([
  "organization_id",
  "ready",
  "reason_code",
  "waha_session_name",
  "base_url",
  "binding_version",
  "api_key_sha256",
  "updated_at",
]);
const REASON_CODES = new Set([
  "ready",
  "missing_binding",
  "binding_disabled",
  "binding_contract_invalid",
  "secret_missing",
  "secret_invalid",
  "secret_hash_mismatch",
]);
// Closed enums copied from the WAHA docs (sessions and engines pages); any
// other value is reported as UNKNOWN so a hostile or unexpected response can
// never inject text into the operator output.
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

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const LOCAL_SUPABASE_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,512}$/;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

const ERROR_MESSAGES = Object.freeze({
  usage: "usage error; run with --help",
  invalid_environment: "operator environment is invalid",
  key_required: "a WAHA API key from stdin or the environment is required",
  key_invalid: "the WAHA API key is invalid",
  key_source_ambiguous: "provide the WAHA API key through exactly one source",
  key_stdin_is_tty: "refusing to read the WAHA API key from a terminal",
  key_stdin_timeout: "timed out waiting for the WAHA API key on stdin",
  key_looks_like_hash: "the value is the sha512 hash, not the plain WAHA API key",
  target_not_allowed: "only session crm_primary at http://evo-crm-waha:3000 is allowed",
  binding_target_mismatch: "the stored binding does not target crm_primary",
  waha_key_rejected: "WAHA rejected the API key",
  waha_unreachable: "WAHA did not answer",
  rpc_timeout: "Supabase RPC timed out",
  rpc_transport_failed: "Supabase RPC transport failed",
  rpc_unauthorized: "Supabase rejected the server credential",
  rpc_not_found: "the RPC is missing; the schema is not at the expected tip",
  rpc_rejected: "Supabase RPC rejected the request",
  rpc_response_too_large: "Supabase RPC response exceeded 64 KiB",
  rpc_response_invalid: "Supabase RPC response is invalid",
  provision_hash_mismatch: "the stored key does not match the supplied key",
  readback_not_ready: "the binding is not ready after provisioning",
  output_failed: "operator output failed",
});

export class WahaRuntimeBindingError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? "WAHA runtime binding action failed");
    this.name = "WahaRuntimeBindingError";
    this.code = code;
  }
}

function fail(code) {
  throw new WahaRuntimeBindingError(code);
}

// ---------------------------------------------------------------------------
// Environment and key handling
// ---------------------------------------------------------------------------

function requireCanonicalUuid(value) {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
    fail("invalid_environment");
  }
  if (value === "00000000-0000-0000-0000-000000000000") {
    fail("invalid_environment");
  }
  return value;
}

function jwtRole(value) {
  const segments = value.split(".");
  if (segments.length !== 3 || segments[1] === "") return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload.role
      : null;
  } catch {
    return null;
  }
}

function requireSupabaseOrigin(value, allowLocal) {
  const allowed =
    typeof value === "string" &&
    (SUPABASE_ORIGIN.test(value) ||
      (allowLocal === true && LOCAL_SUPABASE_ORIGIN.test(value)));
  if (!allowed) fail("invalid_environment");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("invalid_environment");
  }
  if (
    parsed.origin !== value ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    fail("invalid_environment");
  }
  return value;
}

function requireSupabaseSecretKey(value) {
  if (
    typeof value !== "string" ||
    !(SUPABASE_SECRET_KEY.test(value) || jwtRole(value) === "service_role")
  ) {
    fail("invalid_environment");
  }
  return value;
}

export function validatePlainWahaApiKey(value) {
  const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    bytes < MIN_KEY_BYTES ||
    bytes > MAX_KEY_BYTES ||
    /[\r\n\0]/.test(value)
  ) {
    fail("key_invalid");
  }
  // The .env.waha value is "sha512:<hash>". Storing it as the plain key would
  // make every WAHA call fail with 401, so refuse it explicitly.
  if (/^sha512:/i.test(value)) fail("key_looks_like_hash");
  return value;
}

export function loadEnvironment(environment) {
  if (!environment || typeof environment !== "object") {
    fail("invalid_environment");
  }
  const allowLocal = environment[ALLOW_LOCAL_ENVIRONMENT_NAME] === "1";
  return Object.freeze({
    supabaseOrigin: requireSupabaseOrigin(
      environment.NEXT_PUBLIC_SUPABASE_URL,
      allowLocal,
    ),
    supabaseSecretKey: requireSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    organizationId: requireCanonicalUuid(
      environment.EVO_PLATFORM_ORGANIZATION_ID,
    ),
  });
}

export async function readKeyFromStream(stream, { timeoutMs = STDIN_TIMEOUT_MS } = {}) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
    fail("key_invalid");
  }
  if (stream.isTTY) fail("key_stdin_is_tty");
  const chunks = [];
  let bytes = 0;
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new WahaRuntimeBindingError("key_stdin_timeout")),
      timeoutMs,
    );
  });
  const reading = (async () => {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      // One key, at most one trailing line break (CRLF = 2 bytes).
      if (bytes > MAX_KEY_BYTES + 2) fail("key_invalid");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  })();
  let text;
  try {
    text = await Promise.race([reading, timedOut]);
  } catch (error) {
    // Do not leave the losing promise unhandled (a rejected read after a
    // timeout must not surface as an unhandled rejection).
    reading.catch(() => {});
    if (error instanceof WahaRuntimeBindingError) throw error;
    fail("key_invalid");
  } finally {
    clearTimeout(timer);
  }
  // Only the single trailing newline added by echo/heredoc is tolerated.
  return validatePlainWahaApiKey(text.replace(/\r?\n$/u, ""));
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Supabase RPC transport
// ---------------------------------------------------------------------------

function validateTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const date = new Date(
    Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
      parts[3],
      parts[4],
      parts[5],
      Number(fraction.padEnd(3, "0").slice(0, 3)),
    ),
  );
  return (
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2] &&
    date.getUTCHours() === parts[3] &&
    date.getUTCMinutes() === parts[4] &&
    date.getUTCSeconds() === parts[5]
  );
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("rpc_response_invalid");
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail("rpc_response_invalid");
  }
}

/**
 * Validate one row of manual_send_waha_runtime_configuration or
 * provision_manual_send_waha_runtime. The returned object keeps the stored key
 * hash internally (it is needed to decide idempotency) but the CLI output
 * builders below never copy it.
 */
export function validateBindingRow(payload, organizationId) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    fail("rpc_response_invalid");
  }
  const row = payload[0];
  exactKeys(row, RESPONSE_KEYS);
  if (
    row.organization_id !== organizationId ||
    typeof row.ready !== "boolean" ||
    typeof row.reason_code !== "string" ||
    !REASON_CODES.has(row.reason_code) ||
    (row.ready && row.reason_code !== "ready") ||
    (!row.ready && row.reason_code === "ready")
  ) {
    fail("rpc_response_invalid");
  }
  const metadata = [
    row.waha_session_name,
    row.base_url,
    row.binding_version,
    row.api_key_sha256,
    row.updated_at,
  ];
  if (row.reason_code === "missing_binding") {
    if (row.ready || metadata.some((value) => value !== null)) {
      fail("rpc_response_invalid");
    }
  } else if (
    typeof row.waha_session_name !== "string" ||
    typeof row.base_url !== "string" ||
    !Number.isSafeInteger(row.binding_version) ||
    row.binding_version <= 0 ||
    typeof row.api_key_sha256 !== "string" ||
    !LOWER_SHA256.test(row.api_key_sha256) ||
    !validateTimestamp(row.updated_at)
  ) {
    fail("rpc_response_invalid");
  }
  // Refuse any binding that does not target the one allowed transport. A
  // schema older than migration 102 (legacy inbox transport) or a tampered row
  // stops the operator here.
  if (
    row.reason_code !== "missing_binding" &&
    (row.waha_session_name !== TARGET_SESSION || row.base_url !== TARGET_BASE_URL)
  ) {
    fail("binding_target_mismatch");
  }
  return Object.freeze({ ...row });
}

async function readBoundedJson(response, signal, maxBytes, tooLargeCode, invalidCode) {
  const declaredRaw = response.headers?.get?.("content-length");
  if (declaredRaw !== null && declaredRaw !== undefined) {
    if (!/^\d+$/.test(declaredRaw)) fail(invalidCode);
    const declared = Number(declaredRaw);
    if (!Number.isSafeInteger(declared)) fail(invalidCode);
    if (declared > maxBytes) fail(tooLargeCode);
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    fail(invalidCode);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let abortListener;
  const aborted = new Promise((_, reject) => {
    abortListener = () => reject(new WahaRuntimeBindingError("rpc_timeout"));
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  });
  // The race can reject after the read already settled; keep it handled.
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
    if (error instanceof WahaRuntimeBindingError) throw error;
    fail(signal.aborted ? "rpc_timeout" : invalidCode);
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    fail(invalidCode);
  }
}

export async function callRpc({
  rpcName,
  supabaseOrigin,
  supabaseSecretKey,
  body,
  fetchImpl,
  timeoutMs = RPC_TIMEOUT_MS,
}) {
  if (!ALLOWED_RPC_NAMES.has(rpcName)) fail("usage");
  if (typeof fetchImpl !== "function") fail("usage");
  const headers = {
    Accept: "application/json",
    "Accept-Profile": "platform",
    apikey: supabaseSecretKey,
    "Content-Profile": "platform",
    "Content-Type": "application/json",
  };
  // A legacy service_role JWT is also sent as a bearer token (as the app's own
  // env contract probe does); the sb_secret_ format must not be.
  if (jwtRole(supabaseSecretKey) === "service_role") {
    headers.Authorization = `Bearer ${supabaseSecretKey}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${supabaseOrigin}/rest/v1/rpc/${rpcName}`,
      {
        method: "POST",
        headers,
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify(body),
      },
    );
    if (!response) fail("rpc_rejected");
    if (response.status === 401 || response.status === 403) {
      fail("rpc_unauthorized");
    }
    if (response.status === 404) fail("rpc_not_found");
    if (response.status !== 200) fail("rpc_rejected");
    return await readBoundedJson(
      response,
      controller.signal,
      MAX_RPC_RESPONSE_BYTES,
      "rpc_response_too_large",
      "rpc_response_invalid",
    );
  } catch (error) {
    if (error instanceof WahaRuntimeBindingError) throw error;
    fail(controller.signal.aborted ? "rpc_timeout" : "rpc_transport_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function readConfiguration(config, fetchImpl) {
  const payload = await callRpc({
    rpcName: CONFIGURATION_RPC_NAME,
    supabaseOrigin: config.supabaseOrigin,
    supabaseSecretKey: config.supabaseSecretKey,
    fetchImpl,
    body: { p_organization_id: config.organizationId },
  });
  return validateBindingRow(payload, config.organizationId);
}

// ---------------------------------------------------------------------------
// WAHA key probe (optional, read-only)
// ---------------------------------------------------------------------------

/**
 * Ask WAHA (GET /api/sessions/crm_primary, a read) whether it accepts the key.
 * Returns booleans and closed enums only; the response body is never kept.
 * 401/403 -> rejected. 404 -> the key is accepted but the session is absent.
 */
export async function probeWahaKey({
  apiKey,
  wahaFetchImpl,
  timeoutMs = WAHA_TIMEOUT_MS,
}) {
  if (typeof wahaFetchImpl !== "function") fail("usage");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await wahaFetchImpl(
      `${TARGET_BASE_URL}/api/sessions/${TARGET_SESSION}`,
      {
        method: "GET",
        headers: { Accept: "application/json", "X-Api-Key": apiKey },
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (!response) fail("waha_unreachable");
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel?.().catch?.(() => {});
      return Object.freeze({ accepted: false, status: null, engine: null });
    }
    if (response.status === 404) {
      void response.body?.cancel?.().catch?.(() => {});
      return Object.freeze({ accepted: true, status: "NOT_FOUND", engine: null });
    }
    if (response.status !== 200) fail("waha_unreachable");
    let parsed = null;
    try {
      parsed = await readBoundedJson(
        response,
        controller.signal,
        MAX_WAHA_RESPONSE_BYTES,
        "waha_unreachable",
        "waha_unreachable",
      );
    } catch {
      parsed = null;
    }
    const status =
      parsed && typeof parsed.status === "string" && WAHA_STATUSES.has(parsed.status)
        ? parsed.status
        : "UNKNOWN";
    const rawEngine =
      parsed && parsed.engine && typeof parsed.engine === "object"
        ? parsed.engine.engine
        : parsed?.engine;
    const engine =
      typeof rawEngine === "string" && WAHA_ENGINES.has(rawEngine)
        ? rawEngine
        : "UNKNOWN";
    return Object.freeze({ accepted: true, status, engine });
  } catch (error) {
    if (error instanceof WahaRuntimeBindingError) throw error;
    fail("waha_unreachable");
  } finally {
    clearTimeout(timeout);
  }
}

function publicWahaFields(probe) {
  return {
    waha_key_accepted: probe ? probe.accepted : null,
    waha_session_status: probe ? probe.status : null,
    waha_engine: probe ? probe.engine : null,
  };
}

function publicBindingFields(row) {
  // Deliberately omits organization_id, api_key_sha256 and updated_at.
  return {
    ready: row.ready,
    reason_code: row.reason_code,
    waha_session_name: row.waha_session_name,
    base_url: row.base_url,
    binding_version: row.binding_version,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function classifyBefore(before, keySha256) {
  if (before.reason_code === "missing_binding") return "create";
  if (before.ready && before.api_key_sha256 === keySha256) return "unchanged";
  return before.ready ? "rotate" : "repair";
}

const PAST_TENSE = Object.freeze({
  create: "created",
  rotate: "rotated",
  repair: "repaired",
  unchanged: "unchanged",
});

export async function checkWahaRuntimeBinding({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  wahaFetchImpl = globalThis.fetch,
  apiKey = null,
  verifyKey = false,
  skipWahaCheck = false,
} = {}) {
  const config = loadEnvironment(environment);
  const row = await readConfiguration(config, fetchImpl);
  let keyMatches = null;
  let probe = null;
  if (verifyKey) {
    if (apiKey === null) fail("key_required");
    validatePlainWahaApiKey(apiKey);
    keyMatches = row.api_key_sha256 === null
      ? false
      : row.api_key_sha256 === sha256Hex(apiKey);
    if (!skipWahaCheck) {
      probe = await probeWahaKey({ apiKey, wahaFetchImpl });
    }
  }
  const output = {
    ok: true,
    mode: "check",
    ...publicBindingFields(row),
    ...(verifyKey
      ? { key_matches_stored_binding: keyMatches, ...publicWahaFields(probe) }
      : {}),
  };
  const healthy =
    row.ready &&
    (!verifyKey || (keyMatches === true && (probe === null || probe.accepted)));
  return Object.freeze({ output, exitCode: healthy ? 0 : 3 });
}

export async function provisionWahaRuntimeBinding({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  wahaFetchImpl = globalThis.fetch,
  apiKey,
  dryRun = false,
  skipWahaCheck = false,
  requestId = randomUUID(),
} = {}) {
  const config = loadEnvironment(environment);
  if (apiKey === null || apiKey === undefined) fail("key_required");
  validatePlainWahaApiKey(apiKey);
  requireCanonicalUuid(requestId);
  const keySha256 = sha256Hex(apiKey);

  const before = await readConfiguration(config, fetchImpl);

  // Never write a key WAHA itself refuses: that would silently break manual
  // replies and the live status probe while the binding reads "ready".
  let probe = null;
  if (!skipWahaCheck) {
    probe = await probeWahaKey({ apiKey, wahaFetchImpl });
    if (!probe.accepted) fail("waha_key_rejected");
  }

  const plan = classifyBefore(before, keySha256);
  if (plan === "unchanged") {
    return Object.freeze({
      output: {
        ok: true,
        mode: "provision",
        dry_run: dryRun,
        action: "unchanged",
        previous_reason_code: before.reason_code,
        ...publicBindingFields(before),
        key_matches_input: true,
        ...publicWahaFields(probe),
      },
      exitCode: 0,
    });
  }
  if (dryRun) {
    return Object.freeze({
      output: {
        ok: true,
        mode: "provision",
        dry_run: true,
        action: `would_${plan}`,
        previous_reason_code: before.reason_code,
        ...publicBindingFields(before),
        key_matches_input: false,
        ...publicWahaFields(probe),
      },
      exitCode: 0,
    });
  }

  const payload = await callRpc({
    rpcName: PROVISION_RPC_NAME,
    supabaseOrigin: config.supabaseOrigin,
    supabaseSecretKey: config.supabaseSecretKey,
    fetchImpl,
    body: {
      p_organization_id: config.organizationId,
      p_waha_api_key: apiKey,
      p_request_id: requestId,
    },
  });
  const provisioned = validateBindingRow(payload, config.organizationId);
  if (!provisioned.ready) fail("readback_not_ready");
  if (provisioned.api_key_sha256 !== keySha256) fail("provision_hash_mismatch");

  // Independent read-back through the configuration RPC.
  const after = await readConfiguration(config, fetchImpl);
  if (!after.ready) fail("readback_not_ready");
  if (after.api_key_sha256 !== keySha256) fail("provision_hash_mismatch");

  return Object.freeze({
    output: {
      ok: true,
      mode: "provision",
      dry_run: false,
      action: PAST_TENSE[plan],
      previous_reason_code: before.reason_code,
      ...publicBindingFields(after),
      key_matches_input: true,
      ...publicWahaFields(probe),
    },
    exitCode: 0,
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = `Usage:
  node scripts/waha-runtime-binding.mjs check [--verify-key] [--key-stdin] [--skip-waha-check]
  node scripts/waha-runtime-binding.mjs provision (--key-stdin | env ${KEY_ENVIRONMENT_NAME}) [--dry-run] [--skip-waha-check]

Modes (--check and --provision are accepted as aliases):
  check      Read-only. Prints whether the Vault-backed binding is ready.
             With --verify-key it also compares the supplied key with the
             stored binding and asks WAHA whether it accepts the key.
  provision  Create, rotate or repair the binding for crm_primary. Idempotent:
             a ready binding that already holds this key is left unchanged.
             --dry-run reads and plans but never writes.

Key input (never argv): --key-stdin reads one line from stdin; otherwise the
${KEY_ENVIRONMENT_NAME} environment variable is used. Exactly one source.

Assertions: --session crm_primary and --base-url http://evo-crm-waha:3000 are
accepted only with exactly these values; nothing else can be targeted.

Environment: NEXT_PUBLIC_SUPABASE_URL, EVO_PLATFORM_SUPABASE_SECRET_KEY and
EVO_PLATFORM_ORGANIZATION_ID (the app container already has them).
Output: one JSON line (booleans, enums, binding_version; no key, no hash).
Exit codes: 0 ok, 1 error (JSON on stderr), 2 usage, 3 check finds it not ready.
`;

function parseArguments(argv) {
  const options = {
    mode: null,
    dryRun: false,
    keyStdin: false,
    verifyKey: false,
    skipWahaCheck: false,
    help: false,
  };
  const assertions = { session: null, baseUrl: null };
  const setMode = (mode) => {
    if (options.mode !== null && options.mode !== mode) fail("usage");
    options.mode = mode;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "check":
      case "--check":
        setMode("check");
        break;
      case "provision":
      case "--provision":
        setMode("provision");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--key-stdin":
        options.keyStdin = true;
        break;
      case "--verify-key":
        options.verifyKey = true;
        break;
      case "--skip-waha-check":
        options.skipWahaCheck = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--session":
      case "--base-url": {
        const value = argv[index + 1];
        if (typeof value !== "string" || value.startsWith("--")) fail("usage");
        index += 1;
        if (argument === "--session") assertions.session = value;
        else assertions.baseUrl = value;
        break;
      }
      default:
        // Any other token, including a pasted secret, is a usage error and is
        // never echoed back.
        fail("usage");
    }
  }
  if (options.help) return { ...options, assertions };
  if (options.mode === null) fail("usage");
  if (options.mode === "check" && options.dryRun) fail("usage");
  if (options.mode === "provision" && options.verifyKey) fail("usage");
  if (
    (assertions.session !== null && assertions.session !== TARGET_SESSION) ||
    (assertions.baseUrl !== null && assertions.baseUrl !== TARGET_BASE_URL)
  ) {
    fail("target_not_allowed");
  }
  return { ...options, assertions };
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
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch,
  wahaFetchImpl = globalThis.fetch,
} = {}) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      stdout.write(USAGE);
      return 0;
    }

    const environmentKey = environment[KEY_ENVIRONMENT_NAME];
    const hasEnvironmentKey =
      typeof environmentKey === "string" && environmentKey !== "";
    const keyWanted = options.mode === "provision" || options.verifyKey;
    // A key that no step will use must not be read at all.
    if (options.keyStdin && !keyWanted) fail("usage");
    if (options.keyStdin && hasEnvironmentKey) fail("key_source_ambiguous");
    let apiKey = null;
    if (options.keyStdin) {
      apiKey = await readKeyFromStream(stdin);
    } else if (hasEnvironmentKey && keyWanted) {
      apiKey = validatePlainWahaApiKey(environmentKey);
    } else if (keyWanted) {
      fail("key_required");
    }

    const result =
      options.mode === "check"
        ? await checkWahaRuntimeBinding({
            environment,
            fetchImpl,
            wahaFetchImpl,
            apiKey,
            verifyKey: options.verifyKey,
            skipWahaCheck: options.skipWahaCheck,
          })
        : await provisionWahaRuntimeBinding({
            environment,
            fetchImpl,
            wahaFetchImpl,
            apiKey,
            dryRun: options.dryRun,
            skipWahaCheck: options.skipWahaCheck,
          });
    writeJsonLine(stdout, result.output);
    return result.exitCode;
  } catch (error) {
    const code = error instanceof WahaRuntimeBindingError ? error.code : "operator_failed";
    try {
      stderr.write(`${JSON.stringify({ ok: false, error_code: code })}\n`);
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
  const exitCode = await runCli();
  // Let buffered output reach the pipe, then leave even if stdin is still open
  // (a timed-out stdin read must not keep the process alive).
  await new Promise((done) => process.stderr.write("", () => done()));
  await new Promise((done) => process.stdout.write("", () => done()));
  process.exit(exitCode);
}
