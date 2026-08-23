# ADR 0019: Gate autonomous inbound replies and resume read-only amoCRM

- Status: superseded by ADR 0020; retained as historical fail-closed evidence
- Date: 2026-08-09
- Accepted main checkpoint:
  `8dbc99c578a9bad0750a04cb322f26a2fe68b1c0`
- Plan block: `EVO-MVP-AUTONOMOUS-INBOUND-PLAN-2026-08-09`
- Refines: ADR 0014 messaging semantics and ADR 0016 thin-slice scope
- Supersedes in conflict: ADR 0018 only where it fully defers P4 and limits P5
  to draft-only AI/manual send
- Retains: ADR 0018 Lead Agent/legacy-path freeze and production/provider gates
- Superseded by: ADR 0020, including its autonomous-reply and canonical amoCRM
  clauses

ADR 0005 remains historical companion-app context. It is not the current
Platform AI authority.

## Context

PR #132 merged P5A receive-only WAHA ingress at the accepted checkpoint. P5A
verifies the signed webhook, persists the raw event before processing and
enqueues pointer-only durable work. Migration history is contiguous through
`059`. This is repository evidence, not real WAHA, Supabase, Gemini, amoCRM or
production proof.

PR #133 is a draft P5B receive/project candidate. P5B does not call Gemini or
WAHA send APIs. It is blocked until this authority amendment is accepted and a
valid media-only inbound is persisted, projected for the operator and handed
off rather than terminally consumed because text is absent. P5B is not merged.

The owner now approves a later, narrower autonomous lane: a reply to an inbound
customer message inside the rolling WhatsApp 24-hour service window. The owner
also resumes a bounded read-mostly amoCRM adapter without approving writes or
cutover. These decisions require explicit precedence over the blanket
draft-only and full-deferral language in ADR 0014, ADR 0016 and ADR 0018.

## Decision

### Product and system boundary

1. The accepted Claude Design root frontend remains the sole Platform UI.
   Platform work must not introduce a fallback, parallel Inbox UI or legacy
   root-data path.
2. The Platform remains greenfield and Supabase-native. There is no SQLite or
   legacy-account import, root-auth migration, dual-read or dual-write bridge.
3. WAHA remains a private transport adapter. Browsers do not connect directly
   to WAHA and WAHA does not own policy, lead memory or durable audit.
4. Supabase owns durable ingress and outbound work, decision evidence, lead
   memory, approved pgvector knowledge retrieval, send attempts, ACK/session
   reconciliation, pause/resume history and audit. The accepted root UI moves
   from polling to private Supabase Realtime in a later implementation block.

### Allowed autonomous lane

An autonomous customer send is allowed only when every condition below is true:

- a customer inbound message is the exact trigger in the same conversation;
- the reply is still inside the rolling 24-hour service window opened by that
  customer message;
- every deterministic gate passes immediately before queueing and again before
  transport send;
- the reply is grounded in recent conversation context, durable lead memory and
  any required approved knowledge chunks;
- the WAHA session is healthy and the send has a fresh unused idempotency key.

The MVP does not authorize cold outbound, broadcasts, campaigns, autonomous
follow-up or re-engagement, or out-of-window free-form sends. It does not
authorize model-direct WAHA calls.

### Proposal, policy and evidence

Gemini returns a structured qualification/reply proposal. At minimum it carries
intent, confidence, risk, handoff requirement, cited knowledge identifiers,
proposed memory changes and proposed reply text. It never reports or decides
that a message was sent.

Deterministic EVO policy evaluates the proposal and is the only authority that
may create an autonomous send intent. Supabase retains the inbound trigger,
model and prompt version, policy version, immutable source context and hash,
approved-knowledge evidence, structured proposal, every gate input and result,
rendered outbound text and hash, transport response, ACK/session progression,
and later human action.

### Human control and fail-closed rules

A staff outbound message or explicit takeover immediately creates a durable
autonomy pause for the conversation. Only an authorized staff actor may resume
autonomy, with actor, reason and time recorded. A model response, reconnect or
new inbound message cannot clear the pause.

Autonomy fails closed to human review for any of these conditions:

- opt-out or missing reply authority;
- outside organization-configured business hours, using
  `Asia/Bishkek 09:00-21:00` until that configuration exists;
- unsupported or uncertain language;
- media-only or otherwise unsupported content;
- low confidence or missing approved knowledge;
- complaint, anger or abuse;
- payment, refund or price-exception handling;
- legal or privacy questions;
- admission, scholarship or visa guarantees;
- unhealthy or uncertain WAHA session state;
- an unknown or ambiguous provider result.

An unknown send result is never retried automatically.

### Media-only inbound

A valid media-only inbound is a real customer event. P5B must retain its raw
event and private provider/media references, create an operator-visible
conversation/message state and open human review. Missing text must not mark the
event successfully completed without that projection and handoff. Autonomous
media understanding remains disabled until separately approved.

### Bounded read-mostly amoCRM adapter

amoCRM remains canonical for contact, lead, responsible sales manager and sales
stage. The resumed adapter may read those values and read references to sales
tasks, calls/recordings and chat records. EVO stores foreign keys, verified
mapping/version evidence and the minimum read projection required by the UI.
Platform operational tasks remain separate from amoCRM sales tasks.

This decision authorizes no real amoCRM write, stage change, task/note/file
creation, inferred mapping, name-based identity claim, hardcoded account ID or
silent fallback. Missing credentials, scopes, account-specific mappings or
conflicting identity fail closed. Full write support and provider cutover remain
separate owner-authorized gates.

## P5B receive/project implementation authority

P5B remains strictly a receive/project worker. It must not generate AI output,
queue outbound work or call a provider send API.

