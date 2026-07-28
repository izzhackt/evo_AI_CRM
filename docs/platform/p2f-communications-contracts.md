# P2F — communications, provider identity and draft-only AI contracts

- Status: frozen repository candidate; database/RLS contract only, with no
  live-provider, delivery or production claim
- Date: 2026-07-29
- Starting repository checkpoint:
  `aac1cba851e89070a7eb54baab4eddf921e3447c`
- Starting database boundary: migration 043
- Frozen additive migration: `044_platform_communications_contracts.sql`
- Parent contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Foundation contract: `docs/platform/p2-supabase-foundation.md`

## Purpose and proof boundary

P2F adds the database contract for one handoff-aware communication history:

1. conversations, participants, normalized messages and provider-event
   evidence;
2. distinct internal, WAHA, Kommo Chats and amoCRM identities;
3. raw-persist-before-process, deduplication and reconciliation state;
4. approved versioned knowledge and draft-only AI evidence;
5. human review, edit and manual-send evidence across the five Platform roles.

This slice proves only what the migration, grants, RLS policies, narrow
functions and local authorization tests actually enforce. It does not call
WAHA, Kommo Chats, amoCRM or an AI provider. It does not prove that a webhook
arrived, a provider accepted a message, a delivery/read ACK was genuine, a
model produced the stored text or a production migration was applied.

P2F deliberately does not implement:

- Supabase Queues/PGMQ, workers, visibility timeout, retry budget, dead-letter
  processing or an operational outbox; those belong to P2G;
- private buckets, media upload/download, signed URLs or scanner execution;
  those belong to P2H;
- auto-reply, unattended outbound, broadcast or mass send;
- automatic retry of an unknown provider result;
- a Kyrgyz customer-draft contract.

## Additive boundary after migration 043

Migration 043 already owns document metadata, manual finance and singular
notification intent. P2F builds on the P2D case assignment/handoff authority
and P2E notification boundary without editing migrations 001–043.

The slice remains additive:

- no legacy table rename or drop;
- no root-auth, SQLite, Inbox, Lead Agent or WAHA-session cutover;
- no Storage bucket or provider-owned schema mutation;
- no real customer payload, credential or provider token;
- no direct browser access to private raw payloads or provider-processing
  evidence.

## Identity namespaces must remain separate

A communication record may refer to several identifiers that happen to
describe the same business interaction. They are not interchangeable:

| Namespace | Owner | Platform use |
| --- | --- | --- |
| Internal UUID | EVO Platform | Stable tenant-qualified identity and foreign keys |
| WAHA session | WAHA configuration | Transport-session reference; never a Platform organization or conversation ID |
| WAHA message ID | WAHA | Provider message correlation and ACK evidence |
| Kommo conversation ID | Kommo Chats | Chats conversation mapping only |
| Kommo message ID | Kommo Chats | Chats message mapping only |
| amoCRM contact ID | amoCRM | Canonical contact link |
| amoCRM lead ID | amoCRM | Canonical lead and sales-stage link |

Every external identity is stored with its provider/account context. A bare
external ID is not globally unique and must not be copied into another
provider's column or used as an internal primary key. Mapping conflicts remain
explicit reconciliation work; the database must not silently choose one
external identity as truth for another namespace.

Phone numbers are identifiers used for resolution, not proof that two
provider records are the same person. Account-specific amoCRM mapping and
provider discovery still require real integration evidence.

## Raw persist-before-process and deduplication

The intended inbound order is:

```text
receive request
    -> evaluate authenticity at the server boundary
    -> persist private raw evidence
    -> claim one processing attempt
    -> normalize/link conversation and message
    -> record outcome or reconciliation requirement
```

The database contract must preserve received raw evidence before normalized
business processing. The private record contains provider/account/request
references, provider conversation reference where applicable, WAHA session,
event type/time, raw event variant where applicable, verification result,
private verification headers/evidence reference, raw payload and payload
SHA-256. These fields are not transcript data and are never exposed through
browser projections. P2F stores the supplied verification evidence; it does
not prove that real HMAC/timestamp verification ran.

Raw-event deduplication has two independent references for WAHA:

- transport/request reference such as `X-Webhook-Request-Id`;
- semantic raw-event reference containing provider account, WAHA session,
  event type, `payload.id` and the raw event variant where required.

