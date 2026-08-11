import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ApiError } from "@google/genai";

import {
  loadPlatformGeminiProposalConfig,
  PLATFORM_GEMINI_PROPOSAL_MODEL,
  PlatformGeminiProposalConfigurationError,
} from "../src/lib/server/platform-gemini-proposal-config.ts";
import {
  parsePlatformGeminiProposal,
  PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA,
  PlatformGeminiProposalValidationError,
} from "../src/lib/server/platform-gemini-proposal-contract.ts";
import {
  createPlatformGeminiProposalProvider,
  PlatformGeminiProposalProviderError,
} from "../src/lib/server/platform-gemini-proposal-client.ts";
import {
  buildPlatformGeminiProposalPrompt,
  createPlatformGeminiProposalHandler,
  createPlatformGeminiProposalRepository,
} from "../src/lib/server/platform-gemini-proposal-service.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000002";
const SOURCE_MESSAGE_ID = "30000000-0000-4000-8000-000000000003";
const RECENT_MESSAGE_ID = "35000000-0000-4000-8000-000000000003";
const REQUEST_ID = "40000000-0000-4000-8000-000000000004";
const PROPOSAL_REQUEST_ID = "50000000-0000-4000-8000-000000000005";
const HMAC_SECRET = "synthetic-gemini-route-hmac-secret-32-bytes-minimum";
const TEST_GEMINI_VALUE = "stub-gemini-token-for-tests-000000000000";
const SUPABASE_SECRET = ["sb", "secret", "synthetic_platform_test_only"].join("_");

function enabledEnvironment(overrides = {}) {
  return {
    EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://platform-test.supabase.co",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET,
    EVO_PLATFORM_GEMINI_PROPOSAL_HMAC_SECRET: HMAC_SECRET,
    EVO_PLATFORM_GEMINI_PROPOSAL_MODEL: PLATFORM_GEMINI_PROPOSAL_MODEL,
    EVO_PLATFORM_GEMINI_API_KEY: TEST_GEMINI_VALUE,
    EVO_PLATFORM_GEMINI_PROPOSAL_TIMEOUT_MS: "15000",
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    schema_version: 1,
    language: "ru",
    intent: "admissions_discovery",
    confidence: 84,
    risk: "low",
    handoff_required: false,
    handoff_reasons: [],
    citations: [
      {
        knowledge_key: "china",
        knowledge_version: 1,
        evidence_ordinal: 1,
      },
    ],
    memory_changes: [
      {
        fact_key: "preferred_country",
        action: "set",
        value: "Китай",
        confidence: 95,
      },
    ],
    qualification: {
      status: "collecting",
      completeness: 40,
      missing_fact_keys: ["preferred_program", "intake_target"],
      notes: null,
    },
    reply_text: "Расскажите, пожалуйста, какую программу вы рассматриваете?",
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    conversation: {
      conversation_id: CONVERSATION_ID,
      status: "open",
    },
    source_message: {
      message_id: SOURCE_MESSAGE_ID,
      direction: "inbound",
      language: "ru",
      body_text: "Хочу поступить в Китай",
      created_at: "2026-08-11T01:02:03Z",
    },
    recent_messages: [],
    memory: {
      facts: [
        {
          fact_key: "blockers",
          status: "active",
          value: ["Missing transcript", "Needs budget"],
          version: 1,
        },
      ],
      qualification: null,
      control: null,
    },
    retrieval: {
      evidence: [
        {
          knowledge_key: "china",
          knowledge_version: 1,
          evidence_ordinal: 1,
          content_text: "Подбор программы начинается после уточнения профиля.",
        },
      ],
    },
    amocrm: null,
    ...overrides,
  };
}

function rpcContext(overrides = {}) {
  return {
    conversation: {
      conversation_id: CONVERSATION_ID,
      status: "open",
    },
    source_message: {
      message_id: SOURCE_MESSAGE_ID,
      direction: "inbound",
      language: "ru",
      body_text: "Хочу поступить в Китай",
      created_at: "2026-08-11T01:02:03Z",
    },
    recent_messages: [],
    memory: {
      version: 0,
      short_summary: null,
      long_summary: null,
      facts: [
        {
          fact_key: "blockers",
          status: "active",
          value: ["Missing transcript", "Needs budget"],
          version: 1,
        },
      ],
      qualification: {
        version: 0,
        status: "collecting",
        completeness: 0,
        missing_fact_keys: [],
        notes: null,
      },
      control: {
        version: 0,
        state: "paused",
      },
    },
    retrieval: {
      mode: null,
      outcome: null,
      degraded: null,
      evidence: [
        {
          knowledge_key: "china",
          knowledge_version: 1,
          evidence_ordinal: 1,
          content_text: "Подбор программы начинается после уточнения профиля.",
        },
      ],
    },
    amocrm: null,
    ...overrides,
  };
}

