# EVO P5F2 Gemini Interactions Research

Research target date: `2026-08-11`
Scope: official-source research only for the EVO P5F2 stateless structured proposal adapter. No provider calls, no credential use, no runtime proof claim, and no plan/code changes outside this file.

## Concise conclusion

Google's current official Gemini Developer API docs support the exact high-level shape that P5F2 wants:

- an official `Interactions` API exists;
- stateless requests are explicitly supported with `store=false`;
- the official JavaScript/TypeScript SDK is `@google/genai`;
- structured JSON output is supported through `response_format` with a documented JSON Schema subset;
- token counting, safety settings, tool disabling, and retention caveats are documented.

The safest current implementation recommendation for P5F2 is:

1. Keep the repo contract unchanged: `gemini-3.5-flash` remains the sanctioned P5F model until the plan is explicitly updated.
2. Implement against the official `Interactions` API with `store=false`.
3. Explicitly disable tool use with `tool_choice: "none"` and omit `tools`.
4. Request `application/json` structured output with a bounded schema.
5. Validate the returned JSON in EVO after parsing it.
6. Use token preflight guards before send.

Google's current model catalog also lists `gemini-3.6-flash` as stable/GA and Google now presents it as the latest Flash model, but that is newer provider guidance, not current EVO authorization.

## Repository contract vs provider guidance

### Repository contract for P5F2

The current repo contract already fixes the P5F-specific starting model and the stateless requirement:

- [EVO_LAUNCH_PLAN.md](../EVO_LAUNCH_PLAN.md) says P5F2 "SHALL add only the Gemini proposal adapter."
- [EVO_LAUNCH_PLAN.md](../EVO_LAUNCH_PLAN.md) says Gemini "SHALL be called through stateless Interactions with storage disabled (`store=false`)."
- [EVO_LAUNCH_PLAN.md](../EVO_LAUNCH_PLAN.md) says the initial sanctioned model is the owner-named `gemini-3.5-flash`.
- [EVO_LAUNCH_PLAN.md](../EVO_LAUNCH_PLAN.md) says Google's catalog also lists `gemini-3.6-flash` as stable, but that does not authorize it for P5F without a separate eval and plan update.

The same contract is repeated in
[EVO_PLATFORM_LONG_RUN_PLAN.md](../EVO_PLATFORM_LONG_RUN_PLAN.md).

### Current Google provider guidance

Google's current official model docs present `gemini-3.6-flash` as the current latest Flash model and production-ready, while `gemini-3.5-flash` remains available and production-grade:

- Latest model guide: https://ai.google.dev/gemini-api/docs/latest-model
- Model catalog: https://ai.google.dev/gemini-api/docs/models
- Gemini 3.5 release/update page: https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5
- Changelog: https://ai.google.dev/gemini-api/docs/changelog

Decision implication:

- For EVO P5F2 implementation today, target the API shape that works for both models.
- Keep the runtime allowlist default on `gemini-3.5-flash` because that is the current repo contract.
- Treat `gemini-3.6-flash` as a later upgrade candidate that needs a separate evaluation and plan update before authorization.

## Verified official findings

### 1. The `Interactions` API exists and is the right API family for this adapter

Google officially documents an `Interactions` API reference at:

- https://ai.google.dev/api/interactions-api

That page documents:

- `POST /v1beta/interactions`
- a stable `v1` version also being available
- request fields including `model`, `input`, `store`, `response_format`, `tools`, `tool_choice`, `generation_config`, and `safety_settings`

Why this matters for EVO:

- P5F2's required shape is a stateless, proposal-only generation adapter with bounded inputs and structured JSON output.
- `Interactions` is the current official API family that documents all of those controls together.

### 2. Stateless mode is explicitly supported with `store=false`

Google's official interactions overview says requests are stored by default and documents stateless mode with `store=false`:

- Interactions overview: https://ai.google.dev/gemini-api/docs/interactions-overview

Google's zero-data-retention page states:

- "To ensure a zero-data footprint, you must explicitly set the `store` parameter to `false`."
- Source: https://ai.google.dev/gemini-api/docs/zdr

Google's logs/datasets docs also show `store: false` in the JavaScript `interactions.create(...)` example:

- https://ai.google.dev/gemini-api/docs/logs-datasets

Important documented caveats from the same official docs:

- `store=false` is incompatible with `background=true`.
- `store=false` is incompatible with `previous_interaction_id`.
- File API should not be used when absolute zero-footprint behavior is required.
- explicit context caching should not be used for zero-data-retention flows.

Why this matters for EVO:

- P5F2 should remain single-request stateless.
- It should not depend on server-side conversation continuation, background runs, File API inputs, or provider-side caching.

### 3. The official JavaScript/TypeScript SDK is `@google/genai`

Google's official SDK/library page lists the JS/TS package as:

- `npm install @google/genai`
- Source: https://ai.google.dev/gemini-api/docs/libraries

The generated SDK reference is published at:

- https://googleapis.github.io/js-genai/

Why this matters for EVO:

