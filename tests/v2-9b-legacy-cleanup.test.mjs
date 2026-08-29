import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V2-9B removes the superseded Gemini execution and summary runtime", () => {
  for (const path of [
    "src/app/api/internal/platform-ai/gemini/proposal/route.ts",
    "src/app/api/ai/summary/route.ts",
    "src/components/AiSummary.tsx",
    "src/components/PreparedAiDrawer.tsx",
    "src/lib/ai.ts",
    "src/lib/prepared-ai.ts",
    "src/lib/prepared-ai-drawer-state.ts",
    "src/lib/contracts/prepared-ai.ts",
    "src/lib/server/platform-gemini-proposal-client.ts",
    "src/lib/server/platform-gemini-proposal-config.ts",
    "src/lib/server/platform-gemini-proposal-contract.ts",
    "src/lib/server/platform-gemini-proposal-service.ts",
    "tests/platform-gemini-proposal.test.mjs",
    "tests/prepared-ai-drawer-state.test.mjs",
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
});

test("the active V2-9B graph is canonical PostgreSQL with no fallback route", () => {
  const action = source(
    "src/lib/server/canonical-gemini-proposal-actions.ts",
  );
  const service = source(
    "src/lib/server/canonical-gemini-proposal-service.ts",
  );
  const repository = source("src/lib/server/canonical-crm-repository.ts");
  const routeContract = source("src/lib/platform-route-contract.ts");
  const environment = source(".env.example");
  const legacySettings = source("src/lib/actions.ts");
  const legacySecretStore = source("src/lib/db.ts");
  const translations = source("src/lib/i18n-data.ts");
  const packageManifest = source("package.json");
  const promiseAudit = source("scripts/check-promise-audit.mjs");

  assert.match(action, /requirePlatformMessagingActor/);
  assert.match(service, /executeCanonicalGeminiProposal/);
  assert.doesNotMatch(service, /getCanonicalGeminiProposalContext/);
  assert.match(repository, /evoAiProposals/);
  assert.doesNotMatch(
    `${action}\n${service}`,
    /supabase|sqlite|fallback|platform-gemini-proposal-service/i,
  );
  assert.doesNotMatch(
    routeContract,
    /\/api\/internal\/platform-ai\/gemini\/proposal/,
  );
  assert.doesNotMatch(
    environment,
    /EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED|EVO_PLATFORM_GEMINI_REVIEW_PRIVACY_APPROVED|EVO_PLATFORM_GEMINI_PROPOSAL_HMAC_SECRET|EVO_PLATFORM_GEMINI_PROPOSAL_MODEL|EVO_PLATFORM_GEMINI_PROPOSAL_TIMEOUT_MS/,
  );
  assert.doesNotMatch(
    `${environment}\n${legacySettings}\n${legacySecretStore}\n${translations}\n${packageManifest}`,
    /ANTHROPIC_API_KEY|anthropic_api_key|anthropicKeyHint|@anthropic-ai\/sdk/,
  );
  assert.doesNotMatch(
    translations,
    /aiAssistant|aiDraftReply|aiSummary|aiGenerate|aiPrompt|aiThinking|aiUseDraft|studentAiSummaryHint/,
  );
  assert.doesNotMatch(
    promiseAudit,
    /src\/lib\/ai\.ts|src\/lib\/prepared-ai\.ts|extractPreparedResponses/,
  );
});

test("the only temporary legacy proposal read is isolated behind V2-9C review", () => {
  const reviewAction = source(
    "src/lib/platform-gemini-proposal-review-actions.ts",
  );
  const legacyReadRepository = source(
    "src/lib/server/platform-gemini-proposals-repository.ts",
  );
  const whatsappPage = source("src/app/(staff)/whatsapp/[id]/page.tsx");

  assert.match(reviewAction, /platform-gemini-proposals-repository/);
  assert.match(legacyReadRepository, /staff_gemini_proposal/);
  assert.doesNotMatch(
    whatsappPage,
    /platform-gemini-proposals-repository|platform-gemini-proposal-review-actions/,
  );
});