function rawRequest(bodyObject, { secret = HMAC_SECRET, signature } = {}) {
  const rawBody = JSON.stringify(bodyObject);
  return new Request("http://localhost/api/internal/platform-ai/gemini/proposal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-evo-gemini-hmac-algorithm": "sha256",
      "x-evo-gemini-hmac":
        signature ?? createHmac("sha256", secret).update(rawBody).digest("hex"),
    },
    body: rawBody,
  });
}

function requestBody(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    source_message_id: SOURCE_MESSAGE_ID,
    request_id: REQUEST_ID,
    ...overrides,
  };
}

test("Gemini proposal lane is disabled by default and requires an exact enable flag", () => {
  assert.deepEqual(loadPlatformGeminiProposalConfig({}), { enabled: false });
  assert.deepEqual(
    loadPlatformGeminiProposalConfig({
      EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED: "0",
    }),
    { enabled: false },
  );

  assert.throws(
    () =>
      loadPlatformGeminiProposalConfig({
        EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED: "true",
      }),
    (error) =>
      error instanceof PlatformGeminiProposalConfigurationError &&
      error.code === "invalid_enabled_flag",
  );
});

test("enabled config isolates the credential and fails provider config durably", () => {
  const ready = loadPlatformGeminiProposalConfig(enabledEnvironment());
  assert.equal(ready.enabled, true);
  assert.equal(ready.modelRef, "gemini-3.5-flash");
  assert.deepEqual(ready.provider, { ready: true, apiKey: TEST_GEMINI_VALUE });
  assert.equal("GEMINI_API_KEY" in ready, false);

  for (const environment of [
    enabledEnvironment({ EVO_PLATFORM_GEMINI_API_KEY: "" }),
    enabledEnvironment({ EVO_PLATFORM_GEMINI_PROPOSAL_MODEL: "gemini-3.6-flash" }),
    enabledEnvironment({ EVO_PLATFORM_GEMINI_PROPOSAL_TIMEOUT_MS: "0" }),
  ]) {
    const config = loadPlatformGeminiProposalConfig(environment);
    assert.equal(config.enabled, true);
    assert.deepEqual(config.provider, {
      ready: false,
      failureCode: "configuration_missing",
    });
  }
});

test("enabled config rejects an unsafe route or Supabase boundary before work", () => {
  for (const [key, value, code] of [
    ["EVO_PLATFORM_GEMINI_PROPOSAL_HMAC_SECRET", "short", "unsafe_hmac_secret"],
    ["NEXT_PUBLIC_SUPABASE_URL", "file:///tmp/not-supabase", "invalid_supabase_url"],
    ["EVO_PLATFORM_SUPABASE_SECRET_KEY", "public-key", "invalid_supabase_secret_key"],
  ]) {
    assert.throws(
      () => loadPlatformGeminiProposalConfig(enabledEnvironment({ [key]: value })),
      (error) =>
        error instanceof PlatformGeminiProposalConfigurationError &&
        error.code === code,
    );
  }
});

test("proposal parser accepts the exact v1 shape and independently grounds citations", () => {
  const parsed = parsePlatformGeminiProposal(JSON.stringify(proposal()), {
    evidence: context().retrieval.evidence,
  });
  assert.deepEqual(parsed, proposal());
  assert.equal(PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.required, [
    "schema_version",
    "language",
    "intent",
    "confidence",
    "risk",
    "handoff_required",
    "handoff_reasons",
    "citations",
    "memory_changes",
    "qualification",
    "reply_text",
  ]);
});