For WAHA `message.ack`, `provider_event_variant_ref` preserves the raw ACK code,
including an unknown code. It is part of the semantic raw-event key so two
different ACK observations for one message are not collapsed. WAHA
`message.any` requires that variant to be `NULL`. Kommo and amoCRM raw events
have transport-request deduplication only in P2F; the schema does not invent a
semantic non-WAHA raw-event key.

Replaying the same accepted key must return or preserve the same canonical
effect, not create a second message, review or action. Reusing a request key
with different immutable input must fail closed. A processing lease or
reconciliation status in P2F is durable database state only; it is not proof
of a running Queue consumer.

Normalized reconciliation effects have a separate canonical key across the
source event, observation kind, conversation, normalized message and ACK
state, with nulls compared deterministically. Unknown outbound results are
deduplicated by their single-use manual-send authorization. This prevents one
raw event or one authorized outbound text from creating duplicate canonical
effects without pretending that the raw provider event itself was delivered.

Malformed, unauthenticated or unsupported events may be retained privately for
audit and manual reconciliation without becoming a trusted customer message.
Unknown provider codes remain raw evidence. They must not be translated into
`sent`, `delivered` or `read` merely because the database accepted a record.

## Conversation, message and handoff contract

A normalized communication retains tenant, conversation, participant,
direction, language, body and separate WAHA/Kommo/amoCRM identity references.
The message row does not claim a generalized send/delivery state. Private
provider-observation/reconciliation records may retain WAHA ACK or unknown
evidence, but P2F does not itself create provider truth.

The same conversation history survives the Sales-to-Curator handoff:

- Sales owns the working conversation before the confirmed contract handoff;
- the currently assigned Curator owns it after handoff;
- Admin may operate within the authorized organization scope;
- Finance has no transcript, raw-event or provider-identifier access by
  default;
- Student sees only safe self communication intended for the Portal, without
  internal notes, raw payload, staff-only review data or provider identifiers.

After handoff, former Sales access is limited to a fixed non-sensitive summary.
It is not a filtered base-table query and cannot reveal transcript text,
provider identifiers, raw events, AI context or internal review notes.
Assignment and handoff changes retain actor, reason, before/after scope and
time so an access decision can be reconstructed later.

Cross-organization, cross-student, previous-Curator and post-handoff Sales
transcript access must fail. Platform roles are exactly `admin`, `sales`,
`curator`, `finance` and `student`; legacy Inbox roles grant no implicit
communications authority.

## Approved knowledge and draft-only AI

AI context may reference only an explicitly approved, versioned knowledge
revision. Superseding a revision creates a new immutable version; it does not
rewrite the text or approval evidence used by an older draft. Approval retains
organization, approver, time, provenance and effective state.

An AI draft is created only after an explicit authorized staff request. Its
evidence keeps:

- requester, request key, reason, time and source message;
- detected/requested language and confidence/uncertainty state;
- provider/model reference and prompt-policy version after generation;
- immutable source context plus its SHA-256;
- selected approved knowledge versions through explicit citation links;
- original generated text or a fail-closed outcome;
- state, review text and reviewer evidence.

Only Russian (`ru`) and English (`en`) customer drafts are approved in v1. If
the language is uncertain or outside RU/EN, the record requires manual
RU/EN selection or handoff before a customer draft can be prepared. Any input
that is not confidently RU or EN is `undetermined` in this P2F contract; there
is no Kyrgyz language value or Kyrgyz customer draft.

The original AI output and its evidence are immutable. Human edits are stored
as a separate reviewed/final version linked to the original. A reviewer must
make an explicit decision; manual-send intent must identify the operator and
the exact final text plus its SHA-256 that the operator approved.

Recording review or manual-send intent is not provider delivery. A future
transport path may link the actual outbound message and provider evidence to
the reviewed version, but only after the operator clicks send and server-side
checks succeed. P2F contains no database path that turns an AI draft directly
into an unattended outbound message.

## Write and visibility boundaries

The exposed communications relations use tenant-qualified keys plus RLS and
FORCE RLS. Browser roles receive only reviewed functions/projections needed by
their role; column omission is not simulated with a permissive base-table
policy.

Protected writes are server-side only:

- raw request/event ingestion and verification result;
- provider identity linking and conflict state;
- provider message/ACK evidence;
- generated draft text, source context, provider/model/policy evidence,
  source-message/knowledge-citation linkage and draft events;
- reconciliation transitions and security/audit fields.

