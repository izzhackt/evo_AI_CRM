import assert from "node:assert/strict";
import test from "node:test";

import {
  CanonicalGeminiProposalConfigurationError,
  loadCanonicalGeminiProposalConfig,
} from "../src/lib/server/canonical-gemini-proposal-config.ts";
import {
  buildCanonicalGeminiInteractionRequest,
  CanonicalGeminiProposalProviderError,
  mapCanonicalGeminiProviderFailure,
  normalizeCanonicalGeminiInteraction,
} from "../src/lib/server/canonical-gemini-proposal-client.ts";
import {
  CANONICAL_GEMINI_PROPOSAL_JSON_SCHEMA,
  CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
  CanonicalGeminiProposalOutputError,
  parseCanonicalGeminiProposalOutput,
} from "../src/lib/canonical-gemini-proposal-contract.ts";

const readyEnvironment = Object.freeze({
  EVO_V2_GEMINI_PROPOSALS_ENABLED: "1",
  EVO_V2_GEMINI_PROVIDER_AUTHORIZED: "1",
  EVO_V2_GEMINI_MODEL: "gemini-3.5-flash",
  EVO_V2_GEMINI_API_KEY: "technical-key-not-a-real-secret",
  EVO_V2_GEMINI_TIMEOUT_MS: "12000",
});

test("canonical Gemini is disabled by default and has no implicit model", () => {
  assert.deepEqual(loadCanonicalGeminiProposalConfig({}), {
    status: "blocked",
    reason: "feature_disabled",
  });

  assert.deepEqual(
    loadCanonicalGeminiProposalConfig({
      EVO_V2_GEMINI_PROPOSALS_ENABLED: "1",
      EVO_V2_GEMINI_PROVIDER_AUTHORIZED: "0",
    }),
    {
      status: "blocked",
      reason: "provider_not_authorized",
    },
  );
});

test("canonical Gemini requires explicit authorization, model, and server key", () => {
  assert.deepEqual(
    loadCanonicalGeminiProposalConfig({
      EVO_V2_GEMINI_PROPOSALS_ENABLED: "1",
      EVO_V2_GEMINI_PROVIDER_AUTHORIZED: "1",
    }),
    {
      status: "blocked",
      reason: "configuration_missing",
      missing: ["api_key", "model"],
    },
  );

  const ready = loadCanonicalGeminiProposalConfig(readyEnvironment);
  assert.equal(ready.status, "ready");
  assert.equal(ready.model, "gemini-3.5-flash");
  assert.equal(ready.apiKey, "technical-key-not-a-real-secret");
  assert.equal(ready.timeoutMs, 12_000);
  assert.equal("supabaseUrl" in ready, false);
  assert.equal("hmacSecret" in ready, false);
});

test("canonical Gemini rejects malformed control flags instead of guessing", () => {
  for (const [environment, code] of [
    [{ EVO_V2_GEMINI_PROPOSALS_ENABLED: "true" }, "invalid_enabled_flag"],
    [
      {
        EVO_V2_GEMINI_PROPOSALS_ENABLED: "1",
        EVO_V2_GEMINI_PROVIDER_AUTHORIZED: "yes",
      },
      "invalid_authorization_flag",
    ],
  ]) {
    assert.throws(
      () => loadCanonicalGeminiProposalConfig(environment),
      (error) =>
        error instanceof CanonicalGeminiProposalConfigurationError &&
        error.code === code,
    );
  }
});

test("Interactions request is stateless, synchronous, tool-free, and structured", () => {
  const request = buildCanonicalGeminiInteractionRequest({
    model: "gemini-3.5-flash",
    systemInstruction: "technical system instruction",
    prompt: "technical prompt",
    timeoutMs: 12_000,
  });

  assert.deepEqual(request.params, {
    model: "gemini-3.5-flash",
    input: "technical prompt",
    system_instruction: "technical system instruction",
    store: false,
    background: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: CANONICAL_GEMINI_PROPOSAL_JSON_SCHEMA,
    },
    generation_config: {
      max_output_tokens: 2_048,
      tool_choice: "none",
    },
  });
  assert.deepEqual(request.options, { timeout: 12_000, maxRetries: 0 });
  assert.equal("tools" in request.params, false);
});

