#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const P8V2H = Object.freeze({
  version: "p8v2h-supabase-bootstrap-result/v1",
  authorization: "CONFIGURE-P8V2H-2026-08-19.P8V2H.1",
  requestAuthorization: "CONFIGURE-P8V2G-2026-08-19.P8V2G.1",
  projectRef: "iosckaqtovbbnssqcpde",
  projectUrl: "https://iosckaqtovbbnssqcpde.supabase.co",
  organizationName: "EVO Admissions",
  adminDisplayName: "EVO Admissions Admin",
  reason: "P8V2G production Platform bootstrap",
  beforeSchemas: "public,graphql_public",
  afterSchemas: "public,platform,graphql_public",
  remoteRoot: "/opt/evo-release-evidence/p8v2h-supabase-bootstrap-20260819",
  remoteEnv: "/opt/evo-crm/.env.production",
  resultRoot: ".evo-release-evidence/p8v2h-supabase-bootstrap-20260819",
  resultName: "p8v2h-supabase-bootstrap-result.json",
});

// Keep the historical exports while P8V2H advances only writable identities
// and the fixed PostgREST reload seam.
export const P8V2G = P8V2H;
export const P8V2F = P8V2H;

export const P8V2G_READINESS = Object.freeze({
  maxAttempts: 12,
  delayMs: 1_000,
  deadlineMs: 30_000,
});

export const P8V2H_POSTGREST_RELOAD_SQL = "NOTIFY pgrst, 'reload config'; NOTIFY pgrst, 'reload schema';";

const MANAGEMENT_ORIGIN = "https://api.supabase.com";
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_HTTP_BYTES = 64 * 1024;
const MAX_REMOTE_BYTES = 16 * 1024;
const TARGET_KEYS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EVO_PLATFORM_SUPABASE_SECRET_KEY",
  "EVO_PLATFORM_ORGANIZATION_ID",
  "EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID",
]);
const ZERO_EFFECTS = Object.freeze({
  migrations_applied: 0,
  knowledge_imports: 0,
  deployments: 0,
  restarts: 0,
  provider_calls: 0,
  outbound_sends: 0,
});

function fail(message, code = "configuration_failed") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is not an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} keys drifted`);
}

async function boundedResponseBytes(response, label) {
  if (!response.body || typeof response.body.getReader !== "function") fail(`${label} response body unavailable`);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_HTTP_BYTES) {
      await reader.cancel();
      fail(`${label} response too large`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

function parseJsonBytes(bytes, label) {
  try {
    return bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
  } catch {
    fail(`${label} returned malformed JSON`);
  }
}

async function boundedJson(response, expectedStatus, label) {
  const bytes = await boundedResponseBytes(response, label);
  if (response.status !== expectedStatus) fail(`${label} returned HTTP ${response.status}`);
  return parseJsonBytes(bytes, label);
}

function safeRaw(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/.test(text) || /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/.test(text) || /(?:token|secret|password|email|authorization)["'=:\s]/i.test(text) || /\/opt\/|\/Users\//.test(text)) {
    fail("safe evidence contains private material", "evidence_failed");
  }
}

function requireCredential(environment, name, pattern) {
  const value = environment[name];
  if (typeof value !== "string" || !pattern.test(value)) fail(`${name} is missing or malformed`);
  return value;
}

function deterministicRequestId() {
  const bytes = Buffer.from(sha256(`${P8V2F.requestAuthorization}:${P8V2F.projectRef}`), "hex").subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    maxBuffer: 1_000_000,
  });
  return { status: result.status, signal: result.signal, error: result.error, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function requireRun(result, label) {
  if (result.error || result.signal || result.status !== 0 || result.stderr !== "") fail(`${label} failed`);
  return result.stdout;
}

export function verifyP8V2FExecution(toolRoot, reviewedCommit, run = defaultRun) {
  if (!SHA40.test(reviewedCommit)) fail("reviewed commit is malformed");
  const status = requireRun(run("git", ["-C", toolRoot, "status", "--porcelain"]), "worktree status");
  const head = requireRun(run("git", ["-C", toolRoot, "rev-parse", "HEAD"]), "HEAD").trim();
  const tree = requireRun(run("git", ["-C", toolRoot, "rev-parse", "HEAD^{tree}"]), "tree").trim();
  const origin = requireRun(run("git", ["-C", toolRoot, "rev-parse", "origin/main"]), "origin main").trim();
  const live = requireRun(run("gh", ["api", "repos/izzhackt/evo_AI_CRM/commits/main", "--jq", ".sha"]), "live main").trim();
  if (status || head !== reviewedCommit || head !== origin || head !== live || !SHA40.test(tree)) fail("execution checkout drifted");
  const rows = JSON.parse(requireRun(run("gh", ["run", "list", "--repo", "izzhackt/evo_AI_CRM", "--workflow", "EVO platform CI", "--commit", head, "--event", "push", "--status", "success", "--limit", "2", "--json", "databaseId,headSha,status,conclusion,workflowName"]), "exact-main CI"));
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].headSha !== head || rows[0].workflowName !== "EVO platform CI" || rows[0].status !== "completed" || rows[0].conclusion !== "success" || !Number.isInteger(rows[0].databaseId)) fail("exact-main CI drifted");
  return { commit: head, tree, ci_run_id: rows[0].databaseId };
}

export function createP8V2FClient({ accessToken, fetchImpl = fetch }) {
  if (!/^sbp_[A-Za-z0-9_-]{20,}$/.test(accessToken ?? "")) fail("SUPABASE_ACCESS_TOKEN is missing or malformed");
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async function request(path, { method = "GET", body, expectedStatus = 200 } = {}) {
    const projectPath = `/v1/projects/${P8V2F.projectRef}`;
    if (path !== projectPath && !path.startsWith(`${projectPath}/`)) fail("Management API path escaped project");
    return boundedJson(await fetchImpl(`${MANAGEMENT_ORIGIN}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }), expectedStatus, `${method} ${path}`);
  };
}

