#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CANDIDATE = "aaa9f618131f604f79c694e4b332a0b13afd7a30";
const PROJECT_REF = "iosckaqtovbbnssqcpde";
const RELEASE_ID = "2026-08-16.p8d4g.1";
const RELEASE_VERSION = "p8d4g-20260816";
const PILOT_ORIGIN = "https://evo-inbox.72.62.119.112.sslip.io";
const WAHA_DIGEST = "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c";
const HERMES = "hermes-vps";
const LOCAL_SOURCE = "/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4f-source-aaa9";
const EXECUTION_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const EXECUTION_CONTROL = join(EXECUTION_ROOT, "docs/evidence/p8d4g-execution-control.json");
const PORTABLE_ROOT = `${LOCAL_SOURCE}/.evo-release-evidence/p8d4f-${CANDIDATE}-reviewed`;
const CREDENTIAL_FILE = "/Users/iskhak.tazhibaev/Documents/01_Projects/evo_AI_CRM/agent-lead2-inbox/.env.vps-handoff";
const CLIENT_VAULT = "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО";
const INTERNAL_VAULT = "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ";
const RELEASE_ROOT = `/opt/evo-releases/${CANDIDATE}/${RELEASE_ID}`;
const ROLLBACK_ROOT = `/opt/evo-release-rollback/${RELEASE_ID}`;
const EVIDENCE_ROOT = `/opt/evo-release-evidence/${CANDIDATE}/${RELEASE_ID}`;
const KNOWLEDGE_REMOTE = `${RELEASE_ROOT}/knowledge-incoming`;
const IMPORTER = "evo-p8d4-knowledge-import";
const PORTABLE_IDENTITY = "portable-image-identity.json";
const PORTABLE_IDENTITY_SHA256 = "53fa00c63338a55925fa8d2c8d6e6faaa61d63b0f99251e50dabafd792755ccd";
const REMOTE_RESULT = `${EVIDENCE_ROOT}/p8d4g-result.json`;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OUTPUT = 1_000_000;
const CONTROLLED_FILES = Object.freeze([
  "scripts/p8d4g-production-runner.mjs",
  "scripts/p8d4g-production-operations.mjs",
  "docs/schemas/p8d4g-result.schema.json",
  "docs/schemas/p8d4g-execution-control.schema.json",
  "package.json",
]);

const IMAGES = Object.freeze({
  crm: Object.freeze({
    tag: `evo-crm:${CANDIDATE}-linux-amd64`,
    composeTag: `evo-crm:${CANDIDATE}`,
    id: "sha256:3174e8e35f27ca3983e971d6f4b94b6863a5b64a9ffd751042b3db5ed2f8c55a",
    archive: `evo-crm-${CANDIDATE}-linux-amd64.tar`,
    archiveSha256: "07c9341c0aeae456b2bd51ae66a8f0ba81645e49f064a212cdc1485df0db50b1",
  }),
  inbox: Object.freeze({
    tag: `evo-inbox:${CANDIDATE}-linux-amd64`,
    composeTag: `evo-inbox:${CANDIDATE}`,
    id: "sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca",
    archive: `evo-inbox-${CANDIDATE}-linux-amd64.tar`,
    archiveSha256: "6bbeadd9e7571db018e0d9932cddfd8f22503b0090c4a27467af9a071eef5a48",
  }),
  lead_agent: Object.freeze({
    tag: `evo-lead-agent:${CANDIDATE}-linux-amd64`,
    composeTag: `evo-lead-agent:${CANDIDATE}`,
    id: "sha256:9194b569df458a7a80792ca3f4aebfa417204961f229585178aa91c710d45c01",
    archive: `evo-lead-agent-${CANDIDATE}-linux-amd64.tar`,
    archiveSha256: "32b2937ef5bd2e23ae5c5b405242bade6e9af237165649f737d97a935c709063",
  }),
});

const CURRENT = Object.freeze({
  crm: Object.freeze({ container: "evo-crm-app-1", id: "sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580", revision: "564332b420a1fb1bd6232dda945d044bb922d3f0", archive: "prior-crm.tar" }),
  inbox: Object.freeze({ container: "evo-inbox-app-1", id: "sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b", revision: "a09a72fc55d869c861df520f76d62413a2315fc1", archive: "prior-inbox.tar" }),
  lead_agent: Object.freeze({ container: "evo-crm-lead-agent-1", id: "sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7", revision: "b2303eccb78b7c102ec702e9821f765f6dfaba88", archive: "prior-lead-agent.tar" }),
  crm_waha: Object.freeze({ container: "evo-crm-waha-1", id: WAHA_DIGEST }),
  inbox_waha: Object.freeze({ container: "evo-inbox-waha", id: WAHA_DIGEST }),
});

const ENV_FILES = Object.freeze({
  crm: "/opt/evo-crm/.env.production",
  lead_agent: "/opt/evo-crm/.env.lead-agent",
  inbox: "/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production",
  inbox_waha: "/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha",
});

const COMPOSE_FILES = Object.freeze({
  crm: "/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo/docker-compose.prod.yml",
  inbox: "/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
  lead_agent: "/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo/docker-compose.prod.yml",
});

const PILOTS = Object.freeze({
  client_china_documents: Object.freeze({
    audience: "client",
    path: "/api/ai/playground",
    question: "Какие документы нужно подготовить для поступления в университеты Китая?",
    source: "Страны/Китай/Документы для поступления — порядок уточнения.md",
  }),
  internal_malaysia_handoff: Object.freeze({
    audience: "internal",
    path: "/api/ai/internal-assistant",
    question: "Как отдел продаж должен передать студента по Малайзии в отдел зарубежного образования?",
    source: "Процессы/Передача студента из ОП в ОЗО по Малайзии — 68fe88af5a26.md",
  }),
});

export const P8D4G_PRODUCTION = Object.freeze({
  candidate: CANDIDATE,
  projectRef: PROJECT_REF,
  releaseId: RELEASE_ID,
  releaseRoot: RELEASE_ROOT,
  rollbackRoot: ROLLBACK_ROOT,
  evidenceRoot: EVIDENCE_ROOT,
  localSource: LOCAL_SOURCE,
  portableRoot: PORTABLE_ROOT,
  portableIdentity: Object.freeze({ filename: PORTABLE_IDENTITY, sha256: PORTABLE_IDENTITY_SHA256 }),
  remoteResult: REMOTE_RESULT,
  hermes: HERMES,
  images: IMAGES,
  current: CURRENT,
  envFiles: ENV_FILES,
  composeFiles: COMPOSE_FILES,
  pilotOrigin: PILOT_ORIGIN,
  pilots: PILOTS,
});

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`${label} has an invalid shape`);
}

function parseEnvFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) fail("credential file boundary is invalid");
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) fail("credential file contains an invalid assignment");
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function requireCredential(environment, credentials, names) {
  for (const name of names) {
    const value = environment[name] || credentials[name];
    if (value) return value;
  }
  fail(`required credential class is missing: ${names[0]}`);
}

