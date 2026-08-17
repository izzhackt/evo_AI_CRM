import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPlatformStaffAssistantConfig,
  PLATFORM_STAFF_ASSISTANT_MODEL,
} from "../src/lib/server/platform-staff-assistant-config.ts";
import {
  normalizePlatformStaffAssistantInput,
  PlatformStaffAssistantContractError,
} from "../src/lib/server/platform-staff-assistant-contract.ts";
import {
  createPlatformStaffAssistantHandler,
} from "../src/app/api/platform-ai/staff-assistant/route.ts";
import {
  createPlatformStaffKnowledgeRepository,
  PlatformStaffKnowledgeError,
} from "../src/lib/server/platform-staff-knowledge-repository.ts";
import {
  buildPlatformStaffAssistantPrompt,
  createPlatformStaffAssistantAuditRepository,
  createPlatformStaffAssistantService,
  createPlatformStaffRateLimiter,
  PlatformStaffAssistantAuditError,
  PlatformStaffAssistantRateLimitError,
} from "../src/lib/server/platform-staff-assistant-service.ts";
import { createPlatformStaffAssistantProvider } from "../src/lib/server/platform-staff-assistant-provider.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000002";
const ACTOR_ID = "30000000-0000-4000-8000-000000000003";
const AUDIT_ID = "40000000-0000-4000-8000-000000000004";
const TEST_PROVIDER_VALUE = ["synthetic", "provider", "test", "value"].join("-");

function enabledEnvironment() {
  return {
    EVO_PLATFORM_STAFF_ASSISTANT_ENABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_key",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_synthetic_test_key",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT_ID,
    EVO_PLATFORM_GEMINI_API_KEY: "synthetic-gemini-test-key",
  };
}

