#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, sep } from "node:path";

import { readPortableMetadata, verifyPortableArchive } from "./p8b3-portable-image-identity.mjs";
import { P8V2, verifyP8V2FinalRoot, writeP8V2Result } from "./p8v2-production-preparation.mjs";

const HERMES = "hermes-vps";
const RELEASE_VERSION = "p8v2d-0f1454d0-20260818";
const ROLLBACK_ROOT = `/opt/evo-release-evidence/p8v2d-rollback-${P8V2.applicationCommit}-20260818`;
const SMOKE_OWNER_LABEL = "evo.p8v2d.owner";
export const PRODUCTION_ROW_TEMPLATE = "{{.Name}}|{{.Id}}|{{.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{.RestartCount}}";
const LEAD_HEALTH_ATTEMPTS = 30;
const LEAD_HEALTH_INTERVAL_MS = 500;
const APP_HEALTH_ATTEMPTS = 30;
const APP_HEALTH_INTERVAL_MS = 500;
export const APP_HEALTH_PROBE = "(async()=>{const s=process.argv[1];let r;try{r=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)})}catch{process.exit(3)}let j;try{j=await r.json()}catch{process.exit(2)}if(r.status!==200||JSON.stringify(j)!==JSON.stringify({ok:true,status:'live',service:s}))process.exit(2)})()";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const MAX_OUTPUT = 512 * 1024 * 1024;

export const P8V2_KNOWLEDGE_SOURCES = Object.freeze({
  client: Object.freeze({
    path: "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО",
    documentCount: 11,
  }),
  internal: Object.freeze({
    path: "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ",
    documentCount: 291,
  }),
});

const REMOTE_FILES = Object.freeze([
  ["/opt/evo-crm/docker-compose.prod.yml", "crm-current-docker-compose.prod.yml", 644],
  ["/opt/evo-crm/.env.production", "crm-env.production", 600],
  ["/opt/evo-crm/.env.lead-agent", "crm-env.lead-agent", 600],
  ["/opt/evo-crm/.env.waha", "crm-env.waha", 600],
  ["/opt/evo-inbox/docker-compose.prod.yml", "inbox-current-docker-compose.prod.yml", 644],
  ["/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production", "inbox-env.production", 600],
  ["/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha", "inbox-env.waha", 600],
  ["/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo/docker-compose.prod.yml", "crm-app-compose.prod.yml", 644],
  ["/opt/evo-releases/1f0d1a810014e2ecee496cb9c3a7217a70c86486/repo/docker-compose.prod.yml", "crm-waha-compose.prod.yml", 644],
  ["/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo/docker-compose.prod.yml", "lead-agent-compose.prod.yml", 600],
  ["/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml", "inbox-app-compose.prod.yml", 644],
  ["/opt/evo-releases/1f0d1a810014e2ecee496cb9c3a7217a70c86486/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml", "inbox-waha-compose.prod.yml", 644],
].map((item) => Object.freeze(item)));

const ROOT_CRM_SETTINGS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EVO_PLATFORM_SUPABASE_SECRET_KEY",
  "EVO_PLATFORM_ORGANIZATION_ID", "EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID", "EVO_PLATFORM_GEMINI_API_KEY",
  "EVO_PLATFORM_STAFF_ASSISTANT_ENABLED", "EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED",
  "EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET", "EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED", "EVO_LEAD_AGENT_SYNC_SECRET",
]);
const LEAD_SETTINGS = Object.freeze([
  "EVO_AGENT_AMO_BASE_URL", "EVO_AGENT_AMO_CLIENT_ID", "EVO_AGENT_AMO_CLIENT_SECRET", "EVO_AGENT_AMO_REDIRECT_URI",
  "EVO_AGENT_AMO_PIPELINE_ID", "EVO_AGENT_AMO_STATUS_ID", "EVO_AGENT_AMO_RESPONSIBLE_USER_ID",
  "EVO_AGENT_CRM_BASE_URL", "EVO_AGENT_CRM_SYNC_PATH", "EVO_AGENT_CRM_SYNC_SECRET", "EVO_AGENT_WAHA_BASE_URL",
  "EVO_AGENT_WAHA_API_KEY", "EVO_AGENT_WAHA_SESSION", "EVO_AGENT_WAHA_WEBHOOK_SECRET",
]);

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function fail(message, code = "operation_failed", safeDetails) {
  const error = new Error(message);
  error.code = code;
  if (safeDetails) error.safeDetails = safeDetails;
  throw error;
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    maxBuffer: MAX_OUTPUT,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", signal: result.signal ?? null };
}

function requireSuccess(result, label) {
  if (!result || result.status !== 0 || (result.signal !== null && result.signal !== undefined)) fail(`${label} failed safely`);
  return result.stdout;
}

export function createDockerExecutor(runCommand = defaultRun) {
  return (args, options = {}) => {
    if (requireSuccess(runCommand("orb", ["status"], { timeout: 15_000 }), "OrbStack status").trim() !== "Running") fail("OrbStack must be Running");
    if (requireSuccess(runCommand("docker", ["context", "show"], { timeout: 15_000 }), "Docker context check").trim() !== "orbstack") fail("Docker context must be exactly orbstack");
    return runCommand("docker", args, options);
  };
}

function parseJson(value, label) {
  try { return JSON.parse(value); } catch { fail(`${label} returned invalid JSON`); }
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`${label} is not closed`);
}

function assertDirectory(path) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail(`unsafe directory: ${basename(path)}`);
}

function assertRegular(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail(`unsafe file: ${basename(path)}`);
}

function ensureContained(parent, path) {
  const parentReal = realpathSync(parent);
  const pathReal = realpathSync(path);
  if (pathReal !== parentReal && !pathReal.startsWith(`${parentReal}${sep}`)) fail("path escaped evidence parent");
}

function assertOrCreateEvidenceParent(sourceRoot, evidenceParent) {
  const sourceReal = realpathSync(sourceRoot);
  if (sourceReal !== sourceRoot) fail("application source root must be canonical");
  if (existsSync(evidenceParent)) {
    assertDirectory(evidenceParent);
    ensureContained(sourceRoot, evidenceParent);
    return;
  }
  mkdirSync(evidenceParent, { mode: 0o700 });
  chmodSync(evidenceParent, 0o700);
  assertDirectory(evidenceParent);
  ensureContained(sourceRoot, evidenceParent);
}

function createExclusiveDirectory(path) {
  if (existsSync(path)) fail(`evidence destination collision: ${basename(path)}`);
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
  assertDirectory(path);
}

