import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

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
    'docker compose "${compose_args[@]}" up --detach postgres',
  );
  const recoveryMode = sourceIndex(
    source,
    "EVO_V2_REAL_END_TO_END_MODE=recovery",
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

test("V2-10D recovery proof is executable and registered in provider CI", async () => {
  const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
  assert.match(
    packageJson.scripts["test:u9"],
    /tests\/v2-10d-review-recovery-harness[.]test[.]mjs/u,
  );
  assert.notEqual((await stat(RECOVERY_SHELL_PATH)).mode & 0o111, 0);
});