const IDENTITY_SQL = `select kind, id, name, related_id, role, status, audit_count from (
select 'auth'::text kind, id::text, ''::text name, ''::text related_id, ''::text role, ''::text status, 0::int audit_count from (select id from auth.users order by created_at, id limit 2) x
union all
select 'account', account_id::text, '', '', '', '', 0 from (select distinct account_id from public.ai_configs where is_active is true order by account_id limit 2) x
union all
select 'organization', x.id::text, x.name, x.auth_user_id::text, x.current_role::text, x.membership_status::text, x.audit_count
from (
  select o.id, o.name, p.auth_user_id, m.current_role, m.status as membership_status,
    (select count(*)::int from platform.audit_events a where a.organization_id=o.id and a.action='organization.bootstrap') as audit_count
  from platform.organizations o
  join platform.organization_memberships m on m.organization_id=o.id and m.status='active'
  join platform.profiles p on p.id=m.profile_id
  where o.status='active'
  order by o.id limit 2
) x
) rows order by kind, id`;

const LEDGER_SQL = "select count(*)::int as count, min(version)::text as first, max(version)::text as last from supabase_migrations.schema_migrations";
const PLATFORM_COUNTS_SQL = "select (select count(*)::int from platform.organizations) as organizations, (select count(*)::int from platform.profiles) as profiles, (select count(*)::int from platform.organization_memberships) as memberships";

