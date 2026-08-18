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
  writeFileSync,
} from "node:fs";
import { basename, join, sep } from "node:path";

import { validateP8V2PreparationResult } from "./p8v2-production-preparation.mjs";

const APPLICATION_COMMIT = "0f1454d014bbc9eca9d7381dfe557e980965543e";
const APPLICATION_TREE = "19599bcf043dc4a555c8996c21e7801934b64633";
const PROJECT_REF = "iosckaqtovbbnssqcpde";
const PROJECT_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const QUERY_URL = `${PROJECT_URL}/database/query/read-only`;
const RESULT_SHA = "a050cd16b1d48fa089031bc3a4240b8e55f3b492c89addc7376d8016de5e63b7";
const AUTHORIZATION = "PREPARE-P8V2E-2026-08-18.P8V2E.1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const MAX_HTTP_BYTES = 64 * 1024;
const CONFIG_BLOCKERS = new Set([
  "root_crm_settings_missing", "root_crm_settings_invalid", "root_crm_identity_mismatch",
  "lead_agent_amocrm_credentials_missing", "lead_agent_settings_invalid",
  "manual_worker_secret_missing", "manual_worker_file_drift", "supabase_project_mismatch",
]);
const BLOCKERS = new Set([
  "retained_result_drift", "client_vault_drift", "internal_vault_drift",
  "management_project_drift", "management_query_failed", "account_not_singular",
  "organization_not_singular", ...CONFIG_BLOCKERS, "evidence_publication_failed",
  "configuration_observation_failed",
]);

export const P8V2E = Object.freeze({
  version: "p8v2e-independent-readiness-result/v1",
  authorization: AUTHORIZATION,
  applicationCommit: APPLICATION_COMMIT,
  applicationTree: APPLICATION_TREE,
  retainedResultSha256: RESULT_SHA,
  projectRef: PROJECT_REF,
});

export const P8V2E_VAULTS = Object.freeze([
  Object.freeze({
    audience: "client",
    path: "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО",
    document_count: 11,
    source_set_sha256: "c8dcfdd7911fdf2b97204c5d843dbf45f701d5dbee72e78cfaea17ea7ab18689",
  }),
  Object.freeze({
    audience: "internal",
    path: "/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ",
    document_count: 291,
    source_set_sha256: "1bd7458ff70c0a31fde9f6bb1abfb7ec0152c1f286caf2a1de48081860121f9f",
  }),
]);

