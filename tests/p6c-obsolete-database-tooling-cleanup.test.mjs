import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

const FROZEN_DRIZZLE_HISTORY = Object.freeze({
  "drizzle/0000_database_foundation.sql":
    "5fb68b4680594ffb778dc4df6d7591131186724bd3371747545282216649547f",
  "drizzle/0001_v2_private_documents.sql":
    "a17441fe950d171f4e24e2019dd77834cce22ae0b475e2169b3c27c09fcf911e",
  "drizzle/0002_v2_canonical_crm.sql":
    "8cb1822ec5fdaed3124b9998889c4340a3cae6163d5ffb4481ecba2d7b9d9fa0",
  "drizzle/0003_v2_whatsapp_outbound.sql":
    "1418f5c2ab4e97cb8019370157d06573a1afc6395059516928f530b3869517c7",
  "drizzle/0004_v2_amocrm_canonical_writes.sql":
    "5fa66e6b1650155ffbb77a9a9ef55e9b4f56297315b5610d56c2f08d890001f4",
  "drizzle/0005_v2_amocrm_lead_tag_catalog.sql":
    "e0bf9b70d621853db8b103b20fbf9b5033804a19b0a42adb1fc725669b207d51",
  "drizzle/meta/0000_snapshot.json":
    "33f10b8c19a2656e6342ed087c81ea5b58c09a502e7c250fe255eb27bcbebf8d",
  "drizzle/meta/0001_snapshot.json":
    "b14f5c617edd1e7b60a19c31810209bf8cf2a8e213318e91f9bffc9b3f01e791",
  "drizzle/meta/0002_snapshot.json":
    "b3e3af29f352f4fe5db3dbbbc386c5f457b4c551199fd0d246b7683457294e9e",
  "drizzle/meta/0003_snapshot.json":
    "52aa0453193c65f01ce640bd52263ad454c9968250aaeb4d560ac554d171ec43",
  "drizzle/meta/0004_snapshot.json":
    "7327bb11b062f7262fd57fd5dbe8e266ab43a45bc9fbd338a7a72f3462da8daa",
  "drizzle/meta/0005_snapshot.json":
    "faf069ee8a5b3130005df5f7b326323cde6bc3da73e5c9ea52b0e6fada8f4339",
  "drizzle/meta/_journal.json":
    "93293937ab445d080be8a3102ab7ec4e2fc2014eb5aea4c1f7dd5c3933cde7d2",
});

function source(path) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

function missing(path) {
  assert.equal(
    existsSync(new URL(path, repoRoot)),
    false,
    `${path} must not remain in the active successor runtime`,
  );
}

function presentFile(path) {
  const url = new URL(path, repoRoot);
  assert.equal(existsSync(url), true, `${path} must remain available`);
  assert.equal(statSync(url).isFile(), true, `${path} must remain a file`);
}

