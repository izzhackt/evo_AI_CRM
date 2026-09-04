import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("V3-H removed active staging release artifacts instead of retaining a parallel runtime", async () => {
  for (const path of [
    "docker-compose.staging.yml",
    "deploy/env.staging.example",
    "scripts/evo-release-environment-profile.mjs",
    "tests/release-environment-profile.test.mjs",
    "docs/runbooks/u11-staging-recovery.md",
  ]) {
    await assert.rejects(read(path), { code: "ENOENT" }, path);
  }

  const archive = await read("docs/archive/v1/u11-staging-recovery.md");
  assert.match(archive, /Archived 2026-09-05/u);
  assert.match(archive, /history only/u);
  assert.match(archive, /active #551\/#552 V3-H release path has no staging/u);
  assert.match(archive, /environment; use `deploy\/fast-app-release\.md`/u);
});

test("V3-H local recovery harness is OrbStack-only, isolated and provider-effect-free", async () => {
  const scriptPath = "scripts/test-v3h-release-recovery-orbstack.sh";
  const script = await read(scriptPath);
  const mode = (await stat(new URL(scriptPath, root))).mode;
  assert.notEqual(mode & 0o111, 0, "V3-H recovery harness must be executable");

  assert.match(script, /orb status/u);
  assert.match(script, /docker context show/u);
  assert.match(script, /Docker context must be exactly orbstack/u);
  assert.match(script, /resolve-postgres-test-image\.sh/u);
  assert.match(script, /supabase\/migrations/u);
  assert.match(script, /pg_dump[\s\S]*--format=custom/u);
  assert.match(script, /pg_restore --list/u);
  assert.match(script, /pg_restore[\s\S]*--no-owner --no-privileges/u);
  assert.match(script, /storage-source/u);
  assert.match(script, /storage-restore/u);
  assert.match(script, /scripts\/evo-fast-release\.sh" deploy/u);
  assert.match(script, /rolled_back/u);
  assert.match(script, /deployment_failed/u);
  assert.match(script, /providerTraffic:false/u);
  assert.match(script, /productionMutation:false/u);
  assert.match(script, /stagingEnvironment:false/u);
  assert.match(script, /EVO_RELEASE_TRANSFER_ROOT/u);

  assert.doesNotMatch(
    script,
    /EVO_RELEASE_STAGING_ROOT|docker-compose\.staging|env\.staging|--controlled-staging|SUPABASE_ACCESS_TOKEN|supabase db push|supabase link|supabase branch|crm_primary|evo-inbox/u,
  );
});

test("V3-H runbooks document no-staging release, manual schema apply and exact rollback", async () => {
  const fastRelease = await read("deploy/fast-app-release.md");
  const productionRelease = await read("deploy/production-release.md");
  const disasterRecovery = await read("docs/DISASTER_RECOVERY.md");

  assert.match(fastRelease, /workflow_run/u);
  assert.match(fastRelease, /EVO platform CI/u);
  assert.match(fastRelease, /successful `push` to `main`/u);
  assert.match(fastRelease, /EVO_RELEASE_TRANSFER_ROOT/u);
  assert.match(fastRelease, /schema apply remains a separate manual action/u);
  assert.doesNotMatch(fastRelease, /workflow_dispatch|environment reviewer|EVO_RELEASE_STAGING_ROOT|staging_profile_preflight/u);

  assert.match(productionRelease, /EVO_RELEASE_ROLLBACK_STATE/u);
  assert.match(productionRelease, /scripts\/evo-fast-release\.sh rollback/u);
  assert.match(productionRelease, /exact green `main` commit/u);
  assert.doesNotMatch(productionRelease, /EVO_RELEASE_STAGING_ROOT|GitHub Environment approval/u);

  assert.match(disasterRecovery, /scripts\/test-v3h-release-recovery-orbstack\.sh/u);
  assert.match(disasterRecovery, /pg_dump/u);
  assert.match(disasterRecovery, /pg_restore/u);
  assert.match(disasterRecovery, /Storage object bytes/u);
  assert.match(disasterRecovery, /no staging environment/u);
  assert.match(disasterRecovery, /managed-production backup identification/u);
  assert.match(disasterRecovery, /https:\/\/supabase\.com\/docs\/guides\/database\/overview/u);
  assert.match(disasterRecovery, /https:\/\/www\.postgresql\.org\/docs\/current\/app-pgdump\.html/u);
  assert.match(disasterRecovery, /https:\/\/docs\.github\.com\/actions\/using-workflows\/events-that-trigger-workflows/u);
});