export async function readP8V2FState(request) {
  const project = await request(`/v1/projects/${P8V2F.projectRef}`);
  if (project?.ref !== P8V2F.projectRef || project?.status !== "ACTIVE_HEALTHY") fail("project drifted");
  const postgrest = await request(`/v1/projects/${P8V2F.projectRef}/postgrest`);
  if (typeof postgrest?.db_schema !== "string") fail("PostgREST config drifted");
  const rows = await request(`/v1/projects/${P8V2F.projectRef}/database/query/read-only`, { method: "POST", body: { query: IDENTITY_SQL }, expectedStatus: 201 });
  if (!Array.isArray(rows) || rows.length > 6) fail("identity cardinality drifted");
  const grouped = { auth: [], account: [], organization: [] };
  for (const row of rows) {
    exactKeys(row, ["kind", "id", "name", "related_id", "role", "status", "audit_count"], "identity row");
    if (!Object.hasOwn(grouped, row.kind) || !UUID.test(row.id) || grouped[row.kind].some((item) => item.id === row.id)) fail("identity row drifted");
    if (row.kind !== "organization" && (row.name || row.related_id || row.role || row.status || Number(row.audit_count) !== 0)) fail("identity projection drifted");
    if (row.kind === "organization" && (!UUID.test(row.related_id) || !Number.isInteger(Number(row.audit_count)))) fail("organization projection drifted");
    grouped[row.kind].push({ ...row, audit_count: Number(row.audit_count) });
  }
  const ledgerRows = await request(`/v1/projects/${P8V2F.projectRef}/database/query/read-only`, { method: "POST", body: { query: LEDGER_SQL }, expectedStatus: 201 });
  if (!Array.isArray(ledgerRows) || ledgerRows.length !== 1) fail("ledger cardinality drifted");
  exactKeys(ledgerRows[0], ["count", "first", "last"], "ledger row");
  const countRows = await request(`/v1/projects/${P8V2F.projectRef}/database/query/read-only`, { method: "POST", body: { query: PLATFORM_COUNTS_SQL }, expectedStatus: 201 });
  if (!Array.isArray(countRows) || countRows.length !== 1) fail("Platform identity counts drifted");
  exactKeys(countRows[0], ["organizations", "profiles", "memberships"], "Platform counts row");
  const counts = Object.fromEntries(Object.entries(countRows[0]).map(([key, value]) => [key, Number(value)]));
  if (Object.values(counts).some((value) => !Number.isInteger(value) || value < 0 || value > 2)) fail("Platform identity counts drifted");
  return {
    project: { ref_match: true, status: "ACTIVE_HEALTHY" },
    postgrest: postgrest.db_schema.split(",").map((value) => value.trim()).filter(Boolean).join(","),
    grouped,
    counts,
    ledger: { count: Number(ledgerRows[0].count), first: ledgerRows[0].first, last: ledgerRows[0].last },
  };
}

function requireLedger(state) {
  if (state.ledger.count !== 76 || state.ledger.first !== "001" || state.ledger.last !== "076") fail("migration ledger drifted");
}

export function validateInitialState(state) {
  requireLedger(state);
  if (state.postgrest !== P8V2F.beforeSchemas || state.grouped.auth.length !== 1 || state.grouped.account.length !== 1 || state.grouped.organization.length !== 0 || state.counts.organizations !== 0 || state.counts.profiles !== 0 || state.counts.memberships !== 0) fail("initial identity/configuration state drifted");
  return { authUserId: state.grouped.auth[0].id, accountId: state.grouped.account[0].id };
}

export function classifyP8V2FState(state) {
  requireLedger(state);
  if (state.grouped.auth.length !== 1 || state.grouped.account.length !== 1) fail("identity cardinality drifted");
  const authUserId = state.grouped.auth[0].id;
  const accountId = state.grouped.account[0].id;
  if (state.postgrest === P8V2F.beforeSchemas && state.grouped.organization.length === 0) {
    const exact = validateInitialState(state);
    return { mode: "initial", ...exact, organizationId: null };
  }
  if (state.postgrest === P8V2F.afterSchemas) {
    const { organizationId } = validatePreparedState(state, authUserId, accountId);
    return { mode: "prepared", authUserId, accountId, organizationId };
  }
  fail("initial/prepared state drifted", "configuration_reconciliation_required");
}

export function validatePreparedState(state, authUserId, accountId) {
  requireLedger(state);
  const organization = state.grouped.organization[0];
  if (state.postgrest !== P8V2F.afterSchemas || state.grouped.auth.length !== 1 || state.grouped.auth[0].id !== authUserId || state.grouped.account.length !== 1 || state.grouped.account[0].id !== accountId || state.grouped.organization.length !== 1 || state.counts.organizations !== 1 || state.counts.profiles !== 1 || state.counts.memberships !== 1 || organization.name !== P8V2F.organizationName || organization.related_id !== authUserId || organization.role !== "admin" || organization.status !== "active" || organization.audit_count !== 1) fail("prepared identity/configuration state drifted", "configuration_reconciliation_required");
  return { organizationId: organization.id };
}

