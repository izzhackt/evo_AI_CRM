import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  DocumentRecognitionProviderError,
  bindDocumentRecognitionProviderFile,
  buildDocumentRecognitionGenerationRequest,
  createGeminiDocumentRecognition,
  maximumDocumentRecognitionCostMicros,
  parseDocumentRecognitionGeneration,
  parseDocumentRecognitionProviderConfig,
} from "../src/lib/server/gemini-document-recognition.ts";

const CONFIG = Object.freeze({ enabled: true, projectId: "synthetic-project", model: "gemini-3.7-flash",
  configVersion: "synthetic-v1", pricingPolicyVersion: "synthetic-pricing-v1", paidProjectId: "synthetic-project",
  paidEligibilityReference: "synthetic-only-no-billing-proof", perJobBudgetMicros: 100_000,
  dailyOrgBudgetMicros: 1_000_000, inputTokenCeiling: 10_000, outputTokenCeiling: 6000,
  inputMicrosPerMillionTokens: 100_000, outputMicrosPerMillionTokens: 1_000_000 });
const BYTES = Buffer.from("synthetic source bytes only");
const BINDING = Object.freeze({ name: "files/evo-10000000000040008000000000000001",
  sha256: createHash("sha256").update(BYTES).digest("hex"), bytes: BYTES.length,
  mime_type: "application/pdf", page_count: 2 });
const FILE = Object.freeze({ name: BINDING.name, uri: `https://generativelanguage.googleapis.com/v1beta/${BINDING.name}`,
  state: "ACTIVE", sha256Hash: Buffer.from(BINDING.sha256, "hex").toString("base64"),
  sizeBytes: String(BINDING.bytes), mimeType: BINDING.mime_type, expirationTime: "2026-09-15T16:00:00Z" });
const RESULT = { candidates: [{ key: "student_first_name", value: "Synthetic", source_page: 1,
  source_snippet: "Synthetic source", confidence: null }], warnings: [] };
const RESPONSE = { responseId: "synthetic-response", modelVersion: "gemini-3.7-flash-001",
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(RESULT) }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } };
const signal = () => new AbortController().signal;
function provider(overrides = {}, config = CONFIG) {
  return createGeminiDocumentRecognition("technical-test-key-not-a-secret", config, {
    createFilesClient: () => ({ upload: async () => FILE, get: async () => FILE, delete: async () => {} }),
    fetch: async url => Response.json(url.endsWith(":countTokens") ? { totalTokens: 100 } : RESPONSE), ...overrides,
  });
}
async function tokenReceipt(client) {
  const counted = await client.countTokens(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), signal());
  assert.equal(counted.outcome, "counted");
  return counted.receipt;
}
function invalid(operation, code) {
  assert.throws(operation, error => error instanceof DocumentRecognitionProviderError && error.code === code
    && error.message === "Document recognition provider operation is unavailable");
}

test("configuration has explicit paid-project binding, model, pricing and budgets, no defaults", () => {
  assert.deepEqual(parseDocumentRecognitionProviderConfig(CONFIG), CONFIG);
  assert.equal(maximumDocumentRecognitionCostMicros(CONFIG), 7000);
  for (const change of [{ enabled: false }, { projectId: "" }, { paidProjectId: "different" },
    { paidEligibilityReference: "" }, { model: "gemini-latest" }, { perJobBudgetMicros: 1 },
    { dailyOrgBudgetMicros: 1 }, { outputTokenCeiling: 6001 }, { inputTokenCeiling: 1.5 },
    { inputMicrosPerMillionTokens: 0 }, { pricingPolicyVersion: "" }, { additional: true }]) {
    invalid(() => parseDocumentRecognitionProviderConfig({ ...CONFIG, ...change }), "provider_not_configured");
  }
  invalid(() => createGeminiDocumentRecognition("", CONFIG), "provider_not_configured");
});

