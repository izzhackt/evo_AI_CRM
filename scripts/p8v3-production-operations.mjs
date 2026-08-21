#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { P8V3 } from "./p8v3-rollout.mjs";
import { verifyPortableArchive } from "./p8b3-portable-image-identity.mjs";
import {
  createManagementClient,
  normalizeMigrationLedger,
} from "./p8d4b-supabase-migrations.mjs";

const HERMES = "hermes-vps";
const PROJECT_REF = "iosckaqtovbbnssqcpde";
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const RELEASE_ID = "2026-08-21.p8v3k.1";
const RELEASE_VERSION = "p8v3k-0f1454d0-20260821";
const RELEASE_ROOT = `/opt/evo-releases/${P8V3.applicationCommit}/${RELEASE_ID}`;
const PREFLIGHT_ROOT = "/opt/evo-release-preflight/p8v3k-20260821.1";
const PREFLIGHT_OWNER_FILE = ".p8v3k-owner";
const PREFLIGHT_PARENT = dirname(PREFLIGHT_ROOT);
const PREFLIGHT_PREFIX = basename(PREFLIGHT_ROOT);
const REMOTE_REPO = `${RELEASE_ROOT}/repo`;
const REMOTE_ARCHIVES = `${RELEASE_ROOT}/archives`;
const KNOWLEDGE_REMOTE = `${RELEASE_ROOT}/knowledge-incoming`;
const IMPORTER = "evo-p8v3k-knowledge-import";
const IMPORTER_FILE = "p8v3k-platform-knowledge-import.mjs";
const IMPORTER_OWNER_LABEL = "evo.p8v3k.importer-owner";
const PRODUCTION_CRM_COMPOSE = "/opt/evo-crm/docker-compose.prod.yml";
const PRODUCTION_CRM_ENV_FILE = "/opt/evo-crm/.env.production";
const PRODUCTION_CRM_COMPOSE_SHA256 = "51b6a19cdf4797f7e882d4638c12177030fcb3e0258311a7682db7d959c28988";
const STAGED_CRM_COMPOSE_SHA256 = "ae3689f60d14c1463a77512afbe8d24db59d079473435e9c8b2d01c222eb7a6f";
const STAGED_INBOX_COMPOSE_SHA256 = "31c7b758ac5220b17511ef18df7f1058b4dff39bb08c21e02bb106272496076b";
const IMPORTER_NETWORK = "evo_crm_private";
const IMPORTER_MOUNT = `/run/evo-p8v3k/${IMPORTER_FILE}`;
const BUNDLE_MOUNT = "/run/evo-p8v3k/knowledge-bundle.json";
const MANIFEST_MOUNT = "/run/evo-p8v3k/knowledge-manifest.json";
const CONFIG_ROLLBACK_ROOT = `/opt/evo-release-rollback/${RELEASE_ID}`;
const P8V2D_ROLLBACK_ROOT = "/opt/evo-release-evidence/p8v2d-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818";
const EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3k-20260821.1";
const REMOTE_RESULT = `${EVIDENCE_ROOT}/p8v3k-rollout-result.json`;
const PRESERVED_P8V3J_EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3j-20260821.1";
const PRESERVED_P8V3J_RESULT_SHA256 = "45b67745d808333b74af8feeb7c1d213e2a018ac1690c0154212341591753486";
const PRESERVED_P8V3I_EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3i-20260821.1";
const PRESERVED_P8V3I_RESULT_SHA256 = "1709094ba438286f00d9ebb83ae6a7377f8cd7fdb2f2d4a72e1ef3eb08698e26";
const PRESERVED_P8V3H_EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3h-20260821.1";
const PRESERVED_P8V3H_RESULT_SHA256 = "52710d73b6308db1d1e62af9a1a25cae0cc58c3ddfa67d40e84326c960933f04";
const PRESERVED_P8V3G_EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3g-20260821.1";
const PRESERVED_P8V3G_RESULT_SHA256 = "ce4f9d4b0c96cc6cbddbf3a7d759a84c4f2b806155d4b3f5bda6d1f033207243";
const PRESERVED_P8V3G_RELEASE_ROOT = `/opt/evo-releases/${P8V3.applicationCommit}/2026-08-21.p8v3g.1`;
const PRESERVED_P8V3G_ROLLBACK_ROOT = "/opt/evo-release-rollback/2026-08-21.p8v3g.1";
const PRESERVED_P8V3G_IMPORTER_SHA256 = "9652bd510c4c82ac7523621f3236d28dd7c673671c9d252fab86e4a8cee7dcf1";
const PRESERVED_P8V3G_IMPORTER_SIZE = 853_105;
const PRESERVED_P8V3F_EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3f-20260820.1";
const PRESERVED_P8V3F_RESULT_SHA256 = "02af7782d0ed7020c900109725f8b681504f68479cf90727127fd70d2aeb9f4d";
const PRESERVED_P8V3F_RELEASE_ROOT = `/opt/evo-releases/${P8V3.applicationCommit}/2026-08-20.p8v3f.1`;
const PRESERVED_P8V3F_ROLLBACK_ROOT = "/opt/evo-release-rollback/2026-08-20.p8v3f.1";
const PRESERVED_P8V3E_EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3e-20260820.1";
const PRESERVED_P8V3E_RESULT_SHA256 = "328dd56efc616b1492b42c399651733186a5167e8214798b8e21eef5f60fa185";
const PRESERVED_P8V3E_RELEASE_ROOT = `/opt/evo-releases/${P8V3.applicationCommit}/2026-08-20.p8v3e.1`;
const PRESERVED_P8V3E_ROLLBACK_ROOT = "/opt/evo-release-rollback/2026-08-20.p8v3e.1";
const WAHA_IMAGE = "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c";
const CLIENT_VAULT = "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО";
const INTERNAL_VAULT = "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ";
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const IMPORTER_OWNER = /^[0-9a-f]{48}$/;
const MAX_OUTPUT = 2_000_000;
const CLI_VERSION = "2.110.0";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const IMPORTER_MIN_BYTES = 1;
const IMPORTER_MAX_BYTES = 4 * 1024 * 1024;

export const P8V3_IMAGES = Object.freeze({
  crm: Object.freeze({
    name: "crm",
    file: `evo-crm-${P8V3.applicationCommit}-p8v2d-linux-amd64.tar`,
    sha256: "77980a66b2f717cb3ffdb0e7d73d63efbbf6801a9ef5453fd07a9841f6b36ee9",
    size: 87_142_400,
    index: "sha256:711535e0d1216663e42b2d2dd4e2b042812d8bce8ebe82a5c3eb6ae866d60a45",
    platform: "sha256:fc3487ce079663694aee583891c3939296915634bea61dd293db235b57e748f3",
    sourceTag: `evo-crm:${P8V3.applicationCommit}-p8v2d-linux-amd64`,
    composeTag: `evo-crm:${P8V3.applicationCommit}`,
    container: "evo-crm-app-1",
    service: "app",
    networks: Object.freeze(["evo_crm_private", "evo_public_web"]),
    beforeImage: "sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580",
    rollbackRevision: "564332b420a1fb1bd6232dda945d044bb922d3f0",
    rollbackArchive: "rollback-evo-crm-d4626208423d-linux-amd64.tar",
    rollbackCompose: "crm-app-compose.prod.yml",
    rollbackEnv: "crm-env.production",
  }),
  inbox: Object.freeze({
    name: "inbox",
    file: `evo-inbox-${P8V3.applicationCommit}-p8v2d-linux-amd64.tar`,
    sha256: "2c6d1f275a0f88a9a9e257d3a00756e9a8d438e262a9998d2da89431731eb82e",
    size: 79_557_632,
    index: "sha256:468797e2096146359a4dc814caac7c0d87bdf30ab3b30d2f77d4c02f63dfefdf",
    platform: "sha256:be31ddf6e3e51fb6fcade87a60ed15b2cf11855db717d7a440a9335c8d49a67f",
    sourceTag: `evo-inbox:${P8V3.applicationCommit}-p8v2d-linux-amd64`,
    composeTag: `evo-inbox:${P8V3.applicationCommit}`,
    container: "evo-inbox-app-1",
    service: "app",
    networks: Object.freeze(["evo_inbox_private", "evo_public_web"]),
    beforeImage: "sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b",
    rollbackRevision: "a09a72fc55d869c861df520f76d62413a2315fc1",
    rollbackArchive: "rollback-evo-inbox-6d5e0a9d5ea0-linux-amd64.tar",
    rollbackCompose: "inbox-app-compose.prod.yml",
    rollbackEnv: "inbox-env.production",
  }),
  lead_agent: Object.freeze({
    name: "lead_agent",
    file: `evo-lead-agent-${P8V3.applicationCommit}-p8v2d-linux-amd64.tar`,
    sha256: "d7467b4d8fdda18248fb7a66ad77cb7618fc30965f3861e724886e37395bea14",
    size: 89_760_256,
    index: "sha256:0aa4c5aac2774a17a8bcf4b751064b18673b95857340da0edaff5cfacf4c979f",
    platform: "sha256:0bf6924d246d3cfab25ebe05bd9cb0d8f653b5625c9b2887856d87408b97af2c",
    sourceTag: `evo-lead-agent:${P8V3.applicationCommit}-p8v2d-linux-amd64`,
    composeTag: `evo-lead-agent:${P8V3.applicationCommit}`,
    container: "evo-crm-lead-agent-1",
    service: "lead-agent",
    networks: Object.freeze(["evo_crm_private"]),
    beforeImage: "sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7",
    rollbackRevision: "b2303eccb78b7c102ec702e9821f765f6dfaba88",
    rollbackArchive: "rollback-evo-lead-agent-3678747c1ea1-linux-amd64.tar",
    rollbackCompose: "lead-agent-compose.prod.yml",
    rollbackEnv: "crm-env.lead-agent",
  }),
});

const PRODUCTION_CONTAINERS = Object.freeze([
  Object.freeze({ name: "evo-crm-app-1", image: P8V3_IMAGES.crm.beforeImage, networks: P8V3_IMAGES.crm.networks }),
  Object.freeze({ name: "evo-crm-waha-1", image: WAHA_IMAGE, networks: Object.freeze(["evo_crm_private"]) }),
  Object.freeze({ name: "evo-crm-lead-agent-1", image: P8V3_IMAGES.lead_agent.beforeImage, networks: P8V3_IMAGES.lead_agent.networks }),
  Object.freeze({ name: "evo-inbox-app-1", image: P8V3_IMAGES.inbox.beforeImage, networks: P8V3_IMAGES.inbox.networks }),
  Object.freeze({ name: "evo-inbox-waha", image: WAHA_IMAGE, networks: Object.freeze(["evo_inbox_private"]) }),
]);

const REQUIRED_ROLLBACK_FILES = Object.freeze([
  "crm-app-compose.prod.yml", "crm-current-docker-compose.prod.yml", "crm-env.lead-agent",
  "crm-env.production", "crm-env.waha", "crm-waha-compose.prod.yml",
  "inbox-app-compose.prod.yml", "inbox-current-docker-compose.prod.yml",
  "inbox-env.production", "inbox-env.waha", "inbox-waha-compose.prod.yml",
  "lead-agent-compose.prod.yml", "rollback-evo-crm-d4626208423d-linux-amd64.tar",
  "rollback-evo-inbox-6d5e0a9d5ea0-linux-amd64.tar",
  "rollback-evo-lead-agent-3678747c1ea1-linux-amd64.tar",
]);
const ROLLBACK_SHA256 = Object.freeze({
  "crm-app-compose.prod.yml": "51b6a19cdf4797f7e882d4638c12177030fcb3e0258311a7682db7d959c28988",
  "crm-current-docker-compose.prod.yml": "51b6a19cdf4797f7e882d4638c12177030fcb3e0258311a7682db7d959c28988",
  "crm-env.lead-agent": "6968d61beccec257eb44eee64387f9714f2e82caa5bd1987ed8d10dfd386becd",
  "crm-env.production": "f9b2524b963ea90d4f3472c5d2d423fa141dfaf1e412b1574f8203f2048ed5f8",
  "crm-env.waha": "6c0c8c11ccb63d478f83ec2778ee8b7c392d3af9587ff55842928c49cde14b0f",
  "crm-waha-compose.prod.yml": "c04fc471a50cacf1b023cb032f82502941d4b6137f56e47d1faf5e563d7cd04e",
  "inbox-app-compose.prod.yml": "4c2801282106a2f0ea79f10333b2fcd6be46c495fcf43829989bb8775f56fee3",
  "inbox-current-docker-compose.prod.yml": "51b6a19cdf4797f7e882d4638c12177030fcb3e0258311a7682db7d959c28988",
  "inbox-env.production": "b37ac1fc6bdf84e037a1b1a59ffe3d47a9f4cbbbbdae6f1c5e437517ee50348b",
  "inbox-env.waha": "cf4ae0000fed3ccf9281ba2c6e07884fd43bbff9b1ed9a763cde4841186f582c",
  "inbox-waha-compose.prod.yml": "9c0562b47485d85349823347f5f47166b379e31ca8b1d07ab69c7c629347ea4e",
  "lead-agent-compose.prod.yml": "3cf6713467d236e7174a8693f01e559bb0555ee24a980af0e5c31bfe5c67636f",
  "rollback-evo-crm-d4626208423d-linux-amd64.tar": "375689fad1b5ab88524f6f05d4f7e05b1dfc7c35decdeb0604edf4fc7bf34e61",
  "rollback-evo-inbox-6d5e0a9d5ea0-linux-amd64.tar": "9edc1069232e9a6ce00c2415076b43e7bfad2465379a1bdfe9960bcfcbab09a1",
  "rollback-evo-lead-agent-3678747c1ea1-linux-amd64.tar": "56bfa69555bb8d7b8d21e96f9ab8dbe6ef853859ddd477455c0a106a12ada277",
});

function fail(message, code = "verification_failed", reasonCode) {
  const error = new Error(message);
  error.code = code;
  if (reasonCode !== undefined) error.reasonCode = reasonCode;
  throw error;
}

function enrichKnowledgeCleanupFailure(error, record) {
  const enriched = error instanceof Error ? error : new Error("knowledge job cleanup failed");
  enriched.code = "knowledge_failed";
  enriched.reasonCode = "transport_failed";
  enriched.appliedKnowledgeRecord = structuredClone(record);
  return enriched;
}

export function enrichP8V3KnowledgeCleanupFailureForTest(error, record) {
  return enrichKnowledgeCleanupFailure(error, record);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(value, label) {
  try { return JSON.parse(value); } catch { fail(`${label} returned malformed JSON`); }
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`${label} is not closed`);
}

export function parseP8V3KnowledgeImporterOutputForTest(stdout, audience, bundleSha256) {
  if (
    typeof stdout !== "string" ||
    stdout.length < 2 ||
    !stdout.endsWith("\n") ||
    stdout.slice(0, -1).includes("\n") ||
    stdout.includes("\r")
  ) fail(`${audience} importer output is not one closed record`, "knowledge_failed", "transport_failed");
  let safe;
  try {
    safe = JSON.parse(stdout.slice(0, -1));
  } catch {
    fail(`${audience} importer result returned malformed JSON`, "knowledge_failed", "transport_failed");
  }
  if (safe?.status === "knowledge_import_blocked") {
    exactKeys(safe, ["status", "version", "audience", "reason_code"], "blocked importer result");
    if (safe.version !== 1 || safe.audience !== audience || !["provider_rate_limited", "provider_rejected", "bundle_invalid", "manifest_mismatch", "account_binding_failed", "rpc_rejected", "transport_failed"].includes(safe.reason_code)) fail(`${audience} blocked importer result drifted`, "knowledge_failed", "transport_failed");
    fail(`${audience} importer blocked`, "knowledge_failed", safe.reason_code);
  }
  exactKeys(safe, ["status", "version", "audience", "bundle_sha256", "documents_upserted", "documents_deleted", "chunks_replaced"], "importer result");
  if (safe.status !== "knowledge_import_verified" || safe.version !== 1 || safe.audience !== audience || safe.bundle_sha256 !== bundleSha256) fail(`${audience} importer result drifted`, "knowledge_failed", "rpc_rejected");
  return safe;
}

