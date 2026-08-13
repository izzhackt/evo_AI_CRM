import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  composePlatformReadiness,
  evaluatePlatformOperationalAlerts,
  renderPlatformMetrics,
} from "../src/lib/platform-observability.ts";
import {
  authenticatePlatformObservabilityRequest,
  createPlatformObservabilitySignedHeaders,
  PLATFORM_OBSERVABILITY_PATHS,
} from "../src/lib/server/platform-observability-request.ts";
import {
  createPlatformMetricsRoute,
  createPlatformReadinessRoute,
  logPlatformObservabilityRequest,
} from "../src/lib/server/platform-observability-routes.ts";

const REQUEST_ID = "b0000000-0000-4000-8000-000000000001";
const SECRET = "x".repeat(32);
const NOW = 1_786_622_400_000;
const TIMESTAMP = String(NOW);

function signals(overrides = {}) {
  return {
    schema_version: "p7b-v1",
    observed_at: "2026-08-13T12:00:00.000Z",
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
    observabilitySecret: SECRET,
    supabaseUrl: "http://127.0.0.1:45421",
    supabaseSecretKey: "sb_secret_p7b_local_1234567890",
    rpcTimeoutMs: 5_000,
  };
}

function signedRequest(path, overrides = {}) {
  const headers = createPlatformObservabilitySignedHeaders({
    path,
    requestId: REQUEST_ID,
    timestamp: TIMESTAMP,
    secret: SECRET,
  });
  for (const [name, value] of Object.entries(overrides.headers ?? {})) {
    headers.set(name, value);
  }
  return new Request(`http://localhost${path}${overrides.search ?? ""}`, {
    method: overrides.method ?? "GET",
    headers,
    body: overrides.body,
  });
}

test("the exported signer freezes exact path-bound HMAC bytes and authentication", () => {
  const headers = createPlatformObservabilitySignedHeaders({
    path: PLATFORM_OBSERVABILITY_PATHS.readiness,
    requestId: REQUEST_ID,
    timestamp: TIMESTAMP,
    secret: SECRET,
  });
  const expected = createHmac("sha256", SECRET)
    .update(`GET\n/api/readiness\n${REQUEST_ID}\n${TIMESTAMP}`, "utf8")
    .digest("hex");

  assert.deepEqual(Object.fromEntries(headers), {
    "x-evo-observability-hmac": expected,
    "x-evo-observability-hmac-algorithm": "sha256",
    "x-evo-observability-request-id": REQUEST_ID,
    "x-evo-observability-timestamp": TIMESTAMP,
  });
  assert.deepEqual(
    authenticatePlatformObservabilityRequest(
      signedRequest("/api/readiness"),
      "/api/readiness",
      SECRET,
      NOW,
    ),
    { requestId: REQUEST_ID },
  );

  const canonicalNonNilUuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const nonVersionedHeaders = createPlatformObservabilitySignedHeaders({
    path: PLATFORM_OBSERVABILITY_PATHS.metrics,
    requestId: canonicalNonNilUuid,
    timestamp: TIMESTAMP,
    secret: SECRET,
  });
  assert.deepEqual(
    authenticatePlatformObservabilityRequest(
      new Request("http://localhost/metrics", { headers: nonVersionedHeaders }),
      "/metrics",
      SECRET,
      NOW,
    ),
    { requestId: canonicalNonNilUuid },
  );
});

