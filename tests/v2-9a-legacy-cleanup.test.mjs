import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V2-9A removes the superseded staff WhatsApp read runtime and implementation tests", () => {
  for (const path of [
    "src/app/(staff)/whatsapp/CommunicationsSourceDisclosure.tsx",
    "src/app/api/ai/draft/route.ts",
    "src/app/api/platform-messaging/media/[mediaId]/route.ts",
    "src/components/WaList.tsx",
    "src/components/WaReplyBox.tsx",
    "src/components/platform/communications/PlatformAiMemoryCard.tsx",
    "src/components/platform/communications/PlatformAmoCrmContextCard.tsx",
    "src/components/platform/communications/PlatformAutonomousReplyCard.tsx",
    "src/components/platform/communications/PlatformConversationView.tsx",
    "src/components/platform/communications/PlatformDecisionBacklogCard.tsx",
    "src/components/platform/communications/PlatformGeminiProposalCard.tsx",
    "src/components/platform/communications/PlatformHandoffContextCard.tsx",
    "src/components/platform/communications/PlatformMessageMedia.tsx",
    "src/components/platform/communications/PlatformMessagingRealtime.tsx",
    "src/components/platform/communications/PlatformMessagingWorkflowPanel.tsx",
    "src/components/platform/communications/PlatformPromptEvidenceCard.tsx",
    "src/components/platform/communications/PlatformWaList.tsx",
    "src/components/platform/communications/whatsapp-state.ts",
    "src/components/platform/core/SalesBoard.tsx",
    "src/components/platform/core/SalesList.tsx",
    "src/lib/whatsapp.ts",
    "src/lib/whatsapp-policy.ts",
    "tests/e2e/p1d-whatsapp-object-scope.spec.ts",
    "tests/e2e/platform-communications-admin.spec.ts",
    "tests/e2e/platform-whatsapp-polish.spec.ts",
    "tests/p1d-whatsapp-policy.test.mjs",
    "tests/p1d-whatsapp-query-scope.test.mjs",
    "tests/platform-communications-media.test.mjs",
    "tests/platform-communications.test.mjs",
    "tests/platform-media-route.test.mjs",
    "tests/platform-messaging-realtime.test.mjs",
  ]) {
    assert.equal(
      existsSync(new URL(`../${path}`, import.meta.url)),
      false,
      `${path} must be removed once the V2-9A replacement is proven`,
    );
  }
});

test("V2-9A removes SQLite WhatsApp schema, seed, bootstrap, and read references", () => {
  for (const path of [
    "src/lib/db.ts",
    "src/lib/domain.ts",
    "src/lib/queries.ts",
    "scripts/bootstrap-admin.mjs",
  ]) {
    assert.doesNotMatch(
      source(path),
      /wa_accounts|wa_conversations|wa_messages|WhatsAppConversation|WhatsAppMessage|whatsapp-policy/,
      `${path} must not retain the superseded SQLite WhatsApp runtime`,
    );
  }
});

test("V2-9A keeps one canonical PostgreSQL staff WhatsApp read surface", () => {
  const listPage = source("src/app/(staff)/whatsapp/page.tsx");
  const threadPage = source("src/app/(staff)/whatsapp/[id]/page.tsx");
  const workspace = source(
    "src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
  );
  const outboundComposer = source(
    "src/components/platform/communications/CanonicalWhatsAppOutboundComposer.tsx",
  );
  const routeContract = source("src/lib/platform-route-contract.ts");
  const sensitivePermissions = source("tests/e2e/sensitive-permissions.spec.ts");

  assert.match(listPage, /listCanonicalStaffConversations/);
  assert.match(threadPage, /getCanonicalStaffConversationThread/);
  for (const runtimeSource of [listPage, threadPage, workspace]) {
    assert.doesNotMatch(
      runtimeSource,
      /import\s+.*"@\/lib\/(?:platform-communications|queries|db)"/,
    );
    assert.doesNotMatch(runtimeSource, /PlatformMessagingRealtime|LegacyWhatsApp|LegacyConversation/);
  }
  assert.doesNotMatch(listPage, /getSupabasePublicConfig/);
  assert.doesNotMatch(threadPage, /getSupabasePublicConfig/);
  assert.doesNotMatch(workspace, /manual-send/i);
  assert.match(workspace, /CanonicalGeminiProposalPanel/);
  assert.match(workspace, /CanonicalWhatsAppOutboundComposer/);
  assert.match(outboundComposer, /canonical-whatsapp-outbound-composer/);
  assert.doesNotMatch(routeContract, /platform-messaging\/media/);
  assert.doesNotMatch(sensitivePermissions, /\/api\/ai\/draft/);
});

test("V2-9A keeps role filtering and unavailable-state proof at the canonical boundary", () => {
  const repository = source("src/lib/server/canonical-crm-repository.ts");
  const browserProof = source("tests/e2e/canonical-crm-read-surfaces.spec.ts");
  const errorBoundary = source("src/app/(staff)/whatsapp/error.tsx");

  assert.match(repository, /export async function listCanonicalStaffConversations/);
  assert.match(repository, /export async function getCanonicalStaffConversationThread/);
  assert.match(
    repository,
    /eq\(evoConversations\.owningRole, input\.actorRole\)/,
  );
  assert.match(repository, /conversation\.ownership_transferred/);
  assert.match(browserProof, /missing PostgreSQL authority fails closed/);
  assert.match(browserProof, /canonical-staff-whatsapp-thread/);
  assert.match(errorBoundary, /data-testid="whatsapp-error"/);
});

test("active test commands no longer execute removed WhatsApp implementations", () => {
  const packageJson = source("package.json");
  assert.doesNotMatch(
    packageJson,
    /platform-communications(?:-media)?\.test|platform-messaging-realtime\.test|platform-media-route\.test|p1d-whatsapp-(?:policy|query-scope)\.test/,
  );
});