function fail(message, code = "operation_failed") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} keys drifted`);
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function requireSuccess(result, label) {
  if (result.error || result.status !== 0) fail(`${label} failed`);
  return result.stdout;
}

function safeParse(raw, label) {
  try { return JSON.parse(raw); } catch { fail(`${label} returned invalid JSON`); }
}

function safeRaw(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  if (UUID.test(text) || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text)) fail("retained evidence contains a UUID", "privacy_validation_failed");
  if (/\/Users\/|\/private\/|BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_(?:secret|publishable)_[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{20,}|(?:password|cookie|api[_-]?key)\s*[:=]\s*[^,}\s]+/i.test(text)) fail("retained evidence contains private material", "privacy_validation_failed");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\+\d[\d ()-]{7,}\d/.test(text)) fail("retained evidence contains contact data", "privacy_validation_failed");
}

async function boundedJson(response, expectedStatus, label) {
  if (!response || response.status !== expectedStatus) fail(`${label} HTTP status drifted`);
  if (!response.body || typeof response.body.getReader !== "function") fail(`${label} response body unavailable`);
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_HTTP_BYTES) { await reader.cancel(); fail(`${label} response exceeded byte limit`); }
    chunks.push(Buffer.from(value));
  }
  return safeParse(Buffer.concat(chunks).toString("utf8"), label);
}

const IDENTITY_SQL = `select kind, id from (
  select 'account'::text as kind, account_id::text as id
  from (select distinct account_id from public.ai_configs where is_active is true order by account_id limit 2) a
  union all
  select 'organization'::text as kind, id::text as id
  from (select id from platform.organizations where status = 'active' order by id limit 2) o
) rows order by kind, id`;

const ROOT_SETTINGS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EVO_PLATFORM_SUPABASE_SECRET_KEY",
  "EVO_PLATFORM_ORGANIZATION_ID", "EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID", "EVO_PLATFORM_GEMINI_API_KEY",
  "EVO_PLATFORM_STAFF_ASSISTANT_ENABLED", "EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED",
  "EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET", "EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED", "EVO_LEAD_AGENT_SYNC_SECRET",
]);
const LEAD_SETTINGS = Object.freeze([
  "EVO_AGENT_AMO_BASE_URL", "EVO_AGENT_AMO_CLIENT_ID", "EVO_AGENT_AMO_CLIENT_SECRET", "EVO_AGENT_AMO_REDIRECT_URI",
  "EVO_AGENT_AMO_PIPELINE_ID", "EVO_AGENT_AMO_STATUS_ID", "EVO_AGENT_AMO_RESPONSIBLE_USER_ID",
  "EVO_AGENT_CRM_BASE_URL", "EVO_AGENT_CRM_SYNC_PATH", "EVO_AGENT_CRM_SYNC_SECRET",
  "EVO_AGENT_WAHA_BASE_URL", "EVO_AGENT_WAHA_API_KEY", "EVO_AGENT_WAHA_SESSION", "EVO_AGENT_WAHA_WEBHOOK_SECRET",
]);

export function createP8V2EConfigurationScript({
  crmPath = "/opt/evo-crm/.env.production",
  leadPath = "/opt/evo-crm/.env.lead-agent",
  workerPath = "/opt/evo-crm/.env.manual-send-worker",
  tokenRoot = "/opt/evo-crm/secrets",
  requiredUid = 0,
  requiredGid = 0,
} = {}) {
  for (const path of [crmPath, leadPath, workerPath, tokenRoot]) if (typeof path !== "string" || !path.startsWith("/") || path.includes("\n")) fail("configuration path drifted");
  if (!Number.isInteger(requiredUid) || requiredUid < 0 || !Number.isInteger(requiredGid) || requiredGid < 0) fail("configuration owner drifted");
  return String.raw`python3 -c '
import json,pathlib,re,sys
raw=sys.stdin.read()
if len(raw.encode("utf-8"))>256 or raw.count("\n")!=3: raise SystemExit(2)
account,organization,url=raw.splitlines()
uuid=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
if account and not uuid.fullmatch(account): raise SystemExit(2)
if organization and not uuid.fullmatch(organization): raise SystemExit(2)
required_uid=${requiredUid}; required_gid=${requiredGid}
def env(path):
 p=pathlib.Path(path)
 if not p.exists() or p.is_symlink() or not p.is_file() or (p.stat().st_mode & 0o777)!=0o600 or p.stat().st_uid!=required_uid or p.stat().st_gid!=required_gid: return None
 out={}
 for raw_line in p.read_text(encoding="utf-8").splitlines():
  line=raw_line.strip()
  if not line or line.startswith("#"): continue
  if "=" not in line: raise SystemExit(3)
  key,value=line.split("=",1); key=key.strip(); value=value.strip()
  if not re.fullmatch(r"[A-Z][A-Z0-9_]*",key) or key in out: raise SystemExit(3)
  out[key]=value
 return out