export function parseP8V3ProviderProbeOutputForTest(stdout) {
  if (
    typeof stdout !== "string" ||
    stdout.length < 2 ||
    !stdout.endsWith("\n") ||
    stdout.slice(0, -1).includes("\n") ||
    stdout.includes("\r")
  ) fail("provider probe output is not one closed record", "preflight_drift");
  let safe;
  try {
    safe = JSON.parse(stdout.slice(0, -1));
  } catch {
    fail("provider probe output returned malformed JSON", "preflight_drift");
  }
  if (safe?.status === "knowledge_import_provider_blocked") {
    exactKeys(safe, ["status", "version", "reason_code"], "provider probe blocked result");
    if (safe.version !== 1 || !["provider_rate_limited", "provider_rejected", "bundle_invalid", "manifest_mismatch", "account_binding_failed", "rpc_rejected", "transport_failed"].includes(safe.reason_code)) fail("provider probe blocked result drifted", "preflight_drift");
    fail(`provider probe blocked: ${safe.reason_code}`, "preflight_drift");
  }
  exactKeys(safe, ["status", "version", "model", "vectors", "dimensions", "uid", "gid"], "provider probe result");
  if (safe.status !== "knowledge_import_provider_verified" || safe.version !== 1 || safe.model !== "gemini-embedding-2" || safe.vectors !== 17 || safe.dimensions !== 1536 || safe.uid !== 1001 || safe.gid !== 1001) fail("provider probe result drifted", "preflight_drift");
  return { server_compose_verified: true };
}

const parseP8V3ProviderProbeOutput = parseP8V3ProviderProbeOutputForTest;

function assertRegular(path, mode = 0o600) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== mode) fail(`unsafe file: ${basename(path)}`, "preflight_drift");
}

function assertDirectory(path, mode = 0o700) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== mode) fail(`unsafe directory: ${basename(path)}`, "preflight_drift");
}

export function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    maxBuffer: MAX_OUTPUT,
  });
  if (result.error || result.signal || result.status !== 0) fail(`${options.label ?? command} failed`, options.code ?? "verification_failed");
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function runP8V3StreamedRemoteForTest(run, script, { input = "", timeout = 300_000, label = "Hermes operation", code } = {}) {
  const result = run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-seu"], { input: `${script}\n${input}`, timeout, label, code });
  if (result.stderr !== "") fail(`${label} emitted stderr`, code ?? "verification_failed");
  return result;
}

const remote = runP8V3StreamedRemoteForTest;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function commandSshArgs(script) {
  const body = String(script).replace(/^\n/, "");
  if (!body.startsWith("set -u\n")) fail("remote command body must start with set -u", "preflight_drift");
  return ["-o", "BatchMode=yes", HERMES, "bash", "-e", "-c", shellQuote(body)];
}

export function configurationSshArgs(script = configurationInstallScript()) {
  return commandSshArgs(script);
}

export function verifyP8V3HRemoteCommandFormsForTest(run) {
  const streamed = remote(run, "true", {
    timeout: 30_000,
    label: "P8V3 streamed shell startup",
    code: "preflight_drift",
  });
  if (streamed.stdout !== "" || streamed.stderr !== "") fail("P8V3 streamed shell startup emitted output", "preflight_drift");
  const result = run("ssh", commandSshArgs("set -u\ntrue"), {
    timeout: 30_000,
    label: "P8V3 command shell startup",
    code: "preflight_drift",
  });
  if (result.stdout !== "" || result.stderr !== "") fail("P8V3 command shell startup emitted output", "preflight_drift");
  const stdin = run("ssh", commandSshArgs("set -u\nIFS= read -r sentinel\n[[ \"$sentinel\" == 'P8V3H_SAFE_STDIN' ]]\nprintf 'p8v3h_command_stdin_verified\\n'"), {
    input: "P8V3H_SAFE_STDIN\n",
    timeout: 30_000,
    label: "P8V3 command stdin startup",
    code: "preflight_drift",
  });
  if (stdin.stdout !== "p8v3h_command_stdin_verified\n" || stdin.stderr !== "" || stdin.stdout.includes("P8V3H_SAFE_STDIN")) fail("P8V3 command stdin startup drifted", "preflight_drift");
}

const verifyRemoteCommandForms = verifyP8V3HRemoteCommandFormsForTest;

function remaining(deadlineAt) {
  const value = deadlineAt - Date.now();
  if (!Number.isFinite(value) || value <= 0) fail("authorization expired", "authorization_expired");
  return Math.max(1, Math.floor(value));
}

function parseContainerRows(text) {
  const rows = text.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.split("|");
    if (parts.length !== 6) fail("production inventory row is malformed", "preflight_drift");
    const [name, container_id, image_id, health, restartText, networksText] = parts;
    const restart_count = Number(restartText);
    const networks = networksText.split(",").filter(Boolean).sort();
    if (!SHA64.test(container_id) || !IMAGE_ID.test(image_id) || health !== "healthy" || restart_count !== 0) fail("production container is unstable", "preflight_drift");
    return { name, container_id, image_id, health, restart_count, networks };
  });
  if (rows.length !== PRODUCTION_CONTAINERS.length) fail("production container cardinality drifted", "preflight_drift");
  for (const [index, expected] of PRODUCTION_CONTAINERS.entries()) {
    const row = rows[index];
    if (row.name !== expected.name || row.image_id !== expected.image || row.networks.join("\0") !== expected.networks.slice().sort().join("\0")) fail(`production pre-state drifted: ${expected.name}`, "preflight_drift");
  }
  return rows;
}

function productionInventoryScript() {
  const names = PRODUCTION_CONTAINERS.map((item) => item.name).join(" ");
  return String.raw`
for name in ${names}; do
  printf '%s|' "$name"
  docker inspect "$name" --format '{{.Id}}|{{.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{.RestartCount}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}'
done
`;
}

function candidateImageSpecBoundaryScript(spec, { requireLoaded = false } = {}) {
  const loadedAssertions = requireLoaded
    ? String.raw`
[[ "$candidate_source_id" == '${spec.index}' ]] || exit 2
[[ "$candidate_platform_present" == '1' ]] || exit 2
`
    : "";
  return String.raw`
{
  candidate_source_rows="$(printf '%s\n' "$candidate_image_inventory" | awk -F'|' -v tag='${spec.sourceTag}' '$1 == tag { print $2 }')"
  candidate_source_count="$(printf '%s\n' "$candidate_source_rows" | awk 'NF { count += 1 } END { print count + 0 }')"
  [[ "$candidate_source_count" -le 1 ]] || exit 2
  candidate_source_id="$candidate_source_rows"
  [[ -z "$candidate_source_id" || "$candidate_source_id" == '${spec.index}' ]] || exit 2

  candidate_compose_rows="$(printf '%s\n' "$candidate_image_inventory" | awk -F'|' -v tag='${spec.composeTag}' '$1 == tag { print $2 }')"
  candidate_compose_count="$(printf '%s\n' "$candidate_compose_rows" | awk 'NF { count += 1 } END { print count + 0 }')"
  [[ "$candidate_compose_count" -le 1 ]] || exit 2
  candidate_compose_id="$candidate_compose_rows"
  [[ -z "$candidate_compose_id" || "$candidate_compose_id" == '${spec.platform}' ]] || exit 2

  candidate_platform_present="$(printf '%s\n' "$candidate_image_inventory" | awk -F'|' -v id='${spec.platform}' '$2 == id { found = 1 } END { print found + 0 }')"
  ${loadedAssertions}
  if [[ "$candidate_platform_present" == '1' ]]; then
    [[ "$(docker image inspect '${spec.platform}' --format '{{.Id}}')" == '${spec.platform}' ]] || exit 2
    [[ "$(docker image inspect '${spec.platform}' --format '{{.Os}}/{{.Architecture}}/{{.Variant}}')" == 'linux/amd64/' ]] || exit 2
    [[ "$(docker image inspect '${spec.platform}' --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == '${P8V3.applicationCommit}' ]] || exit 2
  fi
}
`;
}

function candidateImageBoundaryScript(options = {}) {
  return String.raw`
candidate_image_inventory="$(docker image ls --no-trunc --format '{{.Repository}}:{{.Tag}}|{{.ID}}')"
${Object.values(P8V3_IMAGES).map((spec) => candidateImageSpecBoundaryScript(spec, options)).join("\n")}
`;
}

export function renderP8V3CandidateImageBoundaryForTest(options = {}) {
  return candidateImageBoundaryScript(options);
}

export function parseP8V3ContainerRowsForTest(text) {
  return parseContainerRows(text);
}

function preflightRootForOwner(owner) {
  if (!IMPORTER_OWNER.test(owner)) fail("P8V3K preflight owner is invalid", "preflight_drift");
  return `${PREFLIGHT_ROOT}-${owner}`;
}