test("file metadata binds exact caller-persisted resource, bytes, MIME and SHA256", () => {
  const file = bindDocumentRecognitionProviderFile(FILE, BINDING);
  assert.equal(file.sha256, BINDING.sha256);
  assert.equal(file.bytes, BYTES.length);
  assert.ok(Object.isFrozen(file));
  for (const change of [{ name: "files/different" }, { sizeBytes: "1" }, { sha256Hash: "wrong" },
    { mimeType: "image/png" }, { uri: "https://example.com/file" }, { state: "UNKNOWN" }]) {
    invalid(() => bindDocumentRecognitionProviderFile({ ...FILE, ...change }, BINDING), "invalid_result");
  }
});

test("wire generation uses exact source and model-specific schema without tools or inference settings", () => {
  const body = buildDocumentRecognitionGenerationRequest(BINDING, CONFIG);
  assert.equal(body.store, false);
  assert.equal(body.generationConfig.maxOutputTokens, 6000);
  assert.equal(body.generationConfig.responseFormat.text.mimeType, "application/json");
  assert.equal(body.generationConfig.responseFormat.text.schema.properties.candidates.items.properties.key.enum.length, 61);
  assert.deepEqual(body.contents[0].parts, [{ fileData: { mimeType: BINDING.mime_type, fileUri: FILE.uri } }]);
  for (const key of ["tools", "cachedContent", "temperature", "candidateCount"]) assert.equal(key in body, false);
  assert.match(body.systemInstruction.parts[0].text, /never instructions/);
});

test("generation parser preserves actual response identity, usage and source proposals", () => {
  const parsed = parseDocumentRecognitionGeneration(RESPONSE, BINDING);
  assert.deepEqual(parsed.result, RESULT);
  assert.deepEqual(parsed.usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  for (const change of [{ responseId: "" }, { modelVersion: "" }, { candidates: [] },
    { candidates: [{ ...RESPONSE.candidates[0], finishReason: "MAX_TOKENS" }] },
    { usageMetadata: { promptTokenCount: -1, candidatesTokenCount: 50, totalTokenCount: 150 } },
    { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } }] }]) {
    invalid(() => parseDocumentRecognitionGeneration({ ...RESPONSE, ...change }, BINDING), "invalid_result");
  }
});

test("upload dispatches exact verified bytes once with retries disabled and neutral display name", async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = provider({ createFilesClient: () => ({
    async upload(request) {
      calls++;
      assert.equal(request.config.name, BINDING.name);
      assert.equal(request.config.mimeType, BINDING.mime_type);
      assert.equal(request.config.httpOptions.retryOptions.attempts, 1);
      assert.equal(request.config.abortSignal, controller.signal);
      assert.equal(request.config.displayName, "EVO document extraction");
      assert.deepEqual(Buffer.from(await request.file.arrayBuffer()), BYTES);
      return FILE;
    }, get: async () => FILE, delete: async () => {},
  }) });
  assert.equal((await client.upload(BINDING, BYTES, controller.signal)).outcome, "uploaded");
  assert.equal(calls, 1);
  await assert.rejects(() => client.upload(BINDING, Buffer.from("different"), signal()), { code: "document_not_eligible" });
  assert.equal(calls, 1);
});

test("lost upload reply is unknown; GET404 and DELETE acknowledgement do not claim completed cleanup", async () => {
  let uploads = 0;
  const client = provider({ createFilesClient: () => ({
    upload: async () => { uploads++; throw new Error("private transport detail"); },
    get: async () => { throw Object.assign(new Error("private provider detail"), { status: 404 }); },
    delete: async () => {},
  }) });
  assert.deepEqual(await client.upload(BINDING, BYTES, signal()), { outcome: "upload_unknown" });
  assert.deepEqual(await client.inspect(BINDING, signal()), { outcome: "not_found" });
  assert.deepEqual(await client.remove(BINDING, signal()), { outcome: "acknowledged" });
  assert.equal(uploads, 1);
});

test("metadata mismatch and denied provider-file access remain unknown, never absence", async () => {
  const mismatch = provider({ createFilesClient: () => ({ upload: async () => FILE,
    get: async () => ({ ...FILE, name: "files/another" }), delete: async () => { throw { status: 403 }; } }) });
  assert.deepEqual(await mismatch.inspect(BINDING, signal()), { outcome: "unknown" });
  assert.deepEqual(await mismatch.remove(BINDING, signal()), { outcome: "unknown" });
});