test("authentication rejects malformed, stale, future, duplicated, cross-path, query, body, and method requests", () => {
  const malformed = [
    signedRequest("/api/readiness", {
      headers: { "x-evo-observability-request-id": REQUEST_ID.toUpperCase() },
    }),
    signedRequest("/api/readiness", {
      headers: { "x-evo-observability-request-id": "00000000-0000-0000-0000-000000000000" },
    }),
    signedRequest("/api/readiness", {
      headers: { "x-evo-observability-timestamp": String(NOW - 300_001) },
    }),
    signedRequest("/api/readiness", {
      headers: { "x-evo-observability-timestamp": String(NOW + 300_001) },
    }),
    signedRequest("/api/readiness", {
      headers: { "x-evo-observability-hmac-algorithm": "SHA256" },
    }),
    signedRequest("/api/readiness", {
      headers: { "x-evo-observability-hmac": "0".repeat(64) },
    }),
    signedRequest("/api/readiness", { search: "?probe=1" }),
    signedRequest("/api/readiness", { method: "POST", body: "{}" }),
  ];

  const duplicateHeaders = createPlatformObservabilitySignedHeaders({
    path: "/api/readiness",
    requestId: REQUEST_ID,
    timestamp: TIMESTAMP,
    secret: SECRET,
  });
  duplicateHeaders.append("x-evo-observability-request-id", REQUEST_ID);
  malformed.push(
    new Request("http://localhost/api/readiness", { headers: duplicateHeaders }),
  );

  const crossPathHeaders = createPlatformObservabilitySignedHeaders({
    path: "/metrics",
    requestId: REQUEST_ID,
    timestamp: TIMESTAMP,
    secret: SECRET,
  });
  malformed.push(
    new Request("http://localhost/api/readiness", { headers: crossPathHeaders }),
  );
  malformed.push(
    new Request("http://localhost/api/readiness/", {
      headers: createPlatformObservabilitySignedHeaders({
        path: "/api/readiness",
        requestId: REQUEST_ID,
        timestamp: TIMESTAMP,
        secret: SECRET,
      }),
    }),
  );
  malformed.push({
    method: "GET",
    url: "http://localhost/api/readiness",
    headers: createPlatformObservabilitySignedHeaders({
      path: "/api/readiness",
      requestId: REQUEST_ID,
      timestamp: TIMESTAMP,
      secret: SECRET,
    }),
    body: new ReadableStream(),
  });

  for (const request of malformed) {
    assert.equal(
      authenticatePlatformObservabilityRequest(
        request,
        "/api/readiness",
        SECRET,
        NOW,
      ),
      null,
    );
  }
});