root_names=${JSON.stringify(ROOT_SETTINGS)}; lead_names=${JSON.stringify(LEAD_SETTINGS)}
crm=env(${JSON.stringify(crmPath)}); lead=env(${JSON.stringify(leadPath)})
block=[]
root_present=crm is not None and all(crm.get(k) for k in root_names)
if not root_present: block.append("root_crm_settings_missing")
root_format=bool(root_present) and re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{8,}",crm["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) is not None and re.fullmatch(r"sb_secret_[A-Za-z0-9_-]{8,}",crm["EVO_PLATFORM_SUPABASE_SECRET_KEY"]) is not None and crm["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!=crm["EVO_PLATFORM_SUPABASE_SECRET_KEY"] and uuid.fullmatch(crm["EVO_PLATFORM_ORGANIZATION_ID"]) is not None and uuid.fullmatch(crm["EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID"]) is not None and crm["EVO_PLATFORM_ORGANIZATION_ID"]!=crm["EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID"] and crm["EVO_PLATFORM_GEMINI_API_KEY"].strip()==crm["EVO_PLATFORM_GEMINI_API_KEY"] and len(crm["EVO_PLATFORM_GEMINI_API_KEY"])>=16 and crm["EVO_PLATFORM_STAFF_ASSISTANT_ENABLED"]=="1" and crm["EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED"]=="1" and crm["EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED"]=="1" and len(crm["EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET"])>=32 and len(crm["EVO_LEAD_AGENT_SYNC_SECRET"])>=32
if root_present and not root_format: block.append("root_crm_settings_invalid")
project_match=bool(crm) and crm.get("NEXT_PUBLIC_SUPABASE_URL")==url
account_match="not_comparable" if not account else bool(crm) and crm.get("EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID")==account
organization_match="not_comparable" if not organization else bool(crm) and crm.get("EVO_PLATFORM_ORGANIZATION_ID")==organization
if root_present and ((account and not account_match) or (organization and not organization_match)): block.append("root_crm_identity_mismatch")
if root_present and not project_match: block.append("supabase_project_mismatch")
token=lead.get("EVO_AGENT_AMO_TOKEN_FILE","") if lead else ""; refresh=lead.get("EVO_AGENT_AMO_REFRESH_TOKEN","") if lead else ""
token_ok=False
if token:
 p=pathlib.Path(token)
 try:
  s=p.lstat(); resolved=p.resolve(strict=True); allowed=pathlib.Path(${JSON.stringify(tokenRoot)}).resolve(strict=True)
  token_ok=p.is_absolute() and not p.is_symlink() and p.is_file() and (s.st_mode & 0o777)==0o600 and s.st_uid==required_uid and s.st_gid==required_gid and (resolved.parent==allowed or allowed in resolved.parents)
 except (FileNotFoundError,OSError): token_ok=False
lead_ok=bool(lead) and all(lead.get(k) for k in lead_names) and (token_ok or bool(refresh))
if not lead_ok: block.append("lead_agent_amocrm_credentials_missing")
worker=env(${JSON.stringify(workerPath)})
worker_ok=worker is not None and set(worker)=={"EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET"} and bool(worker.get("EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET"))
if not worker_ok: block.append("manual_worker_secret_missing")
root_ok=root_present and root_format and project_match and account_match is not False and organization_match is not False
print(json.dumps({"status":"verified" if root_ok and lead_ok and worker_ok and not block else "blocked","root_crm":"verified" if root_ok else "blocked","lead_agent":"verified" if lead_ok else "blocked","manual_worker":"verified" if worker_ok else "blocked","configured_account_match":account_match,"configured_organization_match":organization_match,"supabase_project_match":project_match,"blockers":block},separators=(",",":")))
'`;
}

const CONFIGURATION_SCRIPT = createP8V2EConfigurationScript();

export function fixedBashSeuCommand(script) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) fail("remote script encoding drifted");
  return `bash -seu -c "$(printf %s '${encoded}' | base64 -d)"`;
}

export const P8V2E_CONFIGURATION_REMOTE_COMMAND = fixedBashSeuCommand(CONFIGURATION_SCRIPT);