test("proposal parser rejects unknown keys, bad fact actions, ungrounded evidence, and guarantees", () => {
  const cases = [
    [proposal({ extra: true }), "invalid_proposal"],
    [
      proposal({
        memory_changes: [
          {
            fact_key: "preferred_country",
            action: "clear",
            value: "Китай",
            confidence: 50,
          },
        ],
      }),
      "invalid_proposal",
    ],
    [
      proposal({
        citations: [
          {
            knowledge_key: "invented",
            knowledge_version: 1,
            evidence_ordinal: 9,
          },
        ],
      }),
      "missing_evidence",
    ],
    [proposal({ reply_text: "Мы гарантируем 100% получение визы." }), "unsafe_semantics"],
  ];

  for (const [candidate, code] of cases) {
    assert.throws(
      () =>
        parsePlatformGeminiProposal(JSON.stringify(candidate), {
          evidence: context().retrieval.evidence,
        }),
      (error) =>
        error instanceof PlatformGeminiProposalValidationError &&
        error.code === code,
    );
  }
});

test("prompt stays bounded, contains only server context, and makes Gemini non-authoritative", () => {
  const prompt = buildPlatformGeminiProposalPrompt(context({
    recent_messages: [
      {
        message_id: RECENT_MESSAGE_ID,
        direction: "outbound",
        language: "ru",
        body_text: "Какой уровень образования вас интересует?",
        created_at: "2026-08-11T01:01:03Z",
      },
    ],
  }));
  assert.ok(prompt.length > 0 && prompt.length <= 65_536);
  assert.match(prompt, /proposal only/i);
  assert.match(prompt, /must not authorize or send/i);
  assert.match(prompt, /Хочу поступить в Китай/);
  assert.doesNotMatch(prompt, /waha_chat_id|provider_message_id|phone/i);
  assert.doesNotMatch(prompt, new RegExp(CONVERSATION_ID, "i"));
  assert.doesNotMatch(prompt, new RegExp(SOURCE_MESSAGE_ID, "i"));
  assert.doesNotMatch(prompt, new RegExp(RECENT_MESSAGE_ID, "i"));
});

test("official SDK adapter sends one stateless Interactions request with no tools or retry", async () => {
  const calls = [];
  const provider = createPlatformGeminiProposalProvider(
    { apiKey: TEST_GEMINI_VALUE },
    {
      client: {
        interactions: {
          async create(params, options) {
            calls.push({ params, options });
            return {
              id: "synthetic-interaction-reference",
              status: "completed",
              output_text: JSON.stringify(proposal()),
            };
          },
        },
      },
    },
  );

  const result = await provider.createProposal({
    model: "gemini-3.5-flash",
    prompt: "synthetic bounded prompt",
    store: false,
    background: false,
    toolChoice: "none",
    timeoutMs: 15_000,
    maxRetries: 0,
    maxOutputTokens: 2_048,
  });
  assert.equal(result.outputText, JSON.stringify(proposal()));
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, {
    model: "gemini-3.5-flash",
    input: "synthetic bounded prompt",
    store: false,
    background: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA,
    },
    generation_config: {
      max_output_tokens: 2_048,
      thinking_level: "medium",
      tool_choice: "none",
    },
  });
  assert.deepEqual(calls[0].options, {
    timeout: 15_000,
    maxRetries: 0,
    fetchOptions: undefined,
  });
  assert.equal("tools" in calls[0].params, false);
  assert.equal("previous_interaction_id" in calls[0].params, false);
});

test("official SDK adapter rejects truncated and non-completed interactions", async () => {
  for (const [status, code] of [
    ["incomplete", "output_truncated"],
    ["requires_action", "provider_rejected"],
  ]) {
    const provider = createPlatformGeminiProposalProvider(
      { apiKey: TEST_GEMINI_VALUE },
      {
        client: {
          interactions: {
            async create() {
              return { id: "synthetic", status };
            },
          },
        },
      },
    );
    await assert.rejects(
      provider.createProposal({
        model: "gemini-3.5-flash",
        prompt: "synthetic bounded prompt",
        store: false,
        background: false,
        toolChoice: "none",
        timeoutMs: 15_000,
        maxRetries: 0,
        maxOutputTokens: 2_048,
      }),
      (error) =>
        error instanceof PlatformGeminiProposalProviderError &&
        error.code === code &&
        error.providerStatus === status &&
        error.interactionRef === "synthetic",
    );
  }
});

