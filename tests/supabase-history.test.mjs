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

const SOURCE = Object.freeze({
  commit: "1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5",
  path: "agent-lead2-inbox/supabase/migrations",
  range: "001-039",
});
const FIXTURE_SQL = "select 1;\n";
const FIXTURE_SHA256 = "4a45092ccf992ea92250053a80b931b787924ba61648f420555511b84f10ab6c";

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

test("accepts the exact canonical 001-039 history with only a legacy pointer", async (t) => {
  const root = await createValidFixture(t);

  const { stdout, stderr } = await runVerifier(root);

  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    ok: true,
    checked: 39,
    range: "001-039",
  });
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

test("rejects a non-contiguous manifest and any migration 040 or later", async (t) => {
  const root = await createValidFixture(t);
  const manifestPath = path.join(root, "supabase", "migration-history.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  manifest.files[38].name = "040_fixture_040.sql";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await unlink(
    path.join(root, "supabase", "migrations", "039_fixture_039.sql"),
  );
  await writeFile(
    path.join(root, "supabase", "migrations", "040_fixture_040.sql"),
    FIXTURE_SQL,
  );

  await expectVerifierFailure(root, /migration 040 or later is not allowed/);
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
