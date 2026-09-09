import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ManagedSupabaseExportError,
  analyzeCopyDumpFile,
  assertRedactedReceipt,
  canonicalJson,
  createStorageClientFetch,
  dataRowAggregates,
  downloadStorageObjects,
  drainConcurrentOperations,
  exactMigrationLedger,
  guardedRemove,
  managedDatabaseDumpPlan,
  normalizeProjectReceipt,
  normalizePoolerReceipt,
  normalizeLeaseSourceLedger,
  openSynchronizedDatabaseSnapshot,
  parseArgs,
  parseCopySections,
  patchedPostgresClientVersion,
  registerSignalCleanup,
  selectLatestCompletedBackup,
  semanticSqlFileDigest,
  sha256,
  spawnCommand,
  storageClientHeaders,
  storageDownloadHeaders,
  storageInventoryDigest,
  synchronizedSnapshotFlag,
  validateOperatorHome,
  validateOutputRoot,
  validateSupabaseDatabaseCa,
  verifyPrivateSigningKey,
  verifySigningKeyPair,
} from "../scripts/export-v3-managed-supabase-backup.mjs";
import {
  createTemporaryReadOnlyLease,
  buildReadOnlyCapabilitySql,
  normalizeCliRoleInventory,
  normalizeReadOnlyCapabilities,
  normalizeTemporaryReadOnlyLease,
  validateAccessLifecycleEvidence,
  validateReadOnlyCopyCoverage,
  withTemporaryReadOnlyLease,
} from "../scripts/lib/managed-supabase-readonly-lease.mjs";

const REF = "a".repeat(20);
const LEASE_REF = "iosckaqtovbbnssqcpde";
const LEASE_NOW = Date.parse("2026-09-09T15:00:00.000Z");
const LEASE_ROLE = { role_name: "cli_login_fixture_readonly", role_oid: 42001, valid_until: "2026-09-09T16:00:00.000Z" };
const LEASE_PASSWORD = "fictional-lease-password-not-a-provider-secret";
const LEASE_REPLY = { role: LEASE_ROLE.role_name, password: LEASE_PASSWORD, ttl_seconds: 3600 };

// This double is the external Management HTTP boundary. Every unplanned request
// fails, so tests cannot silently contact a provider or choose a wider endpoint.
function leaseApi(steps) {
  const observed = [];
  const remaining = [...steps];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.supabase.com");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer sbp_${"x".repeat(32)}`);
    const suffix = url.pathname.slice(`/v1/projects/${LEASE_REF}`.length);
    assert.equal(url.pathname, `/v1/projects/${LEASE_REF}${suffix}`);
    const kind = suffix === "/database/query/read-only" ? "inventory" : options.method === "DELETE" ? "delete" : "create";
    const step = remaining.shift();
    assert.ok(step, `unexpected ${kind} request`);
    assert.equal(kind, step.kind);
    assert.equal(options.method, kind === "delete" ? "DELETE" : "POST");
    assert.equal(suffix, kind === "inventory" ? "/database/query/read-only" : "/cli/login-role");
    if (kind === "create") assert.deepEqual(JSON.parse(options.body), { read_only: true });
    if (kind === "inventory") {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body), ["query"]);
      assert.match(body.query, /^select /i);
      assert.match(body.query, /pg_catalog\.pg_roles/);
      assert.doesNotMatch(body.query, /\b(drop|grant|revoke|alter|create)\b/i);
    }
    if (kind === "delete") assert.equal(options.body, undefined);
    observed.push({ kind, signal: options.signal });
    step.onRequest?.();
    if (step.wait) await step.wait;
    if (step.error) throw step.error;
    return new Response(step.raw ?? JSON.stringify(step.value), { status: step.status ?? (kind === "delete" ? 200 : 201) });
  };
  return { fetchImpl, observed, assertConsumed: () => assert.equal(remaining.length, 0) };
}

function leaseOptions(api, extra = {}) {
  return { projectRef: LEASE_REF, exclusiveProjectRef: LEASE_REF, accessToken: `sbp_${"x".repeat(32)}`,
    fetchImpl: api.fetchImpl, now: () => LEASE_NOW, ...extra };
}

const ownInventory = () => ({ kind: "inventory", value: [LEASE_ROLE] });
const leaseStart = () => [{ kind: "inventory", value: [] }, { kind: "create", value: LEASE_REPLY }, ownInventory()];

test("temporary credentials are strictly bounded and never accept an arbitrary database role", () => {
  const lease = normalizeTemporaryReadOnlyLease(LEASE_REPLY, { nowMs: LEASE_NOW });
  assert.equal(lease.role, "cli_login_fixture_readonly");
  assert.equal(lease.deadlineMs, LEASE_NOW + 900_000);
  assert.equal(normalizeTemporaryReadOnlyLease({ ...LEASE_REPLY, ttl_seconds: 60 }, { nowMs: LEASE_NOW }).deadlineMs, LEASE_NOW + 30_000);
  for (const change of [{ role: "postgres" }, { role: "cli_login_bad;DROP" }, { password: "bad\nvalue" }, { password: "" },
    { ttl_seconds: 0 }, { ttl_seconds: 59 }, { ttl_seconds: 86401 }, { ttl_seconds: "3600" }, { ttl_seconds: 1.5 }, { extra: true }]) {
    assert.throws(() => normalizeTemporaryReadOnlyLease({ ...LEASE_REPLY, ...change }, { nowMs: LEASE_NOW }));
  }
  assert.throws(() => normalizeTemporaryReadOnlyLease(LEASE_REPLY, { nowMs: NaN }));
  assert.throws(() => normalizeCliRoleInventory([LEASE_ROLE, LEASE_ROLE]));
  assert.throws(() => normalizeCliRoleInventory([{ ...LEASE_ROLE, role_oid: "42001" }]));
  assert.throws(() => normalizeCliRoleInventory([{ ...LEASE_ROLE, valid_until: "not a date" }]));
});

test("owned read-only lease closes only after process drain and emits secret-free verified evidence", async () => {
  const api = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "ok" } }, { kind: "inventory", value: [] }]);
  const lease = await createTemporaryReadOnlyLease(leaseOptions(api));
  await assert.rejects(lease.release({ processesDrained: false }), { code: "temporary_lease_processes_not_drained" });
  const evidence = await lease.release({ processesDrained: true });
  assert.equal(evidence.requested_read_only, true);
  assert.equal(evidence.effective_role, "supabase_read_only_user");
  assert.equal(evidence.cleanup, "verified");
  assert.equal(evidence.cleanup_action, "deleted");
  assert.match(evidence.role_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(evidence), /fictional-lease-password|cli_login_fixture|sbp_/);
  assert.deepEqual(await lease.release({ processesDrained: true }), evidence);
  assert.deepEqual(api.observed.map((call) => call.kind), ["inventory", "create", "inventory", "inventory", "delete", "inventory"]);
  api.assertConsumed();
});

