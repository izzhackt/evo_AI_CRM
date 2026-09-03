import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createPlatformProviderRuntimeInventory,
  scanRuntimeReferences,
  validateBrowserEvidence,
  validateDatabaseEvidence,
  validateRemoteEvidence,
} from "../scripts/platform-provider-runtime-inventory.mjs";

const SHA = "5e32bdc9391f46e73dcca1a433a52c823fae9e8a";
const OBSERVED_AT = "2026-09-03T14:30:00.000Z";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "platform-provider-runtime-inventory-"));
  mkdirSync(join(root, "src"), { mode: 0o700 });
  mkdirSync(join(root, "docs"), { mode: 0o700 });
  mkdirSync(join(root, "evidence"), { mode: 0o700 });
  return root;
}

function writeJson(path, value, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(path, mode);
}

function validRemoteEvidence() {
  return {
    schemaVersion: 1,
    kind: "platform-provider-runtime-remote-readiness",
    gitSha: SHA,
    observedAt: OBSERVED_AT,
    waha: {
      selectedSession: "crm_primary",
      status: "WORKING",
      observedReadOnly: true,
      fallbackObserved: false,
      wrongSessionObserved: false,
      mutationAttempted: false,
    },
    amocrm: {
      configured: true,
      observedReadOnly: true,
      mutationAttempted: false,
    },
    gemini: {
      configured: true,
      observedReadOnly: true,
      mutationAttempted: false,
    },
  };
}

function validBrowserEvidence() {
  return {
    schemaVersion: 1,
    kind: "evo-v2-provider-browser-readonly",
    status: "passed",
    gitSha: SHA,
    completedAt: OBSERVED_AT,
    routes: {
      salesWhatsApp: {
        route: "/whatsapp/:conversationId",
        authorityRole: "sales",
        checks: {
          pageVisible: true,
          threadVisible: true,
          controlsVisible: true,
          sendVisible: true,
          reconcileRendered: false,
        },
        statuses: { sendDisabled: "true" },
      },
      adminSales: {
        route: "/sales/:leadId",
        authorityRole: "admin",
        checks: {
          workspaceVisible: true,
          panelVisible: true,
          formVisible: true,
          syncVisible: true,
        },
        statuses: {
          panelScope: "sales",
          providerAvailability: "blocked",
          syncDisabled: "true",
        },
      },
      adminAdmissions: {
        route: "/clients/:studentCaseId",
        authorityRole: "admin",
        checks: {
          workspaceVisible: true,
          panelVisible: true,
          formVisible: true,
          syncVisible: true,
        },
        statuses: {
          panelScope: "admissions",
          providerAvailability: "blocked",
          syncDisabled: "true",
        },
      },
    },
    boundaries: {
      liveGeminiCall: false,
      liveWhatsAppSend: false,
      liveAmoCrmWrite: false,
      clickedProviderMutationControl: false,
      v1RuntimeUsed: false,
    },
  };
}

function validCounts() {
  return {
    aiDraftEventCount: 0,
    auditEventCount: 0,
    amoCrmAttemptCount: 0,
    amoCrmContactBindingCount: 0,
    amoCrmDiscoveryCount: 0,
    amoCrmLeadBindingCount: 0,
    amoCrmReceiptCount: 0,
    communicationMessageCount: 0,
    durableWorkAttemptCount: 0,
    durableWorkEventCount: 0,
    durableWorkItemCount: 0,
    geminiProposalReceiptCount: 0,
    geminiProposalRequestCount: 0,
    geminiProposalResultCount: 0,
    geminiReviewCount: 0,
    manualSendAuthorizationCount: 0,
    manualSendProviderBindingCount: 0,
    manualSendRuntimeBindingCount: 1,
    manualWhatsAppReconciliationRequestCount: 0,
    manualWhatsAppReconciliationResultCount: 0,
    providerReconciliationEventCount: 0,
    providerWebhookEventCount: 0,
    sessionHealthCount: 1,
    wahaMessageBindingCount: 0,
    wahaObservationCount: 1,
    workReviewEventCount: 0,
  };
}

function validDatabaseEvidence() {
  return {
    schemaVersion: 1,
    kind: "evo-v2-provider-database-readonly",
    status: "passed",
    gitSha: SHA,
    completedAt: OBSERVED_AT,
    authority: "local_supabase_postgresql",
    syntheticTargetsVerified: true,
    countsBefore: validCounts(),
    countsAfter: validCounts(),
    exactEquality: true,
    boundaries: {
      liveGeminiCall: false,
      liveWhatsAppSend: false,
      liveAmoCrmWrite: false,
      selectedInboundReplay: false,
    },
  };
}

test("validators accept the sanitized read-only provider evidence contract", () => {
  assert.equal(validateRemoteEvidence(validRemoteEvidence(), SHA).gitSha, SHA);
  assert.equal(validateBrowserEvidence(validBrowserEvidence(), SHA).gitSha, SHA);
  assert.equal(validateDatabaseEvidence(validDatabaseEvidence(), SHA).gitSha, SHA);
});

