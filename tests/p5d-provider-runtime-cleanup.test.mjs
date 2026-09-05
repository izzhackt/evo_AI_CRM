import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function path(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

function source(relativePath) {
  return readFileSync(path(relativePath), "utf8");
}

const ACTIVE_PROVIDER_RUNTIME_PATHS = [
  "src/lib/platform-provider-workflows.ts",
  "src/lib/server/platform-provider-readiness.ts",
  "src/lib/server/platform-waha-provider.ts",
  "src/lib/server/platform-amocrm-runtime.ts",
  "src/lib/platform-communications.ts",
  "src/lib/v3/inbox-source.ts",
  "src/lib/v3/settings-source.ts",
  "src/components/v3/AppShell.tsx",
  "src/app/(v3)/v3/inbox/page.tsx",
  "src/components/v3/InboxProviderWorkflowControls.tsx",
  "src/app/api/internal/platform-messaging/waha/work/route.ts",
  "scripts/test-postgres-v2-foundation.sh",
  "scripts/prepare-connected-amocrm-validation.mjs",
];

const PROVIDER_GUARD_TEST_PATHS = [
  "tests/platform-provider-acceptance-harness.test.mjs",
  "tests/platform-waha-local-fetch.test.mjs",
];

test("P5D active provider runtime keeps one current WAHA session path", () => {
  for (const relativePath of ACTIVE_PROVIDER_RUNTIME_PATHS) {
    assert.equal(existsSync(path(relativePath)), true, `${relativePath} must exist`);
  }

  const activeSource = ACTIVE_PROVIDER_RUNTIME_PATHS
    .map((relativePath) => source(relativePath))
    .join("\n");
  const selectableRuntimeSource = ACTIVE_PROVIDER_RUNTIME_PATHS
    .filter((relativePath) => relativePath !== "src/lib/platform-communications.ts")
    .map((relativePath) => source(relativePath))
    .join("\n");
  const communicationsSource = source("src/lib/platform-communications.ts");

  assert.match(activeSource, /PLATFORM_WAHA_SESSION_NAME = "crm_primary"/);
  assert.match(activeSource, /PLATFORM_WAHA_BASE_URL = "http:\/\/evo-crm-waha:3000"/);
  assert.match(activeSource, /getPlatformWahaSessionHealth\(actor,\s*"crm_primary"\)/);
  assert.match(activeSource, /ACTIVE_WAHA_SESSION = "crm_primary"/);
  assert.match(activeSource, /waha_session_name="crm_primary"/);

  assert.doesNotMatch(
    selectableRuntimeSource,
    /evo-inbox|evo_inbox_private|EVO_V2_WAHA|waha:evo-inbox|\/opt\/evo-inbox|PLATFORM_WAHA_SESSION_NAME = "evo-inbox"|ACTIVE_WAHA_SESSION = "evo-inbox"|getPlatformWahaSessionHealth\(actor,\s*"evo-inbox"\)|thread\.conversation\.wahaSessionName === "evo-inbox"|waha_session_name="evo-inbox"/i,
  );
  assert.equal(communicationsSource.match(/"evo-inbox"/gu)?.length, 1);
  assert.match(
    communicationsSource,
    /const RETIRED_WAHA_EVIDENCE_SESSION = "evo-inbox" as const;/u,
  );
  assert.match(
    communicationsSource,
    /parseHistoricalOrCurrentWahaEvidenceSessionName/u,
  );
});

test("P5D current session parsing and readiness reject the historical inbox path", () => {
  const readiness = source("tests/platform-provider-readiness.test.mjs");
  const guardSource = PROVIDER_GUARD_TEST_PATHS
    .map((relativePath) => source(relativePath))
    .join("\n");

  assert.match(readiness, /parsePlatformWahaSessionName\("crm_primary"\), "crm_primary"/);
  assert.match(readiness, /parsePlatformWahaSessionName\("evo-inbox"\), null/);
  assert.match(readiness, /sessionName: "crm_primary"/);
  assert.match(guardSource, /evo-inbox-waha/);
  assert.match(guardSource, /waha_session_name="evo-inbox"/);
  assert.match(guardSource, /doesNotMatch\(shell, \/\\\/opt\\\/evo-inbox\|evo-inbox-waha/);
});