export function validateP8V2EReadinessResult(result) {
  exactKeys(result, ["version", "generated_at", "result_code", "blockers", "source", "retained_p8v2d", "vaults", "identity", "configuration"], "result");
  if (result.version !== P8V2E.version || !["readiness_verified", "readiness_blocked", "evidence_failed"].includes(result.result_code) || !Number.isFinite(Date.parse(result.generated_at))) fail("result header drifted");
  if (!Array.isArray(result.blockers) || new Set(result.blockers).size !== result.blockers.length || result.blockers.some((item) => !BLOCKERS.has(item))) fail("result blockers drifted");
  exactKeys(result.source, ["application_commit", "application_tree", "execution_commit", "execution_tree", "execution_ci_run_id"], "source");
  if (result.source.application_commit !== APPLICATION_COMMIT || result.source.application_tree !== APPLICATION_TREE || !SHA40.test(result.source.execution_commit) || !SHA40.test(result.source.execution_tree) || !Number.isInteger(result.source.execution_ci_run_id) || result.source.execution_ci_run_id < 1) fail("source identity drifted");
  exactKeys(result.retained_p8v2d, ["status", "result_sha256"], "retained result");
  if (!['verified','blocked'].includes(result.retained_p8v2d.status) || result.retained_p8v2d.result_sha256 !== RESULT_SHA) fail("retained result record drifted");
  if (!Array.isArray(result.vaults) || result.vaults.length !== 2) fail("vault records drifted");
  for (let i = 0; i < P8V2E_VAULTS.length; i += 1) {
    const record = result.vaults[i]; const expected = P8V2E_VAULTS[i];
    exactKeys(record, ["audience", "status", "document_count", "source_set_sha256", "pii_gate", "forbidden_root_gate"], "vault");
    if (record.audience !== expected.audience || !["verified","blocked"].includes(record.status)) fail("vault identity drifted");
    if (record.status === "verified" && (record.document_count !== expected.document_count || record.source_set_sha256 !== expected.source_set_sha256 || record.pii_gate !== "passed" || record.forbidden_root_gate !== "passed")) fail("verified vault drifted");
  }
  exactKeys(result.identity, ["status", "account", "organization", "project_ref_match", "project_status"], "identity");
  if (!["verified","blocked"].includes(result.identity.status) || !["none_active","exactly_one_active","multiple_active","blocked"].includes(result.identity.account) || !["none_active","exactly_one_active","multiple_active","blocked"].includes(result.identity.organization) || typeof result.identity.project_ref_match !== "boolean" || !["ACTIVE_HEALTHY","blocked"].includes(result.identity.project_status)) fail("identity record drifted");
  const identityReady = result.identity.account === "exactly_one_active" && result.identity.organization === "exactly_one_active" && result.identity.project_ref_match && result.identity.project_status === "ACTIVE_HEALTHY";
  if ((result.identity.status === "verified") !== identityReady) fail("identity status contradicts evidence");
  exactKeys(result.configuration, ["status", "root_crm", "lead_agent", "manual_worker", "configured_account_match", "configured_organization_match", "supabase_project_match", "blockers"], "configuration");
  if (!["verified","blocked"].includes(result.configuration.status) || !["verified","blocked"].includes(result.configuration.root_crm) || !["verified","blocked"].includes(result.configuration.lead_agent) || !["verified","blocked"].includes(result.configuration.manual_worker) || ![true,false,"not_comparable"].includes(result.configuration.configured_account_match) || ![true,false,"not_comparable"].includes(result.configuration.configured_organization_match) || typeof result.configuration.supabase_project_match !== "boolean" || !Array.isArray(result.configuration.blockers) || new Set(result.configuration.blockers).size !== result.configuration.blockers.length || result.configuration.blockers.some((item) => !CONFIG_BLOCKERS.has(item))) fail("configuration record drifted");
  const configurationObserved = result.configuration.root_crm === "verified" && result.configuration.lead_agent === "verified" && result.configuration.manual_worker === "verified" && result.configuration.blockers.length === 0;
  if ((result.configuration.status === "verified") !== configurationObserved) fail("configuration status contradicts evidence");
  if (result.configuration.blockers.some((item) => !result.blockers.includes(item))) fail("configuration blocker missing from result");
  if (result.result_code === "readiness_verified") {
    if (result.blockers.length || result.retained_p8v2d.status !== "verified" || result.vaults.some((item) => item.status !== "verified") || result.identity.status !== "verified" || result.identity.account !== "exactly_one_active" || result.identity.organization !== "exactly_one_active" || !result.identity.project_ref_match || result.identity.project_status !== "ACTIVE_HEALTHY" || result.configuration.status !== "verified" || result.configuration.blockers.length) fail("false readiness success");
  } else if (!result.blockers.length) fail("blocked result lacks blocker");
  if (result.result_code === "evidence_failed" && !result.blockers.includes("evidence_publication_failed")) fail("evidence failure lacks publication blocker");
  safeRaw(JSON.stringify(result));
  return result;
}

