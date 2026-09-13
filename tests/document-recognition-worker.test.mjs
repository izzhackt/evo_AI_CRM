import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalDocumentRecognitionFingerprint } from "../src/lib/document-recognition.ts";
import { runDocumentRecognitionProcessingOnce } from "../src/lib/server/document-recognition-worker.ts";
import { DocumentRecognitionSourceError } from "../src/lib/server/document-recognition-source.ts";
import { buildDocumentRecognitionGenerationRequest, createGeminiDocumentRecognition,
  maximumDocumentRecognitionCostMicros, parseDocumentRecognitionProviderConfig } from "../src/lib/server/gemini-document-recognition.ts";

// Unit orchestration boundaries only. Source bytes, inspector results and RPC/
// provider observations below are synthetic; no Auth, DB, parser, Storage or
// paid provider acceptance is claimed. The worker, claim/fingerprint/config
// validators and Gemini transport/result normalizers are the actual modules.
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
const NOW = Date.parse("2026-09-13T16:00:00Z");
const BYTES = Buffer.from("%PDF-1.4\nSynthetic worker unit boundary, not a parser fixture\n");
const CONFIG = parseDocumentRecognitionProviderConfig({ enabled: true, projectId: "synthetic-project", model: "gemini-3.7-flash",
  configVersion: "synthetic-v1", pricingPolicyVersion: "synthetic-pricing-v1", paidProjectId: "synthetic-project",
  paidEligibilityReference: "synthetic-only-no-billing-proof", perJobBudgetMicros: 100_000, dailyOrgBudgetMicros: 1_000_000,
  inputTokenCeiling: 10_000, outputTokenCeiling: 6000, inputMicrosPerMillionTokens: 100_000, outputMicrosPerMillionTokens: 1_000_000 });
const IDENTITY = Object.freeze({
  organization_id: id(1), student_case_id: id(2), student_profile_id: id(3), source_document_slot_id: id(4), source_version_id: id(5),
  source_sha256: sha(BYTES), source_bytes: BYTES.length, source_mime: "application/pdf", actor_auth_user_id: id(6), actor_membership_id: id(7),
  purpose: "student_profile", extraction_mode: "student_profile_fields", registry_version: "evo-profile-61-v1", schema_version: 1,
  prompt_policy_version: "extract-v1", config_version: CONFIG.configVersion, provider_project_id: CONFIG.projectId, model: CONFIG.model,
  expected_profile_revision: 7, retry_of_job_id: null,
});
const BINDING = Object.freeze({ name: `files/evo-${id(9).replaceAll("-", "")}`, sha256: sha(BYTES), bytes: BYTES.length, mime_type: "application/pdf", page_count: 2 });
const FILE = Object.freeze({ name: BINDING.name, uri: `https://generativelanguage.googleapis.com/v1beta/${BINDING.name}`,
  state: "ACTIVE", sha256Hash: Buffer.from(BINDING.sha256, "hex").toString("base64"), sizeBytes: String(BINDING.bytes),
  mimeType: BINDING.mime_type, expirationTime: "2026-09-15T16:00:00Z" });
const EXTRACTED = Object.freeze({ candidates: [{ key: "student_first_name", value: "Synthetic", source_page: 2, source_snippet: "Synthetic", confidence: null }], warnings: [] });
const RESPONSE = { responseId: "synthetic-response", modelVersion: "gemini-3.7-flash-001",
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(EXTRACTED) }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } };
const COUNT_RECEIPT = Object.freeze({ model: CONFIG.model, input_tokens: 100,
  request_sha256: sha(`models/${CONFIG.model}\n${JSON.stringify(buildDocumentRecognitionGenerationRequest(BINDING, CONFIG))}`),
  config_sha256: sha(canonical(CONFIG)) });
const processingHash = sha(canonicalDocumentRecognitionFingerprint({ ...IDENTITY, source_pages: 2 }));