### Private worker and HMAC

- A private scheduler may trigger a no-body server route for one bounded work
  attempt. The current reviewed route shape is
  `POST /api/internal/platform-messaging/waha/work`.
- The request carries `X-Evo-Worker-Request-Id` as a new UUID,
  `X-Evo-Worker-Timestamp` in milliseconds,
  `X-Evo-Worker-Hmac-Algorithm: sha256` and `X-Evo-Worker-Hmac` as lowercase
  HMAC-SHA256 over `<request-id>.<timestamp>` using a dedicated server-only
  worker secret that is separate from webhook and provider secrets.
- The route rejects missing, malformed, stale or invalid signatures before it
  touches the queue. Browser sessions and provider webhook secrets cannot invoke
  this worker.

### Schema, identity and RPC boundary

- `platform_private` owns raw events, full WAHA chat/message bindings, queue
  pointers, leases, attempts and diagnostics. `platform` exposes only RLS-safe
  conversation/message projections and review state.
- The current candidate makes `platform_private.waha_direct_chat_bindings`,
  `platform_private.waha_message_bindings`, projection effects and replay
  requests private. Browser grants to those relations are prohibited.
- Platform UUIDs, WAHA IDs, amoCRM IDs and Kommo chat IDs remain separate.
  Public participant identifiers are opaque; full WAHA chat/message identifiers
  remain private.
- A pre-resolution intake assignment must be explicitly marked as Platform
  intake authority and must never be described as amoCRM responsible Sales.
  Only verified read-mostly amoCRM evidence may bind canonical contact, lead,
  responsible or stage references.
- Service code uses narrow organization-, session- and account-bound RPCs to
  claim, project and finish one work item. The candidate names are
  `platform.claim_waha_webhook_work`,
  `platform.project_claimed_waha_event` and
  `platform.finish_waha_webhook_work`; their exact signatures and grants remain
  implementation-review evidence, not blanket authority. Generic service-role
  DML and client-selectable organization/session/identity are prohibited.
- Current main owns migrations `001-059`. The P5B candidate may use additive
  migration `060` only after a fresh next-free-number and ownership check;
  this ADR does not reserve the number.

### Lease, retry and dead-letter behavior

- Queue payloads remain pointer-only. Claim returns one validated work item and
  bounded lease; projector and finish RPCs revalidate the organization, source
  event, direction, session, account, lease and idempotency identity.
- A retryable receive/project failure leaves the item unacknowledged so its
  lease can expire. Retry budget is finite; exhausted deterministic processing
  moves to immutable dead-letter/manual-review evidence.
- Exact replay is idempotent. Conflicting replay fails closed and cannot create
  a second conversation, message or action.
- Valid media-only input follows the operator-visible handoff rule above; it is
  not a successful no-op.
- A later autonomous send intent is single-use. Unknown or ambiguous transport
  outcome goes to reconciliation and human review, never automatic retry or a
  second send attempt.

### Rollback and retained legacy path

P5A ingress, P5B worker and every later autonomous-send component remain
disabled by default. Rollback disables the new worker/autonomy flags while
retaining immutable raw, queue, decision and audit evidence. It does not delete
rows, reverse an applied migration or silently transfer webhook ownership.

EVO Lead Agent, its legacy webhook/session and the rollback path remain
deployed and frozen. Retirement, deactivation or deletion is not authorized.

## Enablement and proof gate

PR #133 must remain draft/blocked until the authority amendment and media-only
fix are present and independently reviewed. A later P5 autonomous-reply PR may
start only after receive history, media, ACK/session reconciliation and private
Realtime are accepted. It must use separately reviewed deterministic queue and
worker gates.

All new paths remain disabled by default until an explicitly authorized real
provider E2E proves, with a sanitized test identity and number:

1. signed inbound persistence before processing;
2. operator-visible text and media projection;
3. read-mostly canonical amoCRM resolution or explicit fail-closed handoff;
4. Gemini structured proposal and complete deterministic gate evidence;
5. one eligible queued reply through WAHA and ACK/session reconciliation;
6. forced-human outcomes, takeover/pause, authorized resume and unknown-result
   no-retry behavior;
7. private Realtime visibility and rollback without duplicate processing.

This ADR and its documentation PR perform no provider, Supabase, production,
WAHA session/webhook or amoCRM mutation.

## Consequences and precedence

- ADR 0014 remains the target architecture, but its blanket draft-only and
  no-auto-reply statements are refined to the bounded inbound-reply lane above.
- ADR 0016 remains authoritative for the sole UI and greenfield data boundary;
  its thin messaging slice now includes the gated lane without adding CRM,
  campaign or fallback UI surfaces.
- ADR 0018 still freezes Lead Agent and prohibits unapproved provider/production
  mutation. Its full P4 deferral and P5 draft-only restriction are superseded
  only by the read-mostly adapter and gated lane in this ADR.
- ADR 0005 remains unchanged as historical companion launch context.
- P5A is merged; P5B and autonomous provider send are not merged or proven.

## Primary source basis

- [EVO autonomous-send research](../research/evo-mvp-autonomous-send-2026-08-09.md)
- [EVO WAHA, Realtime and memory research](../research/evo-mvp-waha-ai-memory-2026-08-09.md)
- [EVO amoCRM/Kommo integration research](../research/evo-mvp-amocrm-integration-2026-08-09.md)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
- [WAHA events](https://waha.devlike.pro/docs/how-to/events/)
- [WAHA sessions](https://waha.devlike.pro/docs/how-to/sessions/)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Kommo leads](https://developers.kommo.com/reference/leads-list)
- [Kommo chat history](https://developers.kommo.com/reference/chat-history)