function assertDirectory0700(path) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) fail(`unsafe directory: ${basename(path)}`);
}

function assertContained(parent, path) {
  const parentReal = realpathSync(parent); const pathReal = realpathSync(path);
  if (pathReal !== parentReal && !pathReal.startsWith(`${parentReal}${sep}`)) fail("evidence path escaped parent");
}

export function verifyP8V2EExecution(toolRoot, sourceRoot, run = defaultRun) {
  const status = requireSuccess(run("git", ["-C", toolRoot, "status", "--porcelain"]), "release-control status");
  const head = requireSuccess(run("git", ["-C", toolRoot, "rev-parse", "HEAD"]), "release-control HEAD").trim();
  const origin = requireSuccess(run("git", ["-C", toolRoot, "rev-parse", "origin/main"]), "release-control origin").trim();
  const liveMain = requireSuccess(run("gh", ["api", "repos/izzhackt/evo_AI_CRM/commits/main", "--jq", ".sha"]), "live GitHub main").trim();
  const tree = requireSuccess(run("git", ["-C", toolRoot, "rev-parse", "HEAD^{tree}"]), "release-control tree").trim();
  const sourceStatus = requireSuccess(run("git", ["-C", sourceRoot, "status", "--porcelain"]), "application status");
  const sourceHead = requireSuccess(run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]), "application HEAD").trim();
  const sourceTree = requireSuccess(run("git", ["-C", sourceRoot, "rev-parse", "HEAD^{tree}"]), "application tree").trim();
  if (status || sourceStatus || head !== origin || head !== liveMain || !SHA40.test(head) || !SHA40.test(tree) || sourceHead !== APPLICATION_COMMIT || sourceTree !== APPLICATION_TREE) fail("execution checkout drifted");
  const rows = safeParse(requireSuccess(run("gh", ["run", "list", "--repo", "izzhackt/evo_AI_CRM", "--workflow", "EVO platform CI", "--commit", head, "--event", "push", "--status", "success", "--limit", "2", "--json", "databaseId,headSha,status,conclusion,workflowName"]), "exact-main CI"), "exact-main CI");
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].headSha !== head || rows[0].workflowName !== "EVO platform CI" || rows[0].status !== "completed" || rows[0].conclusion !== "success" || !Number.isInteger(rows[0].databaseId)) fail("exact-main CI drifted");
  return { application_commit: APPLICATION_COMMIT, application_tree: APPLICATION_TREE, execution_commit: head, execution_tree: tree, execution_ci_run_id: rows[0].databaseId };
}

export function verifyRetainedP8V2D(sourceRoot) {
  const path = join(sourceRoot, ".evo-release-evidence", `p8v2d-preparation-${APPLICATION_COMMIT}-20260818`, "v2-preparation-result.json");
  const metadata = lstatSync(path); const raw = readFileSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || sha256(raw) !== RESULT_SHA) fail("retained P8V2D result drifted");
  safeRaw(raw);
  const parsed = safeParse(raw.toString("utf8"), "retained P8V2D result");
  validateP8V2PreparationResult(parsed);
  if (parsed.result_code !== "preparation_blocked" || parsed.blocker?.step !== "identity_resolution" || parsed.blocker?.code !== "identity_resolution_failed") fail("retained P8V2D state drifted");
  return { status: "verified", result_sha256: RESULT_SHA };
}

export function auditP8V2EVault(toolRoot, spec, run = defaultRun) {
  const raw = requireSuccess(run("python3", [join(toolRoot, "scripts", "p8v2e-vault-audit.py"), "--vault", spec.path, "--audience", spec.audience], { cwd: toolRoot }), `${spec.audience} vault audit`);
  const record = safeParse(raw, `${spec.audience} vault audit`);
  exactKeys(record, ["audience", "status", "document_count", "source_set_sha256", "pii_gate", "forbidden_root_gate"], "vault audit");
  if (record.audience !== spec.audience || record.status !== "verified" || record.document_count !== spec.document_count || record.source_set_sha256 !== spec.source_set_sha256 || record.pii_gate !== "passed" || record.forbidden_root_gate !== "passed") fail(`${spec.audience} vault audit drifted`);
  return record;
}