export function provesP8V2FNoBootstrap(state, authUserId, accountId) {
  try { requireLedger(state); } catch { return false; }
  return [P8V2F.beforeSchemas, P8V2F.afterSchemas].includes(state.postgrest)
    && state.grouped.auth.length === 1
    && state.grouped.auth[0].id === authUserId
    && state.grouped.account.length === 1
    && state.grouped.account[0].id === accountId
    && state.grouped.organization.length === 0
    && state.counts.organizations === 0
    && state.counts.profiles === 0
    && state.counts.memberships === 0;
}

export async function patchP8V2FPostgrest(request, dbSchema) {
  const payload = await request(`/v1/projects/${P8V2F.projectRef}/postgrest`, { method: "PATCH", body: { db_schema: dbSchema }, expectedStatus: 200 });
  if (payload?.db_schema?.split(",").map((value) => value.trim()).filter(Boolean).join(",") !== dbSchema) fail("PostgREST patch drifted");
}

export async function reloadP8V2HPostgrest(request) {
  const payload = await request(`/v1/projects/${P8V2F.projectRef}/database/query`, {
    method: "POST",
    body: { query: P8V2H_POSTGREST_RELOAD_SQL, read_only: false },
    expectedStatus: 201,
  });
  if (payload === undefined || payload === null) fail("PostgREST reload response drifted");
  return "reloaded";
}

export async function bootstrapP8V2FOrganization(secretKey, authUserId, fetchImpl = fetch, {
  now = () => performance.now(),
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
} = {}) {
  if (!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secretKey ?? "") || !UUID.test(authUserId)) fail("bootstrap credentials/identity drifted");
  const body = {
    p_organization_name: P8V2F.organizationName,
    p_admin_auth_user_id: authUserId,
    p_admin_display_name: P8V2F.adminDisplayName,
    p_reason: P8V2F.reason,
    p_request_id: deterministicRequestId(),
  };
  const url = `${P8V2F.projectUrl}/rest/v1/rpc/bootstrap_organization_admin`;
  const serializedBody = JSON.stringify(body);
  const headers = Object.freeze({
    apikey: secretKey,
    "Content-Type": "application/json",
    "Content-Profile": "platform",
    "Accept-Profile": "platform",
  });
  const deadline = now() + P8V2G_READINESS.deadlineMs;

  for (let attempt = 1; attempt <= P8V2G_READINESS.maxAttempts; attempt += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) fail("PostgREST readiness deadline exhausted");
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: serializedBody,
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, Math.floor(remaining)))),
    });
    const bytes = await boundedResponseBytes(response, "organization bootstrap");
    if (now() >= deadline) fail("PostgREST readiness deadline exhausted");
    if (response.status === 200) {
      const result = parseJsonBytes(bytes, "organization bootstrap");
      if (!result || result.organization_name !== P8V2F.organizationName || result.admin_auth_user_id !== authUserId || result.role !== "admin" || result.status !== "active") fail("organization bootstrap response drifted", "configuration_reconciliation_required");
      return { status: "created", attempts: attempt };
    }
    if (response.status !== 406) fail(`organization bootstrap returned HTTP ${response.status}`);
    const readiness = parseJsonBytes(bytes, "organization bootstrap");
    if (!readiness || readiness.code !== "PGRST106") fail("organization bootstrap returned non-readiness HTTP 406");
    if (attempt === P8V2G_READINESS.maxAttempts) fail("PostgREST readiness attempts exhausted");
    if (deadline - now() <= P8V2G_READINESS.delayMs) fail("PostgREST readiness deadline cannot cover delay");
    await wait(P8V2G_READINESS.delayMs);
    if (now() >= deadline) fail("PostgREST readiness deadline exhausted");
  }
  fail("PostgREST readiness attempts exhausted");
}

