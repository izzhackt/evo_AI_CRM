import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlatformGeminiProvider,
  PlatformGeminiProviderError,
} from "../src/lib/server/platform-gemini-provider.ts";

const schemaV2 = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "reply_text"],
  properties: {
    schema_version: { const: 2 },
    reply_text: { type: "string" },
  },
});

const validProposal = Object.freeze({
  schema_version: 2,
  language: "ru",
  intent: "admissions_discovery",
  confidence: 88,
  risk: "low",
  handoff_required: false,
  handoff_reasons: [],
  citations: [
    {
      knowledge_key: "admissions.malaysia",
      knowledge_version: 3,
      evidence_ordinal: 1,
    },
  ],
  memory_changes: [
    {
      fact_key: "preferred_country",
      action: "set",
      value: "Malaysia",
      confidence: 91,
    },
  ],
  qualification: {
    status: "collecting",
    completeness: 55,
    missing_fact_keys: ["budget_signal"],
    notes: "Нужно уточнить бюджет.",
  },
  reply_text: "Здравствуйте! Уточните, пожалуйста, ваш бюджет.",
  summary: "Клиент рассматривает обучение в Малайзии.",
  next_action: "Уточнить бюджет и желаемую программу.",
  draft_internal_note: "Предпочтительная страна: Малайзия.",
  missing_document_suggestion: null,
  deadline_warning: null,
  limitations: ["Бюджет и программа ещё не подтверждены."],
  uncertainty: "medium",
});

test("Gemini provider sends the caller's exact model, prompt, schema and abort signal", async () => {
  let capturedApiKey;
  let capturedRequest;
  const provider = createPlatformGeminiProvider(
    "technical-test-key-not-a-secret",
    {
      createClient(apiKey) {
        capturedApiKey = apiKey;
        return {
          models: {
            async generateContent(request) {
              capturedRequest = request;
              return {
                text: JSON.stringify(validProposal),
                responseId: "gemini-response-123",
                modelVersion: "gemini-3.7-flash-001",
                usageMetadata: {
                  promptTokenCount: 120,
                  candidatesTokenCount: 64,
                  totalTokenCount: 184,
                },
              };
            },
          },
        };
      },
    },
  );

  const result = await provider.generateStructuredProposal({
    model: "gemini-3.7-flash",
    prompt: "Private bounded proposal context",
    responseJsonSchema: schemaV2,
    timeoutMs: 15_000,
    maxOutputTokens: 2_048,
    temperature: 0.2,
  });

  assert.equal(capturedApiKey, "technical-test-key-not-a-secret");
  assert.equal(capturedRequest.model, "gemini-3.7-flash");
  assert.equal(capturedRequest.contents, "Private bounded proposal context");
  assert.equal(capturedRequest.config.responseMimeType, "application/json");
  assert.equal(capturedRequest.config.responseJsonSchema, schemaV2);
  assert.equal(capturedRequest.config.maxOutputTokens, 2_048);
  assert.equal(capturedRequest.config.temperature, 0.2);
  assert.equal(capturedRequest.config.candidateCount, 1);
  assert.equal(capturedRequest.config.abortSignal instanceof AbortSignal, true);
  assert.deepEqual(capturedRequest.config.httpOptions, {
    timeout: 15_000,
    retryOptions: { attempts: 1 },
  });
  assert.deepEqual(result, {
    providerInteractionRef: "gemini-response-123",
    providerStatus: "completed",
    responseJson: validProposal,
    evidence: {
      responseId: "gemini-response-123",
      modelVersion: "gemini-3.7-flash-001",
      usage: {
        promptTokenCount: 120,
        candidatesTokenCount: 64,
        totalTokenCount: 184,
      },
    },
  });
});

test("Gemini provider rejects a structurally invalid schema-v2 proposal", async () => {
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            return {
              text: JSON.stringify({ ...validProposal, hidden_fallback: "do not use" }),
              responseId: "gemini-response-invalid",
            };
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "invalid_proposal" &&
      error.providerInteractionRef === "gemini-response-invalid",
  );
});

test("Gemini provider categorizes malformed JSON without leaking provider output", async () => {
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            return {
              text: "not-json-with-private-provider-output",
              responseId: "gemini-response-malformed",
            };
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) => {
      assert.equal(error instanceof PlatformGeminiProviderError, true);
      assert.equal(error.code, "malformed_response");
      assert.equal(error.providerInteractionRef, "gemini-response-malformed");
      assert.equal(error.message.includes("private-provider-output"), false);
      return true;
    },
  );
});

test("Gemini provider rejects a response larger than the database result bound", async () => {
  const oversizedProposal = {
    ...validProposal,
    citations: [
      {
        knowledge_key: `a${"b".repeat(33_000)}`,
        knowledge_version: 1,
        evidence_ordinal: 1,
      },
    ],
  };
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            return {
              text: JSON.stringify(oversizedProposal),
              responseId: "gemini-response-oversized",
            };
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "malformed_response" &&
      error.providerInteractionRef === "gemini-response-oversized",
  );
});