function remainingMs(deadlineAt, ceiling = 20 * 60 * 1000) {
  if (!deadlineAt) fail("operation deadline is missing");
  const remaining = Date.parse(deadlineAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) fail("operation deadline expired");
  return Math.max(1, Math.min(remaining, ceiling));
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
    timeout: options.timeout,
  });
  if (result.error || result.signal || result.status !== 0) fail(`${options.label ?? command} failed safely`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function assertLocalFile(path, expectedHash = null, expectedMode = null) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("local artifact boundary is invalid");
  if (expectedMode !== null && (stat.mode & 0o777) !== expectedMode) fail("local artifact mode drifted");
  if (expectedHash !== null && sha256(readFileSync(path)) !== expectedHash) fail("local artifact hash drifted");
}

function greenCiRun(run, commit, explicitRun = null) {
  let runId = explicitRun;
  if (runId === null) {
    const listed = json(run("gh", ["run", "list", "--repo", "izzhackt/evo_AI_CRM", "--workflow", "EVO platform CI", "--commit", commit, "--event", "push", "--status", "success", "--json", "databaseId,headSha,conclusion", "--limit", "5"], { timeout: 30_000, label: "exact-main CI discovery" }).stdout, "exact-main CI discovery");
    const matching = listed.filter((item) => item.headSha === commit && item.conclusion === "success");
    if (matching.length !== 1) fail("exact-main CI identity is not singular");
    runId = matching[0].databaseId;
  }
  if (!Number.isInteger(runId) || runId < 1) fail("CI run identity is invalid");
  const record = json(run("gh", ["run", "view", String(runId), "--repo", "izzhackt/evo_AI_CRM", "--json", "databaseId,headSha,event,conclusion,jobs"], { timeout: 30_000, label: "exact-main CI verification" }).stdout, "exact-main CI verification");
  if (record.databaseId !== runId || record.headSha !== commit || record.event !== "push" || record.conclusion !== "success" || !Array.isArray(record.jobs)) fail("exact-main CI record drifted");
  const expected = new Map([["Main CRM", "success"], ["EVO Inbox", "success"], ["EVO Lead Agent", "success"], ["Changed range", "skipped"]]);
  for (const job of record.jobs) {
    if (expected.has(job.name) && (job.conclusion === expected.get(job.name) || (job.name === "Changed range" && job.conclusion === "success"))) expected.delete(job.name);
  }
  if (expected.size !== 0) fail("required exact-main checks are not green");
  return runId;
}

export function validateP8D4GExecutionControl(run = defaultRun, { executionRoot = EXECUTION_ROOT, controlPath = EXECUTION_CONTROL } = {}) {
  if (!existsSync(controlPath)) fail("P8D4G execution control is not merged");
  assertLocalFile(controlPath);
  const control = json(readFileSync(controlPath, "utf8"), "P8D4G execution control");
  exactKeys(control, ["schema_version", "implementation_commit", "implementation_tree", "implementation_ci_run", "files"], "P8D4G execution control");
  if (control.schema_version !== 1 || !/^[0-9a-f]{40}$/.test(control.implementation_commit) || !/^[0-9a-f]{40}$/.test(control.implementation_tree) || !Number.isInteger(control.implementation_ci_run) || !Array.isArray(control.files) || control.files.length !== CONTROLLED_FILES.length) fail("P8D4G execution control is invalid");
  const implementationTree = run("git", ["-C", executionRoot, "show", "-s", "--format=%T", control.implementation_commit], { timeout: 10_000, label: "implementation tree verification" }).stdout.trim();
  if (implementationTree !== control.implementation_tree) fail("implementation tree drifted");
  const observedFiles = control.files.map((item, index) => {
    exactKeys(item, ["path", "sha256"], `controlled file ${index}`);
    if (item.path !== CONTROLLED_FILES[index] || !SHA256.test(item.sha256)) fail("controlled file manifest drifted");
    const currentHash = sha256(readFileSync(join(executionRoot, item.path)));
    const committedBytes = run("git", ["-C", executionRoot, "show", `${control.implementation_commit}:${item.path}`], { timeout: 10_000, label: "implementation file verification" }).stdout;
    if (currentHash !== item.sha256 || sha256(Buffer.from(committedBytes)) !== item.sha256) fail("controlled runner bytes drifted");
    return { path: item.path, sha256: item.sha256 };
  });
  greenCiRun(run, control.implementation_commit, control.implementation_ci_run);
  if (run("git", ["-C", executionRoot, "status", "--porcelain", "--untracked-files=all"], { timeout: 10_000, label: "execution checkout cleanliness" }).stdout.trim()) fail("execution checkout is dirty");
  const executionCommit = run("git", ["-C", executionRoot, "rev-parse", "HEAD"], { timeout: 10_000, label: "execution commit" }).stdout.trim();
  const executionTree = run("git", ["-C", executionRoot, "show", "-s", "--format=%T", executionCommit], { timeout: 10_000, label: "execution tree" }).stdout.trim();
  const mainLine = run("git", ["-C", executionRoot, "ls-remote", "origin", "refs/heads/main"], { timeout: 30_000, label: "GitHub main identity" }).stdout.trim();
  if (mainLine.split(/\s+/)[0] !== executionCommit) fail("execution checkout is not current GitHub main");
  run("git", ["-C", executionRoot, "merge-base", "--is-ancestor", control.implementation_commit, executionCommit], { timeout: 10_000, label: "implementation ancestry" });
  const executionCiRun = greenCiRun(run, executionCommit);
  return { status: "verified", implementation_commit: control.implementation_commit, implementation_tree: control.implementation_tree, implementation_ci_run: control.implementation_ci_run, execution_commit: executionCommit, execution_tree: executionTree, execution_ci_run: executionCiRun, files: observedFiles };
}

function json(text, label) {
  if (Buffer.byteLength(text) > MAX_OUTPUT) fail(`${label} output is oversized`);
  try { return JSON.parse(text); } catch { fail(`${label} returned malformed JSON`); }
}

function remote(run, script, { input = "", deadlineAt, label = "Hermes operation" } = {}) {
  return run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-seu"], {
    input: `${script}\n${input}`,
    timeout: remainingMs(deadlineAt),
    label,
  });
}

function safeContainerRows(text) {
  const rows = text.trim().split("\n").filter(Boolean).map((line) => {
    const [name, image_id, healthy, restart_count] = line.split("\t");
    return { name, image_id, healthy: healthy === "healthy", restart_count: Number(restart_count) };
  });
  if (rows.length !== 5 || rows.some((row) => !row.name || !row.image_id || !Number.isInteger(row.restart_count))) fail("container preflight output is invalid");
  return rows;
}

