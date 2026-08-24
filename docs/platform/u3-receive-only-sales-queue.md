# U3 — receive-only WhatsApp into canonical Sales

Status: active repository/disposable-local implementation contract for issue
#380 on 2026-08-24.

Authority: issue #376, issue #380, ADR 0020, U2 contract, and the 2026-08-24
U3 entry in `docs/PLAN_CHANGES.md`.

## Outcome

U3 accepts a signed inbound WAHA event through one private canonical platform
ingress, verifies the exact raw bytes, persists immutable provider evidence
before downstream processing, deduplicates webhook retries and event aliases,
links supported inbound direct messages to the U2 canonical client/lead model,
and makes the resulting intake visible inside connected `/sales`.

This slice is receive-only. It does not send WhatsApp, write amoCRM, activate a
real WAHA session, or claim provider/production proof.

## Current-main gap map

Canonical current ingress:

- `src/app/api/internal/platform-messaging/waha/events/route.ts`
- `src/lib/server/platform-waha-ingress-repository.ts`
- `src/lib/server/platform-waha-webhook.ts`

Legacy or source-only paths:

- `src/app/api/webhooks/waha/route.ts` still writes through legacy local
  `receiveWhatsApp(...)` flow after shallow HMAC validation and text-only
  checks. It cannot become a fallback path for U3.
- `src/app/api/internal/lead-agent/whatsapp/route.ts` still requires
  `amoAccountId`, `amoLeadId`, and `amoContactId`, which makes it a pre-U2
  identity authority path rather than canonical EVO intake.

What current main already provides correctly:

- exact raw-body bounded reads and SHA-512 webhook HMAC verification;
- bounded request metadata validation, stale-signature rejection, and fail-closed
  session checks;
- durable verified provider-event persistence before enqueue;
- business-work deduplication that treats `message` and `message.any` as one
  work family while preserving distinct signed deliveries as evidence;
- durable queue claim/lease/retry/dead-letter foundation;
- explicit terminal dispositions for `fromMe`, API-originated, unsupported
  chats, and direction-unverified events;
- truthful manual-review marker for media-only/empty-body inbound content;
- bounded connected `/sales` reads through canonical lead RPCs with no SQLite
  fallback.

What still leaks pre-U2 assumptions on current main:

- `supabase/migrations/060_platform_waha_work_projection.sql` still creates
  `platform_intake` conversations and `platform_private.waha_direct_chat_bindings`
  keyed by normalized WAHA chat IDs rather than by U2 canonical client/lead
  authority;
- the same projection still carries `amocrm_*` conversation fields and old
  WAHA account/session constants such as `provider_account_ref = 'waha:evo-inbox'`;
- current projection creates communication records, but the active contract does
  not yet prove that supported inbound messages create or reuse canonical
  clients/leads and therefore become visible through connected `/sales`;
- `docs/EVO_LAUNCH_PLAN.md`, `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`,
  `CONTEXT.md`, and ADR 0020 current-slice metadata were stale relative to
  the merged U0-U2 baseline before this U3 contract refresh.

## Reuse points from U2

U2 already added the canonical data model and private create-or-link helpers:

- `platform_private.create_or_link_client(...)`
- `platform_private.create_or_link_lead(...)`
- canonical `communication_conversations.canonical_client_id`
- canonical `communication_conversations.canonical_lead_id`
- bounded lead/client page and detail RPCs in migration 084

U3 should reuse these database-enforced seams rather than inventing a parallel
identity path.

## Primary-source notes

Documented provider/platform behavior used by this contract:

- WAHA Events:
  <https://waha.devlike.pro/docs/how-to/events/>
  WAHA documents `X-Webhook-Request-Id`, `X-Webhook-Timestamp`,
  `X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm`, an HMAC over the exact raw
  request body, configurable retry policies, and event envelopes. WAHA does
  not define EVO's accepted timestamp-freshness window, HTTP retry-status
  policy, or webhook exactly-once semantics; those remain defensive EVO
  decisions and are tested as such.
- WAHA Receive Messages:
  <https://waha.devlike.pro/docs/how-to/receive-messages/>
  WAHA message payloads document fields such as `fromMe`, `source`, `chatId`,
  `from`, `hasMedia`, `body`, and message identifiers that must be handled
  truthfully.
- Supabase RLS:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
  Exposed browser-facing data requires both correct grants and RLS policies.
- Supabase Queues:
  <https://supabase.com/docs/guides/queues>
  Supabase Queues documents durable delivery and exactly-once delivery within a
  configurable visibility window. EVO still owns its business idempotency,
  terminal classification, operational visibility, and durable projection
  receipt.
- Supabase JavaScript range behavior:
  <https://supabase.com/docs/reference/javascript/using-modifiers-range>
  Range bounds are inclusive, so deterministic pagination must account for that.
- Supabase default select limit:
  <https://supabase.com/docs/reference/javascript/v1/select>
  Default API reads may cap at 1,000 rows, so U3 must keep explicit bounded
  keyset pagination for queue/history traversal.

