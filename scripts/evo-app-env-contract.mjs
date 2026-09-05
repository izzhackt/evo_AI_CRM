#!/usr/bin/env node

import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_ENV_BYTES = 256 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLACEHOLDER = /(?:replace-with-|change-me|changeme|placeholder)/iu;
const SUPABASE_PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/u;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,}$/u;
const SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/u;
const SUPABASE_KEY_VERIFICATION_TIMEOUT_MS = 10_000;
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

function validatePublicSupabase(entries, expectedSupabaseProjectRef) {
  if (!SUPABASE_PROJECT_REF.test(expectedSupabaseProjectRef)) {
    fail("expected_supabase_project_invalid");
  }
  const urlValue = entries.get("NEXT_PUBLIC_SUPABASE_URL");
  try {
    const url = new URL(urlValue);
    const expectedOrigin = `https://${expectedSupabaseProjectRef}.supabase.co`;
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/"
    ) {
      fail("public_supabase_url_invalid");
    }
    if (urlValue !== expectedOrigin || url.origin !== expectedOrigin) {
      fail("public_supabase_project_mismatch");
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

async function closeResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The status code is the only response material used by this verifier.
  }
}

async function verifySupabaseKey({
  endpoint,
  key,
  legacyBearer,
  failureCode,
  fetchImpl,
}) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        apikey: key,
        ...(legacyBearer ? { Authorization: `Bearer ${key}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(SUPABASE_KEY_VERIFICATION_TIMEOUT_MS),
    });
  } catch {
    fail("supabase_key_verification_unavailable");
  }
  const accepted = response.status === 200;
  await closeResponseBody(response);
  if (!accepted) fail(failureCode);
}

export async function verifySupabaseProjectCredentials({
  actualText,
  expectedSupabaseProjectRef,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") fail("supabase_key_verification_unavailable");
  if (!SUPABASE_PROJECT_REF.test(expectedSupabaseProjectRef)) {
    fail("expected_supabase_project_invalid");
  }
  const entries = parseEnvironmentText(actualText);
  const publishableKey = entries.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = entries.get("EVO_PLATFORM_SUPABASE_SECRET_KEY");
  if (
    typeof publishableKey !== "string" ||
    !isSupabasePublishableKey(publishableKey) ||
    typeof secretKey !== "string" ||
    !isSupabaseSecretKey(secretKey)
  ) {
    fail("required_env_value_invalid");
  }

  const origin = `https://${expectedSupabaseProjectRef}.supabase.co`;
  await verifySupabaseKey({
    endpoint: `${origin}/auth/v1/settings`,
    key: publishableKey,
    legacyBearer: false,
    failureCode: "public_supabase_key_project_mismatch",
    fetchImpl,
  });
  await verifySupabaseKey({
    endpoint: `${origin}/auth/v1/admin/users?page=1&per_page=1`,
    key: secretKey,
    legacyBearer: jwtRole(secretKey) === "service_role",
    failureCode: "secret_supabase_key_project_mismatch",
    fetchImpl,
  });
  return Object.freeze({ ok: true, code: "verified" });
}

function validateFeatureFlags(entries) {
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
      !isSupabaseSecretKey(serverKey)
    ) {
      fail("enabled_feature_configuration_missing");
    }
  }
}

export function validateAppEnvironmentContract({
  exampleText,
  actualText,
  expectedSupabaseProjectRef,
}) {
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
  validatePublicSupabase(actualEntries, expectedSupabaseProjectRef);
  validateFeatureFlags(actualEntries);
  validateEnabledFeatureConfiguration(actualEntries);
  return Object.freeze({ ok: true, code: "valid" });
}

function normalizedAbsolutePath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    fail("env_path_invalid");
  }
  const absolute = resolve(path);
  if (absolute !== path) fail("env_path_invalid");
  return absolute;
}

function requireNoFollowSupport() {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW) || fsConstants.O_NOFOLLOW === 0) {
    fail("no_follow_unavailable");
  }
}

