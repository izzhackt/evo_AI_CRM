import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function missing(path) {
  assert.equal(
    existsSync(new URL(path, ROOT)),
    false,
    `${path} must be removed from the active Platform provider runtime`,
  );
}

test("V2-9C removes the superseded canonical Gemini and WAHA server implementation path", () => {
  for (const path of [
    "src/lib/canonical-gemini-proposal-contract.ts",
    "src/lib/server/canonical-gemini-proposal-actions.ts",
    "src/lib/server/canonical-gemini-proposal-client.ts",
    "src/lib/server/canonical-gemini-proposal-config.ts",
    "src/lib/server/canonical-gemini-proposal-service.ts",
    "src/lib/server/canonical-gemini-review-form.ts",
    "src/lib/server/canonical-whatsapp-inbound.ts",
    "src/lib/server/canonical-whatsapp-outbound-actions.ts",
    "src/lib/server/canonical-whatsapp-outbound-form.ts",
    "src/lib/server/canonical-whatsapp-outbound-service.ts",
    "src/lib/server/canonical-waha-provider.ts",
    "scripts/v2-10d-mutation-counts.mjs",
    "scripts/v2-10d-waha-checkpoint.mjs",
  ]) {
    missing(path);
  }
});

test("V2-9C keeps only the current Platform provider env contract and active test inventory", () => {
  const environment = source(".env.example");
  const packageManifest = source("package.json");
  const activeHarness = source("scripts/test-postgres-v2-foundation.sh");

  assert.match(environment, /^EVO_PLATFORM_GEMINI_API_KEY=$/m);
  assert.match(environment, /^EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=$/m);
  assert.doesNotMatch(environment, /^EVO_V2_GEMINI_/m);
  assert.doesNotMatch(environment, /^EVO_V2_WAHA_/m);

  for (const required of [
    /tests\/platform-gemini-provider\.test\.mjs/,
    /tests\/platform-provider-action-contract\.test\.mjs/,
    /tests\/platform-provider-orchestrator\.test\.mjs/,
    /tests\/platform-provider-readiness\.test\.mjs/,
    /tests\/platform-provider-workflows\.test\.mjs/,
    /tests\/platform-provider-actions\.test\.mjs/,
    /tests\/platform-provider-controls\.test\.mjs/,
    /tests\/platform-waha-local-fetch\.test\.mjs/,
    /tests\/platform-waha-provider\.test\.mjs/,
    /tests\/platform-waha-webhook\.test\.mjs/,
    /tests\/platform-waha-projector\.test\.mjs/,
    /tests\/platform-waha-projector-recovery\.test\.mjs/,
    /tests\/platform-provider-acceptance-harness\.test\.mjs/,
    /tests\/platform-communications-local-provisioner\.test\.mjs/,
    /tests\/platform-amocrm-command-service\.test\.mjs/,
  ]) {
    assert.match(packageManifest, required);
    assert.match(activeHarness, required);
  }

  for (const removed of [
    /tests\/canonical-gemini-proposal\.test\.mjs/,
    /tests\/canonical-gemini-review-form\.test\.mjs/,
    /tests\/canonical-waha-provider\.test\.mjs/,
    /tests\/canonical-whatsapp-outbound-form\.test\.mjs/,
    /tests\/canonical-amocrm-command-service\.test\.mjs/,
    /tests\/v2-10d-real-acceptance-harness\.test\.mjs/,
    /tests\/v2-10d-review-recovery-harness\.test\.mjs/,
  ]) {
    assert.doesNotMatch(packageManifest, removed);
  }
});

test("V2-9C removes the Drizzle amoCRM command runtime and keeps one Supabase Platform section", () => {
  for (const path of [
    "src/lib/server/canonical-amocrm-command-repository.ts",
    "src/lib/server/canonical-amocrm-command-service.ts",
    "src/db/schema/canonical-amocrm.ts",
    "src/app/(staff)/clients/[id]/AmoCrmCaseCommandSection.tsx",
    "src/app/(staff)/clients/[id]/CanonicalAmoCrmCommandSection.tsx",
    "tests/canonical-amocrm-command-service.test.mjs",
    "tests/canonical-amocrm-command-postgres.test.mjs",
    "tests/canonical-amocrm-schema-postgres.test.mjs",
    "scripts/canonical-amocrm-mutation-counts.mjs",
    "scripts/seed-canonical-amocrm-browser-blocker.mjs",
  ]) {
    missing(path);
  }

  const studentWorkspace = source(
    "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
  );
  const platformSection = source(
    "src/app/(staff)/clients/[id]/PlatformAmoCrmCommandSection.tsx",
  );
  missing("src/db/schema/index.ts");

  assert.match(studentWorkspace, /<PlatformAmoCrmCommandSection/);
  assert.match(platformSection, /createSupabaseServerClient/);
  assert.match(platformSection, /readPlatformBlockingAmoCrmCommand/);
  assert.doesNotMatch(
    platformSection,
    /canonical-amocrm-command-(?:repository|service)|@\/db\/schema/,
  );
});

test("V2-9C points guardrails and readiness reads at the current Platform provider modules", () => {
  const promiseAudit = source("scripts/check-promise-audit.mjs");
  const layout = source("src/app/(staff)/layout.tsx");
  const readiness = source("src/lib/server/platform-provider-readiness.ts");

  assert.match(
    promiseAudit,
    /src\/lib\/server\/platform-provider-orchestrator\.ts/,
  );
  assert.match(
    promiseAudit,
    /src\/lib\/server\/platform-gemini-provider\.ts/,
  );
  assert.doesNotMatch(promiseAudit, /canonical-gemini-proposal/);

  assert.match(layout, /readPlatformGeminiProviderAvailability/);
  assert.match(layout, /platformWahaHealthDisplayStatus/);
  assert.doesNotMatch(layout, /readCanonicalGeminiProposalAvailability/);

  assert.match(readiness, /PlatformWahaSessionHealth/);
  assert.match(readiness, /EVO_PLATFORM_GEMINI_API_KEY/);
});

test("V2-9C preserves the historical rollback roots while removing active legacy provider code", () => {
  for (const preservedHistoricalRoot of [
    "deploy",
    "docs",
    "drizzle",
    "supabase",
  ]) {
    assert.equal(
      statSync(new URL(preservedHistoricalRoot, ROOT)).isDirectory(),
      true,
      preservedHistoricalRoot,
    );
  }
});