function initialClaim(state = "preflight", options = {}) {
  const sealed = state !== "preflight";
  return {
    job_id: id(8), attempt_id: id(9), organization_id: id(1), claim_token: id(10), lease_until: new Date(NOW + 90_000).toISOString(),
    stage: state === "preflight" ? "claimed" : state, request_identity: { ...IDENTITY },
    request_fingerprint: sha(canonical({ ...IDENTITY, fingerprint_version: "evo-document-recognition-enqueue-v1", config_sha256: sha(canonical(CONFIG)) })),
    config: { ...CONFIG }, reserved_cost_micros: maximumDocumentRecognitionCostMicros(CONFIG),
    source_pages: sealed ? 2 : null, processing_fingerprint: sealed ? processingHash : null, state,
    resource_name: sealed ? BINDING.name : null, token_count_receipt: options.counted ? COUNT_RECEIPT : null,
    source_preflight_policy_version: sealed ? "document-source-v1" : null,
    provider_file_state: sealed ? "ACTIVE" : null, provider_observation_count: sealed ? options.observations ?? 1 : 0,
  };
}

function harness(options = {}) {
  let claim = initialClaim(options.state, options);
  const events = [];
  const rpcCalls = [];
  let uploadIntent = false;
  let generationIntent = false;
  const receipt = state => ({ job_id: id(8), state, replayed: false });
  const current = () => structuredClone(claim);
  const dependencies = {
    now: () => NOW,
    pause: async (_milliseconds, signal) => { signal.throwIfAborted(); events.push("pause"); },
    async loadSource(identity, fence, { signal }) {
      signal.throwIfAborted(); events.push("source");
      assert.deepEqual(identity, { attempt_id: id(9), job_id: id(8), organization_id: id(1), student_case_id: id(2), document_slot_id: id(4),
        source_version_id: id(5), source_sha256: sha(BYTES), source_bytes: BYTES.length, source_mime: "application/pdf" });
      assert.equal(fence, id(10));
      if (options.sourceError) throw new DocumentRecognitionSourceError(options.sourceError);
      return { bytes: BYTES, accessEventId: id(11) };
    },
    async inspectSource(input, { signal }) {
      signal.throwIfAborted(); events.push("inspector");
      assert.deepEqual(input, { bytes: BYTES, mimeType: "application/pdf", expectedSha256: sha(BYTES) });
      return options.inspection ?? { status: "verified", sha256: sha(BYTES), byteLength: BYTES.length,
        mimeType: "application/pdf", pageCount: 2, policyVersion: "document-source-v1" };
    },
    providerFor(config) {
      events.push("provider:create"); assert.deepEqual(config, CONFIG);
      return createGeminiDocumentRecognition("synthetic-unit-key-not-a-secret", config, {
        createFilesClient: () => ({
          async upload(input) {
            events.push("provider:upload"); assert.equal(uploadIntent, true);
            assert.equal(input.config.name, BINDING.name);
            assert.deepEqual(Buffer.from(await input.file.arrayBuffer()), BYTES);
            return FILE;
          },
          async get(input) { events.push("provider:inspect"); assert.equal(input.name, BINDING.name); return FILE; },
          async delete() { throw new Error("Processing does not delete provider files"); },
        }),
        async fetch(url, input) {
          if (url.endsWith(":countTokens")) {
            events.push("provider:count"); return Response.json({ totalTokens: 100 });
          }
          events.push("provider:generate"); assert.equal(generationIntent, true);
          assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`);
          assert.deepEqual(JSON.parse(input.body), buildDocumentRecognitionGenerationRequest(BINDING, CONFIG));
          if (options.generationUnknown) throw new TypeError("Synthetic lost generation response");
          return Response.json(RESPONSE);
        },
      });
    },
    async rpc(name, args, signal) {
      signal.throwIfAborted(); events.push(name); rpcCalls.push({ name, args: structuredClone(args) });
      if (name === "claim_document_recognition") {
        assert.deepEqual(args, { p_worker_id: "synthetic-unit-worker" });
        return options.idle || ["generation_unknown", "review_ready", "failed"].includes(claim.state) ? null : current();
      }
      assert.equal(args.p_attempt_id, id(9)); assert.equal(args.p_claim_token, id(10));
      if (name === "seal_document_recognition_preflight") {
        assert.deepEqual(args, { p_attempt_id: id(9), p_claim_token: id(10), p_source_sha256: sha(BYTES), p_source_bytes: BYTES.length,
          p_source_mime: "application/pdf", p_source_pages: 2, p_processing_fingerprint: processingHash,
          p_preflight_policy_version: "document-source-v1" });
        claim = { ...claim, source_pages: 2, processing_fingerprint: processingHash, stage: "source_sealed", source_preflight_policy_version: "document-source-v1" };
        return current();
      }
      if (name === "begin_document_recognition_upload") {
        uploadIntent = true; claim = { ...claim, state: "uploading", stage: "upload_intent", resource_name: BINDING.name };
        return { dispatch: options.uploadReplay !== true, resource_name: BINDING.name };
      }
      if (name === "observe_document_recognition_file") {
        assert.deepEqual(args.p_observation, { outcome: "present", resource_name: BINDING.name, state: "ACTIVE",
          sha256: sha(BYTES), bytes: BYTES.length, mime_type: "application/pdf" });
        assert.ok(claim.provider_observation_count < 5, "A sixth provider observation is not allowed");
        claim = { ...claim, state: "file_processing", stage: "file_processing", provider_file_state: "ACTIVE", provider_observation_count: claim.provider_observation_count + 1 };
        return current();
      }
      if (name === "record_document_recognition_token_count") {
        assert.deepEqual(args.p_receipt, COUNT_RECEIPT); claim = { ...claim, stage: "token_counted", token_count_receipt: COUNT_RECEIPT }; return current();
      }
      if (name === "begin_document_recognition_generation") {
        assert.deepEqual(args.p_receipt, COUNT_RECEIPT); generationIntent = true;
        if (!options.generationReplay) claim = { ...claim, state: "generating", stage: "generation_intent" };
        if (options.lostGenerationIntent) throw new TypeError("Synthetic lost committed intent response");
        return { dispatch: options.generationReplay !== true };
      }
      if (name === "record_document_recognition_result") {
        assert.deepEqual(JSON.parse(args.p_result_text), EXTRACTED); assert.equal(args.p_result_sha256, sha(args.p_result_text));
        assert.equal(args.p_response_id, RESPONSE.responseId); assert.equal(args.p_model_version, RESPONSE.modelVersion);
        assert.deepEqual(args.p_usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
        claim = { ...claim, state: "result_saved", stage: "result_saved" };
        if (options.lostResultReceipt) throw new TypeError("Synthetic lost committed result receipt");
        return receipt("result_saved");
      }
      if (name === "publish_document_recognition_proposals") { claim = { ...claim, state: "review_ready", stage: "review_ready" }; return receipt("review_ready"); }
      if (name === "finish_document_recognition_preflight" || name === "finish_document_recognition") {
        claim = { ...claim, state: args.p_failure_code === "generation_unknown" ? "generation_unknown" : "failed" };
        return receipt(claim.state);
      }
      throw new Error(`Unexpected synthetic RPC ${name}`);
    },
  };
  return { events, rpcCalls, dependencies, current,
    run: () => runDocumentRecognitionProcessingOnce("synthetic-unit-worker", dependencies, new AbortController().signal) };
}

test("processing persists each intent in order and publishes normalized proposals only after durable result", async () => {
  const run = harness();
  assert.deepEqual(await run.run(), { outcome: "settled", job_id: id(8), state: "review_ready", failure_code: null });
  assert.deepEqual(run.events, ["claim_document_recognition", "provider:create", "source", "inspector", "seal_document_recognition_preflight",
    "begin_document_recognition_upload", "provider:upload", "observe_document_recognition_file", "provider:count",
    "record_document_recognition_token_count", "begin_document_recognition_generation", "provider:generate",
    "record_document_recognition_result", "publish_document_recognition_proposals"]);
});

test("unknown generation settles once without result publication or an automatic second provider call", async () => {
  const run = harness({ generationUnknown: true });
  assert.equal((await run.run()).state, "generation_unknown");
  assert.equal(run.rpcCalls.at(-1).args.p_failure_code, "generation_unknown");
  assert.equal(run.events.filter(name => name === "provider:generate").length, 1);
  assert.equal(run.events.includes("record_document_recognition_result"), false);
  assert.equal(run.events.includes("publish_document_recognition_proposals"), false);
  assert.equal((await run.run()).outcome, "idle");
  assert.equal(run.events.filter(name => name === "provider:generate").length, 1);
});

test("result_saved recovery publishes without constructing a provider or reading source bytes", async () => {
  const run = harness({ state: "result_saved", counted: true });
  assert.equal((await run.run()).state, "review_ready");
  assert.deepEqual(run.events, ["claim_document_recognition", "publish_document_recognition_proposals"]);
});

test("persisted ACTIVE observation five resumes without another inspect or sixth observe", async () => {
  const run = harness({ state: "file_processing", observations: 5 });
  assert.equal((await run.run()).state, "review_ready");
  assert.equal(run.current().provider_observation_count, 5);
  for (const name of ["provider:inspect", "observe_document_recognition_file", "source", "inspector", "provider:upload"]) assert.equal(run.events.includes(name), false, name);
  assert.equal(run.events.filter(name => name === "provider:generate").length, 1);
});

test("a saved matching count receipt avoids counting again and generation replay never dispatches", async () => {
  const run = harness({ state: "file_processing", observations: 5, counted: true, generationReplay: true });
  assert.equal((await run.run()).outcome, "deferred");
  assert.deepEqual(run.events, ["claim_document_recognition", "provider:create", "begin_document_recognition_generation"]);
});

test("inspector rejection settles before upload without fabricated page proof", async () => {
  for (const code of ["document_not_eligible", "source_unavailable"]) {
    const run = harness({ inspection: { status: "rejected", code } });
    assert.equal((await run.run()).state, "failed");
    assert.equal(run.rpcCalls.at(-1).name, "finish_document_recognition_preflight");
    assert.equal(run.rpcCalls.at(-1).args.p_failure_code, code);
    assert.equal(run.current().source_pages, null);
    assert.equal(run.events.some(name => ["seal_document_recognition_preflight", "begin_document_recognition_upload", "provider:upload", "provider:generate"].includes(name)), false);
  }
});

test("a source read rejection is settled before inspecting or uploading", async () => {
  const run = harness({ sourceError: "source_changed" });
  assert.equal((await run.run()).state, "failed");
  assert.equal(run.rpcCalls.at(-1).args.p_failure_code, "source_changed");
  assert.equal(run.events.includes("inspector"), false); assert.equal(run.events.includes("provider:upload"), false);
});

test("upload intent replay reconciles exact provider resource instead of uploading again", async () => {
  const run = harness({ uploadReplay: true });
  assert.equal((await run.run()).state, "review_ready");
  assert.equal(run.events.includes("provider:upload"), false);
  assert.equal(run.events.filter(name => name === "provider:inspect").length, 1);
});

test("lost committed generation intent defers and does not call the provider", async () => {
  const run = harness({ state: "file_processing", counted: true, lostGenerationIntent: true });
  const result = await run.run();
  assert.equal(result.outcome, "deferred"); assert.equal(result.failure_code, "workflow_unavailable");
  assert.equal(run.current().state, "generating"); assert.equal(run.events.includes("provider:generate"), false);
});

test("lost committed result receipt recovers by publication only on the next fenced claim", async () => {
  const run = harness({ lostResultReceipt: true });
  assert.equal((await run.run()).outcome, "deferred");
  assert.equal(run.current().state, "result_saved");
  const before = run.events.length;
  assert.equal((await run.run()).state, "review_ready");
  assert.deepEqual(run.events.slice(before), ["claim_document_recognition", "publish_document_recognition_proposals"]);
  assert.equal(run.events.filter(name => name === "provider:generate").length, 1);
});

test("empty queue returns idle without source, inspector or provider work", async () => {
  const run = harness({ idle: true });
  assert.deepEqual(await run.run(), { outcome: "idle", job_id: null, state: null, failure_code: null });
  assert.deepEqual(run.events, ["claim_document_recognition"]);
});
