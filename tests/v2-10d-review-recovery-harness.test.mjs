import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { durableCreateOrValidateWahaCheckpoint } from "../scripts/v2-10d-waha-checkpoint.mjs";

const RECOVERY_SHELL_PATH = new URL(
  "../scripts/verify-v2-10d-review-recovery.sh",
  import.meta.url,
);
const SPEC_PATH = new URL(
  "./e2e/canonical-v2-10d-real-acceptance.spec.ts",
  import.meta.url,
);
const PACKAGE_PATH = new URL("../package.json", import.meta.url);

function sourceIndex(source, fragment) {
  const index = source.indexOf(fragment);
  assert.notEqual(index, -1, `missing recovery fragment: ${fragment}`);
  return index;
}

function wahaCheckpoint(readbackAck) {
  return {
    schemaVersion: 1,
    kind: "evo-v2-10d-waha-reconciled",
    status: "reconciled",
    gitSha: "a".repeat(40),
    recovery: {
      occurred: true,
      stage: "post-waha",
      codeSha: "b".repeat(40),
    },
    hashes: {
      proposalSha256: "c".repeat(64),
      reviewedTextSha256: "d".repeat(64),
      providerMessageIdSha256: "e".repeat(64),
    },
    review: { decision: "edited", proposalCount: 1 },
    waha: {
      status: "accepted",
      attemptCount: 1,
      outboundMessageCount: 1,
      databaseAck: 2,
      readbackAck,
      exactReadback: true,
    },
    amocrm: { attemptCount: 0, receiptCount: 0, bindingCount: 0 },
    nextAuthorizedStep: "admin_amocrm_sync_only",
    boundaries: {
      providerReadMethod: "GET",
      whatsappActionRepeated: false,
      geminiActionRepeated: false,
      humanReviewRepeated: false,
      v1ApplicationPathExecuted: false,
      deploymentMutated: false,
      fallbackObserved: false,
    },
  };
}

function existingMarkerIo(existing) {
  let createCount = 0;
  let readCount = 0;
  return {
    io: {
      create: async () => {
        createCount += 1;
        throw Object.assign(new Error("checkpoint exists"), { code: "EEXIST" });
      },
      read: async () => {
        readCount += 1;
        return existing;
      },
    },
    counts: () => ({ createCount, readCount }),
  };
}

test("post-WAHA checkpoint accepts ACK progress but rejects regression", async () => {
  const existing = wahaCheckpoint(2);
  const progressing = wahaCheckpoint(3);
  const progressIo = existingMarkerIo(existing);

  await durableCreateOrValidateWahaCheckpoint(
    "/private/waha-reconciled.json",
    progressing,
    progressIo.io,
  );
  assert.deepEqual(progressIo.counts(), { createCount: 1, readCount: 1 });

  const regressionIo = existingMarkerIo(wahaCheckpoint(3));
  await assert.rejects(
    durableCreateOrValidateWahaCheckpoint(
      "/private/waha-reconciled.json",
      wahaCheckpoint(2),
      regressionIo.io,
    ),
    /ACK regressed/u,
  );
});

test("post-WAHA checkpoint still rejects provider identity drift", async () => {
  const existing = wahaCheckpoint(2);
  const changedIdentity = wahaCheckpoint(3);
  changedIdentity.hashes.providerMessageIdSha256 = "f".repeat(64);
  const markerIo = existingMarkerIo(existing);

  await assert.rejects(
    durableCreateOrValidateWahaCheckpoint(
      "/private/waha-reconciled.json",
      changedIdentity,
      markerIo.io,
    ),
    /differs from the exact preserved result/u,
  );
});

test("V2-10D recovery binds one preserved review to exact current main", async () => {
  const source = await readFile(RECOVERY_SHELL_PATH, "utf8");

  const explicitAuthority = sourceIndex(
    source,
    '[[ "${EVO_V2_REAL_END_TO_END_RECOVERY:-}" == "1" ]]',
  );
  const exactMainFetch = sourceIndex(source, "git fetch --quiet origin main");
  const originalEvidence = sourceIndex(
    source,
    'evidence_dir="$evidence_root/$original_attempt_sha"',
  );
  const reviewRequired = sourceIndex(
    source,
    'review_marker="$evidence_dir/review-required.json"',
  );
  const noDispatch = sourceIndex(source, '[[ ! -e "$dispatch_marker"');
  const preservedProject = sourceIndex(
    source,
    "EVO_V2_10D_PRESERVED_COMPOSE_PROJECT",
  );
  const postgresStart = sourceIndex(
    source,
    'docker compose "${compose_args[@]}" start postgres',
  );
  const recoveryMode = sourceIndex(
    source,
    'EVO_V2_REAL_END_TO_END_MODE="$playwright_mode"',
  );

  assert.ok(explicitAuthority < exactMainFetch);
  assert.ok(exactMainFetch < originalEvidence);
  assert.ok(originalEvidence < reviewRequired);
  assert.ok(reviewRequired < noDispatch);
  assert.ok(preservedProject < exactMainFetch);
  assert.ok(preservedProject < postgresStart);
  assert.ok(postgresStart < recoveryMode);
  assert.match(source, /^set -euo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /Shell xtrace must be disabled/u);
  assert.match(source, /git merge-base --is-ancestor/u);
  assert.match(source, /\$\(orb status\).*Running/u);
  assert.match(source, /\$\(docker context show\).*orbstack/u);
  assert.match(source, /V2-10D review recovery requires Node 22[.]x/u);
  assert.match(source, /eq [. ]Destination "\/var\/lib\/postgresql"/u);
  assert.doesNotMatch(source, /\/var\/lib\/postgresql\/data/u);
  assert.doesNotMatch(source, /\bseed\b/iu);
  assert.doesNotMatch(source, /GEMINI_API_KEY|GEMINI_MODEL/u);
  assert.doesNotMatch(source, /provider-preparation-attempt/u);
  assert.doesNotMatch(source, /set\s+-x|set\s+-[a-z]*x[a-z]*/u);
});

