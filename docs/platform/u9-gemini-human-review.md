# U9 Gemini Flash human-review contract

Status: verified local implementation candidate for Issue #386
Date: 2026-08-26 (Asia/Dubai)
Parent: #376
Depends on: #385
Blocks: #387

Dependency evidence: #385 merged through PR #400 at exact main
`e3a681774bcb2c37a7f4c1600341cc16d6282892`; push run `33013322714`
completed successfully before U9 publication. This evidence unlocks the U9
repository/PR gate only. It does not prove Gemini, managed Supabase or
production behavior.

## Outcome in plain language

Gemini may prepare advice for an EVO employee, but it cannot do the employee's
work. The employee sees what the model used, what it is unsure about and a
complete structured suggestion. The employee must Accept it, Edit and accept
it, or Reject it. That decision only records review evidence; it never sends a
message or changes an external or operational record.

## Canonical product boundary

U9 extends the existing connected Platform conversation and its canonical
`gemini_proposal_requests` / `gemini_proposal_results` proposal path from
migration 066. It does not create a parallel AI request/result authority,
revive the legacy Anthropic API, add a second CRM, create a browser-side
provider or replace the existing deterministic workflow controls.

The canonical U9 record is bound to:

- one organization;
- one accepted Platform conversation;
- one latest inbound source message;
- the connected Student Case when one exists;
- one requesting active staff membership;
- bounded approved-knowledge and message source references.

The existing proposal lifecycle remains:

- `pending`: the authorized request exists but has no provider result yet;
- `proposal_ready`: a locally validated structured result is ready;
- `human_review`: configuration, privacy, provider or validation did not allow
  a usable suggestion and records the exact bounded failure code.

U9 adds an append-only decision bound to the exact `proposal_ready` request and
result. Its decision is `accepted`, `edited` or `rejected`; this decision does
not rewrite the immutable provider result. Exact request IDs replay the
committed result, and different payloads may not reuse them.

## One server-side provider

The only U9 provider is Google Gemini through the server-side Platform adapter.
The pinned model is `gemini-3.7-flash`.

The request contract is:

- Gemini Interactions API;
- `store: false`;
- no tools, Search grounding, File API, cache or provider-side conversation
  continuation;
- bounded output and request timeout;
- a JSON Schema response format;
- only the latest necessary message plus bounded approved knowledge excerpts;
- opaque source IDs that the model may cite, but cannot invent;
- no secrets, attachments, raw exports or full conversation archive.

Schema version 2 keeps the complete schema-version-1 proposal contract and adds
these operator-facing fields:

- `summary`;
- `next_action`;
- `draft_internal_note`;
- `missing_document_suggestion` or `null`;
- `deadline_warning` or `null`;
- `limitations`;
- `uncertainty` (`low`, `medium` or `high`).

The existing `intent` is the intent/state classification, `reply_text` is the
draft reply, and the existing structured `citations` are the canonical source
references. U9 does not add duplicate `intent_state`, `draft_reply` or
`source_ids` authorities. Historical schema-version-1 results remain readable;
only new U9 generations use schema version 2 and `gemini-3.7-flash`.

EVO validates exact keys, types, byte limits, enumerations and cited source IDs
after parsing the provider JSON. Schema-conforming JSON is still untrusted
input. The database validates the persisted shape again.

## Truthful blocked outcomes

The UI and audit history distinguish these bounded outcomes:

- existing configuration/access/privacy failure codes from migration 066;
- `provider_timeout`;
- `provider_rate_limited`;
- provider authentication/permission/request/server failure codes;
- `malformed_output`;
- persistence failure.

No raw provider response, credential, prompt body or customer text is included
in an error returned to the browser or written to audit metadata.

## Human review

The review UI shows every structured field, the exact source references, model,
generation time, limitations and uncertainty. An authorized staff member can:

- Accept the exact generated bundle;
- Edit the editable fields and accept the normalized result;
- Reject the bundle with a reason.

Every review stores actor membership, time, reason, decision and SHA-256 of the
accepted/edited content. Generated provider content remains immutable. Review
events are append-only and bounded in the read model.

Accept/Edit/Reject performs no WhatsApp send, amoCRM write, owner/stage change,
payment confirmation, document approval, task completion or handoff execution.
A later deterministic action would need its own permission, idempotency and
provider gate.

## Authorization

- Browser roles never insert or update proposal or U9 review tables directly.
- Existing request/read RPCs remain canonical; the new review RPC and read model
  resolve the current authenticated actor again in PostgreSQL.
- Active `admin`, `sales` and assigned/authorized `curator` scope follows the
  accepted conversation authorization contract.
- Cross-organization, inactive, stale, suspended, unrelated and malformed
  access fails closed.
- Provider completion is service-only and can complete only the exact pending
  request/context it was given.

## Required isolated proof

- strict provider request proves `gemini-3.7-flash`, `store: false`, no tools,
  bounded timeout and JSON Schema output;
- valid structured output is normalized; extra keys, malformed JSON, unknown
  source IDs and oversized content are rejected;
- missing privacy approval/configuration, timeout, rate, permission and service
  failure become truthful blocked outcomes;
- successful suggestion shows provenance, model, time, limitations and
  uncertainty;
- Accept, Edit and Reject are each visible and audited;
- unauthorized, cross-organization and inactive reads/reviews are denied;
- review creates no outbox/provider/external mutation;
- full disposable-local, lint, typecheck, build, exact-head and exact-main
  gates remain green.

## Evidence boundary

Repository, synthetic-provider and disposable-local Supabase evidence proves
the contract only. It does not prove a valid paid Gemini project, approved data
terms, production credentials, provider availability for real customer data,
managed Supabase, deployment or production behavior.

## Official references

- Interactions API and storage behavior:
  <https://ai.google.dev/gemini-api/docs/interactions-overview>
- Structured JSON output:
  <https://ai.google.dev/gemini-api/docs/structured-output>
- Stable Gemini 3.7 Flash model:
  <https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash>
- Provider error classes:
  <https://ai.google.dev/gemini-api/docs/generate-content/api-errors>
- Zero-data-retention considerations:
  <https://ai.google.dev/gemini-api/docs/zdr>