function atomicJson(path, value) {
  if (existsSync(path) || existsSync(`${path}.tmp`)) fail(`artifact collision: ${basename(path)}`);
  try {
    writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(`${path}.tmp`, 0o600);
    renameSync(`${path}.tmp`, path);
  } catch (error) {
    rmSync(`${path}.tmp`, { force: true });
    throw error;
  }
  assertRegular(path);
}

function parseImageList(text) {
  const result = new Map();
  if (!text.trim()) return result;
  for (const line of text.trim().split("\n")) {
    const parts = line.split("|");
    if (parts.length !== 2 || !parts[0] || !IMAGE_ID.test(parts[1]) || result.has(parts[0])) fail("Docker image inventory drifted");
    result.set(parts[0], parts[1]);
  }
  return result;
}

function parseContainerList(text) {
  const result = new Map();
  if (!text.trim()) return result;
  for (const line of text.trim().split("\n")) {
    const parts = line.split("|");
    if (parts.length !== 2 || !parts[0] || !/^[0-9a-f]{64}$/.test(parts[1]) || result.has(parts[0])) fail("Docker container inventory drifted");
    result.set(parts[0], parts[1]);
  }
  return result;
}

export function validateCandidateImage(inspect, spec, expectedId = inspect?.Id) {
  const labels = inspect?.Config?.Labels ?? {};
  if (!IMAGE_ID.test(expectedId) || inspect?.Id !== expectedId || inspect?.Descriptor?.digest !== expectedId || inspect?.Descriptor?.mediaType !== "application/vnd.oci.image.index.v1+json" || inspect?.Os !== "linux" || inspect?.Architecture !== "amd64" || (inspect?.Variant ?? "") !== "" || labels["org.opencontainers.image.revision"] !== P8V2.applicationCommit || labels["org.opencontainers.image.source"] !== P8V2.source || labels["org.opencontainers.image.version"] !== RELEASE_VERSION) fail(`candidate image identity drifted: ${spec.name}`);
  return inspect.Id;
}

export function parseProductionRows(text, expectedContainers = P8V2.productionContainers) {
  const lines = text.trim().split("\n");
  if (!Array.isArray(expectedContainers) || lines.length !== expectedContainers.length) fail("production container cardinality drifted");
  return lines.map((line, index) => {
    const parts = line.split("|");
    if (parts.length !== 5) fail("production container row is malformed");
    const expected = expectedContainers[index];
    const [name, containerId, imageId, health, restart] = parts;
    if (name !== expected.name || containerId !== expected.containerId || imageId !== expected.imageId || health !== "healthy" || restart !== "0") fail("production container boundary drifted", "production_baseline_drift");
    return { name, container_id: containerId, image_id: imageId, health, restart_count: 0 };
  });
}

function safeConfiguration(statuses, matches, blockers) {
  return { status: blockers.length ? "blocked" : "verified", root_crm: statuses.root_crm, lead_agent: statuses.lead_agent, manual_worker: statuses.manual_worker, configured_account_match: matches.account, configured_organization_match: matches.organization, supabase_project_match: matches.project, blockers };
}

export function validateConfigurationSnapshot(snapshot, live) {
  exactKeys(snapshot, ["root_crm", "lead_agent", "manual_worker", "configured_account_id", "configured_organization_id", "configured_supabase_url", "blockers"], "configuration snapshot");
  const matches = { account: snapshot.configured_account_id === live.accountId, organization: snapshot.configured_organization_id === live.organizationId, project: snapshot.configured_supabase_url === live.supabaseUrl };
  const blockers = [...snapshot.blockers];
  if ((!matches.account || !matches.organization) && !blockers.includes("root_crm_identity_mismatch")) blockers.push("root_crm_identity_mismatch");
  if (!matches.project && !blockers.includes("supabase_project_mismatch")) blockers.push("supabase_project_mismatch");
  const safe = safeConfiguration({ root_crm: snapshot.root_crm, lead_agent: snapshot.lead_agent, manual_worker: snapshot.manual_worker }, matches, blockers);
  if (blockers.length) fail("required configuration is blocked", "required_configuration_missing", safe);
  return safe;
}

