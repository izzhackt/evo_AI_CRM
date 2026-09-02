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

test("V2-9A keeps one Platform WhatsApp read surface and one provider workflow control surface", () => {
  const listPage = source("src/app/(staff)/whatsapp/page.tsx");
  const threadPage = source("src/app/(staff)/whatsapp/[id]/page.tsx");
  const workspace = source("src/components/platform/communications/PlatformStaffWhatsApp.tsx");
  const controls = source(
    "src/components/platform/communications/PlatformProviderWorkflowControls.tsx",
  );

  assert.match(listPage, /PlatformStaffWhatsAppWorkspace/);
  assert.match(listPage, /listPlatformConversations\(actor,/);
  assert.doesNotMatch(listPage, /CanonicalStaffWhatsApp|listCanonicalStaffConversations/);

  assert.match(threadPage, /PlatformStaffWhatsAppWorkspace/);
  assert.match(threadPage, /PlatformProviderWorkflowControls/);
  assert.match(threadPage, /getPlatformConversationThread\(actor,/);
  assert.match(threadPage, /getPlatformWahaSessionHealth\(actor,\s*"crm_primary"\)/);
  assert.doesNotMatch(
    threadPage,
    /CanonicalStaffWhatsApp|CanonicalGeminiProposalPanel|CanonicalWhatsAppOutboundComposer|getCanonicalStaffConversationThread/,
  );

  assert.match(workspace, /data-testid="platform-staff-whatsapp-page"/);
  assert.match(workspace, /data-testid="platform-staff-whatsapp-thread"/);
  assert.doesNotMatch(workspace, /canonical-staff-whatsapp-/);

  assert.match(controls, /data-testid="platform-provider-workflow-controls"/);
  assert.match(controls, /data-testid="platform-provider-send"/);
  assert.match(controls, /data-testid="platform-provider-reconcile"/);
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
    /tests\/platform-waha-webhook\.test\.mjs/,
    /tests\/platform-waha-projector\.test\.mjs/,
    /tests\/platform-whatsapp-pages\.test\.mjs/,
    /tests\/platform-communications-local-provisioner\.test\.mjs/,
  ]) {
    assert.match(packageManifest, required);
    assert.match(harness, required);
  }
});