export async function verifyP8V2FProjectKey(key, kind, fetchImpl = fetch) {
  const patterns = {
    publishable: /^sb_publishable_[A-Za-z0-9_-]{20,}$/,
    secret: /^sb_secret_[A-Za-z0-9_-]{20,}$/,
  };
  if (!patterns[kind]?.test(key ?? "")) fail(`${kind} key is malformed`);
  const response = await fetchImpl(`${P8V2F.projectUrl}/auth/v1/settings`, {
    headers: { apikey: key },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await boundedJson(response, 200, `${kind} key project probe`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail(`${kind} key project probe drifted`);
  return "verified";
}

export function createP8V2FHermesScript({ envPath = P8V2F.remoteEnv, rollbackRoot = P8V2F.remoteRoot, requiredUid = 0, requiredGid = 0, requiredParentMode = 0o755 } = {}) {
  return `import hashlib,json,os,pathlib,re,shutil,stat,sys,tempfile
ENV=pathlib.Path(${JSON.stringify(envPath)}); ROOT=pathlib.Path(${JSON.stringify(rollbackRoot)}); BACK=ROOT/'crm-env.production.before'
KEYS=${JSON.stringify(TARGET_KEYS)}
ENABLE=['EVO_PLATFORM_STAFF_ASSISTANT_ENABLED','EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED','EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED','EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED']
def die(): raise RuntimeError('blocked')
def unique(items):
 out={}
 for k,v in items:
  if k in out: die()
  out[k]=v
 return out
raw=sys.stdin.buffer.read(${MAX_REMOTE_BYTES + 1})
if len(raw)>${MAX_REMOTE_BYTES}: die()
payload=json.loads(raw,object_pairs_hook=unique)
if set(payload)!=set(KEYS): die()
if payload['NEXT_PUBLIC_SUPABASE_URL']!=${JSON.stringify(P8V2F.projectUrl)}: die()
if not re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]{20,}',payload['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']): die()
if not re.fullmatch(r'sb_secret_[A-Za-z0-9_-]{20,}',payload['EVO_PLATFORM_SUPABASE_SECRET_KEY']): die()
for k in ['EVO_PLATFORM_ORGANIZATION_ID','EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID']:
 if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',payload[k]): die()
for parent in [ENV.parent,ROOT.parent]:
 ps=parent.lstat()
 if parent.is_symlink() or not parent.is_dir() or ps.st_uid!=${requiredUid} or ps.st_gid!=${requiredGid} or stat.S_IMODE(ps.st_mode)!=${requiredParentMode} or parent.resolve(strict=True)!=parent: die()
s=ENV.lstat()
if not stat.S_ISREG(s.st_mode) or ENV.is_symlink() or s.st_uid!=${requiredUid} or s.st_gid!=${requiredGid} or stat.S_IMODE(s.st_mode)!=0o600: die()
original=ENV.read_bytes()
text=original.decode('utf-8')
parsed={}
for line in text.splitlines():
 if not line or line.lstrip().startswith('#'): continue
 if '=' not in line: die()
 k,v=line.split('=',1)
 if not k or k in parsed: die()
 parsed[k]=v
if any(parsed.get(k)=='1' for k in ENABLE): die()
present=[k for k in KEYS if k in parsed]
updated=False
try:
 if present:
  if len(present)!=len(KEYS) or any(parsed[k]!=payload[k] for k in KEYS): die()
  if not ROOT.exists() or ROOT.is_symlink() or not ROOT.is_dir() or ROOT.stat().st_uid!=${requiredUid} or ROOT.stat().st_gid!=${requiredGid} or stat.S_IMODE(ROOT.stat().st_mode)!=0o700: die()
  bs=BACK.lstat()
  if BACK.is_symlink() or not stat.S_ISREG(bs.st_mode) or bs.st_uid!=${requiredUid} or bs.st_gid!=${requiredGid} or stat.S_IMODE(bs.st_mode)!=0o600: die()
  before=BACK.read_bytes()
  before_text=before.decode('utf-8'); before_parsed={}
  for line in before_text.splitlines():
   if not line or line.lstrip().startswith('#'): continue
   if '=' not in line: die()
   k,v=line.split('=',1)
   if not k or k in before_parsed or k in KEYS: die()
   before_parsed[k]=v
  expected=before+(b'' if not before or before.endswith(b'\\n') else b'\\n')+''.join(k+'='+payload[k]+'\\n' for k in KEYS).encode()
  if original!=expected: die()
  status='already_verified'
 else:
  if ROOT.exists():
   rs=ROOT.lstat()
   if ROOT.is_symlink() or not ROOT.is_dir() or rs.st_uid!=${requiredUid} or rs.st_gid!=${requiredGid} or stat.S_IMODE(rs.st_mode)!=0o700: die()
   bs=BACK.lstat()
   if BACK.is_symlink() or not stat.S_ISREG(bs.st_mode) or bs.st_uid!=${requiredUid} or bs.st_gid!=${requiredGid} or stat.S_IMODE(bs.st_mode)!=0o600 or BACK.read_bytes()!=original: die()
  else:
   ROOT.mkdir(mode=0o700)
   os.chown(ROOT,${requiredUid},${requiredGid})
   fd=os.open(BACK,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
   with os.fdopen(fd,'wb') as f: f.write(original); f.flush(); os.fsync(f.fileno())
   os.chown(BACK,${requiredUid},${requiredGid})
  addition=('' if not original or original.endswith(b'\\n') else '\\n')+''.join(k+'='+payload[k]+'\\n' for k in KEYS)
  temp=ENV.with_name('.env.production.p8v2h.tmp')
  fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'wb') as f: f.write(original+addition.encode()); f.flush(); os.fsync(f.fileno())
  os.chown(temp,${requiredUid},${requiredGid}); os.replace(temp,ENV); updated=True; status='updated'
 verify={}
 for line in ENV.read_text().splitlines():
  if not line or line.lstrip().startswith('#'): continue
  k,v=line.split('=',1)
  if k in verify: die()
  verify[k]=v
 if any(verify.get(k)!=payload[k] for k in KEYS) or any(verify.get(k)=='1' for k in ENABLE): die()
 print(json.dumps({'status':status,'settings':5,'file':'root_root_0600','rollback_sha256':hashlib.sha256(BACK.read_bytes()).hexdigest(),'feature_enables':0},separators=(',',':')))
except Exception:
 if updated and BACK.exists():
  temp=ENV.with_name('.env.production.p8v2h.restore.tmp')
  shutil.copyfile(BACK,temp); os.chmod(temp,0o600); os.chown(temp,${requiredUid},${requiredGid}); os.replace(temp,ENV)
  restored=ENV.lstat()
  if ENV.is_symlink() or not stat.S_ISREG(restored.st_mode) or restored.st_uid!=${requiredUid} or restored.st_gid!=${requiredGid} or stat.S_IMODE(restored.st_mode)!=0o600 or ENV.read_bytes()!=BACK.read_bytes(): die()
 raise
`;
}

export function fixedPythonCommand(script) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) fail("remote script encoding drifted");
  return `python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`;
}

export function configureP8V2FHermes(payload, run = defaultRun, script = createP8V2FHermesScript()) {
  exactKeys(payload, TARGET_KEYS, "Hermes payload");
  const command = fixedPythonCommand(script);
  if (Object.values(payload).some((value) => command.includes(value))) fail("secret entered SSH command");
  const result = run("ssh", ["-T", "hermes-vps", command], { input: JSON.stringify(payload), timeout: 30_000 });
  const stdout = requireRun(result, "Hermes configuration");
  if (Object.values(payload).some((value) => stdout.includes(value))) fail("Hermes output leaked private value", "configuration_reconciliation_required");
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { fail("Hermes output malformed", "configuration_reconciliation_required"); }
  exactKeys(parsed, ["status", "settings", "file", "rollback_sha256", "feature_enables"], "Hermes result");
  if (!["updated", "already_verified"].includes(parsed.status) || parsed.settings !== 5 || parsed.file !== "root_root_0600" || !SHA64.test(parsed.rollback_sha256) || parsed.feature_enables !== 0) fail("Hermes result drifted", "configuration_reconciliation_required");
  return parsed;
}

export async function verifyP8V2FPlatformAccess(secretKey, authUserId, fetchImpl = fetch) {
  await bootstrapP8V2FOrganization(secretKey, authUserId, fetchImpl);
  return "verified";
}

export function validateP8V2FResult(result, schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "schemas", "p8v2f-supabase-bootstrap-result.schema.json")) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  if (!validate(result)) fail("result schema validation failed", "evidence_failed");
  safeRaw(JSON.stringify(result));
  return result;
}