function filesUnder(directory) {
  return readdirSync(new URL(directory, repoRoot), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}${entry.name}`;
      return entry.isDirectory() ? filesUnder(`${path}/`) : [path];
    })
    .sort();
}

test("P6C removes obsolete executable database tooling, schemas, and fixture E2E paths", () => {
  for (const path of [
    "docker-compose.local.yml",
    "drizzle.config.ts",
    "scripts/backup-sqlite.mjs",
    "scripts/bootstrap-admin.mjs",
    "scripts/migrate-drizzle.mjs",
    "scripts/migrate-visa-role.mjs",
    "scripts/verify-drizzle-history.mjs",
    "scripts/verify-restored-settings.mjs",
    "src/db/schema/canonical-crm-core.ts",
    "src/db/schema/canonical-crm-events.ts",
    "src/db/schema/canonical-crm-operations.ts",
    "src/db/schema/database-contract.ts",
    "src/db/schema/index.ts",
    "tests/disaster-recovery.test.mjs",
    "tests/visa-role-migration.test.mjs",
    "tests/e2e/p1c-object-scope.spec.ts",
    "tests/e2e/platform-navigation-dashboard-polish.spec.ts",
    "tests/e2e/platform-operations.spec.ts",
    "tests/e2e/platform-student-portal-polish.spec.ts",
    "tests/e2e/sensitive-permissions.spec.ts",
    "tests/e2e/student-case-lifecycle.spec.ts",
  ]) {
    missing(path);
  }

  presentFile("tests/e2e/student-portal.spec.ts");
  const studentPortalGate = source("tests/e2e/student-portal.spec.ts");
  assert.match(studentPortalGate, /@supabase\/supabase-js/u);
  assert.doesNotMatch(
    studentPortalGate,
    /(?:better-sqlite3|drizzle-orm|src\/db\/|\.sqlite\b)/u,
    "the replacement Student Portal browser gate must remain Supabase-only",
  );
});

test("P6C removes Drizzle and SQLite commands, packages, and lockfile graph", () => {
  const manifest = JSON.parse(source("package.json"));
  const lockfile = JSON.parse(source("package-lock.json"));
  const nextConfig = source("next.config.ts");

  for (const scriptName of [
    "db:generate",
    "db:check",
    "db:migrate",
    "db:verify",
    "bootstrap:admin",
    "backup:db",
    "migrate:visa-role",
  ]) {
    assert.equal(manifest.scripts?.[scriptName], undefined, scriptName);
  }

  const declaredPackages = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  for (const packageName of [
    "@types/better-sqlite3",
    "better-sqlite3",
    "drizzle-kit",
    "drizzle-orm",
  ]) {
    assert.equal(declaredPackages[packageName], undefined, packageName);
  }

  assert.equal(
    manifest.overrides?.["@esbuild-kit/core-utils"],
    undefined,
    "the obsolete Drizzle toolchain override must not remain",
  );

  const obsoleteLockNodes = Object.keys(lockfile.packages ?? {}).filter((path) =>
    /(?:^|\/)node_modules\/(?:@types\/better-sqlite3|better-sqlite3|drizzle-kit|drizzle-orm)$/u.test(
      path,
    ),
  );
  assert.deepEqual(obsoleteLockNodes, []);

  assert.doesNotMatch(nextConfig, /serverExternalPackages|better-sqlite3/u);
});

test("P6C runtime configuration fails closed on Supabase without local database fallbacks", () => {
  const environment = source(".env.example");
  const playwright = source("playwright.config.ts");

  for (const variableName of [
    "DATABASE_URL",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "POSTGRES_PORT",
    "EVO_DB_PATH",
    "EVO_BACKUP_DIR",
  ]) {
    assert.doesNotMatch(environment, new RegExp(`^${variableName}=`, "mu"));
  }

  assert.match(playwright, /process\.env\.PLAYWRIGHT_BASE_URL/u);
  assert.match(playwright, /if\s*\(\s*!baseURL\s*\)/u);
  assert.match(playwright, /throw new Error/u);
  assert.match(playwright, /credential-free loopback HTTP origin/u);
  assert.doesNotMatch(
    playwright,
    /webServer|EVO_UI_CONTRACT_FIXTURES|EVO_DB_PATH|better-sqlite3/u,
  );
});

test("P6C database and provider harnesses use only the canonical Supabase database", () => {
  const foundationHarness = source("scripts/test-postgres-v2-foundation.sh");
  const providerHarness = source(
    "scripts/verify-platform-provider-acceptance.sh",
  );
  const nodeRuntimeCheck = source("scripts/check-node-runtime.mjs");

  assert.match(foundationHarness, /SUPABASE_DB_URL/u);
  assert.match(foundationHarness, /supabase db reset --local/u);
  assert.match(foundationHarness, /rm -f -- "\$supabase_lock_pid_file"/u);
  assert.doesNotMatch(
    foundationHarness,
    /"\$repo_root\/scripts\/test-postgres-authorization\.sh"/u,
  );
  assert.match(
    foundationHarness,
    /start_app configured configured local-service[\s\S]*supabase_staff_auth_browser_assert configured[\s\S]*verify_p4_admissions_storage_acceptance[\s\S]*platform_communications_browser_assert configured/u,
  );
  assert.match(
    foundationHarness,
    /platform_communications_browser_assert inbound-unavailable "missing primary webhook secret fails clearly without projection"/u,
  );
  assert.match(
    foundationHarness,
    /supabase_staff_auth_browser_assert unavailable "missing Supabase configuration stays unavailable"/u,
  );
  assert.doesNotMatch(
    foundationHarness,
    /\bDATABASE_URL\b|POSTGRES_(?:USER|PASSWORD|DB|PORT)|docker compose|verify-drizzle-history|migrate-drizzle|drizzle-kit|drizzle\.__drizzle_migrations|broken-drizzle|evo_foundation_broken/u,
  );

  assert.match(providerHarness, /SUPABASE_DB_URL/u);
  assert.doesNotMatch(providerHarness, /\bDATABASE_URL\b/u);

  assert.match(nodeRuntimeCheck, /expectedMajor = 22/u);
  assert.doesNotMatch(nodeRuntimeCheck, /better-sqlite3|SQLite ABI/u);
});

test("P6C foundation harness reports an unrecoverable stale lock without starting Docker", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "evo-p6c-stale-lock-"));
  const lockDirectory = join(
    temporaryRoot,
    "evo-platform-local-supabase-foundation.lock",
  );
  const blockingEntry = join(lockDirectory, "blocking-entry");

  try {
    mkdirSync(lockDirectory);
    writeFileSync(blockingEntry, "preserve the non-empty lock");

    const result = spawnSync("bash", ["scripts/test-postgres-v2-foundation.sh"], {
      cwd: fileURLToPath(repoRoot),
      encoding: "utf8",
      env: {
        ...process.env,
        EVO_NODE_BIN: process.execPath,
        TMPDIR: `${temporaryRoot}/`,
      },
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Cannot recover the stale EVO local Supabase foundation lock/u,
    );
    assert.doesNotMatch(result.stderr, /fail: command not found/u);
    assert.equal(existsSync(blockingEntry), true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("P6C preserves the exact frozen Drizzle history without executing it", () => {
  const expectedPaths = Object.keys(FROZEN_DRIZZLE_HISTORY).sort();
  assert.deepEqual(filesUnder("drizzle/"), expectedPaths);

  for (const [historicalPath, expectedSha256] of Object.entries(
    FROZEN_DRIZZLE_HISTORY,
  )) {
    const url = new URL(historicalPath, repoRoot);
    const stat = lstatSync(url);
    assert.equal(stat.isSymbolicLink(), false, `${historicalPath} must not be a symlink`);
    assert.equal(stat.isFile(), true, `${historicalPath} must remain a file`);
    assert.equal(
      createHash("sha256").update(readFileSync(url)).digest("hex"),
      expectedSha256,
      `${historicalPath} must remain byte-for-byte frozen`,
    );
  }
});

test("P6C retains real successor outcome proof", () => {
  for (const activeSupabaseProof of [
    "supabase/config.toml",
    "supabase/migrations/103_platform_amocrm_command_runtime.sql",
    "supabase/migrations/105_platform_student_case_sales_links.sql",
    "supabase/tests/platform_amocrm_command_rls.sql",
    "supabase/tests/platform_document_storage_rls.sql",
    "supabase/tests/platform_identity_rbac.sql",
    "tests/platform-amocrm-command-rpc.test.mjs",
    "tests/platform-private-documents.test.mjs",
    "tests/platform-sales-actions.test.mjs",
    "tests/supabase-staff-auth.test.mjs",
    "tests/protected-backup-tools.test.mjs",
  ]) {
    presentFile(activeSupabaseProof);
  }
});
