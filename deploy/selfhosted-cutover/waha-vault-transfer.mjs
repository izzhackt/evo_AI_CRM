#!/usr/bin/env node
// EVO operator script (runs ON hermes-vps, no dependencies): copies the plain WAHA API key from the CLOUD
// Supabase Vault into the SELF-HOSTED Vault, through the supported service-role RPCs, in ONE process.
//
//   resolve_manual_send_waha_runtime   (cloud, read)          migration 080
//   provision_manual_send_waha_runtime (self-hosted, write)   migration 081
//
// The plain key exists only in this process' memory: never in argv, never on disk, never printed.
// Before anything is written, sha512(key) must equal the hash that WAHA itself stores
// (WAHA_API_KEY=sha512:<hash> in /opt/evo-crm/.env.waha). After provisioning the binding is switched OFF again
// (provision always sets enabled=true), and the stored Vault value is re-checked by sha512 inside Postgres.
// Output: booleans and enums only (no key, no hash).
//
//   node waha-vault-transfer.mjs --dry-run                       read + verify, write nothing
//   node waha-vault-transfer.mjs --apply [--repair-dangling]     provision, then leave enabled=false
//   node waha-vault-transfer.mjs --apply --enable                provision and LEAVE the binding enabled (switch-over step)
import { readFileSync } from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const CLOUD_REF = 'iosckaqtovbbnssqcpde';
const CLOUD_ORIGIN = `https://${CLOUD_REF}.supabase.co`;
const SELF_ORIGIN = 'http://127.0.0.1:25400';
const CRM_ENV = '/opt/evo-crm/.env.production';
const WAHA_ENV = '/opt/evo-crm/.env.waha';
const SELF_ENV = '/opt/evo-supabase/.env';
const TARGET_SESSION = 'crm_primary';
const TARGET_BASE_URL = 'http://evo-crm-waha:3000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dry = args.has('--dry-run');
const repairDangling = args.has('--repair-dangling');
const leaveEnabled = args.has('--enable');
if (apply === dry) { console.error('usage: --dry-run | --apply [--repair-dangling] [--enable]'); process.exit(64); }

class Stop extends Error { constructor(code) { super(code); this.code = code; } }
const stop = (code) => { throw new Stop(code); };
const report = { mode: apply ? 'apply' : 'dry-run' };

