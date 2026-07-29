import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);
const verifierPath = new URL("../scripts/verify-supabase-history.mjs", import.meta.url);
const supabaseConfigPath = new URL("../supabase/config.toml", import.meta.url);

const SOURCE = Object.freeze({
  commit: "1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5",
  path: "agent-lead2-inbox/supabase/migrations",
  range: "001-039",
});
const FIXTURE_SQL = "select 1;\n";
const FIXTURE_SHA256 = "4a45092ccf992ea92250053a80b931b787924ba61648f420555511b84f10ab6c";
const REQUIRED_040 = "040_platform_namespaces_and_secret_containment.sql";
const REQUIRED_041 = "041_platform_identity_rbac_audit.sql";
const REQUIRED_042 = "042_platform_student_admissions.sql";
const REQUIRED_043 = "043_platform_documents_finance_notifications.sql";
const REQUIRED_044 = "044_platform_communications_contracts.sql";
const REQUIRED_045 = "045_platform_durable_work_queues.sql";
const required040Path = new URL(
  `../supabase/migrations/${REQUIRED_040}`,
  import.meta.url,
);
const required041Path = new URL(
  `../supabase/migrations/${REQUIRED_041}`,
  import.meta.url,
);
const required042Path = new URL(
  `../supabase/migrations/${REQUIRED_042}`,
  import.meta.url,
);
const required043Path = new URL(
  `../supabase/migrations/${REQUIRED_043}`,
  import.meta.url,
);
const required044Path = new URL(
  `../supabase/migrations/${REQUIRED_044}`,
  import.meta.url,
);
const required045Path = new URL(
  `../supabase/migrations/${REQUIRED_045}`,
  import.meta.url,
);

