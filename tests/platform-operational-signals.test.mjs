import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePlatformOperationalSignals,
  PLATFORM_OPERATIONAL_SIGNAL_KEYS,
  PlatformOperationalSignalsContractError,
} from "../src/lib/platform-operational-signals.ts";
import {
  createPlatformOperationalSignalsCollector,
  createPlatformOperationalSignalsTransport,
  PlatformOperationalSignalsCollectionError,
} from "../src/lib/server/platform-operational-signals-repository.ts";

const REQUEST_ID = "b0000000-0000-4000-8000-000000000001";

function signals(overrides = {}) {
  return {
    schema_version: "p7b-v1",
    observed_at: "2026-08-13T12:00:00.000Z",
    saturated: false,
    queue_ready_count: 1,
    queue_retry_wait_count: 2,
    queue_leased_count: 3,
    queue_expired_lease_count: 0,
    queue_oldest_ready_age_seconds: 4,
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
    waha_age_seconds: 10,
    waha_evidence_future: false,
    ai_readiness: "configured_unverified",
    ai_evidence_kind: "configuration_check",
    ai_age_seconds: 12,
    ai_evidence_future: false,
    audit_append_status: "ready",
    ...overrides,
  };
}

function enabledConfig() {
  return {
    enabled: true,
    observabilitySecret: "x".repeat(32),
    supabaseUrl: "http://127.0.0.1:45421",
    supabaseSecretKey: "sb_secret_p7b_local_1234567890",
    rpcTimeoutMs: 5_000,
  };
}

test("the frozen P7B SQL DTO has exactly 33 safe top-level keys", () => {
  assert.equal(PLATFORM_OPERATIONAL_SIGNAL_KEYS.length, 33);
  assert.deepEqual(
    Object.keys(parsePlatformOperationalSignals(signals())),
    PLATFORM_OPERATIONAL_SIGNAL_KEYS,
  );
});

test("the P7B SQL DTO rejects missing, extra, unsafe, out-of-range, and wrong-enum values", () => {
  const missing = signals();
  delete missing.audit_append_status;

  for (const candidate of [
    null,
    [],
    missing,
    signals({ organization_id: "b0000000-0000-4000-8000-000000000002" }),
    signals({ schema_version: "p7b-v2" }),
    signals({ observed_at: "not-a-timestamp" }),
    signals({ saturated: 0 }),
    signals({ queue_ready_count: -1 }),
    signals({ queue_ready_count: 1_000_001 }),
    signals({ queue_ready_count: 1.5 }),
    signals({ waha_age_seconds: -1 }),
    signals({ ai_age_seconds: 31_536_001 }),
    signals({ waha_readiness: "unavailable" }),
    signals({ ai_evidence_kind: "provider_payload" }),
    signals({ waha_evidence_future: 0 }),
    signals({ audit_append_status: "unverified" }),
  ]) {
    assert.throws(
      () => parsePlatformOperationalSignals(candidate),
      PlatformOperationalSignalsContractError,
    );
  }
});

test("the CRM transport calls only the frozen RPC with one request UUID and redirect rejection", async () => {
  const calls = [];
  const transport = createPlatformOperationalSignalsTransport(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(signals()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(await transport(enabledConfig(), REQUEST_ID), signals());
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "http://127.0.0.1:45421/rest/v1/rpc/platform_operational_signals_v1",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_request_id: REQUEST_ID });
  assert.equal(calls[0].init.headers.get("accept-profile"), "platform");
  assert.equal(calls[0].init.headers.get("content-profile"), "platform");
  assert.equal(calls[0].init.headers.get("apikey"), enabledConfig().supabaseSecretKey);
  assert.equal(
    calls[0].init.headers.get("authorization"),
    `Bearer ${enabledConfig().supabaseSecretKey}`,
  );
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("the CRM transport performs no automatic retry and exposes no database detail", async () => {
  let attempts = 0;
  const transport = createPlatformOperationalSignalsTransport(async () => {
    attempts += 1;
    return new Response('sensitive SQL detail for customer +996700000000', {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  });

  await assert.rejects(
    () => transport(enabledConfig(), REQUEST_ID),
    (error) =>
      error instanceof PlatformOperationalSignalsCollectionError &&
      error.message === "Platform operational signals are unavailable." &&
      !error.message.includes("996700000000"),
  );
  assert.equal(attempts, 1);
});

test("concurrent readiness and metrics collections share one in-flight snapshot but no completed cache", async () => {
  let calls = 0;
  let release;
  const firstGate = new Promise((resolve) => {
    release = resolve;
  });
  const collector = createPlatformOperationalSignalsCollector(async () => {
    calls += 1;
    if (calls === 1) await firstGate;
    return signals({ queue_ready_count: calls });
  });

  const readiness = collector(enabledConfig(), REQUEST_ID);
  const metrics = collector(
    enabledConfig(),
    "b0000000-0000-4000-8000-000000000002",
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.equal((await readiness).queue_ready_count, 1);
  assert.equal((await metrics).queue_ready_count, 1);

  assert.equal(
    (
      await collector(
        enabledConfig(),
        "b0000000-0000-4000-8000-000000000003",
      )
    ).queue_ready_count,
    2,
  );
  assert.equal(calls, 2);
});

test("a rejected in-flight collection is cleared for the next real attempt", async () => {
  let calls = 0;
  const collector = createPlatformOperationalSignalsCollector(async () => {
    calls += 1;
    if (calls === 1) throw new Error("first attempt failed");
    return signals();
  });

  await assert.rejects(() => collector(enabledConfig(), REQUEST_ID));
  assert.deepEqual(await collector(enabledConfig(), REQUEST_ID), signals());
  assert.equal(calls, 2);
});