test("pre-existing or concurrently created CLI roles are never deleted", async () => {
  const before = leaseApi([{ kind: "inventory", value: [LEASE_ROLE] }]);
  await assert.rejects(createTemporaryReadOnlyLease(leaseOptions(before)), { code: "temporary_lease_preexisting_roles" });
  assert.deepEqual(before.observed.map((call) => call.kind), ["inventory"]);
  const foreign = { ...LEASE_ROLE, role_name: "cli_login_another_operator", role_oid: 42002 };
  for (const roles of [[LEASE_ROLE, foreign], [foreign], [{ ...LEASE_ROLE, role_oid: 42003 }], [{ ...LEASE_ROLE, valid_until: "2026-09-09T17:00:00.000Z" }]]) {
    const api = leaseApi([...leaseStart(), { kind: "inventory", value: roles }]);
    const lease = await createTemporaryReadOnlyLease(leaseOptions(api));
    await assert.rejects(lease.release({ processesDrained: true }), { code: "temporary_lease_foreign_role_detected" });
    assert.equal(api.observed.some((call) => call.kind === "delete"), false);
    api.assertConsumed();
  }
});

test("ambiguous or malformed creation is not retried and grants no collective cleanup authority", async () => {
  for (const response of [{ error: new DOMException("request timed out", "TimeoutError") }, { raw: "{broken" },
    { value: { ...LEASE_REPLY, role: "postgres" } }, { value: { ...LEASE_REPLY, ttl_seconds: 1 } }, { status: 503, value: {} }]) {
    const api = leaseApi([{ kind: "inventory", value: [] }, { kind: "create", ...response }]);
    await assert.rejects(createTemporaryReadOnlyLease(leaseOptions(api)), { code: "temporary_lease_creation_unconfirmed" });
    assert.deepEqual(api.observed.map((call) => call.kind), ["inventory", "create"]);
    api.assertConsumed();
  }
  const mismatch = leaseApi([...leaseStart().slice(0, 2), { kind: "inventory", value: [{ ...LEASE_ROLE, role_name: "cli_login_foreign" }] }]);
  await assert.rejects(createTemporaryReadOnlyLease(leaseOptions(mismatch)), { code: "temporary_lease_ownership_unconfirmed" });
  assert.equal(mismatch.observed.some((call) => call.kind === "delete"), false);
});

test("cleanup uses its own live signal after operation abort and rejects an unconfirmed delete", async () => {
  const controller = new AbortController();
  const api = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "ok" } }, { kind: "inventory", value: [] }]);
  const lease = await createTemporaryReadOnlyLease(leaseOptions(api, { signal: controller.signal }));
  controller.abort();
  await lease.release({ processesDrained: true });
  for (const call of api.observed.slice(3)) assert.equal(call.signal.aborted, false);
  for (const response of [{ error: new Error("fictional provider unavailable") }, { value: { message: "failed" } }, { status: 500, value: {} }]) {
    const broken = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", ...response }]);
    const pending = await createTemporaryReadOnlyLease(leaseOptions(broken));
    await assert.rejects(pending.release({ processesDrained: true }));
    await assert.rejects(pending.release({ processesDrained: true }), { code: "temporary_lease_cleanup_unconfirmed" });
    assert.equal(broken.observed.filter((call) => call.kind === "delete").length, 1);
  }
});

test("a successful DELETE response is insufficient when a CLI role remains", async () => {
  const api = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "ok" } }, ownInventory()]);
  const lease = await createTemporaryReadOnlyLease(leaseOptions(api));
  await assert.rejects(lease.release({ processesDrained: true }), { code: "temporary_lease_cleanup_unconfirmed" });
  api.assertConsumed();
});

test("lease scope and token failures happen before any Management request", async () => {
  for (const change of [{ projectRef: REF }, { exclusiveProjectRef: REF }, { exclusiveProjectRef: undefined }, { accessToken: "not-a-PAT" }]) {
    let requests = 0;
    await assert.rejects(createTemporaryReadOnlyLease({ ...leaseOptions({ fetchImpl() { requests++; throw new Error("must not contact network"); } }), ...change }));
    assert.equal(requests, 0);
  }
});

function capabilitiesFixture() {
  const table = (name) => ({ schema_name: name.split(".")[0], table_name: name.split(".")[1], schema_allowed: true, select_allowed: true });
  return { session_user: LEASE_ROLE.role_name, effective_role: "supabase_read_only_user", bypass_rls: true,
    is_superuser: false, transaction_read_only: "on", can_set_postgres: false,
    can_create_role: false, can_create_database: false, can_replicate: false, can_elevate: false,
    relations: ["auth.users", "auth.identities", "platform.student_cases", "platform_private.owner_private", "storage.buckets", "storage.objects", "supabase_migrations.schema_migrations"].map(table),
    sequences: [{ schema_name: "platform", sequence_name: "case_number_seq", schema_allowed: true, select_allowed: true }] };
}

test("read-only capability boundary rejects role drift, hidden RLS rows and incomplete schema/sequence access", () => {
  const input = capabilitiesFixture();
  const result = normalizeReadOnlyCapabilities(input, { sessionRole: LEASE_ROLE.role_name });
  assert.ok(result.relations.includes("platform_private.owner_private"));
  for (const change of [{ session_user: "cli_login_other" }, { effective_role: "postgres" }, { bypass_rls: false },
    { is_superuser: true }, { transaction_read_only: "off" }, { can_set_postgres: true }, { unexpected: true },
    { can_create_role: true }, { can_create_database: true }, { can_replicate: true }, { can_elevate: true },
    { relations: input.relations.slice(1) }, { relations: [...input.relations, input.relations[0]] },
    { relations: input.relations.map((row, i) => i === 3 ? { ...row, select_allowed: false } : row) },
    { relations: input.relations.map((row, i) => i === 3 ? { ...row, schema_allowed: false } : row) },
    { sequences: [{ ...input.sequences[0], select_allowed: false }] }]) {
    assert.throws(() => normalizeReadOnlyCapabilities({ ...input, ...change }, { sessionRole: LEASE_ROLE.role_name }));
  }
  const query = buildReadOnlyCapabilitySql();
  assert.match(query, /READ ONLY/);
  assert.doesNotMatch(query, /\b(?:CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP)\b/i);
});

test("COPY completeness distinguishes an empty Auth table from an omitted Auth table", () => {
  const capabilities = normalizeReadOnlyCapabilities(capabilitiesFixture(), { sessionRole: LEASE_ROLE.role_name });
  const dataAnalysis = { copyTables: ["auth.users", "auth.identities", "platform.student_cases", "platform_private.owner_private", "storage.buckets", "storage.objects"], aggregates: { auth_user_count: 0 } };
  const historyAnalysis = { copyTables: ["supabase_migrations.schema_migrations"] };
  assert.doesNotThrow(() => validateReadOnlyCopyCoverage({ capabilities, dataAnalysis, historyAnalysis }));
  for (const table of dataAnalysis.copyTables) {
    assert.throws(() => validateReadOnlyCopyCoverage({ capabilities, dataAnalysis: { ...dataAnalysis, copyTables: dataAnalysis.copyTables.filter((name) => name !== table) }, historyAnalysis }));
  }
  assert.throws(() => validateReadOnlyCopyCoverage({ capabilities, dataAnalysis, historyAnalysis: { copyTables: [] } }));
  assert.throws(() => validateReadOnlyCopyCoverage({ capabilities, dataAnalysis: { copyTables: [...dataAnalysis.copyTables, "public.unexpected"] }, historyAnalysis }));
});