function safeRollbackRows(text) {
  const rows = text.trim().split("\n").filter(Boolean).map((line) => {
    const [kind, name, hash, image_id] = line.split("\t");
    return { kind, name, sha256: hash, image_id: image_id || null };
  });
  const expected = [
    ["image", "crm"], ["image", "inbox"], ["image", "lead_agent"],
    ["env", "crm"], ["env", "inbox"], ["env", "lead_agent"],
    ["compose", "crm"], ["compose", "inbox"], ["compose", "lead_agent"],
  ];
  if (rows.length !== expected.length || rows.some((row, index) => row.kind !== expected[index][0] || row.name !== expected[index][1] || !SHA256.test(row.sha256) || (row.kind === "image" ? !/^sha256:[0-9a-f]{64}$/.test(row.image_id ?? "") : row.image_id !== null))) fail("rollback capture output is invalid");
  return rows;
}

function validateLocalCandidate(run) {
  const head = run("git", ["-C", LOCAL_SOURCE, "rev-parse", "HEAD"], { timeout: 10_000, label: "candidate identity" }).stdout.trim();
  if (head !== CANDIDATE) fail("candidate worktree identity drifted");
  if (run("git", ["-C", LOCAL_SOURCE, "status", "--porcelain", "--untracked-files=all"], { timeout: 10_000, label: "candidate cleanliness" }).stdout.trim()) fail("candidate worktree is dirty");
  const root = realpathSync(PORTABLE_ROOT);
  if ((statSync(root).mode & 0o777) !== 0o700) fail("portable evidence root mode drifted");
  assertLocalFile(join(root, "collection-index.json"), "a6bb5b51851d8338891846ff534fc25e774a739f5f656f010b707c398d7d63e7", 0o600);
  assertLocalFile(join(root, "portable-image-identity.json"), "53fa00c63338a55925fa8d2c8d6e6faaa61d63b0f99251e50dabafd792755ccd", 0o600);
  for (const image of Object.values(IMAGES)) assertLocalFile(join(root, image.archive), image.archiveSha256, 0o600);
  assertLocalFile(join(LOCAL_SOURCE, "agent-lead2-inbox/src/app/api/ai/playground/route.ts"), "32e6d0a37c0605f17526fecbbe94c1942884922167dd941c1fbe3c2e7f6ef954");
  assertLocalFile(join(LOCAL_SOURCE, "agent-lead2-inbox/src/app/api/ai/internal-assistant/route.ts"), "9f2c46e6154d920f827b1fe4af42faf80b242c6d389a4643837e5b3268efd4c2");
  assertLocalFile(join(LOCAL_SOURCE, "supabase/migrations/075_ai_assistant_immutable_audits.sql"), "303bc08a1a685e5e8ad0d3acb9492fd2f65e8895c55ca87af218a7e3b897b6cd");
}

function preflightScript() {
  return String.raw`
set -o pipefail
[[ "$(uname -m)" == "x86_64" ]]
for path in '${RELEASE_ROOT}' '${ROLLBACK_ROOT}' '${EVIDENCE_ROOT}'; do [[ ! -e "$path" ]]; done
for tag in '${IMAGES.crm.tag}' '${IMAGES.crm.composeTag}' '${IMAGES.inbox.tag}' '${IMAGES.inbox.composeTag}' '${IMAGES.lead_agent.tag}' '${IMAGES.lead_agent.composeTag}'; do ! docker image inspect "$tag" >/dev/null 2>&1; done
for path in '${ENV_FILES.crm}' '${ENV_FILES.lead_agent}' '${ENV_FILES.inbox}' '${ENV_FILES.inbox_waha}' '${COMPOSE_FILES.crm}' '${COMPOSE_FILES.inbox}' '${COMPOSE_FILES.lead_agent}'; do
  [[ -f "$path" && ! -L "$path" && "$(stat -c '%U:%G %a' "$path")" == 'root:root 600' ]]
done
docker network inspect evo_public_web evo_crm_private evo_inbox_private >/dev/null
for name in '${CURRENT.crm.container}' '${CURRENT.inbox.container}' '${CURRENT.lead_agent.container}' '${CURRENT.crm_waha.container}' '${CURRENT.inbox_waha.container}'; do
  docker inspect --format '{{.Name}}\t{{.Image}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}\t{{.RestartCount}}' "$name" | sed 's#^/##'
done
`;
}

function stageRemoteScript() {
  return String.raw`
set -o pipefail
umask 077
install -d -o root -g root -m 0700 '${RELEASE_ROOT}' '${RELEASE_ROOT}/incoming' '${RELEASE_ROOT}/repo' '${ROLLBACK_ROOT}' '${EVIDENCE_ROOT}'
install -o root -g root -m 0600 '${ENV_FILES.crm}' '${ROLLBACK_ROOT}/crm.env.production'
install -o root -g root -m 0600 '${ENV_FILES.lead_agent}' '${ROLLBACK_ROOT}/lead-agent.env.production'
install -o root -g root -m 0600 '${ENV_FILES.inbox}' '${ROLLBACK_ROOT}/inbox.env.production'
install -o root -g root -m 0600 '${COMPOSE_FILES.crm}' '${ROLLBACK_ROOT}/crm.compose.yml'
install -o root -g root -m 0600 '${COMPOSE_FILES.inbox}' '${ROLLBACK_ROOT}/inbox.compose.yml'
install -o root -g root -m 0600 '${COMPOSE_FILES.lead_agent}' '${ROLLBACK_ROOT}/lead-agent.compose.yml'
docker save -o '${ROLLBACK_ROOT}/${CURRENT.crm.archive}' '${CURRENT.crm.id}'
docker save -o '${ROLLBACK_ROOT}/${CURRENT.inbox.archive}' '${CURRENT.inbox.id}'
docker save -o '${ROLLBACK_ROOT}/${CURRENT.lead_agent.archive}' '${CURRENT.lead_agent.id}'
chmod 0600 '${ROLLBACK_ROOT}'/*.tar
printf 'image\tcrm\t%s\t%s\n' "$(sha256sum '${ROLLBACK_ROOT}/${CURRENT.crm.archive}' | cut -d' ' -f1)" '${CURRENT.crm.id}'
printf 'image\tinbox\t%s\t%s\n' "$(sha256sum '${ROLLBACK_ROOT}/${CURRENT.inbox.archive}' | cut -d' ' -f1)" '${CURRENT.inbox.id}'
printf 'image\tlead_agent\t%s\t%s\n' "$(sha256sum '${ROLLBACK_ROOT}/${CURRENT.lead_agent.archive}' | cut -d' ' -f1)" '${CURRENT.lead_agent.id}'
printf 'env\tcrm\t%s\t\n' "$(sha256sum '${ROLLBACK_ROOT}/crm.env.production' | cut -d' ' -f1)"
printf 'env\tinbox\t%s\t\n' "$(sha256sum '${ROLLBACK_ROOT}/inbox.env.production' | cut -d' ' -f1)"
printf 'env\tlead_agent\t%s\t\n' "$(sha256sum '${ROLLBACK_ROOT}/lead-agent.env.production' | cut -d' ' -f1)"
printf 'compose\tcrm\t%s\t\n' "$(sha256sum '${ROLLBACK_ROOT}/crm.compose.yml' | cut -d' ' -f1)"
printf 'compose\tinbox\t%s\t\n' "$(sha256sum '${ROLLBACK_ROOT}/inbox.compose.yml' | cut -d' ' -f1)"
printf 'compose\tlead_agent\t%s\t\n' "$(sha256sum '${ROLLBACK_ROOT}/lead-agent.compose.yml' | cut -d' ' -f1)"
`;
}

