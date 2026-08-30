import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SHELL_PATH = new URL(
  "../scripts/verify-connected-amocrm-validation.sh",
  import.meta.url,
);
const PREPARE_PATH = new URL(
  "../scripts/prepare-connected-amocrm-validation.mjs",
  import.meta.url,
);
const E2E_PATH = new URL(
  "./e2e/canonical-amocrm-connected-provider.spec.ts",
  import.meta.url,
);

test("connected amoCRM harness is opt-in, exact-main and OrbStack-only", async () => {
  const source = await readFile(SHELL_PATH, "utf8");

  assert.match(source, /^set -euo pipefail$/m);
  assert.match(source, /^umask 077$/m);
  assert.match(source, /Shell xtrace must be disabled/u);
  assert.match(source, /EVO_V2_REAL_AMOCRM_ACCEPTANCE:-.*== "1"/u);
  assert.match(source, /git fetch --quiet origin main/u);
  assert.match(source, /git status --porcelain=v1 --untracked-files=all/u);
  assert.match(source, /head_sha.*origin_main_sha.*expected_main_sha/su);
  assert.match(source, /\$\(orb status\).*Running/u);
  assert.match(source, /\$\(docker context show\).*orbstack/u);
  assert.match(source, /mktemp -d/u);
  assert.match(source, /private legacy provider env file/u);
  assert.match(source, /private token file/u);
  assert.match(source, /-L "127\.0\.0\.1:\$\{tunnel_port\}:/u);
  assert.match(source, /read-waha-self/u);
  assert.match(source, /authority-blocked\.json/u);
  assert.match(source, /provider-preparation-attempt\.json/u);
  assert.match(source, /dispatch-attempt\.json/u);
  assert.match(source, /canonical-amocrm-connected-provider\.spec\.ts/u);
  assert.doesNotMatch(source, /set -x/u);
  assert.doesNotMatch(source, /curl[^\n]*-X\s+(POST|PATCH|PUT|DELETE)/u);
  assert.doesNotMatch(source, /source\s+.*provider/u);
});

test("preparation helper maps only the explicit legacy provider keys into private V2 state", async () => {
  const source = await readFile(PREPARE_PATH, "utf8");

  for (const legacyKey of [
    "EVO_AGENT_AMO_BASE_URL",
    "EVO_AGENT_AMO_CLIENT_ID",
    "EVO_AGENT_AMO_CLIENT_SECRET",
    "EVO_AGENT_AMO_REDIRECT_URI",
    "EVO_AGENT_WAHA_API_KEY",
    "EVO_AGENT_WAHA_SESSION",
  ]) {
    assert.match(source, new RegExp(legacyKey, "u"));
  }
  for (const v2Key of [
    "EVO_V2_AMOCRM_BASE_URL",
    "EVO_V2_AMOCRM_CLIENT_ID",
    "EVO_V2_AMOCRM_CLIENT_SECRET",
    "EVO_V2_AMOCRM_REDIRECT_URI",
    "EVO_V2_AMOCRM_TOKEN_FILE",
  ]) {
    assert.match(source, new RegExp(v2Key, "u"));
  }

  assert.match(source, /parseEnv/u);
  assert.match(source, /lstat/u);
  assert.match(source, /0o077/u);
  assert.match(source, /wx/u);
  assert.match(source, /prepareEnsureLeadTag|ensureLeadTag/u);
  assert.match(source, /EVO V2 Sales/u);
  assert.match(source, /EVO V2 Admissions/u);
  assert.match(source, /is_main/u);
  assert.match(source, /is_archive/u);
  assert.match(source, /is_editable/u);
  assert.match(source, /current_user_id/u);
  assert.match(source, /createCanonicalPersonLead/u);
  assert.match(source, /discoverCanonicalAmoCrmCommandRouting/u);
  assert.match(source, /spawn/u);
  assert.doesNotMatch(source, /console\.log\([^)]*(token|secret|apiKey)/iu);
});

test("connected amoCRM browser acceptance is inert without its explicit flag", async () => {
  const source = await readFile(E2E_PATH, "utf8");
  assert.match(
    source,
    /test\.skip\(\s*process\.env\.EVO_V2_REAL_AMOCRM_ACCEPTANCE !== "1"/u,
  );
  assert.match(source, /EVO_V2_CONNECTED_AMOCRM_MODE/u);
  assert.match(source, /provider-not-authorized/u);
  assert.match(source, /one_explicit_admin_sync/u);
  assert.match(source, /exactReadback/u);

  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/e2e/canonical-amocrm-connected-provider.spec.ts",
      "--config=playwright.config.ts",
      "--project=desktop-chromium",
      "--workers=1",
      "--reporter=line",
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:9",
        EVO_V2_REAL_AMOCRM_ACCEPTANCE: "0",
      },
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(`${result.stdout}\n${result.stderr}`, /skipped/u);
});