test("lifecycle evidence cannot carry credentials, privileged mode, pending cleanup or reversed time", () => {
  const evidence = { mode: "temporary-cli-readonly", requested_read_only: true, effective_role: "supabase_read_only_user",
    role_sha256: "d".repeat(64), lease_ttl_seconds: 3600, issued_at: "2026-09-09T15:00:00.000Z",
    cleanup_completed_at: "2026-09-09T15:05:00.000Z", cleanup: "verified", cleanup_action: "deleted" };
  assert.deepEqual(validateAccessLifecycleEvidence(evidence), evidence);
  for (const change of [{ password: LEASE_PASSWORD }, { role: LEASE_ROLE.role_name }, { requested_read_only: false },
    { effective_role: "postgres" }, { cleanup: "pending" }, { cleanup_action: "assumed_expired" }, { lease_ttl_seconds: 0 },
    { cleanup_completed_at: "2026-09-09T14:59:59.000Z" }]) assert.throws(() => validateAccessLifecycleEvidence({ ...evidence, ...change }));
});

test("capture result remains unavailable until the owned role is verifiably revoked", async () => {
  let resolveDelete;
  let sawDelete;
  const deletion = new Promise((resolve) => { resolveDelete = resolve; });
  const requested = new Promise((resolve) => { sawDelete = resolve; });
  const api = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "ok" }, wait: deletion, onRequest: sawDelete }, { kind: "inventory", value: [] }]);
  let settled = false;
  const capture = withTemporaryReadOnlyLease({ ...leaseOptions(api), processesDrained: () => true }, async () => "complete-synthetic-capture");
  void capture.then(() => { settled = true; }, () => { settled = true; });
  await requested;
  assert.equal(settled, false);
  resolveDelete();
  const result = await capture;
  assert.equal(result.value, "complete-synthetic-capture");
  assert.equal(result.sourceAccess.cleanup, "verified");
  api.assertConsumed();
});

test("expired, aborted and failed captures still clean their own role without returning success", async () => {
  for (const scenario of ["expired", "aborted", "failed"]) {
    let clock = LEASE_NOW;
    const controller = new AbortController();
    const api = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "ok" } }, { kind: "inventory", value: [] }]);
    await assert.rejects(withTemporaryReadOnlyLease({ ...leaseOptions(api, { now: () => clock, signal: controller.signal }), processesDrained: () => true }, async (lease, signal) => {
      assert.equal(signal.aborted, false);
      if (scenario === "expired") clock = lease.deadlineMs;
      if (scenario === "aborted") controller.abort();
      if (scenario === "failed") throw new Error("synthetic capture failed");
      return "must-not-be-published";
    }));
    assert.equal(api.observed.filter((call) => call.kind === "delete").length, 1);
    assert.equal(api.observed.at(-1).signal.aborted, false);
    api.assertConsumed();
  }
});

test("failed cleanup or undrained processes prevent an otherwise successful capture", async () => {
  const broken = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "failed" } }]);
  await assert.rejects(withTemporaryReadOnlyLease({ ...leaseOptions(broken), processesDrained: () => true }, async () => "must-not-be-published"));
  const undrained = leaseApi(leaseStart());
  await assert.rejects(withTemporaryReadOnlyLease({ ...leaseOptions(undrained), processesDrained: () => false }, async () => "must-not-be-published"), { code: "temporary_lease_processes_not_drained" });
  assert.equal(undrained.observed.some((call) => call.kind === "delete"), false);
  undrained.assertConsumed();
});

test("temporary source ledger must be a nonempty contiguous known local migration prefix", () => {
  const rows = [{ version: "002", name: "second" }, { version: "001", name: "first" }];
  assert.deepEqual(normalizeLeaseSourceLedger(rows, ["003", "002", "001"]), { count: 2, minVersion: "001", maxVersion: "002" });
  for (const invalid of [[], [{ version: "001", name: "first" }, { version: "003", name: "gap" }],
    [rows[0], rows[0]], [{ version: "000", name: "invalid" }], [{ version: "1", name: "not-canonical" }],
    [{ version: "001", name: "first", statements: [] }], [{ version: "001", name: 42 }]]) {
    assert.throws(() => normalizeLeaseSourceLedger(invalid, ["001", "002", "003"]));
  }
  assert.throws(() => normalizeLeaseSourceLedger(rows, ["001"]));
});

test("an already expired lease never starts capture, but still reconciles its owned role", async () => {
  let ticks = 0;
  let captures = 0;
  const api = leaseApi([...leaseStart(), ownInventory(), { kind: "delete", value: { message: "ok" } }, { kind: "inventory", value: [] }]);
  await assert.rejects(withTemporaryReadOnlyLease({ ...leaseOptions(api, { now: () => ticks++ === 0 ? LEASE_NOW : LEASE_NOW + 900_001 }),
    processesDrained: () => true }, async () => { captures++; }), { code: "temporary_lease_expired" });
  assert.equal(captures, 0);
  api.assertConsumed();
});
const DATABASE_CA = fileURLToPath(
  new URL("../scripts/support/supabase-prod-ca-2021.crt", import.meta.url),
);
const DUMP_FILTERS = [
  "v3-managed-supabase-dump-schema.sh",
  "v3-managed-supabase-dump-data.sh",
  "v3-managed-supabase-dump-roles.sh",
].map((name) => fileURLToPath(new URL(`../scripts/support/${name}`, import.meta.url)));

function expectCode(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ManagedSupabaseExportError && error.code === code,
  );
}

async function expectCodeAsync(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ManagedSupabaseExportError && error.code === code,
  );
}