function ensureEvidenceParent(parent) {
  if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
  const metadata = lstatSync(parent);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail("unsafe evidence parent", "evidence_failed");
  chmodSync(parent, 0o700);
}

export function publishP8V2FResult(toolRoot, result, { beforeFinalVerify } = {}) {
  validateP8V2FResult(result);
  const parent = join(toolRoot, ".evo-release-evidence");
  const root = join(toolRoot, P8V2F.resultRoot);
  ensureEvidenceParent(parent);
  if (existsSync(root)) fail("evidence root collision", "evidence_failed");
  mkdirSync(root, { mode: 0o700 });
  const parentReal = realpathSync(parent); const rootReal = realpathSync(root);
  if (!rootReal.startsWith(`${parentReal}${sep}`)) fail("evidence root escaped", "evidence_failed");
  const output = join(root, P8V2F.resultName); const temp = `${output}.tmp`;
  try {
    const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    safeRaw(bytes); writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" }); chmodSync(temp, 0o600); renameSync(temp, output);
    const metadata = lstatSync(output);
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) fail("evidence file drifted", "evidence_failed");
    validateP8V2FResult(JSON.parse(readFileSync(output, "utf8")));
    beforeFinalVerify?.({ root, output });
    const finalRoot = lstatSync(root);
    if (finalRoot.isSymbolicLink() || !finalRoot.isDirectory() || (finalRoot.mode & 0o777) !== 0o700 || realpathSync(root) !== rootReal) fail("evidence root drifted", "evidence_failed");
    const retained = readdirSync(root).sort();
    if (JSON.stringify(retained) !== JSON.stringify([P8V2F.resultName])) fail("evidence allowlist drifted", "evidence_failed");
    return { path: output, sha256: sha256(readFileSync(output)) };
  } catch (error) {
    if (existsSync(temp)) rmSync(temp);
    if (existsSync(output)) rmSync(output);
    if (existsSync(root)) rmdirSync(root);
    throw error;
  }
}

