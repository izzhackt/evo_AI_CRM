import assert from "node:assert/strict";
import test from "node:test";

import { loadPlatformOperationsReadiness } from "../src/lib/server/platform-operations-readiness.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-27T10:00:00.000Z";

function signals(overrides = {}) {
  return {
    schema_version: "p7b-v1",
    observed_at: OBSERVED_AT,
    saturated: false,
    queue_ready_count: 0,
    queue_retry_wait_count: 0,
    queue_leased_count: 0,
    queue_expired_lease_count: 0,
    queue_oldest_ready_age_seconds: null,
    queue_oldest_retry_wait_age_seconds: null,
    dead_letter_count: 0,
    unknown_delivery_open_count: 0,
    provider_conflict_open_count: 0,
    private_media_pending_count: 0,
    private_media_processing_count: 0,
    private_media_retryable_error_count: 0,
    private_media_terminal_error_count: 0,
    private_media_expired_lease_count: 0,
    private_media_oldest_unarchived_age_seconds: null,
    autonomy_queued_count: 0,
    autonomy_dispatching_count: 0,
    autonomy_unknown_count: 0,
    autonomy_manual_review_count: 0,
    autonomy_oldest_queued_age_seconds: null,
    autonomy_oldest_dispatching_age_seconds: null,
    waha_readiness: "ready",
    waha_evidence_kind: "provider_observed",
    waha_age_seconds: 20,
    waha_evidence_future: false,
    ai_readiness: "ready",
    ai_evidence_kind: "provider_observed",
    ai_age_seconds: 30,
    ai_evidence_future: false,
    audit_append_status: "ready",
    ...overrides,
  };
}

function enabledConfig() {
  return {
    enabled: true,
    observabilitySecret: "observability-secret-must-never-leave-server",
    supabaseUrl: "https://staging.invalid",
    supabaseSecretKey: "supabase-secret-must-never-leave-server",
    rpcTimeoutMs: 4_000,
  };
}

test("disabled observability stays not ready without collecting or exposing secrets", async () => {
  let collected = false;
  const readiness = await loadPlatformOperationsReadiness({
    loadConfig: () => ({ enabled: false }),
    collectSignals: async () => {
      collected = true;
      throw new Error("must not be called");
    },
    requestId: () => REQUEST_ID,
    now: () => Date.parse(OBSERVED_AT),
  });

  assert.equal(collected, false);
  assert.equal(readiness.ok, false);
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.observed_at, OBSERVED_AT);
  assert.equal(readiness.components.supabase.status, "unavailable");
  assert.equal(readiness.components.waha.status, "unverified");
  assert.equal(readiness.components.ai.status, "unverified");
  assert.equal(readiness.components.restore_database.status, "missing");
  assert.equal(readiness.components.restore_storage.status, "missing");
  assert.equal(JSON.stringify(readiness).includes("observability-secret"), false);
});

test("managed recovery evidence is composed independently of live observability", async () => {
  const readiness = await loadPlatformOperationsReadiness({
    loadConfig: () => ({ enabled: false }),
    loadRecoveryEvidence: async () => ({
      source: "verified",
      resultCode: "recovery_failed",
      observedAt: OBSERVED_AT,
      database: { status: "ready", age_seconds: 60 },
      storage: { status: "failed", age_seconds: 60 },
    }),
    requestId: () => REQUEST_ID,
    now: () => Date.parse(OBSERVED_AT),
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.components.supabase.status, "unavailable");
  assert.deepEqual(readiness.components.restore_database, {
    status: "ready",
    age_seconds: 60,
  });
  assert.deepEqual(readiness.components.restore_storage, {
    status: "failed",
    age_seconds: 60,
  });
  assert.ok(
    readiness.alerts.some(({ code }) => code === "restore_evidence_failed"),
  );
});

test("blocked provider evidence and saturated counts stay not ready and partial", async () => {
  const readiness = await loadPlatformOperationsReadiness({
    loadConfig: enabledConfig,
    collectSignals: async () =>
      signals({
        saturated: true,
        queue_ready_count: 1_000_000,
        waha_readiness: "blocked",
      }),
    requestId: () => REQUEST_ID,
    now: () => Date.parse(OBSERVED_AT),
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.components.waha.status, "failed");
  assert.equal(readiness.signals?.saturated, true);
  assert.equal(readiness.signals?.queue_ready_count, 1_000_000);
  assert.ok(readiness.alerts.some(({ code }) => code === "waha_unavailable"));
  assert.ok(readiness.alerts.some(({ code }) => code === "signal_saturated"));
  const serialized = JSON.stringify(readiness);
  assert.equal(serialized.includes("observability-secret"), false);
  assert.equal(serialized.includes("supabase-secret"), false);
});

test("malformed or unavailable signal payloads fail closed without provider detail", async () => {
  for (const collectSignals of [
    async () => {
      throw new Error("raw SQL error with customer@example.com");
    },
    async () => ({ ...signals(), customer_identifier: "+996700000000" }),
  ]) {
    const readiness = await loadPlatformOperationsReadiness({
      loadConfig: enabledConfig,
      collectSignals,
      requestId: () => REQUEST_ID,
      now: () => Date.parse(OBSERVED_AT),
    });

    assert.equal(readiness.ok, false);
    assert.equal(readiness.status, "not_ready");
    const serialized = JSON.stringify(readiness);
    assert.equal(serialized.includes("customer@example.com"), false);
    assert.equal(serialized.includes("+996700000000"), false);
  }
});