function jwtForRole(role) {
  return `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
}

test("temporary read-only transport requires an exact exclusive project window", () => {
  const required = ["run", "--project-ref", LEASE_REF, "--output-root", "/private/evo",
    "--age-recipient", `age1${"q".repeat(30)}`, "--signing-key", "/private/signing-key",
    "--trusted-public-key", "/private/trusted-signing-key.pub"];
  const selected = parseArgs([...required, "--database-auth", "temporary-cli-readonly", "--exclusive-project-ref", LEASE_REF]);
  assert.equal(selected.databaseAuth, "temporary-cli-readonly");
  assert.equal(selected.exclusiveProjectRef, LEASE_REF);
  assert.throws(() => parseArgs([...required, "--database-auth", "temporary-cli-readonly"]));
  assert.throws(() => parseArgs([...required, "--database-auth", "temporary-cli-readonly", "--exclusive-project-ref", "b".repeat(20)]));
  assert.throws(() => parseArgs([...required, "--database-auth", "postgres-fallback"]));
  assert.throws(() => parseArgs([...required, "--database-auth", "temporary-cli-readonly", "--exclusive-project-ref", REF, "--password", "fictional-secret"]));
});

test("argument contract accepts no secret values and rejects missing or duplicate fields", () => {
  const parsed = parseArgs([
    "run",
    "--project-ref", REF,
    "--output-root", "/private/evo",
    "--age-recipient", `age1${"q".repeat(30)}`,
    "--signing-key", "/private/signing-key",
    "--trusted-public-key", "/private/trusted-signing-key.pub",
  ]);
  assert.equal(parsed.projectRef, REF);
  assert.equal(parsed.command, "run");
  expectCode(
    () => parseArgs(["run", "--project-ref", REF]),
    "arguments_invalid",
  );
  expectCode(
    () => parseArgs([
      "run",
      "--project-ref", REF,
      "--project-ref", REF,
      "--age-recipient", `age1${"q".repeat(30)}`,
      "--signing-key", "/private/key",
      "--trusted-public-key", "/private/trusted.pub",
    ]),
    "arguments_invalid",
  );
  expectCode(
    () => parseArgs([
      "run",
      "--project-ref", "wrong",
      "--output-root", "/private/evo",
      "--age-recipient", `age1${"q".repeat(30)}`,
      "--signing-key", "/private/key",
      "--trusted-public-key", "/private/trusted.pub",
    ]),
    "project_ref_invalid",
  );
});

test("output root must be an existing private directory outside the repository", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-root-test-")));
  const privateRoot = join(root, "private");
  const repoRoot = join(root, "repo");
  mkdirSync(privateRoot, { mode: 0o700 });
  mkdirSync(repoRoot, { mode: 0o700 });
  try {
    assert.equal(validateOutputRoot(privateRoot, repoRoot), privateRoot);
    expectCode(() => validateOutputRoot(repoRoot, repoRoot), "output_root_forbidden");
    const openRoot = join(root, "open");
    mkdirSync(openRoot, { mode: 0o755 });
    expectCode(() => validateOutputRoot(openRoot, repoRoot), "output_root_invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OrbStack operator home must be canonical, owned, and not writable by peers", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-home-test-")));
  try {
    chmodSync(root, 0o700);
    assert.equal(validateOperatorHome(root), root);
    chmodSync(root, 0o722);
    expectCode(() => validateOperatorHome(root), "operator_home_invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("guarded cleanup requires its marker and removes that marker last", () => {
  const removable = realpathSync(
    mkdtempSync(join(tmpdir(), "evo-v3-managed-export-cleanup-test-")),
  );
  const markerless = realpathSync(
    mkdtempSync(join(tmpdir(), "evo-v3-managed-export-cleanup-test-")),
  );
  try {
    chmodSync(removable, 0o700);
    mkdirSync(join(removable, "nested"), { mode: 0o700 });
    writeFileSync(join(removable, "nested", "artifact"), "ciphertext\n", { mode: 0o600 });
    writeFileSync(
      join(removable, ".evo-v3-managed-supabase-export"),
      "managed-supabase-export-runtime\n",
      { mode: 0o600 },
    );
    guardedRemove(removable);
    assert.equal(existsSync(removable), false);
    expectCode(() => guardedRemove(markerless), "cleanup_target_invalid");
  } finally {
    rmSync(removable, { recursive: true, force: true });
    rmSync(markerless, { recursive: true, force: true });
  }
});

test("guarded cleanup restores the exact marker when a late file prevents root removal", () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "evo-v3-managed-export-cleanup-race-test-")),
  );
  const marker = join(root, ".evo-v3-managed-supabase-export");
  const markerContent = "managed-supabase-export-runtime\n";
  try {
    chmodSync(root, 0o700);
    writeFileSync(marker, markerContent, { mode: 0o600 });
    expectCode(
      () => guardedRemove(root, {
        beforeRootRemoval(directory) {
          writeFileSync(join(directory, "late-artifact"), "late\n", { mode: 0o600 });
        },
      }),
      "cleanup_directory_not_empty",
    );
    assert.equal(readFileSync(marker, "utf8"), markerContent);
    assert.equal(statSync(marker).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Storage headers never send opaque secret keys as bearer JWTs", () => {
  const opaque = `sb_secret_${"a".repeat(24)}`;
  const direct = storageDownloadHeaders(opaque);
  assert.equal(direct.apikey, opaque);
  assert.equal(direct.Authorization, undefined);
  assert.equal(direct["Accept-Encoding"], "identity");

  const sanitized = storageClientHeaders({ Authorization: `Bearer ${opaque}` }, opaque);
  assert.equal(sanitized.get("apikey"), opaque);
  assert.equal(sanitized.get("authorization"), null);

  const userJwt = jwtForRole("authenticated");
  const preserved = storageClientHeaders({ Authorization: `Bearer ${userJwt}` }, opaque);
  assert.equal(preserved.get("authorization"), `Bearer ${userJwt}`);

  const legacy = jwtForRole("service_role");
  assert.equal(storageDownloadHeaders(legacy).Authorization, `Bearer ${legacy}`);
  assert.equal(
    storageClientHeaders({}, legacy).get("authorization"),
    `Bearer ${legacy}`,
  );
});

test("Storage SDK fetch rejects redirects and never sends an opaque secret as bearer", async () => {
  const opaque = `sb_secret_${"b".repeat(24)}`;
  const controller = new AbortController();
  let observed = null;
  const origin = `https://${REF}.supabase.co`;
  const storageFetch = createStorageClientFetch(
    origin,
    opaque,
    controller.signal,
    async (url, options) => {
      observed = { url: String(url), options };
      return new Response(null, { status: 204 });
    },
  );

  await storageFetch(`${origin}/storage/v1/bucket`, {
    redirect: "follow",
    headers: { Authorization: `Bearer ${opaque}`, "x-client-info": "focused-test" },
  });

  assert.equal(observed.url, `${origin}/storage/v1/bucket`);
  assert.equal(observed.options.redirect, "error");
  assert.equal(observed.options.headers.get("apikey"), opaque);
  assert.equal(observed.options.headers.get("authorization"), null);
  assert.equal(observed.options.headers.get("x-client-info"), "focused-test");
  expectCode(
    () => storageFetch("https://attacker.invalid/storage/v1/bucket"),
    "storage_origin_invalid",
  );
});

test("signal cleanup aborts and terminates children without running filesystem cleanup", () => {
  const controller = new AbortController();
  const calls = [];
  let cleanupCalls = 0;
  const state = {
    cleanup() {
      cleanupCalls += 1;
    },
    signal: null,
    signalCount: 0,
    terminators: new Set([
      (reason, force) => calls.push({ reason, force }),
    ]),
  };
  const before = new Set(process.listeners("SIGTERM"));
  const remove = registerSignalCleanup(controller, state);
  const handler = process.listeners("SIGTERM").find((listener) => !before.has(listener));
  try {
    assert.equal(typeof handler, "function");
    handler();
    handler();
    assert.equal(controller.signal.aborted, true);
    assert.equal(cleanupCalls, 0);
    assert.deepEqual(calls, [
      { reason: "export_interrupted", force: false },
      { reason: "export_interrupted", force: true },
    ]);
  } finally {
    remove();
  }
});