- If P5F2 is implemented in TypeScript/JavaScript, `@google/genai` is the official SDK to target.
- This is preferable to inventing a custom REST wrapper unless repo constraints explicitly require raw HTTP.

### 4. Current model status: `gemini-3.5-flash` remains valid, `gemini-3.6-flash` is Google's newer current Flash recommendation

Official Google model docs currently support the following reading:

- `gemini-3.6-flash` is the current latest Flash model and is presented as stable/GA in Google's latest model and changelog docs.
- `gemini-3.5-flash` remains listed in the model catalog and remains a stable production model in Google's Gemini 3.5 release/update docs.

Primary sources:

- https://ai.google.dev/gemini-api/docs/latest-model
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/changelog
- https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5

Why this matters for EVO:

- The implementation should not hard-code logic that only works for `3.6`.
- The initial allowlist default should stay `gemini-3.5-flash` because that is the sanctioned repo contract.
- Future move to `gemini-3.6-flash` should be treated as a controlled model-upgrade decision, not an opportunistic doc drift change.

### 5. Structured JSON output is officially supported through `response_format` and a JSON Schema subset

Google's structured output guide documents the current `Interactions` request shape for JSON output:

- https://ai.google.dev/gemini-api/docs/structured-output

The documented pattern is:

```json
{
  "model": "gemini-3.6-flash",
  "input": "...",
  "response_format": {
    "type": "text",
    "mime_type": "application/json",
    "schema": {
      "type": "object"
    }
  }
}
```

Google explicitly says Gemini supports only a subset of JSON Schema. The same page documents supported schema building blocks including:

- `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`
- `properties`, `required`, `additionalProperties`
- `enum`, `format`
- `minimum`, `maximum`
- `items`, `prefixItems`, `minItems`, `maxItems`

Why this matters for EVO:

- P5F2 should use a small, explicit schema for proposal output.
- The schema should not depend on obscure JSON Schema features that Google does not document as supported.

### 6. Google still expects application-side validation after parsing

The same structured output page shows the official JavaScript pattern:

```ts
const interaction = await client.interactions.create({
  model: "gemini-3.6-flash",
  input: prompt,
  response_format: {
    type: "text",
    mime_type: "application/json",
    schema: recipeJsonSchema
  },
});

const recipe = recipeSchema.parse(JSON.parse(interaction.output_text));
```

Source:

- https://ai.google.dev/gemini-api/docs/structured-output

Why this matters for EVO:

- Even with provider-side schema guidance, EVO still needs local validation.
- The safest adapter behavior is:
  - parse JSON from the returned text;
  - validate it against the local schema;
  - reject or downgrade invalid responses instead of trusting them.

### 7. Token counting and limits are officially documented

Google's token API reference documents:

- `POST /v1beta/{model=models/*}:countTokens`
- Source: https://ai.google.dev/api/tokens

Google's JS SDK reference documents model token counting methods under the models client:

- Source: https://googleapis.github.io/js-genai/release_docs/classes/models.Models.html

Google's latest model page documents for `gemini-3.6-flash`:

- `1M` context window
- `64k` maximum output tokens
- Source: https://ai.google.dev/gemini-api/docs/latest-model

Why this matters for EVO:

- P5F2 should apply local bounded context rules before request construction.
- For this disabled/unproved slice, a conservative deterministic character
  bound is preferable to adding a second provider call solely for
  `countTokens`; the provider-aware count path should be evaluated with the
  later sanctioned provider proof before production enablement.
- The adapter should cap output tokens explicitly instead of relying on provider defaults.

### 8. Safety settings and provider outcome states are documented

The `Interactions` API reference documents `safety_settings[]` and threshold controls including:

- `block_low_and_above`
- `block_medium_and_above`
- `block_only_high`
- `block_none`
- `off`

Source:

- https://ai.google.dev/api/interactions-api

Google's `generateContent` API reference documents finish reasons including:

- `STOP`
- `MAX_TOKENS`
- `SAFETY`
- `RECITATION`
- `LANGUAGE`
- `OTHER`
- `BLOCKLIST`
- `PROHIBITED_CONTENT`
- `SPII`
- `MALFORMED_FUNCTION_CALL`
- `IMAGE_SAFETY`

Source:

- https://ai.google.dev/api/generate-content

The published `@google/genai` `2.16.0` Interactions resource instead exposes
the interaction `status` (`completed`, `incomplete`, `budget_exceeded`, and
other non-clean states) rather than a GenerateContent candidate finish reason.
The adapter must preserve and evaluate that real status; it must not fabricate
`STOP` for a completed interaction.

Why this matters for EVO:

- The adapter should treat blocked, truncated, or otherwise non-clean finishes as non-authoritative proposal failures.
- A structured proposal path should not quietly continue when finish state indicates safety or truncation problems.

### 9. Tool use can and should be explicitly disabled

The `Interactions` API reference documents:

- `tools`
- `tool_choice`

It also documents `tool_choice` values including:

- `auto`
- `any`
- `none`
- `validated`

Source:

- https://ai.google.dev/api/interactions-api

Why this matters for EVO:

