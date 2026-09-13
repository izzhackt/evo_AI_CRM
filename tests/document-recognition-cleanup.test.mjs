import assert from "node:assert/strict";
import test from "node:test";
import { runDocumentRecognitionCleanupOnce } from "../src/lib/server/document-recognition-worker.ts";

// Injected RPC/provider outcomes exercise orchestration, not live Gemini cleanup.
// The separate real PostgreSQL workflow owns state/lease/replay evidence.
const CONFIG = Object.freeze({ enabled: true, projectId: "synthetic-project", model: "gemini-3.7-flash",
  configVersion: "synthetic-v1", pricingPolicyVersion: "synthetic-pricing-v1", paidProjectId: "synthetic-project",
  paidEligibilityReference: "synthetic-only-no-billing-proof", perJobBudgetMicros: 100_000,
  dailyOrgBudgetMicros: 1_000_000, inputTokenCeiling: 10_000, outputTokenCeiling: 6000,
  inputMicrosPerMillionTokens: 100_000, outputMicrosPerMillionTokens: 1_000_000 });
const ATTEMPT = "10000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-13T17:00:00Z");
const CLAIM = Object.freeze({ attempt_id: ATTEMPT, cleanup_token: "20000000-0000-4000-8000-000000000001",
  resource_name: `files/evo-${ATTEMPT.replaceAll("-", "")}`, project_id: CONFIG.projectId, config: CONFIG,
  sha256: "a".repeat(64), bytes: 100, mime_type: "application/pdf", source_pages: 2,
  lease_until: new Date(NOW + 90_000).toISOString() });
const FILE = Object.freeze({ name: CLAIM.resource_name,
  uri: `https://generativelanguage.googleapis.com/v1beta/${CLAIM.resource_name}`,
  state: "ACTIVE", sha256: CLAIM.sha256, bytes: CLAIM.bytes, mimeType: CLAIM.mime_type, expirationTime: null });
function harness({ claim = CLAIM, inspections = [{ outcome: "found", file: FILE }, { outcome: "not_found" }],
  removed = { outcome: "acknowledged" }, dispatch = true, unknownNotFound = false, lostIntent = false } = {}) {
  const calls = [];
  let inspection = 0;
  const deps = {
    now: () => NOW,
    async rpc(name, args, signal) {
      assert.equal(signal.aborted, false);
      calls.push({ name, args });
      if (name === "claim_document_recognition_cleanup") return claim;
      assert.equal(args.p_attempt_id, ATTEMPT);
      assert.equal(args.p_cleanup_token, CLAIM.cleanup_token);
      if (name === "begin_document_recognition_delete") {
        assert.equal(args.p_resource_name, CLAIM.resource_name);
        if (lostIntent) throw new Error("Synthetic lost RPC reply");
        return { dispatch };
      }
      assert.equal(name, "record_document_recognition_cleanup");
      const observed = args.p_observation;
      assert.deepEqual(Object.keys(observed).sort(), ["bytes", "mime_type", "outcome", "resource_name", "sha256", "state"]);
      assert.equal(observed.resource_name, CLAIM.resource_name);
      if (observed.outcome === "present") {
        assert.equal(observed.sha256, CLAIM.sha256);
        assert.equal(observed.bytes, CLAIM.bytes);
      } else {
        assert.equal(observed.state, null);
        assert.equal(observed.sha256, null);
        assert.equal(observed.bytes, null);
        assert.equal(observed.mime_type, null);
      }
      return { cleanup_state: observed.outcome === "not_found" && !unknownNotFound ? "confirmed_absent" : "pending" };
    },
    providerFor(config) {
      assert.deepEqual(config, CONFIG);
      calls.push({ name: "providerFor" });
      return {
        async inspect(binding, signal) {
          assert.equal(signal.aborted, false);
          assert.equal(binding.page_count, 2);
          assert.equal(binding.name, CLAIM.resource_name);
          calls.push({ name: "GET" });
          assert.ok(inspection < inspections.length, "no extra GET or hidden retry");
          return inspections[inspection++];
        },
        async remove(binding, signal) {
          assert.equal(signal.aborted, false);
          assert.equal(binding.name, CLAIM.resource_name);
          calls.push({ name: "DELETE" });
          return removed;
        },
      };
    },
  };
  return { calls, run: () => runDocumentRecognitionCleanupOnce("synthetic-cleanup", deps, new AbortController().signal) };
}

