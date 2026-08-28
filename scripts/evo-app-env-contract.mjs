#!/usr/bin/env node

import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_ENV_BYTES = 256 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLACEHOLDER = /(?:replace-with-|change-me|changeme|placeholder)/iu;
const SUPABASE_PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/u;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,}$/u;
const PRODUCTION_SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/u;
const SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const CURRENT_PRODUCTION_SUPABASE_PROJECT_REF = "iosckaqtovbbnssqcpde";
const REQUIRED_RUNTIME_VALUES = Object.freeze([
  "EVO_CRM_DOMAIN",
  "EVO_CADDY_NETWORK",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "AUTH_SECRET",
  "EVO_SECRET_ENCRYPTION_KEY",
  "EVO_DB_PATH",
  "EVO_BACKUP_DIR",
]);
const V2_REQUIRED_RUNTIME_VALUES = Object.freeze([
  "DATABASE_URL",
  "EVO_PRIVATE_DOCUMENT_ROOT",
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

function validateV2RuntimeConfiguration(entries) {
  const v2Configured = V2_REQUIRED_RUNTIME_VALUES.some(
    (name) => (entries.get(name) ?? "") !== "",
  );
  if (!v2Configured) return;

  requireNonEmpty(
    entries,
    V2_REQUIRED_RUNTIME_VALUES,
    "v2_required_env_value_missing",
  );
  const documentRoot = entries.get("EVO_PRIVATE_DOCUMENT_ROOT");
  const resolvedRoot = resolve(documentRoot);
  if (
    documentRoot !== documentRoot.trim() ||
    !isAbsolute(documentRoot) ||
    resolvedRoot === resolve(resolvedRoot, "..")
  ) {
    fail("v2_private_document_root_invalid");
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
  requireNonEmpty(actualEntries, REQUIRED_RUNTIME_VALUES, "required_env_value_missing");
  if (
    actualEntries.get("AUTH_SECRET").length < 32 ||
    actualEntries.get("EVO_SECRET_ENCRYPTION_KEY").length < 32 ||
    !actualEntries.get("EVO_DB_PATH").startsWith("/") ||
    !actualEntries.get("EVO_BACKUP_DIR").startsWith("/")
  ) {
    fail("required_env_value_invalid");
  }
  validatePublicSupabase(actualEntries);
  validateFeatureFlags(actualEntries);
  validateEnabledFeatureConfiguration(actualEntries);
  validateV2RuntimeConfiguration(actualEntries);
  return Object.freeze({ ok: true, code: "valid" });
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validateControlledStagingAppEnvironment({
  exampleText,
  actualText,
  stagingProjectRef,
  productionProjectRef,
  stagingOrganizationId,
  stagingPublishableKeySha256,
  stagingSecretKeySha256,
  productionPublishableKeySha256,
  productionSecretKeySha256,
  stagingHostname,
}) {
  validateAppEnvironmentContract({ exampleText, actualText });
  const entries = parseEnvironmentText(actualText);

  if (
    !SUPABASE_PROJECT_REF.test(stagingProjectRef ?? "") ||
    !SUPABASE_PROJECT_REF.test(productionProjectRef ?? "") ||
    productionProjectRef !== CURRENT_PRODUCTION_SUPABASE_PROJECT_REF ||
    stagingProjectRef === productionProjectRef
  ) {
    fail("staging_supabase_identity_invalid");
  }
  if (
    !UUID.test(stagingOrganizationId ?? "") ||
    stagingOrganizationId === "00000000-0000-0000-0000-000000000000" ||
    !HOSTNAME.test(stagingHostname ?? "")
  ) {
    fail("staging_server_identity_invalid");
  }
  for (const fingerprint of [
    stagingPublishableKeySha256,
    stagingSecretKeySha256,
    productionPublishableKeySha256,
    productionSecretKeySha256,
  ]) {
    if (!SHA256.test(fingerprint ?? "")) fail("staging_key_fingerprint_invalid");
  }
  if (
    stagingPublishableKeySha256 === productionPublishableKeySha256 ||
    stagingSecretKeySha256 === productionSecretKeySha256
  ) {
    fail("staging_key_fingerprint_collision");
  }

  const actualUrl = new URL(entries.get("NEXT_PUBLIC_SUPABASE_URL"));
  const actualProjectRef = actualUrl.hostname.endsWith(".supabase.co")
    ? actualUrl.hostname.slice(0, -".supabase.co".length)
    : "";
  if (
    actualProjectRef === CURRENT_PRODUCTION_SUPABASE_PROJECT_REF ||
    actualProjectRef === productionProjectRef
  ) {
    fail("staging_supabase_url_collision");
  }
  if (actualUrl.origin !== `https://${stagingProjectRef}.supabase.co`) {
    fail("staging_supabase_url_mismatch");
  }
  if (entries.get("EVO_CRM_DOMAIN") !== stagingHostname) {
    fail("staging_hostname_identity_mismatch");
  }
  if (entries.get("EVO_PLATFORM_ORGANIZATION_ID") !== stagingOrganizationId) {
    fail("staging_organization_identity_mismatch");
  }

  const publishableKey = entries.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = entries.get("EVO_PLATFORM_SUPABASE_SECRET_KEY");
  const publishableFingerprint = sha256(publishableKey);
  if (
    publishableFingerprint === productionPublishableKeySha256 ||
    publishableFingerprint !== stagingPublishableKeySha256
  ) {
    fail("staging_supabase_publishable_key_mismatch");
  }
  if (!isSupabaseSecretKey(secretKey)) {
    fail("staging_supabase_secret_key_mismatch");
  }
  const secretFingerprint = sha256(secretKey);
  if (
    secretFingerprint === productionSecretKeySha256 ||
    secretFingerprint !== stagingSecretKeySha256
  ) {
    fail("staging_supabase_secret_key_mismatch");
  }

  return Object.freeze({ ok: true, code: "controlled_staging_env_valid" });
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
  if (
    argv.length === 5 &&
    argv[0] === "--controlled-staging" &&
    argv[1] === "--example" &&
    argv[3] === "--env"
  ) {
    return Object.freeze({ mode: "controlled-staging", examplePath: argv[2], envPath: argv[4] });
  }
  fail("invalid_arguments");
}

export function runAppEnvironmentContractCli(argv, environment = process.env) {
  const { mode, examplePath, envPath } = parseCli(argv);
  const files = {
    exampleText: readClosedFile(examplePath, { privateFile: false }),
    actualText: readClosedFile(envPath, { privateFile: true }),
  };
  if (mode === "default") return validateAppEnvironmentContract(files);
  return validateControlledStagingAppEnvironment({
    ...files,
    stagingProjectRef: environment.EVO_RELEASE_SUPABASE_PROJECT_REF,
    productionProjectRef: environment.EVO_PRODUCTION_SUPABASE_PROJECT_REF,
    stagingOrganizationId: environment.EVO_RELEASE_PLATFORM_ORGANIZATION_ID,
    stagingPublishableKeySha256:
      environment.EVO_RELEASE_SUPABASE_PUBLISHABLE_KEY_SHA256,
    stagingSecretKeySha256: environment.EVO_RELEASE_SUPABASE_SECRET_KEY_SHA256,
    productionPublishableKeySha256:
      environment.EVO_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SHA256,
    productionSecretKeySha256: environment.EVO_PRODUCTION_SUPABASE_SECRET_KEY_SHA256,
    stagingHostname: environment.EVO_RELEASE_PUBLIC_HOSTNAME,
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