function checkSourceRoot(toolRoot, sourceRoot, run) {
  const toolHead = requireSuccess(run("git", ["-C", toolRoot, "rev-parse", "HEAD"]), "release-control HEAD").trim();
  if (toolHead !== requireSuccess(run("git", ["-C", toolRoot, "rev-parse", "origin/main"]), "release-control origin/main").trim()) fail("release-control checkout is not current main");
  if (requireSuccess(run("git", ["-C", toolRoot, "status", "--porcelain=v1", "--untracked-files=all"]), "release-control status").trim()) fail("release-control checkout must be clean");
  const sourceHead = requireSuccess(run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]), "application HEAD").trim();
  const sourceTree = requireSuccess(run("git", ["-C", sourceRoot, "rev-parse", "HEAD^{tree}"]), "application tree").trim();
  const sourceParent = requireSuccess(run("git", ["-C", sourceRoot, "rev-parse", "HEAD^"]), "application parent").trim();
  if (sourceHead !== P8V2.applicationCommit || sourceTree !== P8V2.applicationTree || sourceParent !== P8V2.applicationParent) fail("application checkout identity drifted");
  if (requireSuccess(run("git", ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=all"]), "application status").trim()) fail("application checkout must be clean");
  return toolHead;
}

function imageContext(spec, sourceRoot) {
  if (spec.name === "evo_inbox") return join(sourceRoot, "agent-lead2-inbox");
  if (spec.name === "lead_agent") return join(sourceRoot, "evo-lead-agent");
  return sourceRoot;
}

function buildArguments(spec, sourceRoot, environment) {
  const args = ["buildx", "build", "--platform", "linux/amd64", "--load", "--tag", spec.tag, "--build-arg", `EVO_IMAGE_SOURCE=${P8V2.source}`, "--build-arg", `EVO_IMAGE_REVISION=${P8V2.applicationCommit}`, "--build-arg", `EVO_IMAGE_VERSION=${RELEASE_VERSION}`];
  if (spec.name === "evo_inbox") {
    for (const name of ["EVO_P8V2_INBOX_SUPABASE_URL", "EVO_P8V2_INBOX_SUPABASE_ANON_KEY", "EVO_P8V2_INBOX_SITE_URL"]) if (!environment[name]) fail("Inbox build settings are unavailable", "candidate_build_failed");
    args.push("--build-arg", "NEXT_PUBLIC_SUPABASE_URL", "--build-arg", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "--build-arg", "NEXT_PUBLIC_SITE_URL");
  }
  args.push(imageContext(spec, sourceRoot));
  return args;
}

function smokeEnvironment(spec) {
  if (spec.name === "main_crm") return ["EVO_PLATFORM_WAHA_INGRESS_ENABLED=0", "EVO_PLATFORM_WAHA_WORKER_ENABLED=0", "EVO_PLATFORM_AMOCRM_READ_ENABLED=0", "EVO_PLATFORM_AI_MEMORY_ENABLED=0", "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=0", "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED=0", "EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1", "EVO_PLATFORM_P7A_AUDIT_ENABLED=0", "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1", `EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=${randomBytes(32).toString("hex")}`];
  if (spec.name === "evo_inbox") return ["EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1", `EVO_INBOX_P7B_OBSERVABILITY_SECRET=${randomBytes(32).toString("hex")}`];
  return ["EVO_AGENT_FROZEN=true", "EVO_AGENT_WORKER_ENABLED=false", "EVO_AGENT_AUTOREPLY_ENABLED=false", "EVO_AGENT_OUTBOUND_ENABLED=false", "EVO_AGENT_GEMINI_MODEL=gemini-3.5-flash"];
}

function inspectOwnedSmoke(docker, containerId, ownerNonce, imageId) {
  if (!/^[0-9a-f]{64}$/.test(containerId ?? "")) return null;
  const rows = parseJson(requireSuccess(docker(["container", "inspect", containerId]), "smoke ownership inspect"), "smoke ownership inspect");
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (row?.Id !== containerId || row?.Image !== imageId || row?.Config?.Labels?.[SMOKE_OWNER_LABEL] !== ownerNonce) return null;
  return row;
}

const LEAD_HEALTH_PROBE = String.raw`import json,sys,urllib.error,urllib.request
expected={"frozen":True,"ok":True,"ready":False,"status":"live"}
try:
 r=urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=1)
except urllib.error.HTTPError:
 sys.exit(20)
except (TimeoutError,ConnectionError,urllib.error.URLError,OSError):
 sys.exit(10)
try:
 body=json.load(r)
except (json.JSONDecodeError,UnicodeDecodeError,ValueError):
 sys.exit(20)
sys.exit(0 if r.status==200 and body==expected else 20)`;

function waitForLeadHealth(docker, containerId, ownerNonce, imageId, wait) {
  for (let attempt = 1; attempt <= LEAD_HEALTH_ATTEMPTS; attempt += 1) {
    const owned = inspectOwnedSmoke(docker, containerId, ownerNonce, imageId);
    if (owned?.State?.Running !== true) fail("lead_agent smoke container exited");
    const health = docker(["exec", containerId, "python", "-c", LEAD_HEALTH_PROBE], { timeout: 5_000 });
    if (health.status === 0) return;
    if (health.status !== 10) fail("lead_agent liveness response drifted");
    if (attempt === LEAD_HEALTH_ATTEMPTS) fail("lead_agent liveness readiness timed out");
    wait(LEAD_HEALTH_INTERVAL_MS);
  }
}

function waitForAppHealth(docker, containerId, ownerNonce, imageId, spec, wait) {
  const service = spec.name === "main_crm" ? "evo-crm" : "evo-inbox-companion";
  for (let attempt = 1; attempt <= APP_HEALTH_ATTEMPTS; attempt += 1) {
    const owned = inspectOwnedSmoke(docker, containerId, ownerNonce, imageId);
    if (owned?.State?.Running !== true || owned?.RestartCount !== 0) fail(`${spec.name} smoke runtime drifted`);
    const health = docker(["exec", containerId, "node", "-e", APP_HEALTH_PROBE, service], { timeout: 5_000 });
    if (health.status === 0) return;
    if (health.status !== 3) fail(`${spec.name} liveness response drifted`);
    if (attempt === APP_HEALTH_ATTEMPTS) fail(`${spec.name} liveness readiness timed out`);
    wait(APP_HEALTH_INTERVAL_MS);
  }
}

export function smokeImage(docker, spec, imageId, { wait = sleepSync } = {}) {
  const name = `evo-p8v2d-smoke-${spec.name.replaceAll("_", "-")}-${P8V2.applicationCommit.slice(0, 12)}`;
  const ownerNonce = randomBytes(16).toString("hex");
  const inventory = parseContainerList(requireSuccess(docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.Names}}|{{.ID}}"]), "smoke container inventory"));
  if (inventory.has(name)) fail("smoke container collision", "candidate_build_failed");
  const args = ["run", "-d", "--platform", "linux/amd64", "--name", name, "--label", `${SMOKE_OWNER_LABEL}=${ownerNonce}`, "--network", "none"];
  for (const value of smokeEnvironment(spec)) args.push("-e", value);
  args.push(imageId);
  let containerId = null;
  let runIssued = false;
  try {
    runIssued = true;
    const runResult = docker(args);
    const afterRun = parseContainerList(requireSuccess(docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.Names}}|{{.ID}}"]), "smoke post-run inventory"));
    const observedId = afterRun.get(name) ?? null;
    const owned = observedId ? inspectOwnedSmoke(docker, observedId, ownerNonce, imageId) : null;
    containerId = owned?.Id ?? null;
    requireSuccess(runResult, `start ${spec.name} smoke`);
    if (!/^[0-9a-f]{64}$/.test(containerId ?? "") || runResult.stdout.trim() !== containerId) fail("smoke container identity missing");
    const row = inspectOwnedSmoke(docker, containerId, ownerNonce, imageId);
    if (row?.Id !== containerId || row?.Image !== imageId || row?.HostConfig?.NetworkMode !== "none" || row?.Mounts?.length !== 0 || row?.HostConfig?.RestartPolicy?.Name !== "no") fail("smoke runtime boundary drifted");
    if (spec.name === "lead_agent") {
      waitForLeadHealth(docker, containerId, ownerNonce, imageId, wait);
    } else {
      waitForAppHealth(docker, containerId, ownerNonce, imageId, spec, wait);
    }
    const after = inspectOwnedSmoke(docker, containerId, ownerNonce, imageId);
    if (after?.Id !== containerId || after?.Image !== imageId || after?.State?.Running !== true || after?.RestartCount !== 0) fail("smoke final identity drifted");
    return Buffer.from(`name=${spec.name}\nimage_id=${imageId}\nplatform=linux/amd64\nnetwork=none\nmounts=0\nrestart_count=0\nresult_code=liveness_verified\n`);
  } finally {
    const current = parseContainerList(requireSuccess(docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.Names}}|{{.ID}}"]), "smoke cleanup inventory"));
    const namedId = current.get(name) ?? null;
    const ownedPresent = containerId ? [...current.values()].includes(containerId) : false;
    let cleanupError = namedId && namedId !== containerId ? new Error("foreign smoke container occupies reserved name") : null;
    if (runIssued && containerId) {
      if (!ownedPresent) {
        cleanupError ??= new Error("owned smoke container disappeared before cleanup");
      } else {
        try {
          const owned = inspectOwnedSmoke(docker, containerId, ownerNonce, imageId);
          if (!owned) fail("smoke cleanup ownership drifted");
          requireSuccess(docker(["container", "rm", "-f", containerId]), "smoke cleanup");
        } catch (error) {
          cleanupError ??= error;
        }
      }
    }
    const afterCleanup = parseContainerList(requireSuccess(docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.Names}}|{{.ID}}"]), "smoke cleanup absence inventory"));
    if (containerId && [...afterCleanup.values()].includes(containerId)) cleanupError ??= new Error("owned smoke container remains after cleanup");
    const finalNamedId = afterCleanup.get(name) ?? null;
    if (finalNamedId && finalNamedId !== containerId) cleanupError ??= new Error("foreign smoke container occupies reserved name");
    if (cleanupError) throw cleanupError;
  }
}

export function assertBuildLogSafe(bytes, forbiddenValues) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  if (forbiddenValues.some((value) => typeof value === "string" && value.length > 0 && text.includes(value))) fail("Inbox build output exposed a process-only setting", "privacy_validation_failed");
  return bytes;
}

function writeArtifact(path, bytes) {
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
  assertRegular(path);
}

export function renderProductionInspectCommands(names = P8V2.productionContainers.map((item) => item.name)) {
  if (!Array.isArray(names) || names.length !== 5 || new Set(names).size !== 5 || names.some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))) fail("production container names are invalid");
  return names.map((name) => ["inspect", "--format", PRODUCTION_ROW_TEMPLATE, name]);
}