function statIdentity(metadata) {
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mode: metadata.mode,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
  });
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function closedRegularFile(path, { privateFile, code = "env_file_invalid" }) {
  requireNoFollowSupport();
  const absolute = normalizedAbsolutePath(path);
  const beforePath = lstatSync(absolute, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) fail(code);
  if (beforePath.size < 1n || beforePath.size > BigInt(MAX_ENV_BYTES)) fail(code);
  if (realpathSync(absolute) !== absolute) fail("env_path_invalid");
  if (
    privateFile &&
    !new Set([0o600, 0o640]).has(Number(beforePath.mode & 0o777n))
  ) {
    fail("env_permissions_invalid");
  }

  let descriptor;
  try {
    // Node/libuv opens descriptors close-on-exec. Add O_CLOEXEC explicitly on
    // platforms that expose it, and always require O_NOFOLLOW.
    descriptor = openSync(
      absolute,
      fsConstants.O_RDONLY |
        fsConstants.O_NOFOLLOW |
        (fsConstants.O_CLOEXEC ?? 0),
    );
    const beforeDescriptor = fstatSync(descriptor, { bigint: true });
    if (
      !beforeDescriptor.isFile() ||
      !sameIdentity(statIdentity(beforePath), statIdentity(beforeDescriptor))
    ) {
      fail(code);
    }

    const bytes = Buffer.alloc(Number(beforeDescriptor.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count <= 0) fail(code);
      offset += count;
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(absolute, { bigint: true });
    if (
      !sameIdentity(statIdentity(beforeDescriptor), statIdentity(afterDescriptor)) ||
      !sameIdentity(statIdentity(beforeDescriptor), statIdentity(afterPath))
    ) {
      fail(code);
    }
    return Object.freeze({ absolute, bytes, metadata: statIdentity(afterDescriptor) });
  } catch (error) {
    if (error instanceof AppEnvironmentContractError) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readClosedFile(path, { privateFile }) {
  return closedRegularFile(path, { privateFile }).bytes.toString("utf8");
}

function removeCreatedSnapshot(path, createdIdentity) {
  if (!createdIdentity) return;
  try {
    const current = lstatSync(path, { bigint: true });
    if (sameInode(statIdentity(current), createdIdentity)) unlinkSync(path);
  } catch {
    // Never remove a path whose exact created inode cannot be re-proven.
  }
}

export function sealPrivateEnvironmentSnapshot(
  sourcePath,
  snapshotPath,
  { afterSourceOpened, afterSourceRead } = {},
) {
  requireNoFollowSupport();
  const source = normalizedAbsolutePath(sourcePath);
  const snapshot = normalizedAbsolutePath(snapshotPath);
  if (source === snapshot) fail("snapshot_path_invalid");
  if (realpathSync(dirname(snapshot)) !== dirname(snapshot)) {
    fail("snapshot_path_invalid");
  }

  let sourceDescriptor;
  let snapshotDescriptor;
  let createdIdentity;
  try {
    const sourcePathBefore = lstatSync(source, { bigint: true });
    if (sourcePathBefore.isSymbolicLink() || !sourcePathBefore.isFile()) {
      fail("snapshot_source_invalid");
    }
    if (
      sourcePathBefore.size < 1n ||
      sourcePathBefore.size > BigInt(MAX_ENV_BYTES)
    ) {
      fail("snapshot_source_invalid");
    }
    if (![0o600, 0o640].includes(Number(sourcePathBefore.mode & 0o777n))) {
      fail("env_permissions_invalid");
    }
    if (realpathSync(source) !== source) fail("env_path_invalid");

    sourceDescriptor = openSync(
      source,
      fsConstants.O_RDONLY |
        fsConstants.O_NOFOLLOW |
        (fsConstants.O_CLOEXEC ?? 0),
    );
    const sourceBefore = fstatSync(sourceDescriptor, { bigint: true });
    if (
      !sourceBefore.isFile() ||
      !sameIdentity(statIdentity(sourcePathBefore), statIdentity(sourceBefore))
    ) {
      fail("snapshot_source_changed");
    }
    afterSourceOpened?.();

    const bytes = Buffer.alloc(Number(sourceBefore.size));
    let readOffset = 0;
    while (readOffset < bytes.length) {
      const count = readSync(
        sourceDescriptor,
        bytes,
        readOffset,
        bytes.length - readOffset,
        null,
      );
      if (count <= 0) fail("snapshot_source_changed");
      readOffset += count;
    }
    afterSourceRead?.();

    const sourceAfter = fstatSync(sourceDescriptor, { bigint: true });
    const sourcePathAfter = lstatSync(source, { bigint: true });
    if (
      !sameIdentity(statIdentity(sourceBefore), statIdentity(sourceAfter)) ||
      !sameIdentity(statIdentity(sourceBefore), statIdentity(sourcePathAfter))
    ) {
      fail("snapshot_source_changed");
    }

    snapshotDescriptor = openSync(
      snapshot,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW |
        (fsConstants.O_CLOEXEC ?? 0),
      0o600,
    );
    fchmodSync(snapshotDescriptor, 0o600);
    createdIdentity = statIdentity(fstatSync(snapshotDescriptor, { bigint: true }));
    let writeOffset = 0;
    while (writeOffset < bytes.length) {
      const count = writeSync(
        snapshotDescriptor,
        bytes,
        writeOffset,
        bytes.length - writeOffset,
        null,
      );
      if (count <= 0) fail("snapshot_write_failed");
      writeOffset += count;
    }
    fsyncSync(snapshotDescriptor);

    const snapshotDescriptorAfter = fstatSync(snapshotDescriptor, { bigint: true });
    const snapshotPathAfter = lstatSync(snapshot, { bigint: true });
    if (
      !snapshotDescriptorAfter.isFile() ||
      Number(snapshotDescriptorAfter.mode & 0o777n) !== 0o600 ||
      snapshotDescriptorAfter.size !== BigInt(bytes.length) ||
      !sameIdentity(
        statIdentity(snapshotDescriptorAfter),
        statIdentity(snapshotPathAfter),
      )
    ) {
      fail("snapshot_write_failed");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return Object.freeze({ ok: true, sha256 });
  } catch (error) {
    removeCreatedSnapshot(snapshot, createdIdentity);
    if (error instanceof AppEnvironmentContractError) throw error;
    fail("snapshot_seal_failed");
  } finally {
    if (snapshotDescriptor !== undefined) closeSync(snapshotDescriptor);
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
  }
}

function parseCli(argv) {
  if (!Array.isArray(argv)) fail("invalid_arguments");
  if (
    argv.length === 4 &&
    argv[0] === "--seal-private-env" &&
    argv[2] === "--snapshot"
  ) {
    return Object.freeze({
      operation: "seal",
      sourcePath: argv[1],
      snapshotPath: argv[3],
    });
  }
  if (
    (argv.length === 6 || argv.length === 7) &&
    argv[0] === "--example" &&
    argv[2] === "--env" &&
    argv[4] === "--supabase-project-ref" &&
    (argv.length === 6 || argv[6] === "--verify-supabase-keys")
  ) {
    return Object.freeze({
      operation: "validate",
      examplePath: argv[1],
      envPath: argv[3],
      expectedSupabaseProjectRef: argv[5],
      verifySupabaseKeys: argv.length === 7,
    });
  }
  fail("invalid_arguments");
}

export async function runAppEnvironmentContractCli(argv) {
  const parsed = parseCli(argv);
  if (parsed.operation === "seal") {
    return sealPrivateEnvironmentSnapshot(parsed.sourcePath, parsed.snapshotPath);
  }
  const {
    examplePath,
    envPath,
    expectedSupabaseProjectRef,
    verifySupabaseKeys,
  } = parsed;
  const files = {
    exampleText: readClosedFile(examplePath, { privateFile: false }),
    actualText: readClosedFile(envPath, { privateFile: true }),
    expectedSupabaseProjectRef,
  };
  const result = validateAppEnvironmentContract(files);
  if (verifySupabaseKeys) {
    await verifySupabaseProjectCredentials({
      actualText: files.actualText,
      expectedSupabaseProjectRef,
    });
  }
  return result;
}

const isMain =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const result = await runAppEnvironmentContractCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write('{"ok":false,"code":"app_env_contract_invalid"}\n');
    process.exitCode = 1;
  }
}
