import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as kinds from "../src/lib/document-classification.ts";
import { sortingRequestId } from "../src/lib/document-sorting-ids.ts";
import * as sortingView from "../src/components/staff/profile/amo-sorting-view.ts";
import {
  buildDocumentClassificationRequest, classificationCostMicros, createGeminiDocumentClassifier, parseDocumentClassificationResponse,
} from "../src/lib/server/document-classification-gemini.ts";
import {
  parseDocumentClassificationArguments, runDocumentClassification,
} from "../src/lib/server/document-classification-batch.ts";
import { runDocumentClassificationCli } from "../scripts/maintenance/run-document-classification.ts";

// Разбор файлов из amoCRM (миграция 333): контракт видов, провайдер, пакетная команда с подставными зависимостями (никакого живого
// провайдера, базы и файлов: данные выдуманы) и настоящий рендер вкладки (tests/e2e/amo-sorting-static-render.cjs --json).
const ORG = "11111111-1111-4111-8111-111111111111";
const uuid = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const CONFIG = { enabled: true, projectId: "synthetic-project", model: "gemini-3.1-flash", configVersion: "synthetic-v1",
  pricingPolicyVersion: "synthetic-price-v1", paidProjectId: "synthetic-project", paidEligibilityReference: "synthetic-no-billing-proof",
  perJobBudgetMicros: 10000, dailyOrgBudgetMicros: 100000, inputTokenCeiling: 10000, outputTokenCeiling: 6000,
  inputMicrosPerMillionTokens: 100000, outputMicrosPerMillionTokens: 200000 };

