import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  importPlatformKnowledgeBundleBytes,
  PLATFORM_KNOWLEDGE_MAX_BUNDLE_BYTES,
  resolveConfiguredPlatformKnowledgeAccountId,
  stablePlatformKnowledgeJson,
  validatePlatformKnowledgeBundleBytes,
} from "../src/lib/server/platform-knowledge-bundle.ts";
import { createPlatformKnowledgeGeminiEmbedder } from "../src/lib/server/platform-knowledge-embeddings.ts";
import { safePlatformKnowledgeImportResult } from "../src/lib/server/platform-knowledge-import-output.ts";

const ACCOUNT_ID = "20000000-0000-4000-8000-000000000002";

function testCredential() {
  return ["not", "a", "real", "credential"].join("-");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(audience = "internal") {
  const content = "Verified knowledge without personal contact details.";
  const bundle = {
    version: 1,
    account_id: ACCOUNT_ID,
    audience,
    vault_kind: audience === "client" ? "evo_client_knowledge" : "evo_internal_knowledge",
    marker_sha256: "a".repeat(64),
    documents: [{
      source_path: "Countries/China.md",
      source_sha256: sha256(Buffer.from(content)),
      title: "China",
      content,
    }],
  };
  const bundleBytes = Buffer.from(`${stablePlatformKnowledgeJson(bundle)}\n`);
  const manifest = {
    version: 1,
    account_id: ACCOUNT_ID,
    audience,
    bundle_file: `${audience}.bundle.json`,
    bundle_sha256: sha256(bundleBytes),
  };
  return {
    bundleBytes,
    manifestBytes: Buffer.from(`${stablePlatformKnowledgeJson(manifest)}\n`),
    bundleFile: manifest.bundle_file,
  };
}

test("bundle validator preserves the canonical account/audience/hash/PII/path boundary", () => {
  const input = fixture();
  const result = validatePlatformKnowledgeBundleBytes(
    input.bundleBytes,
    input.manifestBytes,
    ACCOUNT_ID,
    "internal",
    input.bundleFile,
  );
  assert.equal(result.bundle.documents.length, 1);
  assert.equal(result.bundleSha256, sha256(input.bundleBytes));

  const unsafe = fixture();
  const parsed = JSON.parse(unsafe.bundleBytes.toString("utf8"));
  parsed.documents[0].title = "Contact user@example.com";
  parsed.documents[0].source_sha256 = sha256(Buffer.from(parsed.documents[0].content));
  const unsafeBytes = Buffer.from(`${stablePlatformKnowledgeJson(parsed)}\n`);
  const unsafeManifest = JSON.parse(unsafe.manifestBytes.toString("utf8"));
  unsafeManifest.bundle_sha256 = sha256(unsafeBytes);
  assert.throws(() => validatePlatformKnowledgeBundleBytes(
    unsafeBytes,
    Buffer.from(`${stablePlatformKnowledgeJson(unsafeManifest)}\n`),
    ACCOUNT_ID,
    "internal",
    input.bundleFile,
  ), /email|phone|contact/iu);
});

test("importer materializes every 1536-dimensional Gemini embedding before one atomic RPC", async () => {
  const input = fixture();
  const events = [];
  const db = {
    async rpc(name, args) {
      events.push(["rpc", name, args]);
      return {
        data: {
          version: 1,
          account_id: ACCOUNT_ID,
          audience: "internal",
          bundle_sha256: sha256(input.bundleBytes),
          documents_upserted: 1,
          documents_deleted: 0,
          chunks_replaced: args.p_payload.documents[0].chunks.length,
        },
        error: null,
      };
    },
  };
  const embed = async (texts, options) => {
    events.push(["embed", texts, options]);
    return texts.map(() => Array.from({ length: 1_536 }, () => 0.01));
  };
  const result = await importPlatformKnowledgeBundleBytes({
    db,
    embed,
    bundleBytes: input.bundleBytes,
    manifestBytes: input.manifestBytes,
    bundleFile: input.bundleFile,
    accountId: ACCOUNT_ID,
    audience: "internal",
  });
  assert.equal(events[0][0], "embed");
  assert.deepEqual(events[0][1], ["title: China | text: Verified knowledge without personal contact details."]);
  assert.equal(events[0][2].model, "gemini-embedding-2");
  assert.equal(events[0][2].dimensions, 1_536);
  assert.deepEqual(Object.keys(events[0][2]).sort(), ["dimensions", "model"]);
  assert.equal(events[1][0], "rpc");
  assert.equal(events[1][1], "sync_ai_knowledge_bundle");
  assert.equal(result.documents_upserted, 1);
});

test("Gemini Embedding 2 request uses exact prefixed text without unsupported taskType", async () => {
  const calls = [];
  const embed = createPlatformKnowledgeGeminiEmbedder({
    apiKey: testCredential(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { embeddings: [{ values: Array.from({ length: 1_536 }, () => 0.01) }] };
        },
      };
    },
  });
  const result = await embed(["title: China | text: Verified knowledge"], {
    model: "gemini-embedding-2",
    dimensions: 1_536,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 1_536);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, {
    "content-type": "application/json",
    "x-goog-api-key": testCredential(),
  });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    requests: [{
      model: "models/gemini-embedding-2",
      content: { parts: [{ text: "title: China | text: Verified knowledge" }] },
      outputDimensionality: 1_536,
    }],
  });
  assert.equal(JSON.stringify(body).includes("taskType"), false);
});