test("serialized REST boundary sends one generation after count with no redirects or key in URL", async () => {
  let calls = 0;
  const client = provider({ fetch: async (url, options) => {
    if (url.endsWith(":countTokens")) return Response.json({ totalTokens: 100 });
    calls++;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers["x-goog-api-key"], "technical-test-key-not-a-secret");
    assert.deepEqual(JSON.parse(options.body), buildDocumentRecognitionGenerationRequest(BINDING, CONFIG));
    return Response.json(RESPONSE);
  } });
  const persistedReceipt = JSON.parse(JSON.stringify(await tokenReceipt(client)));
  const generated = await client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), persistedReceipt, signal());
  assert.equal(generated.outcome, "generated");
  assert.deepEqual(generated.result, RESULT);
  assert.equal(calls, 1);
});

test("timeout, server errors and unknown replies never trigger a second generation", async () => {
  for (const behavior of [async () => { throw new Error("private network detail"); },
    async () => new Response("private server detail", { status: 500 }), async () => new Response("", { status: 408 })]) {
    let calls = 0;
    const client = provider({ fetch: async (...args) => {
      if (args[0].endsWith(":countTokens")) return Response.json({ totalTokens: 100 });
      calls++; return behavior(...args);
    } });
    assert.deepEqual(await client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), await tokenReceipt(client), signal()), { outcome: "generation_unknown" });
    assert.equal(calls, 1);
  }
});

test("known rejection and bounded invalid responses are explicit without raw provider text", async () => {
  for (const [response, outcome] of [[new Response("private rejected text", { status: 403 }), "provider_rejected"],
    [new Response("not JSON"), "invalid_result"], [Response.json({ ...RESPONSE, candidates: [] }), "invalid_result"],
    [new Response("x".repeat(512 * 1024 + 1)), "invalid_result"]]) {
    const client = provider({ fetch: async url => url.endsWith(":countTokens") ? Response.json({ totalTokens: 100 }) : response });
    assert.deepEqual(await client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), await tokenReceipt(client), signal()), { outcome });
  }
});

test("non-active exact source and already-aborted requests do not dispatch", async () => {
  let calls = 0;
  const client = provider({ fetch: async () => { calls++; return Response.json(RESPONSE); } });
  const file = bindDocumentRecognitionProviderFile({ ...FILE, state: "PROCESSING" }, BINDING);
  await assert.rejects(() => client.countTokens(BINDING, file, signal()), { code: "document_not_eligible" });
  await assert.rejects(() => client.generate(BINDING, file, null, signal()), { code: "document_not_eligible" });
  const receipt = await tokenReceipt(provider());
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => client.countTokens(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), controller.signal));
  await assert.rejects(() => client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), receipt, controller.signal));
  assert.equal(calls, 0);
});

test("full-request count produces a serializable exact-model/body receipt", async () => {
  const requests = [];
  const client = provider({ fetch: async (url, options) => {
    requests.push({ url, options });
    return Response.json({ totalTokens: 100 });
  } });
  const counted = await client.countTokens(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), signal());
  assert.equal(counted.outcome, "counted");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:countTokens");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.redirect, "error");
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.equal(requests[0].options.headers["x-goog-api-key"], "technical-test-key-not-a-secret");
  const body = buildDocumentRecognitionGenerationRequest(BINDING, CONFIG);
  assert.deepEqual(JSON.parse(requests[0].options.body), { generateContentRequest: { model: `models/${CONFIG.model}`, ...body } });
  assert.deepEqual(JSON.parse(JSON.stringify(counted.receipt)), {
    model: CONFIG.model,
    request_sha256: createHash("sha256").update(`models/${CONFIG.model}\n${JSON.stringify(body)}`).digest("hex"),
    config_sha256: createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.keys(CONFIG).sort().map(key => [key, CONFIG[key]])))).digest("hex"),
    input_tokens: 100,
  });
});

test("generation requires a counted receipt before any dispatch", async () => {
  let calls = 0;
  const client = provider({ fetch: async () => { calls++; return Response.json(RESPONSE); } });
  await assert.rejects(() => client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), null, signal()),
    { code: "token_count_required" });
  assert.equal(calls, 0);
});

