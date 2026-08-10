# P5F AI memory and bounded autonomous reply lane

Status: authoritative docs-only implementation contract.

Block-ID: `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10`

Accepted baseline:

- merged P4R1 main SHA: `8cf46a94b79e8bc24ad49b30606753a690ea5469`
- exact-main CI run: `31402664864`
- contiguous migrations: `001-064`

This document defines the next implementation lane after merged P4R1. It does
not change product code, migration files, runtime configuration, credentials,
provider state or customer data.

## Purpose

P5F turns the accepted messaging foundation into a bounded AI-assisted reply
lane without widening scope into broad Inbox parity or deferred amoCRM writes.
The lane SHALL preserve the accepted Claude Design frontend as the sole UI
contract, SHALL keep P4B activation/writes deferred, SHALL keep P9 removed, and
SHALL retain Lead Agent plus the legacy rollback path as deployed/frozen.

## Core invariants

- Supabase SHALL own durable conversation-scoped memory, retrieval evidence,
  send-intent evidence, ACK/session linkage, pause/resume state and audit.
- Per-client filesystem agents SHALL NOT be introduced.
- Gemini server-side state, cache or finite provider retention SHALL NOT be a
  source of truth.
- amoCRM remains canonical for contact, lead, responsible manager and sales
  stage. P5F may consume bounded read-mostly context only and SHALL NOT write
  amoCRM.
- Gemini SHALL return structured proposals only. Gemini SHALL NOT call WAHA,
  SHALL NOT own retries and SHALL NOT imply send success.
- Deterministic Platform policy SHALL be the only authority that can create a
  send intent.
- Real provider proof SHALL remain explicitly blocked until sanctioned
  credentials and test identities exist.
- No mock provider success, fake embeddings/retrieval, SQLite fallback,
  hardcoded amoCRM mapping or silent degraded fallback may substitute for
  missing proof.

## P5F1 — Platform-owned memory and retrieval foundation

### Scope

- additive migration `065` for staff-controlled conversation-scoped memory,
  explicit facts, qualification state, takeover/pause state, approved-knowledge
  chunks, retrieval audit, RLS and pgvector;
- server-side retrieval helpers and audit persistence;
- safe UI/API exposure limited to approved evidence references and staff-owned
  memory controls.

### Required rules

- The embedding target SHALL be `gemini-embedding-2` at a fixed `1536`
  dimensions.
- Provider-backed embedding ingestion SHALL remain disabled by default.
- Any lexical-only retrieval preview SHALL be explicit degraded staff preview
  only. It SHALL NOT authorize deterministic autonomous replies.
- Raw WAHA IDs, phone-bearing provider IDs, raw amoCRM IDs, private retrieval
  internals and provider secrets SHALL NOT cross into public RPCs or UI.

### Acceptance

- focused schema/RLS/retrieval tests pass;
- public surfaces expose only safe evidence references and state;
- build, lint, route types and typecheck pass;
- exact-head CI is green;
- one fresh independent exact-head read-only review approves the block.

### Non-goals

- no Gemini execution;
- no WAHA send;
- no autonomous behavior;
- no production enablement;
- no amoCRM writes.

## P5F2 — Gemini structured proposal adapter

### Scope

- server-side Gemini adapter;
- bounded conversation context, bounded retrieval evidence and bounded read-only
  amoCRM context input;
- JSON-schema structured RU/EN qualification/reply proposal output;
- durable proposal audit with model, prompt and version metadata.

### Required rules

- Gemini SHALL use stateless Interactions with `store=false`.
- The model SHALL be runtime-configured through an allowlist. The P5F-specific
  initial sanctioned model SHALL be the owner-named `gemini-3.5-flash`.
  Google's current model catalog also lists `gemini-3.6-flash` as stable, but
  the older generic target note does not authorize it for P5F without a
  separate eval and plan update.
- Explicit token budgets SHALL bound the request.
- Missing credentials, malformed output, unsupported language, low confidence,
  missing evidence or unsafe semantics SHALL fail closed to durable human
  review.

### Acceptance

- focused adapter and structured-output contract tests pass;
- prompt/model/version and proposal audit persist durably;
- build, lint, route types and typecheck pass;
- exact-head CI is green;
- one fresh independent exact-head read-only review approves the block.

### Non-goals

- no send intent creation;
- no direct WAHA access;
- no provider-success claim without sanctioned credentials;
- no use of provider-retained context as canonical memory.

## P5F3 — deterministic autonomous reply gate

### Scope

- deterministic send gating;
- durable WAHA `reply_to` send intents;
- bounded worker that rechecks mutable conditions immediately before transport;
- ACK/session linkage to existing merged P5E state.

### Required rules

An autonomous reply SHALL be allowed only when all of these are true:

- same conversation and exact inbound trigger;
- inside the rolling WhatsApp `<=24h` service window;
- consent/opt-out pass;
- approved citations/evidence present;
- known language;
- confidence/risk pass;
- business-hours pass;
- cooldown/rate pass;
- takeover/pause clear;
- session health pass;
- idempotency key unused;
- matching policy version;
- autonomous-reply runtime enablement present;
- emergency stop/kill switch not engaged.

Media-only, unsupported or ambiguous input SHALL fail closed to human review.

### Acceptance

- focused policy, queue, worker and idempotency tests pass;
- deterministic recheck-before-send proof passes;
- build, lint, route types and typecheck pass;
- exact-head CI is green;
- one fresh independent exact-head read-only review approves the block.

### Non-goals

- no cold outbound;
- no campaign/broadcast;
- no autonomous follow-up or re-engagement;
- no out-of-window free-form send;
- no direct model send;
- no production enablement or live customer send proof in this lane.

## Official source basis

Gemini:

- Interactions overview:
  <https://ai.google.dev/gemini-api/docs/interactions-overview>
- Model catalog:
  <https://ai.google.dev/gemini-api/docs/models>
- Structured output:
  <https://ai.google.dev/gemini-api/docs/structured-output>
- Function calling:
  <https://ai.google.dev/gemini-api/docs/function-calling>
- Embeddings:
  <https://ai.google.dev/gemini-api/docs/embeddings>
- Gemini Embedding 2:
  <https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2>
- Caching:
  <https://ai.google.dev/gemini-api/docs/caching>
- Tokens:
  <https://ai.google.dev/gemini-api/docs/tokens>

Supabase:

- Semantic search:
  <https://supabase.com/docs/guides/ai/semantic-search>
- Hybrid search:
  <https://supabase.com/docs/guides/ai/hybrid-search>
- RAG with permissions:
  <https://supabase.com/docs/guides/ai/rag-with-permissions>
- pgvector:
  <https://supabase.com/docs/guides/database/extensions/pgvector>
- Row Level Security:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Queues:
  <https://supabase.com/docs/guides/queues>
- Realtime:
  <https://supabase.com/docs/guides/realtime/subscribing-to-database-changes>

WAHA:

- Receive messages:
  <https://waha.devlike.pro/docs/how-to/receive-messages/>
- Events:
  <https://waha.devlike.pro/docs/how-to/events/>
- Send messages:
  <https://waha.devlike.pro/docs/how-to/send-messages/>
- Sessions:
  <https://waha.devlike.pro/docs/how-to/sessions/>
- Avoid blocking:
  <https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/>

Meta WhatsApp Business Platform:

- Customer service window:
  <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages>

## Blocked proof

This lane remains blocked from claiming:

- real provider embeddings or Gemini execution without sanctioned credentials;
- live customer sends;
- production enablement;
- WAHA session mutation;
- amoCRM writes;
- cutover or retirement of Lead Agent / legacy rollback.