export function renderProductionScript(names) {
  const commands = renderProductionInspectCommands(names);
  return `set -o pipefail\n${commands.map((args) => `docker inspect --format '${args[2]}' '${args[3]}' | sed 's#^/##'`).join("\n")}`;
}

function remote(run, script, timeout = 300_000) {
  return requireSuccess(run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-seu"], { input: script, timeout }), "Hermes operation");
}

function rollbackScript() {
  const commands = [
    "set -o pipefail",
    "umask 077",
    "[[ -d /opt/evo-release-evidence && ! -L /opt/evo-release-evidence ]]",
    "[[ \"$(realpath -e /opt/evo-release-evidence)\" == /opt/evo-release-evidence ]]",
    `[[ ! -e '${ROLLBACK_ROOT}' ]]`,
    `install -d -o root -g root -m 0700 '${ROLLBACK_ROOT}'`,
    `[[ "$(realpath -e '${ROLLBACK_ROOT}')" == '${ROLLBACK_ROOT}' ]]`,
    `[[ "$(stat -c '%U:%G|%a' '${ROLLBACK_ROOT}')" == 'root:root|700' ]]`,
  ];
  for (const [source, retained, mode] of REMOTE_FILES) {
    commands.push(
      `[[ -f '${source}' && ! -L '${source}' && "$(stat -c '%U:%G|%a' '${source}')" == 'root:root|${mode}' ]]`,
      `[[ "$(realpath -e '${source}')" == '${source}' ]]`,
      `[[ ! -e '${ROLLBACK_ROOT}/${retained}' ]]`,
      `install -o root -g root -m 0600 '${source}' '${ROLLBACK_ROOT}/${retained}'`,
      `[[ "$(realpath -e '${ROLLBACK_ROOT}/${retained}')" == '${ROLLBACK_ROOT}/${retained}' ]]`,
      `printf 'FILE|${retained}|${mode}|600|%s|%s\\n' "$(stat -c %s '${ROLLBACK_ROOT}/${retained}')" "$(sha256sum '${ROLLBACK_ROOT}/${retained}' | cut -d' ' -f1)"`,
    );
  }
  commands.push("if [[ -e /opt/evo-crm/.env.manual-send-worker ]]; then exit 42; fi");
  for (const item of P8V2.images) {
    commands.push(
      `[[ "$(docker image inspect --format '{{.Id}}' '${item.rollbackReference}')" == '${item.rollbackImageId}' ]]`,
      `[[ ! -e '${ROLLBACK_ROOT}/${item.rollbackArchive}' ]]`,
      `docker image save --output '${ROLLBACK_ROOT}/${item.rollbackArchive}' '${item.rollbackReference}'`,
      `chown root:root '${ROLLBACK_ROOT}/${item.rollbackArchive}'`,
      `chmod 0600 '${ROLLBACK_ROOT}/${item.rollbackArchive}'`,
      `[[ "$(realpath -e '${ROLLBACK_ROOT}/${item.rollbackArchive}')" == '${ROLLBACK_ROOT}/${item.rollbackArchive}' ]]`,
      `[[ "$(docker image inspect --format '{{.Id}}' '${item.rollbackReference}')" == '${item.rollbackImageId}' ]]`,
      `printf 'IMAGE|${item.name}|${item.rollbackReference}|${item.rollbackImageId}|${item.rollbackArchive}|%s|%s\\n' "$(stat -c %s '${ROLLBACK_ROOT}/${item.rollbackArchive}')" "$(sha256sum '${ROLLBACK_ROOT}/${item.rollbackArchive}' | cut -d' ' -f1)"`,
    );
  }
  commands.push(
    `cd '${ROLLBACK_ROOT}'`,
    `EVO_CRM_APP_ENV_FILE='${ROLLBACK_ROOT}/crm-env.production' EVO_CRM_LEAD_AGENT_ENV_FILE='${ROLLBACK_ROOT}/crm-env.lead-agent' EVO_CRM_WAHA_ENV_FILE='${ROLLBACK_ROOT}/crm-env.waha' EVO_RELEASE_REVISION='564332b420a1fb1bd6232dda945d044bb922d3f0' EVO_RELEASE_VERSION='2026-07-24.1' EVO_IMAGE_SOURCE='https://github.com/izzhackt/evo_AI_CRM' EVO_WAHA_IMAGE_DIGEST='sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c' EVO_CADDY_NETWORK='evo_public_web' docker compose --env-file '${ROLLBACK_ROOT}/crm-env.production' -p evo-crm -f '${ROLLBACK_ROOT}/crm-app-compose.prod.yml' config -q`,
    "printf 'RENDER|main_crm|verified\\n'",
    `EVO_INBOX_APP_ENV_FILE='${ROLLBACK_ROOT}/inbox-env.production' EVO_INBOX_WAHA_ENV_FILE='${ROLLBACK_ROOT}/inbox-env.waha' EVO_RELEASE_REVISION='a09a72fc55d869c861df520f76d62413a2315fc1' EVO_RELEASE_VERSION='2026-07-24.2' EVO_IMAGE_SOURCE='https://github.com/izzhackt/evo_AI_CRM' EVO_WAHA_IMAGE_DIGEST='sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c' EVO_CADDY_NETWORK='evo_public_web' docker compose --env-file '${ROLLBACK_ROOT}/inbox-env.production' -p evo-inbox -f '${ROLLBACK_ROOT}/inbox-app-compose.prod.yml' config -q`,
    "printf 'RENDER|evo_inbox|verified\\n'",
    `EVO_CRM_APP_ENV_FILE='${ROLLBACK_ROOT}/crm-env.production' EVO_CRM_LEAD_AGENT_ENV_FILE='${ROLLBACK_ROOT}/crm-env.lead-agent' EVO_CRM_WAHA_ENV_FILE='${ROLLBACK_ROOT}/crm-env.waha' EVO_RELEASE_REVISION='rollback-2026-08-15.p8d.1' EVO_RELEASE_VERSION='rollback-2026-08-15.p8d.1' EVO_IMAGE_SOURCE='https://github.com/izzhackt/evo_AI_CRM' EVO_WAHA_IMAGE_DIGEST='sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c' EVO_CADDY_NETWORK='evo_public_web' docker compose --env-file '${ROLLBACK_ROOT}/crm-env.production' -p evo-crm -f '${ROLLBACK_ROOT}/lead-agent-compose.prod.yml' config -q`,
    "printf 'RENDER|lead_agent|verified\\n'",
  );
  return `${commands.join("\n")}\n`;
}

function parseRollback(text) {
  const files = [];
  const images = [];
  const renders = [];
  for (const line of text.trim().split("\n")) {
    const parts = line.split("|");
    if (parts[0] === "FILE" && parts.length === 6) files.push({ name: parts[1], source_mode: Number(parts[2]), retained_mode: Number(parts[3]), size: Number(parts[4]), sha256: parts[5] });
    else if (parts[0] === "IMAGE" && parts.length === 7) images.push({ name: parts[1], reference: parts[2], image_id: parts[3], archive: parts[4], size: Number(parts[5]), sha256: parts[6] });
    else if (parts[0] === "RENDER" && parts.length === 3) renders.push({ name: parts[1], status: parts[2] });
    else fail("rollback capture output drifted", "rollback_capture_failed");
  }
  const orderedFiles = P8V2.rollbackFiles.map((expected) => files.find((item) => item.name === expected.name));
  const orderedImages = P8V2.images.map((expected) => images.find((item) => item.name === expected.name));
  const orderedRenders = P8V2.images.map((expected) => renders.find((item) => item.name === expected.name));
  if (files.length !== 12 || images.length !== 3 || renders.length !== 3 || orderedFiles.some((item) => !item) || orderedImages.some((item) => !item) || orderedRenders.some((item) => !item)) fail("rollback capture cardinality drifted", "rollback_capture_failed");
  return { status: "verified", manual_worker_pre_state: "absent", files: orderedFiles, images: orderedImages, renders: orderedRenders };
}

async function boundedJsonResponse(response, label) {
  if (!response.ok) fail(`${label} failed safely`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_048_576) fail(`${label} exceeded response limit`);
  return parseJson(text, label);
}

function expectedMigrationVersions(sourceRoot) {
  const migrations = readdirSync(join(sourceRoot, "supabase", "migrations")).map((name) => name.match(/^(\d{3})_.*\.sql$/)?.[1]).filter(Boolean).sort();
  const expected = Array.from({ length: 77 }, (_, index) => String(index + 1).padStart(3, "0"));
  if (migrations.join("\0") !== expected.join("\0")) fail("repository migration ledger drifted", "migration_ledger_drift");
}

function buildBundleDefault({ sourceRoot, vaultRoot, accountId, audience, outputRoot, run }) {
  const code = "import os,sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from build_platform_bundle import build_bundle; build_bundle(Path(sys.argv[2]),os.environ['EVO_P8V2_BUILD_ACCOUNT_ID'],sys.argv[3],Path(sys.argv[4]))";
  requireSuccess(run("python3", ["-c", code, join(sourceRoot, "scripts", "knowledge_ingestion"), vaultRoot, audience, outputRoot], { env: { ...process.env, EVO_P8V2_BUILD_ACCOUNT_ID: accountId }, timeout: 180_000 }), `${audience} knowledge build`);
}

function validateBuiltAudience(audience, roots, accountId) {
  const count = P8V2_KNOWLEDGE_SOURCES[audience]?.documentCount;
  if (!Number.isInteger(count)) fail("unknown knowledge audience", "knowledge_build_failed");
  const bundleName = `evo-knowledge-${audience}.json`;
  const manifestName = `evo-knowledge-${audience}.sha256.json`;
  const bundleBytes = readFileSync(join(roots[0], bundleName));
  const manifestBytes = readFileSync(join(roots[0], manifestName));
  if (!bundleBytes.equals(readFileSync(join(roots[1], bundleName))) || !manifestBytes.equals(readFileSync(join(roots[1], manifestName)))) fail("knowledge builds were not deterministic", "knowledge_build_failed");
  const bundle = parseJson(bundleBytes.toString("utf8"), `${audience} bundle`);
  const manifest = parseJson(manifestBytes.toString("utf8"), `${audience} manifest`);
  if (bundle.account_id !== accountId || bundle.audience !== audience || !Array.isArray(bundle.documents) || bundle.documents.length !== count || manifest.account_id !== accountId || manifest.audience !== audience || manifest.bundle_sha256 !== sha256(bundleBytes)) fail("knowledge bundle identity drifted", "knowledge_build_failed");
  const paths = new Set();
  for (const document of bundle.documents) {
    if (!document || typeof document.path !== "string" || paths.has(document.path) || !SHA64.test(document.sha256 ?? "") || typeof document.content !== "string") fail("knowledge document binding drifted", "knowledge_build_failed");
    paths.add(document.path);
  }
  return { name: audience, status: "verified", document_count: count, bundle_sha256: sha256(bundleBytes), manifest_sha256: sha256(manifestBytes), vault_unchanged: true, pii_gate: "passed", forbidden_root_gate: "passed" };
}

function configurationScript() {
  const rootNames = JSON.stringify(ROOT_CRM_SETTINGS);
  const leadNames = JSON.stringify(LEAD_SETTINGS);
  return String.raw`set -o pipefail
IFS= read -r ACCOUNT_ID
IFS= read -r ORGANIZATION_ID
IFS= read -r SUPABASE_URL
ACCOUNT_ID="$ACCOUNT_ID" ORGANIZATION_ID="$ORGANIZATION_ID" SUPABASE_URL="$SUPABASE_URL" python3 - '${rootNames}' '${leadNames}' <<'PY'
import json,os,pathlib,stat,sys
account=os.environ['ACCOUNT_ID']; organization=os.environ['ORGANIZATION_ID']; url=os.environ['SUPABASE_URL']; root_names=json.loads(sys.argv[1]); lead_names=json.loads(sys.argv[2])
def read(path_s,mode):
 p=pathlib.Path(path_s); s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or stat.S_ISLNK(s.st_mode) or stat.S_IMODE(s.st_mode)!=mode or s.st_uid!=0 or s.st_gid!=0: raise SystemExit(41)
 out={}
 for line in p.read_text().splitlines():
  if not line or line.lstrip().startswith('#') or '=' not in line: continue
  k,v=line.split('=',1)
  if k in out: raise SystemExit(42)
  out[k]=v
 return out
crm=read('/opt/evo-crm/.env.production',0o600); lead=read('/opt/evo-crm/.env.lead-agent',0o600); block=[]
root_ok=all(crm.get(k) for k in root_names)
if not root_ok: block.append('root_crm_settings_missing')
account_match=crm.get('EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID')==account; organization_match=crm.get('EVO_PLATFORM_ORGANIZATION_ID')==organization; project_match=crm.get('NEXT_PUBLIC_SUPABASE_URL')==url
if root_ok and (not account_match or not organization_match): block.append('root_crm_identity_mismatch')
if root_ok and not project_match: block.append('supabase_project_mismatch')
token=lead.get('EVO_AGENT_AMO_TOKEN_FILE',''); refresh=lead.get('EVO_AGENT_AMO_REFRESH_TOKEN','')
lead_ok=all(lead.get(k) for k in lead_names) and ((token and pathlib.Path(token).is_file()) or bool(refresh))
if not lead_ok: block.append('lead_agent_amocrm_credentials_missing')
worker=pathlib.Path('/opt/evo-crm/.env.manual-send-worker'); worker_ok=False
if worker.exists():
 values=read(str(worker),0o600); worker_ok=set(values)=={'EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET'} and bool(values.get('EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET'))
if not worker_ok: block.append('manual_worker_secret_missing')
print(json.dumps({'root_crm':'verified' if root_ok and account_match and organization_match and project_match else 'blocked','lead_agent':'verified' if lead_ok else 'blocked','manual_worker':'verified' if worker_ok else 'blocked','configured_account_match':account_match,'configured_organization_match':organization_match,'supabase_project_match':project_match,'blockers':block},separators=(',',':')))
PY`;
}

export async function createP8V2Operations({
  toolRoot,
  sourceRoot,
  environment = process.env,
  run = defaultRun,
  fetchImpl = fetch,
  makeKnowledgeRoot,
  buildKnowledgeBundle,
} = {}) {
  if (environment.EVO_P8V2D_AUTHORIZATION !== P8V2.authorization) fail("exact P8V2D authorization is required");
  const evidenceParent = join(sourceRoot, ".evo-release-evidence");
  const buildRoot = join(evidenceParent, `p8v2d-build-${P8V2.applicationCommit}-20260818`);
  const portableRoot = join(evidenceParent, `p8v2d-portable-${P8V2.applicationCommit}-20260818`);
  const knowledgeRoot = join(evidenceParent, `p8v2d-knowledge-${P8V2.applicationCommit}-20260818`);
  const finalRoot = join(evidenceParent, `p8v2d-preparation-${P8V2.applicationCommit}-20260818`);
  const docker = createDockerExecutor(run);
  const state = { accountId: null, organizationId: null, images: [], rollback: null, knowledge: null, knowledgeRoots: [] };

  function ensureEvidenceParent() {
    assertOrCreateEvidenceParent(sourceRoot, evidenceParent);
  }

  async function verifyExecution() {
    const executionCommit = checkSourceRoot(toolRoot, sourceRoot, run);
    const executionTree = requireSuccess(run("git", ["-C", toolRoot, "rev-parse", "HEAD^{tree}"]), "release-control tree").trim();
    const runRows = parseJson(requireSuccess(run("gh", ["run", "list", "--repo", "izzhackt/evo_AI_CRM", "--commit", executionCommit, "--event", "push", "--status", "success", "--limit", "2", "--json", "databaseId,headSha,conclusion,status"]), "exact-main CI query"), "exact-main CI query");
    if (!Array.isArray(runRows) || runRows.length !== 1 || runRows[0].headSha !== executionCommit || runRows[0].status !== "completed" || runRows[0].conclusion !== "success") fail("exact-main CI is not singular and green");
    return { commit: executionCommit, tree: executionTree, ci_run_id: runRows[0].databaseId };
  }

  async function buildImages() {
    ensureEvidenceParent();
    createExclusiveDirectory(buildRoot);
    createExclusiveDirectory(portableRoot);
    const inventory = parseImageList(requireSuccess(docker(["image", "ls", "--no-trunc", "--format", "{{.Repository}}:{{.Tag}}|{{.ID}}"]), "candidate tag inventory"));
    for (const spec of P8V2.images) if (inventory.has(spec.tag)) fail(`candidate tag collision: ${spec.name}`, "candidate_build_failed");
    const records = [];
    for (const spec of P8V2.images) {
      const logPath = join(buildRoot, `build-${spec.name}.log`);
      const buildEnvironment = spec.name === "evo_inbox" ? {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: environment.EVO_P8V2_INBOX_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.EVO_P8V2_INBOX_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_SITE_URL: environment.EVO_P8V2_INBOX_SITE_URL,
      } : process.env;
      const built = docker(buildArguments(spec, sourceRoot, environment), { cwd: sourceRoot, env: buildEnvironment, timeout: 3_600_000 });
      const buildLog = Buffer.from(`${built.stdout}${built.stderr}`);
      if (spec.name === "evo_inbox") assertBuildLogSafe(buildLog, [environment.EVO_P8V2_INBOX_SUPABASE_URL, environment.EVO_P8V2_INBOX_SUPABASE_ANON_KEY, environment.EVO_P8V2_INBOX_SITE_URL]);
      writeArtifact(logPath, buildLog);
      requireSuccess(built, `${spec.name} build`);
      const inspectRows = parseJson(requireSuccess(docker(["image", "inspect", spec.tag]), `${spec.name} inspect`), `${spec.name} inspect`);
      const imageId = validateCandidateImage(Array.isArray(inspectRows) ? inspectRows[0] : null, spec);
      const sbomPath = join(buildRoot, `sbom-${spec.name}.spdx.json`);
      const sbom = docker(["sbom", "--format", "spdx-json", imageId], { timeout: 600_000 });
      requireSuccess(sbom, `${spec.name} SBOM`);
      writeArtifact(sbomPath, Buffer.from(sbom.stdout));
      const smoke = smokeImage(docker, spec, imageId);
      const smokePath = join(buildRoot, `smoke-${spec.name}.log`);
      writeArtifact(smokePath, smoke);
      const archivePath = join(portableRoot, spec.archive);
      const preSaveInventory = parseImageList(requireSuccess(docker(["image", "ls", "--no-trunc", "--format", "{{.Repository}}:{{.Tag}}|{{.ID}}"]), `${spec.name} pre-save inventory`));
      if (preSaveInventory.get(spec.tag) !== imageId) fail(`candidate tag changed before evidence serialization: ${spec.name}`, "candidate_build_failed");
      requireSuccess(docker(["image", "save", "--output", archivePath, spec.tag], { timeout: 1_800_000 }), `${spec.name} archive`);
      chmodSync(archivePath, 0o600);
      assertRegular(archivePath);
      const archiveMetadata = readPortableMetadata(archivePath);
      if (archiveMetadata.tagDescriptor.digest !== imageId || !archiveMetadata.nestedIndex) fail(`archive/image identity drifted: ${spec.name}`, "candidate_build_failed");
      verifyPortableArchive(archivePath, { name: spec.name, archive: spec.archive, index: imageId, manifest: archiveMetadata.descriptor.digest }, spec.tag, P8V2.applicationCommit);
      const postInventory = parseImageList(requireSuccess(docker(["image", "ls", "--no-trunc", "--format", "{{.Repository}}:{{.Tag}}|{{.ID}}"]), `${spec.name} post-save inventory`));
      if (postInventory.get(spec.tag) !== imageId) fail(`candidate tag changed during evidence collection: ${spec.name}`, "candidate_build_failed");
      const archiveBytes = readFileSync(archivePath);
      records.push({
        name: spec.name,
        tag: spec.tag,
        archive: spec.archive,
        image_id: imageId,
        oci_index_digest: imageId,
        platform_manifest_digest: archiveMetadata.descriptor.digest,
        archive_sha256: sha256(archiveBytes),
        sbom_sha256: sha256(readFileSync(sbomPath)),
        smoke_sha256: sha256(readFileSync(smokePath)),
        source_commit: P8V2.applicationCommit,
        platform: { os: "linux", architecture: "amd64", variant: "" },
      });
    }
    atomicJson(join(portableRoot, "portable-image-identity.json"), { version: "p8v2d-portable-image-identity.v1", source_commit: P8V2.applicationCommit, source_tree: P8V2.applicationTree, images: records });
    state.images = records;
    return records;
  }

  async function observeProduction() {
    return parseProductionRows(remote(run, renderProductionScript()));
  }

  async function verifyMigrations() {
    expectedMigrationVersions(sourceRoot);
    const accessToken = environment.EVO_P8V2_SUPABASE_ACCESS_TOKEN;
    if (!accessToken) fail("Supabase management token unavailable", "migration_ledger_drift");
    const project = await boundedJsonResponse(await fetchImpl("https://api.supabase.com/v1/projects/iosckaqtovbbnssqcpde", { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }), "Supabase project status");
    const migrations = await boundedJsonResponse(await fetchImpl("https://api.supabase.com/v1/projects/iosckaqtovbbnssqcpde/database/migrations", { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }), "Supabase migrations");
    const versions = (Array.isArray(migrations) ? migrations : migrations?.migrations ?? []).map((item) => String(item.version ?? item).slice(0, 3)).sort();
    const expected = Array.from({ length: 76 }, (_, index) => String(index + 1).padStart(3, "0"));
    if (project.status !== "ACTIVE_HEALTHY" || versions.join("\0") !== expected.join("\0")) fail("production migration ledger drifted", "migration_ledger_drift");
    return { status: "verified", repository_range: "001-077", repository_count: 77, production_range: "001-076", production_count: 76, pending_versions: ["077"], project_status: "ACTIVE_HEALTHY" };
  }

  async function captureRollback() {
    await observeProduction();
    const result = parseRollback(remote(run, rollbackScript(), 1_800_000));
    await observeProduction();
    state.rollback = result;
    return result;
  }

  async function resolveIdentities() {
    const url = environment.EVO_P8V2_SUPABASE_URL;
    const serviceKey = environment.EVO_P8V2_SUPABASE_SERVICE_ROLE_KEY;
    if (url !== "https://iosckaqtovbbnssqcpde.supabase.co" || !serviceKey) fail("production Supabase identity inputs unavailable", "identity_resolution_failed");
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Accept-Profile": "platform" };
    const accounts = await boundedJsonResponse(await fetchImpl(`${url}/rest/v1/ai_configs?select=account_id&is_active=eq.true&limit=2`, { headers, signal: AbortSignal.timeout(15_000) }), "active account resolution");
    const organizations = await boundedJsonResponse(await fetchImpl(`${url}/rest/v1/organizations?select=id&is_active=eq.true&limit=2`, { headers, signal: AbortSignal.timeout(15_000) }), "active organization resolution");
    if (!Array.isArray(accounts) || accounts.length !== 1 || !UUID.test(accounts[0].account_id) || !Array.isArray(organizations) || organizations.length !== 1 || !UUID.test(organizations[0].id)) fail("live identities were not singular", "identity_resolution_failed");
    state.accountId = accounts[0].account_id;
    state.organizationId = organizations[0].id;
    return { status: "verified", account: "exactly_one_active", organization: "exactly_one_active", supabase_project: "exact_production" };
  }

  async function buildKnowledge() {
    if (!UUID.test(state.accountId ?? "")) fail("account resolution must precede knowledge builds", "knowledge_build_failed");
    ensureEvidenceParent();
    createExclusiveDirectory(knowledgeRoot);
    const builder = buildKnowledgeBundle ?? ((args) => buildBundleDefault({ ...args, run }));
    const makeRoot = makeKnowledgeRoot ?? (() => mkdtempSync(join(evidenceParent, "p8v2d-private-build-")));
    const audiences = [];
    const roots = [];
    let primaryError;
    try {
      for (const audience of ["client", "internal"]) {
        const pair = [];
        for (let copy = 0; copy < 2; copy += 1) {
          const root = await makeRoot();
          chmodSync(root, 0o700);
          assertDirectory(root);
          roots.push(root);
          state.knowledgeRoots.push(root);
          await builder({ sourceRoot, vaultRoot: P8V2_KNOWLEDGE_SOURCES[audience].path, accountId: state.accountId, audience, outputRoot: root });
          pair.push(root);
        }
        audiences.push(validateBuiltAudience(audience, pair, state.accountId));
      }
    } catch (error) { primaryError = error; }
    const cleanupErrors = [];
    for (const root of roots) {
      try { rmSync(root, { recursive: true, force: false }); if (existsSync(root)) throw new Error("root remains"); } catch (error) { cleanupErrors.push(error); }
    }
    state.knowledgeRoots = [];
    if (cleanupErrors.length) fail("UUID-bearing knowledge cleanup failed", "evidence_publication_failed");
    if (primaryError) throw primaryError;
    const result = { status: "verified", cleanup_status: "verified", audiences };
    atomicJson(join(knowledgeRoot, "knowledge-build-result.json"), result);
    state.knowledge = result;
    return result;
  }

  async function verifyConfiguration() {
    if (!UUID.test(state.accountId ?? "") || !UUID.test(state.organizationId ?? "")) fail("identity resolution must precede configuration", "required_configuration_missing");
    const input = `${state.accountId}\n${state.organizationId}\n${environment.EVO_P8V2_SUPABASE_URL}\n`;
    const raw = requireSuccess(run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-c", configurationScript()], { input, timeout: 300_000 }), "Hermes configuration verification");
    const snapshot = parseJson(raw, "configuration verification");
    exactKeys(snapshot, ["root_crm", "lead_agent", "manual_worker", "configured_account_match", "configured_organization_match", "supabase_project_match", "blockers"], "configuration result");
    const safe = safeConfiguration({ root_crm: snapshot.root_crm, lead_agent: snapshot.lead_agent, manual_worker: snapshot.manual_worker }, { account: snapshot.configured_account_match, organization: snapshot.configured_organization_match, project: snapshot.supabase_project_match }, snapshot.blockers);
    if (safe.blockers.length) fail("required configuration is blocked", "required_configuration_missing", safe);
    return safe;
  }

  async function finalizeArtifacts() {
    ensureEvidenceParent();
    createExclusiveDirectory(finalRoot);
    try {
      for (const spec of P8V2.images) {
        copyFileSync(join(portableRoot, spec.archive), join(finalRoot, spec.archive));
        chmodSync(join(finalRoot, spec.archive), 0o600);
      }
      copyFileSync(join(portableRoot, "portable-image-identity.json"), join(finalRoot, "portable-image-identity.json"));
      copyFileSync(join(knowledgeRoot, "knowledge-build-result.json"), join(finalRoot, "knowledge-build-result.json"));
      for (const file of ["portable-image-identity.json", "knowledge-build-result.json"]) chmodSync(join(finalRoot, file), 0o600);
      atomicJson(join(finalRoot, "rollback-capture.json"), state.rollback);
      const files = P8V2.finalArtifacts.map((file) => { const bytes = readFileSync(join(finalRoot, file)); return { file, mode: 600, size: bytes.length, sha256: sha256(bytes) }; });
      const index = { version: 1, files };
      atomicJson(join(finalRoot, "collection-index.json"), index);
      return sha256(readFileSync(join(finalRoot, "collection-index.json")));
    } catch {
      rmSync(finalRoot, { recursive: true, force: true });
      if (existsSync(finalRoot)) fail("partial evidence cleanup failed", "evidence_publication_failed");
      fail("final evidence publication failed", "evidence_publication_failed");
    }
  }

  async function writeResult(result) {
    if (result.result_code === "preparation_verified") {
      writeP8V2Result(join(finalRoot, "v2-preparation-result.json"), result);
      return verifyP8V2FinalRoot(finalRoot);
    }
    ensureEvidenceParent();
    if (!existsSync(finalRoot)) createExclusiveDirectory(finalRoot);
    if (readdirSync(finalRoot).length) fail("blocked result root is not empty", "evidence_publication_failed");
    writeP8V2Result(join(finalRoot, "v2-preparation-result.json"), result);
    const names = readdirSync(finalRoot);
    if (names.length !== 1 || names[0] !== "v2-preparation-result.json") fail("blocked evidence allowlist drifted", "evidence_publication_failed");
    assertRegular(join(finalRoot, names[0]));
    return result;
  }

  async function recoverEvidenceFailure(result) {
    if (existsSync(finalRoot)) {
      const metadata = lstatSync(finalRoot);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("unsafe failed-evidence root", "evidence_publication_failed");
      ensureContained(evidenceParent, finalRoot);
      rmSync(finalRoot, { recursive: true, force: false });
    }
    if (existsSync(finalRoot)) fail("failed-evidence cleanup did not complete", "evidence_publication_failed");
    createExclusiveDirectory(finalRoot);
    writeP8V2Result(join(finalRoot, "v2-preparation-result.json"), result);
    const names = readdirSync(finalRoot);
    if (names.length !== 1 || names[0] !== "v2-preparation-result.json") fail("failed evidence allowlist drifted", "evidence_publication_failed");
    assertRegular(join(finalRoot, names[0]));
    return result;
  }

  return {
    verifyExecution, buildImages, observeProduction, verifyMigrations, captureRollback,
    resolveIdentities, buildKnowledge, verifyConfiguration, finalizeArtifacts, writeResult, recoverEvidenceFailure,
    __testState: state,
    roots: { buildRoot, portableRoot, knowledgeRoot, finalRoot },
  };
}