Implementation recommendation, not provider fact:

- keep one private canonical ingress and one canonical projection path;
- use U2 create-or-link helpers with WAHA external identifiers as provenance,
  not authority;
- expose only safe projections in connected Sales while keeping raw provider
  evidence private.

## U3 database and UI decisions

Migration 085 is forward-only and keeps migrations 001-084 immutable. It owns
these additive seams:

1. A private database-enforced linkage runs inside the existing
   `project_claimed_waha_event(...)` transaction. A newly bound, supported
   direct inbound chat must create or reuse the canonical client and lead
   through the exact `organization + session + normalized direct-chat`
   external identity and then set both canonical IDs on the conversation.
   Failure rolls back the projection, so the durable work item cannot receive
   a success receipt without canonical linkage.
2. The only initial lead state created by U3 is `stage_key = new_inbound`,
   `source_key = whatsapp`, and the already configured intake Sales
   membership as the minimum routing owner. Qualification, reassignment and
   next action remain U4.
3. The client display name is a masked WhatsApp label. A normalized direct-chat
   phone may be stored as evidence, but an existing phone-only or name-only
   match is never silently reused. The U2 create-or-link API creates a distinct
   canonical intake plus duplicate-review candidates when similarity is
   ambiguous.
4. `platform.staff_waha_sales_intake_page(...)` is the safe operational
   projection. It keeps raw payloads and provider message/request identifiers
   private, applies tenant, permission, object-scope, state and search filters
   before a capped `(sort_at, work_item_id)` keyset, and exposes only
   `queued`, `retrying`, `received`, `manual_review`, `unsupported`,
   and `terminal_failure`.
5. Connected `/sales` presents that intake page beside the canonical lead
   list. Supported entries link to the canonical lead and a nested receive-only
   transcript under `/sales/{lead}/conversations/{conversation}`; that route
   contains no reply, AI, send or amoCRM mutation controls.
6. Admin may review every safe organization intake row. Sales sees only its
   configured/authorized intake scope. Curator sees a row only when the
   existing U1 communication object-scope grants access; a pre-handoff Sales
   intake is therefore correctly absent for Curator. Invalid, inactive,
   suspended, stale and cross-organization authorities fail closed.
7. Exact WAHA chat identity and event references remain private idempotency
   evidence. Authenticated canonical-table policies exclude WAHA provenance,
   and both public canonical client/lead detail RPCs apply the same explicit
   filter so a security-definer execution cannot return `@c.us` or
   `waha-event:` values to the browser.

Distinct signed delivery request IDs remain immutable audit observations in
the existing provider-event audit ledger. The stable WAHA message identity,
not a delivery request ID, remains the downstream business idempotency key, so
`message` / `message.any` aliases and retries cannot duplicate canonical or
communication records.

## Implementation targets

- add the next forward-only migration after 084 if canonical WAHA linkage needs
  schema or SQL changes;
- keep `src/app/api/internal/platform-messaging/waha/events/route.ts` as the
  only canonical ingress;
- preserve legacy routes only as explicit legacy/source-only paths;
- update projection so supported direct inbound WAHA messages create or reuse
  the correct canonical client and lead through exact WAHA external identity,
  without silent phone-only merges;
- ensure conversation/message projections carry canonical client/lead linkage
  that connected `/sales` can truthfully surface;
- replace any U3-relevant unbounded queue or history read with explicit capped
  keyset pagination and stable cursor semantics;
- keep authorization grants and RLS least-privilege and tested for Sales,
  Curator, Admin, anonymous, inactive, suspended, stale-token, and
  cross-organization actors.

## Required proof

Focused proof must cover:

- raw-body HMAC acceptance and stale/invalid/wrong-session rejection;
- persist-before-process and no-acknowledge-on-persistence-failure;
- idempotent redelivery and `message` / `message.any` alias behavior;
- canonical client/lead create-or-link through WAHA identity;
- duplicate-review evidence for ambiguous phone-only similarity;
- `fromMe` and unsupported/provider variants never becoming inbound Sales work;
- visible manual-review disposition for media-only or partial inbound content;
- bounded Sales queue and message-history traversal beyond 1,000 rows;
- connected `/sales` and canonical lead detail showing real seeded inbound data;
- direct RLS, canonical detail RPC, and browser proof that raw WAHA chat/event
  identifiers remain private while non-WAHA canonical provenance still works;
- no outbound WAHA or amoCRM mutation path reachable from U3;
- truthful empty and unavailable states.

Acceptance uses an official-shape synthetic WAHA payload, a freshly generated
real HMAC, the actual Next.js ingress and worker routes, and real disposable
local Supabase/PostgreSQL/Auth/PostgREST/browser paths. Mocks remain limited to
focused error branches.

Repository/local proof deliberately does not prove a managed migration, live
WAHA delivery/retry behavior, a real customer conversation, amoCRM behavior,
backup/restore, deployment or production rollback. Application rollback hides
the new connected UI and stops the disabled-by-default local worker/ingress;
it does not drop migration 085 or canonical history.