function preflightRemoteScript({ preflightRoot }) {
  const allowlist = REQUIRED_ROLLBACK_FILES.join("\n");
  const hashes = REQUIRED_ROLLBACK_FILES.map((name) => `${name}|${ROLLBACK_SHA256[name]}`).join("\n");
  return String.raw`
[[ ! -e '${RELEASE_ROOT}' && ! -L '${RELEASE_ROOT}' ]]
[[ ! -e '${CONFIG_ROLLBACK_ROOT}' && ! -L '${CONFIG_ROLLBACK_ROOT}' ]]
[[ ! -e '${EVIDENCE_ROOT}' && ! -L '${EVIDENCE_ROOT}' ]]
[[ ! -e '${PREFLIGHT_ROOT}' && ! -L '${PREFLIGHT_ROOT}' ]]
[[ ! -e '${preflightRoot}' && ! -L '${preflightRoot}' ]]
if [[ -e '${PREFLIGHT_PARENT}' || -L '${PREFLIGHT_PARENT}' ]]; then
  [[ -d '${PREFLIGHT_PARENT}' && ! -L '${PREFLIGHT_PARENT}' ]]
  p8v3k_preflight_roots="$(find '${PREFLIGHT_PARENT}' -mindepth 1 -maxdepth 1 -name '${PREFLIGHT_PREFIX}-*' -print)" || exit 2
  [[ -z "$p8v3k_preflight_roots" ]] || exit 2
fi
p8v3k_container_inventory="$(docker container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')" || exit 2
p8v3k_target="$(printf '%s\n' "$p8v3k_container_inventory" | awk -F '|' '$2 == "${IMPORTER}" { print $1 }')"
[[ -z "$p8v3k_target" ]] || exit 2
p8v3k_owner_inventory="$(docker container ls -a --no-trunc --filter 'label=${IMPORTER_OWNER_LABEL}' --format '{{.ID}}|{{.Names}}')" || exit 2
[[ -z "$p8v3k_owner_inventory" ]] || exit 2
[[ "$(docker network inspect '${IMPORTER_NETWORK}' --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{.Internal}}')" == '${IMPORTER_NETWORK}|bridge|local|false' ]] || exit 2
[[ -f '${PRODUCTION_CRM_COMPOSE}' && ! -L '${PRODUCTION_CRM_COMPOSE}' ]] || exit 2
[[ "$(sha256sum '${PRODUCTION_CRM_COMPOSE}' | awk '{print $1}')" == '${PRODUCTION_CRM_COMPOSE_SHA256}' ]] || exit 2
${composeEnvironment("crm")}
docker compose --ansi never --progress quiet --project-name '${composeProject("crm")}' -f '${PRODUCTION_CRM_COMPOSE}' --env-file '${PRODUCTION_CRM_ENV_FILE}' config -q
printf 'importer_network_verified\n'

p8v3j_evidence='${PRESERVED_P8V3J_EVIDENCE_ROOT}'
[[ -d "$p8v3j_evidence" && ! -L "$p8v3j_evidence" && "$(stat -c '%U:%G %a' "$p8v3j_evidence")" == 'root:root 700' ]] || exit 2
[[ "$(find "$p8v3j_evidence" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3j-rollout-result.json' ]] || exit 2
[[ "$(stat -c '%U:%G %a' "$p8v3j_evidence/p8v3j-rollout-result.json")" == 'root:root 600' ]] || exit 2
[[ "$(sha256sum "$p8v3j_evidence/p8v3j-rollout-result.json" | awk '{print $1}')" == '${PRESERVED_P8V3J_RESULT_SHA256}' ]] || exit 2

p8v3e_evidence='${PRESERVED_P8V3E_EVIDENCE_ROOT}'
[[ -d "$p8v3e_evidence" && ! -L "$p8v3e_evidence" && "$(stat -c '%U:%G %a' "$p8v3e_evidence")" == 'root:root 700' ]]
[[ "$(find "$p8v3e_evidence" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3e-rollout-result.json' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3e_evidence/p8v3e-rollout-result.json")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3e_evidence/p8v3e-rollout-result.json" | awk '{print $1}')" == '${PRESERVED_P8V3E_RESULT_SHA256}' ]]

p8v3e_release='${PRESERVED_P8V3E_RELEASE_ROOT}'
[[ -d "$p8v3e_release" && ! -L "$p8v3e_release" && "$(stat -c '%U:%G %a' "$p8v3e_release")" == 'root:root 700' ]]
[[ "$(find "$p8v3e_release" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)" == $'archives\nknowledge-incoming\nrepo' ]]
[[ -d "$p8v3e_release/repo" && ! -L "$p8v3e_release/repo" ]]
[[ -d "$p8v3e_release/knowledge-incoming" && ! -L "$p8v3e_release/knowledge-incoming" && -z "$(find "$p8v3e_release/knowledge-incoming" -mindepth 1 -print -quit)" ]]
[[ -d "$p8v3e_release/archives" && ! -L "$p8v3e_release/archives" ]]
${Object.values(P8V3_IMAGES).map((spec) => `[[ "$(stat -c '%U:%G %a %s' "$p8v3e_release/archives/${spec.file}")" == 'root:root 600 ${spec.size}' ]]\n[[ "$(sha256sum "$p8v3e_release/archives/${spec.file}" | awk '{print $1}')" == '${spec.sha256}' ]]`).join("\n")}

p8v3e_rollback='${PRESERVED_P8V3E_ROLLBACK_ROOT}'
[[ -d "$p8v3e_rollback" && ! -L "$p8v3e_rollback" && "$(stat -c '%U:%G %a' "$p8v3e_rollback")" == 'root:root 700' ]]
[[ "$(find "$p8v3e_rollback" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)" == $'env.production.before\nworker.prestate' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3e_rollback/env.production.before")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3e_rollback/env.production.before" | awk '{print $1}')" == 'af2ba43ae81aad94815301292e34ce54218a3e2d8c4eefe5621987dee5c17640' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3e_rollback/worker.prestate")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3e_rollback/worker.prestate" | awk '{print $1}')" == '7925d3e9a9613a093e5eb4054b32aa39de910d2b03ba7e8046c3b4550b8de1e4' ]]

p8v3f_evidence='${PRESERVED_P8V3F_EVIDENCE_ROOT}'
[[ -d "$p8v3f_evidence" && ! -L "$p8v3f_evidence" && "$(stat -c '%U:%G %a' "$p8v3f_evidence")" == 'root:root 700' ]]
[[ "$(find "$p8v3f_evidence" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3f-rollout-result.json' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3f_evidence/p8v3f-rollout-result.json")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3f_evidence/p8v3f-rollout-result.json" | awk '{print $1}')" == '${PRESERVED_P8V3F_RESULT_SHA256}' ]]
[[ ! -e '${PRESERVED_P8V3F_RELEASE_ROOT}' && ! -L '${PRESERVED_P8V3F_RELEASE_ROOT}' ]]

p8v3f_rollback='${PRESERVED_P8V3F_ROLLBACK_ROOT}'
[[ -d "$p8v3f_rollback" && ! -L "$p8v3f_rollback" && "$(stat -c '%U:%G %a' "$p8v3f_rollback")" == 'root:root 700' ]]
[[ "$(find "$p8v3f_rollback" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)" == $'env.lead-agent.before\nenv.production.before\nworker.prestate' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3f_rollback/env.production.before")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3f_rollback/env.production.before" | awk '{print $1}')" == 'af2ba43ae81aad94815301292e34ce54218a3e2d8c4eefe5621987dee5c17640' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3f_rollback/env.lead-agent.before")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3f_rollback/env.lead-agent.before" | awk '{print $1}')" == 'e684ed84791fe9285f2eec83ce13b670e2eac0f0efd8eaa3f2a2b1adffc14260' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3f_rollback/worker.prestate")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3f_rollback/worker.prestate" | awk '{print $1}')" == '7925d3e9a9613a093e5eb4054b32aa39de910d2b03ba7e8046c3b4550b8de1e4' ]]

p8v3g_evidence='${PRESERVED_P8V3G_EVIDENCE_ROOT}'
[[ -d "$p8v3g_evidence" && ! -L "$p8v3g_evidence" && "$(stat -c '%U:%G %a' "$p8v3g_evidence")" == 'root:root 700' ]]
[[ "$(find "$p8v3g_evidence" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3g-rollout-result.json' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3g_evidence/p8v3g-rollout-result.json")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3g_evidence/p8v3g-rollout-result.json" | awk '{print $1}')" == '${PRESERVED_P8V3G_RESULT_SHA256}' ]]

p8v3g_release='${PRESERVED_P8V3G_RELEASE_ROOT}'
[[ -d "$p8v3g_release" && ! -L "$p8v3g_release" && "$(stat -c '%U:%G %a' "$p8v3g_release")" == 'root:root 700' ]]
[[ "$(find "$p8v3g_release" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)" == $'archives\nknowledge-incoming\np8v3g-platform-knowledge-import.mjs\nrepo' ]]
[[ -d "$p8v3g_release/knowledge-incoming" && ! -L "$p8v3g_release/knowledge-incoming" && -z "$(find "$p8v3g_release/knowledge-incoming" -mindepth 1 -print -quit)" ]]
[[ "$(stat -c '%U:%G %a %s' "$p8v3g_release/p8v3g-platform-knowledge-import.mjs")" == 'root:root 600 ${PRESERVED_P8V3G_IMPORTER_SIZE}' ]]
[[ "$(sha256sum "$p8v3g_release/p8v3g-platform-knowledge-import.mjs" | awk '{print $1}')" == '${PRESERVED_P8V3G_IMPORTER_SHA256}' ]]
${Object.values(P8V3_IMAGES).map((spec) => `[[ "$(stat -c '%U:%G %a %s' "$p8v3g_release/archives/${spec.file}")" == 'root:root 600 ${spec.size}' ]]\n[[ "$(sha256sum "$p8v3g_release/archives/${spec.file}" | awk '{print $1}')" == '${spec.sha256}' ]]`).join("\n")}

p8v3g_rollback='${PRESERVED_P8V3G_ROLLBACK_ROOT}'
[[ -d "$p8v3g_rollback" && ! -L "$p8v3g_rollback" && "$(stat -c '%U:%G %a' "$p8v3g_rollback")" == 'root:root 700' ]]
[[ "$(find "$p8v3g_rollback" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)" == $'env.lead-agent.before\nenv.production.before\nworker.prestate' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3g_rollback/env.production.before")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3g_rollback/env.production.before" | awk '{print $1}')" == 'af2ba43ae81aad94815301292e34ce54218a3e2d8c4eefe5621987dee5c17640' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3g_rollback/env.lead-agent.before")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3g_rollback/env.lead-agent.before" | awk '{print $1}')" == 'e684ed84791fe9285f2eec83ce13b670e2eac0f0efd8eaa3f2a2b1adffc14260' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3g_rollback/worker.prestate")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3g_rollback/worker.prestate" | awk '{print $1}')" == '7925d3e9a9613a093e5eb4054b32aa39de910d2b03ba7e8046c3b4550b8de1e4' ]]

rollback='${P8V2D_ROLLBACK_ROOT}'
[[ -d "$rollback" && ! -L "$rollback" ]]
[[ "$(stat -c '%U:%G %a' "$rollback")" == 'root:root 700' ]]
actual="$(find "$rollback" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)"
expected="$(cat <<'EOF'
${allowlist}
EOF
)"
[[ "$actual" == "$expected" ]]
while IFS= read -r name; do
  [[ -n "$name" ]]
  [[ "$(stat -c '%U:%G %a' "$rollback/$name")" == 'root:root 600' ]]
  [[ -s "$rollback/$name" ]]
done <<< "$expected"
while IFS='|' read -r name hash; do
  [[ -n "$name" && "$hash" =~ ^[0-9a-f]{64}$ ]]
  [[ "$(sha256sum "$rollback/$name" | awk '{print $1}')" == "$hash" ]]
done <<'EOF'
${hashes}
EOF
[[ "$(df -Pk /opt | awk 'NR==2{print $4}')" -ge 2097152 ]]
getent ahosts '${PROJECT_REF}.supabase.co' >/dev/null
getent ahosts 'evoadmissions.amocrm.ru' >/dev/null
${candidateImageBoundaryScript({ requireLoaded: true })}
python3 - <<'PY'
from pathlib import Path
def names(path):
    found=[]
    for raw in Path(path).read_text().splitlines():
        line=raw.strip()
        if not line or line.startswith('#'): continue
        if '=' not in line: raise SystemExit(2)
        found.append(line.split('=',1)[0])
    if len(found)!=len(set(found)): raise SystemExit(2)
    return set(found)
root=names('/opt/evo-crm/.env.production')
lead=names('/opt/evo-crm/.env.lead-agent')
required_root={'NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','EVO_PLATFORM_SUPABASE_SECRET_KEY','EVO_PLATFORM_ORGANIZATION_ID','EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID','EVO_LEAD_AGENT_SYNC_SECRET'}
required_lead={'GEMINI_API_KEY','EVO_AGENT_AMO_BASE_URL','EVO_AGENT_AMO_CLIENT_ID','EVO_AGENT_AMO_CLIENT_SECRET','EVO_AGENT_AMO_REDIRECT_URI','EVO_AGENT_AMO_TOKEN_FILE','EVO_AGENT_CRM_SYNC_SECRET','EVO_AGENT_WAHA_BASE_URL','EVO_AGENT_WAHA_API_KEY','EVO_AGENT_WAHA_SESSION','EVO_AGENT_WAHA_WEBHOOK_SECRET','EVO_AGENT_AUTOREPLY_ENABLED','EVO_AGENT_OUTBOUND_ENABLED'}
if not required_root <= root or not required_lead <= lead: raise SystemExit(2)
print('prerequisites_verified')
PY
${productionInventoryScript()}

p8v3h_evidence='${PRESERVED_P8V3H_EVIDENCE_ROOT}'
[[ -d "$p8v3h_evidence" && ! -L "$p8v3h_evidence" && "$(stat -c '%U:%G %a' "$p8v3h_evidence")" == 'root:root 700' ]]
[[ "$(find "$p8v3h_evidence" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3h-rollout-result.json' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3h_evidence/p8v3h-rollout-result.json")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3h_evidence/p8v3h-rollout-result.json" | awk '{print $1}')" == '${PRESERVED_P8V3H_RESULT_SHA256}' ]]

p8v3i_evidence='${PRESERVED_P8V3I_EVIDENCE_ROOT}'
[[ -d "$p8v3i_evidence" && ! -L "$p8v3i_evidence" && "$(stat -c '%U:%G %a' "$p8v3i_evidence")" == 'root:root 700' ]]
[[ "$(find "$p8v3i_evidence" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3i-rollout-result.json' ]]
[[ "$(stat -c '%U:%G %a' "$p8v3i_evidence/p8v3i-rollout-result.json")" == 'root:root 600' ]]
[[ "$(sha256sum "$p8v3i_evidence/p8v3i-rollout-result.json" | awk '{print $1}')" == '${PRESERVED_P8V3I_RESULT_SHA256}' ]]
`;
}

function validateArchive(path, spec) {
  assertRegular(path);
  const metadata = statSync(path);
  if (metadata.size !== spec.size || sha256(readFileSync(path)) !== spec.sha256) fail(`candidate archive drifted: ${spec.name}`, "preflight_drift");
  const verified = verifyPortableArchive(path, { name: spec.name, index: spec.index, manifest: spec.platform }, spec.sourceTag, P8V3.applicationCommit);
  if (verified.descriptor.digest !== spec.platform) fail(`candidate platform manifest drifted: ${spec.name}`, "preflight_drift");
}

function verifyOrbStack(run) {
  const status = runChecked(run, "OrbStack status", "orb", ["status"], { timeout: 30_000, code: "preflight_drift" }).stdout;
  if (!/^Running\b/m.test(status)) fail("OrbStack is not running", "preflight_drift");
  const context = runChecked(run, "Docker context", "docker", ["context", "show"], { timeout: 30_000, code: "preflight_drift" }).stdout.trim();
  if (context !== "orbstack") fail("Docker context is not orbstack", "preflight_drift");
}

