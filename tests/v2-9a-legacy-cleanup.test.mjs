import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function expectMissing(path) {
  assert.equal(
    existsSync(new URL(path, ROOT)),
    false,
    `${path} must be removed once the Platform communications replacement is proven`,
  );
}

test("V2-9A removes the superseded staff WhatsApp UI and communication implementation tests", () => {
  for (const path of [
    "src/components/platform/communications/CanonicalStaffWhatsApp.tsx",
    "src/components/platform/communications/CanonicalGeminiProposalPanel.tsx",
    "src/components/platform/communications/CanonicalWhatsAppOutboundComposer.tsx",
    "tests/canonical-whatsapp-inbound.test.mjs",
    "tests/canonical-whatsapp-outbound-form.test.mjs",
    "tests/canonical-whatsapp-outbound-postgres.test.mjs",
    "tests/canonical-gemini-proposal.test.mjs",
    "tests/canonical-gemini-review-form.test.mjs",
    "tests/canonical-waha-provider.test.mjs",
  ]) {
    expectMissing(path);
  }
});

test("V3 Inbox is the one Supabase WhatsApp read and provider-control surface", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const adapter = source("src/lib/v3/inbox-source.ts");
  const controls = source("src/components/v3/InboxProviderWorkflowControls.tsx");

  assert.match(page, /readInbox\(actor,/);
  assert.match(page, /InboxProviderWorkflowControls/);
  assert.match(adapter, /listPlatformConversations\(actor,/);
  assert.match(adapter, /getPlatformConversationThread\(actor,/);
  assert.match(adapter, /getPlatformWahaSessionHealth\(actor,\s*"crm_primary"\)/);
  assert.match(controls, /data-testid="v3-inbox-provider-workflow-controls"/);
  assert.match(controls, /data-testid="v3-inbox-send"/);
  assert.match(controls, /data-testid="v3-inbox-reconcile"/);

  for (const retired of [
    "src/app/(staff)/whatsapp/page.tsx",
    "src/app/(staff)/whatsapp/[id]/page.tsx",
    "src/components/platform/communications/PlatformStaffWhatsApp.tsx",
    "src/components/platform/communications/PlatformProviderWorkflowControls.tsx",
  ]) {
    expectMissing(retired);
  }
});

test("V2-9A local proof runs Platform provider checks instead of the retired canonical communication fixture", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");
  const packageManifest = source("package.json");

  for (const removed of [
    /tests\/canonical-whatsapp-inbound\.test\.mjs/,
    /tests\/canonical-whatsapp-outbound-form\.test\.mjs/,
    /tests\/canonical-whatsapp-outbound-postgres\.test\.mjs/,
    /tests\/canonical-gemini-proposal\.test\.mjs/,
    /tests\/canonical-gemini-review-form\.test\.mjs/,
    /tests\/canonical-waha-provider\.test\.mjs/,
  ]) {
    assert.doesNotMatch(packageManifest, removed);
  }
  assert.doesNotMatch(harness, /tests\/canonical-whatsapp-outbound-postgres\.test\.mjs/);

  for (const required of [
    /tests\/platform-gemini-provider\.test\.mjs/,
    /tests\/platform-provider-workflows\.test\.mjs/,
    /tests\/platform-provider-actions\.test\.mjs/,
    /tests\/platform-provider-controls\.test\.mjs/,
    /tests\/v3-inbox-integration\.test\.mjs/,
    /tests\/v3-inbox-route-transition\.test\.mjs/,
    /tests\/platform-waha-webhook\.test\.mjs/,
    /tests\/platform-waha-projector\.test\.mjs/,
    /tests\/platform-whatsapp-pages\.test\.mjs/,
    /tests\/platform-communications-local-provisioner\.test\.mjs/,
  ]) {
    assert.match(packageManifest, required);
    assert.match(harness, required);
  }
});