test("embedding failure leaves the database untouched", async () => {
  const input = fixture("client");
  let rpcCalls = 0;
  await assert.rejects(importPlatformKnowledgeBundleBytes({
    db: { async rpc() { rpcCalls += 1; throw new Error("must not run"); } },
    embed: async () => { throw new Error("provider unavailable"); },
    bundleBytes: input.bundleBytes,
    manifestBytes: input.manifestBytes,
    bundleFile: input.bundleFile,
    accountId: ACCOUNT_ID,
    audience: "client",
  }), /provider unavailable/u);
  assert.equal(rpcCalls, 0);
});

test("safe importer output cannot contain account identity", () => {
  const output = safePlatformKnowledgeImportResult({
    version: 1,
    account_id: ACCOUNT_ID,
    audience: "client",
    bundle_sha256: "b".repeat(64),
    documents_upserted: 11,
    documents_deleted: 0,
    chunks_replaced: 42,
  });
  assert.deepEqual(output, {
    status: "knowledge_import_verified",
    version: 1,
    audience: "client",
    bundle_sha256: "b".repeat(64),
    documents_upserted: 11,
    documents_deleted: 0,
    chunks_replaced: 42,
  });
  assert.equal(JSON.stringify(output).includes(ACCOUNT_ID), false);
  assert.equal(Object.hasOwn(output, "account_id"), false);
});

test("importer requires exact canonical configured account before file/provider/database work", () => {
  assert.equal(resolveConfiguredPlatformKnowledgeAccountId(ACCOUNT_ID, {
    EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT_ID,
  }), ACCOUNT_ID);
  assert.throws(() => resolveConfiguredPlatformKnowledgeAccountId(
    "30000000-0000-4000-8000-000000000003",
    { EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT_ID },
  ), /canonical account/iu);
  assert.throws(() => resolveConfiguredPlatformKnowledgeAccountId(ACCOUNT_ID, {}), /canonical account/iu);
});

test("bundle byte ceiling rejects before embedding or database work", async () => {
  let embedCalls = 0;
  let rpcCalls = 0;
  await assert.rejects(importPlatformKnowledgeBundleBytes({
    db: { async rpc() { rpcCalls += 1; throw new Error("must not run"); } },
    embed: async () => { embedCalls += 1; throw new Error("must not run"); },
    bundleBytes: Buffer.alloc(PLATFORM_KNOWLEDGE_MAX_BUNDLE_BYTES + 1),
    manifestBytes: Buffer.from("{}\n"),
    bundleFile: "internal.bundle.json",
    accountId: ACCOUNT_ID,
    audience: "internal",
  }), /bundle.*limit/iu);
  assert.equal(embedCalls, 0);
  assert.equal(rpcCalls, 0);
});

test("document and total chunk ceilings reject before embedding or database work", async () => {
  const documents = Array.from({ length: 400 }, (_, index) => {
    const content = `${String(index).padStart(3, "0")} ${"x".repeat(23_997)}`;
    return {
      source_path: `Topics/${String(index).padStart(3, "0")}.md`,
      source_sha256: sha256(Buffer.from(content)),
      title: `Topic ${index}`,
      content,
    };
  });
  const bundle = {
    version: 1,
    account_id: ACCOUNT_ID,
    audience: "internal",
    vault_kind: "evo_internal_knowledge",
    marker_sha256: "a".repeat(64),
    documents,
  };
  const bundleBytes = Buffer.from(`${stablePlatformKnowledgeJson(bundle)}\n`);
  const manifestBytes = Buffer.from(`${stablePlatformKnowledgeJson({
    version: 1,
    account_id: ACCOUNT_ID,
    audience: "internal",
    bundle_file: "internal.bundle.json",
    bundle_sha256: sha256(bundleBytes),
  })}\n`);
  let embedCalls = 0;
  let rpcCalls = 0;
  await assert.rejects(importPlatformKnowledgeBundleBytes({
    db: { async rpc() { rpcCalls += 1; throw new Error("must not run"); } },
    embed: async () => { embedCalls += 1; throw new Error("must not run"); },
    bundleBytes,
    manifestBytes,
    bundleFile: "internal.bundle.json",
    accountId: ACCOUNT_ID,
    audience: "internal",
  }), /chunk.*limit/iu);
  assert.equal(embedCalls, 0);
  assert.equal(rpcCalls, 0);
});