function request(body, overrides = {}) {
  return new Request("https://crm.example.test/api/platform-ai/staff-assistant", {
    method: "POST",
    headers: {
      origin: "https://crm.example.test",
      host: "crm.example.test",
      "content-type": "application/json",
      ...overrides.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("staff assistant is disabled unless every exact setting validates", () => {
  assert.deepEqual(loadPlatformStaffAssistantConfig({}), { enabled: false });

  const enabled = loadPlatformStaffAssistantConfig(enabledEnvironment());
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.model, PLATFORM_STAFF_ASSISTANT_MODEL);
  assert.equal(enabled.model, "gemini-3.5-flash");
  assert.equal(enabled.timeoutMs, 15_000);
  assert.equal(enabled.maxOutputTokens, 2_048);
  assert.equal(enabled.organizationId, ORGANIZATION_ID);
  assert.equal(enabled.accountId, ACCOUNT_ID);

  assert.deepEqual(
    loadPlatformStaffAssistantConfig({
      ...enabledEnvironment(),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    }),
    { enabled: false },
  );
});

test("request contract is closed, normalized, bounded, and audience-specific", () => {
  assert.deepEqual(
    normalizePlatformStaffAssistantInput({
      audience: "client",
      turns: [
        { role: "user", content: "  What documents?  " },
        { role: "assistant", content: "Which country?" },
        { role: "user", content: "China" },
      ],
      evaluation_case_id: "client_china_documents",
    }),
    {
      audience: "client",
      turns: [
        { role: "user", content: "What documents?" },
        { role: "assistant", content: "Which country?" },
        { role: "user", content: "China" },
      ],
      evaluationCaseId: "client_china_documents",
      latestQuestion: "China",
    },
  );

  assert.throws(
    () => normalizePlatformStaffAssistantInput({ audience: "internal", question: "ok", extra: true }),
    PlatformStaffAssistantContractError,
  );
  assert.throws(
    () => normalizePlatformStaffAssistantInput({
      audience: "client",
      turns: [{ role: "assistant", content: "wrong start" }],
    }),
    PlatformStaffAssistantContractError,
  );
  assert.throws(
    () => normalizePlatformStaffAssistantInput({
      audience: "internal",
      question: "x".repeat(4_001),
    }),
    PlatformStaffAssistantContractError,
  );
});

test("route fails closed before actor, repository, or provider when disabled", async () => {
  const calls = [];
  const handler = createPlatformStaffAssistantHandler(async () => ({
    config: { enabled: false },
    loadActor: async () => {
      calls.push("actor");
      throw new Error("must not run");
    },
    createDraft: async () => {
      calls.push("draft");
      throw new Error("must not run");
    },
  }));

  const response = await handler(request({ audience: "internal", question: "What next?" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "assistant_disabled" } });
  assert.deepEqual(calls, []);
});

test("route admits only same-organization admin, sales, or curator", async () => {
  const calls = [];
  const handler = createPlatformStaffAssistantHandler(async () => ({
    config: loadPlatformStaffAssistantConfig(enabledEnvironment()),
    loadActor: async () => ({
      status: "authenticated",
      actor: {
        authUserId: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        platformRole: "finance",
      },
    }),
    createDraft: async () => {
      calls.push("draft");
      throw new Error("must not run");
    },
  }));

  const response = await handler(request({ audience: "internal", question: "What next?" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: { code: "forbidden" } });
  assert.deepEqual(calls, []);
});

test("route returns only the closed draft result after successful audit", async () => {
  const seen = [];
  const handler = createPlatformStaffAssistantHandler(async () => ({
    config: loadPlatformStaffAssistantConfig(enabledEnvironment()),
    loadActor: async () => ({
      status: "authenticated",
      actor: {
        authUserId: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        platformRole: "sales",
      },
    }),
    createDraft: async (input) => {
      seen.push(input);
      return {
        reply: "Prepare the verified document checklist.",
        handoff: false,
        sources: [{ chunk_id: "50000000-0000-4000-8000-000000000005", source_path: "China/Documents.md" }],
        audit_id: AUDIT_ID,
      };
    },
  }));

  const response = await handler(request({ audience: "internal", question: "China documents?" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    reply: "Prepare the verified document checklist.",
    handoff: false,
    sources: [{ chunk_id: "50000000-0000-4000-8000-000000000005", source_path: "China/Documents.md" }],
    audit_id: AUDIT_ID,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].actorUserId, ACTOR_ID);
  assert.equal(seen[0].accountId, ACCOUNT_ID);
  assert.equal(seen[0].input.latestQuestion, "China documents?");
});

test("route rejects wrong method, media type, cross-origin, and oversized declared body", async () => {
  const handler = createPlatformStaffAssistantHandler(async () => {
    throw new Error("dependencies must not load");
  });

  const wrongMethod = await handler(new Request("https://crm.example.test/api/platform-ai/staff-assistant"));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");

  const media = await handler(request("{}", { headers: { "content-type": "application/json; charset=utf-8" } }));
  assert.equal(media.status, 415);

  const origin = await handler(request("{}", { headers: { origin: "https://evil.example" } }));
  assert.equal(origin.status, 403);

  const tooLarge = await handler(request("{}", { headers: { "content-length": "65537" } }));
  assert.equal(tooLarge.status, 413);
});

test("dependency and actor failures stay inside the closed JSON error contract", async () => {
  const dependencyFailure = createPlatformStaffAssistantHandler(async () => {
    throw new Error("configuration loader failed");
  });
  const disabled = await dependencyFailure(request({ audience: "internal", question: "Question" }));
  assert.equal(disabled.status, 503);
  assert.deepEqual(await disabled.json(), { error: { code: "assistant_disabled" } });

  const actorFailure = createPlatformStaffAssistantHandler(async () => ({
    config: loadPlatformStaffAssistantConfig(enabledEnvironment()),
    loadActor: async () => { throw new Error("auth lookup failed"); },
    createDraft: async () => { throw new Error("must not run"); },
  }));
  const forbidden = await actorFailure(request({ audience: "internal", question: "Question" }));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: { code: "forbidden" } });
});

test("knowledge repository uses one lexical RPC, preserves rank, and binds safe sources", async () => {
  const calls = [];
  const chunkA = "50000000-0000-4000-8000-000000000005";
  const chunkB = "60000000-0000-4000-8000-000000000006";
  const client = {
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return {
        data: [
          { id: chunkA, content: "First verified excerpt", rank: 0.9 },
          { id: chunkB, content: "Second verified excerpt", rank: 0.8 },
        ],
        error: null,
      };
    },
    from(table) {
      calls.push(["from", table]);
      const builder = {
        select(columns) { calls.push(["select", columns]); return builder; },
        eq(column, value) { calls.push(["eq", column, value]); return builder; },
        in(column, values) {
          calls.push(["in", column, values]);
          return Promise.resolve({
            data: [
              { id: chunkB, ai_knowledge_documents: { source_path: "Malaysia/Visa.md" } },
              { id: chunkA, ai_knowledge_documents: { source_path: "China/Documents.md" } },
            ],
            error: null,
          });
        },
      };
      return builder;
    },
  };

  const repository = createPlatformStaffKnowledgeRepository(client);
  const result = await repository.retrieve({
    accountId: ACCOUNT_ID,
    audience: "internal",
    question: "China documents?",
  });
  assert.deepEqual(calls[0], ["rpc", "match_ai_knowledge_fts", {
    p_account_id: ACCOUNT_ID,
    p_audience: "internal",
    p_query: "China documents?",
    p_match_count: 5,
  }]);
  assert.deepEqual(result.sources, [
    { chunk_id: chunkA, source_path: "China/Documents.md" },
    { chunk_id: chunkB, source_path: "Malaysia/Visa.md" },
  ]);
  assert.deepEqual(result.excerpts, ["First verified excerpt", "Second verified excerpt"]);
});

test("knowledge repository fails closed on unsafe or missing source bindings", async () => {
  const client = {
    async rpc() {
      return { data: [{ id: "50000000-0000-4000-8000-000000000005", content: "Excerpt", rank: 1 }], error: null };
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return Promise.resolve({ data: [{ id: "50000000-0000-4000-8000-000000000005", ai_knowledge_documents: { source_path: "../secrets/key.md" } }], error: null }); },
      };
      return builder;
    },
  };
  await assert.rejects(
    createPlatformStaffKnowledgeRepository(client).retrieve({ accountId: ACCOUNT_ID, audience: "client", question: "Question" }),
    PlatformStaffKnowledgeError,
  );
});