test("failure codes: only terminal refusals are stored, and they match the SQL check", () => {
  const sql = readFileSync(new URL("../supabase/migrations/333_platform_document_classification.sql", import.meta.url), "utf8");
  const listed = [...sql.match(/failure_code IS NULL OR failure_code IN \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(listed, [...kinds.DOCUMENT_CLASSIFICATION_FAILURES]);
  assert.equal(listed.includes("provider_unavailable"), false);
});

test("kinds: the closed list matches the SQL check, labels are Russian, other is never a checklist item", () => {
  const sql = readFileSync(new URL("../supabase/migrations/333_platform_document_classification.sql", import.meta.url), "utf8");
  const listed = (pattern) => [...pattern.exec(sql)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  const suggestionKinds = listed(/kind_key IS NULL OR kind_key IN \(([^)]*)\)/);
  assert.deepEqual(suggestionKinds, [...kinds.DOCUMENT_CLASSIFICATION_KEYS]);
  const chosenKinds = listed(/chosen_kind_key TEXT NOT NULL CHECK \(chosen_kind_key IN \(([^)]*)\)/);
  assert.deepEqual(chosenKinds, kinds.DOCUMENT_KINDS.map((kind) => kind.key));
  assert.equal(kinds.isDocumentKindKey("other"), false);
  assert.ok(kinds.DOCUMENT_KINDS.every((kind) => /[А-Яа-я]/.test(kind.label)));
  assert.equal(kinds.isAmoUnsortedGroup("Из amoCRM (не разобрано)"), true);
  assert.equal(kinds.isAmoUnsortedGroup("Документы студента"), false);
});

test("confidence bands: only a confident known kind is accepted in bulk", () => {
  assert.equal(kinds.confidenceBand("passport", 0.9), "confident");
  assert.equal(kinds.confidenceBand("passport", 0.89), "possible");
  assert.equal(kinds.confidenceBand("passport", 0.59), "unknown");
  assert.equal(kinds.confidenceBand("other", 0.99), "unknown");
  assert.equal(kinds.classificationStatus("other", 0.99), "unsure");
  assert.equal(kinds.classificationStatus("photo", 0.7), "suggested");
  assert.equal(kinds.suggestionView({ kind: "passport", confidence: 0.95, status: "suggested" }).text, "Похоже на: Паспорт (уверенно)");
  assert.equal(kinds.suggestionView({ kind: "photo", confidence: 0.7, status: "suggested" }).text, "Похоже на: Фото (возможно)");
  assert.equal(kinds.suggestionView({ kind: "photo", confidence: 0.3, status: "unsure" }).text, null);
  assert.equal(kinds.acceptLabel("passport"), "Принять как Паспорт");
});

test("shapes: a model answer and a staff read are accepted only in the exact form", () => {
  assert.deepEqual(kinds.normalizeDocumentClassificationResult({ kind: "passport", confidence: 0.91234 }), { kind: "passport", confidence: 0.912 });
  for (const bad of [{ kind: "passport" }, { kind: "driving", confidence: 0.9 }, { kind: "passport", confidence: 1.2 }, { kind: "passport", confidence: 0.9, note: "x" }, null, []]) {
    assert.throws(() => kinds.normalizeDocumentClassificationResult(bad), kinds.DocumentClassificationValidationError);
  }
  const item = { document_slot_id: uuid(1), document_version_id: uuid(2), status: "suggested", kind_key: "passport", confidence: "0.950" };
  assert.equal(kinds.normalizeCaseDocumentSuggestions({ ai_allowed: true, items: [item] }).items[0].confidence, 0.95);
  assert.throws(() => kinds.normalizeCaseDocumentSuggestions({ ai_allowed: true, items: [item, item] }));
  assert.throws(() => kinds.normalizeCaseDocumentSuggestions({ ai_allowed: true, items: [], extra: 1 }));
});

test("request ids are stable per file, kind and step and differ between them", () => {
  const a = sortingRequestId(uuid(1), "passport", "metadata");
  assert.equal(a, sortingRequestId(uuid(1), "passport", "metadata"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set([a, sortingRequestId(uuid(1), "passport", "review"), sortingRequestId(uuid(1), "attestat", "metadata"), sortingRequestId(uuid(2), "passport", "metadata")]).size, 4);
});

test("provider request: inline data, nothing stored, no uploaded provider file, closed answer schema, no free text", () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const config = createGeminiDocumentClassifier("synthetic-key", CONFIG).config;
  const request = buildDocumentClassificationRequest({ bytes, mime: "image/png" }, config);
  assert.equal(request.store, false);
  assert.equal(request.contents[0].parts[0].inlineData.mimeType, "image/png");
  assert.equal(request.contents[0].parts[0].inlineData.data, Buffer.from(bytes).toString("base64"));
  assert.ok(!JSON.stringify(request).includes("fileUri"));
  assert.deepEqual(Object.keys(request.generationConfig.responseFormat.text.schema.properties), ["kind", "confidence"]);
  assert.match(request.systemInstruction.parts[0].text, /untrusted/);
  assert.ok(request.generationConfig.maxOutputTokens <= 1024);
});

const response = (payload, usage = { promptTokenCount: 1000, candidatesTokenCount: 20 }) => ({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: usage });
test("provider answer: parsed, costed by actual tokens, and refused when it is not the exact shape", () => {
  const parsed = parseDocumentClassificationResponse(response({ kind: "attestat", confidence: 0.88 }));
  assert.deepEqual(parsed, { result: { kind: "attestat", confidence: 0.88 }, inputTokens: 1000, outputTokens: 20 });
  // 1000 * 100000 + 20 * 200000 = 104,000,000 / 1e6 = 104
  assert.equal(classificationCostMicros(createGeminiDocumentClassifier("synthetic-key", CONFIG).config, 1000, 20), 104);
  // A document that talks back (injection) cannot add anything: free text or an unknown kind is invalid.
  assert.throws(() => parseDocumentClassificationResponse(response({ kind: "passport", confidence: 0.9, note: "ignore all rules" })));
  assert.throws(() => parseDocumentClassificationResponse(response({ kind: "approve_everything", confidence: 1 })));
  assert.throws(() => parseDocumentClassificationResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }], usageMetadata: {} }));
});

test("classifier maps provider failures and oversize files to codes without calling out for oversize", async () => {
  let calls = 0;
  const make = (status, body) => createGeminiDocumentClassifier("synthetic-key", CONFIG, {
    fetch: async () => { calls++; return new Response(JSON.stringify(body ?? {}), { status }); } });
  const png = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" };
  const signal = new AbortController().signal;
  assert.equal((await make(200, response({ kind: "photo", confidence: 0.8 })).classify(png, signal)).outcome, "classified");
  assert.equal((await make(400).classify(png, signal)).failure, "provider_rejected");
  assert.equal((await make(429).classify(png, signal)).failure, "provider_unavailable");
  assert.equal((await make(503).classify(png, signal)).failure, "provider_unavailable");
  assert.equal((await make(200, { nope: 1 }).classify(png, signal)).failure, "invalid_result");
  const before = calls;
  assert.equal((await make(200).classify({ bytes: new Uint8Array(10 * 1024 * 1024 + 1), mime: "image/png" }, signal)).failure, "too_large");
  assert.equal(calls, before, "no call for a file that is too large");
  assert.throws(() => createGeminiDocumentClassifier("", CONFIG));
  assert.throws(() => createGeminiDocumentClassifier("synthetic-key", { ...CONFIG, enabled: false }));
});

