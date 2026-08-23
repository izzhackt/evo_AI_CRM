#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROVISION_RPC_NAME = "provision_manual_send_waha_runtime";
const ALLOWED_RPC_NAMES = new Set([
  PROVISION_RPC_NAME,
  "manual_send_waha_runtime_configuration",
]);
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const TARGET_SESSION = "evo-inbox";
const TARGET_BASE_URL = "http://evo-crm-waha:3000";
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
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{20,512}$/;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const REASON_CODES = new Set([
  "ready",
  "missing_binding",
  "binding_disabled",
  "binding_contract_invalid",
  "secret_missing",
  "secret_invalid",
  "secret_hash_mismatch",
]);
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

const ERROR_MESSAGES = Object.freeze({
  invalid_environment: "operator environment is invalid",
  invalid_fetch: "RPC transport is invalid",
  invalid_timeout: "RPC timeout is invalid",
  rpc_timeout: "Supabase RPC timed out",
  rpc_transport_failed: "Supabase RPC transport failed",
  rpc_rejected: "Supabase RPC rejected the request",
  rpc_response_too_large: "Supabase RPC response exceeded 64 KiB",
  rpc_response_invalid: "Supabase RPC response is invalid",
  runtime_not_ready: "manual-send WAHA runtime is not ready",
  output_failed: "operator output failed",
});

export class PlatformManualSendWahaOperatorError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? "manual-send WAHA operator action failed");
    this.name = "PlatformManualSendWahaOperatorError";
    this.code = code;
  }
}

function fail(code) {
  throw new PlatformManualSendWahaOperatorError(code);
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

function requireCanonicalUuid(value) {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
    fail("invalid_environment");
  }
  return value;
}

function requireSupabaseOrigin(value) {
  if (typeof value !== "string" || !SUPABASE_ORIGIN.test(value)) {
    fail("invalid_environment");
  }
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
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    fail("invalid_environment");
  }
  return value;
}

function requireSupabaseSecretKey(value) {
  if (typeof value !== "string" || !SUPABASE_SECRET_KEY.test(value)) {
    fail("invalid_environment");
  }
  return value;
}

function requireWahaApiKey(value) {
  const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    bytes < 16 ||
    bytes > 4096 ||
    /[\r\n\0]/.test(value)
  ) {
    fail("invalid_environment");
  }
  return value;
}

function loadProvisionEnvironment(environment) {
  if (!environment || typeof environment !== "object") {
    fail("invalid_environment");
  }
  return {
    supabaseOrigin: requireSupabaseOrigin(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: requireSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    organizationId: requireCanonicalUuid(
      environment.EVO_PLATFORM_ORGANIZATION_ID,
    ),
    wahaApiKey: requireWahaApiKey(
      environment.EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY,
    ),
    requestId: requireCanonicalUuid(
      environment.EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID,
    ),
  };
}

function validateTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  const date = new Date(
    Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
      parts[3],
      parts[4],
      parts[5],
      milliseconds,
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

function validateNullableRuntimeFields(row) {
  if (
    !(
      row.waha_session_name === null ||
      row.waha_session_name === TARGET_SESSION
    ) ||
    !(row.base_url === null || row.base_url === TARGET_BASE_URL) ||
    !(
      row.binding_version === null ||
      (Number.isSafeInteger(row.binding_version) && row.binding_version > 0)
    ) ||
    !(
      row.api_key_sha256 === null ||
      (typeof row.api_key_sha256 === "string" &&
        LOWER_SHA256.test(row.api_key_sha256))
    ) ||
    !(row.updated_at === null || validateTimestamp(row.updated_at))
  ) {
    fail("rpc_response_invalid");
  }
}

export function validateManualSendWahaRuntimeResponse(
  payload,
  { organizationId, requireReady = false } = {},
) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    fail("rpc_response_invalid");
  }
  requireCanonicalUuid(organizationId);
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
  validateNullableRuntimeFields(row);
  const runtimeMetadata = [
    row.waha_session_name,
    row.base_url,
    row.binding_version,
    row.api_key_sha256,
    row.updated_at,
  ];
  if (
    !row.ready &&
    ((row.reason_code === "missing_binding" &&
      runtimeMetadata.some((value) => value !== null)) ||
      (row.reason_code !== "missing_binding" &&
        runtimeMetadata.some((value) => value === null)))
  ) {
    fail("rpc_response_invalid");
  }
  if (
    row.ready &&
    (row.waha_session_name !== TARGET_SESSION ||
      row.base_url !== TARGET_BASE_URL ||
      !Number.isSafeInteger(row.binding_version) ||
      row.binding_version <= 0 ||
      typeof row.api_key_sha256 !== "string" ||
      !LOWER_SHA256.test(row.api_key_sha256) ||
      !validateTimestamp(row.updated_at))
  ) {
    fail("rpc_response_invalid");
  }
  if (requireReady && (!row.ready || row.reason_code !== "ready")) {
    fail("runtime_not_ready");
  }
  return Object.freeze({ ...row });
}

