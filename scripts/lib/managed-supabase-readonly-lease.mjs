import { createHash } from "node:crypto";

export const TEMPORARY_LEASE_PROJECT_REF = "iosckaqtovbbnssqcpde";
export const READ_ONLY_EFFECTIVE_ROLE = "supabase_read_only_user";
const ROLE = /^cli_login_[a-z0-9_]{1,53}$/u;
const REQUEST_MS = 20_000;
const DATABASE_WINDOW_MS = 15 * 60_000;
const CLEANUP_MARGIN_MS = 30_000;
const INVENTORY_SQL = "select rolname as role_name, oid::bigint as role_oid, rolvaliduntil::text as valid_until from pg_catalog.pg_roles where left(rolname, 10) = 'cli_login_' order by rolname";

export class ManagedReadOnlyLeaseError extends Error {
  constructor(code) { super(code); this.name = "ManagedReadOnlyLeaseError"; this.code = code; }
}
function fail(code) { throw new ManagedReadOnlyLeaseError(code); }
function exact(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail(code);
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function iso(value, code) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(code);
  return new Date(value).toISOString();
}

/** Provider credentials remain memory-only; callers must never serialize this value. */
export function normalizeTemporaryReadOnlyLease(payload, { nowMs }) {
  exact(payload, ["role", "password", "ttl_seconds"], "temporary_lease_response_invalid");
  if (!ROLE.test(payload.role) || typeof payload.password !== "string" ||
    payload.password.length < 1 || payload.password.length > 16_384 || /[\0\r\n]/u.test(payload.password) ||
    !Number.isSafeInteger(payload.ttl_seconds) || payload.ttl_seconds < 60 ||
    payload.ttl_seconds > 86_400 || !Number.isSafeInteger(nowMs)) fail("temporary_lease_response_invalid");
  return Object.freeze({
    role: payload.role, password: payload.password, ttlSeconds: payload.ttl_seconds,
    issuedAt: new Date(nowMs).toISOString(),
    deadlineMs: nowMs + Math.min(DATABASE_WINDOW_MS, payload.ttl_seconds * 1_000 - CLEANUP_MARGIN_MS),
  });
}

export function normalizeCliRoleInventory(rows) {
  if (!Array.isArray(rows) || rows.length > 16) fail("temporary_lease_inventory_invalid");
  const roles = rows.map((row) => {
    exact(row, ["role_name", "role_oid", "valid_until"], "temporary_lease_inventory_invalid");
    if (!ROLE.test(row.role_name) || !Number.isSafeInteger(row.role_oid) || row.role_oid <= 0 ||
      row.role_oid > 4_294_967_295) fail("temporary_lease_inventory_invalid");
    return Object.freeze({ role_name: row.role_name, role_oid: row.role_oid,
      valid_until: row.valid_until === null ? null : iso(row.valid_until, "temporary_lease_inventory_invalid") });
  }).sort((a, b) => a.role_name.localeCompare(b.role_name, "en"));
  if (new Set(roles.map((row) => row.role_name)).size !== roles.length ||
    new Set(roles.map((row) => row.role_oid)).size !== roles.length) fail("temporary_lease_inventory_invalid");
  return Object.freeze(roles);
}

export function validateAccessLifecycleEvidence(value) {
  exact(value, ["mode", "requested_read_only", "effective_role", "role_sha256", "lease_ttl_seconds",
    "issued_at", "cleanup_completed_at", "cleanup", "cleanup_action"], "access_lifecycle_invalid");
  if (value.mode !== "temporary-cli-readonly" || value.requested_read_only !== true ||
    value.effective_role !== READ_ONLY_EFFECTIVE_ROLE || !/^[a-f0-9]{64}$/u.test(value.role_sha256) ||
    !Number.isSafeInteger(value.lease_ttl_seconds) || value.lease_ttl_seconds < 60 || value.lease_ttl_seconds > 86_400 ||
    value.cleanup !== "verified" || !["deleted", "already_absent"].includes(value.cleanup_action)) fail("access_lifecycle_invalid");
  const issued = iso(value.issued_at, "access_lifecycle_invalid");
  const cleaned = iso(value.cleanup_completed_at, "access_lifecycle_invalid");
  if (Date.parse(cleaned) < Date.parse(issued) || issued !== value.issued_at || cleaned !== value.cleanup_completed_at) fail("access_lifecycle_invalid");
  return Object.freeze({ ...value });
}

