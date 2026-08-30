import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

function fromRepo(relativePath) {
  return new URL(relativePath, repoRoot);
}

function source(relativePath) {
  return readFileSync(fromRepo(relativePath), "utf8");
}

function collectFiles(relativeRoot) {
  const directory = fromRepo(relativeRoot);
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(relativePath));
      continue;
    }
    files.push(relativePath);
  }

  return files.sort();
}

test("V2-9C removes superseded legacy review, manual-send, autonomy, and dead workflow files", () => {
  for (const relativePath of [
    "scripts/check-platform-manual-send-waha-runtime.mjs",
    "scripts/manual-whatsapp-send-worker.mjs",
    "scripts/provision-platform-manual-send-waha-runtime.mjs",
    "src/app/api/internal/platform-messaging/manual-send/work/route.ts",
    "src/app/api/internal/platform-messaging/waha/autonomous-reply/route.ts",
    "src/lib/platform-autonomous-reply-actions.ts",
    "src/lib/platform-autonomous-replies.ts",
    "src/lib/platform-gemini-proposal-review-actions.ts",
    "src/lib/platform-gemini-proposal-reviews.ts",
    "src/lib/platform-gemini-proposals.ts",
    "src/lib/platform-messaging-actions.ts",
    "src/lib/platform-messaging-workflow.ts",
    "src/lib/server/platform-autonomous-reply-config.ts",
    "src/lib/server/platform-autonomous-reply-processor.ts",
    "src/lib/server/platform-autonomous-reply-waha-client.ts",
    "src/lib/server/platform-autonomous-replies-repository.ts",
    "src/lib/server/platform-gemini-proposal-reviews-repository.ts",
    "src/lib/server/platform-gemini-proposals-repository.ts",
    "src/lib/server/platform-manual-send-config.ts",
    "src/lib/server/platform-manual-send-processor.ts",
    "src/lib/server/platform-manual-send-waha-client.ts",
    "src/lib/server/canonical-waha-preflight-actions.ts",
    "src/lib/server/canonical-waha-preflight.ts",
    "src/components/platform/communications/CanonicalWahaPreflightPanel.tsx",
    "tests/platform-autonomous-replies-ui.test.mjs",
    "tests/platform-autonomous-reply.test.mjs",
    "tests/platform-gemini-human-review.test.mjs",
    "tests/platform-gemini-proposals.test.mjs",
    "tests/platform-manual-send-sidecar.test.mjs",
    "tests/platform-manual-send-waha-provisioning.test.mjs",
    "tests/platform-manual-send-worker.test.mjs",
  ]) {
    assert.equal(existsSync(fromRepo(relativePath)), false, relativePath);
  }
});

test("V2-10C removes the superseded legacy amoCRM OAuth settings path", () => {
  for (const relativePath of [
    "src/lib/amocrm.ts",
    "src/lib/contracts/amo-crm.ts",
  ]) {
    assert.equal(existsSync(fromRepo(relativePath)), false, relativePath);
  }

  const actions = source("src/lib/actions.ts");
  const contractExports = source("src/lib/contracts/index.ts");
  const db = source("src/lib/db.ts");
  const environment = source(".env.example");

  assert.doesNotMatch(actions, /from "\.\/amocrm"/);
  assert.doesNotMatch(
    actions,
    /amocrm_account_base_url|amocrm_client_id|amocrm_client_secret|amocrm_redirect_uri|amocrm_refresh_token/,
  );
  assert.doesNotMatch(actions, /checkAmoCrmAction|createAmoCrmAdapter|getAmoCrmLocalStatus/);
  assert.doesNotMatch(db, /amocrm_client_secret|amocrm_refresh_token/);

  assert.doesNotMatch(contractExports, /amo-crm/);

  assert.match(environment, /^EVO_V2_AMOCRM_BASE_URL=$/m);
  assert.match(environment, /^EVO_V2_AMOCRM_TOKEN_FILE=data\/secrets\/v2-amocrm-token\.json$/m);
  assert.doesNotMatch(
    environment,
    /EVO_V2_AMOCRM_CLIENT_ID=|EVO_V2_AMOCRM_CLIENT_SECRET=|EVO_V2_AMOCRM_REDIRECT_URI=/,
  );
});