test("concurrent preflight drains an aborted sibling and every registered terminator", async () => {
  const state = { terminators: new Set(), processGroups: new Set() };
  let siblingSettled = false;
  const siblingTerminator = () => {};

  await expectCodeAsync(
    drainConcurrentOperations([
      async () => {
        throw new ManagedSupabaseExportError("local_gate_failed");
      },
      async (signal) => {
        state.terminators.add(siblingTerminator);
        await new Promise((resolve) => {
          const settle = () => setTimeout(resolve, 20);
          if (signal.aborted) settle();
          else signal.addEventListener("abort", settle, { once: true });
        });
        state.terminators.delete(siblingTerminator);
        siblingSettled = true;
      },
    ], new AbortController().signal, state),
    "local_gate_failed",
  );

  assert.equal(siblingSettled, true);
  assert.equal(state.terminators.size, 0);
  assert.equal(state.processGroups.size, 0);
});

test("signing trust stays pinned when both key paths are replaced after preflight", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-signing-trust-test-")));
  const privateKey = join(root, "signing-key");
  const publicKey = join(root, "signing-key.pub");
  const fakeKeygen = join(root, "fake-ssh-keygen");
  const state = { terminators: new Set(), processGroups: new Set() };
  const environment = { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root };
  const executables = { sshKeygen: { real: fakeKeygen } };
  const controller = new AbortController();
  try {
    writeFileSync(privateKey, "ssh-ed25519 AAAA\n", { mode: 0o600 });
    writeFileSync(publicKey, "ssh-ed25519 AAAA original\n", { mode: 0o644 });
    writeFileSync(
      fakeKeygen,
      "#!/bin/sh\n[ \"$1\" = \"-y\" ] || exit 2\ncat \"$3\"\n",
      { mode: 0o700 },
    );
    const trust = await verifySigningKeyPair(
      { privateKey, publicKey },
      root,
      controller.signal,
      state,
      environment,
      executables,
    );
    assert.equal(trust.publicLine, "ssh-ed25519 AAAA");

    writeFileSync(privateKey, "ssh-ed25519 AQID\n", { mode: 0o600 });
    writeFileSync(publicKey, "ssh-ed25519 AQID replacement\n", { mode: 0o644 });
    await expectCodeAsync(
      verifyPrivateSigningKey(
        privateKey,
        trust.publicLine,
        root,
        controller.signal,
        state,
        environment,
        executables,
      ),
      "signing_trust_root_mismatch",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Management API receipt is allowlisted, exact-project bound, and healthy", () => {
  const project = normalizeProjectReceipt({
    id: REF,
    organization_id: "org-id",
    name: "evo-platform-prod",
    region: "ap-southeast-1",
    created_at: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE_HEALTHY",
    ignored_secret: "must-not-survive",
    database: {
      host: `db.${REF}.supabase.co`,
      version: "17.6.1.155",
      postgres_engine: "17",
      release_channel: "ga",
      ignored: "value",
    },
  }, REF);
  assert.deepEqual(Object.keys(project), [
    "ref",
    "organization_id",
    "name",
    "region",
    "created_at",
    "status",
    "database",
  ]);
  assert.equal(project.ref, REF);
  expectCode(
    () => normalizeProjectReceipt({ ...project, id: "b".repeat(20) }, REF),
    "management_project_mismatch",
  );
  expectCode(
    () => normalizeProjectReceipt({
      ...project,
      id: REF,
      status: "INACTIVE",
    }, REF),
    "management_project_not_healthy",
  );
});

test("provider receipt selects only a fresh latest completed backup", () => {
  const now = Date.parse("2026-09-05T04:00:00.000Z");
  const result = selectLatestCompletedBackup({
    backups: [
      { id: "older", inserted_at: "2026-09-04T00:00:00.000Z", status: "COMPLETED", is_physical_backup: true },
      { id: "failed", inserted_at: "2026-09-05T03:00:00.000Z", status: "FAILED", is_physical_backup: true },
      { id: 42, inserted_at: "2026-09-05T02:00:00.000Z", status: "COMPLETED", is_physical_backup: true },
    ],
  }, now);
  assert.equal(result.id, "42");
  expectCode(
    () => selectLatestCompletedBackup({ backups: [] }, now),
    "provider_backup_missing",
  );
  expectCode(
    () => selectLatestCompletedBackup({
      backups: [{ id: "stale", inserted_at: "2026-09-01T00:00:00.000Z", status: "COMPLETED" }],
    }, now),
    "provider_backup_stale",
  );
});

test("COPY parser preserves exact migration rows including statements", () => {
  const dump = [
    "COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;",
    "001\t{CREATE TABLE one;}\tinitial",
    "002\t{ALTER TABLE one ADD COLUMN two text;}\tsecond",
    "\\.",
    "",
  ].join("\n");
  const sections = parseCopySections(dump);
  assert.equal(sections.length, 1);
  const ledger = exactMigrationLedger(dump);
  assert.deepEqual(ledger, {
    count: 2,
    min_version: "001",
    max_version: "002",
    copy_rows_sha256: sections[0].raw_sha256,
  });
  assert.equal(ledger.copy_rows_sha256, sha256(
    "COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;\n" +
    "001\t{CREATE TABLE one;}\tinitial\n" +
    "002\t{ALTER TABLE one ADD COLUMN two text;}\tsecond\n\\.\n",
  ));
  expectCode(
    () => exactMigrationLedger(dump.replace("002", "001")),
    "migration_ledger_invalid",
  );
});

test("physical ledger order does not change logical bounds or raw COPY integrity", async () => {
  const header = "COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;";
  const rows = ["001\t{first}\tinitial", "011\t{second}\tsecond", "093\t{third}\tthird"];
  const dump = (entries) => `${header}\n${entries.join("\n")}\n\\.\n`;
  const original = dump(rows);
  const permuted = dump([rows[2], rows[1], rows[0]]);
  const directory = mkdtempSync(join(tmpdir(), "evo-ledger-order-"));
  const path = join(directory, "history.sql");
  try {
    writeFileSync(path, permuted, { mode: 0o600 });
    const parsed = exactMigrationLedger(permuted);
    assert.deepEqual(parsed, { count: 3, min_version: "001", max_version: "093", copy_rows_sha256: sha256(permuted) });
    assert.notEqual(parsed.copy_rows_sha256, exactMigrationLedger(original).copy_rows_sha256);
    assert.deepEqual((await analyzeCopyDumpFile(path, true)).ledger, parsed);
    assert.equal(readFileSync(path, "utf8"), permuted);
    for (const invalid of [dump([rows[2], rows[0], rows[2]]), dump(["bad\t{first}\tinitial"]), dump(["001\t{first}"])]) {
      expectCode(() => exactMigrationLedger(invalid), "migration_ledger_invalid");
      writeFileSync(path, invalid);
      await assert.rejects(analyzeCopyDumpFile(path, true), (error) => error.code === "migration_ledger_invalid");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("data aggregates publish counts and a hash, never row contents", () => {
  const dump = [
    "COPY auth.users (id, email) FROM stdin;",
    "1\tprivate@example.invalid",
    "2\tsecond@example.invalid",
    "\\.",
    "COPY storage.buckets (id) FROM stdin;",
    "documents",
    "\\.",
    "COPY platform.student_cases (id) FROM stdin;",
    "case-private",
    "\\.",
    "",
  ].join("\n");
  const result = dataRowAggregates(dump);
  assert.equal(result.row_count, 4);
  assert.equal(result.auth_user_count, 2);
  assert.equal(result.storage_bucket_row_count, 1);
  assert.doesNotMatch(JSON.stringify(result), /private@example|case-private/u);
});

test("Storage inventory is deterministic, duplicate-safe, and byte bounded", () => {
  const first = storageInventoryDigest({
    buckets: [
      { id: "z", name: "z", public: false },
      { id: "a", name: "a", public: true },
    ],
    objects: [
      { bucket_id: "z", path: "two.bin", id: "2", metadata: { size: 3 } },
      { bucket_id: "a", path: "one.bin", id: "1", metadata: { size: 2 } },
    ],
  });
  const second = storageInventoryDigest({
    buckets: [...first.normalized.buckets].reverse(),
    objects: [...first.normalized.objects].reverse(),
  });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.object_count, 2);
  assert.equal(first.total_bytes, 5);
  assert.equal(first.private_bucket_count, 1);
  expectCode(
    () => storageInventoryDigest({
      buckets: first.normalized.buckets,
      objects: [first.normalized.objects[0], first.normalized.objects[0]],
    }),
    "storage_inventory_duplicate_object",
  );
  const trulyEmpty = storageInventoryDigest({
    buckets: [{ id: "empty", name: "empty", public: false }],
    objects: [],
  });
  assert.equal(trulyEmpty.object_count, 0);
  assert.equal(trulyEmpty.total_bytes, 0);
  assert.deepEqual(trulyEmpty.normalized.objects, []);
  const zeroByte = storageInventoryDigest({
    buckets: [{ id: "empty", name: "empty", public: false }],
    objects: [{ bucket_id: "empty", path: "zero.bin", id: "0", metadata: { size: 0 } }],
  });
  assert.equal(zeroByte.object_count, 1);
  assert.equal(zeroByte.total_bytes, 0);
  expectCode(
    () => storageInventoryDigest({
      buckets: [{ id: "bad", name: "bad", public: false }],
      objects: [{ bucket_id: "bad", path: "missing.bin", id: "x", metadata: {} }],
    }),
    "storage_object_size_invalid",
  );
});

function guardToken(token) {
  return token.replaceAll(/[^A-Za-z0-9]/gu, "0").padEnd(63, "0").slice(0, 63);
}

function pgDumpEnvelope(body, token) {
  const guard = guardToken(token);
  return [
    "SET session_replication_role = replica;",
    "",
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    `\\restrict ${guard}`,
    "",
    body,
    "--",
    "-- PostgreSQL database dump complete",
    "--",
    "",
    `\\unrestrict ${guard}`,
    "",
    "RESET ALL;",
    "",
  ].join("\n");
}

function pgSchemaEnvelope(body, token) {
  const guard = guardToken(token);
  return ["", `\\restrict ${guard}`, "", body, `\\unrestrict ${guard}`, "", ""].join("\n");
}

function pgRolesEnvelope(body, token) {
  const guard = guardToken(token);
  return [
    "",
    `\\restrict ${guard}`,
    "",
    body,
    `\\unrestrict ${guard}`,
    "",
    "RESET ALL;",
    "",
  ].join("\n");
}

test("tracked Supabase dump filters preserve PostgreSQL restricted-mode guards", () => {
  for (const path of DUMP_FILTERS) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /(?:un)?restrict/u);
  }
});

test("semantic SQL digest normalizes valid active guards for all managed SQL artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-sql-digest-test-"));
  try {
    const cases = [
      ["data.sql", pgDumpEnvelope],
      ["history-data.sql", pgDumpEnvelope],
      ["schema.sql", pgSchemaEnvelope],
      ["history-schema.sql", pgSchemaEnvelope],
      ["roles.sql", pgRolesEnvelope],
    ];
    for (const [artifactName, envelope] of cases) {
      const first = join(root, `${artifactName}.first`);
      const equivalent = join(root, `${artifactName}.equivalent`);
      const drifted = join(root, `${artifactName}.drifted`);
      writeFileSync(first, envelope("CREATE TABLE x(id bigint);\nSELECT setval('x_id_seq', 7);", "token_one"));
      writeFileSync(equivalent, envelope("CREATE TABLE x(id bigint);\nSELECT setval('x_id_seq', 7);", "token_two"));
      writeFileSync(drifted, envelope("CREATE TABLE x(id bigint);\nSELECT setval('x_id_seq', 8);", "token_three"));
      assert.equal(
        await semanticSqlFileDigest(first, artifactName),
        await semanticSqlFileDigest(equivalent, artifactName),
        `${artifactName} should ignore only its random active guard token`,
      );
      assert.notEqual(
        await semanticSqlFileDigest(first, artifactName),
        await semanticSqlFileDigest(drifted, artifactName),
        `${artifactName} should retain body bytes in its digest`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic SQL digest hashes guard-shaped inner SQL content", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-semantic-inner-guard-test-"));
  const first = join(root, "first.sql");
  const changed = join(root, "changed.sql");
  try {
    writeFileSync(first, pgDumpEnvelope("SELECT 'before';\n-- \\restrict inner_one\nSELECT 'after';", "outer_one"));
    writeFileSync(changed, pgDumpEnvelope("SELECT 'before';\n-- \\restrict inner_two\nSELECT 'after';", "outer_two"));
    assert.notEqual(
      await semanticSqlFileDigest(first, "data.sql"),
      await semanticSqlFileDigest(changed, "data.sql"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic SQL digest rejects missing or mismatched pg_dump guard pairs", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-semantic-invalid-guard-test-"));
  const mismatched = join(root, "mismatched.sql");
  const missing = join(root, "missing.sql");
  try {
    const openingToken = "opening0token".padEnd(63, "0").slice(0, 63);
    const differentToken = "different0token".padEnd(63, "0").slice(0, 63);
    writeFileSync(
      mismatched,
      pgDumpEnvelope("SELECT 1;", "opening0token").replace(
        `\\unrestrict ${openingToken}`,
        `\\unrestrict ${differentToken}`,
      ),
    );
    writeFileSync(
      missing,
      pgDumpEnvelope("SELECT 1;", "opening0token").replace(
        `\\unrestrict ${openingToken}\n`,
        "",
      ),
    );
    await expectCodeAsync(
      semanticSqlFileDigest(mismatched, "data.sql"),
      "dump_guard_envelope_invalid",
    );
    await expectCodeAsync(
      semanticSqlFileDigest(missing, "data.sql"),
      "dump_guard_envelope_invalid",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic SQL digest is byte-exact outside known active guard tokens", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-semantic-bytes-test-"));
  const canonical = join(root, "canonical.sql");
  const crlf = join(root, "crlf.sql");
  const noFinalNewline = join(root, "no-final-newline.sql");
  const schema = join(root, "schema.sql");
  const schemaChanged = join(root, "schema-changed.sql");
  try {
    const envelope = pgDumpEnvelope("SELECT 1;", "outer0token");
    writeFileSync(canonical, envelope);
    writeFileSync(crlf, envelope.replaceAll("\n", "\r\n"));
    writeFileSync(noFinalNewline, envelope.slice(0, -1));
    await expectCodeAsync(
      semanticSqlFileDigest(crlf, "data.sql"),
      "dump_guard_envelope_invalid",
    );
    await expectCodeAsync(
      semanticSqlFileDigest(noFinalNewline, "data.sql"),
      "dump_guard_envelope_invalid",
    );

    writeFileSync(schema, "-- arbitrary artifact\nSELECT 1;\n");
    writeFileSync(schemaChanged, "-- arbitrary artifact\nSELECT 2;\n");
    assert.notEqual(
      await semanticSqlFileDigest(schema, "other.sql"),
      await semanticSqlFileDigest(schemaChanged, "other.sql"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pooler receipt pins the documented session endpoint and rejects drift", () => {
  const project = { ref: REF, region: "ap-southeast-1" };
  const payload = [{
    identifier: REF,
    database_type: "PRIMARY",
    db_host: "aws-1-ap-southeast-1.pooler.supabase.com",
    db_user: `postgres.${REF}`,
    db_name: "postgres",
    pool_mode: "transaction",
    db_port: 6543,
  }];
  assert.deepEqual(normalizePoolerReceipt(payload, project), {
    host: "aws-1-ap-southeast-1.pooler.supabase.com",
    user: `postgres.${REF}`,
    database: "postgres",
    session_port: 5432,
    source_mode: "transaction",
    source_port: 6543,
  });
  expectCode(
    () => normalizePoolerReceipt([{ ...payload[0], pool_mode: "session" }], project),
    "management_pooler_invalid",
  );
});

test("PostgreSQL dump clients must meet a patched security floor", () => {
  assert.equal(
    patchedPostgresClientVersion("pg_dump (PostgreSQL) 18.6\n", "pg_dump"),
    "18.6",
  );
  assert.equal(
    patchedPostgresClientVersion("pg_dumpall (PostgreSQL) 17.11\n", "pg_dumpall"),
    "17.11",
  );
  assert.equal(
    patchedPostgresClientVersion("psql (PostgreSQL) 18.6\n", "psql"),
    "18.6",
  );
  expectCode(
    () => patchedPostgresClientVersion("pg_dump (PostgreSQL) 17.10\n", "pg_dump"),
    "postgres_client_security_update_required",
  );
  expectCode(
    () => patchedPostgresClientVersion("pg_dump 18.6\n", "pg_dump"),
    "postgres_client_version_invalid",
  );
});

test("every database dump pass imports one strictly validated synchronized snapshot", () => {
  const snapshotId = "00000003-0000001B-1";
  assert.equal(synchronizedSnapshotFlag(snapshotId), `--snapshot=${snapshotId}`);
  const plan = managedDatabaseDumpPlan(snapshotId);
  assert.equal(plan.length, 5);
  assert.equal(plan.find((entry) => entry.filename === "roles.sql").variables.EXTRA_FLAGS, undefined);
  for (const entry of plan.filter((candidate) => candidate.filename !== "roles.sql")) {
    assert.match(entry.variables.EXTRA_FLAGS, new RegExp(`(?:^| )--snapshot=${snapshotId}(?: |$)`, "u"));
    assert.equal(entry.variables.EXTRA_FLAGS.match(/--snapshot=/gu)?.length, 1);
  }
  for (const invalid of [
    "",
    "00000003-0000001B-0",
    "00000003-0000001B-1 --file=/tmp/leak",
    "00000003-0000001B-1\n--no-owner",
  ]) {
    expectCode(() => synchronizedSnapshotFlag(invalid), "database_snapshot_id_invalid");
  }
});

test("snapshot holder keeps one read-only transaction alive and drains on close", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-snapshot-holder-")));
  const state = { terminators: new Set(), processGroups: new Set() };
  const controller = new AbortController();
  const fakeHolder = String.raw`
    let input = "";
    let ready = false;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
      if (!ready && input.includes("pg_export_snapshot")) {
        ready = true;
        process.stdout.write("EVO_SYNC_SNAPSHOT:00000003-0000001B-1\n");
      }
      if (input.includes("ROLLBACK;") && input.includes("\\q")) process.exit(0);
    });
    setInterval(() => undefined, 1000);
  `;
  try {
    const holder = await openSynchronizedDatabaseSnapshot(
      process.execPath,
      ["-e", fakeHolder],
      {
        cwd: root,
        environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
        signal: controller.signal,
        state,
        timeoutMs: 5_000,
        killGraceMs: 50,
      },
    );
    assert.equal(holder.snapshotId, "00000003-0000001B-1");
    assert.equal(state.terminators.size, 1);
    assert.equal(state.processGroups.size, 1);
    await holder.close();
    assert.equal(state.terminators.size, 0);
    assert.equal(state.processGroups.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot holder fails closed on malformed output and interruption", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-snapshot-failure-")));
  const environment = { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root };
  try {
    await expectCodeAsync(
      openSynchronizedDatabaseSnapshot(
        process.execPath,
        ["-e", 'process.stdout.write("not-a-snapshot\\n"); setInterval(() => {}, 1000)'],
        {
          cwd: root,
          environment,
          signal: new AbortController().signal,
          state: { terminators: new Set(), processGroups: new Set() },
          timeoutMs: 5_000,
          killGraceMs: 50,
        },
      ),
      "database_snapshot_holder_output_invalid",
    );

    const state = { terminators: new Set(), processGroups: new Set() };
    const controller = new AbortController();
    const holder = await openSynchronizedDatabaseSnapshot(
      process.execPath,
      ["-e", String.raw`
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
          input += chunk;
          if (input.includes("pg_export_snapshot")) {
            process.stdout.write("EVO_SYNC_SNAPSHOT:00000003-0000001B-1\n");
          }
        });
        process.on("SIGTERM", () => undefined);
        setInterval(() => undefined, 1000);
      `],
      {
        cwd: root,
        environment,
        signal: controller.signal,
        state,
        timeoutMs: 5_000,
        killGraceMs: 50,
      },
    );
    controller.abort();
    await expectCodeAsync(holder.done, "export_interrupted");
    assert.equal(state.terminators.size, 0);
    assert.equal(state.processGroups.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("database TLS pins the reviewed Supabase CA bytes, fingerprint, and validity", () => {
  const verified = validateSupabaseDatabaseCa(
    DATABASE_CA,
    Date.parse("2026-09-05T00:00:00Z"),
  );
  assert.equal(
    verified.sha256,
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  );
  assert.equal(
    verified.fingerprint,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );

  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-ca-test-")));
  const changed = join(root, "changed.crt");
  try {
    writeFileSync(
      changed,
      readFileSync(DATABASE_CA, "utf8").replace("MIIDxD", "NIIDxD"),
      { mode: 0o600 },
    );
    expectCode(() => validateSupabaseDatabaseCa(changed), "database_ca_invalid");
    expectCode(
      () => validateSupabaseDatabaseCa(DATABASE_CA, Date.parse("2031-04-27T00:00:00Z")),
      "database_ca_invalid",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command timeout forcibly ends a child that ignores SIGTERM", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-command-timeout-test-"));
  const marker = join(root, "sigterm-observed");
  const startedAt = Date.now();
  try {
    await expectCodeAsync(
      spawnCommand(
        process.execPath,
        [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1] + '.ready', 'ready'); process.on('SIGTERM', () => require('node:fs').writeFileSync(process.argv[1], 'term')); setInterval(() => {}, 1000);",
          marker,
        ],
        {
          cwd: root,
          environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
          code: "bounded_timeout",
          timeoutMs: 300,
          killGraceMs: 100,
        },
      ),
      "bounded_timeout",
    );
    assert.equal(existsSync(`${marker}.ready`), true);
    assert.equal(existsSync(marker), true);
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command input failure rejects cleanly when the child closes stdin early", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-command-stdin-test-"));
  try {
    await expectCodeAsync(
      spawnCommand(
        process.execPath,
        ["-e", "process.stdin.destroy(); setTimeout(() => {}, 250);"],
        {
          cwd: root,
          environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
          input: Buffer.alloc(16 * 1024 * 1024, 0x61),
          code: "stdin_closed",
          timeoutMs: 2_000,
          killGraceMs: 100,
        },
      ),
      "stdin_closed",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command timeout kills a SIGTERM-ignoring process tree before settling", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-command-tree-test-"));
  const pidPath = join(root, "grandchild.pid");
  let grandchildPid = null;
  try {
    await expectCodeAsync(
      spawnCommand(
        process.execPath,
        [
          "-e",
          [
            "const { spawn } = require('node:child_process');",
            "const { writeFileSync } = require('node:fs');",
            "const grandchild = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`], { stdio: 'ignore' });",
            "writeFileSync(process.argv[1], String(grandchild.pid));",
            "process.on('SIGTERM', () => {});",
            "setInterval(() => {}, 1000);",
          ].join(" "),
          pidPath,
        ],
        {
          cwd: root,
          environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
          code: "process_tree_timeout",
          timeoutMs: 350,
          killGraceMs: 100,
        },
      ),
      "process_tree_timeout",
    );
    assert.equal(existsSync(pidPath), true);
    grandchildPid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(Number.isSafeInteger(grandchildPid), true);
    assert.throws(
      () => process.kill(grandchildPid, 0),
      (error) => error?.code === "ESRCH",
    );
  } finally {
    if (Number.isSafeInteger(grandchildPid)) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function oneObjectInventory(size) {
  return storageInventoryDigest({
    buckets: [{ id: "private", name: "private", public: false }],
    objects: [{
      bucket_id: "private",
      path: "object.bin",
      id: "object-id",
      metadata: { size },
    }],
  });
}

async function runDownloadCase({ size, body, idleTimeoutMs = 100, declaredSize = size }) {
  const root = mkdtempSync(join(tmpdir(), "evo-export-download-test-"));
  try {
    return await downloadStorageObjects({
      inventory: oneObjectInventory(size),
      origin: `https://${REF}.supabase.co`,
      secretKey: `sb_secret_${"a".repeat(24)}`,
      outputDirectory: join(root, "bytes"),
      signal: new AbortController().signal,
      idleTimeoutMs,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-length": String(declaredSize) },
      }),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Storage downloader accepts a real zero-byte response and hashes empty content", async () => {
  const result = await runDownloadCase({ size: 0, body: null });
  assert.equal(result.totalBytes, 0);
  assert.equal(result.objects[0].sha256, sha256(Buffer.alloc(0)));
});

test("Storage downloader permits progressive streams longer than the idle window", async () => {
  const body = new ReadableStream({
    start(controller) {
      let sent = 0;
      const timer = setInterval(() => {
        controller.enqueue(Uint8Array.of(sent));
        sent += 1;
        if (sent === 3) {
          clearInterval(timer);
          controller.close();
        }
      }, 40);
    },
  });
  const result = await runDownloadCase({ size: 3, body, idleTimeoutMs: 100 });
  assert.equal(result.totalBytes, 3);
});

test("Storage downloader fails closed on inactivity and oversized streams", async () => {
  const stalled = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1));
    },
  });
  await expectCodeAsync(
    runDownloadCase({ size: 2, body: stalled, idleTimeoutMs: 50 }),
    "storage_object_download_timed_out",
  );
  await expectCodeAsync(
    runDownloadCase({ size: 1, body: Uint8Array.of(1, 2) }),
    "storage_object_size_mismatch",
  );
});

test("Storage downloader cancels the body when Content-Length is invalid", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await expectCodeAsync(
    runDownloadCase({ size: 1, declaredSize: 2, body }),
    "storage_object_size_invalid",
  );
  assert.equal(cancelled, true);
});