// These exclusions mirror the fixed data/history dump commands, not a reduced
// read-only subset. Extension-member relations follow pg_dump's extconfig rule.
export function buildReadOnlyCapabilitySql() {
  return `SET ROLE "supabase_read_only_user";
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH included AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','S')
    AND n.nspname !~ '^(information_schema|pg_.*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_.*|_timescaledb_.*|topology|vault|etl|extensions|pgbouncer|realtime|_analytics|_realtime|_supavisor)$'
    AND (n.nspname||'.'||c.relname) NOT IN ('auth.schema_migrations','storage.migrations','supabase_functions.migrations','storage.buckets_vectors','storage.vector_indexes')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
        AND NOT (c.oid=ANY(COALESCE(e.extconfig,ARRAY[]::oid[]))))
), reachable_roles AS (
  SELECT * FROM pg_catalog.pg_roles
  WHERE rolname IN (session_user,current_user)
    OR pg_has_role(session_user,oid,'SET') OR pg_has_role(session_user,oid,'USAGE')
    OR pg_has_role(current_user,oid,'SET') OR pg_has_role(current_user,oid,'USAGE')
)
SELECT json_build_object(
  'session_user',session_user,'effective_role',current_user,
  'bypass_rls',(SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user),
  'is_superuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),
  'transaction_read_only',current_setting('transaction_read_only'),
  'can_set_postgres',pg_has_role(session_user,'postgres','SET'),
  'can_create_role',(SELECT bool_or(rolcreaterole) FROM reachable_roles),
  'can_create_database',(SELECT bool_or(rolcreatedb) FROM reachable_roles),
  'can_replicate',(SELECT bool_or(rolreplication) FROM reachable_roles),
  'can_elevate',(SELECT bool_or(rolsuper OR rolname NOT IN (session_user,'supabase_read_only_user','pg_read_all_data')) FROM reachable_roles),
  'relations',COALESCE((SELECT json_agg(json_build_object('schema_name',nspname,'table_name',relname,
    'schema_allowed',has_schema_privilege(current_user,nspname,'USAGE'),
    'select_allowed',has_table_privilege(current_user,oid,'SELECT')) ORDER BY nspname,relname) FROM included WHERE relkind='r'),'[]'::json),
  'sequences',COALESCE((SELECT json_agg(json_build_object('schema_name',nspname,'sequence_name',relname,
    'schema_allowed',has_schema_privilege(current_user,nspname,'USAGE'),
    'select_allowed',has_sequence_privilege(current_user,oid,'SELECT')) ORDER BY nspname,relname) FROM included WHERE relkind='S'),'[]'::json)
);
ROLLBACK;`;
}

export function normalizeReadOnlyCapabilities(payload, { sessionRole }) {
  exact(payload, ['session_user','effective_role','bypass_rls','is_superuser','transaction_read_only',
    'can_set_postgres','can_create_role','can_create_database','can_replicate','can_elevate',
    'relations','sequences'], 'readonly_capabilities_invalid');
  if (!ROLE.test(sessionRole) || payload.session_user !== sessionRole ||
    payload.effective_role !== READ_ONLY_EFFECTIVE_ROLE || payload.bypass_rls !== true ||
    payload.is_superuser !== false || payload.transaction_read_only !== 'on' ||
    [payload.can_set_postgres,payload.can_create_role,payload.can_create_database,
      payload.can_replicate,payload.can_elevate].some((flag) => flag !== false)) fail('readonly_capabilities_invalid');
  const names = (rows, field) => {
    if (!Array.isArray(rows) || rows.length > 100_000) fail('readonly_capabilities_invalid');
    const result = rows.map((row) => {
      exact(row, ['schema_name',field,'schema_allowed','select_allowed'], 'readonly_capabilities_invalid');
      if (![row.schema_name,row[field]].every((name) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) ||
        row.schema_allowed !== true || row.select_allowed !== true) fail('readonly_capabilities_invalid');
      return `${row.schema_name}.${row[field]}`;
    }).sort();
    if (new Set(result).size !== result.length) fail('readonly_capabilities_invalid');
    return Object.freeze(result);
  };
  const relations = names(payload.relations, 'table_name');
  const sequences = names(payload.sequences, 'sequence_name');
  for (const required of ['auth.users','storage.buckets','storage.objects','supabase_migrations.schema_migrations']) {
    if (!relations.includes(required)) fail('readonly_required_relation_missing');
  }
  return Object.freeze({ relations, sequences });
}

export function validateReadOnlyCopyCoverage({ capabilities, dataAnalysis, historyAnalysis }) {
  const compare = (expected, actual) => {
    if (!Array.isArray(actual) || actual.some((name) => typeof name !== 'string') ||
      JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())) fail('readonly_copy_coverage_mismatch');
  };
  compare(capabilities.relations.filter((name) => !name.startsWith('supabase_migrations.')), dataAnalysis.copyTables);
  compare(capabilities.relations.filter((name) => name.startsWith('supabase_migrations.')), historyAnalysis.copyTables);
  return true;
}