test("provider interaction normalization accepts only completed non-empty output", () => {
  assert.deepEqual(
    normalizeCanonicalGeminiInteraction({
      id: "interaction-technical",
      status: "completed",
      created: "2026-08-29T08:15:30Z",
      output_text: JSON.stringify({
        schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
        reply_text: "Спасибо за сообщение. Уточните, пожалуйста, желаемую страну.",
      }),
      errors: [],
    }),
    {
      interactionRef: "interaction-technical",
      providerCreatedAt: "2026-08-29T08:15:30Z",
      outputText: JSON.stringify({
        schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
        reply_text: "Спасибо за сообщение. Уточните, пожалуйста, желаемую страну.",
      }),
    },
  );

  assert.deepEqual(
    normalizeCanonicalGeminiInteraction({
      status: "completed",
      created: "2026-08-29T08:15:31Z",
      output_text: JSON.stringify({
        schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
        reply_text: "Спасибо. Уточните, пожалуйста, желаемую программу.",
      }),
      errors: [],
    }),
    {
      interactionRef: null,
      providerCreatedAt: "2026-08-29T08:15:31Z",
      outputText: JSON.stringify({
        schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
        reply_text: "Спасибо. Уточните, пожалуйста, желаемую программу.",
      }),
    },
  );

  for (const interaction of [
    {
      id: "failed",
      status: "failed",
      created: "2026-08-29T08:15:30Z",
      output_text: null,
      errors: [],
    },
    {
      id: "errored",
      status: "completed",
      created: "2026-08-29T08:15:30Z",
      output_text: "{}",
      errors: [{}],
    },
    {
      id: "empty",
      status: "completed",
      created: "2026-08-29T08:15:30Z",
      output_text: "   ",
      errors: [],
    },
    {
      id: "missing-created",
      status: "completed",
      output_text: "{}",
      errors: [],
    },
    {
      id: "invalid-created",
      status: "completed",
      created: "not-a-provider-timestamp",
      output_text: "{}",
      errors: [],
    },
  ]) {
    assert.throws(
      () => normalizeCanonicalGeminiInteraction(interaction),
      (error) => error instanceof CanonicalGeminiProposalProviderError,
    );
  }
});

test("current Interactions SDK HTTP failures preserve truthful provider reasons", () => {
  const invalidKey = mapCanonicalGeminiProviderFailure({
    name: "BadRequestError",
    status: 400,
    statusCode: 400,
    body: JSON.stringify([
      {
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      },
    ]),
  });
  assert.equal(invalidKey.code, "provider_authentication_failed");

  for (const [status, code] of [
    [403, "provider_forbidden"],
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
    [400, "provider_rejected"],
  ]) {
    assert.equal(
      mapCanonicalGeminiProviderFailure({ status, statusCode: status }).code,
      code,
    );
  }
});

test("application parser treats structured JSON as untrusted business input", () => {
  const accepted = parseCanonicalGeminiProposalOutput(
    JSON.stringify({
      schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
      reply_text:
        "Спасибо за сообщение. Уточните, пожалуйста, программу и желаемый срок поступления.",
    }),
  );
  assert.equal(
    accepted.replyText,
    "Спасибо за сообщение. Уточните, пожалуйста, программу и желаемый срок поступления.",
  );

  for (const raw of [
    "not-json",
    JSON.stringify({
      schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
      reply_text: "Мы гарантируем поступление.",
    }),
    JSON.stringify({
      schema_version: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
      reply_text: "Корректный текст",
      fallback_text: "hidden alternate",
    }),
  ]) {
    assert.throws(
      () => parseCanonicalGeminiProposalOutput(raw),
      (error) => error instanceof CanonicalGeminiProposalOutputError,
    );
  }
});

test("application parser preserves safe multiline WhatsApp copy", () => {
  assert.deepEqual(
    parseCanonicalGeminiProposalOutput(
      JSON.stringify({
        schema_version: "evo-gemini-proposal-v1",
        reply_text: "Здравствуйте!\r\n\r\nУточните, пожалуйста, страну обучения.",
      }),
    ),
    {
      schemaVersion: "evo-gemini-proposal-v1",
      replyText: "Здравствуйте!\n\nУточните, пожалуйста, страну обучения.",
    },
  );
});