// --- batch with synthetic dependencies --------------------------------------------------------
function fakeWorld({ files = 5, budget = 100000, classify, consentRevokedFor = new Set(), plan = {}, revokeAfterChunk = new Set() } = {}) {
  const store = new Map();
  const calls = { rpc: [], load: 0, classify: 0, sleep: [] };
  const candidates = Array.from({ length: files }, (_v, index) => ({ student_case_id: uuid(100 + index), document_slot_id: uuid(200 + index),
    document_version_id: uuid(300 + index), sha256: "a".repeat(64), bytes: 1000, mime: "image/png", bucket_id: "platform-documents",
    object_name: `aa/${"1".repeat(62)}`, attempts: 0 }));
  const deps = {
    async rpc(name, parameters) {
      calls.rpc.push(name);
      if (name === "document_classification_plan_v1") return { to_classify_files: files, ...plan };
      if (name === "document_classification_context_v1") return { config: CONFIG, budget_left_micros: budget };
      if (name === "document_classification_candidates_v1") {
        const open = candidates.filter((candidate) => {
          if ((parameters.p_exclude ?? []).includes(candidate.document_version_id)) return false;
          const row = store.get(candidate.document_version_id);
          return !row || (row.status === "failed" && row.run !== parameters.p_run_id && row.attempts < 3);
        });
        return open.slice(0, parameters.p_limit);
      }
      if (name === "document_classification_recheck_v1") {
        const id = parameters.p_document_version_id;
        // The consent changed after the chunk was chosen: the database answers false for exactly this file.
        return !(consentRevokedFor.has(id) || revokeAfterChunk.has(id)) && !store.has(id);
      }
      if (name === "document_classification_record_v1") {
        const id = parameters.p_document_version_id;
        if (consentRevokedFor.has(id)) throw new Error("ai_consent_missing");
        const existing = store.get(id);
        if (existing && existing.status !== "failed") return { recorded: false, reason: "exists" };
        store.set(id, { status: parameters.p_status, kind: parameters.p_kind_key, run: parameters.p_run_id, attempts: (existing?.attempts ?? 0) + 1, cost: parameters.p_cost_micros });
        return { recorded: true, reason: "new" };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    async loadSource() { calls.load++; return { bytes: new Uint8Array(1000), mime: "image/png" }; },
    createClassifier() {
      return { config: createGeminiDocumentClassifier("synthetic-key", CONFIG).config, maximumCallCostMicros: 2200,
        async classify(...args) { calls.classify++; return classify ? classify(calls.classify, ...args) : { outcome: "classified", result: { kind: "passport", confidence: 0.95 }, inputTokens: 900, outputTokens: 10, costMicros: 92 }; } };
    },
    async sleep(ms) { calls.sleep.push(ms); },
  };
  return { deps, calls, store };
}
const options = (overrides = {}) => ({ organizationId: ORG, dryRun: false, onlyExplicitConsent: false, chunkSize: 2, maxFiles: 300, delayMs: 1500, runId: "run-test", ...overrides });
const signal = () => new AbortController().signal;

test("dry run: counts and a cost estimate, no source read, no provider call, no write", async () => {
  const world = fakeWorld({ files: 230 });
  const summary = await runDocumentClassification(options({ dryRun: true, chunkSize: 10 }), world.deps, signal());
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.stopped, "completed");
  assert.equal(summary.estimate.provider_calls, 230);
  assert.equal(summary.estimate.chunks, 23);
  assert.equal(summary.estimate.worst_case_cost_micros, 230 * 2200);
  assert.deepEqual(world.calls.rpc, ["document_classification_plan_v1", "document_classification_context_v1"]);
  assert.equal(world.calls.load + world.calls.classify, 0);
});

test("run: chunks, one provider call per file, a pause between calls, results stored once, bands decide the status", async () => {
  const kindsByCall = [["passport", 0.95], ["attestat", 0.7], ["photo", 0.4], ["other", 0.99], ["medical", 0.91]];
  const world = fakeWorld({ files: 5, classify: (n) => ({ outcome: "classified", result: { kind: kindsByCall[n - 1][0], confidence: kindsByCall[n - 1][1] }, inputTokens: 900, outputTokens: 10, costMicros: 92 }) });
  const summary = await runDocumentClassification(options(), world.deps, signal());
  assert.equal(summary.stopped, "completed");
  assert.equal(world.calls.classify, 5);
  assert.equal(world.calls.rpc.filter((name) => name === "document_classification_candidates_v1").length, 4, "2 + 2 + 1 then an empty chunk");
  assert.deepEqual(world.calls.sleep, [1500, 1500, 1500, 1500, 1500]);
  assert.deepEqual([summary.suggested, summary.unsure, summary.failed, summary.processed], [3, 2, 0, 5]);
  assert.equal(summary.spent_micros, 5 * 92);
  assert.deepEqual([...world.store.values()].map((row) => row.status), ["suggested", "suggested", "unsure", "unsure", "suggested"]);
});

test("re-run is idempotent: nothing is sent again and nothing stored is overwritten", async () => {
  const world = fakeWorld({ files: 3 });
  await runDocumentClassification(options(), world.deps, signal());
  const snapshot = JSON.stringify([...world.store]);
  const second = await runDocumentClassification(options({ runId: "run-two" }), world.deps, signal());
  assert.equal(second.stopped, "no_candidates");
  assert.equal(world.calls.classify, 3);
  assert.equal(JSON.stringify([...world.store]), snapshot);
});

test("consent is rechecked before EACH provider call: a file whose student declined after the chunk was chosen is never sent", async () => {
  const world = fakeWorld({ files: 3, revokeAfterChunk: new Set([uuid(301)]) });
  const order = [];
  const original = world.deps.rpc;
  world.deps.rpc = async (name, parameters, abort) => { order.push(name === "document_classification_recheck_v1" ? `recheck:${parameters.p_document_version_id}` : name); return original(name, parameters, abort); };
  const classifyOriginal = world.deps.createClassifier;
  world.deps.createClassifier = (config) => { const classifier = classifyOriginal(config); const inner = classifier.classify; classifier.classify = async (...args) => { order.push("classify"); return inner(...args); }; return classifier; };
  const summary = await runDocumentClassification(options({ chunkSize: 10 }), world.deps, signal());
  assert.equal(summary.skipped_no_consent, 1);
  assert.equal(summary.suggested, 2);
  assert.equal(world.calls.classify, 2, "the revoked file is not sent");
  assert.equal(world.store.has(uuid(301)), false);
  // Every classify is directly preceded by the recheck of a file (never a classify without it).
  order.forEach((entry, index) => { if (entry === "classify") assert.match(order[index - 1], /^recheck:/); });
  assert.equal(order.filter((entry) => entry.startsWith("recheck:")).length, 3);
});

test("a write refused for consent or a file sorted meanwhile is dropped and counted, and the file is not retried in the run", async () => {
  const world = fakeWorld({ files: 3 });
  world.deps.rpc = ((original) => async (name, parameters, abort) => {
    if (name === "document_classification_record_v1" && parameters.p_document_version_id === uuid(301)) throw new Error("ai_consent_missing");
    return original(name, parameters, abort);
  })(world.deps.rpc);
  const summary = await runDocumentClassification(options({ chunkSize: 10 }), world.deps, signal());
  assert.equal(summary.skipped_no_consent, 1);
  assert.equal(summary.suggested, 2);
  assert.equal(world.calls.classify, 3);
});

test("a run held by another run stops with run_in_progress and sends nothing", async () => {
  const world = fakeWorld({ files: 2 });
  const { DocumentClassificationBatchError } = await import("../src/lib/server/document-classification-batch.ts");
  world.deps.rpc = ((original) => async (name, parameters, abort) => {
    if (name === "document_classification_candidates_v1") throw new DocumentClassificationBatchError("run_in_progress");
    return original(name, parameters, abort);
  })(world.deps.rpc);
  await assert.rejects(runDocumentClassification(options(), world.deps, signal()), (error) => error.code === "run_in_progress");
  assert.equal(world.calls.classify, 0);
  const written = [];
  assert.equal(await runDocumentClassificationCli(["--organization-id", ORG], { write: (value) => written.push(value), createDependencies: () => world.deps }), 75);
  assert.equal(written[0].error, "run_in_progress");
});

test("limits: max files, daily budget, a provider outage, and failures are recorded and not retried in the same run", async () => {
  const capped = fakeWorld({ files: 5 });
  assert.equal((await runDocumentClassification(options({ maxFiles: 2, delayMs: 0 }), capped.deps, signal())).stopped, "max_files");
  assert.equal(capped.calls.classify, 2);
  const poor = fakeWorld({ files: 5, budget: 2250 });
  const budgeted = await runDocumentClassification(options({ delayMs: 0 }), poor.deps, signal());
  assert.equal(budgeted.stopped, "budget_exhausted");
  assert.equal(poor.calls.classify, 1, "stops when the remaining budget cannot cover one more call at the ceiling");
  // 429 / 5xx / timeouts: they stop the run after three in a row, but write NO failed row and spend NO attempt.
  const down = fakeWorld({ files: 6, classify: () => ({ outcome: "failed", failure: "provider_unavailable" }) });
  const outage = await runDocumentClassification(options({ delayMs: 0 }), down.deps, signal());
  assert.equal(outage.stopped, "provider_unavailable");
  assert.equal(down.calls.classify, 3);
  assert.equal(outage.transient_failures, 3);
  assert.equal(outage.failed, 0);
  assert.equal(down.store.size, 0, "a transient failure leaves no row");
  assert.equal(down.calls.rpc.filter((name) => name === "document_classification_record_v1").length, 0);
  // Terminal refusals are stored once as failed.
  const refused = fakeWorld({ files: 2, classify: () => ({ outcome: "failed", failure: "invalid_result" }) });
  const terminal = await runDocumentClassification(options({ delayMs: 0 }), refused.deps, signal());
  assert.equal(terminal.failed, 2);
  assert.ok([...refused.store.values()].every((row) => row.status === "failed"));
});

test("a file the provider cannot take stays on the manual path and a vanished source is a recorded failure", async () => {
  const world = fakeWorld({ files: 2 });
  let first = true;
  world.deps.loadSource = async () => { if (first) { first = false; throw new Error("source_changed"); } return { bytes: new Uint8Array(10 * 1024 * 1024 + 5), mime: "image/png" }; };
  const summary = await runDocumentClassification(options({ delayMs: 0 }), world.deps, signal());
  assert.equal(summary.failed, 2);
  assert.equal(world.calls.classify, 0, "no provider call for a missing or oversize source");
  assert.deepEqual([...world.store.values()].map((row) => row.status), ["failed", "failed"]);
});

test("arguments: strict, bounded, one organization", () => {
  const parse = (...args) => parseDocumentClassificationArguments(args, () => "run-x");
  const ok = parse("--organization-id", ORG, "--dry-run", "--chunk-size", "20", "--only-explicit-consent");
  assert.deepEqual([ok.dryRun, ok.onlyExplicitConsent, ok.chunkSize, ok.maxFiles, ok.delayMs, ok.runId], [true, true, 20, 300, 1500, "run-x"]);
  for (const bad of [[], ["--organization-id", "nope"], ["--organization-id", ORG, "--chunk-size", "51"], ["--organization-id", ORG, "--chunk-size", "0"],
    ["--organization-id", ORG, "--max-files", "1001"], ["--organization-id", ORG, "--delay-ms", "-1"], ["--organization-id", ORG, "--dry-run", "--dry-run"],
    ["--organization-id", ORG, "--unknown", "1"], ["--organization-id", ORG, "--run-id", "bad id"]]) {
    assert.throws(() => parse(...bad), (error) => error.code === "invalid_arguments", JSON.stringify(bad));
  }
});

test("command line: exit codes, numbers only in the output", async () => {
  const written = [];
  const run = (args, overrides) => runDocumentClassificationCli(args, { write: (value) => written.push(value), runId: () => "run-cli", ...overrides });
  const world = fakeWorld({ files: 1 });
  assert.equal(await run(["--organization-id", ORG, "--dry-run"], { createDependencies: () => world.deps }), 0);
  assert.equal(await run(["--organization-id", ORG], { createDependencies: () => world.deps, run: (o, d, s) => runDocumentClassification({ ...o, delayMs: 0 }, d, s) }), 0);
  assert.equal(await run(["--bogus"]), 64);
  const { DocumentClassificationBatchError } = await import("../src/lib/server/document-classification-batch.ts");
  assert.equal(await run(["--organization-id", ORG], { createDependencies: () => { throw new DocumentClassificationBatchError("provider_not_configured"); } }), 78);
  assert.equal(await run(["--organization-id", ORG], { createDependencies: () => { throw new Error("boom"); } }), 69);
  assert.equal(await run(["--organization-id", ORG], { createDependencies: () => world.deps, run: async () => ({ ...written[0], stopped: "budget_exhausted" }) }), 75);
  const text = JSON.stringify(written);
  assert.ok(!/(object_name|sha256|student_case_id|document_version_id|key)/i.test(text.replace(/"error"/g, "")), "no identifiers or secrets in the output");
});

// --- the real tab, rendered with synthetic files and actors ---------------------------------
const rendered = new Map(JSON.parse(execFileSync(process.execPath,
  [new URL("./e2e/amo-sorting-static-render.cjs", import.meta.url).pathname, "--json"], { encoding: "utf8", maxBuffer: 1 << 26 }))
  .map(({ name, html }) => [name, html]));
const count = (html, pattern) => (html.match(pattern) ?? []).length;

test("curator: thumbnails, suggestions in words, accept buttons, a bulk button with the count; only confident files are bulk", () => {
  for (const name of ["curator_ai", "curator_ai:legacy"]) {
    const html = rendered.get(name);
    assert.match(html, /Разобрать файлы из amoCRM · 6/);
    assert.equal(count(html, /data-testid="amo-sorting-card"/g), 6);
    assert.equal(count(html, /data-testid="amo-sorting-thumb"/g), 6);
    assert.match(html, /Похоже на: Паспорт \(уверенно\)/);
    assert.match(html, /Похоже на: Аттестат \/ диплом \(уверенно\)/);
    assert.match(html, /Похоже на: Фото \(возможно\)/);
    assert.match(html, /Принять как Паспорт/);
    // 1 and 2 are confident and readable; 6 is confident but has no readable preview (not downloadable) -> not in bulk; 4 is "other".
    assert.match(html, /Принять все уверенные · 2/);
    assert.equal(count(html, /data-testid="amo-sorting-none"/g), 2, "«other» and the unnamed PDF stay for a manual choice");
    assert.equal(count(html, /data-testid="amo-sorting-pick"/g), 6, "every file has the «Это» picker");
  }
});

test("admin sees the same as a curator; a preview role, a reader and a closed case get no accept buttons", () => {
  assert.equal(rendered.get("admin_ai").includes("Принять все уверенные · 2"), true);
  for (const name of ["preview_ai", "reader_ai", "curator_closed_case"]) {
    const html = rendered.get(name);
    assert.match(html, /Разобрать файлы из amoCRM · 6/, name);
    assert.equal(count(html, /amo-sorting-accept/g), 0, name);
    assert.equal(count(html, /amo-sorting-pick/g), 0, name);
    assert.equal(html.includes("Принять все уверенные"), false, name);
    assert.equal(count(html, /data-testid="amo-sorting-thumb"/g), 6, `${name}: they can still see the files`);
  }
});

test("a student without consent: no suggestion at all (even if one leaked), manual picker, and the reason is said", () => {
  for (const name of ["curator_no_consent", "curator_no_consent_leak"]) {
    const html = rendered.get(name);
    assert.match(html, /data-mode="manual"/);
    assert.match(html, /Сейчас ИИ для этого студента отключён: файлы не отправлялись/);
    assert.equal(html.includes("Похоже на"), false, name);
    assert.equal(html.includes("Принять все уверенные"), false, name);
    assert.equal(count(html, /data-testid="amo-sorting-pick"/g), 6, name);
    assert.equal(count(html, /data-testid="amo-sorting-thumb"/g), 6, name);
  }
  const unavailable = rendered.get("curator_unavailable");
  assert.match(unavailable, /data-mode="unavailable"/);
  assert.equal(unavailable.includes("Похоже на"), false);
});

test("nothing to sort: no panel; accepted and ordinary groups never enter it", () => {
  assert.equal(rendered.get("none_to_sort").includes("amo-document-sorting"), false);
  assert.equal(sortingView.bulkConfirmText(1).startsWith("Принять 1 файл "), true);
  assert.equal(sortingView.bulkConfirmText(3).startsWith("Принять 3 файла "), true);
  assert.equal(sortingView.bulkConfirmText(12).startsWith("Принять 12 файлов "), true);
  assert.equal(sortingView.bulkConfirmText(21).startsWith("Принять 21 файл "), true);
});

test("the page wiring: server action, source and batch never import the kit, and the pages stay clean", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const actions = read("../src/lib/platform-document-sorting-actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /change_document_slot_metadata/);
  assert.match(actions, /review_document_version/);
  assert.match(actions, /staff_resolve_document_suggestion_v1/);
  assert.equal(/ai_agent_student_ai_allowed|document_classification_record_v1/.test(actions), false, "the staff action never writes a suggestion nor decides consent");
  const exportsOfUseServer = [...actions.matchAll(/^export (async function|function|const) (\w+)/gm)].map((match) => match[1]);
  assert.ok(exportsOfUseServer.every((kind) => kind === "async function"), "a use-server file exports only async functions");
  for (const file of ["../src/components/staff/profile/AmoDocumentSorting.tsx", "../src/components/staff/profile/Documents.tsx"]) {
    assert.equal(/@\/components\/kit/.test(read(file)), false, file);
  }
});

test("accept: a same-name item (empty or not) blocks, the decision write is retried once and reported, bulk is chunked", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const actions = read("../src/lib/platform-document-sorting-actions.ts");
  assert.match(actions, /item\.requirementLabel === label\)\) return "target_exists"/, "any same-label item blocks, not only an empty one");
  assert.equal(/requirementLabel === label && item\.currentVersionId === null/.test(actions), false);
  assert.match(actions, /attempt < 2/, "the decision write is tried twice");
  assert.match(actions, /decision_not_recorded/);
  assert.match(actions, /ids\.length > MAX_BULK_ACCEPT/);
  const ui = read("../src/components/staff/profile/AmoDocumentSorting.tsx");
  assert.match(ui, /start \+= MAX_BULK_ACCEPT/);
  assert.match(ui, /Принято \$\{accepted\} из \$\{ids\.length\}…/, "progress is shown");
  assert.ok(ui.indexOf("refresh();", ui.indexOf("catch { stopped = OUTCOME_TEXT.unavailable; }")) > ui.indexOf("catch { stopped = OUTCOME_TEXT.unavailable; }"), "the panel is refreshed after a failure in the middle too");
  assert.match(ui, /Файл принят, но отметка о решении не записалась/);
});