test("V2-10C removes the dormant Supabase-bound amoCRM read lane", () => {
  for (const relativePath of [
    "src/lib/platform-amocrm-canonical-context.ts",
    "src/lib/platform-amocrm-discovery-contract.ts",
    "src/lib/server/platform-amocrm-read-config.ts",
    "src/lib/server/platform-amocrm-canonical-context-client.ts",
    "src/lib/server/platform-amocrm-canonical-context-repository.ts",
    "src/lib/server/platform-amocrm-canonical-context-service.ts",
    "src/lib/server/platform-amocrm-discovery-client.ts",
    "src/lib/server/platform-amocrm-mapping-repository.ts",
    "tests/platform-amocrm-canonical-context.test.mjs",
    "tests/platform-amocrm-canonical-context-ui.test.mjs",
    "tests/platform-amocrm-discovery.test.mjs",
  ]) {
    assert.equal(existsSync(fromRepo(relativePath)), false, relativePath);
  }

  const environment = source(".env.example");
  const packageManifest = source("package.json");
  const i18nData = source("src/lib/i18n-data.ts");
  // Frozen historical docs, scripts, and deployment inputs are intentionally
  // outside this active-runtime inventory.
  const activeRuntimeInventory = [
    ...collectFiles("src/app"),
    ...collectFiles("src/components"),
    ...collectFiles("src/lib"),
  ]
    .map((relativePath) => `# ${relativePath}\n${source(relativePath)}`)
    .join("\n");

  assert.doesNotMatch(
    environment,
    /EVO_PLATFORM_AMOCRM_(?:READ_ENABLED|ACCOUNT_DOMAIN|READ_TOKEN)/,
  );
  assert.doesNotMatch(
    packageManifest,
    /tests\/platform-amocrm-(?:discovery|canonical-context(?:-ui)?)\.test\.mjs/,
  );
  assert.doesNotMatch(i18nData, /platformAmoCrmContext/);
  assert.doesNotMatch(
    activeRuntimeInventory,
    /platform-amocrm|platformAmoCrmContext|EVO_PLATFORM_AMOCRM_(?:READ_ENABLED|ACCOUNT_DOMAIN|READ_TOKEN)/,
  );
});

test("V2-9C active runtime inventory stays canonical while excluding preserved historical deployment artifacts", () => {
  const activeInventoryFiles = [
    ...collectFiles("src/app"),
    ...collectFiles("src/lib"),
    "package.json",
    ".env.example",
  ];
  const packageManifest = source("package.json");
  const environment = source(".env.example");
  const routeContract = source("src/lib/platform-route-contract.ts");
  const activeInventory = activeInventoryFiles
    .map((relativePath) => `# ${relativePath}\n${source(relativePath)}`)
    .join("\n");

  assert.match(packageManifest, /tests\/v2-9c-legacy-cleanup\.test\.mjs/);
  assert.match(packageManifest, /tests\/canonical-waha-provider\.test\.mjs/);
  assert.match(
    packageManifest,
    /tests\/canonical-whatsapp-outbound-form\.test\.mjs/,
  );
  assert.doesNotMatch(
    packageManifest,
    /platform:manual-send:|platform-manual-send|platform-autonomous-repl(?:y|ies)|platform-gemini-(?:human-review|proposals)|v2-9b-legacy-cleanup/,
  );

  assert.match(environment, /^EVO_PLATFORM_GEMINI_API_KEY=$/m);
  assert.match(environment, /^EVO_V2_WAHA_ENABLED=0$/m);
  assert.match(environment, /^EVO_V2_WAHA_PROVIDER_AUTHORIZED=0$/m);
  assert.match(environment, /^EVO_V2_WAHA_BASE_URL=$/m);
  assert.match(environment, /^EVO_V2_WAHA_API_KEY=$/m);
  assert.match(environment, /^EVO_V2_WAHA_SESSION_NAME=$/m);
  assert.doesNotMatch(
    environment,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_|EVO_PLATFORM_MANUAL_SEND_/,
  );

  assert.doesNotMatch(
    routeContract,
    /\/api\/internal\/platform-messaging\/waha\/autonomous-reply|\/api\/internal\/platform-messaging\/manual-send\/work/,
  );
  assert.doesNotMatch(
    activeInventory,
    /canonical-waha-preflight|CanonicalWahaPreflight|EVO_V2_WAHA_PREFLIGHT_ENABLED|platform-gemini-proposal-review-actions|platform-gemini-proposals-repository|platform-gemini-proposal-reviews-repository|platform-manual-send|platform-autonomous-repl(?:y|ies)|platform-messaging-actions|platform-messaging-workflow|\/api\/internal\/platform-messaging\/waha\/autonomous-reply|\/api\/internal\/platform-messaging\/manual-send\/work/,
  );

  for (const preservedHistoricalRoot of [
    "deploy",
    "docs",
    "drizzle",
    "supabase",
  ]) {
    assert.equal(
      statSync(fromRepo(preservedHistoricalRoot)).isDirectory(),
      true,
      preservedHistoricalRoot,
    );
  }
});