function validateCandidateCompose(run, source) {
  const temp = mkdtempSync(join(tmpdir(), "evo-p8v3f-compose-"));
  try {
    const archive = join(temp, "repo.tar");
    const repo = join(temp, "repo");
    mkdirSync(repo, { mode: 0o700 });
    runChecked(run, "candidate Compose archive", "git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, P8V3.applicationCommit], { timeout: 120_000, code: "preflight_drift" });
    runChecked(run, "candidate Compose extract", "tar", ["-xf", archive, "-C", repo], { timeout: 120_000, code: "preflight_drift" });
    const envPaths = Object.fromEntries(["crm", "lead", "crmWaha", "worker", "inbox", "inboxWaha"].map((name) => {
      const path = join(temp, `${name}.env`);
      writeFileSync(path, "P8V3_COMPOSE_VALIDATION=1\n", { mode: 0o600 });
      chmodSync(path, 0o600);
      return [name, path];
    }));
    writeFileSync(envPaths.inbox, [
      "P8V3_COMPOSE_VALIDATION=1",
      "NEXT_PUBLIC_SUPABASE_URL=https://p8v3f.invalid",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=p8v3f-compose-validation-not-a-key",
      "NEXT_PUBLIC_SITE_URL=https://p8v3f.invalid",
      "",
    ].join("\n"), { mode: 0o600 });
    chmodSync(envPaths.inbox, 0o600);
    const environment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCKER_CONFIG: process.env.DOCKER_CONFIG,
      EVO_RELEASE_REVISION: P8V3.applicationCommit,
      EVO_RELEASE_VERSION: RELEASE_VERSION,
      EVO_WAHA_IMAGE_DIGEST: WAHA_IMAGE,
      EVO_CRM_APP_ENV_FILE: envPaths.crm,
      EVO_CRM_LEAD_AGENT_ENV_FILE: envPaths.lead,
      EVO_CRM_WAHA_ENV_FILE: envPaths.crmWaha,
      EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE: envPaths.worker,
      EVO_INBOX_APP_ENV_FILE: envPaths.inbox,
      EVO_INBOX_WAHA_ENV_FILE: envPaths.inboxWaha,
    };
    const commands = [
      ["compose", "--project-name", "evo-crm", "-f", join(repo, "docker-compose.prod.yml"), "--env-file", envPaths.crm, "config", "-q"],
      ["compose", "--project-name", "evo-inbox", "-f", join(repo, "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml"), "--env-file", envPaths.inbox, "config", "-q"],
    ];
    for (const args of commands) {
      verifyOrbStack(run);
      runChecked(run, "candidate Compose validation", "docker", args, { env: environment, timeout: 120_000, code: "preflight_drift" });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function validateCandidateComposeForTest(run, source) {
  return validateCandidateCompose(run, source);
}

const MIGRATION_077_READINESS_SQL = String.raw`select
  (to_regclass('platform_private.manual_send_provider_bindings') is not null) as table_exists,
  (to_regprocedure('platform.claim_manual_whatsapp_send(uuid,integer,text,uuid)') is not null) as claim_exists,
  (to_regprocedure('platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)') is not null) as sync_exists,
  (to_regprocedure('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)') is not null) as finish_exists,
  coalesce(
    has_function_privilege('service_role', to_regprocedure('platform.claim_manual_whatsapp_send(uuid,integer,text,uuid)'), 'execute')
    and has_function_privilege('service_role', to_regprocedure('platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'), 'execute')
    and has_function_privilege('service_role', to_regprocedure('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)'), 'execute'),
    false
  ) as service_functions_execute,
  coalesce(
    not has_function_privilege('anon', to_regprocedure('platform.claim_manual_whatsapp_send(uuid,integer,text,uuid)'), 'execute')
    and not has_function_privilege('anon', to_regprocedure('platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'), 'execute')
    and not has_function_privilege('anon', to_regprocedure('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)'), 'execute'),
    false
  ) as anon_functions_denied,
  coalesce(
    not has_function_privilege('authenticated', to_regprocedure('platform.claim_manual_whatsapp_send(uuid,integer,text,uuid)'), 'execute')
    and not has_function_privilege('authenticated', to_regprocedure('platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'), 'execute')
    and not has_function_privilege('authenticated', to_regprocedure('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)'), 'execute'),
    false
  ) as authenticated_functions_denied,
  coalesce(not has_table_privilege('service_role', to_regclass('platform_private.manual_send_provider_bindings'), 'select,insert,update,delete,truncate,references,trigger'), false) as service_table_denied,
  coalesce(not has_table_privilege('anon', to_regclass('platform_private.manual_send_provider_bindings'), 'select,insert,update,delete,truncate,references,trigger'), false) as anon_table_denied,
  coalesce(not has_table_privilege('authenticated', to_regclass('platform_private.manual_send_provider_bindings'), 'select,insert,update,delete,truncate,references,trigger'), false) as authenticated_table_denied`;

const MIGRATION_077_READINESS_KEYS = Object.freeze([
  "table_exists",
  "claim_exists",
  "sync_exists",
  "finish_exists",
  "service_functions_execute",
  "anon_functions_denied",
  "authenticated_functions_denied",
  "service_table_denied",
  "anon_table_denied",
  "authenticated_table_denied",
]);

const RETRIEVAL_PROVIDER_SQL = String.raw`select
  count(*)::int as active_config_count,
  count(distinct account_id)::int as active_account_count,
  coalesce(bool_and(embeddings_provider = 'gemini'), false) as provider_is_gemini
from public.ai_configs
where is_active`;

export function validateP8V3DMigrationReadiness(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail("migration 077 readiness row count drifted", "migration_failed");
  exactKeys(rows[0], MIGRATION_077_READINESS_KEYS, "migration 077 readiness");
  if (MIGRATION_077_READINESS_KEYS.some((key) => rows[0][key] !== true)) fail("migration 077 objects or grants drifted", "migration_failed");
  return true;
}

export function validateP8V3RetrievalProvider(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail("retrieval provider row count drifted", "preflight_drift");
  exactKeys(rows[0], ["active_account_count", "active_config_count", "provider_is_gemini"], "retrieval provider");
  if (Number(rows[0].active_config_count) !== 1 || Number(rows[0].active_account_count) !== 1 || rows[0].provider_is_gemini !== true) {
    fail("retrieval provider drifted", "preflight_drift");
  }
  return { retrieval_provider_verified: true };
}

async function readRetrievalProvider(request) {
  const rows = await request(`/v1/projects/${PROJECT_REF}/database/query/read-only`, {
    method: "POST",
    body: { query: RETRIEVAL_PROVIDER_SQL },
    expectedStatus: 201,
  });
  return validateP8V3RetrievalProvider(rows);
}

async function readLedger(request, acceptedLastVersions = ["077"]) {
  const rows = await request(`/v1/projects/${PROJECT_REF}/database/migrations`, { expectedStatus: 200 });
  const versions = normalizeMigrationLedger(rows, acceptedLastVersions);
  return { versions, range: `${versions[0]}-${versions.at(-1)}`, count: versions.length };
}

async function boundedRestJson(response, label) {
  if (!response.ok) fail(`${label} failed`, "knowledge_failed");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 1_048_576) fail(`${label} response is oversized`, "knowledge_failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_048_576) fail(`${label} response is oversized`, "knowledge_failed");
  return parseJson(bytes.toString("utf8"), label);
}

export function createP8V3PublicRestReader({ key, fetchImpl = fetch, projectUrl = PROJECT_URL }) {
  if (typeof key !== "string" || key.length < 1 || typeof fetchImpl !== "function" || typeof projectUrl !== "string" || !projectUrl.startsWith("https://")) {
    fail("P8V3 REST reader configuration drifted", "knowledge_failed");
  }
  return async function readPublicRest(path) {
    if (typeof path !== "string" || !path.startsWith("/rest/v1/")) fail("P8V3 REST path drifted", "knowledge_failed");
    return boundedRestJson(await fetchImpl(`${projectUrl}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "public" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }), path);
  };
}

function validateGeminiKey(key) {
  const bytes = typeof key === "string" ? Buffer.byteLength(key, "utf8") : 0;
  if (bytes < 16 || bytes > 512 || /[\r\n\0]/.test(key)) fail("P8V3F Gemini credential is invalid", "preflight_drift");
  return key;
}

async function boundedGeminiJson(response, key, label) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > 65_536) fail(`${label} response is oversized`, "preflight_drift");
  const chunks = [];
  let length = 0;
  if (!response.body) fail(`${label} response body is missing`, "preflight_drift");
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 65_536) fail(`${label} response is oversized`, "preflight_drift");
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.includes(key)) fail(`${label} leaked the credential`, "preflight_drift");
  if (response.status !== 200) fail(`${label} failed`, "preflight_drift");
  return parseJson(raw, label);
}

export async function verifyP8V3FGemini({ apiKey, fetchImpl = fetch }) {
  const key = validateGeminiKey(apiKey);
  if (typeof fetchImpl !== "function") fail("P8V3F Gemini fetch seam is invalid", "preflight_drift");
  const request = async (path, body, label) => {
    const response = await fetchImpl(`${GEMINI_BASE_URL}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(body),
    });
    return boundedGeminiJson(response, key, label);
  };
  const embedding = await request("models/gemini-embedding-2:batchEmbedContents", {
    requests: [{
      model: "models/gemini-embedding-2",
      content: { parts: [{ text: "title: EVO P8V3F readiness | text: EVO P8V3F readiness probe" }] },
      outputDimensionality: 1536,
    }],
  }, "Gemini embedding readiness");
  const vector = embedding?.embeddings?.[0]?.values;
  if (!Array.isArray(embedding?.embeddings) || embedding.embeddings.length !== 1 || !Array.isArray(vector) || vector.length !== 1536 || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) fail("Gemini embedding readiness drifted", "preflight_drift");

  const draft = await request("models/gemini-3.5-flash:generateContent", {
    store: false,
    contents: [{ role: "user", parts: [{ text: "Return exactly this JSON object and nothing else: {\"reply\":\"READY\",\"handoff\":false}" }] }],
    generationConfig: {
      maxOutputTokens: 128,
      candidateCount: 1,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["reply", "handoff"],
        properties: { reply: { type: "string", enum: ["READY"] }, handoff: { type: "boolean" } },
      },
    },
  }, "Gemini draft readiness");
  const candidates = draft?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1 || candidates[0]?.finishReason !== "STOP" || !Array.isArray(candidates[0]?.content?.parts) || candidates[0].content.parts.length !== 1) fail("Gemini draft readiness drifted", "preflight_drift");
  const text = candidates[0].content.parts[0]?.text;
  const parsed = typeof text === "string" ? parseJson(text, "Gemini draft payload") : null;
  if (!parsed || Object.keys(parsed).sort().join("\0") !== "handoff\0reply" || parsed.reply !== "READY" || parsed.handoff !== false) fail("Gemini draft readiness drifted", "preflight_drift");
  return { embedding_verified: true, draft_verified: true };
}

function buildImporterArtifact(run, sourceRoot) {
  const root = mkdtempSync(join(tmpdir(), "evo-p8v3f-importer-"));
  chmodSync(root, 0o700);
  const path = join(root, IMPORTER_FILE);
  try {
    runChecked(run, "P8V3F importer build", join(sourceRoot, "node_modules/.bin/esbuild"), [
      join(sourceRoot, "scripts/import-platform-knowledge-bundle.ts"),
      "--bundle", "--platform=node", "--format=esm", "--target=node22", "--conditions=react-server", `--outfile=${path}`,
    ], { cwd: sourceRoot, timeout: 120_000, code: "preflight_drift" });
    chmodSync(path, 0o600);
    assertDirectory(root);
    assertRegular(path);
    const size = statSync(path).size;
    if (!Number.isSafeInteger(size) || size < IMPORTER_MIN_BYTES || size > IMPORTER_MAX_BYTES) fail("P8V3F importer size drifted", "preflight_drift");
    return { root, path, sha256: sha256(readFileSync(path)), size };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function buildVerifiedImporterArtifact(run, sourceRoot) {
  let first;
  let second;
  let verified = false;
  try {
    first = buildImporterArtifact(run, sourceRoot);
    second = buildImporterArtifact(run, sourceRoot);
    if (first.sha256 !== second.sha256 || first.size !== second.size || !readFileSync(first.path).equals(readFileSync(second.path))) fail("P8V3F importer build is not deterministic", "preflight_drift");
    verified = true;
    return first;
  } finally {
    if (second) rmSync(second.root, { recursive: true, force: true });
    if (first && !verified) rmSync(first.root, { recursive: true, force: true });
  }
}

export function verifyP8V3FImporterBuild({ run = defaultRun, sourceRoot }) {
  const importer = buildVerifiedImporterArtifact(run, sourceRoot);
  try {
    return { sha256: importer.sha256, size: importer.size, verified: true };
  } finally {
    rmSync(importer.root, { recursive: true, force: true });
  }
}

export function configurationInstallScript() {
  return String.raw`
set -u
IFS= read -r P8V3F_GEMINI_API_KEY
if IFS= read -r P8V3F_EXTRA_INPUT; then exit 2; fi
export P8V3F_GEMINI_API_KEY
python3 - <<'PY'
import hashlib,json,os,secrets,stat,tempfile
from pathlib import Path
os.umask(0o077)
root=Path('/opt/evo-crm/.env.production')
lead=Path('/opt/evo-crm/.env.lead-agent')
worker=Path('/opt/evo-crm/.env.manual-send-worker')
backup=Path('${CONFIG_ROLLBACK_ROOT}')
def regular(path,mode=0o600):
    st=path.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or stat.S_IMODE(st.st_mode)!=mode or st.st_uid!=0 or st.st_gid!=0: raise SystemExit(2)
def parse(path):
    regular(path)
    out={}
    for raw in path.read_text().splitlines():
        line=raw.strip()
        if not line or line.startswith('#'): continue
        if '=' not in line: raise SystemExit(2)
        key,value=line.split('=',1)
        if not key or key in out: raise SystemExit(2)
        out[key]=value
    return out
def write_atomic(path,values):
    fd,tmp=tempfile.mkstemp(prefix=path.name+'.p8v3f-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as handle:
            for key in sorted(values): handle.write(f'{key}={values[key]}\n')
            handle.flush(); os.fsync(handle.fileno())
        os.chmod(tmp,0o600); os.chown(tmp,0,0); os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    regular(path)
if backup.exists() or backup.is_symlink(): raise SystemExit(2)
backup.mkdir(mode=0o700)
os.chown(backup,0,0)
root_values=parse(root); lead_values=parse(lead)
gemini=os.environ.pop('P8V3F_GEMINI_API_KEY','')
root_sync=root_values.get('EVO_LEAD_AGENT_SYNC_SECRET','')
lead_sync=lead_values.get('EVO_AGENT_CRM_SYNC_SECRET','')
if not 16<=len(gemini.encode())<=512 or any(c in gemini for c in '\r\n\x00') or len(root_sync)<32 or root_sync!=lead_sync: raise SystemExit(2)
root_before=root.read_bytes(); lead_before=lead.read_bytes()
for name,data in [('env.production.before',root_before),('env.lead-agent.before',lead_before)]:
    path=backup/name; path.write_bytes(data); os.chmod(path,0o600); os.chown(path,0,0)
(backup/'worker.prestate').write_text('present\n' if worker.exists() else 'absent\n')
os.chmod(backup/'worker.prestate',0o600); os.chown(backup/'worker.prestate',0,0)
if worker.exists():
    regular(worker)
    (backup/'env.manual-send-worker.before').write_bytes(worker.read_bytes())
    os.chmod(backup/'env.manual-send-worker.before',0o600); os.chown(backup/'env.manual-send-worker.before',0,0)
trigger=secrets.token_hex(32)
root_values.update({
 'EVO_PLATFORM_GEMINI_API_KEY':gemini,
 'EVO_PLATFORM_STAFF_ASSISTANT_ENABLED':'1',
 'EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED':'1',
 'EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET':trigger,
 'EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED':'1',
})
lead_values['GEMINI_API_KEY']=gemini
write_atomic(root,root_values)
write_atomic(lead,lead_values)
write_atomic(worker,{'EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET':trigger})
check=parse(root); lead_check=parse(lead); worker_check=parse(worker)
names=['EVO_PLATFORM_GEMINI_API_KEY','EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED','EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET','EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED','EVO_PLATFORM_STAFF_ASSISTANT_ENABLED']
if any(k not in check for k in names) or check['EVO_PLATFORM_GEMINI_API_KEY']!=gemini or lead_check.get('GEMINI_API_KEY')!=gemini or worker_check!={'EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET':trigger}: raise SystemExit(2)
backup_sha=hashlib.sha256(root_before+b'\x00'+lead_before).hexdigest()
print(json.dumps({'status':'verified','installed_names':sorted(names),'backup_sha256':backup_sha,'lead_file_verified':True,'worker_file_verified':True},separators=(',',':')))
PY
`;
}

export function configurationRestoreScript({
  crmRoot = "/opt/evo-crm",
  rollbackRoot = CONFIG_ROLLBACK_ROOT,
  expectedUid = 0,
  expectedGid = 0,
} = {}) {
  if (![crmRoot, rollbackRoot].every((value) => typeof value === "string" && value.startsWith("/") && !/[\r\n\0]/.test(value)) || ![expectedUid, expectedGid].every((value) => Number.isInteger(value) && value >= 0)) fail("configuration restore seam drifted", "rollback_failed");
  return String.raw`
python3 - <<'PY'
import hashlib,os,stat,tempfile
from pathlib import Path
crm=Path(${JSON.stringify(crmRoot)}); root=crm/'.env.production'; lead=crm/'.env.lead-agent'; worker=crm/'.env.manual-send-worker'; backup=Path(${JSON.stringify(rollbackRoot)})
EXPECTED_UID=${expectedUid}; EXPECTED_GID=${expectedGid}
def directory(path):
    st=path.lstat()
    if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode) or stat.S_IMODE(st.st_mode)!=0o700 or st.st_uid!=EXPECTED_UID or st.st_gid!=EXPECTED_GID or path.resolve()!=path: raise SystemExit(2)
def regular(path,parent=None):
    st=path.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or stat.S_IMODE(st.st_mode)!=0o600 or st.st_uid!=EXPECTED_UID or st.st_gid!=EXPECTED_GID: raise SystemExit(2)
    if parent is not None and path.resolve().parent!=parent.resolve(): raise SystemExit(2)
def install(source,target):
    regular(source)
    fd,tmp=tempfile.mkstemp(prefix=target.name+'.restore-',dir=target.parent)
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(source.read_bytes()); handle.flush(); os.fsync(handle.fileno())
        os.chmod(tmp,0o600); os.chown(tmp,EXPECTED_UID,EXPECTED_GID); os.replace(tmp,target)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    regular(target)
directory(backup)
marker=backup/'worker.prestate'; regular(marker,backup)
state=marker.read_text()
if state not in ('present\n','absent\n'): raise SystemExit(2)
state=state.strip()
expected={'env.production.before','env.lead-agent.before','worker.prestate'} | ({'env.manual-send-worker.before'} if state=='present' else set())
entries=list(backup.iterdir())
if {entry.name for entry in entries}!=expected: raise SystemExit(2)
for entry in entries: regular(entry,backup)
root_source=backup/'env.production.before'; lead_source=backup/'env.lead-agent.before'
install(root_source,root); install(lead_source,lead)
if state=='present': install(backup/'env.manual-send-worker.before',worker)
elif state=='absent':
    if worker.exists() or worker.is_symlink(): worker.unlink()
else: raise SystemExit(2)
if root.read_bytes()!=root_source.read_bytes() or lead.read_bytes()!=lead_source.read_bytes(): raise SystemExit(2)
print('configuration_restored')
PY
`;
}

function stagePrepareScript() {
  return String.raw`
umask 077
[[ ! -e '${RELEASE_ROOT}' ]]
install -d -o root -g root -m 0700 '${RELEASE_ROOT}' '${REMOTE_REPO}' '${REMOTE_ARCHIVES}' '${KNOWLEDGE_REMOTE}'
`;
}

function preflightPrepareScript({ preflightRoot, owner }) {
  if (!IMPORTER_OWNER.test(owner)) fail("P8V3K preflight prepare owner is invalid", "preflight_drift");
  return String.raw`
umask 077
[[ ! -e '${preflightRoot}' && ! -L '${preflightRoot}' ]]
install -d -o root -g root -m 0700 '${preflightRoot}'
printf '%s\n' '${owner}' > '${preflightRoot}/${PREFLIGHT_OWNER_FILE}'
chown root:root '${preflightRoot}/${PREFLIGHT_OWNER_FILE}'
chmod 0600 '${preflightRoot}/${PREFLIGHT_OWNER_FILE}'
[[ "$(stat -c '%U:%G %a' '${preflightRoot}/${PREFLIGHT_OWNER_FILE}')" == 'root:root 600' ]]
[[ "$(cat '${preflightRoot}/${PREFLIGHT_OWNER_FILE}')" == '${owner}' ]]
`;
}

function preflightFinalizeScript(importer, { preflightRoot, owner }) {
  if (!IMPORTER_OWNER.test(owner)) fail("P8V3K preflight finalize owner is invalid", "preflight_drift");
  return String.raw`
[[ -d '${preflightRoot}' && ! -L '${preflightRoot}' ]]
[[ "$(stat -c '%U:%G %a' '${preflightRoot}')" == 'root:root 700' ]]
[[ -f '${preflightRoot}/${PREFLIGHT_OWNER_FILE}' && ! -L '${preflightRoot}/${PREFLIGHT_OWNER_FILE}' ]]
[[ "$(stat -c '%U:%G %a' '${preflightRoot}/${PREFLIGHT_OWNER_FILE}')" == 'root:root 600' ]]
[[ "$(cat '${preflightRoot}/${PREFLIGHT_OWNER_FILE}')" == '${owner}' ]]
[[ -f '${preflightRoot}/${IMPORTER_FILE}' && ! -L '${preflightRoot}/${IMPORTER_FILE}' ]]
[[ "$(stat -c '%U:%G %a %s' '${preflightRoot}/${IMPORTER_FILE}')" == 'root:root 600 ${importer.size}' ]]
[[ "$(sha256sum '${preflightRoot}/${IMPORTER_FILE}' | awk '{print $1}')" == '${importer.sha256}' ]]
chown root:1001 '${preflightRoot}/${IMPORTER_FILE}'
chmod 0640 '${preflightRoot}/${IMPORTER_FILE}'
[[ "$(stat -c '%U:%G %a %s' '${preflightRoot}/${IMPORTER_FILE}')" == 'root:1001 640 ${importer.size}' ]]
`;
}

function preflightCleanupScript({ preflightRoot = PREFLIGHT_ROOT, importerSha256 = null, importerSize = null, owner = null, expectedUid = 0, expectedGid = 0 } = {}) {
  if (!IMPORTER_OWNER.test(owner ?? "")) fail("P8V3K preflight cleanup owner is invalid", "preflight_drift");
  if (![expectedUid, expectedGid].every((value) => Number.isInteger(value) && value >= 0)) fail("P8V3K preflight cleanup identity is invalid", "preflight_drift");
  if ((importerSha256 === null) !== (importerSize === null) || (importerSha256 !== null && (!SHA64.test(importerSha256) || !Number.isSafeInteger(importerSize) || importerSize < 1))) {
    fail("P8V3K preflight cleanup importer identity is invalid", "preflight_drift");
  }
  const expectedOwner = owner ?? "";
  return String.raw`
set +e
errors=0
${knowledgeContainerCleanupBody(expectedOwner)}
[[ "$errors" == '0' ]] || exit 2
python3 - <<'PY' || errors=1
import hashlib, stat
from pathlib import Path
root = Path('${preflightRoot}')
importer = root/'${IMPORTER_FILE}'
marker = root/'${PREFLIGHT_OWNER_FILE}'
if root.is_symlink(): raise SystemExit(2)
if not root.exists(): raise SystemExit(0)
root_metadata = root.lstat()
if not root.is_dir() or root_metadata.st_uid != ${expectedUid} or root_metadata.st_gid != ${expectedGid} or stat.S_IMODE(root_metadata.st_mode) != 0o700: raise SystemExit(2)
entries = list(root.iterdir())
if {entry.name for entry in entries} - {'${IMPORTER_FILE}', '${PREFLIGHT_OWNER_FILE}'}: raise SystemExit(2)
if marker.is_symlink(): raise SystemExit(2)
if marker.exists():
    marker_metadata = marker.lstat()
    if not stat.S_ISREG(marker_metadata.st_mode) or marker_metadata.st_uid != ${expectedUid} or marker_metadata.st_gid != ${expectedGid} or stat.S_IMODE(marker_metadata.st_mode) != 0o600: raise SystemExit(2)
    if marker.read_bytes() != b'${owner ?? ""}\n': raise SystemExit(2)
elif entries:
    raise SystemExit(2)
if importer.is_symlink(): raise SystemExit(2)
if importer.exists():
    metadata = importer.lstat()
    importer_state = (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode))
    if not stat.S_ISREG(metadata.st_mode) or importer_state not in {(0, 0, 0o600), (0, 1001, 0o640)}: raise SystemExit(2)
    if '${importerSha256 ?? ""}' == '' or metadata.st_size != ${importerSize ?? 0} or hashlib.sha256(importer.read_bytes()).hexdigest() != '${importerSha256 ?? ""}': raise SystemExit(2)
    importer.unlink()
if marker.exists(): marker.unlink()
if importer.exists() or importer.is_symlink() or marker.exists() or marker.is_symlink() or any(root.iterdir()): raise SystemExit(2)
root.rmdir()
if root.exists() or root.is_symlink(): raise SystemExit(2)
PY
${knowledgeContainerAbsenceBody()}
exit "$errors"
`;
}

function stageFinalizeScript(importer) {
  return String.raw`
umask 077
[[ "$(stat -c '%U:%G %a' '${RELEASE_ROOT}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${REMOTE_REPO}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${REMOTE_ARCHIVES}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${KNOWLEDGE_REMOTE}')" == 'root:root 700' ]]
[[ -f '${RELEASE_ROOT}/repo.tar' && ! -L '${RELEASE_ROOT}/repo.tar' ]]
[[ -f '${RELEASE_ROOT}/${IMPORTER_FILE}' && ! -L '${RELEASE_ROOT}/${IMPORTER_FILE}' ]]
tar -xf '${RELEASE_ROOT}/repo.tar' -C '${REMOTE_REPO}'
rm -f '${RELEASE_ROOT}/repo.tar'
[[ "$(stat -c '%U:%G %a %s' '${RELEASE_ROOT}/${IMPORTER_FILE}')" == 'root:root 600 ${importer.size}' ]]
[[ "$(sha256sum '${RELEASE_ROOT}/${IMPORTER_FILE}' | awk '{print $1}')" == '${importer.sha256}' ]]
chown root:1001 '${RELEASE_ROOT}/${IMPORTER_FILE}'
chmod 0640 '${RELEASE_ROOT}/${IMPORTER_FILE}'
[[ "$(stat -c '%U:%G %a %s' '${RELEASE_ROOT}/${IMPORTER_FILE}')" == 'root:1001 640 ${importer.size}' ]]
for name in ${Object.values(P8V3_IMAGES).map((item) => `'${item.file}'`).join(" ")}; do
  [[ -f '${REMOTE_ARCHIVES}/'"$name" && ! -L '${REMOTE_ARCHIVES}/'"$name" ]]
  chown root:root '${REMOTE_ARCHIVES}/'"$name"; chmod 0600 '${REMOTE_ARCHIVES}/'"$name"
done
`;
}

function loadImagesScript() {
  const rows = Object.values(P8V3_IMAGES).map((spec) => String.raw`
[[ "$(sha256sum '${REMOTE_ARCHIVES}/${spec.file}' | awk '{print $1}')" == '${spec.sha256}' ]]
docker load -i '${REMOTE_ARCHIVES}/${spec.file}' >/dev/null
candidate_image_inventory="$(docker image ls --no-trunc --format '{{.Repository}}:{{.Tag}}|{{.ID}}')"
${candidateImageSpecBoundaryScript(spec, { requireLoaded: true })}
docker image tag '${spec.platform}' '${spec.composeTag}'
[[ "$(docker image inspect '${spec.composeTag}' --format '{{.Id}}')" == '${spec.platform}' ]]
`).join("\n");
  return `${candidateImageBoundaryScript()}\n${rows}\n`;
}

function runChecked(run, label, command, args, options = {}) {
  return run(command, args, { ...options, label, code: options.code ?? "verification_failed" });
}

function stableReport(report) {
  const copy = { ...report };
  delete copy.generated_at;
  delete copy.output_directory;
  return copy;
}

function buildAudience(run, sourceRoot, accountId, audience, vault, localRoots) {
  const expectedCount = audience === "client" ? 11 : 291;
  const expectedSourceSet = audience === "client"
    ? "c8dcfdd7911fdf2b97204c5d843dbf45f701d5dbee72e78cfaea17ea7ab18689"
    : "1bd7458ff70c0a31fde9f6bb1abfb7ec0152c1f286caf2a1de48081860121f9f";
  const audit = parseJson(runChecked(run, `${audience} vault audit`, "python3", [join(sourceRoot, "scripts/p8v2e-vault-audit.py"), "--vault", vault, "--audience", audience], { cwd: sourceRoot, timeout: 120_000, code: "knowledge_failed" }).stdout.trim(), `${audience} vault audit`);
  if (audit.status !== "verified" || audit.document_count !== expectedCount || audit.source_set_sha256 !== expectedSourceSet) fail(`${audience} frozen vault drifted`, "knowledge_failed");
  const roots = [0, 1].map(() => {
    const root = mkdtempSync(join(tmpdir(), `evo-p8v3f-${audience}-`));
    chmodSync(root, 0o700);
    localRoots.push(root);
    return root;
  });
  const python = [
    "-c",
    "import sys; from pathlib import Path; account=sys.stdin.readline().strip(); sys.path.insert(0,sys.argv[1]); from build_platform_bundle import build_bundle; build_bundle(Path(sys.argv[2]),account,sys.argv[3],Path(sys.argv[4]))",
    join(sourceRoot, "scripts/knowledge_ingestion"), vault, audience,
  ];
  for (const root of roots) runChecked(run, `${audience} deterministic build`, "python3", [...python, root], { cwd: sourceRoot, input: `${accountId}\n`, timeout: 180_000, code: "knowledge_failed" });
  const bundleName = `evo-knowledge-${audience}.json`;
  const manifestName = `evo-knowledge-${audience}.sha256.json`;
  const bundle = readFileSync(join(roots[0], bundleName));
  const manifest = readFileSync(join(roots[0], manifestName));
  if (!bundle.equals(readFileSync(join(roots[1], bundleName))) || !manifest.equals(readFileSync(join(roots[1], manifestName)))) fail(`${audience} deterministic bytes drifted`, "knowledge_failed");
  const parsedBundle = parseJson(bundle.toString("utf8"), `${audience} bundle`);
  const parsedManifest = parseJson(manifest.toString("utf8"), `${audience} manifest`);
  if (parsedBundle.account_id !== accountId || parsedBundle.audience !== audience || parsedBundle.documents?.length !== expectedCount || parsedManifest.account_id !== accountId || parsedManifest.audience !== audience || parsedManifest.bundle_sha256 !== sha256(bundle)) fail(`${audience} bundle identity drifted`, "knowledge_failed");
  const reports = roots.map((root) => parseJson(readFileSync(join(root, `evo-knowledge-${audience}.report.json`), "utf8"), `${audience} report`));
  if (JSON.stringify(stableReport(reports[0])) !== JSON.stringify(stableReport(reports[1]))) fail(`${audience} stable build report drifted`, "knowledge_failed");
  return { audience, root: roots[0], bundleName, manifestName, documentCount: expectedCount, bundleSha256: sha256(bundle), manifestSha256: sha256(manifest) };
}

function knowledgePrepareScript(item) {
  return String.raw`
[[ "$(sha256sum '${KNOWLEDGE_REMOTE}/${item.bundleName}' | awk '{print $1}')" == '${item.bundleSha256}' ]]
[[ "$(sha256sum '${KNOWLEDGE_REMOTE}/${item.manifestName}' | awk '{print $1}')" == '${item.manifestSha256}' ]]
chown root:1001 '${KNOWLEDGE_REMOTE}/${item.bundleName}' '${KNOWLEDGE_REMOTE}/${item.manifestName}'
chmod 0640 '${KNOWLEDGE_REMOTE}/${item.bundleName}' '${KNOWLEDGE_REMOTE}/${item.manifestName}'
[[ "$(stat -c '%U:%G %a' '${KNOWLEDGE_REMOTE}/${item.bundleName}')" == 'root:1001 640' ]]
[[ "$(stat -c '%U:%G %a' '${KNOWLEDGE_REMOTE}/${item.manifestName}')" == 'root:1001 640' ]]
`;
}

function composeRunPrefixScript({ owner, envNames = [], mounts = [] }) {
  if (!IMPORTER_OWNER.test(owner)) fail("P8V3K Compose owner is invalid", "preflight_drift");
  const envFlags = envNames.map((name) => `-e '${name}'`).join(" ");
  const mountFlags = mounts.map(({ source, target }) => `-v '${source}:${target}:ro'`).join(" ");
  return String.raw`
set -u
${composeEnvironment("crm")}
[[ -f '${PRODUCTION_CRM_COMPOSE}' && ! -L '${PRODUCTION_CRM_COMPOSE}' ]] || exit 2
[[ "$(sha256sum '${PRODUCTION_CRM_COMPOSE}' | awk '{print $1}')" == '${PRODUCTION_CRM_COMPOSE_SHA256}' ]] || exit 2
docker compose --ansi never --progress quiet --project-name '${composeProject("crm")}' -f '${PRODUCTION_CRM_COMPOSE}' --env-file '${PRODUCTION_CRM_ENV_FILE}' config -q
inventory="$(docker container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')" || exit 2
target="$(printf '%s\n' "$inventory" | awk -F '|' '$2 == "${IMPORTER}" { print $1 }')"
[[ -z "$target" ]] || exit 2
owned="$(docker container ls -a --no-trunc --filter 'label=${IMPORTER_OWNER_LABEL}' --format '{{.ID}}|{{.Names}}')" || exit 2
[[ -z "$owned" ]] || exit 2
docker compose --ansi never --progress quiet --project-name '${composeProject("crm")}' -f '${PRODUCTION_CRM_COMPOSE}' --env-file '${PRODUCTION_CRM_ENV_FILE}' run --rm --no-deps --pull never -T --name '${IMPORTER}' --label '${IMPORTER_OWNER_LABEL}=${owner}' ${envFlags} ${mountFlags} --entrypoint /bin/sh app
`.trimEnd();
}

function providerProbeCommand(owner, importer, preflightRoot) {
  const importerRemote = `${preflightRoot}/${IMPORTER_FILE}`;
  return String.raw`
set -u
IFS= read -r EVO_PLATFORM_GEMINI_API_KEY
if IFS= read -r P8V3K_EXTRA_INPUT; then exit 2; fi
export EVO_PLATFORM_GEMINI_API_KEY
[[ "$(stat -c '%U:%G %a %s' '${importerRemote}')" == 'root:1001 640 ${importer.size}' ]]
[[ "$(sha256sum '${importerRemote}' | awk '{print $1}')" == '${importer.sha256}' ]]
${composeRunPrefixScript({
  owner,
  envNames: ["EVO_PLATFORM_GEMINI_API_KEY"],
  mounts: [{ source: importerRemote, target: IMPORTER_MOUNT }],
})} -c ${shellQuote(String.raw`
set -eu
[[ "$(id -u):$(id -g)" == '1001:1001' ]]
[[ "$(awk '$1=="nameserver"{print $2; exit}' /etc/resolv.conf)" == '127.0.0.11' ]]
node '${IMPORTER_MOUNT}' --verify-provider
`)}
`;
}

function importCommand(item, owner) {
  const importerRemote = `${RELEASE_ROOT}/${IMPORTER_FILE}`;
  return String.raw`
${composeRunPrefixScript({
  owner,
  envNames: ["EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID", "EVO_PLATFORM_GEMINI_API_KEY"],
  mounts: [
    { source: importerRemote, target: IMPORTER_MOUNT },
    { source: `${KNOWLEDGE_REMOTE}/${item.bundleName}`, target: BUNDLE_MOUNT },
    { source: `${KNOWLEDGE_REMOTE}/${item.manifestName}`, target: MANIFEST_MOUNT },
  ],
})} -c ${shellQuote(String.raw`
set -eu
[[ "$(id -u):$(id -g)" == '1001:1001' ]]
[[ "$(awk '$1=="nameserver"{print $2; exit}' /etc/resolv.conf)" == '127.0.0.11' ]]
[[ "$EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID" == "$EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID" ]]
node '${IMPORTER_MOUNT}' --audience '${item.audience}' --bundle '${BUNDLE_MOUNT}' --manifest '${MANIFEST_MOUNT}'
`)}
`;
}

function knowledgeImportCommand(item, owner) {
  return String.raw`
set -u
IFS= read -r EVO_PLATFORM_GEMINI_API_KEY
IFS= read -r EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID
if IFS= read -r P8V3K_EXTRA_INPUT; then exit 2; fi
export EVO_PLATFORM_GEMINI_API_KEY
[[ "$EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
export EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID
${importCommand(item, owner)}
`;
}

function knowledgeContainerCleanupBody(expectedOwner) {
  return String.raw`
inventory="$(docker container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')" || { inventory=''; errors=1; }
owned="$(docker container ls -a --no-trunc --filter 'label=${IMPORTER_OWNER_LABEL}' --format '{{.ID}}|{{.Names}}')" || { owned=''; errors=1; }
target="$(printf '%s\n' "$inventory" | awk -F '|' '$2 == "${IMPORTER}" { print $0 }')"
if [[ -n "$owned" ]]; then
  [[ "$(printf '%s\n' "$owned" | sed '/^$/d' | wc -l | tr -d ' ')" == '1' ]] || errors=1
  owned_id="$(printf '%s\n' "$owned" | cut -d '|' -f 1)"
  owned_name="$(printf '%s\n' "$owned" | cut -d '|' -f 2)"
  identity="$(docker inspect "$owned_id" --format '{{.Image}}|{{index .Config.Labels "${IMPORTER_OWNER_LABEL}"}}|{{.Name}}' 2>/dev/null)" || { identity=''; errors=1; }
  if [[ -n '${expectedOwner}' \
    && "$owned_id" =~ ^[0-9a-f]{64}$ \
    && "$owned_name" == '${IMPORTER}' \
    && ( -z "$target" || "$target" == "$owned_id|${IMPORTER}" ) \
    && "$identity" == '${P8V3_IMAGES.crm.platform}|${expectedOwner}|/${IMPORTER}' ]]; then
    docker rm -f "$owned_id" >/dev/null 2>&1 || errors=1
  else
    errors=1
  fi
elif [[ -n "$target" ]]; then
  errors=1
fi
`;
}

function knowledgeContainerAbsenceBody() {
  return String.raw`
final_inventory="$(docker container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')" || { final_inventory=''; errors=1; }
final_owned="$(docker container ls -a --no-trunc --filter 'label=${IMPORTER_OWNER_LABEL}' --format '{{.ID}}|{{.Names}}')" || { final_owned=''; errors=1; }
final_target="$(printf '%s\n' "$final_inventory" | awk -F '|' '$2 == "${IMPORTER}" { print $0 }')"
[[ -z "$final_target" && -z "$final_owned" ]] || errors=1
`;
}

function knowledgeJobCleanupScript({ owner = null } = {}) {
  if (owner !== null && !IMPORTER_OWNER.test(owner)) fail("P8V3K knowledge cleanup owner is invalid", "knowledge_failed");
  const expectedOwner = owner ?? "";
  return String.raw`
set +e
errors=0
${knowledgeContainerCleanupBody(expectedOwner)}
${knowledgeContainerAbsenceBody()}
exit "$errors"
`;
}

function knowledgeCleanupScript({
  releaseRoot = RELEASE_ROOT,
  knowledgeRemote = KNOWLEDGE_REMOTE,
  owner = null,
  importerSha256 = null,
  importerSize = null,
  expectedFiles = [],
} = {}) {
  if (owner !== null && !IMPORTER_OWNER.test(owner)) fail("P8V3K knowledge cleanup owner is invalid", "knowledge_failed");
  if ((importerSha256 === null) !== (importerSize === null) || (importerSha256 !== null && (!SHA64.test(importerSha256) || !Number.isSafeInteger(importerSize) || importerSize < 1))) {
    fail("P8V3K importer cleanup identity is invalid", "knowledge_failed");
  }
  const allowedNames = new Set([
    "evo-knowledge-client.json",
    "evo-knowledge-client.sha256.json",
    "evo-knowledge-internal.json",
    "evo-knowledge-internal.sha256.json",
  ]);
  const expected = {};
  for (const item of expectedFiles) {
    if (!allowedNames.has(item?.name) || !SHA64.test(item?.sha256) || Object.hasOwn(expected, item.name)) fail("P8V3K knowledge cleanup file identity is invalid", "knowledge_failed");
    expected[item.name] = item.sha256;
  }
  const expectedOwner = owner ?? "";
  const expectedFilesPython = JSON.stringify(expected);
  return String.raw`
set +e
errors=0
${knowledgeContainerCleanupBody(expectedOwner)}
[[ "$errors" == '0' ]] || exit "$errors"
python3 - <<'PY' || errors=1
import hashlib, json, stat
from pathlib import Path
release = Path('${releaseRoot}')
knowledge = Path('${knowledgeRemote}')
importer = release/'${IMPORTER_FILE}'
expected = json.loads('${expectedFilesPython}')
if release.is_symlink(): raise SystemExit(2)
if not release.exists(): raise SystemExit(0)
release_metadata = release.lstat()
if not release.is_dir() or release_metadata.st_uid != 0 or release_metadata.st_gid != 0 or stat.S_IMODE(release_metadata.st_mode) != 0o700: raise SystemExit(2)
if importer.is_symlink(): raise SystemExit(2)
importer_present = importer.exists()
if importer_present:
    metadata = importer.lstat()
    importer_state = (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode))
    if not stat.S_ISREG(metadata.st_mode) or importer_state not in {(0, 0, 0o600), (0, 1001, 0o640)}:
        raise SystemExit(2)
    if '${importerSha256 ?? ""}' == '' or metadata.st_size != ${importerSize ?? 0} or hashlib.sha256(importer.read_bytes()).hexdigest() != '${importerSha256 ?? ""}': raise SystemExit(2)
if knowledge.is_symlink(): raise SystemExit(2)
entries = []
if knowledge.exists():
    knowledge_metadata = knowledge.lstat()
    if not knowledge.is_dir() or knowledge.resolve().parent != release.resolve() or knowledge_metadata.st_uid != 0 or knowledge_metadata.st_gid != 0 or stat.S_IMODE(knowledge_metadata.st_mode) != 0o700: raise SystemExit(2)
    entries = list(knowledge.iterdir())
for entry in entries:
    metadata = entry.lstat()
    entry_state = (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode))
    if entry.name not in expected or not stat.S_ISREG(metadata.st_mode) or entry.is_symlink() or entry_state not in {(0, 0, 0o600), (0, 1001, 0o640)}: raise SystemExit(2)
    if hashlib.sha256(entry.read_bytes()).hexdigest() != expected[entry.name]: raise SystemExit(2)
if importer_present: importer.unlink()
if importer.exists() or importer.is_symlink(): raise SystemExit(2)
for entry in entries: entry.unlink()
if knowledge.exists() and any(knowledge.iterdir()): raise SystemExit(2)
PY
${knowledgeContainerAbsenceBody()}
exit "$errors"
`;
}

function composeEnvironment(name) {
  const base = String.raw`export EVO_RELEASE_REVISION='${P8V3.applicationCommit}'
export EVO_RELEASE_VERSION='${RELEASE_VERSION}'
export EVO_WAHA_IMAGE_DIGEST='${WAHA_IMAGE}'`;
  if (name === "inbox") return `${base}
export EVO_INBOX_APP_ENV_FILE='/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production'
export EVO_INBOX_WAHA_ENV_FILE='/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha'
export NEXT_PUBLIC_SITE_URL='https://inbox.evoadmissions.com'
export EVO_INBOX_DOMAIN='inbox.evoadmissions.com'
export EVO_CADDY_NETWORK='evo_public_web'`;
  return `${base}
export EVO_CRM_APP_ENV_FILE='/opt/evo-crm/.env.production'
export EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE='/opt/evo-crm/.env.manual-send-worker'
export EVO_CRM_LEAD_AGENT_ENV_FILE='/opt/evo-crm/.env.lead-agent'
export EVO_CRM_WAHA_ENV_FILE='/opt/evo-crm/.env.waha'`;
}

function composeFile(name) {
  return name === "inbox"
    ? `${REMOTE_REPO}/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml`
    : `${REMOTE_REPO}/docker-compose.prod.yml`;
}

function composeProject(name) {
  return name === "inbox" ? "evo-inbox" : "evo-crm";
}

function healthWaitScript(container, port, path, expectedStatus = 200) {
  return String.raw`
for attempt in $(seq 1 30); do
  state="$(docker inspect '${container}' --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}|{{.RestartCount}}' 2>/dev/null || true)"
  if [[ "$state" == 'healthy|0' ]]; then
    code="$(docker exec '${container}' node -e "fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(1500)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.exit(3))" 2>/dev/null || true)"
    [[ "$code" == '${expectedStatus}' ]] && break
  fi
  [[ "$attempt" -lt 30 ]] || exit 2
  sleep 1
done
`;
}

function verifyBoundaryScript(name) {
  const spec = P8V3_IMAGES[name];
  const networks = spec.networks.slice().sort().join(",");
  const port = name === "lead_agent" ? 8000 : 3000;
  const path = name === "lead_agent" ? "/health" : "/api/health";
  let extra = "";
  if (name === "crm") {
    extra = String.raw`
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 https://crm.evoadmissions.com/login)" == '200' ]]
auth_code="$(docker exec '${spec.container}' node -e "fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/health',{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(3000)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.exit(3))")"
[[ "$auth_code" == '200' ]]
assistant_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'content-type: application/json' --data '{"message":"readiness"}' https://crm.evoadmissions.com/api/platform-ai/staff-assistant)"
[[ "$assistant_code" == '403' ]]
worker_id="$(docker inspect evo-crm-manual-send-worker --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{.RestartCount}}')"
[[ "$worker_id" =~ ^[0-9a-f]{64}\|${spec.platform}\|true\|0$ ]]
docker inspect evo-crm-manual-send-worker --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET"{n++} END{exit !(n==1)}'
`;
  } else if (name === "lead_agent") {
    extra = String.raw`
docker inspect '${spec.container}' --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '
$1=="EVO_AGENT_AUTOREPLY_ENABLED"{if(tolower($2)!="false")exit 2;a++}
$1=="EVO_AGENT_OUTBOUND_ENABLED"{if(tolower($2)!="false")exit 2;o++}
END{exit !(a==1&&o==1)}'
sync_code="$(docker exec '${spec.container}' python -c "import urllib.request,urllib.error; r=urllib.request.Request('http://evo-crm-app:3000/api/internal/lead-agent/whatsapp',data=b'{}',headers={'content-type':'application/json'},method='POST');
try: urllib.request.urlopen(r,timeout=3); print(200)
except urllib.error.HTTPError as e: print(e.code)" | tail -n1)"
[[ "$sync_code" == '401' || "$sync_code" == '403' ]]
`;
  }
  return String.raw`
${healthWaitScript(spec.container, port, path)}
[[ "$(docker inspect '${spec.container}' --format '{{.Image}}')" == '${spec.platform}' ]]
[[ "$(docker inspect '${spec.container}' --format '{{.RestartCount}}')" == '0' ]]
[[ "$(docker inspect '${spec.container}' --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}' | tr ',' '\n' | sed '/^$/d' | sort | paste -sd, -)" == '${networks}' ]]
${extra}
`;
}

function deployScript(name) {
  const spec = P8V3_IMAGES[name];
  const file = composeFile(name);
  const project = composeProject(name);
  const composeSha256 = name === "inbox" ? STAGED_INBOX_COMPOSE_SHA256 : STAGED_CRM_COMPOSE_SHA256;
  const services = name === "crm" ? "app manual-send-worker" : spec.service;
  return String.raw`
${composeEnvironment(name)}
[[ -f '${file}' && ! -L '${file}' ]] || exit 2
[[ "$(sha256sum '${file}' | awk '{print $1}')" == '${composeSha256}' ]] || exit 2
docker compose --project-name '${project}' -f '${file}' ${name === "inbox" ? "--env-file /opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production" : "--env-file /opt/evo-crm/.env.production"} config -q
docker compose --project-name '${project}' -f '${file}' ${name === "inbox" ? "--env-file /opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production" : "--env-file /opt/evo-crm/.env.production"} up --no-deps -d ${services}
${verifyBoundaryScript(name)}
${productionInventoryScript()}
`;
}

function parseBoundaryOutput(text, name, preState) {
  const inventoryLines = text.trim().split("\n").filter((line) => line.split("|").length === 6).slice(-5).join("\n");
  const rows = parseContainerRowsAfterDeploy(inventoryLines, name, preState);
  const spec = P8V3_IMAGES[name];
  const row = rows.find((item) => item.name === spec.container);
  return {
    name,
    status: "verified",
    before_image_id: spec.beforeImage,
    after_image_id: spec.platform,
    container_id: row.container_id,
    health: row.health,
    restart_count: row.restart_count,
    networks: row.networks,
    disabled_state: true,
    manual_worker: name === "crm" ? "verified" : "not_applicable",
  };
}

function parseContainerRowsAfterDeploy(text, changed, preState) {
  const rows = text.trim().split("\n").filter(Boolean).map((line) => {
    const parts = line.split("|");
    if (parts.length !== 6) fail("post-deploy inventory row is malformed", "verification_failed");
    const [name, container_id, image_id, health, restartText, networksText] = parts;
    return { name, container_id, image_id, health, restart_count: Number(restartText), networks: networksText.split(",").filter(Boolean).sort() };
  });
  if (rows.length !== 5) fail("post-deploy container cardinality drifted", "verification_failed");
  for (const expected of PRODUCTION_CONTAINERS) {
    const row = rows.find((item) => item.name === expected.name);
    const changedSpec = P8V3_IMAGES[changed];
    const desired = row.name === changedSpec.container ? changedSpec.platform : (P8V3_IMAGES.crm.container === row.name && ["inbox", "lead_agent"].includes(changed) ? P8V3_IMAGES.crm.platform : P8V3_IMAGES.inbox.container === row.name && changed === "lead_agent" ? P8V3_IMAGES.inbox.platform : expected.image);
    if (!row || !SHA64.test(row.container_id) || row.image_id !== desired || row.health !== "healthy" || row.restart_count !== 0) fail(`post-deploy container drifted: ${expected.name}`, "verification_failed");
    if (expected.name.includes("waha")) {
      const before = preState.find((item) => item.name === expected.name);
      if (row.container_id !== before.container_id || row.image_id !== before.image_id) fail("WAHA identity changed", "verification_failed");
    }
  }
  return rows;
}

function rollbackScript(name) {
  const spec = P8V3_IMAGES[name];
  const oldTag = `${name === "lead_agent" ? "evo-lead-agent" : `evo-${name}`}:${spec.rollbackRevision}`;
  const compose = `${P8V2D_ROLLBACK_ROOT}/${spec.rollbackCompose}`;
  const env = `${P8V2D_ROLLBACK_ROOT}/${spec.rollbackEnv}`;
  const project = composeProject(name);
  const service = spec.service;
  const removeWorker = name === "crm" ? String.raw`
worker_inventory="$(docker container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')" || exit 2
worker_row="$(printf '%s\n' "$worker_inventory" | awk -F '|' '$2 == "evo-crm-manual-send-worker" { print $0 }')"
if [[ -n "$worker_row" ]]; then
  worker_id="$(printf '%s\n' "$worker_row" | cut -d '|' -f 1)"
  [[ "$worker_id" =~ ^[0-9a-f]{64}$ ]] || exit 2
  worker_identity="$(docker inspect "$worker_id" --format '{{.Image}}|{{.Name}}' 2>/dev/null)" || exit 2
  [[ "$worker_identity" == '${P8V3_IMAGES.crm.platform}|/evo-crm-manual-send-worker' ]] || exit 2
  docker rm -f "$worker_id" >/dev/null || exit 2
fi
` : "";
  return String.raw`
${removeWorker}
docker load -i '${P8V2D_ROLLBACK_ROOT}/${spec.rollbackArchive}' >/dev/null
if docker image inspect '${oldTag}' >/dev/null 2>&1; then [[ "$(docker image inspect '${oldTag}' --format '{{.Id}}')" == '${spec.beforeImage}' ]]; else docker image tag '${spec.beforeImage}' '${oldTag}'; fi
export EVO_RELEASE_REVISION='${spec.rollbackRevision}'
export EVO_RELEASE_VERSION='rollback-${RELEASE_ID}'
export EVO_WAHA_IMAGE_DIGEST='${WAHA_IMAGE}'
export EVO_CRM_APP_ENV_FILE='${name === "crm" ? "/opt/evo-crm/.env.production" : env}'
export EVO_CRM_LEAD_AGENT_ENV_FILE='${name === "lead_agent" ? env : "/opt/evo-crm/.env.lead-agent"}'
export EVO_CRM_WAHA_ENV_FILE='${P8V2D_ROLLBACK_ROOT}/crm-env.waha'
export EVO_INBOX_APP_ENV_FILE='${name === "inbox" ? env : "/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production"}'
export EVO_INBOX_WAHA_ENV_FILE='${P8V2D_ROLLBACK_ROOT}/inbox-env.waha'
docker compose --project-name '${project}' -f '${compose}' --env-file '${env}' up --no-deps -d '${service}'
${healthWaitScript(spec.container, name === "lead_agent" ? 8000 : 3000, name === "lead_agent" ? "/health" : "/api/health")}
[[ "$(docker inspect '${spec.container}' --format '{{.Image}}')" == '${spec.beforeImage}' ]]
`;
}

function atomicEvidenceScript(incoming, hash) {
  return String.raw`
umask 077
[[ ! -e '${EVIDENCE_ROOT}' ]]
install -d -o root -g root -m 0700 '${EVIDENCE_ROOT}'
[[ -f '${incoming}' && ! -L '${incoming}' ]]
chown root:root '${incoming}'; chmod 0600 '${incoming}'
[[ "$(sha256sum '${incoming}' | awk '{print $1}')" == '${hash}' ]]
mv '${incoming}' '${REMOTE_RESULT}'
[[ "$(stat -c '%U:%G %a' '${EVIDENCE_ROOT}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${REMOTE_RESULT}')" == 'root:root 600' ]]
[[ "$(sha256sum '${REMOTE_RESULT}' | awk '{print $1}')" == '${hash}' ]]
[[ "$(find '${EVIDENCE_ROOT}' -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3k-rollout-result.json' ]]
`;
}

export function renderP8V3ShellContractsForTest() {
  const importer = { sha256: "a".repeat(64), size: 1234 };
  const owner = "a".repeat(48);
  const preflightRoot = preflightRootForOwner(owner);
  return Object.freeze({
    preflight: preflightRemoteScript({ preflightRoot }),
    configurationInstall: configurationInstallScript(),
    configurationRestore: configurationRestoreScript(),
    stagePrepare: stagePrepareScript(),
    stageFinalize: stageFinalizeScript(importer),
    loadImages: loadImagesScript(),
    knowledgePrepare: knowledgePrepareScript({
      audience: "client",
      bundleName: "evo-knowledge-client.json",
      manifestName: "evo-knowledge-client.sha256.json",
      bundleSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
    }),
    providerProbe: providerProbeCommand(owner, importer, preflightRoot),
    preflightPrepare: preflightPrepareScript({ preflightRoot, owner }),
    preflightCleanup: preflightCleanupScript({ preflightRoot, importerSha256: importer.sha256, importerSize: importer.size, owner }),
    knowledgeImport: knowledgeImportCommand({
      audience: "client",
      bundleName: "evo-knowledge-client.json",
      manifestName: "evo-knowledge-client.sha256.json",
    }, owner),
    knowledgeJobCleanup: knowledgeJobCleanupScript({ owner }),
    knowledgeCleanup: knowledgeCleanupScript({ owner }),
    deployCrm: deployScript("crm"),
    deployInbox: deployScript("inbox"),
    deployLead: deployScript("lead_agent"),
    rollbackCrm: rollbackScript("crm"),
    rollbackInbox: rollbackScript("inbox"),
    rollbackLead: rollbackScript("lead_agent"),
    evidence: atomicEvidenceScript("/opt/evo-release-evidence/.p8v3k-test-incoming", "a".repeat(64)),
  });
}

export function renderP8V3KnowledgeCleanupForTest({
  releaseRoot,
  knowledgeRemote,
  owner = "a".repeat(48),
  importerSha256 = null,
  importerSize = null,
  expectedFiles = [],
}) {
  const safePath = /^\/[A-Za-z0-9._/-]+$/;
  if (!safePath.test(releaseRoot) || !safePath.test(knowledgeRemote) || dirname(knowledgeRemote) !== releaseRoot) {
    fail("P8V3 cleanup test path drifted", "knowledge_failed");
  }
  return knowledgeCleanupScript({ releaseRoot, knowledgeRemote, owner, importerSha256, importerSize, expectedFiles });
}

export function renderP8V3PreflightCleanupForTest({
  preflightRoot,
  owner = "a".repeat(48),
  expectedUid = typeof process.getuid === "function" ? process.getuid() : 0,
  expectedGid = typeof process.getgid === "function" ? process.getgid() : 0,
}) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(preflightRoot)) fail("P8V3 preflight cleanup test path drifted", "preflight_drift");
  return preflightCleanupScript({ preflightRoot, owner, expectedUid, expectedGid });
}

export function renderP8V3PreflightPrepareForTest({ preflightRoot, owner = "a".repeat(48) }) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(preflightRoot)) fail("P8V3 preflight prepare test path drifted", "preflight_drift");
  return preflightPrepareScript({ preflightRoot, owner });
}

