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
  const wahaPreflightActions = source(
    "src/lib/server/canonical-waha-preflight-actions.ts",
  );
  const activeInventory = activeInventoryFiles
    .map((relativePath) => `# ${relativePath}\n${source(relativePath)}`)
    .join("\n");

  assert.match(packageManifest, /tests\/v2-9c-legacy-cleanup\.test\.mjs/);
  assert.match(packageManifest, /tests\/canonical-waha-preflight\.test\.mjs/);
  assert.doesNotMatch(
    packageManifest,
    /platform:manual-send:|platform-manual-send|platform-autonomous-repl(?:y|ies)|platform-gemini-(?:human-review|proposals)|v2-9b-legacy-cleanup/,
  );

  assert.match(environment, /^EVO_PLATFORM_GEMINI_API_KEY=$/m);
  assert.match(environment, /^EVO_V2_WAHA_PREFLIGHT_ENABLED=0$/m);
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
  assert.match(wahaPreflightActions, /^"use server";/);
  assert.doesNotMatch(
    wahaPreflightActions,
    /export\s+(?:const|let|var|class)\s/,
    'a "use server" module may export only async runtime functions',
  );

  assert.doesNotMatch(
    activeInventory,
    /platform-gemini-proposal-review-actions|platform-gemini-proposals-repository|platform-gemini-proposal-reviews-repository|platform-manual-send|platform-autonomous-repl(?:y|ies)|platform-messaging-actions|platform-messaging-workflow|sendText|\/api\/internal\/platform-messaging\/waha\/autonomous-reply|\/api\/internal\/platform-messaging\/manual-send\/work/,
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