export async function observeP8V2EIdentity(accessToken, fetchImpl = fetch) {
  if (!accessToken) fail("Supabase access token unavailable");
  const headers = { Authorization: `Bearer ${accessToken}` };
  let project;
  try {
    project = await boundedJson(await fetchImpl(PROJECT_URL, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) }), 200, "project status");
    if (!project || typeof project !== "object" || Array.isArray(project) || project.ref !== PROJECT_REF || project.status !== "ACTIVE_HEALTHY") fail("production project drifted");
  } catch (error) {
    error.code = "management_project_drift";
    throw error;
  }
  let rows;
  try {
    rows = await boundedJson(await fetchImpl(QUERY_URL, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ query: IDENTITY_SQL }), redirect: "error", signal: AbortSignal.timeout(15_000) }), 201, "identity query");
  } catch (error) {
    error.code = "management_query_failed";
    throw error;
  }
  if (!Array.isArray(rows) || rows.length > 4) fail("identity row cardinality drifted");
  const ids = { account: [], organization: [] };
  for (const row of rows) {
    exactKeys(row, ["kind", "id"], "identity row");
    if (!Object.hasOwn(ids, row.kind) || !UUID.test(row.id) || ids[row.kind].includes(row.id)) fail("identity row drifted");
    ids[row.kind].push(row.id);
  }
  if (ids.account.length > 2 || ids.organization.length > 2) fail("identity kind cardinality drifted");
  const classify = (values) => values.length === 0 ? "none_active" : values.length === 1 ? "exactly_one_active" : "multiple_active";
  const account = classify(ids.account); const organization = classify(ids.organization);
  const blockers = [];
  if (account !== "exactly_one_active") blockers.push("account_not_singular");
  if (organization !== "exactly_one_active") blockers.push("organization_not_singular");
  return {
    safe: { status: blockers.length ? "blocked" : "verified", account, organization, project_ref_match: true, project_status: "ACTIVE_HEALTHY" },
    accountId: ids.account.length === 1 ? ids.account[0] : "",
    organizationId: ids.organization.length === 1 ? ids.organization[0] : "",
    blockers,
  };
}

export function observeP8V2EConfiguration(identity, run = defaultRun) {
  const frame = `${identity.accountId}\n${identity.organizationId}\nhttps://${PROJECT_REF}.supabase.co\n`;
  if (Buffer.byteLength(frame, "utf8") > 256) fail("configuration frame exceeded limit");
  const args = ["-o", "BatchMode=yes", "hermes-vps", P8V2E_CONFIGURATION_REMOTE_COMMAND];
  if ((identity.accountId && args.some((value) => value.includes(identity.accountId))) || (identity.organizationId && args.some((value) => value.includes(identity.organizationId)))) fail("identity leaked into SSH argv");
  const sshResult = run("ssh", args, { input: frame, timeout: 120_000 });
  if (sshResult.error || sshResult.status !== 0 || sshResult.stderr !== "") fail("Hermes configuration observation failed");
  const raw = sshResult.stdout;
  if ((identity.accountId && raw.includes(identity.accountId)) || (identity.organizationId && raw.includes(identity.organizationId))) fail("identity leaked from Hermes");
  const result = safeParse(raw, "configuration observation");
  exactKeys(result, ["status", "root_crm", "lead_agent", "manual_worker", "configured_account_match", "configured_organization_match", "supabase_project_match", "blockers"], "configuration observation");
  return result;
}

function initialResult(source, generatedAt) {
  return {
    version: P8V2E.version,
    generated_at: generatedAt,
    result_code: "readiness_blocked",
    blockers: [],
    source,
    retained_p8v2d: { status: "blocked", result_sha256: RESULT_SHA },
    vaults: P8V2E_VAULTS.map((spec) => ({ audience: spec.audience, status: "blocked", document_count: null, source_set_sha256: null, pii_gate: "not_run", forbidden_root_gate: "not_run" })),
    identity: { status: "blocked", account: "blocked", organization: "blocked", project_ref_match: false, project_status: "blocked" },
    configuration: { status: "blocked", root_crm: "blocked", lead_agent: "blocked", manual_worker: "blocked", configured_account_match: "not_comparable", configured_organization_match: "not_comparable", supabase_project_match: false, blockers: [] },
  };
}

