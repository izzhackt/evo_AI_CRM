import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harness = readFileSync(
  new URL("../scripts/test-p2g-queues-runtime.sh", import.meta.url),
  "utf8",
);
const sqlHarness = readFileSync(
  new URL("../supabase/tests/platform_queues_rls.sql", import.meta.url),
  "utf8",
);

const sliceBetween = (start, end) => {
  const startIndex = harness.indexOf(start);
  const endIndex = harness.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return harness.slice(startIndex, endIndex);
};

const sqlClaimVisibilityFor = (workerName) => {
  const escapedWorkerName = workerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const claim = sqlHarness.match(
    new RegExp(
      `SELECT platform\\.claim_durable_work\\(\\n\\s+(\\d+),\\n\\s+'${escapedWorkerName}',`,
    ),
  );

  assert.ok(claim, `missing SQL queue claim for ${workerName}`);
  return Number(claim[1]);
};

test("explicit unknown-result processing keeps a normal non-expiry lease", () => {
  const explicitUnknownResult = sliceBetween(
    'manual_claim="$('.trim(),
    'unknown_evidence="$('.trim(),
  );

  assert.match(
    explicitUnknownResult,
    /claim_fields \\\n+\s+30 \\\n+\s+"p2g-runtime-unknown"/,
  );
  assert.match(explicitUnknownResult, /finish_work \\\n+[\s\S]*"unknown_result"/);
});

test("crash ambiguity still proves expiry with a one-second lease", () => {
  const crashAmbiguity = sliceBetween(
    'manual_crash_claim="$('.trim(),
    'manual_crash_evidence="$('.trim(),
  );

  assert.match(
    crashAmbiguity,
    /claim_fields \\\n+\s+1 \\\n+\s+"p2g-runtime-crash-before-finish"/,
  );
  assert.match(crashAmbiguity, /sleep 2/);
  assert.match(crashAmbiguity, /lease_expired_without_result/);
});

test("SQL workers that finish keep a normal lease while terminal probes stay short", () => {
  for (const workerName of [
    "worker-conflict",
    "worker-ai-first",
    "worker-ai-second",
    "worker-manual",
    "worker-dlq",
  ]) {
    assert.equal(sqlClaimVisibilityFor(workerName), 30, workerName);
  }

  for (const workerName of [
    "worker-conflict-second",
    "worker-conflict-after-finish",
    "worker-ai-immediate-reclaim",
    "worker-ai-after-success",
    "worker-manual-after-unknown",
    "worker-dlq-after-finish",
  ]) {
    assert.equal(sqlClaimVisibilityFor(workerName), 1, workerName);
  }
});

test("SQL negative finish checks reject the intended input shape", () => {
  assert.match(sqlHarness, /:'finish_webhook_unknown_state' = '22023'/);
  assert.match(sqlHarness, /:'finish_ai_unknown_state' = '22023'/);
  assert.match(sqlHarness, /:'finish_manual_conflict_state' = '22023'/);
});

test("runtime webhook fixtures remain explicitly inbound after P5A hardening", () => {
  assert.match(harness, /'fromMe', FALSE/);
  assert.match(harness, /'source', 'app'/);
  assert.match(harness, /'event', 'message'/);
  assert.match(harness, /'session', 'crm_primary'/);
});