test("official SDK adapter maps timeout, authentication, rate limit, and outage errors", async () => {
  for (const [providerError, code] of [
    [new DOMException("synthetic abort", "AbortError"), "provider_timeout"],
    [new ApiError({ message: "synthetic auth", status: 401 }), "provider_authentication_failed"],
    [new ApiError({ message: "synthetic rate", status: 429 }), "provider_rate_limited"],
    [new ApiError({ message: "synthetic outage", status: 503 }), "provider_unavailable"],
  ]) {
    const provider = createPlatformGeminiProposalProvider(
      { apiKey: TEST_GEMINI_VALUE },
      {
        client: {
          interactions: {
            async create() {
              throw providerError;
            },
          },
        },
      },
    );
    await assert.rejects(
      provider.createProposal({
        model: "gemini-3.5-flash",
        prompt: "synthetic bounded prompt",
        store: false,
        background: false,
        toolChoice: "none",
        timeoutMs: 15_000,
        maxRetries: 0,
        maxOutputTokens: 2_048,
      }),
      (error) =>
        error instanceof PlatformGeminiProposalProviderError &&
        error.code === code &&
        error.providerStatus === "transport_error" &&
        error.interactionRef === null,
    );
  }
});

test("service repository binds exact begin and finish RPCs and normalizes safe invariants", async () => {
  const calls = [];
  const repository = createPlatformGeminiProposalRepository({
    schema(name) {
      assert.equal(name, "platform");
      return {
        async rpc(rpcName, args) {
          calls.push({ rpcName, args });
          if (rpcName === "begin_gemini_proposal") {
            return {
              error: null,
              data: [
                {
                  proposal_request_id: PROPOSAL_REQUEST_ID,
                  replayed: false,
                  completed: false,
                  outcome: null,
                  context: rpcContext(),
                },
              ],
            };
          }
          return {
            error: null,
            data: [
              {
                proposal_request_id: PROPOSAL_REQUEST_ID,
                replayed: false,
                outcome: "proposal_ready",
                failure_code: null,
                human_review_required: true,
                autonomous_authority: false,
                provider_proof_state: "blocked",
              },
            ],
          };
        },
      };
    },
  });

  const begun = await repository.begin({
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    requestId: REQUEST_ID,
    modelRef: "gemini-3.5-flash",
    schemaVersion: 1,
    promptPolicyVersion: "p5f2-gemini-proposal-v1",
  });
  assert.equal(begun.context.source_message.direction, "inbound");
  assert.deepEqual(begun.context.memory.facts[0].value, [
    "Missing transcript",
    "Needs budget",
  ]);
  await repository.finish({
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    proposalRequestId: PROPOSAL_REQUEST_ID,
    outcome: "proposal_ready",
    failureCode: null,
    promptText: "synthetic private prompt",
    providerInteractionRef: "synthetic-provider-reference",
    providerStatus: "completed",
    responseJson: proposal(),
  });

  assert.deepEqual(calls, [
    {
      rpcName: "begin_gemini_proposal",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
        p_source_message_id: SOURCE_MESSAGE_ID,
        p_request_id: REQUEST_ID,
        p_model_ref: "gemini-3.5-flash",
        p_schema_version: 1,
        p_prompt_policy_version: "p5f2-gemini-proposal-v1",
      },
    },
    {
      rpcName: "finish_gemini_proposal",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
        p_source_message_id: SOURCE_MESSAGE_ID,
        p_proposal_request_id: PROPOSAL_REQUEST_ID,
        p_outcome: "proposal_ready",
        p_failure_code: null,
        p_prompt_text: "synthetic private prompt",
        p_provider_interaction_ref: "synthetic-provider-reference",
        p_provider_status: "completed",
        p_response_json: proposal(),
      },
    },
  ]);
});

test("handler authenticates exact raw body and rejects shape drift before begin", async () => {
  const calls = [];
  const handler = createPlatformGeminiProposalHandler({
    config: loadPlatformGeminiProposalConfig(enabledEnvironment()),
    repository: {
      async begin(input) {
        calls.push(["begin", input]);
        throw new Error("must not be reached");
      },
      async finish(input) {
        calls.push(["finish", input]);
        throw new Error("must not be reached");
      },
    },
    provider: {
      async createProposal() {
        throw new Error("must not be reached");
      },
    },
  });

  for (const request of [
    rawRequest(requestBody(), { signature: "0".repeat(64) }),
    rawRequest(requestBody({ unexpected: true })),
    rawRequest(requestBody({ request_id: "not-a-uuid" })),
  ]) {
    const response = await handler(request);
    assert.ok([400, 401].includes(response.status));
  }
  assert.equal(calls.length, 0);
});