Backend capability is granted through narrow, signature-specific functions.
`service_role` does not receive blanket direct DML over the communications
tables, and neither `anon` nor `authenticated` receives access to
`platform_private`. Provider secrets are not stored in message, draft,
knowledge or raw-event rows.

## Status semantics and the P2G boundary

A manual-send authorization means the operator approved one exact final text
and its SHA-256. It does not mean WAHA accepted a send. A private provider
observation may record an ACK state or unknown result only as supplied
evidence. A conflicting or ambiguous observation remains
reconciliation-required.

P2F stores that evidence and provenance without a generalized delivery-status
claim. P2G must later prove the real Queue/outbox behavior that advances work:

- idempotent enqueue and consumer claims;
- visibility timeout and concurrency;
- bounded retry and dead-letter handling;
- manual reconciliation;
- the invariant that `unknown` is never automatically re-enqueued or sent.

Until P2G and a later real-provider exercise pass, no P2F row is evidence that
a Queue ran or a WhatsApp message left EVO.

## P2H media boundary

P2F messages may retain safe metadata or an opaque evidence reference. They do
not prove that an attachment exists, is private, passed malware scanning or can
be downloaded. P2H owns real local Storage API use, object policies,
cross-student denial, scanner evidence and separate object backup/restore.
Raw provider media bytes must not be copied into exposed communication rows.

## Frozen migration inventory and local evidence

The candidate under review is one exact artifact. Any byte change creates a
different candidate and requires a new checksum-bound review:

| Property | Frozen value |
| --- | --- |
| File | `supabase/migrations/044_platform_communications_contracts.sql` |
| Lines | 6,881 |
| Bytes | 194,076 |
| SHA-256 | `8d52b476981faed4a42a9c13ff2813a718bde6ad4aea1b315c4d61be9fd1ebc8` |

Its exact relation inventory is ten exposed `platform` tables:
`communication_conversations`, `conversation_handoff_events`,
`conversation_participants`, `communication_messages`,
`approved_knowledge_versions`, `ai_draft_requests`, `ai_drafts`,
`ai_draft_knowledge_citations`, `ai_draft_events` and
`manual_send_authorizations`; plus two backend-only `platform_private` tables:
`provider_webhook_events` and `provider_reconciliation_events`.

Its exact 19-function `platform` API inventory is:

- `create_communication_conversation`, `record_communication_message`,
  `append_provider_reconciliation_event`,
  `link_communication_conversation_case` and
  `record_conversation_participant`;
- `persist_provider_webhook_event`,
  `publish_approved_knowledge_version`,
  `retire_approved_knowledge_version`, `request_ai_draft`, `record_ai_draft`,
  `complete_ai_draft_generation`, `resolve_ai_draft_language`,
  `review_ai_draft` and `authorize_manual_send`;
- `staff_communication_queue`, `staff_conversation_messages`,
  `former_sales_case_summaries`, `student_portal_messages` and
  `approved_knowledge_catalog`.

The frozen `persist_provider_webhook_event` signature includes
`p_provider_event_variant_ref TEXT` immediately after
`p_provider_conversation_ref TEXT`. This is part of the checksum-bound API,
not an optional implementation note.

The repository's full disposable PostgreSQL/RLS harness passed locally against
this frozen artifact. That is local database authorization evidence only: it
does not establish managed-Supabase apply, provider authenticity, delivery,
Queue/Storage execution, production deployment or end-to-end customer
behavior.

## Candidate completion gate

P2F is ready for controller review only when this frozen migration and exact
API/grant inventory are reviewed together and focused tests prove:

- one contiguous immutable migration history through 044;
- FORCE RLS and least-privilege grants for every exposed communications
  relation;
- two-organization/two-student isolation and the five-role handoff matrix;
- distinct internal, WAHA, Kommo and amoCRM identity namespaces;
- private raw-payload containment, persist-before-process evidence,
  deduplication and reconciliation state;
- approved versioned knowledge plus immutable draft/review/edit evidence;
- RU/EN-only customer drafts and fail-closed uncertain-language behavior;
- no Kyrgyz customer draft, auto-reply, unattended outbound, broadcast or
  unknown-result automatic retry representation;
- no Queue, Storage, live-provider, managed-Supabase or production-success
  claim.

The artifact and local harness are frozen; independent SHA-bound review,
exact-head CI, controller merge and green post-merge exact-main CI remain
separate evidence gates. Real WAHA/Kommo/amoCRM/AI behavior remains a later
sanitized provider test with explicit authority.