test("V2-10D recovery restores state without another proposal and waits for the human", async () => {
  const source = await readFile(SPEC_PATH, "utf8");
  const recoveryMode = sourceIndex(
    source,
    '"blocked" | "operator" | "recovery"',
  );
  const existingConversation = sourceIndex(
    source,
    "async function readExistingSelfConversation(",
  );
  const markerCheck = sourceIndex(
    source,
    'path.join(evidenceDir, "review-required.json")',
  );
  const noDeadline = sourceIndex(
    source,
    "const humanActionTimeout = recoveryMode ? 0",
  );

  assert.ok(recoveryMode < existingConversation);
  assert.ok(existingConversation < markerCheck);
  assert.ok(markerCheck < noDeadline);
  assert.match(source, /reviewMarker[.]proposal/u);
  assert.match(source, /sha256\(pendingProposal[.]proposalId\)/u);
  assert.match(source, /sha256\(pendingProposal[.]proposalText\)/u);
  assert.match(source, /recoverySha/u);
  assert.match(source, /proposalCount === 1/u);
  assert.match(source, /wahaAttemptCount === 0/u);
  assert.match(source, /amocrmAttemptCount === 0/u);
  assert.equal(
    [
      ...source.matchAll(
        /getByTestId\("canonical-gemini-proposal-request"\)[.]click\(\)/gu,
      ),
    ].length,
    2,
  );
  for (const humanControl of [
    "canonical-gemini-review-accept",
    "canonical-gemini-review-edit",
    "canonical-gemini-review-reject",
    "canonical-whatsapp-outbound-confirm",
    "canonical-whatsapp-outbound-send",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(
        `getByTestId\\(["']${humanControl}["']\\)[.](?:click|check)\\(`,
        "u",
      ),
    );
  }
});

test("V2-10D post-WAHA recovery is amoCRM-only and resumes from durable provider proof", async () => {
  const shellSource = await readFile(RECOVERY_SHELL_PATH, "utf8");
  const specSource = await readFile(SPEC_PATH, "utf8");

  assert.match(
    shellSource,
    /recovery_stage="\$\{EVO_V2_10D_RECOVERY_STAGE:-review\}"/u,
  );
  assert.match(shellSource, /post-waha\)/u);
  assert.match(shellSource, /playwright_mode="post-waha"/u);
  assert.match(shellSource, /waha-reconciled[.]json/u);
  assert.match(shellSource, /EVO_V2_REAL_END_TO_END_MODE="\$playwright_mode"/u);
  assert.match(
    shellSource,
    /EVO_V2_WAHA_PROVIDER_AUTHORIZED="\$waha_provider_authorized"/u,
  );
  assert.match(
    shellSource,
    /EVO_V2_WAHA_ENABLED="\$waha_provider_authorized"/u,
  );
  assert.match(shellSource, /post-waha.*waha_provider_authorized=0/su);

  assert.match(
    specSource,
    /"blocked" \| "operator" \| "recovery" \| "post-waha"/u,
  );
  assert.match(specSource, /const postWahaRecovery = mode === "post-waha"/u);
  assert.match(specSource, /waha-reconciled[.]json/u);
  assert.match(specSource, /nextAuthorizedStep: "admin_amocrm_sync_only"/u);
  assert.match(specSource, /initialAck/u);
  assert.match(specSource, /providerMessageIdSha256/u);
  assert.match(specSource, /reviewedTextSha256/u);
  assert.match(specSource, /amocrmAttemptCount === 0/u);

  const postWahaTest = specSource.slice(
    sourceIndex(
      specSource,
      'test("post-WAHA recovery proves the accepted send before one amoCRM sync"',
    ),
  );
  for (const forbiddenPostWahaAction of [
    "seedCanonicalSelfConversation(",
    "page.goto(`/whatsapp/",
    'getByTestId("canonical-gemini-proposal-request")',
    'getByTestId("canonical-gemini-review-',
    'getByTestId("canonical-whatsapp-outbound-send")',
    'getByTestId("canonical-whatsapp-outbound-reconcile")',
  ]) {
    assert.doesNotMatch(
      postWahaTest,
      new RegExp(
        forbiddenPostWahaAction.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
        "u",
      ),
    );
  }
});

test("V2-10D recovery proof is executable and registered in provider CI", async () => {
  const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
  assert.match(
    packageJson.scripts["test:u9"],
    /tests\/v2-10d-review-recovery-harness[.]test[.]mjs/u,
  );
  assert.notEqual((await stat(RECOVERY_SHELL_PATH)).mode & 0o111, 0);
});
