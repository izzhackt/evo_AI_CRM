#!/usr/bin/env node

import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_ENV_BYTES = 256 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLACEHOLDER = /(?:replace-with-|change-me|changeme|placeholder)/iu;
const SUPABASE_PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/u;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,}$/u;
const PRODUCTION_SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/u;
const REQUIRED_RUNTIME_VALUES = Object.freeze([
  "EVO_CRM_DOMAIN",
  "EVO_CADDY_NETWORK",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EVO_PLATFORM_ORGANIZATION_ID",
  "EVO_PLATFORM_SUPABASE_SECRET_KEY",
]);
const FORBIDDEN_SUCCESSOR_RUNTIME_VALUES = Object.freeze([
  "AUTH_SECRET",
  "EVO_SECRET_ENCRYPTION_KEY",
  "EVO_DB_PATH",
  "EVO_BACKUP_DIR",
  "EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED",
  "EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET",
  "EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED",
  "EVO_LEAD_AGENT_SYNC_SECRET",
  "EVO_AGENT_WAHA_SESSION",
  "EVO_PLATFORM_WAHA_SESSION_NAME",
]);
export class AppEnvironmentContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "AppEnvironmentContractError";
    this.code = code;
  }
}

function fail(code) {
  throw new AppEnvironmentContractError(code);
}

function normalizedValue(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvironmentText(text) {
  if (typeof text !== "string" || text.includes("\0")) fail("env_text_invalid");
  const entries = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) fail("env_line_invalid");
    const name = line.slice(0, separator).trim();
    if (!ENV_NAME.test(name)) fail("env_name_invalid");
    if (entries.has(name)) fail("duplicate_env_name");
    entries.set(name, normalizedValue(line.slice(separator + 1)));
  }
  return entries;
}

function requireNonEmpty(entries, names, code) {
  for (const name of names) {
    if (!entries.has(name) || entries.get(name) === "") fail(code);
  }
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

function isSupabasePublishableKey(value) {
  return SUPABASE_PUBLISHABLE_KEY.test(value) || jwtRole(value) === "anon";
}

function isSupabaseSecretKey(value) {
  return SUPABASE_SECRET_KEY.test(value) || jwtRole(value) === "service_role";
}

function validatePublicSupabase(entries) {
  const urlValue = entries.get("NEXT_PUBLIC_SUPABASE_URL");
  try {
    const url = new URL(urlValue);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname === "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      fail("public_supabase_url_invalid");
    }
  } catch (error) {
    if (error instanceof AppEnvironmentContractError) throw error;
    fail("public_supabase_url_invalid");
  }

  const publishableKey = entries.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (typeof publishableKey !== "string" || !isSupabasePublishableKey(publishableKey)) {
    fail("public_supabase_key_invalid");
  }
}

function validateFeatureFlags(entries) {
  if (
    entries.get("EVO_UI_CONTRACT_FIXTURES") !== "0" ||
    entries.get("EVO_ALLOW_DEMO_SEED") !== "0"
  ) {
    fail("unsafe_runtime_flag");
  }
  for (const name of [
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED",
  ]) {
    if (!new Set(["0", "1"]).has(entries.get(name))) fail("unsafe_runtime_flag");
  }
}

function validateEnabledFeatureConfiguration(entries) {
  const shared = [
    "EVO_PLATFORM_ORGANIZATION_ID",
    "EVO_PLATFORM_SUPABASE_SECRET_KEY",
  ];
  if (entries.get("EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED") === "1") {
    requireNonEmpty(
      entries,
      [...shared, "EVO_PLATFORM_P7B_OBSERVABILITY_SECRET"],
      "enabled_feature_configuration_missing",
    );
    if (entries.get("EVO_PLATFORM_P7B_OBSERVABILITY_SECRET").length < 32) {
      fail("enabled_feature_configuration_missing");
    }
  }
  if (entries.get("EVO_PLATFORM_WAHA_INGRESS_ENABLED") === "1") {
    requireNonEmpty(
      entries,
      [...shared, "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET"],
      "enabled_feature_configuration_missing",
    );
    if (entries.get("EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET").length < 32) {
      fail("enabled_feature_configuration_missing");
    }
  }
  if (
    entries.get("EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED") === "1" ||
    entries.get("EVO_PLATFORM_WAHA_INGRESS_ENABLED") === "1"
  ) {
    const organizationId = entries.get("EVO_PLATFORM_ORGANIZATION_ID");
    const serverKey = entries.get("EVO_PLATFORM_SUPABASE_SECRET_KEY");
    if (
      !UUID.test(organizationId) ||
      organizationId === "00000000-0000-0000-0000-000000000000" ||
      !isSupabaseSecretKey(serverKey) ||
      !PRODUCTION_SUPABASE_ORIGIN.test(entries.get("NEXT_PUBLIC_SUPABASE_URL"))
    ) {
      fail("enabled_feature_configuration_missing");
    }
  }
}

export function validateAppEnvironmentContract({ exampleText, actualText }) {
  const exampleEntries = parseEnvironmentText(exampleText);
  const actualEntries = parseEnvironmentText(actualText);
  for (const name of exampleEntries.keys()) {
    if (!actualEntries.has(name)) fail("required_env_name_missing");
  }
  for (const value of actualEntries.values()) {
    if (value !== "" && PLACEHOLDER.test(value)) {
      fail("placeholder_env_value_rejected");
    }
  }
  for (const name of actualEntries.keys()) {
    if (FORBIDDEN_SUCCESSOR_RUNTIME_VALUES.includes(name) || name.startsWith("EVO_AGENT_")) {
      fail("superseded_env_name_forbidden");
    }
  }
  requireNonEmpty(actualEntries, REQUIRED_RUNTIME_VALUES, "required_env_value_missing");
  if (
    !UUID.test(actualEntries.get("EVO_PLATFORM_ORGANIZATION_ID")) ||
    !isSupabaseSecretKey(actualEntries.get("EVO_PLATFORM_SUPABASE_SECRET_KEY"))
  ) {
    fail("required_env_value_invalid");
  }
  validatePublicSupabase(actualEntries);
  validateFeatureFlags(actualEntries);
  validateEnabledFeatureConfiguration(actualEntries);
  return Object.freeze({ ok: true, code: "valid" });
}

function readClosedFile(path, { privateFile }) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    fail("env_path_invalid");
  }
  const absolute = resolve(path);
  const metadata = lstatSync(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail("env_file_invalid");
  if (metadata.size < 1 || metadata.size > MAX_ENV_BYTES) fail("env_file_invalid");
  if (realpathSync(absolute) !== absolute) fail("env_path_invalid");
  if (privateFile && !new Set([0o600, 0o640]).has(metadata.mode & 0o777)) {
    fail("env_permissions_invalid");
  }
  return readFileSync(absolute, "utf8");
}

function parseCli(argv) {
  if (!Array.isArray(argv)) fail("invalid_arguments");
  if (
    argv.length === 4 &&
    argv[0] === "--example" &&
    argv[2] === "--env"
  ) {
    return Object.freeze({ mode: "default", examplePath: argv[1], envPath: argv[3] });
  }
  fail("invalid_arguments");
}

export function runAppEnvironmentContractCli(argv) {
  const { examplePath, envPath } = parseCli(argv);
  return validateAppEnvironmentContract({
    exampleText: readClosedFile(examplePath, { privateFile: false }),
    actualText: readClosedFile(envPath, { privateFile: true }),
  });
}

const isMain =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const result = runAppEnvironmentContractCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write('{"ok":false,"code":"app_env_contract_invalid"}\n');
    process.exitCode = 1;
  }
}
