import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { join, relative } from "node:path";
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
    schemaVersion: 2,
    kind: "platform-provider-runtime-remote-readiness",
    harnessGitSha: SHA,
    observedAt: OBSERVED_AT,
    environment: {
      composeProject: "evo-crm",
      composeService: "waha",
      containerName: "evo-crm-waha-1",
      privateNetwork: "evo_crm_private",
      running: true,
      containerIdentitySha256:
        "1111111111111111111111111111111111111111111111111111111111111111",
      imageIdentitySha256:
        "2222222222222222222222222222222222222222222222222222222222222222",
      applicationDeploymentClaimed: false,
    },
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
  assert.equal(
    validateRemoteEvidence(validRemoteEvidence(), SHA).harnessGitSha,
    SHA,
  );
  assert.equal(validateBrowserEvidence(validBrowserEvidence(), SHA).gitSha, SHA);
  assert.equal(validateDatabaseEvidence(validDatabaseEvidence(), SHA).gitSha, SHA);
});

test("remote evidence identifies WAHA without claiming an app deployment", () => {
  const wrongRuntime = validRemoteEvidence();
  wrongRuntime.environment.composeProject = "evo-inbox";
  assert.throws(
    () => validateRemoteEvidence(wrongRuntime, SHA),
    /compose project drifted/u,
  );

  const falseDeploymentClaim = validRemoteEvidence();
  falseDeploymentClaim.environment.applicationDeploymentClaimed = true;
  assert.throws(
    () => validateRemoteEvidence(falseDeploymentClaim, SHA),
    /must not claim an application deployment/u,
  );

  const invalidImageIdentity = validRemoteEvidence();
  invalidImageIdentity.environment.imageIdentitySha256 = "not-a-sha";
  assert.throws(
    () => validateRemoteEvidence(invalidImageIdentity, SHA),
    /imageIdentitySha256 must be a 64-character lowercase SHA-256/u,
  );
});

test("runtime scan separates historical evo-inbox references from active ones", () => {
  const root = fixture();
  mkdirSync(join(root, "src", "lib"), { mode: 0o700 });
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
  writeFileSync(
    join(root, "src", "lib", "platform-communications.ts"),
    'const RETIRED_WAHA_EVIDENCE_SESSION = "evo-inbox" as const;\n',
    { mode: 0o600 },
  );

  const scan = scanRuntimeReferences(root);
  assert.equal(scan.historicalReferences.length, 1);
  assert.equal(scan.historicalReferences[0].path, "docs/historical.md");
  assert.deepEqual(
    scan.guardReferences.map(({ path }) => path),
    ["src/lib/platform-communications.ts"],
  );
  assert.deepEqual(
    scan.activeViolations.map(({ path }) => path).sort(),
    ["src/bad.ts", "src/commented-bad.ts"],
  );
});

test("runtime scan remains deterministic when ripgrep is unavailable", () => {
  const root = fixture();
  writeFileSync(
    join(root, "docs", "historical.md"),
    "Frozen rollback evidence keeps evo-inbox as historical context.\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, "src", "bad.ts"),
    "export const selectedSession = 'evo-inbox';\n",
    { mode: 0o600 },
  );

  const unavailableRipgrep = () => ({
    status: null,
    stdout: undefined,
    stderr: undefined,
    error: Object.assign(new Error("spawnSync rg ENOENT"), { code: "ENOENT" }),
  });
  const scan = scanRuntimeReferences(root, undefined, unavailableRipgrep);

  assert.deepEqual(
    scan.historicalReferences.map(({ path }) => path),
    ["docs/historical.md"],
  );
  assert.deepEqual(
    scan.activeViolations.map(({ path }) => path),
    ["src/bad.ts"],
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
  assert.equal(report.gitSha, SHA);
  assert.equal(report.remoteRuntime.composeProject, "evo-crm");
  assert.equal(report.remoteRuntime.containerName, "evo-crm-waha-1");
  assert.equal(report.remoteRuntime.applicationDeploymentClaimed, false);
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

test("inventory rejects evidence and output paths outside the repository", () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), "platform-provider-runtime-outside-"));
  const escapedOutput = join(outside, "success.json");
  writeJson(join(root, "evidence", "remote.json"), validRemoteEvidence());
  writeJson(join(root, "evidence", "browser.json"), validBrowserEvidence());
  writeJson(join(root, "evidence", "database.json"), validDatabaseEvidence());

  const input = {
    repoRoot: root,
    expectedSha: SHA,
    remoteEvidencePath: "evidence/remote.json",
    browserEvidencePath: "evidence/browser.json",
    databaseEvidencePath: "evidence/database.json",
    outputPath: relative(root, escapedOutput),
  };

  assert.throws(
    () => createPlatformProviderRuntimeInventory(input),
    /must stay within the repo root/u,
  );
  assert.equal(existsSync(escapedOutput), false);

  writeJson(join(outside, "remote.json"), validRemoteEvidence());
  assert.throws(
    () =>
      createPlatformProviderRuntimeInventory({
        ...input,
        remoteEvidencePath: relative(root, join(outside, "remote.json")),
        outputPath: "evidence/runtime-inventory.json",
      }),
    /must stay within the repo root/u,
  );

  const symlinkEscape = join(root, "evidence", "escape");
  symlinkSync(outside, symlinkEscape, "dir");
  assert.throws(
    () =>
      createPlatformProviderRuntimeInventory({
        ...input,
        outputPath: "evidence/escape/nested/success.json",
      }),
    /must stay within the repo root/u,
  );
  assert.equal(existsSync(join(outside, "nested")), false);
});