// Виды документов дела (миграции 348-349, решение владельца 08.11.2026): «Договор», «Чек об оплате», «Не нужное», «Другое…».
test("staff kinds: the AI list is unchanged, the manual extras are contract / other / not_needed, and the 348 check lists exactly them", () => {
  const sql = readFileSync(new URL("../supabase/migrations/348_platform_document_finance_kinds.sql", import.meta.url), "utf8");
  const listed = (pattern) => [...sql.match(pattern)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  const expectedKinds = [...kinds.DOCUMENT_KINDS.map((kind) => kind.key), ...kinds.STAFF_EXTRA_KINDS.map((kind) => kind.key)];
  assert.deepEqual(listed(/ADD CONSTRAINT document_classification_resolutions_chosen_kind_check CHECK \(chosen_kind_key IN \(([^)]*)\)/), [
    ...kinds.DOCUMENT_KINDS.map((kind) => kind.key), "contract", "other", "not_needed"]);
  assert.equal(expectedKinds.length, 16);
  const resolveList = new Set([...sql.match(/p_kind_key NOT IN \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
  const accepted = new Set(listed(/ADD CONSTRAINT document_classification_resolutions_chosen_kind_check CHECK \(chosen_kind_key IN \(([^)]*)\)/));
  assert.deepEqual([...resolveList].sort(), [...accepted].sort(), "the RPC accepts exactly what the table accepts");
  for (const key of [...kinds.DOCUMENT_KINDS.map((kind) => kind.key), "contract", "other", "not_needed"]) assert.ok(accepted.has(key), key);
  assert.equal(kinds.DOCUMENT_KINDS.length, 13, "the AI kinds did not change");
  assert.equal(kinds.isDocumentKindKey("contract"), false, "the model never suggests contract");
  assert.equal(kinds.DOCUMENT_CLASSIFICATION_KEYS.includes("contract"), false);
  assert.deepEqual(kinds.STAFF_EXTRA_KINDS.map((kind) => kind.label), ["Договор", "Другое…", "Не нужное"]);
  assert.equal(kinds.isAcceptKindKey("contract") && kinds.isAcceptKindKey("not_needed") && kinds.isAcceptKindKey("passport"), true);
  assert.equal(kinds.isAcceptKindKey("driving"), false);
});

test("dedupe: receipts, contract and custom names are exempt; the passport and the other single documents keep the guard", () => {
  for (const kind of ["payment_receipt", "contract", "other"]) assert.equal(kinds.dedupeAppliesTo(kind), false, kind);
  for (const kind of kinds.DOCUMENT_KINDS.map((item) => item.key).filter((key) => key !== "payment_receipt")) assert.equal(kinds.dedupeAppliesTo(kind), true, kind);
  assert.equal(kinds.isFinanceKind("contract") && kinds.isFinanceKind("payment_receipt"), true);
  assert.equal(kinds.isFinanceKind("passport") || kinds.isFinanceKind("other") || kinds.isFinanceKind("not_needed"), false);
});

test("custom name: trimmed, collapsed, 1-120 characters, no control characters", () => {
  assert.equal(kinds.normalizeCustomDocumentLabel("  Справка   из банка  "), "Справка из банка");
  assert.equal(kinds.normalizeCustomDocumentLabel("a".repeat(120)), "a".repeat(120));
  for (const bad of ["", "   ", "a".repeat(121), "a\nb", "a\u0000b", null, undefined, 7]) assert.equal(kinds.normalizeCustomDocumentLabel(bad), null, String(bad));
});

test("the accept action: finance gate before any change, dedupe through the exemption, removal through the existing soft command", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const actions = read("../src/lib/platform-document-sorting-actions.ts");
  assert.ok(actions.indexOf("finance_forbidden") < actions.indexOf("getPlatformCaseDocumentWorkspace(actor"), "the permission gate runs before any read or write of the file");
  assert.match(actions, /isFinanceKind\(kind\) && !\(await financeWritable\(/);
  assert.match(actions, /dedupeAppliesTo\(kind\) && workspace\.slots\.some\(\(item\) => item\.documentSlotId !== slotId && item\.requirementLabel === label\)\) return "target_exists"/);
  assert.match(actions, /rpc\("remove_document_slot"/, "«Не нужное» uses the existing soft removal, never a delete");
  assert.equal(/\.delete\(|DELETE FROM/i.test(actions), false);
  assert.ok(actions.indexOf("sendDocumentToFinance(") < actions.indexOf('rpc("change_document_slot_metadata"'), "money first: a failed hand-off leaves the file in the sorting list for a safe retry");
  const handoff = read("../src/lib/server/document-finance-handoff.ts");
  assert.match(handoff, /\.copy\(source\.object_name, objectName\)/, "Storage copy inside the bucket, no bytes read");
  assert.match(handoff, /versionId\.toLowerCase\(\)\}`/, "the target object name derives from the file version: a repeat cannot create a second contract");
  assert.match(handoff, /record_case_contract_file_metadata/);
  assert.match(handoff, /record_pending_receipt_v1/);
  assert.match(handoff, /can_write === true/, "the same gate as the 189 upload routes");
  assert.equal(sortingRequestId(uuid(1), "contract", "finance"), sortingRequestId(uuid(1), "contract", "finance"));
});

test("the sorting card offers the new kinds quietly: one select, a name field only for «Другое…», a confirm only for «Не нужное»", () => {
  const ui = readFileSync(new URL("../src/components/staff/profile/AmoDocumentSorting.tsx", import.meta.url), "utf8");
  assert.match(ui, /STAFF_EXTRA_KINDS\.map\(\(kind\) => <option/);
  assert.match(ui, /pickedKind === "other" \?/);
  assert.match(ui, /maxLength=\{CUSTOM_DOCUMENT_LABEL_MAX\}/);
  assert.match(ui, /confirmRemove/);
  assert.match(ui, /finance_forbidden:/);
  assert.match(ui, /finance_failed:/);
  assert.match(ui, /Станет договором дела в «Деньги»/);
  assert.match(ui, /form\.set\("custom_label", label\)/, "the exact-field action always receives the custom_label field");
});