test("readiness normalizes evidence exactly and keeps restore evidence non-blocking", () => {
  const ready = composePlatformReadiness({
    signals: signals(),
    requestId: REQUEST_ID,
    fallbackObservedAt: new Date(NOW).toISOString(),
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.status, "ready");
  assert.deepEqual(Object.keys(ready), [
    "schema_version",
    "ok",
    "status",
    "service",
    "request_id",
    "observed_at",
    "components",
    "signals",
    "alerts",
  ]);
  assert.deepEqual(ready.components, {
    supabase: { status: "ready", age_seconds: null },
    audit_append: { status: "ready", age_seconds: null },
    waha: { status: "ready", age_seconds: 20 },
    ai: { status: "ready", age_seconds: 30 },
    restore_database: { status: "missing", age_seconds: null },
    restore_storage: { status: "missing", age_seconds: null },
  });
  assert.deepEqual(ready.alerts.map(({ code }) => code), [
    "restore_evidence_missing",
  ]);

  const normalizationCases = [
    [{ waha_readiness: "ready", waha_evidence_kind: "configuration_check" }, "unverified"],
    [{ waha_readiness: "configured_unverified", waha_age_seconds: 400 }, "unverified"],
    [{ waha_readiness: "blocked" }, "failed"],
    [{ waha_age_seconds: null, waha_evidence_kind: null }, "missing"],
    [{ waha_age_seconds: 301 }, "stale"],
    [{ waha_evidence_future: true }, "failed"],
  ];
  for (const [override, status] of normalizationCases) {
    assert.equal(
      composePlatformReadiness({
        signals: signals(override),
        requestId: REQUEST_ID,
        fallbackObservedAt: new Date(NOW).toISOString(),
      }).components.waha.status,
      status,
    );
  }
});

test("the deterministic alert evaluator applies thresholds, suppression, uniqueness, and stable sort", () => {
  const readiness = composePlatformReadiness({
    signals: signals({
      saturated: true,
      queue_ready_count: 100,
      queue_expired_lease_count: 1,
      dead_letter_count: 1,
      unknown_delivery_open_count: 1,
      provider_conflict_open_count: 1,
      private_media_pending_count: 25,
      private_media_terminal_error_count: 1,
      private_media_expired_lease_count: 1,
      autonomy_unknown_count: 1,
      autonomy_manual_review_count: 1,
      autonomy_oldest_queued_age_seconds: 900,
      autonomy_oldest_dispatching_age_seconds: 300,
    }),
    requestId: REQUEST_ID,
    fallbackObservedAt: new Date(NOW).toISOString(),
    restoreDatabase: { status: "failed", age_seconds: 86_400 },
    restoreStorage: { status: "missing", age_seconds: null },
  });
  const alerts = evaluatePlatformOperationalAlerts({
    signals: readiness.signals,
    components: readiness.components,
  });

  assert.deepEqual(alerts.map(({ code }) => code), [
    "autonomy_dispatch_stalled",
    "autonomy_queue_stalled_critical",
    "autonomy_unknown",
    "private_media_expired_lease",
    "private_media_terminal_error",
    "provider_conflict_open",
    "queue_backlog_critical",
    "queue_dead_letter",
    "queue_expired_lease",
    "restore_evidence_failed",
    "signal_saturated",
    "unknown_delivery_open",
    "autonomy_manual_review",
    "private_media_backlog",
  ]);
  assert.equal(new Set(alerts.map(({ code }) => code)).size, alerts.length);
  assert.equal(alerts.some(({ code }) => code === "queue_backlog_warning"), false);
  assert.equal(
    alerts.some(({ code }) => code === "autonomy_queue_stalled_warning"),
    false,
  );
  assert.equal(alerts.some(({ code }) => code === "restore_evidence_missing"), false);
});

test("every alert code keeps its frozen severity, owner, and runbook mapping", () => {
  const criticalReadiness = composePlatformReadiness({
    signals: signals({
      saturated: true,
      queue_ready_count: 100,
      queue_expired_lease_count: 1,
      dead_letter_count: 1,
      unknown_delivery_open_count: 1,
      provider_conflict_open_count: 1,
      private_media_pending_count: 25,
      private_media_terminal_error_count: 1,
      private_media_expired_lease_count: 1,
      autonomy_unknown_count: 1,
      autonomy_manual_review_count: 1,
      autonomy_oldest_queued_age_seconds: 900,
      autonomy_oldest_dispatching_age_seconds: 300,
    }),
    requestId: REQUEST_ID,
    fallbackObservedAt: new Date(NOW).toISOString(),
    restoreDatabase: { status: "failed", age_seconds: null },
    restoreStorage: { status: "ready", age_seconds: 1 },
  });
  const warningReadiness = composePlatformReadiness({
    signals: signals({
      queue_ready_count: 25,
      autonomy_oldest_queued_age_seconds: 300,
    }),
    requestId: REQUEST_ID,
    fallbackObservedAt: new Date(NOW).toISOString(),
    restoreDatabase: { status: "ready", age_seconds: 1 },
    restoreStorage: { status: "ready", age_seconds: 1 },
  });
  const dependencyFailure = composePlatformReadiness({
    signals: null,
    requestId: REQUEST_ID,
    fallbackObservedAt: new Date(NOW).toISOString(),
  });
  const byCode = Object.fromEntries(
    [
      ...criticalReadiness.alerts,
      ...warningReadiness.alerts,
      ...dependencyFailure.alerts,
    ].map((alert) => [alert.code, alert]),
  );

  assert.deepEqual(byCode, {
    autonomy_dispatch_stalled: { code: "autonomy_dispatch_stalled", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-ROLLBACK-KILL-SWITCH" },
    autonomy_queue_stalled_critical: { code: "autonomy_queue_stalled_critical", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-ROLLBACK-KILL-SWITCH" },
    autonomy_unknown: { code: "autonomy_unknown", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-ROLLBACK-KILL-SWITCH" },
    private_media_expired_lease: { code: "private_media_expired_lease", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-PRIVATE-MEDIA" },
    private_media_terminal_error: { code: "private_media_terminal_error", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-PRIVATE-MEDIA" },
    provider_conflict_open: { code: "provider_conflict_open", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-UNKNOWN-DELIVERY" },
    queue_backlog_critical: { code: "queue_backlog_critical", severity: "critical", owner_category: "server_operator", runbook_id: "RB-P7B-QUEUE-BACKLOG" },
    queue_dead_letter: { code: "queue_dead_letter", severity: "critical", owner_category: "server_operator", runbook_id: "RB-P7B-QUEUE-BACKLOG" },
    queue_expired_lease: { code: "queue_expired_lease", severity: "critical", owner_category: "server_operator", runbook_id: "RB-P7B-QUEUE-BACKLOG" },
    restore_evidence_failed: { code: "restore_evidence_failed", severity: "critical", owner_category: "data_recovery_owner", runbook_id: "RB-P7B-RESTORE-EVIDENCE" },
    signal_saturated: { code: "signal_saturated", severity: "critical", owner_category: "server_operator", runbook_id: "RB-P7B-QUEUE-BACKLOG" },
    unknown_delivery_open: { code: "unknown_delivery_open", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-UNKNOWN-DELIVERY" },
    autonomy_manual_review: { code: "autonomy_manual_review", severity: "warning", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-ROLLBACK-KILL-SWITCH" },
    private_media_backlog: { code: "private_media_backlog", severity: "warning", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-PRIVATE-MEDIA" },
    autonomy_queue_stalled_warning: { code: "autonomy_queue_stalled_warning", severity: "warning", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-ROLLBACK-KILL-SWITCH" },
    queue_backlog_warning: { code: "queue_backlog_warning", severity: "warning", owner_category: "server_operator", runbook_id: "RB-P7B-QUEUE-BACKLOG" },
    ai_unavailable: { code: "ai_unavailable", severity: "critical", owner_category: "ai_operator", runbook_id: "RB-P7B-AI-UNAVAILABLE" },
    audit_append_failed: { code: "audit_append_failed", severity: "critical", owner_category: "server_operator", runbook_id: "RB-P7B-AUDIT-APPEND" },
    restore_evidence_missing: { code: "restore_evidence_missing", severity: "warning", owner_category: "data_recovery_owner", runbook_id: "RB-P7B-RESTORE-EVIDENCE" },
    supabase_unavailable: { code: "supabase_unavailable", severity: "critical", owner_category: "server_operator", runbook_id: "RB-P7B-SUPABASE-UNAVAILABLE" },
    waha_unavailable: { code: "waha_unavailable", severity: "critical", owner_category: "whatsapp_operator", runbook_id: "RB-P7B-WAHA-DEGRADED" },
  });
});

test("readiness route returns exact safe authenticated and SQL-failure responses", async () => {
  let calls = 0;
  const completions = [];
  const readyRoute = createPlatformReadinessRoute({
    loadConfig: enabledConfig,
    collectSignals: async () => {
      calls += 1;
      return signals();
    },
    logCompletion: (completion) => completions.push(completion),
    now: () => NOW,
  });
  const response = await readyRoute(signedRequest("/api/readiness"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(Object.keys(await response.json()), [
    "schema_version",
    "ok",
    "status",
    "service",
    "request_id",
    "observed_at",
    "components",
    "signals",
    "alerts",
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(completions, [{
    path: "/api/readiness",
    requestId: REQUEST_ID,
    status: 200,
    startedAtMs: NOW,
    completedAtMs: NOW,
  }]);

  const failedRoute = createPlatformReadinessRoute({
    loadConfig: enabledConfig,
    collectSignals: async () => {
      throw new Error("sensitive SQL detail +996700000000");
    },
    logCompletion: (completion) => completions.push(completion),
    now: () => NOW,
  });
  const failedResponse = await failedRoute(signedRequest("/api/readiness"));
  const failedBody = await failedResponse.json();
  assert.equal(failedResponse.status, 503);
  assert.equal(failedBody.signals, null);
  assert.deepEqual(failedBody.components, {
    supabase: { status: "unavailable", age_seconds: null },
    audit_append: { status: "unavailable", age_seconds: null },
    waha: { status: "unverified", age_seconds: null },
    ai: { status: "unverified", age_seconds: null },
    restore_database: { status: "missing", age_seconds: null },
    restore_storage: { status: "missing", age_seconds: null },
  });
  assert.deepEqual(failedBody.alerts.map(({ code }) => code), [
    "ai_unavailable",
    "audit_append_failed",
    "supabase_unavailable",
    "waha_unavailable",
    "restore_evidence_missing",
  ]);
  assert.equal(JSON.stringify(failedBody).includes("996700000000"), false);
  assert.equal(completions.at(-1)?.status, 503);
});

test("disabled and invalid requests return an empty 404 without collecting signals", async () => {
  let calls = 0;
  const invalidRoute = createPlatformReadinessRoute({
    loadConfig: () => ({ enabled: false }),
    collectSignals: async () => {
      calls += 1;
      return signals();
    },
    now: () => NOW,
  });
  const disabledResponse = await invalidRoute(signedRequest("/api/readiness"));
  assert.equal(disabledResponse.status, 404);
  assert.equal(disabledResponse.headers.get("cache-control"), "no-store");
  assert.equal(await disabledResponse.text(), "");

  const enabledRoute = createPlatformReadinessRoute({
    loadConfig: enabledConfig,
    collectSignals: async () => {
      calls += 1;
      return signals();
    },
    now: () => NOW,
  });
  const invalidResponse = await enabledRoute(new Request("http://localhost/api/readiness"));
  assert.equal(invalidResponse.status, 404);
  assert.equal(await invalidResponse.text(), "");

  const unsafeConfigRoute = createPlatformReadinessRoute({
    loadConfig: () => {
      throw new Error("unsafe configuration detail");
    },
    collectSignals: async () => {
      calls += 1;
      return signals();
    },
    now: () => NOW,
  });
  const unsafeConfigResponse = await unsafeConfigRoute(
    signedRequest("/api/readiness"),
  );
  assert.equal(unsafeConfigResponse.status, 404);
  assert.equal(await unsafeConfigResponse.text(), "");
  assert.equal(calls, 0);
});

test("authenticated CRM observability requests emit only the frozen completion log", async () => {
  const logged = [];
  const originalInfo = console.info;
  console.info = (...args) => logged.push(args);
  try {
    logPlatformObservabilityRequest({
      path: "/api/readiness",
      requestId: REQUEST_ID,
      status: 503,
      startedAtMs: NOW,
      completedAtMs: NOW + 17.9,
    });
    logPlatformObservabilityRequest({
      path: "/metrics",
      requestId: REQUEST_ID,
      status: 200,
      startedAtMs: NOW,
      completedAtMs: NOW + 2,
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(logged.length, 2);
  assert.deepEqual(JSON.parse(String(logged[0][0])), {
    event_code: "p7b_readiness_request",
    service: "evo-crm",
    request_id: REQUEST_ID,
    method: "GET",
    route_template: "/api/readiness",
    status_class: "5xx",
    elapsed_ms: 17,
  });
  assert.deepEqual(JSON.parse(String(logged[1][0])), {
    event_code: "p7b_metrics_request",
    service: "evo-crm",
    request_id: REQUEST_ID,
    method: "GET",
    route_template: "/metrics",
    status_class: "2xx",
    elapsed_ms: 2,
  });
  const serialized = JSON.stringify(logged);
  for (const privateValue of [
    SECRET,
    "?tenant=private",
    "+996700000000",
    "provider-payload",
    "object-key",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("metrics route emits deterministic Prometheus 0.0.4 and keeps safe failure scrapeable", async () => {
  const completions = [];
  const metricsRoute = createPlatformMetricsRoute({
    loadConfig: enabledConfig,
    collectSignals: async () => signals(),
    logCompletion: (completion) => completions.push(completion),
    now: () => NOW,
  });
  const response = await metricsRoute(signedRequest("/metrics"));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/plain; version=0.0.4; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(body, renderPlatformMetrics(composePlatformReadiness({
    signals: signals(),
    requestId: REQUEST_ID,
    fallbackObservedAt: new Date(NOW).toISOString(),
  })));
  assert.equal(body.endsWith("\n"), true);
  assert.equal(body.includes("\r"), false);
  assert.equal(body.includes(REQUEST_ID), false);
  assert.match(body, /^# HELP evo_platform_readiness /);
  assert.match(body, /evo_platform_readiness 1\n/);
  assert.match(body, /evo_platform_component_ready\{component="waha"\} 1\n/);
  assert.match(body, /evo_platform_component_age_seconds\{component="ai"\} 30\n/);
  assert.match(body, /evo_platform_active_alerts\{severity="warning"\} 1\n/);
  const expectedFamilies = [
    "evo_platform_readiness",
    "evo_platform_component_ready",
    "evo_platform_component_age_seconds",
    "evo_platform_queue_items",
    "evo_platform_queue_oldest_age_seconds",
    "evo_platform_review_items",
    "evo_platform_private_media_items",
    "evo_platform_private_media_oldest_age_seconds",
    "evo_platform_autonomy_items",
    "evo_platform_autonomy_oldest_queued_age_seconds",
    "evo_platform_autonomy_oldest_dispatching_age_seconds",
    "evo_platform_signal_saturated",
    "evo_platform_active_alerts",
  ];
  assert.deepEqual(
    [...body.matchAll(/^# HELP (evo_platform_[a-z_]+) /gm)].map((match) => match[1]),
    expectedFamilies,
  );
  assert.deepEqual(completions, [{
    path: "/metrics",
    requestId: REQUEST_ID,
    status: 200,
    startedAtMs: NOW,
    completedAtMs: NOW,
  }]);
  assert.deepEqual(
    [...body.matchAll(/^# TYPE (evo_platform_[a-z_]+) gauge$/gm)].map(
      (match) => match[1],
    ),
    expectedFamilies,
  );

  const failureRoute = createPlatformMetricsRoute({
    loadConfig: enabledConfig,
    collectSignals: async () => {
      throw new Error("database failed");
    },
    logCompletion: (completion) => completions.push(completion),
    now: () => NOW,
  });
  const failureResponse = await failureRoute(signedRequest("/metrics"));
  const failureBody = await failureResponse.text();
  assert.equal(failureResponse.status, 200);
  assert.match(failureBody, /evo_platform_readiness 0\n/);
  assert.match(failureBody, /evo_platform_component_ready\{component="supabase"\} 0\n/);
  assert.equal(failureBody.includes("evo_platform_queue_items"), false);
  assert.equal(failureBody.includes("evo_platform_signal_saturated"), false);
  assert.deepEqual(
    [...failureBody.matchAll(/^# HELP (evo_platform_[a-z_]+) /gm)].map(
      (match) => match[1],
    ),
    [
      "evo_platform_readiness",
      "evo_platform_component_ready",
      "evo_platform_active_alerts",
    ],
  );
  assert.equal(completions.at(-1)?.status, 200);
});

test("route and proxy wiring expose every supported method as empty-404 guarded and admit only exact paths", async () => {
  const [readinessSource, metricsSource, proxySource] = await Promise.all([
    readFile(new URL("../src/app/api/readiness/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/metrics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [readinessSource, metricsSource]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.match(source, new RegExp(`export const ${method} =`));
    }
  }
  assert.equal(readinessSource.includes("better-sqlite3"), false);
  assert.equal(readinessSource.includes("@/lib/db"), false);
  assert.match(proxySource, /path === "\/api\/readiness"/);
  assert.match(proxySource, /path === "\/metrics"/);
  assert.match(proxySource, /path\.startsWith\("\/metrics"\)/);
  assert.match(proxySource, /path\.startsWith\("\/api\/readiness"\)/);
  assert.match(proxySource, /new NextResponse\(null, \{ status: 404 \}\)/);
  assert.match(
    proxySource,
    /const observabilityPathCandidate =[\s\S]*if \(!observabilityPathCandidate\) \{[\s\S]*event: "http_request"/,
  );
});
