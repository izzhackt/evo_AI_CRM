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
import { basename, join, resolve } from "node:path";

import { P8V3 } from "./p8v3-rollout.mjs";
import { verifyPortableArchive } from "./p8b3-portable-image-identity.mjs";
import {
  createManagementClient,
  normalizeMigrationLedger,
  parseDryRunOutput,
} from "./p8d4b-supabase-migrations.mjs";

const HERMES = "hermes-vps";
const PROJECT_REF = "iosckaqtovbbnssqcpde";
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const RELEASE_ID = "2026-08-20.p8v3.1";
const RELEASE_VERSION = "p8v3-0f1454d0-20260820";
const RELEASE_ROOT = `/opt/evo-releases/${P8V3.applicationCommit}/${RELEASE_ID}`;
const REMOTE_REPO = `${RELEASE_ROOT}/repo`;
const REMOTE_ARCHIVES = `${RELEASE_ROOT}/archives`;
const KNOWLEDGE_REMOTE = `${RELEASE_ROOT}/knowledge-incoming`;
const IMPORTER = "evo-p8v3-knowledge-import";
const CONFIG_ROLLBACK_ROOT = `/opt/evo-release-rollback/${RELEASE_ID}`;
const P8V2D_ROLLBACK_ROOT = "/opt/evo-release-evidence/p8v2d-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818";
const EVIDENCE_ROOT = "/opt/evo-release-evidence/p8v3-20260820.1";
const REMOTE_RESULT = `${EVIDENCE_ROOT}/p8v3-rollout-result.json`;
const WAHA_IMAGE = "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c";
const CLIENT_VAULT = "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО";
const INTERNAL_VAULT = "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ";
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const MAX_OUTPUT = 2_000_000;
const CLI_VERSION = "2.110.0";

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