function safeIdentity(state) {
  const organization = state.grouped.organization[0];
  return {
    auth_users: "exactly_one",
    active_accounts: "exactly_one",
    active_organizations: organization ? "exactly_one" : "none",
    organization_name: organization?.name === P8V2F.organizationName ? P8V2F.organizationName : "not_created",
    admin_memberships: organization ? "exactly_one" : "none",
    bootstrap_audit: organization?.audit_count === 1 ? "exactly_one" : "none",
  };
}

export async function runP8V2FSupabaseBootstrap({
  toolRoot,
  reviewedCommit,
  environment = process.env,
  run = defaultRun,
  fetchImpl = fetch,
  verifyExecution = verifyP8V2FExecution,
  configureHermes = configureP8V2FHermes,
  publish = publishP8V2FResult,
}) {
  if (environment.EVO_P8V2H_AUTHORIZATION !== P8V2F.authorization) fail("authorization missing or mismatched");
  const accessToken = requireCredential(environment, "SUPABASE_ACCESS_TOKEN", /^sbp_[A-Za-z0-9_-]{20,}$/);
  const publishableKey = requireCredential(environment, "EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY", /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
  const secretKey = requireCredential(environment, "EVO_PLATFORM_SUPABASE_SECRET_KEY", /^sb_secret_[A-Za-z0-9_-]{20,}$/);
  const execution = verifyExecution(toolRoot, reviewedCommit, run);
  const request = createP8V2FClient({ accessToken, fetchImpl });
  let state = await readP8V2FState(request);
  const initial = classifyP8V2FState(state);
  const { authUserId, accountId } = initial;
  let databasePrepared = initial.mode === "prepared";
  let dataApiStatus = databasePrepared ? "patched" : "not_run";
  let patchAttempted = false;
  let rpcAttempted = false;
  let hermes = { status: "not_run", settings: 0, file: "not_verified", rollback_sha256: null, feature_enables: 0 };
  let result;
  let operationError = null;
  try {
    await verifyP8V2FProjectKey(publishableKey, "publishable", fetchImpl);
    await verifyP8V2FProjectKey(secretKey, "secret", fetchImpl);
    if (initial.mode === "initial") {
      patchAttempted = true;
      await patchP8V2FPostgrest(request, P8V2F.afterSchemas);
      await reloadP8V2HPostgrest(request);
      dataApiStatus = "patched";
      rpcAttempted = true;
      await bootstrapP8V2FOrganization(secretKey, authUserId, fetchImpl);
      databasePrepared = true;
    }
    state = await readP8V2FState(request);
    const { organizationId } = validatePreparedState(state, authUserId, accountId);
    const platformAccess = await verifyP8V2FPlatformAccess(secretKey, authUserId, fetchImpl);
    hermes = configureHermes({
      NEXT_PUBLIC_SUPABASE_URL: P8V2F.projectUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: secretKey,
      EVO_PLATFORM_ORGANIZATION_ID: organizationId,
      EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: accountId,
    }, run);
    dataApiStatus = "verified";
    result = {
      version: P8V2F.version,
      result_code: "supabase_prepared",
      execution,
      project: state.project,
      migration_ledger: { status: "verified_unchanged", count: 76, first: "001", last: "076", pending: "077" },
      data_api: { before: P8V2F.beforeSchemas, after: P8V2F.afterSchemas, status: dataApiStatus, platform_access: platformAccess },
      identity: safeIdentity(state),
      hermes_configuration: hermes,
      effects: { ...ZERO_EFFECTS },
    };
  } catch (error) {
    let restoreFailed = false;
    let current = state;
    let readbackVerified = false;
    try {
      current = await readP8V2FState(request);
      readbackVerified = true;
      if (rpcAttempted) {
        try { validatePreparedState(current, authUserId, accountId); databasePrepared = true; dataApiStatus = "patched"; } catch { /* decide from closed zero-state below */ }
      }
    } catch { /* retain last safe state */ }
    let noBootstrapProved = readbackVerified && provesP8V2FNoBootstrap(current, authUserId, accountId);
    if (!databasePrepared && initial.mode === "initial" && noBootstrapProved && current.postgrest === P8V2F.afterSchemas) {
      try {
        await patchP8V2FPostgrest(request, P8V2F.beforeSchemas);
        await reloadP8V2HPostgrest(request);
        current = await readP8V2FState(request);
        validateInitialState(current);
        dataApiStatus = "restored";
      } catch {
        dataApiStatus = "unknown";
        restoreFailed = true;
        noBootstrapProved = false;
      }
    } else if (!databasePrepared && (patchAttempted || rpcAttempted) && !noBootstrapProved) {
      dataApiStatus = "unknown";
      restoreFailed = true;
    }
    const observedBootstrap = current.grouped.organization.length > 0;
    result = {
      version: P8V2F.version,
      result_code: databasePrepared || restoreFailed || observedBootstrap || (rpcAttempted && !noBootstrapProved) ? "configuration_reconciliation_required" : "configuration_failed",
      execution,
      project: current.project,
      migration_ledger: { status: "verified_unchanged", count: 76, first: "001", last: "076", pending: "077" },
      data_api: { before: P8V2F.beforeSchemas, after: P8V2F.afterSchemas, status: dataApiStatus, platform_access: "not_verified" },
      identity: safeIdentity(current),
      hermes_configuration: { ...hermes, status: "failed" },
      effects: { ...ZERO_EFFECTS },
    };
    operationError = error;
  }

  try {
    const evidence = publish(toolRoot, result);
    if (operationError) {
      operationError.code = result.result_code;
      throw operationError;
    }
    return { result, evidence };
  } catch (error) {
    if (operationError && error === operationError) throw error;
    const evidenceFailure = { ...result, result_code: "evidence_failed" };
    try { publish(toolRoot, evidenceFailure); } catch { /* an unsafe/unwritable root cannot retain evidence */ }
    const publicationError = new Error("P8V2H evidence publication failed");
    publicationError.code = "evidence_failed";
    throw publicationError;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined || Object.hasOwn(args, argv[i])) fail("arguments must be unique --key value pairs");
    args[argv[i]] = argv[i + 1];
  }
  if (Object.keys(args).some((key) => !["--reviewed-commit", "--tool-root"].includes(key)) || !args["--reviewed-commit"] || !args["--tool-root"]) fail("required arguments missing");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = await runP8V2FSupabaseBootstrap({ toolRoot: resolve(args["--tool-root"]), reviewedCommit: args["--reviewed-commit"] });
  process.stdout.write(`${JSON.stringify({ result_code: output.result.result_code, evidence_sha256: output.evidence.sha256 })}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? "configuration_failed"}\n`);
    process.exitCode = 1;
  });
}