test("runtime scan separates historical evo-inbox references from active ones", () => {
  const root = fixture();
  writeFileSync(
    join(root, "docs", "historical.md"),
    "This preserved historical rollback note keeps evo-inbox as frozen evidence.\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, "src", "bad.ts"),
    "export const selectedSession = 'evo-inbox';\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, "src", "commented-bad.ts"),
    "// Historical compatibility must not exempt active source.\nexport const selectedSession = 'evo-inbox';\n",
    { mode: 0o600 },
  );

  const scan = scanRuntimeReferences(root);
  assert.equal(scan.historicalReferences.length, 1);
  assert.equal(scan.historicalReferences[0].path, "docs/historical.md");
  assert.deepEqual(
    scan.activeViolations.map(({ path }) => path).sort(),
    ["src/bad.ts", "src/commented-bad.ts"],
  );
});

test("inventory artifact is written privately and blocks active fallback references", () => {
  const root = fixture();
  writeFileSync(
    join(root, "src", "good.ts"),
    "export const selectedSession = 'crm_primary';\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, "docs", "historical.md"),
    "Frozen rollback evidence: evo-inbox remains historical only.\n",
    { mode: 0o600 },
  );
  writeJson(join(root, "evidence", "remote.json"), validRemoteEvidence());
  writeJson(join(root, "evidence", "browser.json"), validBrowserEvidence());
  writeJson(join(root, "evidence", "database.json"), validDatabaseEvidence());

  const outputPath = "evidence/runtime-inventory.json";
  const report = createPlatformProviderRuntimeInventory({
    repoRoot: root,
    expectedSha: SHA,
    remoteEvidencePath: "evidence/remote.json",
    browserEvidencePath: "evidence/browser.json",
    databaseEvidencePath: "evidence/database.json",
    outputPath,
  });

  assert.equal(report.status, "passed");
  assert.equal(existsSync(join(root, outputPath)), true);
  assert.equal(statSync(join(root, outputPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(join(root, outputPath), "utf8")).kind, "platform-provider-runtime-inventory");

  const blockedRoot = fixture();
  writeFileSync(
    join(blockedRoot, "src", "fallback.ts"),
    "export const selectedSession = 'evo-inbox';\n",
    { mode: 0o600 },
  );
  writeJson(join(blockedRoot, "evidence", "remote.json"), validRemoteEvidence());
  writeJson(join(blockedRoot, "evidence", "browser.json"), validBrowserEvidence());
  writeJson(join(blockedRoot, "evidence", "database.json"), validDatabaseEvidence());
  assert.throws(
    () =>
      createPlatformProviderRuntimeInventory({
        repoRoot: blockedRoot,
        expectedSha: SHA,
        remoteEvidencePath: "evidence/remote.json",
        browserEvidencePath: "evidence/browser.json",
        databaseEvidencePath: "evidence/database.json",
        outputPath: "evidence/runtime-inventory.json",
      }),
    /active WAHA fallback references remain: src\/fallback\.ts/u,
  );
  assert.equal(
    existsSync(join(blockedRoot, "evidence", "runtime-inventory.json")),
    false,
  );
});

test("inventory rejects wrong session, non-WORKING status, mutation, database drift, and extra secret-like keys", () => {
  const wrongSession = validRemoteEvidence();
  wrongSession.waha.selectedSession = "evo-inbox";
  assert.throws(() => validateRemoteEvidence(wrongSession, SHA), /wrong WAHA session/);

  const stopped = validRemoteEvidence();
  stopped.waha.status = "STOPPED";
  assert.throws(() => validateRemoteEvidence(stopped, SHA), /WORKING/);

  const mutating = validRemoteEvidence();
  mutating.amocrm.mutationAttempted = true;
  assert.throws(() => validateRemoteEvidence(mutating, SHA), /mutationAttempted/);

  const drift = validDatabaseEvidence();
  drift.countsAfter.providerWebhookEventCount = 1;
  assert.throws(() => validateDatabaseEvidence(drift, SHA), /counts changed/);

  const secretLike = validBrowserEvidence();
  const secretLikeKey = ["api", "Key"].join("");
  secretLike.boundaries = {
    ...secretLike.boundaries,
    [secretLikeKey]: "redacted-placeholder",
  };
  assert.throws(() => validateBrowserEvidence(secretLike, SHA), /secret-like/);

  const secretValue = validRemoteEvidence();
  const secretTokenKey = ["secret", "Token"].join("");
  secretValue.gemini = {
    configured: true,
    observedReadOnly: true,
    mutationAttempted: false,
    [secretTokenKey]: "redacted-placeholder",
  };
  assert.throws(() => validateRemoteEvidence(secretValue, SHA), /secret-like/);
});
