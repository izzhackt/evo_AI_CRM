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
import { isIP } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_ENV_BYTES = 256 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RUNTIME_IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLACEHOLDER = /(?:replace-with-|change-me|changeme|placeholder)/iu;
const SUPABASE_PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/u;
const SUPABASE_SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,}$/u;
const SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/u;
// Self-hosted Supabase (docs/runbooks/selfhosted-cutover.md): the "project" is the word
// `selfhosted` and the only accepted origin is exactly this one, with no patterns.
// The cloud branch (`<ref>.supabase.co`) is removed after the cutover (#1271).
const SELFHOSTED_SUPABASE_IDENTITY = "selfhosted";
const SELFHOSTED_SUPABASE_ORIGIN = "https://supabase.evoadmissions.com";
const SUPABASE_KEY_VERIFICATION_TIMEOUT_MS = 10_000;
const PRODUCTION_CRM_DOMAIN = "crm.evoadmissions.com";
const REQUIRED_RUNTIME_VALUES = Object.freeze([
  "EVO_CRM_DOMAIN",
  "EVO_CADDY_NETWORK",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EVO_PLATFORM_ORGANIZATION_ID",
  "EVO_PLATFORM_SUPABASE_SECRET_KEY",
]);
// Names documented in the example that a release may leave out entirely: the
// feature behind each is off while its value is missing or empty, so the CRM
// stays releasable before the owner adds it. A present, non-empty value must
// still be well-formed.
//  - EVO_AI_AGENT_INTERNAL_SECRET: HMAC of CRM → private «ИИ-агент» requests
//    (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.3, §4.7; ADR 0032), 32–256
//    printable characters without whitespace, distinct from every WAHA and
//    lead-agent secret.
//  - EVO_AI_AGENT_STORAGE_SECRET: HMAC of agent → CRM storage-broker requests
//    (§4.5, P2), same shape, distinct from the internal secret and every
//    other value: a leaked broker key opens no agent call and vice versa.
const OPTIONAL_RUNTIME_NAMES = Object.freeze(["EVO_AI_AGENT_INTERNAL_SECRET", "EVO_AI_AGENT_STORAGE_SECRET"]);
// «ИИ-агент» P4, ночной автоответчик (plan §11 rules 9 and 11; ADR 0031), also
// optional and off while missing or empty:
//  - EVO_AI_AGENT_AUTOSEND: the server switch of /api/internal/ai-agent/send;
//    only '', 0 or 1. `1` is accepted only with the agent connected
//    (EVO_AI_AGENT_INTERNAL_SECRET) and EVO_AI_AGENT_SEND_SECRET set: a switch
//    without them would open nothing and is refused rather than released.
//  - EVO_AI_AGENT_SEND_SECRET: HMAC of agent → CRM send requests, same shape as
//    the other agent secrets and distinct from every other value.
const OPTIONAL_AUTOSEND_NAMES = Object.freeze(["EVO_AI_AGENT_AUTOSEND", "EVO_AI_AGENT_SEND_SECRET"]);
const OPTIONAL_SECRET_NAMES = Object.freeze([...OPTIONAL_RUNTIME_NAMES, "EVO_AI_AGENT_SEND_SECRET"]);
// Beeline KG PBX telephony (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.5; ADR 0033),
// also optional: every name may be absent or empty and the feature stays off, so
// a release never fails on missing telephony env (plan §14, step 3).
//  - EVO_PLATFORM_TELEPHONY_ENABLED: the intake switch; only '', 0 or 1. `1` is
//    accepted only with EVO_PLATFORM_TELEPHONY_CRM_TOKEN set.
//  - EVO_PLATFORM_TELEPHONY_CRM_TOKEN / _NEXT: the key the PBX sends as
//    `crm_token`, 32-64 characters from [A-Za-z0-9-]; _NEXT only next to the
//    current key (rotation) and never equal to it.
//  - EVO_PLATFORM_TELEPHONY_PBX_TOKEN / _PBX_URL / _PBX_HOST: the outbound group,
//    all three or none: the cabinet key, the https API base without a trailing
//    slash and the tenant host.
// Each key is its own value: distinct from every other value in the file.
const TELEPHONY_ENABLED_NAME = "EVO_PLATFORM_TELEPHONY_ENABLED";
const TELEPHONY_CRM_TOKEN_NAMES = Object.freeze([
  "EVO_PLATFORM_TELEPHONY_CRM_TOKEN",
  "EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT",
]);
const TELEPHONY_PBX_NAMES = Object.freeze([
  "EVO_PLATFORM_TELEPHONY_PBX_TOKEN",
  "EVO_PLATFORM_TELEPHONY_PBX_URL",
  "EVO_PLATFORM_TELEPHONY_PBX_HOST",
]);
const OPTIONAL_TELEPHONY_NAMES = Object.freeze([
  TELEPHONY_ENABLED_NAME,
  ...TELEPHONY_CRM_TOKEN_NAMES,
  ...TELEPHONY_PBX_NAMES,
]);
const TELEPHONY_CRM_TOKEN = /^[A-Za-z0-9-]{32,64}$/u;
const TELEPHONY_PBX_TOKEN = /^[\x21-\x7e]{16,256}$/u;
const TELEPHONY_PBX_HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
// «ИИ-агенты» на Claude Managed Agents (docs/design/ai-agents/contract.md §C.6;
// ADR 0035), все имена OPTIONAL: пусто или нет — функция выключена, выпуск не
// падает. Заданное значение должно быть well-formed.
//  - EVO_ANTHROPIC_API_KEY: ключ Claude API (секрет), 20-300 печатных символов
//    без пробелов; не совпадает ни с одним другим значением этого env.
//  - EVO_ANTHROPIC_API_BASE_URL: https-адрес без пути (только свой шлюз/прокси).
//  - EVO_AI_AGENTS_MCP_URL: публичный https-адрес MCP CRM, путь /api/mcp/v1.
//  - EVO_AI_AGENTS_MCP_IP_ALLOWLIST: через запятую CIDR/адреса IPv4 и IPv6
//    либо `off` (временный обход фильтра).
//  - EVO_AI_AGENTS_RUN_BUDGET_USD: потолок расхода на запуск, число 0..100.
const AI_AGENTS_KEY_NAME = "EVO_ANTHROPIC_API_KEY";
const AI_AGENTS_BASE_URL_NAME = "EVO_ANTHROPIC_API_BASE_URL";
const AI_AGENTS_MCP_URL_NAME = "EVO_AI_AGENTS_MCP_URL";
const AI_AGENTS_MCP_IP_NAME = "EVO_AI_AGENTS_MCP_IP_ALLOWLIST";
const AI_AGENTS_BUDGET_NAME = "EVO_AI_AGENTS_RUN_BUDGET_USD";
const OPTIONAL_AI_AGENTS_NAMES = Object.freeze([
  AI_AGENTS_KEY_NAME,
  AI_AGENTS_BASE_URL_NAME,
  AI_AGENTS_MCP_URL_NAME,
  AI_AGENTS_MCP_IP_NAME,
  AI_AGENTS_BUDGET_NAME,
]);
const AI_AGENTS_API_KEY = /^[\x21-\x7e]{20,300}$/u;
const AI_AGENTS_MCP_PATH = "/api/mcp/v1";
const AI_AGENTS_BUDGET = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u;
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