function receiptFixture() {
  return {
    schema: "evo-v3-managed-supabase-export-receipt/v1",
    captured_at: "2026-09-05T00:00:00.000Z",
    git: { head: "1".repeat(40), migration_tree: "2".repeat(40) },
    source: { identity_sha256: "3".repeat(64) },
    provider_backup: { id: "backup-id", inserted_at: "2026-09-04T00:00:00.000Z", status: "COMPLETED", physical: true },
    database: { postgres_major: 17, migration_count: 114, migration_min_version: "001", migration_max_version: "114", migration_copy_rows_sha256: "4".repeat(64), table_count: 20, row_count: 50, auth_user_count: 1 },
    storage: { inventory_sha256: "5".repeat(64), bucket_count: 3, private_bucket_count: 1, public_bucket_count: 2, object_count: 0, total_bytes: 0 },
    encrypted_artifacts: { "data.sql.age": { bytes: 100, sha256: "6".repeat(64) } },
    tools: { supabase_cli: "2.116.0", age: "v1.3.1", ssh: "available", orb: "Running", docker_context: "orbstack" },
    signature: { namespace: "evo-v3-managed-supabase-recovery", identity: "evo-v3-managed-supabase-export", public_key_fingerprint: "SHA256:abc", trust_root: "operator-held-external-public-key" },
    result: "export_verified",
  };
}

test("redacted receipt rejects secret-shaped fields and requires ciphertext hashes", () => {
  const receipt = assertRedactedReceipt(receiptFixture());
  assert.equal(receipt.result, "export_verified");
  expectCode(
    () => assertRedactedReceipt({ ...receiptFixture(), access_token: "secret" }),
    "receipt_shape_invalid",
  );
  expectCode(
    () => assertRedactedReceipt({
      ...receiptFixture(),
      tools: { ...receiptFixture().tools, connection_string: "hidden" },
    }),
    "receipt_contains_sensitive_material",
  );
});

test("canonical JSON is stable across key order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});