export function createAtomicEvidenceInstallScript(incoming, finalPath, expectedHash) {
  if (!/^\/[-A-Za-z0-9_./]+$/.test(incoming) || !/^\/[-A-Za-z0-9_./]+$/.test(finalPath) || !SHA256.test(expectedHash)) fail("evidence install arguments are invalid");
  return String.raw`
set -o pipefail
cleanup_failed_publication() {
  set +e
  rm -f '${incoming}' '${finalPath}'
  [[ ! -e '${incoming}' && ! -e '${finalPath}' ]]
  exit 91
}
trap cleanup_failed_publication ERR
[[ ! -e '${finalPath}' ]]
chown root:root '${incoming}'
chmod 0600 '${incoming}'
[[ "$(sha256sum '${incoming}' | cut -d' ' -f1)" == '${expectedHash}' ]]
[[ "$(stat -c '%U:%G %a' '${incoming}')" == 'root:root 600' ]]
mv '${incoming}' '${finalPath}'
[[ "$(sha256sum '${finalPath}' | cut -d' ' -f1)" == '${expectedHash}' ]]
[[ "$(stat -c '%U:%G %a' '${finalPath}')" == 'root:root 600' ]]
trap - ERR
`;
}

function stageVerifyScript() {
  return String.raw`
set -o pipefail
[[ "$(sha256sum '${RELEASE_ROOT}/incoming/${PORTABLE_IDENTITY}' | cut -d' ' -f1)" == '${PORTABLE_IDENTITY_SHA256}' ]]
[[ "$(stat -c '%U:%G %a' '${RELEASE_ROOT}/incoming/${PORTABLE_IDENTITY}')" == 'root:root 600' ]]
python3 - '${RELEASE_ROOT}/incoming/${PORTABLE_IDENTITY}' <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
expected=[
 ('main_crm','${IMAGES.crm.tag}','${IMAGES.crm.id}'),
 ('evo_inbox','${IMAGES.inbox.tag}','${IMAGES.inbox.id}'),
 ('lead_agent','${IMAGES.lead_agent.tag}','${IMAGES.lead_agent.id}'),
]
if v.get('schema_version')!=1 or v.get('candidate_commit')!='${CANDIDATE}' or v.get('target_platform')!={'os':'linux','architecture':'amd64','variant':''}: raise SystemExit(31)
images=v.get('images')
if not isinstance(images,list) or len(images)!=3: raise SystemExit(32)
for row,want in zip(images,expected):
    if (row.get('name'),row.get('tag'),row.get('oci_index_digest'))!=want or row.get('source_commit')!='${CANDIDATE}' or row.get('platform')!={'os':'linux','architecture':'amd64','variant':''}: raise SystemExit(33)
PY
for spec in \
  '${IMAGES.crm.archive} ${IMAGES.crm.archiveSha256} ${IMAGES.crm.tag} ${IMAGES.crm.composeTag} ${IMAGES.crm.id}' \
  '${IMAGES.inbox.archive} ${IMAGES.inbox.archiveSha256} ${IMAGES.inbox.tag} ${IMAGES.inbox.composeTag} ${IMAGES.inbox.id}' \
  '${IMAGES.lead_agent.archive} ${IMAGES.lead_agent.archiveSha256} ${IMAGES.lead_agent.tag} ${IMAGES.lead_agent.composeTag} ${IMAGES.lead_agent.id}'; do
  set -- $spec
  [[ "$(sha256sum "${RELEASE_ROOT}/incoming/$1" | cut -d' ' -f1)" == "$2" ]]
  docker load -i "${RELEASE_ROOT}/incoming/$1" >/dev/null
  [[ "$(docker image inspect --format '{{.Id}}' "$3")" == "$5" ]]
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}/{{.Variant}}' "$3")" == 'linux/amd64/' ]]
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$3")" == '${CANDIDATE}' ]]
  ! docker image inspect "$4" >/dev/null 2>&1
  docker image tag "$3" "$4"
  [[ "$(docker image inspect --format '{{.Id}}' "$4")" == "$5" ]]
done
`;
}

