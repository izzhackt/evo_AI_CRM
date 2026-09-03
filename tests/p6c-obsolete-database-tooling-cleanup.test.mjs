import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

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
    "tests/e2e/student-portal.spec.ts",
  ]) {
    missing(path);
  }
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
    /\bDATABASE_URL\b|POSTGRES_(?:USER|PASSWORD|DB|PORT)|docker compose|verify-drizzle-history|migrate-drizzle|drizzle-kit|drizzle\.__drizzle_migrations|broken-drizzle|evo_foundation_broken/u,
  );

  assert.match(providerHarness, /SUPABASE_DB_URL/u);
  assert.doesNotMatch(providerHarness, /\bDATABASE_URL\b/u);

  assert.match(nodeRuntimeCheck, /expectedMajor = 22/u);
  assert.doesNotMatch(nodeRuntimeCheck, /better-sqlite3|SQLite ABI/u);
});

test("P6C preserves frozen Drizzle history and real successor outcome proof", () => {
  for (const historicalPath of [
    "drizzle/0000_database_foundation.sql",
    "drizzle/0005_v2_amocrm_lead_tag_catalog.sql",
    "drizzle/meta/_journal.json",
  ]) {
    presentFile(historicalPath);
  }

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