async function createValidFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "evo-supabase-history-"));
  t.after(() => rm(root, { force: true, recursive: true }));

  const migrationsDirectory = path.join(root, "supabase", "migrations");
  const legacyDirectory = path.join(root, "agent-lead2-inbox", "supabase");
  await mkdir(migrationsDirectory, { recursive: true });
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(
    path.join(legacyDirectory, "README.md"),
    "Canonical migrations live at ../../supabase/migrations.\n",
  );

  const files = [];
  for (let number = 1; number <= 39; number += 1) {
    const prefix = String(number).padStart(3, "0");
    const name = `${prefix}_fixture_${prefix}.sql`;
    await writeFile(path.join(migrationsDirectory, name), FIXTURE_SQL);
    files.push({
      name,
      sha256: FIXTURE_SHA256,
      bytes: 10,
    });
  }

  await writeFile(
    path.join(root, "supabase", "migration-history.json"),
    `${JSON.stringify(
      {
        algorithm: "sha256",
        source: SOURCE,
        files,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_040),
    await readFile(required040Path, "utf8"),
  );
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_041),
    await readFile(required041Path, "utf8"),
  );
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_042),
    await readFile(required042Path, "utf8"),
  );
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_043),
    await readFile(required043Path, "utf8"),
  );
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_044),
    await readFile(required044Path, "utf8"),
  );
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_045),
    await readFile(required045Path, "utf8"),
  );

  return root;
}

async function runVerifier(root) {
  return execFileAsync(process.execPath, [verifierPath.pathname], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      EVO_SUPABASE_HISTORY_TEST_ROOT: root,
      NODE_ENV: "test",
    },
  });
}

async function expectVerifierFailure(root, pattern) {
  await assert.rejects(
    runVerifier(root),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, pattern);
      assert.equal(error.stdout, "");
      return true;
    },
  );
}

test("accepts immutable 001-039 plus required migrations 040-045", async (t) => {
  const root = await createValidFixture(t);

  const { stdout, stderr } = await runVerifier(root);

  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    ok: true,
    checked: 45,
    range: "001-045",
    current: "045",
    total: 45,
  });
});

test("rejects a same-length rewrite of immutable migration 040", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    REQUIRED_040,
  );
  const original = await readFile(migrationPath, "utf8");
  const rewritten = original.replace("Establishes", "establishes");
  assert.notEqual(rewritten, original);
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  await writeFile(migrationPath, rewritten);

  await expectVerifierFailure(root, /040_.+ SHA-256 changed/);
});

test("rejects a same-length rewrite of immutable migration 041", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    REQUIRED_041,
  );
  const original = await readFile(migrationPath, "utf8");
  const rewritten = original.replace("fail-closed", "fail-Closed");
  assert.notEqual(rewritten, original);
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  await writeFile(migrationPath, rewritten);

  await expectVerifierFailure(root, /041_.+ SHA-256 changed/);
});

test("rejects a same-length rewrite of immutable migration 042", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    REQUIRED_042,
  );
  const original = await readFile(migrationPath, "utf8");
  const rewritten = original.replace("student cases", "student Cases");
  assert.notEqual(rewritten, original);
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  await writeFile(migrationPath, rewritten);

  await expectVerifierFailure(root, /042_.+ SHA-256 changed/);
});

test("rejects a same-length rewrite of immutable migration 043", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    REQUIRED_043,
  );
  const original = await readFile(migrationPath, "utf8");
  const rewritten = original.replace("database contract", "Database contract");
  assert.notEqual(rewritten, original);
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  await writeFile(migrationPath, rewritten);

  await expectVerifierFailure(root, /043_.+ SHA-256 changed/);
});

test("rejects a same-length rewrite of immutable migration 044", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    REQUIRED_044,
  );
  const original = await readFile(migrationPath, "utf8");
  const rewritten = original.replace("tenant-isolated", "Tenant-isolated");
  assert.notEqual(rewritten, original);
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  await writeFile(migrationPath, rewritten);

  await expectVerifierFailure(root, /044_.+ SHA-256 changed/);
});

test("rejects a same-length rewrite of immutable migration 045", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    REQUIRED_045,
  );
  const original = await readFile(migrationPath, "utf8");
  const rewritten = original.replace("durable, bounded", "Durable, bounded");
  assert.notEqual(rewritten, original);
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  await writeFile(migrationPath, rewritten);

  await expectVerifierFailure(root, /045_.+ SHA-256 changed/);
});

test("exposes platform without exposing private or queue schemas", async () => {
  const config = await readFile(supabaseConfigPath, "utf8");
  const schemasMatch = config.match(/^schemas\s*=\s*(\[[^\n]+\])$/m);
  const searchPathMatch = config.match(
    /^extra_search_path\s*=\s*(\[[^\n]+\])$/m,
  );

  assert.ok(schemasMatch, "config.toml must declare api.schemas");
  assert.ok(
    searchPathMatch,
    "config.toml must declare api.extra_search_path",
  );

  const exposedSchemas = JSON.parse(schemasMatch[1]);
  const extraSearchPath = JSON.parse(searchPathMatch[1]);

  assert.deepEqual(exposedSchemas, [
    "public",
    "platform",
    "graphql_public",
  ]);
  assert.equal(exposedSchemas.includes("platform_private"), false);
  assert.equal(exposedSchemas.includes("pgmq_public"), false);
  assert.equal(extraSearchPath.includes("platform_private"), false);
  assert.equal(extraSearchPath.includes("pgmq_public"), false);
});

test("configures the database custom access-token hook", async () => {
  const config = await readFile(supabaseConfigPath, "utf8");

  assert.match(
    config,
    /\[auth\.hook\.custom_access_token\]\s+enabled\s*=\s*true\s+uri\s*=\s*"pg-functions:\/\/postgres\/platform_private\/custom_access_token_hook"/m,
  );
});

test("rejects byte or SHA-256 drift in a canonical migration", async (t) => {
  const root = await createValidFixture(t);
  const migrationPath = path.join(
    root,
    "supabase",
    "migrations",
    "019_fixture_019.sql",
  );

  await writeFile(migrationPath, "select 2;\n");
  await expectVerifierFailure(root, /019_fixture_019\.sql SHA-256 changed/);

  await writeFile(migrationPath, "select 20;\n");
  await expectVerifierFailure(root, /019_fixture_019\.sql byte count changed/);
});

test("requires exact migrations 040-045 and contiguous later migrations", async (t) => {
  const root = await createValidFixture(t);
  const migrationsDirectory = path.join(root, "supabase", "migrations");

  await unlink(
    path.join(migrationsDirectory, REQUIRED_040),
  );
  await writeFile(
    path.join(migrationsDirectory, "040_wrong_name.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /required migration 040 must be 040_platform_namespaces_and_secret_containment\.sql/,
  );

  await unlink(path.join(migrationsDirectory, "040_wrong_name.sql"));
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_040),
    await readFile(required040Path, "utf8"),
  );
  await unlink(path.join(migrationsDirectory, REQUIRED_041));
  await writeFile(
    path.join(migrationsDirectory, "041_wrong_name.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /required migration 041 must be 041_platform_identity_rbac_audit\.sql/,
  );

  await unlink(path.join(migrationsDirectory, "041_wrong_name.sql"));
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_041),
    await readFile(required041Path, "utf8"),
  );
  await unlink(path.join(migrationsDirectory, REQUIRED_042));
  await writeFile(
    path.join(migrationsDirectory, "042_wrong_name.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /required migration 042 must be 042_platform_student_admissions\.sql/,
  );

  await unlink(path.join(migrationsDirectory, "042_wrong_name.sql"));
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_042),
    await readFile(required042Path, "utf8"),
  );
  await unlink(path.join(migrationsDirectory, REQUIRED_043));
  await writeFile(
    path.join(migrationsDirectory, "043_wrong_name.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /required migration 043 must be 043_platform_documents_finance_notifications\.sql/,
  );

  await unlink(path.join(migrationsDirectory, "043_wrong_name.sql"));
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_043),
    await readFile(required043Path, "utf8"),
  );
  await unlink(path.join(migrationsDirectory, REQUIRED_044));
  await writeFile(
    path.join(migrationsDirectory, "044_wrong_name.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /required migration 044 must be 044_platform_communications_contracts\.sql/,
  );

  await unlink(path.join(migrationsDirectory, "044_wrong_name.sql"));
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_044),
    await readFile(required044Path, "utf8"),
  );
  await unlink(path.join(migrationsDirectory, REQUIRED_045));
  await writeFile(
    path.join(migrationsDirectory, "045_wrong_name.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /required migration 045 must be 045_platform_durable_work_queues\.sql/,
  );

  await unlink(path.join(migrationsDirectory, "045_wrong_name.sql"));
  await writeFile(
    path.join(migrationsDirectory, REQUIRED_045),
    await readFile(required045Path, "utf8"),
  );
  await writeFile(
    path.join(migrationsDirectory, "047_gap.sql"),
    FIXTURE_SQL,
  );
  await expectVerifierFailure(
    root,
    /canonical migration sequence must be contiguous; expected 046, found 047/,
  );

  await unlink(path.join(migrationsDirectory, "047_gap.sql"));
  await writeFile(
    path.join(migrationsDirectory, "046_future.sql"),
    FIXTURE_SQL,
  );

  const { stdout, stderr } = await runVerifier(root);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    ok: true,
    checked: 45,
    range: "001-045",
    current: "046",
    total: 46,
  });
});

test("rejects nondeterministic or incorrect provenance metadata", async (t) => {
  const root = await createValidFixture(t);
  const manifestPath = path.join(root, "supabase", "migration-history.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  manifest.generatedAt = "2026-07-28T00:00:00.000Z";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await expectVerifierFailure(
    root,
    /manifest must contain exactly: algorithm, files, source/,
  );

  delete manifest.generatedAt;
  manifest.source.commit = "0000000000000000000000000000000000000000";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await expectVerifierFailure(root, /manifest source commit must be 1b2ee797/);
});

test("rejects a duplicate SQL migration left under the companion path", async (t) => {
  const root = await createValidFixture(t);
  const legacyMigrationsDirectory = path.join(
    root,
    "agent-lead2-inbox",
    "supabase",
    "migrations",
  );
  await mkdir(legacyMigrationsDirectory, { recursive: true });
  await writeFile(
    path.join(legacyMigrationsDirectory, "001_initial_schema.sql"),
    FIXTURE_SQL,
  );

  await expectVerifierFailure(
    root,
    /must contain only the README\.md pointer/,
  );
});