const CRM_FLAGS = Object.freeze({
  EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0",
  EVO_PLATFORM_WAHA_WORKER_ENABLED: "0",
  EVO_PLATFORM_WAHA_HISTORY_ENABLED: "0",
  EVO_PLATFORM_WAHA_MEDIA_ENABLED: "0",
  EVO_PLATFORM_AMOCRM_READ_ENABLED: "0",
  EVO_PLATFORM_AI_MEMORY_ENABLED: "0",
  EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED: "0",
  EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: "0",
  EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: "1",
  EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED: "0",
  EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED: "0",
  EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "0",
  EVO_PLATFORM_P7A_AUDIT_ENABLED: "0",
  EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
});
const LEAD_FLAGS = Object.freeze({ EVO_AGENT_FROZEN: "true", EVO_AGENT_WORKER_ENABLED: "false", EVO_AGENT_AUTOREPLY_ENABLED: "false", EVO_AGENT_OUTBOUND_ENABLED: "false", EVO_AGENT_GEMINI_MODEL: "gemini-3.5-flash" });
const INBOX_FLAGS = Object.freeze({ EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1" });

function configurationScript() {
  const crm = JSON.stringify(CRM_FLAGS);
  const lead = JSON.stringify(LEAD_FLAGS);
  const inbox = JSON.stringify(INBOX_FLAGS);
  return String.raw`
set -o pipefail
python3 - '${ENV_FILES.crm}' '${ENV_FILES.lead_agent}' '${ENV_FILES.inbox}' '${crm}' '${lead}' '${inbox}' <<'PY'
import json, os, pathlib, secrets, stat, sys, tempfile
def update(path_s, wanted, secret_name):
    path=pathlib.Path(path_s); st=path.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or stat.S_IMODE(st.st_mode)!=0o600 or st.st_uid!=0 or st.st_gid!=0: raise SystemExit(21)
    lines=path.read_text().splitlines(); seen={}
    for i,line in enumerate(lines):
        if not line or line.lstrip().startswith('#') or '=' not in line: continue
        key,value=line.split('=',1)
        if key in seen: raise SystemExit(22)
        seen[key]=(i,value)
    for key,value in wanted.items():
        if key in seen:
            i,current=seen[key]
            if current!=value:
                if not (key=='EVO_AGENT_AUTOREPLY_ENABLED' and current=='true' and value=='false'): raise SystemExit(23)
                lines[i]=key+'='+value
        else: lines.append(key+'='+value)
    if secret_name and secret_name not in seen: lines.append(secret_name+'='+secrets.token_hex(32))
    tmp=path.with_name(path.name+'.p8d4g.tmp')
    if tmp.exists(): raise SystemExit(24)
    fd=os.open(tmp, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as out: out.write('\n'.join(lines)+'\n'); out.flush(); os.fsync(out.fileno())
    os.chown(tmp,0,0); os.chmod(tmp,0o600); os.replace(tmp,path)
update(sys.argv[1],json.loads(sys.argv[4]),'EVO_PLATFORM_P7B_OBSERVABILITY_SECRET')
update(sys.argv[2],json.loads(sys.argv[5]),None)
update(sys.argv[3],json.loads(sys.argv[6]),'EVO_INBOX_P7B_OBSERVABILITY_SECRET')
def value(path_s,key):
    found=[line.split('=',1)[1] for line in pathlib.Path(path_s).read_text().splitlines() if line.startswith(key+'=')]
    if len(found)!=1: raise SystemExit(25)
    return found[0]
crm_secret=value(sys.argv[1],'EVO_PLATFORM_P7B_OBSERVABILITY_SECRET')
inbox_secret=value(sys.argv[3],'EVO_INBOX_P7B_OBSERVABILITY_SECRET')
if len(crm_secret)!=64 or len(inbox_secret)!=64 or any(c not in '0123456789abcdef' for c in crm_secret+inbox_secret) or crm_secret==inbox_secret: raise SystemExit(26)
PY
[[ "$(docker inspect --format '{{.Config.Image}}' '${CURRENT.crm_waha.container}')" == *'@${WAHA_DIGEST}' ]]
[[ "$(docker inspect --format '{{.Config.Image}}' '${CURRENT.inbox_waha.container}')" == *'@${WAHA_DIGEST}' ]]
`;
}

function composeScript(name, rollback = false) {
  const candidate = !rollback;
  const revision = candidate ? CANDIDATE : CURRENT[name].revision;
  const file = candidate
    ? (name === "inbox" ? `${RELEASE_ROOT}/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml` : `${RELEASE_ROOT}/repo/docker-compose.prod.yml`)
    : `${ROLLBACK_ROOT}/${name === "lead_agent" ? "lead-agent" : name}.compose.yml`;
  const project = name === "inbox" ? "evo-inbox" : "evo-crm";
  const service = name === "lead_agent" ? "lead-agent" : "app";
  const envFile = ENV_FILES[name];
  const extra = name === "inbox"
    ? `EVO_INBOX_APP_ENV_FILE='${ENV_FILES.inbox}' EVO_INBOX_WAHA_ENV_FILE='${ENV_FILES.inbox_waha}'`
    : `EVO_CRM_APP_ENV_FILE='${ENV_FILES.crm}' EVO_CRM_LEAD_AGENT_ENV_FILE='${ENV_FILES.lead_agent}'`;
  return String.raw`
set -o pipefail
cd '${rollback ? ROLLBACK_ROOT : `${RELEASE_ROOT}/repo`}'
EVO_RELEASE_REVISION='${revision}' EVO_RELEASE_VERSION='${RELEASE_VERSION}' EVO_WAHA_IMAGE_DIGEST='${WAHA_DIGEST}' ${extra} docker compose --env-file '${envFile}' -p '${project}' -f '${file}' up -d --no-deps '${service}'
`;
}

function verifyDeploymentScript(name) {
  const container = CURRENT[name].container;
  const flags = name === "crm" ? CRM_FLAGS : name === "lead_agent" ? LEAD_FLAGS : INBOX_FLAGS;
  const checks = Object.entries(flags).map(([key, value]) => `[[ "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' '${container}' | awk -F= '$1=="${key}"{print substr($0,index($0,"=")+1)}')" == '${value}' ]]`).join("\n");
  const expectedNetworks = name === "crm" ? "evo_crm_private\nevo_public_web" : name === "inbox" ? "evo_inbox_private\nevo_public_web" : "evo_crm_private";
  const liveness = name === "lead_agent"
    ? `docker exec '${container}' python -c "import json,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5); raise SystemExit(0 if json.load(r).get('ok') else 1)"`
    : `docker exec '${container}' node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"`;
  return String.raw`
set -o pipefail
for _ in $(seq 1 60); do [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' '${container}')" == 'healthy' ]] && break; sleep 2; done
[[ "$(docker inspect --format '{{.Image}}' '${container}')" == '${IMAGES[name].id}' ]]
[[ "$(docker inspect --format '{{.RestartCount}}' '${container}')" == '0' ]]
[[ "$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' '${container}' | sort)" == '${expectedNetworks}' ]]
${liveness}
${checks}
printf 'verified\n'
`;
}

async function boundedJson(response, label) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_OUTPUT) fail(`${label} response is oversized`);
  if (!response.ok) fail(`${label} failed safely`);
  return json(bytes.toString("utf8"), label);
}