test("Gemini provider reports an empty provider response explicitly", async () => {
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            return { text: "", responseId: "gemini-response-empty" };
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "empty_response" &&
      error.providerInteractionRef === "gemini-response-empty",
  );
});

test("Gemini provider never accepts a MAX_TOKENS response as a complete proposal", async () => {
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            return {
              text: JSON.stringify(validProposal),
              responseId: "gemini-response-truncated",
              candidates: [{ finishReason: "MAX_TOKENS" }],
            };
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "output_truncated" &&
      error.providerInteractionRef === "gemini-response-truncated",
  );
});

test("Gemini provider rejects a safety-blocked candidate even when text is present", async () => {
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            return {
              text: JSON.stringify(validProposal),
              responseId: "gemini-response-blocked",
              candidates: [{ finishReason: "SAFETY" }],
            };
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "provider_rejected" &&
      error.providerInteractionRef === "gemini-response-blocked",
  );
});

test("Gemini provider aborts a slow SDK request and returns provider_timeout", async () => {
  let calls = 0;
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          generateContent(request) {
            calls += 1;
            return new Promise((resolve, reject) => {
              request.config.abortSignal.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            });
          },
        },
      };
    },
  });

  await assert.rejects(
    provider.generateStructuredProposal({
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 5,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    }),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "provider_timeout" &&
      error.providerInteractionRef === null,
  );
  assert.equal(calls, 1);
});

test("Gemini provider maps SDK HTTP failures to stable database-compatible categories", async () => {
  for (const [status, expectedCode] of [
    [408, "provider_timeout"],
    [401, "provider_authentication_failed"],
    [403, "provider_forbidden"],
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
    [400, "provider_rejected"],
  ]) {
    const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
      createClient() {
        return {
          models: {
            async generateContent() {
              throw Object.assign(new Error("SDK request failed"), { status });
            },
          },
        };
      },
    });

    await assert.rejects(
      provider.generateStructuredProposal({
        model: "gemini-3.7-flash",
        prompt: "Private bounded proposal context",
        responseJsonSchema: schemaV2,
        timeoutMs: 15_000,
        maxOutputTokens: 2_048,
        temperature: 0.2,
      }),
      (error) =>
        error instanceof PlatformGeminiProviderError &&
        error.code === expectedCode &&
        error.providerInteractionRef === null,
    );
  }
});

test("Gemini provider requires trustworthy bounded response evidence", async () => {
  for (const response of [
    { text: JSON.stringify(validProposal) },
    {
      text: JSON.stringify(validProposal),
      responseId: "gemini-response-evidence",
      modelVersion: " ",
    },
    {
      text: JSON.stringify(validProposal),
      responseId: "gemini-response-evidence",
      usageMetadata: { totalTokenCount: -1 },
    },
  ]) {
    const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
      createClient() {
        return {
          models: {
            async generateContent() {
              return response;
            },
          },
        };
      },
    });

    await assert.rejects(
      provider.generateStructuredProposal({
        model: "gemini-3.7-flash",
        prompt: "Private bounded proposal context",
        responseJsonSchema: schemaV2,
        timeoutMs: 15_000,
        maxOutputTokens: 2_048,
        temperature: 0.2,
      }),
      (error) =>
        error instanceof PlatformGeminiProviderError &&
        error.code === "malformed_response",
    );
  }
});

test("Gemini provider fails closed on missing credentials or invalid caller inputs", async () => {
  assert.throws(
    () => createPlatformGeminiProvider(""),
    (error) =>
      error instanceof PlatformGeminiProviderError &&
      error.code === "configuration_missing",
  );

  let calls = 0;
  const provider = createPlatformGeminiProvider("technical-test-key-not-a-secret", {
    createClient() {
      return {
        models: {
          async generateContent() {
            calls += 1;
            return {
              text: JSON.stringify(validProposal),
              responseId: "should-not-be-called",
            };
          },
        },
      };
    },
  });

  for (const invalidInput of [
    {
      model: " ",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    },
    {
      model: "gemini-3.7-flash",
      prompt: "",
      responseJsonSchema: schemaV2,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    },
    {
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: null,
      timeoutMs: 15_000,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    },
    {
      model: "gemini-3.7-flash",
      prompt: "Private bounded proposal context",
      responseJsonSchema: schemaV2,
      timeoutMs: 0,
      maxOutputTokens: 2_048,
      temperature: 0.2,
    },
  ]) {
    await assert.rejects(
      provider.generateStructuredProposal(invalidInput),
      (error) =>
        error instanceof PlatformGeminiProviderError &&
        error.code === "configuration_missing",
    );
  }
  assert.equal(calls, 0);
});