export function validateP8V3EvidencePrivacy(raw) {
  if (typeof raw !== "string" || UUID_IN_TEXT.test(raw) || /(?:sbp_|eyJ[A-Za-z0-9_-]*\.|GEMINI_API_KEY=|CLIENT_SECRET=|REFRESH_TOKEN=)/.test(raw)) {
    fail("result privacy validation failed", "evidence_publication_failed");
  }
}

export async function createP8V3ProductionOperations({
  mode = "execute",
  sourceRoot,
  candidateRoot,
  supabaseCliPath,
  localResultPath,
  environment = process.env,
  run = defaultRun,
  fetchImpl = fetch,
}) {
  const source = realpathSync(resolve(sourceRoot));
  const candidates = realpathSync(resolve(candidateRoot));
  assertDirectory(candidates);
  if (!["preflight", "execute"].includes(mode)) fail("P8V3 operation mode is invalid", "preflight_drift");
  if (!environment.SUPABASE_ACCESS_TOKEN) fail("P8V3 Supabase management credential is missing", "preflight_drift");
  const geminiKey = validateGeminiKey(environment.GEMINI_API_KEY);
  const childEnvironment = { ...environment };
  delete childEnvironment.GEMINI_API_KEY;
  const controllerRun = run;
  run = (command, args, options = {}) => controllerRun(command, args, { ...options, env: options.env ?? childEnvironment });
  if (mode === "execute" && environment.EVO_P8V3_AUTHORIZATION !== P8V3.authorization) fail("P8V3 authorization is missing", "preflight_drift");
  if (mode === "execute" && (!environment.EVO_P8V3_SUPABASE_URL || !environment.EVO_P8V3_SUPABASE_SERVICE_ROLE_KEY)) fail("P8V3 Supabase runtime credentials are missing", "preflight_drift");
  if (mode === "execute" && environment.EVO_P8V3_SUPABASE_URL !== PROJECT_URL) fail("P8V3 Supabase project drifted", "preflight_drift");
  const cli = realpathSync(resolve(supabaseCliPath));
  assertRegular(cli, 0o755);
  const management = createManagementClient({ accessToken: environment.SUPABASE_ACCESS_TOKEN, fetchImpl });
  const state = {
    accountId: null,
    staged: false,
    localRoots: [],
    built: new Map(),
    expectedImporter: null,
    serverComposeVerified: false,
    currentImporterOwner: null,
    preState: null,
    evidenceIncoming: null,
    evidenceHash: null,
    localEvidenceWritten: false,
  };

  const rest = mode === "execute"
    ? createP8V3PublicRestReader({ key: environment.EVO_P8V3_SUPABASE_SERVICE_ROLE_KEY, fetchImpl })
    : null;

  async function resolveAccount() {
    if (state.accountId) return state.accountId;
    const rows = await rest("/rest/v1/ai_configs?select=account_id,embeddings_provider&is_active=eq.true&limit=2");
    if (!Array.isArray(rows) || rows.length !== 1 || !UUID.test(rows[0].account_id) || rows[0].embeddings_provider !== "gemini") fail("live account or retrieval provider drifted", "knowledge_failed");
    state.accountId = rows[0].account_id;
    return state.accountId;
  }

  async function ensureStaged(deadlineAt) {
    if (state.staged) return;
    if (!state.expectedImporter) fail("P8V3F importer is not bound to preflight", "preflight_drift");
    for (const spec of Object.values(P8V3_IMAGES)) validateArchive(join(candidates, spec.file), spec);
    remote(run, stagePrepareScript(), { timeout: remaining(deadlineAt), label: "P8V3 staging root", code: "knowledge_failed" });
    const temp = mkdtempSync(join(tmpdir(), "evo-p8v3f-repo-"));
    try {
      const archive = join(temp, "repo.tar");
      runChecked(run, "application archive", "git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, P8V3.applicationCommit], { timeout: 120_000, code: "knowledge_failed" });
      chmodSync(archive, 0o600);
      runChecked(run, "repository transfer", "scp", [archive, `${HERMES}:${RELEASE_ROOT}/repo.tar`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
    } finally { rmSync(temp, { recursive: true, force: true }); }
    const importer = buildImporterArtifact(run, source);
    state.localRoots.push(importer.root);
    if (importer.sha256 !== state.expectedImporter.sha256 || importer.size !== state.expectedImporter.size) fail("P8V3F importer changed after preflight", "preflight_drift");
    state.currentImporterOwner = randomBytes(24).toString("hex");
    runChecked(run, "importer transfer", "scp", [importer.path, `${HERMES}:${RELEASE_ROOT}/${IMPORTER_FILE}`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
    for (const spec of Object.values(P8V3_IMAGES)) runChecked(run, `${spec.name} archive transfer`, "scp", [join(candidates, spec.file), `${HERMES}:${REMOTE_ARCHIVES}/${spec.file}`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
    remote(run, `${stageFinalizeScript(importer)}\n${loadImagesScript()}`, { timeout: remaining(deadlineAt), label: "P8V3 staging", code: "knowledge_failed" });
    state.staged = true;
  }

  return {
    async executionIdentity() {
      runChecked(run, "origin refresh", "git", ["-C", source, "fetch", "origin", "--prune"], { timeout: 60_000, code: "preflight_drift" });
      const commit = runChecked(run, "execution HEAD", "git", ["-C", source, "rev-parse", "HEAD^{commit}"], { code: "preflight_drift" }).stdout.trim();
      const tree = runChecked(run, "execution tree", "git", ["-C", source, "rev-parse", "HEAD^{tree}"], { code: "preflight_drift" }).stdout.trim();
      const origin = runChecked(run, "origin main", "git", ["-C", source, "rev-parse", "origin/main^{commit}"], { code: "preflight_drift" }).stdout.trim();
      const status = runChecked(run, "execution status", "git", ["-C", source, "status", "--porcelain", "--untracked-files=all"], { code: "preflight_drift" }).stdout.trim();
      if (!SHA40.test(commit) || !SHA40.test(tree) || commit !== origin || status !== "") fail("execution checkout is not clean current main", "preflight_drift");
      const api = parseJson(runChecked(run, "execution CI lookup", "gh", ["api", `repos/izzhackt/evo_AI_CRM/actions/runs?head_sha=${commit}&event=push&status=completed&per_page=100`], { timeout: 60_000, code: "preflight_drift" }).stdout, "execution CI");
      const runs = api.workflow_runs?.filter((item) => item.name === "EVO platform CI" && item.head_sha === commit && item.conclusion === "success") ?? [];
      if (runs.length < 1) fail("exact-main CI is not successful", "preflight_drift");
      return { commit, tree, ci_run_id: runs.sort((a, b) => b.id - a.id)[0].id };
    },

    async preflight() {
      const appTree = runChecked(run, "application tree", "git", ["-C", source, "rev-parse", `${P8V3.applicationCommit}^{tree}`], { code: "preflight_drift" }).stdout.trim();
      if (appTree !== P8V3.applicationTree) fail("application tree drifted", "preflight_drift");
      const retrievalProvider = await readRetrievalProvider(management);
      const gemini = await verifyP8V3FGemini({ apiKey: geminiKey, fetchImpl });
      const cliVersion = runChecked(run, "Supabase CLI version", cli, ["--version"], { code: "preflight_drift" }).stdout.trim();
      if (cliVersion !== CLI_VERSION) fail("Supabase CLI version drifted", "preflight_drift");
      for (const spec of Object.values(P8V3_IMAGES)) validateArchive(join(candidates, spec.file), spec);
      validateCandidateCompose(run, source);
      if (sha256(readFileSync(join(source, "supabase/migrations/077_platform_manual_whatsapp_send_worker.sql"))) !== "4a271dea4a3b5f1570c57cb4b094a13a057ca3cacc38b1d449a4925757299314") fail("migration 077 drifted", "preflight_drift");
      const ledger = await readLedger(management);
      if (ledger.range !== "001-077" || ledger.count !== 77) fail("production migration ledger drifted", "preflight_drift");
      const importer = buildVerifiedImporterArtifact(run, source);
      try {
        verifyRemoteCommandForms(run);
        const providerOwner = randomBytes(24).toString("hex");
        const providerPreflightRoot = preflightRootForOwner(providerOwner);
        const output = remote(run, preflightRemoteScript({ preflightRoot: providerPreflightRoot }), { timeout: 120_000, label: "minimal production preflight", code: "preflight_drift" }).stdout;
        const inventory = output.split("\n").filter((line) => line.split("|").length === 6).join("\n");
        const containers = parseContainerRows(inventory);
        const wahaCrm = containers.find((item) => item.name === "evo-crm-waha-1");
        const wahaInbox = containers.find((item) => item.name === "evo-inbox-waha");
        let providerPrepareAttempted = false;
        try {
          providerPrepareAttempted = true;
          remote(run, preflightPrepareScript({ preflightRoot: providerPreflightRoot, owner: providerOwner }), { timeout: 120_000, label: "provider probe root", code: "preflight_drift" });
          runChecked(run, "provider probe importer transfer", "scp", [join(importer.root, IMPORTER_FILE), `${HERMES}:${providerPreflightRoot}/${IMPORTER_FILE}`], { timeout: 120_000, code: "preflight_drift" });
          remote(run, preflightFinalizeScript(importer, { preflightRoot: providerPreflightRoot, owner: providerOwner }), { timeout: 120_000, label: "provider probe importer", code: "preflight_drift" });
          const providerProbe = run("ssh", commandSshArgs(providerProbeCommand(providerOwner, importer, providerPreflightRoot)), { input: `${geminiKey}\n`, timeout: 120_000, label: "server compose provider probe", code: "preflight_drift" });
          if (providerProbe.stderr !== "" || providerProbe.stdout.includes(geminiKey) || providerProbe.stderr.includes(geminiKey)) fail("provider probe output is unsafe", "preflight_drift");
          state.serverComposeVerified = parseP8V3ProviderProbeOutput(providerProbe.stdout).server_compose_verified;
        } finally {
          if (providerPrepareAttempted) {
            remote(run, preflightCleanupScript({ preflightRoot: providerPreflightRoot, importerSha256: importer.sha256, importerSize: importer.size, owner: providerOwner }), { timeout: 120_000, label: "provider probe cleanup", code: "preflight_drift" });
          }
        }
        state.preState = containers;
        return {
          containers,
          waha: { crm_container_id: wahaCrm.container_id, crm_image_id: wahaCrm.image_id, inbox_container_id: wahaInbox.container_id, inbox_image_id: wahaInbox.image_id, unchanged: false },
          migration: ledger,
          archives: Object.values(P8V3_IMAGES).map(({ name, sha256: archiveSha256, size, index, platform }) => ({ name, sha256: archiveSha256, size, index, platform })),
          gemini: { ...gemini, ...retrievalProvider, server_compose_verified: state.serverComposeVerified },
          importer: { sha256: importer.sha256, size: importer.size, verified: true },
          importer_network: { name: IMPORTER_NETWORK, driver: "bridge", scope: "local", internal: false, dns: "127.0.0.11" },
          compose_validated: true,
          prerequisites_verified: output.includes("prerequisites_verified\n"),
        };
      } finally {
        rmSync(importer.root, { recursive: true, force: true });
      }
    },

    async verifyPreflight(snapshot) {
      if (Date.now() >= Date.parse(snapshot.expires_at)) fail("P8V3 preflight expired", "preflight_drift");
      const expectedArchives = Object.values(P8V3_IMAGES).map(({ name, sha256: archiveSha256, size, index, platform }) => ({ name, sha256: archiveSha256, size, index, platform }));
      if (JSON.stringify(snapshot.archives) !== JSON.stringify(expectedArchives)) fail("P8V3 preflight archive identity drifted", "preflight_drift");
      if (snapshot.gemini?.server_compose_verified !== true) fail("P8V3 server compose proof is absent", "preflight_drift");
      for (const spec of Object.values(P8V3_IMAGES)) validateArchive(join(candidates, spec.file), spec);
      validateCandidateCompose(run, source);
      const ledger = await readLedger(management);
      if (ledger.range !== "001-077" || ledger.count !== 77) fail("production migration ledger changed after preflight", "preflight_drift");
      await readRetrievalProvider(management);
      verifyRemoteCommandForms(run);
      const revalidationRoot = preflightRootForOwner(randomBytes(24).toString("hex"));
      const output = remote(run, preflightRemoteScript({ preflightRoot: revalidationRoot }), { timeout: 120_000, label: "production preflight revalidation", code: "preflight_drift" }).stdout;
      const inventory = output.split("\n").filter((line) => line.split("|").length === 6).join("\n");
      const containers = parseContainerRows(inventory);
      if (JSON.stringify(containers) !== JSON.stringify(snapshot.containers)) fail("production containers changed after preflight", "preflight_drift");
      const readiness = await management(`/v1/projects/${PROJECT_REF}/database/query/read-only`, {
        method: "POST",
        body: { query: MIGRATION_077_READINESS_SQL },
        expectedStatus: 201,
      });
      validateP8V3DMigrationReadiness(readiness);
      const importer = buildVerifiedImporterArtifact(run, source);
      try {
        if (importer.sha256 !== snapshot.importer.sha256 || importer.size !== snapshot.importer.size) fail("P8V3F importer differs from preflight", "preflight_drift");
      } finally { rmSync(importer.root, { recursive: true, force: true }); }
      const accountId = await resolveAccount();
      try {
        for (const [audience, vault] of [["client", CLIENT_VAULT], ["internal", INTERNAL_VAULT]]) {
          if (state.built.has(audience)) fail("knowledge readiness was already prepared", "preflight_drift");
          state.built.set(audience, buildAudience(run, source, accountId, audience, vault, state.localRoots));
        }
      } catch (error) {
        for (const root of state.localRoots.splice(0)) rmSync(root, { recursive: true, force: true });
        state.built.clear();
        throw error;
      }
      state.expectedImporter = structuredClone(snapshot.importer);
      state.serverComposeVerified = true;
      state.preState = containers;
      return { status: "verified" };
    },

    async configure({ deadlineAt }) {
      const installed = run("ssh", configurationSshArgs(), { input: `${geminiKey}\n`, timeout: remaining(deadlineAt), label: "P8V3 configuration install", code: "configuration_failed" });
      if (installed.stderr !== "" || installed.stdout.includes(geminiKey) || installed.stderr.includes(geminiKey)) fail("P8V3F configuration output is unsafe", "configuration_failed");
      const output = installed.stdout.trim().split("\n").at(-1);
      const record = parseJson(output, "configuration result");
      exactKeys(record, ["status", "installed_names", "backup_sha256", "lead_file_verified", "worker_file_verified"], "configuration result");
      return record;
    },

    async restoreConfiguration() {
      remote(run, configurationRestoreScript(), { timeout: 120_000, label: "P8V3 configuration restore", code: "rollback_failed" });
      return { configuration_restored: true };
    },

    async migrate({ deadlineAt }) {
      const before = await readLedger(management);
      if (before.range !== "001-077" || before.count !== 77) fail("migration reconciliation pre-state drifted", "migration_failed");
      remaining(deadlineAt);
      const readiness = await management(`/v1/projects/${PROJECT_REF}/database/query/read-only`, {
        method: "POST",
        body: { query: MIGRATION_077_READINESS_SQL },
        expectedStatus: 201,
      });
      validateP8V3DMigrationReadiness(readiness);
      remaining(deadlineAt);
      const after = await readLedger(management);
      if (after.range !== "001-077" || after.count !== 77) fail("migration ledger changed during reconciliation", "migration_failed");
      return { status: "verified", before_range: before.range, before_count: before.count, after_range: after.range, after_count: after.count, applied_versions: [] };
    },

    async importKnowledge(audience, { deadlineAt }) {
      let owner = null;
      let record;
      let operationError = null;
      try {
        const accountId = await resolveAccount();
        await ensureStaged(deadlineAt);
        if (state.serverComposeVerified !== true) fail("server compose provider proof did not complete", "knowledge_failed", "transport_failed");
        const item = state.built.get(audience);
        if (!item) fail(`${audience} knowledge was not prepared before mutation`, "knowledge_failed", "bundle_invalid");
        for (const file of [item.bundleName, item.manifestName]) runChecked(run, `${audience} knowledge transfer`, "scp", [join(item.root, file), `${HERMES}:${KNOWLEDGE_REMOTE}/${file}`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
        remote(run, knowledgePrepareScript(item), { timeout: remaining(deadlineAt), label: `${audience} knowledge prepare`, code: "knowledge_failed" });
        owner = randomBytes(24).toString("hex");
        state.currentImporterOwner = owner;
        const imported = run("ssh", commandSshArgs(knowledgeImportCommand(item, owner)), { input: `${geminiKey}\n${accountId}\n`, timeout: remaining(deadlineAt), label: `${audience} knowledge import`, code: "knowledge_failed" });
        if (imported.stderr !== "" || imported.stdout.includes(geminiKey) || imported.stderr.includes(geminiKey)) fail(`${audience} importer output is unsafe`, "knowledge_failed", "transport_failed");
        parseP8V3KnowledgeImporterOutputForTest(imported.stdout, audience, item.bundleSha256);
        const params = new URLSearchParams({ select: "audience,bundle_sha256,document_count,chunk_count", account_id: `eq.${accountId}`, audience: `eq.${audience}` });
        const revisions = await rest(`/rest/v1/ai_knowledge_bundle_revisions?${params}`);
        if (!Array.isArray(revisions) || revisions.length !== 1 || revisions[0].bundle_sha256 !== item.bundleSha256 || Number(revisions[0].document_count) !== item.documentCount || !Number.isSafeInteger(Number(revisions[0].chunk_count)) || Number(revisions[0].chunk_count) < 1) fail(`${audience} database revision drifted`, "knowledge_failed", "rpc_rejected");
        const chunkCount = Number(revisions[0].chunk_count);
        record = { name: audience, status: "verified", document_count: item.documentCount, chunk_count: chunkCount, bundle_sha256: item.bundleSha256, manifest_sha256: item.manifestSha256, database_revision_sha256: sha256(Buffer.from(JSON.stringify({ audience, bundle_sha256: item.bundleSha256, document_count: item.documentCount, chunk_count: chunkCount }))) };
      } catch (error) {
        operationError = error;
      } finally {
        if (owner !== null) {
          try {
            remote(run, knowledgeJobCleanupScript({ owner }), { timeout: 120_000, label: `${audience} knowledge job cleanup`, code: "knowledge_failed" });
            state.currentImporterOwner = null;
          } catch (cleanupError) {
            operationError = record === undefined
              ? cleanupError
              : enrichKnowledgeCleanupFailure(cleanupError, record);
          }
        }
      }
      if (operationError) {
        if (operationError?.reasonCode || operationError?.code === "knowledge_failed") throw operationError;
        fail(`${audience} knowledge transport failed`, "knowledge_failed", "transport_failed");
      }
      return record;
    },

    async cleanupKnowledge() {
      let error;
      const expectedFiles = [...state.built.values()].flatMap((item) => [
        { name: item.bundleName, sha256: item.bundleSha256 },
        { name: item.manifestName, sha256: item.manifestSha256 },
      ]);
      try {
        remote(run, knowledgeCleanupScript({
          owner: state.currentImporterOwner,
          importerSha256: state.expectedImporter?.sha256 ?? null,
          importerSize: state.expectedImporter?.size ?? null,
          expectedFiles,
        }), { timeout: 120_000, label: "knowledge cleanup", code: "knowledge_failed" });
      } catch (caught) { error = caught; }
      for (const root of state.localRoots.splice(0)) {
        try { rmSync(root, { recursive: true, force: false }); } catch (caught) { error ??= caught; }
      }
      state.built.clear();
      state.serverComposeVerified = false;
      state.currentImporterOwner = null;
      if (error) throw error;
      return { status: "verified" };
    },

    async cleanupPreparedReadiness() {
      for (const root of state.localRoots.splice(0)) rmSync(root, { recursive: true, force: true });
      state.built.clear();
      state.serverComposeVerified = false;
      state.currentImporterOwner = null;
      return { status: "verified" };
    },

    async deploy(name, { deadlineAt, before }) {
      if (!Object.hasOwn(P8V3_IMAGES, name) || !state.staged) fail("deployment candidate is not staged", "deployment_failed");
      const output = remote(run, deployScript(name), { timeout: remaining(deadlineAt), label: `${name} deployment`, code: "deployment_failed" }).stdout;
      return parseBoundaryOutput(output, name, before);
    },

    async verifyWaha() {
      const output = remote(run, productionInventoryScript(), { timeout: 120_000, label: "WAHA identity verification", code: "verification_failed" }).stdout;
      const rows = output.trim().split("\n").map((line) => {
        const parts = line.split("|");
        return { name: parts[0], container_id: parts[1], image_id: parts[2] };
      });
      const crm = rows.find((item) => item.name === "evo-crm-waha-1");
      const inbox = rows.find((item) => item.name === "evo-inbox-waha");
      if (!crm || !inbox || crm.container_id !== state.preState.find((item) => item.name === crm.name).container_id || inbox.container_id !== state.preState.find((item) => item.name === inbox.name).container_id || crm.image_id !== WAHA_IMAGE || inbox.image_id !== WAHA_IMAGE) fail("WAHA identity changed", "verification_failed");
      return { crm_container_id: crm.container_id, crm_image_id: crm.image_id, inbox_container_id: inbox.container_id, inbox_image_id: inbox.image_id, unchanged: true };
    },

    async rollback(boundaries) {
      remote(run, configurationRestoreScript(), { timeout: 120_000, label: "configuration rollback", code: "rollback_failed" });
      for (const name of boundaries) remote(run, rollbackScript(name), { timeout: 15 * 60_000, label: `${name} rollback`, code: "rollback_failed" });
      const output = remote(run, productionInventoryScript(), { timeout: 120_000, label: "rollback verification", code: "rollback_failed" }).stdout;
      parseContainerRows(output);
      return { status: "verified", configuration_restored: true };
    },

    async publishEvidence(result) {
      const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
      const raw = bytes.toString("utf8");
      validateP8V3EvidencePrivacy(raw);
      const hash = sha256(bytes);
      state.evidenceHash = hash;
      const temporary = `${localResultPath}.publish-${process.pid}`;
      if (existsSync(localResultPath) || existsSync(temporary)) fail("local result path is not absent", "evidence_publication_failed");
      try {
        writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
        chmodSync(temporary, 0o600);
        renameSync(temporary, localResultPath);
      } finally { rmSync(temporary, { force: true }); }
      state.localEvidenceWritten = true;
      const localMetadata = lstatSync(localResultPath);
      if (!localMetadata.isFile() || localMetadata.isSymbolicLink() || (localMetadata.mode & 0o777) !== 0o600 || sha256(readFileSync(localResultPath)) !== hash) fail("local result publication failed", "evidence_publication_failed");
      const incoming = `/opt/evo-release-evidence/.p8v3k-result-${randomBytes(12).toString("hex")}`;
      state.evidenceIncoming = incoming;
      runChecked(run, "result transfer", "scp", [localResultPath, `${HERMES}:${incoming}`], { timeout: 120_000, code: "evidence_publication_failed" });
      remote(run, atomicEvidenceScript(incoming, hash), { timeout: 120_000, label: "result publication", code: "evidence_publication_failed" });
      state.evidenceIncoming = null;
      return { status: "verified", sha256: hash };
    },

    async cleanupEvidence() {
      const incoming = state.evidenceIncoming;
      const expectedHash = state.evidenceHash;
      let cleanupError;
      try { remote(run, String.raw`
errors=0
for target in '${REMOTE_RESULT}'${incoming ? ` '${incoming}'` : ""}; do
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ -f "$target" && ! -L "$target" && "$(sha256sum "$target" | awk '{print $1}')" == '${expectedHash ?? "unavailable"}' ]]; then rm -f "$target"; else errors=1; fi
  fi
done
if [[ -d '${EVIDENCE_ROOT}' && -z "$(find '${EVIDENCE_ROOT}' -mindepth 1 -maxdepth 1 -print -quit)" ]]; then rmdir '${EVIDENCE_ROOT}'; fi
exit "$errors"
`, { timeout: 120_000, label: "failed evidence cleanup", code: "evidence_publication_failed" }); } catch (error) { cleanupError = error; }
      if (state.localEvidenceWritten) rmSync(localResultPath, { force: true });
      state.localEvidenceWritten = false;
      state.evidenceIncoming = null;
      state.evidenceHash = null;
      if (cleanupError) throw cleanupError;
    },
  };
}