function readEnv(path) {
  const m = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const x = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!x) continue;
    let v = x[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    m.set(x[1], v);
  }
  return m;
}
const sha = (alg, s) => createHash(alg).update(s, 'utf8').digest('hex');
const eq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function jwtRole(v) {
  const p = v.split('.');
  if (p.length !== 3) return null;
  try { return JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')).role ?? null; } catch { return null; }
}

async function rpc(origin, secretKey, name, body, label) {
  const headers = { Accept: 'application/json', 'Accept-Profile': 'platform', 'Content-Profile': 'platform', 'Content-Type': 'application/json', apikey: secretKey };
  if (jwtRole(secretKey) === 'service_role') headers.Authorization = `Bearer ${secretKey}`; // sb_secret_ keys must not be sent as bearer
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  let res;
  try { res = await fetch(`${origin}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: ctl.signal }); }
  catch { stop(`${label}_transport_failed`); }
  finally { clearTimeout(t); }
  if (res.status === 401 || res.status === 403) stop(`${label}_unauthorized`);
  if (res.status === 404) stop(`${label}_rpc_not_found`);
  if (res.status !== 200) stop(`${label}_http_${res.status}`); // body deliberately not read: it may carry the key
  const text = await res.text();
  if (text.length > 65536) stop(`${label}_response_too_large`);
  try { return JSON.parse(text); } catch { stop(`${label}_response_invalid`); }
}

function psql(sql) {
  const r = spawnSync('docker', ['exec', '-i', 'evo-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) stop('psql_failed');
  return r.stdout.trim();
}

let plain = null;
let provisioned = false;
try {
  // ---- environment -------------------------------------------------------------------------------------------
  const crm = readEnv(CRM_ENV), waha = readEnv(WAHA_ENV), self = readEnv(SELF_ENV);
  const cloudOrigin = crm.get('NEXT_PUBLIC_SUPABASE_URL');
  const cloudKey = crm.get('EVO_PLATFORM_SUPABASE_SECRET_KEY');
  const org = crm.get('EVO_PLATFORM_ORGANIZATION_ID');
  if (cloudOrigin !== CLOUD_ORIGIN) stop('crm_env_not_pointing_at_cloud_project'); // refuse after the switch-over: the source must be the cloud
  if (!cloudKey || !org || !UUID_RE.test(org)) stop('crm_env_incomplete');
  const selfKey = self.get('SUPABASE_SECRET_KEY') || self.get('SERVICE_ROLE_KEY');
  if (!selfKey) stop('selfhosted_key_missing');
  const wahaEntry = waha.get('WAHA_API_KEY') ?? '';
  const m = wahaEntry.match(/^sha512:([0-9a-fA-F]{128})$/);
  if (!m) stop('waha_env_hash_missing');
  const wahaHash = m[1].toLowerCase();
  report.environment_ok = true;

  // ---- 1. read the key from the cloud Vault (read-only RPC) ----------------------------------------------------
  const cloudRows = await rpc(CLOUD_ORIGIN, cloudKey, 'resolve_manual_send_waha_runtime', { p_organization_id: org }, 'cloud');
  if (!Array.isArray(cloudRows) || cloudRows.length !== 1) stop('cloud_binding_not_found_or_disabled');
  const row = cloudRows[0];
  if (row.waha_session_name !== TARGET_SESSION || row.waha_base_url !== TARGET_BASE_URL) stop('cloud_binding_target_mismatch');
  plain = row.waha_api_key;
  if (typeof plain !== 'string' || plain !== plain.trim() || /[\r\n\0]/.test(plain) || Buffer.byteLength(plain) < 16 || Buffer.byteLength(plain) > 4096) stop('cloud_key_invalid_shape');
  if (/^sha512:/i.test(plain)) stop('cloud_key_is_a_hash');
  report.cloud_key_read = true;

  // ---- 2. the key must be the one WAHA itself accepts (sha512 equals .env.waha) -------------------------------
  report.sha512_matches_env_waha = eq(sha('sha512', plain), wahaHash);
  if (!report.sha512_matches_env_waha) stop('hash_mismatch_with_env_waha');
  const keySha256 = sha('sha256', plain);

  // ---- 3. state of the self-hosted binding ---------------------------------------------------------------------
  const state = psql(`select b.enabled, b.binding_version, exists(select 1 from vault.secrets s where s.id = b.api_key_secret_id) from platform_private.manual_send_waha_runtime_bindings b where b.organization_id = '${org}';`);
  const [encl, ver, secretPresent] = state ? state.split('|') : [null, null, null];
  report.selfhosted_before = state ? { binding_row: true, enabled: encl === 't', version: Number(ver), vault_secret_present: secretPresent === 't' } : { binding_row: false };
  const dangling = Boolean(state) && secretPresent !== 't';
  const orgKnown = psql(`select count(*) from platform.organizations where id = '${org}' and status = 'active';`) === '1';
  report.selfhosted_org_active = orgKnown;
  if (!orgKnown) stop('selfhosted_org_missing');

  if (dry) {
    report.would_repair_dangling = dangling;
    report.would_provision = true;
    // read-only reachability of the self-hosted RPC with the service key
    const cfg = await rpc(SELF_ORIGIN, selfKey, 'manual_send_waha_runtime_configuration', { p_organization_id: org }, 'selfhosted');
    report.selfhosted_rpc_reason = Array.isArray(cfg) && cfg[0] ? cfg[0].reason_code : null;
  } else {
    // ---- 4. a binding row whose Vault secret is gone (data restore without Vault) cannot be rotated: drop it ----
    if (dangling) {
      if (!repairDangling) stop('dangling_binding_needs_--repair-dangling');
      const deleted = psql(`with d as (delete from platform_private.manual_send_waha_runtime_bindings b where b.organization_id = '${org}' and not exists (select 1 from vault.secrets s where s.id = b.api_key_secret_id) returning 1) select count(*) from d;`);
      report.dangling_binding_removed = deleted === '1';
      if (deleted !== '1') stop('dangling_repair_failed');
    }
    // ---- 5. provision with the supported function (creates Vault secret + binding; sets enabled=true) -----------
    const out = await rpc(SELF_ORIGIN, selfKey, 'provision_manual_send_waha_runtime', { p_organization_id: org, p_waha_api_key: plain, p_request_id: randomUUID() }, 'selfhosted');
    provisioned = true;
    const p = Array.isArray(out) && out.length === 1 ? out[0] : null;
    report.provision = { ready: p?.ready === true, reason_code: p?.reason_code ?? null, session: p?.waha_session_name ?? null, base_url_ok: p?.base_url === TARGET_BASE_URL, binding_version: p?.binding_version ?? null, stored_sha256_matches: typeof p?.api_key_sha256 === 'string' && eq(p.api_key_sha256, keySha256) };
  }
} catch (e) {
  report.error = e instanceof Stop ? e.code : 'unexpected_error';
  report.ok = false;
} finally {
  // provision always flips enabled=true: switch it off again unless explicitly asked to keep it on
  if (provisioned && !leaveEnabled) {
    try {
      const orgId = readEnv(CRM_ENV).get('EVO_PLATFORM_ORGANIZATION_ID');
      const off = psql(`update platform_private.manual_send_waha_runtime_bindings set enabled = false where organization_id = '${orgId}' returning enabled;`);
      report.disabled_again = off.split("\n")[0] === 'f'; // psql also prints the command tag (UPDATE 1)
    } catch { report.disabled_again = false; report.ok = false; }
  }
  if (provisioned) {
    try {
      const orgId = readEnv(CRM_ENV).get('EVO_PLATFORM_ORGANIZATION_ID');
      const wh = readEnv(WAHA_ENV).get('WAHA_API_KEY').match(/^sha512:([0-9a-fA-F]{128})$/)[1].toLowerCase();
      const v = psql(`select b.enabled, b.binding_version, d.decrypted_secret is not null, encode(sha512(convert_to(d.decrypted_secret,'UTF8')),'hex') = '${wh}', encode(sha256(convert_to(d.decrypted_secret,'UTF8')),'hex') = b.api_key_sha256 from platform_private.manual_send_waha_runtime_bindings b left join vault.decrypted_secrets d on d.id = b.api_key_secret_id where b.organization_id = '${orgId}';`).split('|');
      report.selfhosted_after = { enabled: v[0] === 't', binding_version: Number(v[1]), vault_secret_decrypts: v[2] === 't', vault_sha512_matches_env_waha: v[3] === 't', vault_matches_stored_sha256: v[4] === 't' };
      if (report.ok !== false) report.ok = report.selfhosted_after.vault_sha512_matches_env_waha && report.selfhosted_after.vault_matches_stored_sha256 && (leaveEnabled ? report.selfhosted_after.enabled : !report.selfhosted_after.enabled);
    } catch { report.selfhosted_after = 'verification_failed'; report.ok = false; }
  }
  plain = null;
  if (report.ok === undefined) report.ok = true;
  console.log(JSON.stringify(report, null, 1));
  process.exit(report.ok ? 0 : 1);
}