test("input ceiling is inclusive; excess input yields no generation receipt", async () => {
  for (const totalTokens of [CONFIG.inputTokenCeiling, CONFIG.inputTokenCeiling + 1]) {
    const requests = [];
    const client = provider({ fetch: async url => {
      requests.push(url);
      return Response.json(url.endsWith(":countTokens") ? { totalTokens } : RESPONSE);
    } });
    const counted = await client.countTokens(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), signal());
    if (totalTokens === CONFIG.inputTokenCeiling) {
      assert.equal(counted.outcome, "counted");
      assert.equal(counted.receipt.input_tokens, totalTokens);
      assert.equal((await client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), counted.receipt, signal())).outcome, "generated");
      assert.equal(requests.filter(url => url.endsWith(":generateContent")).length, 1);
    } else {
      assert.deepEqual(counted, { outcome: "input_limit_exceeded" });
      await assert.rejects(() => client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), counted.receipt, signal()), { code: "token_count_required" });
      assert.equal(requests.length, 1);
    }
  }
});

test("unknown or invalid counts and explicit rejection cannot authorize generation", async () => {
  const cases = [
    [async () => { throw new Error("synthetic connection failure"); }, "token_count_unknown"],
    [async () => new Response("", { status: 500 }), "token_count_unknown"],
    [async () => new Response("", { status: 408 }), "token_count_unknown"],
    [async () => new Response("", { status: 403 }), "provider_rejected"],
    [async () => new Response("not JSON"), "token_count_unknown"],
    [async () => Response.json({}), "token_count_unknown"],
    [async () => Response.json({ totalTokens: "100" }), "token_count_unknown"],
    [async () => Response.json({ totalTokens: 1.5 }), "token_count_unknown"],
    [async () => new Response("x".repeat(16 * 1024 + 1)), "token_count_unknown"],
  ];
  for (const [respond, outcome] of cases) {
    let calls = 0;
    const client = provider({ fetch: async () => { calls++; return respond(); } });
    const counted = await client.countTokens(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), signal());
    assert.deepEqual(counted, { outcome });
    await assert.rejects(() => client.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), counted.receipt, signal()), { code: "token_count_required" });
    assert.equal(calls, 1);
  }
});

test("a changed source, model or configuration needs its own count receipt", async () => {
  const receipt = await tokenReceipt(provider());
  const otherBinding = { ...BINDING, name: "files/evo-10000000000040008000000000000002" };
  const otherFile = { ...FILE, name: otherBinding.name, uri: `https://generativelanguage.googleapis.com/v1beta/${otherBinding.name}` };
  const scenarios = [
    [CONFIG, otherBinding, otherFile],
    [{ ...CONFIG, model: "gemini-3.7-flash-001" }, BINDING, FILE],
    [{ ...CONFIG, outputTokenCeiling: 5000 }, BINDING, FILE],
    [{ ...CONFIG, inputTokenCeiling: 50 }, BINDING, FILE],
    [{ ...CONFIG, configVersion: "synthetic-v2" }, BINDING, FILE],
    [{ ...CONFIG, pricingPolicyVersion: "synthetic-pricing-v2" }, BINDING, FILE],
    [{ ...CONFIG, projectId: "synthetic-other", paidProjectId: "synthetic-other" }, BINDING, FILE],
  ];
  for (const [config, binding, file] of scenarios) {
    let calls = 0;
    const client = provider({ fetch: async () => { calls++; return Response.json(RESPONSE); } }, config);
    await assert.rejects(() => client.generate(binding, bindDocumentRecognitionProviderFile(file, binding), receipt, signal()), { code: "token_count_required" });
    assert.equal(calls, 0);
  }
});

test("receipt survives a reconstructed client and equivalent reordered configuration", async () => {
  const receipt = JSON.parse(JSON.stringify(await tokenReceipt(provider())));
  const reorderedConfig = Object.fromEntries(Object.entries(CONFIG).reverse());
  const restartedClient = provider({}, reorderedConfig);
  assert.deepEqual(await tokenReceipt(restartedClient), receipt);
  assert.equal((await restartedClient.generate(BINDING, bindDocumentRecognitionProviderFile(FILE, BINDING), receipt, signal())).outcome, "generated");
});
