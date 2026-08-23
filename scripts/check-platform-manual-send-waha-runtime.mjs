#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  callPlatformManualSendWahaRpc,
  PlatformManualSendWahaOperatorError,
  validateManualSendWahaRuntimeResponse,
} from "./provision-platform-manual-send-waha-runtime.mjs";

const RPC_NAME = "manual_send_waha_runtime_configuration";
const DEFAULT_TIMEOUT_MS = 10_000;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{20,512}$/;

function fail(code) {
  throw new PlatformManualSendWahaOperatorError(code);
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

function requireCanonicalUuid(value) {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
    fail("invalid_environment");
  }
  return value;
}

function loadCheckEnvironment(environment) {
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
  };
}

export async function checkPlatformManualSendWahaRuntime({
  environment = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = loadCheckEnvironment(environment);
  const payload = await callPlatformManualSendWahaRpc({
    rpcName: RPC_NAME,
    supabaseOrigin: config.supabaseOrigin,
    supabaseSecretKey: config.supabaseSecretKey,
    fetchImpl,
    timeoutMs,
    body: { p_organization_id: config.organizationId },
  });
  return validateManualSendWahaRuntimeResponse(payload, {
    organizationId: config.organizationId,
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

export async function runCheckPlatformManualSendWahaRuntimeCli({
  environment = process.env,
  fetchImpl = fetch,
  stdout = process.stdout,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const result = await checkPlatformManualSendWahaRuntime({
    environment,
    fetchImpl,
    timeoutMs,
  });
  if (!result.ready || result.reason_code !== "ready") {
    fail("runtime_not_ready");
  }
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
  runCheckPlatformManualSendWahaRuntimeCli().catch(writeCliFailure);
}