test("knowledge repository filters stale unbound matches while preserving valid rank order", async () => {
  const chunkA = "50000000-0000-4000-8000-000000000005";
  const chunkB = "60000000-0000-4000-8000-000000000006";
  const client = {
    async rpc() {
      return { data: [{ id: chunkA, content: "Valid", rank: 1 }, { id: chunkB, content: "Stale", rank: 0.5 }], error: null };
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return Promise.resolve({ data: [{ id: chunkA, ai_knowledge_documents: { source_path: "China/Documents.md" } }], error: null }); },
      };
      return builder;
    },
  };
  const result = await createPlatformStaffKnowledgeRepository(client).retrieve({ accountId: ACCOUNT_ID, audience: "internal", question: "Question" });
  assert.deepEqual(result, {
    excerpts: ["Valid"],
    sources: [{ chunk_id: chunkA, source_path: "China/Documents.md" }],
  });
});

test("service creates one bounded draft and returns only after body-free audit", async () => {
  const events = [];
  const source = { chunk_id: "50000000-0000-4000-8000-000000000005", source_path: "China/Documents.md" };
  const service = createPlatformStaffAssistantService({
    knowledge: {
      retrieve: async () => {
        events.push("knowledge");
        return { excerpts: ["Verified document list"], sources: [source] };
      },
    },
    provider: {
      generate: async (input) => {
        events.push("provider");
        assert.equal(input.model, "gemini-3.5-flash");
        assert.equal(input.timeoutMs, 15_000);
        assert.equal(input.store, false);
        assert.equal(input.maxRetries, 0);
        return { reply: "Use the verified checklist.", handoff: false };
      },
    },
    audit: {
      record: async (input) => {
        events.push("audit");
        assert.equal(Object.hasOwn(input, "response"), false);
        assert.match(input.responseSha256, /^[0-9a-f]{64}$/u);
        return AUDIT_ID;
      },
    },
    rateLimiter: createPlatformStaffRateLimiter({ now: () => 1_000 }),
  });

  const config = loadPlatformStaffAssistantConfig(enabledEnvironment());
  assert.equal(config.enabled, true);
  const result = await service.createDraft({
    config,
    actorUserId: ACTOR_ID,
    accountId: ACCOUNT_ID,
    input: normalizePlatformStaffAssistantInput({ audience: "internal", question: "China documents?" }),
  });
  assert.deepEqual(events, ["knowledge", "provider", "audit"]);
  assert.deepEqual(result, { reply: "Use the verified checklist.", handoff: false, sources: [source], audit_id: AUDIT_ID });
});