async function readBoundedJson(response, signal) {
  const declaredRaw = response.headers?.get?.("content-length");
  if (declaredRaw !== null && declaredRaw !== undefined) {
    if (!/^\d+$/.test(declaredRaw)) {
      fail("rpc_response_invalid");
    }
    const declared = Number(declaredRaw);
    if (!Number.isSafeInteger(declared)) {
      fail("rpc_response_invalid");
    }
    if (declared > MAX_RESPONSE_BYTES) {
      fail("rpc_response_too_large");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    fail("rpc_response_invalid");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let abortListener;
  const aborted = new Promise((_, reject) => {
    abortListener = () =>
      reject(new PlatformManualSendWahaOperatorError("rpc_timeout"));
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        fail("rpc_response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof PlatformManualSendWahaOperatorError) throw error;
    fail(signal.aborted ? "rpc_timeout" : "rpc_response_invalid");
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    fail("rpc_response_invalid");
  }
}

export async function callPlatformManualSendWahaRpc({
  rpcName,
  supabaseOrigin,
  supabaseSecretKey,
  body,
  fetchImpl,
  timeoutMs,
}) {
  if (!ALLOWED_RPC_NAMES.has(rpcName)) fail("invalid_fetch");
  if (typeof fetchImpl !== "function") fail("invalid_fetch");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  ) {
    fail("invalid_timeout");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${supabaseOrigin}/rest/v1/rpc/${rpcName}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Profile": "platform",
          apikey: supabaseSecretKey,
          "Content-Profile": "platform",
          "Content-Type": "application/json",
        },
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify(body),
      },
    );
    if (!response || response.status !== 200) {
      fail("rpc_rejected");
    }
    return await readBoundedJson(response, controller.signal);
  } catch (error) {
    if (error instanceof PlatformManualSendWahaOperatorError) throw error;
    fail(controller.signal.aborted ? "rpc_timeout" : "rpc_transport_failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function provisionPlatformManualSendWahaRuntime({
  environment = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = loadProvisionEnvironment(environment);
  const payload = await callPlatformManualSendWahaRpc({
    rpcName: PROVISION_RPC_NAME,
    supabaseOrigin: config.supabaseOrigin,
    supabaseSecretKey: config.supabaseSecretKey,
    fetchImpl,
    timeoutMs,
    body: {
      p_organization_id: config.organizationId,
      p_waha_api_key: config.wahaApiKey,
      p_request_id: config.requestId,
    },
  });
  return validateManualSendWahaRuntimeResponse(payload, {
    organizationId: config.organizationId,
    requireReady: true,
  });
}

function writeJsonLine(stream, value) {
  if (!stream || typeof stream.write !== "function") fail("output_failed");
  try {
    stream.write(`${JSON.stringify(value)}\n`);
  } catch {
    fail("output_failed");
  }
}

export async function runProvisionPlatformManualSendWahaRuntimeCli({
  environment = process.env,
  fetchImpl = fetch,
  stdout = process.stdout,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const result = await provisionPlatformManualSendWahaRuntime({
    environment,
    fetchImpl,
    timeoutMs,
  });
  writeJsonLine(stdout, result);
  return result;
}

function writeCliFailure(error) {
  const code =
    error instanceof PlatformManualSendWahaOperatorError
      ? error.code
      : "operator_failed";
  process.stderr.write(`${JSON.stringify({ ok: false, error_code: code })}\n`);
  process.exitCode = 1;
}

const isMain =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isMain) {
  runProvisionPlatformManualSendWahaRuntimeCli().catch(writeCliFailure);
}