test("cleanup records owned GET, durable delete intent, acknowledgement and separate absence", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { outcome: "settled", attempt_id: ATTEMPT, cleanup_state: "confirmed_absent", failure_code: null });
  assert.deepEqual(h.calls.map(call => call.name), ["claim_document_recognition_cleanup", "providerFor", "GET",
    "record_document_recognition_cleanup", "begin_document_recognition_delete", "DELETE",
    "record_document_recognition_cleanup", "GET", "record_document_recognition_cleanup"]);
  assert.deepEqual(h.calls.filter(call => call.args?.p_observation).map(call => call.args.p_observation.outcome),
    ["present", "delete_acknowledged", "not_found"]);
});

test("unknown upload early404 retains database pending and never attempts DELETE", async () => {
  const h = harness({ inspections: [{ outcome: "not_found" }], unknownNotFound: true });
  assert.deepEqual(await h.run(), { outcome: "deferred", attempt_id: ATTEMPT, cleanup_state: "pending", failure_code: null });
  assert.equal(h.calls.some(call => call.name === "DELETE" || call.name === "begin_document_recognition_delete"), false);
});

test("unknown DELETE records uncertainty without absence claim or automatic retry", async () => {
  const h = harness({ inspections: [{ outcome: "found", file: FILE }], removed: { outcome: "unknown" } });
  assert.equal((await h.run()).outcome, "deferred");
  assert.equal(h.calls.filter(call => call.name === "DELETE").length, 1);
  assert.equal(h.calls.filter(call => call.name === "GET").length, 1);
  assert.equal(h.calls.at(-1).args.p_observation.outcome, "unknown");
});

test("persisted delete intent replay only reconciles GET and never redispatches DELETE", async () => {
  const h = harness({ dispatch: false });
  assert.equal((await h.run()).cleanup_state, "confirmed_absent");
  assert.equal(h.calls.some(call => call.name === "DELETE"), false);
  assert.equal(h.calls.filter(call => call.name === "GET").length, 2);
});

test("lost delete-intent reply stops without provider mutation", async () => {
  const h = harness({ inspections: [{ outcome: "found", file: FILE }], lostIntent: true });
  assert.equal((await h.run()).failure_code, "workflow_unavailable");
  assert.equal(h.calls.some(call => call.name === "DELETE"), false);
});

test("DELETE404 requires a separate GET before reporting confirmed absence", async () => {
  const h = harness({ removed: { outcome: "not_found" } });
  assert.equal((await h.run()).cleanup_state, "confirmed_absent");
  assert.equal(h.calls.filter(call => call.name === "GET").length, 2);
  assert.equal(h.calls.filter(call => call.args?.p_observation?.outcome === "not_found").length, 1);
});

test("acknowledgement followed by a still-present file remains pending", async () => {
  const h = harness({ inspections: [{ outcome: "found", file: FILE }, { outcome: "found", file: FILE }] });
  assert.equal((await h.run()).cleanup_state, "pending");
  assert.equal(h.calls.filter(call => call.name === "DELETE").length, 1);
});

test("idle claim does not construct a provider or inspect a source", async () => {
  const h = harness({ claim: null });
  assert.deepEqual(await h.run(), { outcome: "idle", attempt_id: null, cleanup_state: null, failure_code: null });
  assert.equal(h.calls.length, 1);
});

test("cleanup needs actual sealed source pages and a current lease", async () => {
  for (const replacement of [{ source_pages: null }, { lease_until: new Date(NOW).toISOString() }]) {
    const h = harness({ claim: { ...CLAIM, ...replacement } });
    assert.equal((await h.run()).outcome, "unavailable");
    assert.equal(h.calls.length, 1);
  }
});
