#!/usr/bin/env node
// Synthetic, disposable PostgreSQL proof only. No provider API, credentials,
// published ports, production database URL or network access is accepted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { analyzeCopyDumpFile, managedDatabaseDumpPlan, openSynchronizedDatabaseSnapshot,
  patchedPostgresClientVersion, semanticSqlFileDigest } from "./export-v3-managed-supabase-backup.mjs";
import { buildReadOnlyCapabilitySql, normalizeReadOnlyCapabilities, validateReadOnlyCopyCoverage } from "./lib/managed-supabase-readonly-lease.mjs";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const container = `evo-backup-readonly-proof-${randomUUID()}`;
const owner = randomUUID();
const state = { terminators: new Set(), processGroups: new Set() };
const controller = new AbortController();
const abortProof = () => controller.abort(new Error("local_proof_interrupted"));
process.once("SIGINT", abortProof);
process.once("SIGTERM", abortProof);
const docker = "/usr/local/bin/docker";
const image = "postgres:18.6-bookworm";
const role = "cli_login_fixture_readonly";
let scratch;
let started = false;
let holder;
let dumpBinary;
let dumpAllBinary;
const environment = { PATH: process.env.PATH, HOME: process.env.HOME };
function sync(executable, args, input) {
  controller.signal.throwIfAborted();
  const result = spawnSync(executable, args, { encoding: "utf8", input, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, env: environment });
  if (result.status !== 0) throw new Error(`local_proof_command_failed:${executable}:${result.status}`);
  return result.stdout.trim();
}
function sql(statement, { user = "postgres", readonly = false, expectedFailure = false } = {}) {
  controller.signal.throwIfAborted();
  const args = ["exec", "-i", "-e", `PGUSER=${user}`, "-e", "PGDATABASE=postgres"];
  if (readonly) args.push("-e", "PGOPTIONS=-c role=supabase_read_only_user -c default_transaction_read_only=on");
  args.push(container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1");
  const result = spawnSync(docker, args, { encoding: "utf8", input: statement, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, env: environment });
  if (expectedFailure) { assert.notEqual(result.status, 0, "read-only mutation must fail"); return result; }
  assert.equal(result.status, 0, `synthetic SQL failed: ${result.stderr}`);
  return result.stdout.trim();
}
async function snapshot(user) {
  return openSynchronizedDatabaseSnapshot(docker, ["exec", "-i", "-e", `PGUSER=${user}`, "-e", "PGDATABASE=postgres",
    "-e", "PGOPTIONS=-c default_transaction_read_only=on", container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1"],
  { cwd: root, environment: { ...environment, EVO_DUMP_EFFECTIVE_ROLE: user === role ? "supabase_read_only_user" : "postgres" }, state, signal: controller.signal, timeoutMs: 120_000 });
}
async function dump(command, snapshotId, user, effectiveRole, output) {
  controller.signal.throwIfAborted();
  const variables = { ...command.variables, PGUSER: user, PGDATABASE: "postgres", PG_DUMP_BIN: dumpBinary,
    PG_DUMPALL_BIN: dumpAllBinary, EVO_DUMP_EFFECTIVE_ROLE: effectiveRole,
    PGOPTIONS: "-c default_transaction_read_only=on" };
  const args = ["exec"];
  for (const [key, value] of Object.entries(variables)) args.push("-e", `${key}=${value}`);
  args.push(container, "bash", `/workspace/scripts/support/v3-managed-supabase-dump-${command.scriptKey}.sh`);
  // These children can see only the synthetic, network-disabled container. Keep
  // its diagnostic stderr available; production exporter stderr remains hidden.
  const result = spawnSync(docker, args, { cwd: root, env: environment, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw Object.assign(new Error(`${command.filename}: ${result.stderr}`), { code: "synthetic_dump_failed" });
  writeFileSync(output, result.stdout, { mode: 0o600, flag: "wx" });
  assert.ok(readFileSync(output).length > 0, `${command.filename} must not be empty`);
}

const fixture = `
CREATE ROLE supabase_read_only_user NOLOGIN BYPASSRLS;
GRANT pg_read_all_data TO supabase_read_only_user;
CREATE ROLE cli_login_fixture_readonly LOGIN NOINHERIT;
GRANT supabase_read_only_user TO cli_login_fixture_readonly;
CREATE ROLE evo_fixture_reader NOLOGIN;
CREATE SCHEMA platform;
CREATE SCHEMA platform_private;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA supabase_migrations;
REVOKE ALL ON SCHEMA platform_private FROM PUBLIC;
CREATE TABLE public.backup_public (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE platform.backup_accounts (id BIGSERIAL PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE platform_private.backup_private (id INTEGER PRIMARY KEY, evidence TEXT NOT NULL);
ALTER TABLE platform_private.backup_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.backup_private FORCE ROW LEVEL SECURITY;
CREATE POLICY nobody ON platform_private.backup_private USING (false);
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, encrypted_password TEXT);
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.users FORCE ROW LEVEL SECURITY;
CREATE TABLE auth.identities (id INTEGER PRIMARY KEY, user_id UUID REFERENCES auth.users(id));
CREATE TABLE auth.sessions (id INTEGER PRIMARY KEY, user_id UUID REFERENCES auth.users(id));
CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false);
CREATE TABLE storage.objects (id INTEGER PRIMARY KEY, bucket_id TEXT REFERENCES storage.buckets(id), name TEXT);
CREATE TABLE supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, name TEXT, statements TEXT[]);
GRANT USAGE ON SCHEMA platform TO evo_fixture_reader;
GRANT SELECT ON platform.backup_accounts TO evo_fixture_reader;
INSERT INTO public.backup_public VALUES (1,'synthetic public');
INSERT INTO platform.backup_accounts(label) VALUES ('synthetic account');
INSERT INTO platform_private.backup_private VALUES (1,'synthetic private A'),(2,'synthetic private B');
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001','student-one@example.test','synthetic-hash-one'),
 ('00000000-0000-4000-8000-000000000002','student-two@example.test','synthetic-hash-two');
INSERT INTO auth.identities VALUES (1,'00000000-0000-4000-8000-000000000001');
INSERT INTO auth.sessions VALUES (1,'00000000-0000-4000-8000-000000000001');
INSERT INTO storage.buckets VALUES ('documents','documents',false);
INSERT INTO storage.objects VALUES (1,'documents','synthetic/file.txt');
INSERT INTO supabase_migrations.schema_migrations VALUES ('001','synthetic initial',ARRAY['CREATE TABLE synthetic();']),
 ('134','synthetic last',ARRAY['SELECT 134;']);
`;

try {
  assert.equal(sync("/usr/local/bin/orb", ["status"]), "Running");
  assert.equal(sync(docker, ["context", "show"]), "orbstack");
  sync(docker, ["image", "inspect", image, "--format", "{{.Id}}"]);
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "evo-backup-readonly-proof-")));
  chmodSync(scratch, 0o700);
  sync(docker, ["run", "--detach", "--name", container, "--label", `evo.proof.owner=${owner}`, "--network", "none",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--mount", `type=bind,src=${root},dst=/workspace,readonly`, image]);
  started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    controller.signal.throwIfAborted();
    const result = spawnSync(docker, ["exec", container, "pg_isready", "-U", "postgres"], { env: environment, timeout: 5_000 });
    if (result.status === 0) { ready = true; break; }
    await delay(500);
  }
  assert.equal(ready, true, "disposable PostgreSQL must become ready");
  dumpBinary = sync(docker, ["exec", container, "sh", "-c", "command -v pg_dump"]);
  dumpAllBinary = sync(docker, ["exec", container, "sh", "-c", "command -v pg_dumpall"]);
  assert.match(dumpBinary, /^\/usr\/(?:bin|lib\/postgresql\/18\/bin)\/pg_dump$/);
  assert.match(dumpAllBinary, /^\/usr\/(?:bin|lib\/postgresql\/18\/bin)\/pg_dumpall$/);
  const clientVersion = sync(docker, ["exec", container, "pg_dump", "--version"]);
  // This fixture uses the Debian image, not the exporter's Homebrew binary.
  // Check its explicit patched image version before stripping packaging text.
  assert.match(clientVersion, /^pg_dump \(PostgreSQL\) 18\.6(?: \(Debian [^)]+\))?$/);
  patchedPostgresClientVersion(clientVersion.replace(/ \(Debian [^)]+\)$/, ""), "pg_dump");
  sql(fixture);
  const capabilities = normalizeReadOnlyCapabilities(JSON.parse(sql(buildReadOnlyCapabilitySql(), { user: role })), { sessionRole: role });
  assert.ok(capabilities.relations.includes("auth.identities"));
  assert.ok(capabilities.relations.includes("auth.sessions"));
  assert.ok(capabilities.relations.includes("platform_private.backup_private"));
  assert.equal(sql("SELECT session_user || ':' || current_user;", { user: role, readonly: true }), `${role}:supabase_read_only_user`);
  assert.equal(sql("SELECT count(*) FROM platform_private.backup_private;", { user: role, readonly: true }), "2");
  sql("INSERT INTO platform.backup_accounts(label) VALUES ('must not write');", { user: role, readonly: true, expectedFailure: true });
  holder = await snapshot(role);
  const plan = managedDatabaseDumpPlan(holder.snapshotId);
  assert.deepEqual(plan.map((command) => command.filename), ["roles.sql", "schema.sql", "data.sql", "history-schema.sql", "history-data.sql"]);
  for (const command of plan) await dump(command, holder.snapshotId, role, "supabase_read_only_user", join(scratch, `readonly-${command.filename}`));
  // A concurrent committed write must not change either repeat of the exported
  // snapshot. This is an actual DB change, not a mocked dump or a file snapshot.
  sql("INSERT INTO platform_private.backup_private VALUES (3,'committed after exported snapshot');");
  assert.equal(sql("SELECT count(*) FROM platform_private.backup_private;"), "3");
  for (const command of [...plan].reverse()) {
    const again = join(scratch, `again-${command.filename}`);
    const privileged = join(scratch, `postgres-${command.filename}`);
    await dump(command, holder.snapshotId, role, "supabase_read_only_user", again);
    await dump(command, holder.snapshotId, "postgres", "postgres", privileged);
    const expected = await semanticSqlFileDigest(privileged, command.filename);
    assert.equal(await semanticSqlFileDigest(join(scratch, `readonly-${command.filename}`), command.filename), expected, `${command.filename}: read-only equals full privileged snapshot`);
    assert.equal(await semanticSqlFileDigest(again, command.filename), expected, `${command.filename}: concurrent writer cannot alter snapshot`);
  }
  const data = await analyzeCopyDumpFile(join(scratch, "readonly-data.sql"), false, { includeTableNames: true });
  const history = await analyzeCopyDumpFile(join(scratch, "readonly-history-data.sql"), true, { includeTableNames: true });
  validateReadOnlyCopyCoverage({ capabilities, dataAnalysis: data, historyAnalysis: history });
  assert.throws(() => validateReadOnlyCopyCoverage({ capabilities,
    dataAnalysis: { ...data, copyTables: data.copyTables.filter((name) => name !== "auth.users"), aggregates: { ...data.aggregates, auth_user_count: 0 } }, historyAnalysis: history }));
  assert.equal(data.aggregates.auth_user_count, 2);
  assert.equal(data.aggregates.storage_bucket_row_count, 1);
  assert.equal(data.aggregates.storage_object_row_count, 1);
  assert.equal(history.ledger.count, 2);
  assert.equal(history.ledger.max_version, "134");
  const roleDump = readFileSync(join(scratch, "readonly-roles.sql"), "utf8");
  assert.match(roleDump, /CREATE ROLE "evo_fixture_reader"/);
  assert.doesNotMatch(roleDump, /CREATE ROLE "cli_login_/);
  assert.doesNotMatch(roleDump, /PASSWORD '/);
  await holder.close(); holder = null;
  for (const [elevate, revoke] of [
    ["ALTER ROLE supabase_read_only_user CREATEROLE;", "ALTER ROLE supabase_read_only_user NOCREATEROLE;"],
    ["ALTER ROLE cli_login_fixture_readonly CREATEDB;", "ALTER ROLE cli_login_fixture_readonly NOCREATEDB;"],
    ["ALTER ROLE supabase_read_only_user REPLICATION;", "ALTER ROLE supabase_read_only_user NOREPLICATION;"],
    ["GRANT pg_write_all_data TO supabase_read_only_user;", "REVOKE pg_write_all_data FROM supabase_read_only_user;"],
    ["GRANT pg_read_server_files TO cli_login_fixture_readonly;", "REVOKE pg_read_server_files FROM cli_login_fixture_readonly;"],
  ]) {
    sql(elevate);
    assert.throws(() => normalizeReadOnlyCapabilities(JSON.parse(sql(buildReadOnlyCapabilitySql(), { user: role })), { sessionRole: role }), "elevated login or reachable role must be rejected before dump");
    sql(revoke);
  }
  sql("ALTER ROLE supabase_read_only_user NOBYPASSRLS;");
  assert.throws(() => normalizeReadOnlyCapabilities(JSON.parse(sql(buildReadOnlyCapabilitySql(), { user: role })), { sessionRole: role }));
  holder = await snapshot(role);
  const restricted = managedDatabaseDumpPlan(holder.snapshotId).find((command) => command.filename === "data.sql");
  await assert.rejects(dump(restricted, holder.snapshotId, role, "supabase_read_only_user", join(scratch, "rls-must-fail.sql")), { code: "synthetic_dump_failed" });
  await holder.close(); holder = null;
  sql("ALTER ROLE supabase_read_only_user BYPASSRLS; REVOKE pg_read_all_data FROM supabase_read_only_user;");
  assert.throws(() => normalizeReadOnlyCapabilities(JSON.parse(sql(buildReadOnlyCapabilitySql(), { user: role })), { sessionRole: role }));
  console.log("MANAGED_BACKUP_READONLY_POSTGRES_VERIFIED: five artifacts, full Auth/private/history/custom roles, repeatable snapshot, denied write and RLS-negative");
} finally {
  try {
    await holder?.close();
  } finally {
    // Cleanup is independent of the cancelled proof signal and can target only
    // this exact generated container after checking its private ownership label.
    if (started) {
      const inspected = spawnSync(docker, ["inspect", "--format", '{{index .Config.Labels "evo.proof.owner"}}', container], { encoding: "utf8", timeout: 15_000, env: environment });
      assert.equal(inspected.status, 0);
      assert.equal(inspected.stdout.trim(), owner);
      const removed = spawnSync(docker, ["rm", "--force", container], { timeout: 30_000, env: environment });
      assert.equal(removed.status, 0, "owned disposable container cleanup must succeed");
    }
    if (scratch) rmSync(scratch, { recursive: true, force: false });
    process.removeListener("SIGINT", abortProof);
    process.removeListener("SIGTERM", abortProof);
  }
  assert.equal(state.processGroups.size, 0, "all proof child process groups must drain before teardown");
}