export async function createP8D4GOperations({
  run = defaultRun,
  fetchImpl = fetch,
  environment = process.env,
  credentialFile = CREDENTIAL_FILE,
  validateCandidate = () => validateLocalCandidate(run),
  validateExecutionControl = () => validateP8D4GExecutionControl(run),
} = {}) {
  const credentials = existsSync(credentialFile) ? parseEnvFile(credentialFile) : {};
  const managementToken = requireCredential(environment, credentials, ["EVO_P8D4G_SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"]);
  const supabaseUrl = requireCredential(environment, credentials, ["EVO_P8D4G_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = requireCredential(environment, credentials, ["EVO_P8D4G_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  const staffCookie = environment.EVO_P8D4G_STAFF_COOKIE ?? null;
  const state = { localKnowledgeRoots: [], accountId: null, remoteAudiences: new Set(), containerAudiences: new Set(), importerCreated: false };

  async function management(path) {
    const response = await fetchImpl(`https://api.supabase.com${path}`, { headers: { Authorization: `Bearer ${managementToken}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    return boundedJson(response, "Supabase management read");
  }

  async function rest(path) {
    const response = await fetchImpl(`${supabaseUrl}${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    return boundedJson(response, "Supabase service read");
  }

  async function restCount(path) {
    const response = await fetchImpl(`${supabaseUrl}${path}`, { method: "HEAD", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) fail("Supabase side-effect count failed safely");
    const range = response.headers.get("content-range");
    const total = range?.match(/\/(\d+)$/)?.[1];
    if (total === undefined) fail("Supabase side-effect count is missing");
    return Number(total);
  }

  async function ledger() {
    const project = await management(`/v1/projects/${PROJECT_REF}`);
    if (project?.status !== "ACTIVE_HEALTHY") fail("production Supabase project is not healthy");
    const rows = await management(`/v1/projects/${PROJECT_REF}/database/migrations`);
    if (!Array.isArray(rows)) fail("migration ledger is invalid");
    const versions = rows.map((row) => String(row.version)).sort();
    const expected = Array.from({ length: 76 }, (_, index) => String(index + 1).padStart(3, "0"));
    if (versions.join("\0") !== expected.join("\0")) fail("migration ledger drifted");
    return { status: "verified_noop", range: "001-076", count: 76, project_status: "ACTIVE_HEALTHY" };
  }

  async function resolveAccount() {
    const params = new URLSearchParams({ select: "account_id", provider: "eq.gemini", model: "eq.gemini-3.5-flash", embeddings_provider: "eq.gemini", is_active: "eq.true", auto_reply_enabled: "eq.false" });
    const rows = await rest(`/rest/v1/ai_configs?${params}`);
    if (!Array.isArray(rows) || rows.length !== 1 || !UUID.test(rows[0]?.account_id)) fail("production account resolution was not singular");
    return rows[0].account_id;
  }

  async function verifyPilotOrigin() {
    const response = await fetchImpl(`${PILOT_ORIGIN}/`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 307) fail("staff pilot origin is not reachable");
  }

  function buildAudience(audience, vault) {
    const roots = [0, 1].map(() => {
      const root = mkdtempSync(join(tmpdir(), `evo-p8d4g-${audience}-`));
      chmodSync(root, 0o700);
      state.localKnowledgeRoots.push(root);
      return root;
    });
    const python = [
      "-c",
      "import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from build_platform_bundle import build_bundle; build_bundle(Path(sys.argv[2]),sys.argv[3],sys.argv[4],Path(sys.argv[5]))",
      `${LOCAL_SOURCE}/scripts/knowledge_ingestion`, vault, state.accountId, audience,
    ];
    for (const root of roots) run("python3", [...python, root], { timeout: 120_000, label: `${audience} deterministic knowledge build` });
    const bundleName = `evo-knowledge-${audience}.json`;
    const manifestName = `evo-knowledge-${audience}.sha256.json`;
    const bundle = readFileSync(join(roots[0], bundleName));
    const manifest = readFileSync(join(roots[0], manifestName));
    if (!bundle.equals(readFileSync(join(roots[1], bundleName))) || !manifest.equals(readFileSync(join(roots[1], manifestName)))) fail(`${audience} deterministic knowledge bytes drifted`);
    const parsed = json(bundle.toString("utf8"), `${audience} bundle`);
    const expectedCount = audience === "client" ? 11 : 291;
    if (parsed.account_id !== state.accountId || parsed.audience !== audience || parsed.documents?.length !== expectedCount) fail(`${audience} bundle identity drifted`);
    const reports = roots.map((root) => json(readFileSync(join(root, `evo-knowledge-${audience}.report.json`), "utf8"), `${audience} build report`));
    for (const report of reports) {
      exactKeys(report, ["version", "generated_at", "account_id", "audience", "marker_root", "document_count", "bundle_sha256", "manifest_sha256", "output_directory"], `${audience} build report`);
      if (report.version !== 1 || report.account_id !== state.accountId || report.audience !== audience || report.document_count !== expectedCount || report.bundle_sha256 !== sha256(bundle) || report.manifest_sha256 !== sha256(manifest) || typeof report.generated_at !== "string" || !Number.isFinite(Date.parse(report.generated_at)) || typeof report.marker_root !== "string" || !report.marker_root || typeof report.output_directory !== "string" || !report.output_directory) fail(`${audience} build report drifted`);
    }
    const stableReport = (report) => Object.fromEntries(Object.entries(report).filter(([key]) => key !== "generated_at" && key !== "output_directory"));
    if (JSON.stringify(stableReport(reports[0])) !== JSON.stringify(stableReport(reports[1]))) fail(`${audience} stable build report fields drifted`);
    return { audience, root: roots[0], bundleName, manifestName, documentCount: expectedCount, bundleSha256: sha256(bundle), manifestSha256: sha256(manifest) };
  }

  async function importAudience(item, deadlineAt) {
    for (const file of [item.bundleName, item.manifestName]) {
      run("scp", [join(item.root, file), `${HERMES}:${KNOWLEDGE_REMOTE}/${file}`], { timeout: remainingMs(deadlineAt), label: `${item.audience} knowledge transfer` });
    }
    state.remoteAudiences.add(item.audience);
    remote(run, String.raw`
set -o pipefail
[[ "$(sha256sum '${KNOWLEDGE_REMOTE}/${item.bundleName}' | cut -d' ' -f1)" == '${item.bundleSha256}' ]]
[[ "$(sha256sum '${KNOWLEDGE_REMOTE}/${item.manifestName}' | cut -d' ' -f1)" == '${item.manifestSha256}' ]]
docker cp '${KNOWLEDGE_REMOTE}/${item.bundleName}' '${IMPORTER}:/tmp/${item.bundleName}'
docker cp '${KNOWLEDGE_REMOTE}/${item.manifestName}' '${IMPORTER}:/tmp/${item.manifestName}'
[[ "$(docker exec '${IMPORTER}' sha256sum '/tmp/${item.bundleName}' | cut -d' ' -f1)" == '${item.bundleSha256}' ]]
[[ "$(docker exec '${IMPORTER}' sha256sum '/tmp/${item.manifestName}' | cut -d' ' -f1)" == '${item.manifestSha256}' ]]
`, { deadlineAt, label: `${item.audience} knowledge copy verification` });
    state.containerAudiences.add(item.audience);
    const command = String.raw`IFS= read -r EVO_KNOWLEDGE_ACCOUNT_ID
[[ "$EVO_KNOWLEDGE_ACCOUNT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
docker exec '${IMPORTER}' npm run knowledge:import -- --audience '${item.audience}' --bundle '/tmp/${item.bundleName}' --manifest '/tmp/${item.manifestName}' --account-id "$EVO_KNOWLEDGE_ACCOUNT_ID"`;
    const output = run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-c", command], { input: `${state.accountId}\n`, timeout: remainingMs(deadlineAt), label: `${item.audience} knowledge import` }).stdout.trim().split("\n").at(-1);
    const safe = json(output, `${item.audience} importer`);
    exactKeys(safe, ["status", "version", "audience", "bundle_sha256", "documents_upserted", "documents_deleted", "chunks_replaced"], "safe importer result");
    if (safe.status !== "knowledge_import_verified" || safe.version !== 1 || safe.audience !== item.audience || safe.bundle_sha256 !== item.bundleSha256) fail(`${item.audience} importer result drifted`);
    const params = new URLSearchParams({ select: "audience,bundle_sha256,document_count,chunk_count", account_id: `eq.${state.accountId}`, audience: `eq.${item.audience}` });
    const revisions = await rest(`/rest/v1/ai_knowledge_bundle_revisions?${params}`);
    if (!Array.isArray(revisions) || revisions.length !== 1 || revisions[0].bundle_sha256 !== item.bundleSha256 || Number(revisions[0].document_count) !== item.documentCount || !Number.isInteger(Number(revisions[0].chunk_count)) || Number(revisions[0].chunk_count) < 1) fail(`${item.audience} database revision did not verify`);
    return { name: item.audience, status: "verified", document_count: item.documentCount, chunk_count: Number(revisions[0].chunk_count), bundle_sha256: item.bundleSha256, manifest_sha256: item.manifestSha256, database_revision_sha256: sha256(Buffer.from(JSON.stringify({ audience: item.audience, bundle_sha256: item.bundleSha256, document_count: item.documentCount, chunk_count: Number(revisions[0].chunk_count) }))) };
  }

  return {
    async preflight() {
      validateCandidate();
      const executionControl = await validateExecutionControl();
      if (!staffCookie) fail("existing staff session credential is missing");
      const migrations = await ledger();
      await verifyPilotOrigin();
      const rows = safeContainerRows(remote(run, preflightScript(), { deadlineAt: new Date(Date.now() + 60_000).toISOString(), label: "Hermes preflight" }).stdout);
      const expected = [CURRENT.crm, CURRENT.inbox, CURRENT.lead_agent];
      if (expected.some((item) => rows.find((row) => row.name === item.container)?.image_id !== item.id)) fail("running application identity drifted");
      if (rows.some((row) => !row.healthy || row.restart_count !== 0)) fail("running containers are not stable");
      return { status: "verified", execution_control: executionControl, containers: rows.map(({ name, image_id, healthy, restart_count }) => ({ name, image_id, healthy, restart_count })), migration_range: migrations.range, migration_count: migrations.count, candidate_tags_absent: true, roots_absent: true, rollback_inputs_verified: true };
    },

    async stage({ deadlineAt }) {
      validateCandidate();
      const rollbackFiles = safeRollbackRows(remote(run, stageRemoteScript(), { deadlineAt, label: "Hermes rollback capture" }).stdout);
      for (const image of Object.values(IMAGES)) run("scp", [join(PORTABLE_ROOT, image.archive), `${HERMES}:${RELEASE_ROOT}/incoming/${image.archive}`], { timeout: remainingMs(deadlineAt), label: "candidate archive transfer" });
      run("scp", [join(PORTABLE_ROOT, PORTABLE_IDENTITY), `${HERMES}:${RELEASE_ROOT}/incoming/${PORTABLE_IDENTITY}`], { timeout: remainingMs(deadlineAt), label: "portable identity transfer" });
      remote(run, `chmod 0600 '${RELEASE_ROOT}/incoming/${PORTABLE_IDENTITY}'`, { deadlineAt, label: "portable identity mode" });
      const repoArchive = join(tmpdir(), `evo-p8d4g-repo-${process.pid}.tar`);
      try {
        if (existsSync(repoArchive)) fail("local release archive collision");
        run("git", ["-C", LOCAL_SOURCE, "archive", "--format=tar", `--output=${repoArchive}`, CANDIDATE], { timeout: remainingMs(deadlineAt), label: "release repository archive" });
        run("scp", [repoArchive, `${HERMES}:${RELEASE_ROOT}/repo.tar`], { timeout: remainingMs(deadlineAt), label: "release repository transfer" });
        const repoHash = sha256(readFileSync(repoArchive));
        remote(run, `[[ "$(sha256sum '${RELEASE_ROOT}/repo.tar' | cut -d' ' -f1)" == '${repoHash}' ]]\ntar -xf '${RELEASE_ROOT}/repo.tar' -C '${RELEASE_ROOT}/repo'\nrm -f '${RELEASE_ROOT}/repo.tar'\n${stageVerifyScript()}`, { deadlineAt, label: "candidate load and verification" });
      } finally { rmSync(repoArchive, { force: true }); }
      const artifacts = [
        { kind: "portable_identity", filename: PORTABLE_IDENTITY, sha256: PORTABLE_IDENTITY_SHA256, image_id: null },
        ...Object.values(IMAGES).map((image) => ({ kind: "image_archive", filename: image.archive, sha256: image.archiveSha256, image_id: image.id })),
      ];
      return { status: "verified", archives_verified: 3, images_verified: 3, rollback_verified: true, release_repo_verified: true, artifacts, rollback_files: rollbackFiles };
    },

    async configureDisabled({ deadlineAt }) {
      remote(run, configurationScript(), { deadlineAt, label: "disabled configuration" });
      return { status: "verified", files_verified: 3, disabled_state_verified: true, waha_unchanged: true };
    },

    async verifyMigrations() { return ledger(); },

    async publishKnowledge({ deadlineAt }) {
      state.accountId = await resolveAccount();
      const builds = [buildAudience("client", CLIENT_VAULT), buildAudience("internal", INTERNAL_VAULT)];
      remote(run, String.raw`
set -o pipefail
umask 077
[[ ! -e '${KNOWLEDGE_REMOTE}' ]]
! docker inspect '${IMPORTER}' >/dev/null 2>&1
install -d -o root -g root -m 0700 '${KNOWLEDGE_REMOTE}'
cd '${RELEASE_ROOT}/repo'
EVO_RELEASE_REVISION='${CANDIDATE}' EVO_RELEASE_VERSION='${RELEASE_VERSION}' EVO_WAHA_IMAGE_DIGEST='${WAHA_DIGEST}' EVO_INBOX_APP_ENV_FILE='${ENV_FILES.inbox}' EVO_INBOX_WAHA_ENV_FILE='${ENV_FILES.inbox_waha}' docker compose --env-file '${ENV_FILES.inbox}' -p evo-inbox -f agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml run -d --no-deps --name '${IMPORTER}' --entrypoint tail app -f /dev/null
[[ "$(docker inspect --format '{{.Image}}' '${IMPORTER}')" == '${IMAGES.inbox.id}' ]]
[[ "$(docker inspect --format '{{.Config.User}}' '${IMPORTER}')" == '1001' ]]
`, { deadlineAt, label: "isolated importer creation" });
      state.importerCreated = true;
      const audiences = [];
      for (const build of builds) audiences.push(await importAudience(build, deadlineAt));
      return { account_resolution: "exactly_one_active", deterministic_builds: "verified", artifacts_created: true, audiences };
    },

    async cleanupKnowledge() {
      let localRootsRemoved = 0;
      let cleanupFailed = false;
      for (const root of state.localKnowledgeRoots) {
        try {
          if (existsSync(root)) { rmSync(root, { recursive: true, force: false }); localRootsRemoved += 1; }
          if (existsSync(root)) cleanupFailed = true;
        } catch { cleanupFailed = true; }
      }
      try { remote(run, String.raw`
set -o pipefail
if docker inspect '${IMPORTER}' >/dev/null 2>&1; then docker exec '${IMPORTER}' sh -c "rm -f /tmp/evo-knowledge-client.json /tmp/evo-knowledge-client.sha256.json /tmp/evo-knowledge-internal.json /tmp/evo-knowledge-internal.sha256.json"; docker rm -f '${IMPORTER}' >/dev/null; fi
rm -rf '${KNOWLEDGE_REMOTE}'
[[ ! -e '${KNOWLEDGE_REMOTE}' ]]
! docker inspect '${IMPORTER}' >/dev/null 2>&1
`, { deadlineAt: new Date(Date.now() + 5 * 60_000).toISOString(), label: "knowledge artifact cleanup" }); } catch { cleanupFailed = true; }
      const remotePairsRemoved = state.remoteAudiences.size;
      const containerPairsRemoved = state.containerAudiences.size;
      state.localKnowledgeRoots = [];
      state.accountId = null;
      state.remoteAudiences.clear();
      state.containerAudiences.clear();
      state.importerCreated = false;
      return { status: cleanupFailed ? "failed" : "verified", local_roots_removed: localRootsRemoved, remote_pairs_removed: remotePairsRemoved, container_pairs_removed: containerPairsRemoved, importer_removed: !cleanupFailed };
    },

    async publishEvidence(localPath) {
      assertLocalFile(localPath, null, 0o600);
      const hash = sha256(readFileSync(localPath));
      const incoming = `${REMOTE_RESULT}.incoming`;
      remote(run, `[[ ! -e '${REMOTE_RESULT}' && ! -e '${incoming}' ]]`, { deadlineAt: new Date(Date.now() + 5 * 60_000).toISOString(), label: "evidence destination preflight" });
      try {
        run("scp", [localPath, `${HERMES}:${incoming}`], { timeout: 5 * 60_000, label: "redacted evidence transfer" });
        remote(run, createAtomicEvidenceInstallScript(incoming, REMOTE_RESULT, hash), { deadlineAt: new Date(Date.now() + 5 * 60_000).toISOString(), label: "redacted evidence installation" });
      } catch (publicationError) {
        remote(run, `rm -f '${incoming}' '${REMOTE_RESULT}'\n[[ ! -e '${incoming}' && ! -e '${REMOTE_RESULT}' ]]`, { deadlineAt: new Date(Date.now() + 5 * 60_000).toISOString(), label: "failed evidence publication cleanup" });
        throw publicationError;
      }
      return { status: "verified", sha256: hash };
    },

    async deploy(name, { deadlineAt }) {
      if (!Object.hasOwn(IMAGES, name)) fail("unknown deployment boundary");
      remote(run, `${composeScript(name)}\n${verifyDeploymentScript(name)}`, { deadlineAt, label: `${name} deployment` });
      return { name, status: "verified", image_id: IMAGES[name].id, healthy: true, restart_count: 0, disabled_state: true };
    },

    async rollback(boundaries) {
      for (const name of boundaries) {
        if (!Object.hasOwn(CURRENT, name) || !CURRENT[name].archive) fail("unknown rollback boundary");
        remote(run, String.raw`
set -o pipefail
docker load -i '${ROLLBACK_ROOT}/${CURRENT[name].archive}' >/dev/null
if docker image inspect '${name === "lead_agent" ? "evo-lead-agent" : `evo-${name}`}:${CURRENT[name].revision}' >/dev/null 2>&1; then [[ "$(docker image inspect --format '{{.Id}}' '${name === "lead_agent" ? "evo-lead-agent" : `evo-${name}`}:${CURRENT[name].revision}')" == '${CURRENT[name].id}' ]]; else docker image tag '${CURRENT[name].id}' '${name === "lead_agent" ? "evo-lead-agent" : `evo-${name}`}:${CURRENT[name].revision}'; fi
install -o root -g root -m 0600 '${ROLLBACK_ROOT}/${name === "lead_agent" ? "lead-agent" : name}.env.production' '${ENV_FILES[name]}'
${composeScript(name, true)}
`, { deadlineAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(), label: `${name} rollback` });
      }
      const rows = safeContainerRows(remote(run, preflightScript().replace(/for path in[\s\S]*?done\nfor tag in[\s\S]*?done\n/, ""), { deadlineAt: new Date(Date.now() + 120_000).toISOString(), label: "rollback verification" }).stdout);
      if (rows.some((row) => !row.healthy || row.restart_count !== 0)) fail("rollback did not restore stable containers");
      return { status: "verified", boundaries };
    },

    async pilot(caseId, { deadlineAt }) {
      const spec = PILOTS[caseId];
      if (!spec || !staffCookie) fail("pilot authorization is missing");
      const messagesBefore = await restCount("/rest/v1/messages?select=id");
      const body = spec.audience === "client"
        ? { evaluation_case_id: caseId, messages: [{ role: "user", content: spec.question }] }
        : { evaluation_case_id: caseId, message: spec.question };
      const response = await fetchImpl(`${PILOT_ORIGIN}${spec.path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: staffCookie },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(remainingMs(deadlineAt, 60_000)),
      });
      if (response.status !== 200) fail(`${caseId} returned a non-200 status`);
      const payload = await boundedJson(response, `${caseId} staff pilot`);
      if (!Array.isArray(payload.sources) || payload.sources.length < 1 || !payload.sources.some((source) => source?.source_path === spec.source) || payload.sources.some((source) => !UUID.test(source?.chunk_id ?? "")) || typeof payload.audit_id !== "string" || !UUID.test(payload.audit_id)) fail(`${caseId} source or audit proof drifted`);
      const chunkIds = payload.sources.map((source) => source.chunk_id);
      const chunkParams = new URLSearchParams({ select: "id,audience,document_id", id: `in.(${chunkIds.join(",")})` });
      const chunks = await rest(`/rest/v1/ai_knowledge_chunks?${chunkParams}`);
      if (!Array.isArray(chunks) || chunks.length !== new Set(chunkIds).size || chunks.some((chunk) => chunk.audience !== spec.audience || !UUID.test(chunk.document_id ?? ""))) fail(`${caseId} cross-audience source proof failed`);
      const documentParams = new URLSearchParams({ select: "id,source_path", id: `in.(${chunks.map((chunk) => chunk.document_id).join(",")})` });
      const documents = await rest(`/rest/v1/ai_knowledge_documents?${documentParams}`);
      if (!Array.isArray(documents) || documents.length !== new Set(chunks.map((chunk) => chunk.document_id)).size) fail(`${caseId} database source-path proof failed`);
      const paths = new Set(documents.map((document) => document.source_path));
      if (payload.sources.some((source) => !paths.has(source.source_path))) fail(`${caseId} database source-path proof failed`);
      const auditParams = new URLSearchParams({ select: "id,audience,evaluation_case_id,provider,model,knowledge_sources,response_sha256,handoff,success,actor_user_id,created_at,expires_at", id: `eq.${payload.audit_id}` });
      const audits = await rest(`/rest/v1/ai_assistant_audits?${auditParams}`);
      if (!Array.isArray(audits) || audits.length !== 1) fail(`${caseId} audit proof is missing`);
      const audit = audits[0];
      exactKeys(audit, ["id", "audience", "evaluation_case_id", "provider", "model", "knowledge_sources", "response_sha256", "handoff", "success", "actor_user_id", "created_at", "expires_at"], `${caseId} body-free audit`);
      if (audit.id !== payload.audit_id || audit.audience !== spec.audience || audit.evaluation_case_id !== caseId || audit.provider !== "gemini" || audit.model !== "gemini-3.5-flash" || audit.handoff !== false || audit.success !== true || !SHA256.test(audit.response_sha256) || JSON.stringify(audit.knowledge_sources) !== JSON.stringify(payload.sources)) fail(`${caseId} immutable audit drifted`);
      const messagesAfter = await restCount("/rest/v1/messages?select=id");
      if (messagesAfter !== messagesBefore) fail(`${caseId} changed customer messages`);
      return { case_id: caseId, audience: spec.audience, status: "verified", http_status: 200, expected_source_match: true, cross_audience_sources: 0, audit_body_free: true, side_effect_free: true };
    },
  };
}