test("handler persists proposal_ready and returns only a bounded non-authoritative receipt", async () => {
  const calls = [];
  const handler = createPlatformGeminiProposalHandler({
    config: loadPlatformGeminiProposalConfig(enabledEnvironment()),
    repository: {
      async begin(input) {
        calls.push(["begin", input]);
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: context(),
        };
      },
      async finish(input) {
        calls.push(["finish", input]);
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          outcome: input.outcome,
          failureCode: input.failureCode,
          humanReviewRequired: true,
          autonomousAuthority: false,
          providerProofState: "blocked",
        };
      },
    },
    provider: {
      async createProposal(input) {
        calls.push(["provider", input]);
        return {
          interactionRef: "synthetic-interaction-reference",
          outputText: JSON.stringify(proposal()),
          status: "completed",
        };
      },
    },
  });

  const response = await handler(rawRequest(requestBody()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    proposal_request_id: PROPOSAL_REQUEST_ID,
    outcome: "proposal_ready",
    human_review_required: true,
    autonomous_authority: false,
    provider_proof_state: "blocked",
  });
  assert.deepEqual(
    calls.map(([name]) => name),
    ["begin", "provider", "finish"],
  );
  const providerInput = calls[1][1];
  assert.equal(providerInput.model, "gemini-3.5-flash");
  assert.equal(providerInput.store, false);
  assert.equal(providerInput.background, false);
  assert.equal(providerInput.toolChoice, "none");
  assert.equal(providerInput.maxRetries, 0);
  assert.equal(providerInput.maxOutputTokens, 2048);
  assert.equal("tools" in providerInput, false);
  assert.equal("previousInteractionId" in providerInput, false);

  const finish = calls[2][1];
  assert.equal(finish.outcome, "proposal_ready");
  assert.equal(finish.failureCode, null);
  assert.equal(finish.providerStatus, "completed");
  assert.deepEqual(finish.responseJson, proposal());
  assert.ok(finish.promptText.length > 0);
});

test("handler begins first and durably fails closed when provider configuration is missing", async () => {
  const calls = [];
  const handler = createPlatformGeminiProposalHandler({
    config: loadPlatformGeminiProposalConfig(
      enabledEnvironment({ EVO_PLATFORM_GEMINI_API_KEY: "" }),
    ),
    repository: {
      async begin(input) {
        calls.push(["begin", input]);
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: context(),
        };
      },
      async finish(input) {
        calls.push(["finish", input]);
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          outcome: input.outcome,
          failureCode: input.failureCode,
          humanReviewRequired: true,
          autonomousAuthority: false,
          providerProofState: "blocked",
        };
      },
    },
    provider: {
      async createProposal() {
        calls.push(["provider"]);
        throw new Error("must not be reached");
      },
    },
  });

  const response = await handler(rawRequest(requestBody()));
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["begin", "finish"],
  );
  assert.equal(calls[1][1].outcome, "human_review");
  assert.equal(calls[1][1].failureCode, "configuration_missing");
  assert.equal(calls[1][1].providerStatus, "configuration_error");
});

test("handler durably preserves a non-clean Interaction status and reference", async () => {
  const finishes = [];
  const provider = createPlatformGeminiProposalProvider(
    { apiKey: TEST_GEMINI_VALUE },
    {
      client: {
        interactions: {
          async create() {
            return {
              id: "synthetic-incomplete-interaction",
              status: "incomplete",
            };
          },
        },
      },
    },
  );
  const handler = createPlatformGeminiProposalHandler({
    config: loadPlatformGeminiProposalConfig(enabledEnvironment()),
    repository: {
      async begin() {
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: context(),
        };
      },
      async finish(input) {
        finishes.push(input);
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          outcome: input.outcome,
          failureCode: input.failureCode,
          humanReviewRequired: true,
          autonomousAuthority: false,
          providerProofState: "blocked",
        };
      },
    },
    provider,
  });

  const response = await handler(rawRequest(requestBody()));
  assert.equal(response.status, 200);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].failureCode, "output_truncated");
  assert.equal(finishes[0].providerStatus, "incomplete");
  assert.equal(
    finishes[0].providerInteractionRef,
    "synthetic-incomplete-interaction",
  );
});