test("service never returns an unaudited draft", async () => {
  const service = createPlatformStaffAssistantService({
    knowledge: { retrieve: async () => ({ excerpts: ["Verified"], sources: [{ chunk_id: "50000000-0000-4000-8000-000000000005", source_path: "China/Documents.md" }] }) },
    provider: { generate: async () => ({ reply: "Draft", handoff: true }) },
    audit: { record: async () => { throw new Error("database unavailable"); } },
    rateLimiter: createPlatformStaffRateLimiter({ now: () => 1_000 }),
  });
  const config = loadPlatformStaffAssistantConfig(enabledEnvironment());
  assert.equal(config.enabled, true);
  await assert.rejects(
    service.createDraft({ config, actorUserId: ACTOR_ID, accountId: ACCOUNT_ID, input: normalizePlatformStaffAssistantInput({ audience: "internal", question: "Question" }) }),
    PlatformStaffAssistantAuditError,
  );
});

test("rate limiter blocks before work at the exact actor and organization limits", () => {
  const limiter = createPlatformStaffRateLimiter({ now: () => 10_000 });
  for (let index = 0; index < 20; index += 1) limiter.consume(ACTOR_ID, ORGANIZATION_ID);
  assert.throws(() => limiter.consume(ACTOR_ID, ORGANIZATION_ID), PlatformStaffAssistantRateLimitError);

  const organizationLimiter = createPlatformStaffRateLimiter({ now: () => 10_000 });
  for (let index = 0; index < 100; index += 1) {
    organizationLimiter.consume(`actor-${index}`, ORGANIZATION_ID);
  }
  assert.throws(() => organizationLimiter.consume("actor-overflow", ORGANIZATION_ID), PlatformStaffAssistantRateLimitError);
});

test("prompt is deterministic, source-bound, and contains no provider-side tools", () => {
  const prompt = buildPlatformStaffAssistantPrompt({
    input: normalizePlatformStaffAssistantInput({ audience: "internal", question: "Malaysia requirements?" }),
    excerpts: ["Verified Malaysia requirements"],
    sources: [{ chunk_id: "50000000-0000-4000-8000-000000000005", source_path: "Malaysia/Requirements.md" }],
  });
  assert.match(prompt, /Malaysia requirements\?/u);
  assert.match(prompt, /Malaysia\/Requirements\.md/u);
  assert.match(prompt, /Do not invent/u);
});

test("Gemini request is one stored-false tool-free JSON draft with fixed limits", async () => {
  const requests = [];
  const provider = createPlatformStaffAssistantProvider(async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Verified draft", handoff: false }) }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const output = await provider.generate({
    apiKey: TEST_PROVIDER_VALUE,
    model: "gemini-3.5-flash",
    prompt: "Grounded prompt",
    timeoutMs: 15_000,
    maxOutputTokens: 2_048,
    temperature: 0.2,
    store: false,
    tools: [],
    maxRetries: 0,
  });
  assert.deepEqual(output, { reply: "Verified draft", handoff: false });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.store, false);
  assert.equal(Object.hasOwn(requests[0].body, "tools"), false);
  assert.deepEqual(requests[0].body.generationConfig, {
    maxOutputTokens: 2_048,
    temperature: 0.2,
    candidateCount: 1,
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["reply", "handoff"],
      properties: {
        reply: { type: "string", minLength: 1 },
        handoff: { type: "boolean" },
      },
    },
  });
});

test("audit repository stores only response hash and expires body-free evidence", async () => {
  let inserted;
  const client = {
    from(table) {
      assert.equal(table, "ai_assistant_audits");
      return {
        insert(value) {
          inserted = value;
          return {
            select(columns) {
              assert.equal(columns, "id");
              return {
                async single() { return { data: { id: AUDIT_ID }, error: null }; },
              };
            },
          };
        },
      };
    },
  };
  const repository = createPlatformStaffAssistantAuditRepository(client, { now: () => Date.parse("2026-08-18T00:00:00.000Z") });
  const id = await repository.record({
    accountId: ACCOUNT_ID,
    audience: "internal",
    evaluationCaseId: null,
    provider: "gemini",
    model: "gemini-3.5-flash",
    sources: [{ chunk_id: "50000000-0000-4000-8000-000000000005", source_path: "China/Documents.md" }],
    responseSha256: "a".repeat(64),
    handoff: false,
    actorUserId: ACTOR_ID,
  });
  assert.equal(id, AUDIT_ID);
  assert.equal(Object.hasOwn(inserted, "response"), false);
  assert.equal(inserted.response_sha256, "a".repeat(64));
  assert.equal(inserted.expires_at, "2026-11-16T00:00:00.000Z");
});