function fail(message, code = "verification_failed") {
  const error = new Error(message);
  error.code = code;
  throw error;
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

function remote(run, script, { input = "", timeout = 300_000, label = "Hermes operation", code } = {}) {
  return run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-seu"], { input: `${script}\n${input}`, timeout, label, code });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function remaining(deadlineAt) {
  const value = deadlineAt - Date.now();
  if (!Number.isFinite(value) || value <= 0) fail("authorization expired", "authorization_expired");
  return Math.max(1, Math.floor(value));
}

function safeChildEnvironment(environment) {
  const child = { ...environment };
  for (const key of ["DB_PASSWORD", "DIRECT_URL", "EVO_PLATFORM_DB_PASSWORD", "EVO_PLATFORM_DB_URL", "PGPASSWORD", "POSTGRES_PASSWORD", "SUPABASE_DB_PASSWORD"]) {
    if (child[key]) fail(`${key} is forbidden for PAT-only migration`, "migration_failed");
    delete child[key];
  }
  return child;
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
  docker inspect "$name" --format '{{.Name}}|{{.Id}}|{{.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{.RestartCount}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}'
done
`;
}

function preflightRemoteScript() {
  const allowlist = REQUIRED_ROLLBACK_FILES.join("\n");
  const hashes = REQUIRED_ROLLBACK_FILES.map((name) => `${name}|${ROLLBACK_SHA256[name]}`).join("\n");
  return String.raw`
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
  const temp = mkdtempSync(join(tmpdir(), "evo-p8v3-compose-"));
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
      "NEXT_PUBLIC_SUPABASE_URL=https://p8v3.invalid",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=p8v3-compose-validation-not-a-key",
      "NEXT_PUBLIC_SITE_URL=https://p8v3.invalid",
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

async function readLedger(request) {
  const rows = await request(`/v1/projects/${PROJECT_REF}/database/migrations`, { expectedStatus: 200 });
  const versions = normalizeMigrationLedger(rows);
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

export function configurationInstallScript() {
  return String.raw`
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
    fd,tmp=tempfile.mkstemp(prefix=path.name+'.p8v3-',dir=path.parent)
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
gemini=lead_values.get('GEMINI_API_KEY','')
root_sync=root_values.get('EVO_LEAD_AGENT_SYNC_SECRET','')
lead_sync=lead_values.get('EVO_AGENT_CRM_SYNC_SECRET','')
if len(gemini)<16 or len(root_sync)<32 or root_sync!=lead_sync: raise SystemExit(2)
before=root.read_bytes()
(backup/'env.production.before').write_bytes(before)
os.chmod(backup/'env.production.before',0o600); os.chown(backup/'env.production.before',0,0)
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
write_atomic(root,root_values)
write_atomic(worker,{'EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET':trigger})
check=parse(root); worker_check=parse(worker)
names=['EVO_PLATFORM_GEMINI_API_KEY','EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED','EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET','EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED','EVO_PLATFORM_STAFF_ASSISTANT_ENABLED']
if any(k not in check for k in names) or worker_check!={'EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET':trigger}: raise SystemExit(2)
print(json.dumps({'status':'verified','installed_names':sorted(names),'backup_sha256':hashlib.sha256(before).hexdigest(),'worker_file_verified':True},separators=(',',':')))
PY
`;
}

export function configurationRestoreScript() {
  return String.raw`
python3 - <<'PY'
import hashlib,os,stat,tempfile
from pathlib import Path
root=Path('/opt/evo-crm/.env.production'); worker=Path('/opt/evo-crm/.env.manual-send-worker'); backup=Path('${CONFIG_ROLLBACK_ROOT}')
def regular(path):
    st=path.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or stat.S_IMODE(st.st_mode)!=0o600 or st.st_uid!=0 or st.st_gid!=0: raise SystemExit(2)
def install(source,target):
    regular(source)
    fd,tmp=tempfile.mkstemp(prefix=target.name+'.restore-',dir=target.parent)
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(source.read_bytes()); handle.flush(); os.fsync(handle.fileno())
        os.chmod(tmp,0o600); os.chown(tmp,0,0); os.replace(tmp,target)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    regular(target)
source=backup/'env.production.before'; install(source,root)
state=(backup/'worker.prestate').read_text().strip()
if state=='present': install(backup/'env.manual-send-worker.before',worker)
elif state=='absent':
    if worker.exists() or worker.is_symlink(): worker.unlink()
else: raise SystemExit(2)
if hashlib.sha256(root.read_bytes()).digest()!=hashlib.sha256(source.read_bytes()).digest(): raise SystemExit(2)
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

function stageFinalizeScript() {
  return String.raw`
umask 077
[[ "$(stat -c '%U:%G %a' '${RELEASE_ROOT}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${REMOTE_REPO}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${REMOTE_ARCHIVES}')" == 'root:root 700' ]]
[[ "$(stat -c '%U:%G %a' '${KNOWLEDGE_REMOTE}')" == 'root:root 700' ]]
[[ -f '${RELEASE_ROOT}/repo.tar' && ! -L '${RELEASE_ROOT}/repo.tar' ]]
tar -xf '${RELEASE_ROOT}/repo.tar' -C '${REMOTE_REPO}'
rm -f '${RELEASE_ROOT}/repo.tar'
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
[[ "$(docker image inspect '${spec.sourceTag}' --format '{{.Id}}')" == '${spec.platform}' ]]
[[ "$(docker image inspect '${spec.sourceTag}' --format '{{.Os}}/{{.Architecture}}/{{.Variant}}')" == 'linux/amd64/' ]]
[[ "$(docker image inspect '${spec.sourceTag}' --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == '${P8V3.applicationCommit}' ]]
docker image tag '${spec.platform}' '${spec.composeTag}'
[[ "$(docker image inspect '${spec.composeTag}' --format '{{.Id}}')" == '${spec.platform}' ]]
`).join("\n");
  return `${rows}\n`;
}

function safeMigrationEnvironment(environment) {
  const child = safeChildEnvironment(environment);
  child.SUPABASE_ACCESS_TOKEN = environment.SUPABASE_ACCESS_TOKEN;
  return child;
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
    const root = mkdtempSync(join(tmpdir(), `evo-p8v3-${audience}-`));
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

function importerCreateScript() {
  return String.raw`
if docker container ls -a --format '{{.Names}}' | grep -Fx '${IMPORTER}' >/dev/null; then exit 2; fi
docker create --name '${IMPORTER}' --env-file /opt/evo-crm/.env.production --entrypoint /bin/sh '${P8V3_IMAGES.crm.composeTag}' -c 'sleep 7200' >/dev/null
docker start '${IMPORTER}' >/dev/null
[[ "$(docker inspect '${IMPORTER}' --format '{{.Image}}')" == '${P8V3_IMAGES.crm.platform}' ]]
[[ "$(docker inspect '${IMPORTER}' --format '{{.State.Running}}')" == 'true' ]]
docker exec '${IMPORTER}' node .next/platform-knowledge-import.mjs --verify-runtime | grep -Fx '{"status":"knowledge_import_runtime_verified","version":1}' >/dev/null
`;
}

function knowledgeCopyScript(item) {
  return String.raw`
[[ "$(sha256sum '${KNOWLEDGE_REMOTE}/${item.bundleName}' | awk '{print $1}')" == '${item.bundleSha256}' ]]
[[ "$(sha256sum '${KNOWLEDGE_REMOTE}/${item.manifestName}' | awk '{print $1}')" == '${item.manifestSha256}' ]]
chmod 0644 '${KNOWLEDGE_REMOTE}/${item.bundleName}' '${KNOWLEDGE_REMOTE}/${item.manifestName}'
docker cp '${KNOWLEDGE_REMOTE}/${item.bundleName}' '${IMPORTER}:/tmp/${item.bundleName}'
docker cp '${KNOWLEDGE_REMOTE}/${item.manifestName}' '${IMPORTER}:/tmp/${item.manifestName}'
[[ "$(docker exec '${IMPORTER}' sha256sum '/tmp/${item.bundleName}' | awk '{print $1}')" == '${item.bundleSha256}' ]]
[[ "$(docker exec '${IMPORTER}' sha256sum '/tmp/${item.manifestName}' | awk '{print $1}')" == '${item.manifestSha256}' ]]
`;
}

function importCommand(item) {
  return String.raw`
IFS= read -r EVO_KNOWLEDGE_ACCOUNT_ID
[[ "$EVO_KNOWLEDGE_ACCOUNT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
docker exec '${IMPORTER}' node .next/platform-knowledge-import.mjs --audience '${item.audience}' --bundle '/tmp/${item.bundleName}' --manifest '/tmp/${item.manifestName}' --account-id "$EVO_KNOWLEDGE_ACCOUNT_ID"
`;
}

function knowledgeCleanupScript() {
  return String.raw`
set +e
errors=0
if docker container ls -a --format '{{.Names}}' | grep -Fx '${IMPORTER}' >/dev/null; then docker rm -f '${IMPORTER}' >/dev/null || errors=1; fi
find '${KNOWLEDGE_REMOTE}' -mindepth 1 -maxdepth 1 -type f -delete || errors=1
[[ -z "$(find '${KNOWLEDGE_REMOTE}' -mindepth 1 -maxdepth 1 -print -quit)" ]] || errors=1
docker container ls -a --format '{{.Names}}' | grep -Fx '${IMPORTER}' >/dev/null && errors=1
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
  const services = name === "crm" ? "app manual-send-worker" : spec.service;
  return String.raw`
${composeEnvironment(name)}
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
if docker container ls -a --format '{{.Names}}' | grep -Fx evo-crm-manual-send-worker >/dev/null; then
  [[ "$(docker inspect evo-crm-manual-send-worker --format '{{.Image}}')" == '${P8V3_IMAGES.crm.platform}' ]]
  docker rm -f evo-crm-manual-send-worker >/dev/null
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
[[ "$(find '${EVIDENCE_ROOT}' -mindepth 1 -maxdepth 1 -type f -printf '%f\n')" == 'p8v3-rollout-result.json' ]]
`;
}

export function renderP8V3ShellContractsForTest() {
  return Object.freeze({
    preflight: preflightRemoteScript(),
    configurationInstall: configurationInstallScript(),
    configurationRestore: configurationRestoreScript(),
    stagePrepare: stagePrepareScript(),
    stageFinalize: stageFinalizeScript(),
    loadImages: loadImagesScript(),
    importerCreate: importerCreateScript(),
    knowledgeCleanup: knowledgeCleanupScript(),
    deployCrm: deployScript("crm"),
    deployInbox: deployScript("inbox"),
    deployLead: deployScript("lead_agent"),
    rollbackCrm: rollbackScript("crm"),
    rollbackInbox: rollbackScript("inbox"),
    rollbackLead: rollbackScript("lead_agent"),
    evidence: atomicEvidenceScript("/opt/evo-release-evidence/.p8v3-test-incoming", "a".repeat(64)),
  });
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
  if (mode === "execute" && environment.EVO_P8V3_AUTHORIZATION !== P8V3.authorization) fail("P8V3 authorization is missing", "preflight_drift");
  if (mode === "execute" && (!environment.EVO_P8V3_SUPABASE_URL || !environment.EVO_P8V3_SUPABASE_SERVICE_ROLE_KEY)) fail("P8V3 Supabase runtime credentials are missing", "preflight_drift");
  if (mode === "execute" && environment.EVO_P8V3_SUPABASE_URL !== PROJECT_URL) fail("P8V3 Supabase project drifted", "preflight_drift");
  const cli = realpathSync(resolve(supabaseCliPath));
  assertRegular(cli, 0o755);
  const management = createManagementClient({ accessToken: environment.SUPABASE_ACCESS_TOKEN, fetchImpl });
  const state = {
    accountId: null,
    staged: false,
    importerCreated: false,
    localRoots: [],
    built: new Map(),
    preState: null,
    evidenceIncoming: null,
    evidenceHash: null,
    localEvidenceWritten: false,
  };

  async function rest(path) {
    const key = environment.EVO_P8V3_SUPABASE_SERVICE_ROLE_KEY;
    return boundedRestJson(await fetchImpl(`${PROJECT_URL}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "platform" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }), path);
  }

  async function resolveAccount() {
    if (state.accountId) return state.accountId;
    const rows = await rest("/rest/v1/ai_configs?select=account_id&is_active=eq.true&limit=2");
    if (!Array.isArray(rows) || rows.length !== 1 || !UUID.test(rows[0].account_id)) fail("live account is not singular", "knowledge_failed");
    state.accountId = rows[0].account_id;
    return state.accountId;
  }

  async function ensureStaged(deadlineAt) {
    if (state.staged) return;
    for (const spec of Object.values(P8V3_IMAGES)) validateArchive(join(candidates, spec.file), spec);
    remote(run, stagePrepareScript(), { timeout: remaining(deadlineAt), label: "P8V3 staging root", code: "knowledge_failed" });
    const temp = mkdtempSync(join(tmpdir(), "evo-p8v3-repo-"));
    try {
      const archive = join(temp, "repo.tar");
      runChecked(run, "application archive", "git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, P8V3.applicationCommit], { timeout: 120_000, code: "knowledge_failed" });
      chmodSync(archive, 0o600);
      runChecked(run, "repository transfer", "scp", [archive, `${HERMES}:${RELEASE_ROOT}/repo.tar`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
    } finally { rmSync(temp, { recursive: true, force: true }); }
    for (const spec of Object.values(P8V3_IMAGES)) runChecked(run, `${spec.name} archive transfer`, "scp", [join(candidates, spec.file), `${HERMES}:${REMOTE_ARCHIVES}/${spec.file}`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
    remote(run, `${stageFinalizeScript()}\n${loadImagesScript()}`, { timeout: remaining(deadlineAt), label: "P8V3 staging", code: "knowledge_failed" });
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
      const cliVersion = runChecked(run, "Supabase CLI version", cli, ["--version"], { code: "preflight_drift" }).stdout.trim();
      if (cliVersion !== CLI_VERSION) fail("Supabase CLI version drifted", "preflight_drift");
      for (const spec of Object.values(P8V3_IMAGES)) validateArchive(join(candidates, spec.file), spec);
      validateCandidateCompose(run, source);
      if (sha256(readFileSync(join(source, "supabase/migrations/077_platform_manual_whatsapp_send_worker.sql"))) !== "4a271dea4a3b5f1570c57cb4b094a13a057ca3cacc38b1d449a4925757299314") fail("migration 077 drifted", "preflight_drift");
      const ledger = await readLedger(management);
      if (ledger.range !== "001-076" || ledger.count !== 76) fail("production migration ledger drifted", "preflight_drift");
      const output = remote(run, preflightRemoteScript(), { timeout: 120_000, label: "minimal production preflight", code: "preflight_drift" }).stdout;
      const inventory = output.split("\n").filter((line) => line.split("|").length === 6).join("\n");
      const containers = parseContainerRows(inventory);
      const wahaCrm = containers.find((item) => item.name === "evo-crm-waha-1");
      const wahaInbox = containers.find((item) => item.name === "evo-inbox-waha");
      state.preState = containers;
      return {
        containers,
        waha: { crm_container_id: wahaCrm.container_id, crm_image_id: wahaCrm.image_id, inbox_container_id: wahaInbox.container_id, inbox_image_id: wahaInbox.image_id, unchanged: false },
        migration: ledger,
        archives: Object.values(P8V3_IMAGES).map(({ name, sha256: archiveSha256, size, index, platform }) => ({ name, sha256: archiveSha256, size, index, platform })),
        compose_validated: true,
        prerequisites_verified: output.includes("prerequisites_verified\n"),
      };
    },

    async verifyPreflight(snapshot) {
      if (Date.now() >= Date.parse(snapshot.expires_at)) fail("P8V3 preflight expired", "preflight_drift");
      const expectedArchives = Object.values(P8V3_IMAGES).map(({ name, sha256: archiveSha256, size, index, platform }) => ({ name, sha256: archiveSha256, size, index, platform }));
      if (JSON.stringify(snapshot.archives) !== JSON.stringify(expectedArchives)) fail("P8V3 preflight archive identity drifted", "preflight_drift");
      const ledger = await readLedger(management);
      if (ledger.range !== "001-076" || ledger.count !== 76) fail("production migration ledger changed after preflight", "preflight_drift");
      const output = remote(run, preflightRemoteScript(), { timeout: 120_000, label: "production preflight revalidation", code: "preflight_drift" }).stdout;
      const inventory = output.split("\n").filter((line) => line.split("|").length === 6).join("\n");
      const containers = parseContainerRows(inventory);
      if (JSON.stringify(containers) !== JSON.stringify(snapshot.containers)) fail("production containers changed after preflight", "preflight_drift");
      state.preState = containers;
      return { status: "verified" };
    },

    async configure({ deadlineAt }) {
      const output = remote(run, configurationInstallScript(), { timeout: remaining(deadlineAt), label: "P8V3 configuration install", code: "configuration_failed" }).stdout.trim().split("\n").at(-1);
      const record = parseJson(output, "configuration result");
      exactKeys(record, ["status", "installed_names", "backup_sha256", "worker_file_verified"], "configuration result");
      return record;
    },

    async restoreConfiguration() {
      remote(run, configurationRestoreScript(), { timeout: 120_000, label: "P8V3 configuration restore", code: "rollback_failed" });
      return { configuration_restored: true };
    },

    async migrate({ deadlineAt }) {
      const before = await readLedger(management);
      if (before.range !== "001-076" || before.count !== 76) fail("migration pre-state drifted", "migration_failed");
      const temp = mkdtempSync(join(tmpdir(), "evo-p8v3-migration-"));
      const archive = join(temp, "repo.tar");
      const repo = join(temp, "repo");
      let linked = false;
      let applyAttempted = false;
      let operationError;
      try {
        runChecked(run, "migration source archive", "git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, "HEAD"], { timeout: remaining(deadlineAt), code: "migration_failed" });
        runChecked(run, "migration source directory", "mkdir", ["-m", "700", repo], { code: "migration_failed" });
        runChecked(run, "migration source extract", "tar", ["-xf", archive, "-C", repo], { code: "migration_failed" });
        const child = safeMigrationEnvironment(environment);
        linked = true;
        runChecked(run, "Supabase link", cli, ["link", "--project-ref", PROJECT_REF, "--workdir", repo, "--yes"], { cwd: repo, env: child, timeout: remaining(deadlineAt), code: "migration_failed" });
        const dry = runChecked(run, "migration dry-run", cli, ["db", "push", "--linked", "--dry-run", "--workdir", repo, "--yes"], { cwd: repo, env: child, timeout: remaining(deadlineAt), code: "migration_failed" });
        if (parseDryRunOutput(dry.stdout, dry.stderr).join() !== "077_platform_manual_whatsapp_send_worker.sql") fail("migration dry-run drifted", "migration_failed");
        applyAttempted = true;
        runChecked(run, "migration apply", cli, ["db", "push", "--linked", "--workdir", repo, "--yes"], { cwd: repo, env: child, timeout: remaining(deadlineAt), code: "migration_failed" });
      } catch (error) { operationError = error; }
      let cleanupError;
      if (linked) {
        try { await management(`/v1/projects/${PROJECT_REF}/cli/login-role`, { method: "DELETE", expectedStatus: 200 }); } catch (error) { cleanupError = error; }
      }
      rmSync(temp, { recursive: true, force: true });
      const after = await readLedger(management);
      if (applyAttempted && after.range === "001-077" && after.count === 77 && (operationError || cleanupError)) {
        const error = cleanupError ?? operationError;
        error.code = cleanupError ? "rollback_failed" : "migration_failed";
        error.migrationRecord = { status: "observed_applied", before_range: before.range, before_count: before.count, after_range: after.range, after_count: after.count, applied_versions: ["077"] };
        throw error;
      }
      if (operationError || cleanupError || after.range !== "001-077" || after.count !== 77) fail("migration 077 failed or did not verify", cleanupError ? "rollback_failed" : "migration_failed");
      return { status: "verified", before_range: before.range, before_count: before.count, after_range: after.range, after_count: after.count, applied_versions: ["077"] };
    },

    async importKnowledge(audience, { deadlineAt }) {
      const accountId = await resolveAccount();
      await ensureStaged(deadlineAt);
      if (!state.importerCreated) {
        remote(run, importerCreateScript(), { timeout: remaining(deadlineAt), label: "knowledge importer creation", code: "knowledge_failed" });
        state.importerCreated = true;
      }
      const vault = audience === "client" ? CLIENT_VAULT : INTERNAL_VAULT;
      const item = buildAudience(run, source, accountId, audience, vault, state.localRoots);
      state.built.set(audience, item);
      for (const file of [item.bundleName, item.manifestName]) runChecked(run, `${audience} knowledge transfer`, "scp", [join(item.root, file), `${HERMES}:${KNOWLEDGE_REMOTE}/${file}`], { timeout: remaining(deadlineAt), code: "knowledge_failed" });
      remote(run, knowledgeCopyScript(item), { timeout: remaining(deadlineAt), label: `${audience} knowledge copy`, code: "knowledge_failed" });
      const imported = run("ssh", ["-o", "BatchMode=yes", HERMES, "bash", "-seu", "-c", shellQuote(importCommand(item))], { input: `${accountId}\n`, timeout: remaining(deadlineAt), label: `${audience} knowledge import`, code: "knowledge_failed" });
      const safe = parseJson(imported.stdout.trim().split("\n").at(-1), `${audience} importer result`);
      exactKeys(safe, ["status", "version", "audience", "bundle_sha256", "documents_upserted", "documents_deleted", "chunks_replaced"], "importer result");
      if (safe.status !== "knowledge_import_verified" || safe.version !== 1 || safe.audience !== audience || safe.bundle_sha256 !== item.bundleSha256) fail(`${audience} importer result drifted`, "knowledge_failed");
      const params = new URLSearchParams({ select: "audience,bundle_sha256,document_count,chunk_count", account_id: `eq.${accountId}`, audience: `eq.${audience}` });
      const revisions = await rest(`/rest/v1/ai_knowledge_bundle_revisions?${params}`);
      if (!Array.isArray(revisions) || revisions.length !== 1 || revisions[0].bundle_sha256 !== item.bundleSha256 || Number(revisions[0].document_count) !== item.documentCount || !Number.isSafeInteger(Number(revisions[0].chunk_count)) || Number(revisions[0].chunk_count) < 1) fail(`${audience} database revision drifted`, "knowledge_failed");
      const chunkCount = Number(revisions[0].chunk_count);
      return { name: audience, status: "verified", document_count: item.documentCount, chunk_count: chunkCount, bundle_sha256: item.bundleSha256, manifest_sha256: item.manifestSha256, database_revision_sha256: sha256(Buffer.from(JSON.stringify({ audience, bundle_sha256: item.bundleSha256, document_count: item.documentCount, chunk_count: chunkCount }))) };
    },

    async cleanupKnowledge() {
      let error;
      try { remote(run, knowledgeCleanupScript(), { timeout: 120_000, label: "knowledge cleanup", code: "knowledge_failed" }); } catch (caught) { error = caught; }
      for (const root of state.localRoots.splice(0)) {
        try { rmSync(root, { recursive: true, force: false }); } catch (caught) { error ??= caught; }
      }
      state.importerCreated = false;
      if (error) throw error;
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
      const incoming = `/opt/evo-release-evidence/.p8v3-result-${randomBytes(12).toString("hex")}`;
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