function expectedSupabaseOrigin(expectedSupabaseProjectRef) {
  if (expectedSupabaseProjectRef === SELFHOSTED_SUPABASE_IDENTITY) {
    return SELFHOSTED_SUPABASE_ORIGIN;
  }
  if (
    typeof expectedSupabaseProjectRef !== "string" ||
    !SUPABASE_PROJECT_REF.test(expectedSupabaseProjectRef)
  ) {
    fail("expected_supabase_project_invalid");
  }
  return `https://${expectedSupabaseProjectRef}.supabase.co`;
}

function validatePublicSupabase(entries, expectedSupabaseProjectRef) {
  const expectedOrigin = expectedSupabaseOrigin(expectedSupabaseProjectRef);
  const urlValue = entries.get("NEXT_PUBLIC_SUPABASE_URL");
  try {
    const url = new URL(urlValue);
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
  const origin = expectedSupabaseOrigin(expectedSupabaseProjectRef);
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
      [
        ...shared,
        "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET",
        "EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID",
      ],
      "enabled_feature_configuration_missing",
    );
    if (entries.get("EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET").length < 32) {
      fail("enabled_feature_configuration_missing");
    }
    // Inbound projection fails for every message without this Sales owner.
    const intakeSalesMembershipId = entries.get(
      "EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID",
    );
    if (
      !UUID.test(intakeSalesMembershipId) ||
      intakeSalesMembershipId === "00000000-0000-0000-0000-000000000000"
    ) {
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

function validateOptionalFeatureConfiguration(entries) {
  for (const secretName of OPTIONAL_SECRET_NAMES) {
    const secret = entries.get(secretName);
    if (secret === undefined || secret === "") continue;
    if (!/^[\x21-\x7e]{32,256}$/u.test(secret)) {
      fail("optional_feature_configuration_invalid");
    }
    // Свой секрет: значение не совпадает ни с одним другим значением этого env
    // (WAHA HMAC, наблюдаемость, ключ сервера, второй секрет агента) — утечка
    // одного не открывает другого.
    for (const [name, value] of entries) {
      if (name !== secretName && value === secret) {
        fail("optional_feature_configuration_invalid");
      }
    }
  }
}

function validateAutosendConfiguration(entries) {
  const autosend = entries.get("EVO_AI_AGENT_AUTOSEND");
  if (autosend === undefined || autosend === "" || autosend === "0") return;
  if (autosend !== "1") fail("unsafe_runtime_flag");
  requireNonEmpty(
    entries,
    ["EVO_AI_AGENT_INTERNAL_SECRET", "EVO_AI_AGENT_SEND_SECRET"],
    "enabled_feature_configuration_missing",
  );
}

function isTelephonyPbxUrl(value) {
  if (value.endsWith("/")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      // Canonical text only (lower-case host, no default port, a path): what is
      // written is exactly what the client will call.
      url.href === value
    );
  } catch {
    return false;
  }
}

function validateTelephonyConfiguration(entries) {
  const value = (name) => entries.get(name) ?? "";
  const enabled = value(TELEPHONY_ENABLED_NAME);
  if (enabled !== "" && enabled !== "0" && enabled !== "1") fail("unsafe_runtime_flag");

  const [current, next] = TELEPHONY_CRM_TOKEN_NAMES.map(value);
  if (current !== "" && !TELEPHONY_CRM_TOKEN.test(current)) {
    fail("optional_feature_configuration_invalid");
  }
  if (next !== "" && (current === "" || !TELEPHONY_CRM_TOKEN.test(next))) {
    fail("optional_feature_configuration_invalid");
  }

  const [pbxToken, pbxUrl, pbxHost] = TELEPHONY_PBX_NAMES.map(value);
  const presentPbx = [pbxToken, pbxUrl, pbxHost].filter((item) => item !== "").length;
  if (presentPbx !== 0) {
    if (
      presentPbx !== 3 ||
      !TELEPHONY_PBX_TOKEN.test(pbxToken) ||
      !isTelephonyPbxUrl(pbxUrl) ||
      !TELEPHONY_PBX_HOST.test(pbxHost)
    ) {
      fail("optional_feature_configuration_invalid");
    }
  }

  for (const secretName of [...TELEPHONY_CRM_TOKEN_NAMES, TELEPHONY_PBX_NAMES[0]]) {
    const secret = value(secretName);
    if (secret === "") continue;
    for (const [name, other] of entries) {
      if (name !== secretName && other === secret) {
        fail("optional_feature_configuration_invalid");
      }
    }
  }

  if (enabled === "1" && current === "") {
    fail("enabled_feature_configuration_missing");
  }
}

function isCanonicalHttpsUrl(value, pathname) {
  if (value === "" || value.endsWith("/")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === pathname &&
      // Canonical text only: what is written is exactly what the client calls.
      `${url.origin}${pathname === "/" ? "" : pathname}` === value
    );
  } catch {
    return false;
  }
}