test("handler downgrades malformed Interaction evidence to local_error without a reference", async () => {
  for (const interaction of [
    {
      id: "synthetic-unknown-status-interaction",
      status: "future_unknown_status",
    },
    {
      status: "completed",
      output_text: JSON.stringify(proposal()),
    },
  ]) {
    const finishes = [];
    const provider = createPlatformGeminiProposalProvider(
      { apiKey: TEST_GEMINI_VALUE },
      {
        client: {
          interactions: {
            async create() {
              return interaction;
            },
          },
        },
      },
    );
    const handler = createPlatformGeminiProposalHandler({
      config: loadPlatformGeminiProposalConfig(enabledEnvironment()),
      repository: {
        async begin() {
          return {
            proposalRequestId: PROPOSAL_REQUEST_ID,
            replayed: false,
            completed: false,
            outcome: null,
            context: context(),
          };
        },
        async finish(input) {
          finishes.push(input);
          return {
            proposalRequestId: PROPOSAL_REQUEST_ID,
            replayed: false,
            outcome: input.outcome,
            failureCode: input.failureCode,
            humanReviewRequired: true,
            autonomousAuthority: false,
            providerProofState: "blocked",
          };
        },
      },
      provider,
    });

    const response = await handler(rawRequest(requestBody()));
    assert.equal(response.status, 200);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].failureCode, "provider_rejected");
    assert.equal(finishes[0].providerStatus, "local_error");
    assert.equal(finishes[0].providerInteractionRef, null);
  }
});

test("an unfinished exact replay never makes a second provider call", async () => {
  const calls = [];
  const handler = createPlatformGeminiProposalHandler({
    config: loadPlatformGeminiProposalConfig(enabledEnvironment()),
    repository: {
      async begin() {
        calls.push("begin");
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: true,
          completed: false,
          outcome: null,
          context: context(),
        };
      },
      async finish() {
        throw new Error("must not be reached");
      },
    },
    provider: {
      async createProposal() {
        calls.push("provider");
        throw new Error("must not be reached");
      },
    },
  });

  const response = await handler(rawRequest(requestBody()));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["begin"]);
  assert.deepEqual(await response.json(), {
    ok: true,
    proposal_request_id: PROPOSAL_REQUEST_ID,
    outcome: "pending",
    human_review_required: true,
    autonomous_authority: false,
    provider_proof_state: "blocked",
  });
});

test("handler maps HTTP 200 with no inline output to durable human review", async () => {
  const finishes = [];
  const handler = createPlatformGeminiProposalHandler({
    config: loadPlatformGeminiProposalConfig(enabledEnvironment()),
    repository: {
      async begin() {
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: context(),
        };
      },
      async finish(input) {
        finishes.push(input);
        return {
          proposalRequestId: PROPOSAL_REQUEST_ID,
          replayed: false,
          outcome: input.outcome,
          failureCode: input.failureCode,
          humanReviewRequired: true,
          autonomousAuthority: false,
          providerProofState: "blocked",
        };
      },
    },
    provider: {
      async createProposal() {
        return {
          interactionRef: "synthetic-empty-interaction",
          outputText: null,
          status: "completed",
        };
      },
    },
  });

  const response = await handler(rawRequest(requestBody()));
  assert.equal(response.status, 200);
  assert.equal(finishes[0].outcome, "human_review");
  assert.equal(finishes[0].failureCode, "empty_response");
  assert.equal(finishes[0].providerStatus, "completed");
});

test("route and examples keep the provider lane server-only and disabled", async () => {
  const [route, environment, packageJson] = await Promise.all([
    readFile(
      new URL(
        "../src/app/api/internal/platform-ai/gemini/proposal/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(route, /runtime = "nodejs"/);
  assert.match(environment, /EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=0/);
  assert.match(environment, /EVO_PLATFORM_GEMINI_API_KEY=/);
  assert.doesNotMatch(environment, /NEXT_PUBLIC_GEMINI/);
  assert.match(packageJson, /"@google\/genai": "2\.16\.0"/);
});