export function publishP8V2EResult(sourceRoot, result) {
  const parent = join(sourceRoot, ".evo-release-evidence");
  assertDirectory0700(parent);
  const root = join(parent, `p8v2e-readiness-${APPLICATION_COMMIT}-20260818`);
  if (existsSync(root)) fail("P8V2E evidence root already exists", "evidence_publication_failed");
  mkdirSync(root, { mode: 0o700 });
  assertDirectory0700(root); assertContained(parent, root);
  const final = join(root, "readiness-result.json"); const temporary = join(root, ".readiness-result.json.tmp");
  try {
    const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
    safeRaw(bytes); writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" }); chmodSync(temporary, 0o600); renameSync(temporary, final);
    if (JSON.stringify(readdirSync(root).sort()) !== JSON.stringify(["readiness-result.json"])) fail("P8V2E evidence allowlist drifted");
    const metadata = lstatSync(final); if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) fail("P8V2E result mode drifted");
    assertContained(root, final); const retained = readFileSync(final); safeRaw(retained); validateP8V2EReadinessResult(safeParse(retained.toString("utf8"), "P8V2E retained result"));
    return { result, path: final, sha256: sha256(retained) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) fail("P8V2E partial evidence cleanup failed", "evidence_publication_failed");
    throw error;
  }
}

export async function runP8V2EReadiness({
  toolRoot,
  sourceRoot,
  environment = process.env,
  run = defaultRun,
  fetchImpl = fetch,
  auditVault = auditP8V2EVault,
  verifyExecution = verifyP8V2EExecution,
  verifyRetained = verifyRetainedP8V2D,
  observeIdentity = observeP8V2EIdentity,
  observeConfiguration = observeP8V2EConfiguration,
  publishResult = publishP8V2EResult,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (environment.EVO_P8V2E_AUTHORIZATION !== AUTHORIZATION) fail("exact P8V2E authorization is required");
  const source = await verifyExecution(toolRoot, sourceRoot, run);
  const result = initialResult(source, generatedAt);
  try { result.retained_p8v2d = await verifyRetained(sourceRoot); } catch { result.blockers.push("retained_result_drift"); }
  for (let index = 0; index < P8V2E_VAULTS.length; index += 1) {
    const spec = P8V2E_VAULTS[index];
    try { result.vaults[index] = await auditVault(toolRoot, spec, run); }
    catch { result.blockers.push(`${spec.audience}_vault_drift`); }
  }
  let identity = { accountId: "", organizationId: "", blockers: ["management_query_failed"] };
  try {
    identity = await observeIdentity(environment.SUPABASE_ACCESS_TOKEN, fetchImpl);
    result.identity = identity.safe;
    result.blockers.push(...identity.blockers);
  } catch (error) {
    result.blockers.push(error?.code === "management_project_drift" ? "management_project_drift" : "management_query_failed");
  }
  try {
    result.configuration = await observeConfiguration(identity, run);
    result.blockers.push(...result.configuration.blockers);
  } catch {
    result.configuration.blockers = [];
    result.blockers.push("configuration_observation_failed");
  }
  result.blockers = [...new Set(result.blockers)].sort();
  result.result_code = result.blockers.length ? "readiness_blocked" : "readiness_verified";
  validateP8V2EReadinessResult(result);
  try {
    return await publishResult(sourceRoot, result);
  } catch (error) {
    const failure = structuredClone(result);
    failure.result_code = "evidence_failed";
    failure.blockers = [...new Set([...failure.blockers, "evidence_publication_failed"])].sort();
    validateP8V2EReadinessResult(failure);
    try { return await publishResult(sourceRoot, failure); }
    catch { throw error; }
  }
}