- P5F2 is proposal-only and must not let Gemini call external tools.
- The safest current request shape is to omit `tools` and set `tool_choice: "none"` explicitly.

### 10. Retention behavior is finite by default and must not become a source of truth

Google's interactions overview says:

- requests are stored by default;
- paid-tier retention is `55 days`;
- free-tier retention is `1 day`;
- `store=false` opts out of request storage for that interaction.

Source:

- https://ai.google.dev/gemini-api/docs/interactions-overview

Google's zero-data-retention page adds more caveats:

- avoid File API for zero-footprint flows;
- avoid explicit context caching for zero-footprint flows;
- Live API session resumption stores state up to 24 hours;
- some implicit in-memory caching may occur for up to 24 hours, but Google describes that as RAM-only rather than retained logs.

Source:

- https://ai.google.dev/gemini-api/docs/zdr

Why this matters for EVO:

- Platform memory, audit, and proposal history must remain in EVO-owned durable storage.
- Provider-side temporary or finite retention must not be treated as recoverable application state.

## Timeout, abort, and request controls

### What is verified

Google's generated JS SDK docs publish `HttpOptions` with a documented `timeout?: number` field in milliseconds:

- https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html

The exact package selected during implementation reconnaissance was
`@google/genai@2.16.0` (the npm registry's current release on the research
date, with Node `>=20`). Its published TypeScript declarations additionally
prove that:

- `interactions.create(params, options)` accepts a second request-options
  argument;
- that argument accepts `timeout`, `maxRetries`, and `fetchOptions`;
- `fetchOptions` may carry the standard `RequestInit.signal`.

Primary package evidence:

- https://www.npmjs.com/package/@google/genai/v/2.16.0
- https://github.com/googleapis/js-genai

### Safe implementation stance

- pass a bounded `timeout` in the per-call request options;
- set `maxRetries: 0` so the proposal adapter never owns an implicit transport
  retry;
- optionally pass an `AbortSignal` through `fetchOptions.signal` to stop local
  waiting, while treating it only as client-side cancellation. It does not
  prove that provider-side work stopped and must never authorize an automatic
  retry.

This verification is version-specific. A future SDK upgrade must re-check the
published type declarations and rerun the adapter contract tests.

## Safe P5F2 recommendation

For the first sanctioned P5F2 implementation:

1. Use the official `Interactions` API.
2. Use `store: false`.
3. Keep the model runtime-configurable through an allowlist, but default the P5F2 allowlist to `gemini-3.5-flash` because that is the current repo contract.
4. Explicitly set `tool_choice: "none"` and omit `tools`.
5. Request `application/json` structured output with a bounded schema that uses only the documented JSON Schema subset.
6. Parse and validate the response locally before any proposal is accepted.
7. Apply deterministic output failure handling for invalid JSON, schema mismatch, safety stop, truncation, or empty output.
8. Enforce a conservative deterministic input/context character budget and an
   explicit output-token budget. Evaluate the official provider token-counting
   call during sanctioned provider proof rather than silently adding a second
   network request here.
9. Do not use provider-side conversation continuation, File API inputs, background mode, or provider-side caching for this adapter.

## Minimal request shape to aim for

Illustrative request shape based on Google's current official docs:

```ts
const interaction = await client.interactions.create({
  model: "gemini-3.5-flash",
  input: prompt,
  store: false,
  background: false,
  response_format: {
    type: "text",
    mime_type: "application/json",
    schema: proposalSchema,
  },
  generation_config: {
    max_output_tokens: 4096,
    thinking_level: "medium",
    tool_choice: "none",
  },
});
```

This example is intentionally conservative:

- it uses the currently sanctioned EVO model, not Google's newer default recommendation;
- it stays stateless;
- it disables tools;
- it expects local response validation.

## Primary sources

- Google Gemini API Interactions API reference: https://ai.google.dev/api/interactions-api
- Google Gemini API Interactions overview: https://ai.google.dev/gemini-api/docs/interactions-overview
- Google Gemini API zero data retention: https://ai.google.dev/gemini-api/docs/zdr
- Google Gemini API logs and datasets: https://ai.google.dev/gemini-api/docs/logs-datasets
- Google Gemini API libraries / official SDKs: https://ai.google.dev/gemini-api/docs/libraries
- Google JS SDK generated reference: https://googleapis.github.io/js-genai/
- Google Gemini API structured output guide: https://ai.google.dev/gemini-api/docs/structured-output
- Google Gemini API token counting reference: https://ai.google.dev/api/tokens
- Google JS SDK models reference: https://googleapis.github.io/js-genai/release_docs/classes/models.Models.html
- Google Gemini API latest model guide: https://ai.google.dev/gemini-api/docs/latest-model
- Google Gemini API model catalog: https://ai.google.dev/gemini-api/docs/models
- Google Gemini API changelog: https://ai.google.dev/gemini-api/docs/changelog
- Google Gemini 3.5 update page: https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5
- Google Gemini API generate content reference for finish reasons: https://ai.google.dev/api/generate-content
- Google JS SDK `HttpOptions` reference: https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html