function isIpOrCidr(value) {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length > 0) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^(?:0|[1-9]\d{0,2})$/u.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function validateAiAgentsConfiguration(entries) {
  const value = (name) => entries.get(name) ?? "";

  const key = value(AI_AGENTS_KEY_NAME);
  if (key !== "") {
    if (!AI_AGENTS_API_KEY.test(key)) fail("optional_feature_configuration_invalid");
    // Свой секрет: значение не совпадает ни с одним другим значением этого env.
    for (const [name, other] of entries) {
      if (name !== AI_AGENTS_KEY_NAME && other === key) {
        fail("optional_feature_configuration_invalid");
      }
    }
  }

  const baseUrl = value(AI_AGENTS_BASE_URL_NAME);
  if (baseUrl !== "" && !isCanonicalHttpsUrl(baseUrl, "/")) {
    fail("optional_feature_configuration_invalid");
  }

  const mcpUrl = value(AI_AGENTS_MCP_URL_NAME);
  if (mcpUrl !== "" && !isCanonicalHttpsUrl(mcpUrl, AI_AGENTS_MCP_PATH)) {
    fail("optional_feature_configuration_invalid");
  }

  const allowlist = value(AI_AGENTS_MCP_IP_NAME);
  if (allowlist !== "" && allowlist !== "off") {
    const items = allowlist.split(",").map((item) => item.trim());
    if (items.some((item) => !isIpOrCidr(item))) {
      fail("optional_feature_configuration_invalid");
    }
  }

  const budget = value(AI_AGENTS_BUDGET_NAME);
  if (budget !== "" && (!AI_AGENTS_BUDGET.test(budget) || Number(budget) > 100)) {
    fail("optional_feature_configuration_invalid");
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
    if (
      !actualEntries.has(name) &&
      !OPTIONAL_RUNTIME_NAMES.includes(name) &&
      !OPTIONAL_AUTOSEND_NAMES.includes(name) &&
      !OPTIONAL_TELEPHONY_NAMES.includes(name) &&
      !OPTIONAL_AI_AGENTS_NAMES.includes(name)
    ) {
      fail("required_env_name_missing");
    }
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
  if (actualEntries.get("EVO_CRM_DOMAIN") !== PRODUCTION_CRM_DOMAIN) {
    fail("crm_domain_invalid");
  }
  if (
    !UUID.test(actualEntries.get("EVO_PLATFORM_ORGANIZATION_ID")) ||
    !isSupabaseSecretKey(actualEntries.get("EVO_PLATFORM_SUPABASE_SECRET_KEY"))
  ) {
    fail("required_env_value_invalid");
  }
  validatePublicSupabase(actualEntries, expectedSupabaseProjectRef);
  validateFeatureFlags(actualEntries);
  validateEnabledFeatureConfiguration(actualEntries);
  validateOptionalFeatureConfiguration(actualEntries);
  validateAutosendConfiguration(actualEntries);
  validateTelephonyConfiguration(actualEntries);
  validateAiAgentsConfiguration(actualEntries);
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
  return sealEnvironmentSnapshot(sourcePath, snapshotPath, {
    afterSourceOpened, afterSourceRead,
  });
}

export function sealCandidateEnvironmentSnapshot(
  sourcePath,
  snapshotPath,
  runtimeImageId,
  { afterSourceOpened, afterSourceRead } = {},
) {
  if (typeof runtimeImageId !== "string" || !RUNTIME_IMAGE_ID.test(runtimeImageId)) {
    fail("runtime_image_id_invalid");
  }
  return sealEnvironmentSnapshot(sourcePath, snapshotPath, {
    afterSourceOpened, afterSourceRead, runtimeImageId,
  });
}

function sealEnvironmentSnapshot(
  sourcePath,
  snapshotPath,
  { afterSourceOpened, afterSourceRead, runtimeImageId },
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

    let bytes = Buffer.alloc(Number(sourceBefore.size));
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

    if (runtimeImageId !== undefined) {
      const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const entries = parseEnvironmentText(sourceText);
      if (entries.has("EVO_RUNTIME_IMAGE_ID")) fail("runtime_image_id_reserved");
      bytes = Buffer.concat([
        bytes,
        Buffer.from(`${sourceText.endsWith("\n") ? "" : "\n"}EVO_RUNTIME_IMAGE_ID=${runtimeImageId}\n`),
      ]);
      if (bytes.length > MAX_ENV_BYTES) fail("snapshot_source_invalid");
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

export function verifyRuntimeEnvironmentIdentity({
  snapshotText, containerEnvironment, runtimeImageId, releaseRevision,
  historicalPrevious = false,
}) {
  if (typeof runtimeImageId !== "string" || !RUNTIME_IMAGE_ID.test(runtimeImageId)) {
    fail("runtime_image_id_invalid");
  }
  if (typeof releaseRevision !== "string" || !/^[a-f0-9]{40}$/u.test(releaseRevision)) {
    fail("runtime_revision_invalid");
  }
  if (typeof historicalPrevious !== "boolean" || !Array.isArray(containerEnvironment) ||
    containerEnvironment.some((value) => typeof value !== "string")) {
    fail("runtime_environment_invalid");
  }
  const snapshot = parseEnvironmentText(snapshotText);
  const ids = containerEnvironment.filter((value) => value.startsWith("EVO_RUNTIME_IMAGE_ID="));
  const revisions = containerEnvironment.filter((value) => value.startsWith("EVO_RELEASE_REVISION="));
  if (revisions.length !== 1 || revisions[0] !== `EVO_RELEASE_REVISION=${releaseRevision}`) {
    fail("runtime_revision_drift");
  }
  if (historicalPrevious && !snapshot.has("EVO_RUNTIME_IMAGE_ID") && ids.length === 0) {
    return Object.freeze({ ok: true });
  }
  if (snapshot.get("EVO_RUNTIME_IMAGE_ID") !== runtimeImageId ||
    ids.length !== 1 || ids[0] !== `EVO_RUNTIME_IMAGE_ID=${runtimeImageId}`) {
    fail("runtime_image_id_drift");
  }
  return Object.freeze({ ok: true });
}

function readRuntimeEnvironmentStdin() {
  // Docker's environment includes secrets: bound it and never echo it, even on failure.
  const bytes = Buffer.alloc(MAX_ENV_BYTES * 2 + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(0, bytes, offset, bytes.length - offset, null);
    if (count === 0) {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
    }
    offset += count;
  }
  fail("runtime_environment_invalid");
}

function parseCli(argv) {
  if (!Array.isArray(argv)) fail("invalid_arguments");
  if (
    (argv.length === 7 || argv.length === 8) && argv[0] === "--verify-runtime-identity" &&
    argv[1] === "--snapshot" && argv[3] === "--runtime-image-id" &&
    argv[5] === "--release-revision" &&
    (argv.length === 7 || argv[7] === "--historical-previous")
  ) {
    return Object.freeze({
      operation: "runtime-identity", snapshotPath: argv[2], runtimeImageId: argv[4],
      releaseRevision: argv[6], historicalPrevious: argv.length === 8,
    });
  }
  if (
    argv.length === 6 && argv[0] === "--seal-candidate-env" &&
    argv[2] === "--snapshot" && argv[4] === "--runtime-image-id"
  ) {
    return Object.freeze({
      operation: "seal-candidate", sourcePath: argv[1], snapshotPath: argv[3],
      runtimeImageId: argv[5],
    });
  }
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
  if (parsed.operation === "runtime-identity") {
    return verifyRuntimeEnvironmentIdentity({
      snapshotText: readClosedFile(parsed.snapshotPath, { privateFile: true }),
      containerEnvironment: readRuntimeEnvironmentStdin(),
      runtimeImageId: parsed.runtimeImageId, releaseRevision: parsed.releaseRevision,
      historicalPrevious: parsed.historicalPrevious,
    });
  }
  if (parsed.operation === "seal-candidate") {
    return sealCandidateEnvironmentSnapshot(
      parsed.sourcePath, parsed.snapshotPath, parsed.runtimeImageId,
    );
  }
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