/** No retries, CLI invocation, role guessing, JIT configuration or network-unban path. */
export async function createTemporaryReadOnlyLease({ projectRef, accessToken, exclusiveProjectRef,
  fetchImpl = fetch, now = Date.now, signal }) {
  if (projectRef !== TEMPORARY_LEASE_PROJECT_REF || exclusiveProjectRef !== projectRef) fail("temporary_lease_scope_invalid");
  if (typeof accessToken !== "string" || !/^sbp_(?:oauth_)?[A-Za-z0-9_-]{20,}$/u.test(accessToken)) fail("temporary_lease_token_invalid");
  const prefix = `/v1/projects/${projectRef}`;
  const request = async (method, suffix, body, requestSignal = signal) => {
    if (!((method === "POST" && ["/database/query/read-only", "/cli/login-role"].includes(suffix)) ||
      (method === "DELETE" && suffix === "/cli/login-role"))) fail("temporary_lease_request_scope_invalid");
    let response;
    try {
      response = await fetchImpl(`https://api.supabase.com${prefix}${suffix}`, {
        method, redirect: "error", signal: requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(REQUEST_MS)]) : AbortSignal.timeout(REQUEST_MS),
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { fail("temporary_lease_request_failed"); }
    if (response.status !== (method === "DELETE" ? 200 : 201)) {
      await response.body?.cancel().catch(() => {});
      fail("temporary_lease_request_failed");
    }
    try {
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 65_536) { await reader.cancel(); fail("temporary_lease_response_invalid"); }
        chunks.push(Buffer.from(item.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { fail("temporary_lease_response_invalid"); }
  };
  const inventory = async (requestSignal = signal) => normalizeCliRoleInventory(
    await request("POST", "/database/query/read-only", { query: INVENTORY_SQL }, requestSignal));
  if ((await inventory()).length !== 0) fail("temporary_lease_preexisting_roles");
  // Marking a POST as attempted is not proof of ownership. An ambiguous response
  // MUST NOT trigger collective DELETE: stop for operator reconciliation instead.
  let credentials;
  try {
    const issuedAt = now();
    credentials = normalizeTemporaryReadOnlyLease(
      await request("POST", "/cli/login-role", { read_only: true }), { nowMs: issuedAt });
  } catch { fail("temporary_lease_creation_unconfirmed"); }
  let owned;
  try {
    const observed = await inventory();
    if (observed.length !== 1 || observed[0].role_name !== credentials.role) fail("temporary_lease_ownership_unconfirmed");
    owned = observed[0];
  } catch { fail("temporary_lease_ownership_unconfirmed"); }
  let evidence = null;
  let cleanupAttempted = false;
  return Object.freeze({ ...credentials, async release({ processesDrained }) {
    if (evidence) return evidence;
    if (processesDrained !== true) fail("temporary_lease_processes_not_drained");
    if (cleanupAttempted) fail("temporary_lease_cleanup_unconfirmed");
    cleanupAttempted = true;
    // Cleanup is deliberately independent of an aborted/expired operation signal.
    const cleanupSignal = AbortSignal.timeout(3 * REQUEST_MS);
    const observed = await inventory(cleanupSignal);
    let action = "already_absent";
    if (observed.length !== 0) {
      if (observed.length !== 1 || JSON.stringify(observed[0]) !== JSON.stringify(owned)) fail("temporary_lease_foreign_role_detected");
      const result = await request("DELETE", "/cli/login-role", undefined, cleanupSignal);
      exact(result, ["message"], "temporary_lease_cleanup_unconfirmed");
      if (result.message !== "ok") fail("temporary_lease_cleanup_unconfirmed");
      action = "deleted";
      if ((await inventory(cleanupSignal)).length !== 0) fail("temporary_lease_cleanup_unconfirmed");
    }
    evidence = validateAccessLifecycleEvidence({ mode: "temporary-cli-readonly", requested_read_only: true,
      effective_role: READ_ONLY_EFFECTIVE_ROLE, role_sha256: digest(JSON.stringify(owned)),
      lease_ttl_seconds: credentials.ttlSeconds, issued_at: credentials.issuedAt,
      cleanup_completed_at: new Date(now()).toISOString(), cleanup: "verified", cleanup_action: action });
    return evidence;
  } });
}

/** The caller cannot receive a successful capture before independent revocation. */
export async function withTemporaryReadOnlyLease(options, operation) {
  const { processesDrained, ...leaseOptions } = options;
  if (typeof processesDrained !== "function" || typeof operation !== "function") fail("temporary_lease_operation_invalid");
  const lease = await createTemporaryReadOnlyLease(leaseOptions);
  let sourceAccess;
  let value;
  let deadline;
  try {
    const now = options.now ?? Date.now;
    const remaining = lease.deadlineMs - now();
    if (remaining <= 0) fail("temporary_lease_expired");
    deadline = AbortSignal.timeout(remaining);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    value = await operation(lease, signal);
    if (signal.aborted || now() >= lease.deadlineMs) fail("temporary_lease_expired");
  } catch (error) {
    if (deadline?.aborted) fail("temporary_lease_expired");
    throw error;
  } finally {
    sourceAccess = await lease.release({ processesDrained: processesDrained() });
  }
  return Object.freeze({ value, sourceAccess });
}
