# P5F2 Gemini Proposal Adapter

Status: implementation contract for block
`EVO-P5F2-GEMINI-PROPOSALS-2026-08-11`.

## Purpose

P5F2 turns a bounded, exact inbound Platform conversation state into one
structured Gemini proposal for durable staff review. Gemini is a reasoning
component only. It is not durable memory, deterministic policy, a queue, a
WhatsApp transport, or evidence that anything was sent.

## Execution boundary

- The route is internal, POST-only and authenticated with a dedicated HMAC
  secret over the exact raw body.
- Execution is enabled only when `EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED` is
  exactly `1`.
- The only allowed model is `gemini-3.5-flash`.
- The request uses the official Interactions API with `store=false`,
  `background=false`, no `previous_interaction_id`, no tools,
  `tool_choice="none"`, bounded generation output, a bounded timeout and no SDK
  retry.
- The browser submits no prompt, model name, provider identifier, retrieval
  text or source context.

## Source contract

The service begins from an exact organization, conversation and source Platform
message UUID. Supabase validates that the source is the conversation's latest
message and that it is inbound, then returns a bounded
server-only context containing:

- recent Platform message direction, safe text and time;
- current P5F1 memory, facts, qualification and staff-control state;
- bounded approved-knowledge evidence and private chunk text when present;
- the safe P4R1 canonical amoCRM names/status projection when present.

The context contains no raw WAHA chat/message identifier, phone-bearing
provider identifier, raw amoCRM entity identifier or secret.

## Proposal contract

The JSON-schema result is exact and bounded. It carries:

- schema version and `ru` or `en` language;
- intent, confidence and risk;
- explicit handoff flag and bounded reason codes;
- citations that must be a subset of the supplied approved evidence;
- proposed P5F1 fact and qualification changes, never direct writes;
- one bounded reply text.

EVO parses and validates the JSON after the SDK returns it. Unsupported
language, unknown keys/enums, invalid bounds, ungrounded citations, unsafe
semantics, empty/truncated output or any provider/configuration error becomes a
durable human-review outcome.

## Persistence and visibility

Private append-only rows retain the exact input hash, private bounded context,
provider outcome/reference, structured response and failure evidence. Only a
safe staff RPC is public. The accepted `/whatsapp` conversation may show the
safe proposal/review status, but not the private prompt, private knowledge
text, provider interaction reference, hashes or raw identifiers.

Every P5F2 result reports `autonomous_authority=false`. P5F3 is the only future
slice allowed to evaluate deterministic send gates and create a send intent.

## Non-goals

- no WAHA call or outbound message;
- no transport retry or send-success claim;
- no amoCRM write;
- no direct memory/fact/qualification mutation;
- no background Gemini job or provider-side conversation state;
- no consumption of the mixed legacy durable-work queue;
- no real-provider proof without sanctioned credentials and approved data.

## Rollback

Keep the execution flag off, revert server/UI code and forward-fix additive
migration `066` only. P5F1, P4R1, Lead Agent and the legacy rollback path remain
unchanged.
