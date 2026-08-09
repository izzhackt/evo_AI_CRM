# P5B WAHA work projection

Status: implementation evidence only. The worker and P5A ingress are disabled
by default. No production migration, scheduler, webhook switch, provider call,
WhatsApp send, amoCRM write or Lead Agent change is authorized by this block.

## Purpose

P5A stores every verified WAHA observation before it creates durable work. P5B
adds the next receive-side step: claim only `provider_webhook_process` work for
one organization and project the immutable event into the existing Platform
conversation and message models that feed the accepted root `/whatsapp`
frontend. This first projection block claims only
inbound `message`/`message.any` work. Signed `message.ack` and `session.status`
work remains queued and untouched for the next independently reviewed P5 block.

A verified direct message without non-empty text is not discarded. P5B keeps
the immutable raw event and private WAHA identity, projects a fixed
operator-visible system marker into the accepted thread, and appends a durable
Sales handoff event requiring human review. This includes media-only messages
until a later block adds private media download, Storage persistence and safe
rendering. The marker is not customer-authored content, and P5B does not infer,
download or interpret the media.

This is deliberately not a CRM resolver. A WAHA-only conversation has no
fabricated Kommo or amoCRM identifiers. It uses an explicitly configured,
active Platform Sales membership only as the pre-contract **intake queue
operator**. The row is marked `sales_authority_source = 'platform_intake'`;
that marker and the assignment are immutable, and they must not be described as
amoCRM's responsible Sales. Canonical contact/lead identity, responsible Sales,
stage and handoff stay unavailable until deferred P4 resumes.

P4 must reconcile a `platform_intake` row through a later reviewed migration
and evidence-backed adapter operation that atomically binds the canonical
amoCRM identifiers, changes the responsible membership when necessary and
changes the authority source to `provider_linked`. P5B intentionally provides
no generic update or silent conversion path.

## Runtime flow

1. The signed P5A webhook persists `platform_private.provider_webhook_events`
   and enqueues a pointer-only durable item.
2. A private scheduler calls
   `POST /api/internal/platform-messaging/waha/work` with no body and these
   headers:
   - `X-Evo-Worker-Request-Id`: a new UUID for one trigger attempt;
   - `X-Evo-Worker-Timestamp`: current Unix time in milliseconds;
   - `X-Evo-Worker-Hmac-Algorithm: sha256`;
   - `X-Evo-Worker-Hmac`: lowercase HMAC-SHA256 of
     `<request-id>.<timestamp>` using the private worker trigger secret.
3. The route rejects stale, malformed or incorrectly signed requests before it
   touches the queue.
4. The service-only claim RPC leases only inbound WAHA message work for the
   configured organization, exact session `evo-inbox` and exact account
   reference `waha:evo-inbox`. Another verified WAHA session remains untouched;
   ACK, session-status, AI-draft and manual-send work also remain untouched.
   A stale/bypassed row with an invalid raw envelope, direction or API source is
   still leased inside that narrow lane so the projector can record a terminal
   audited outcome instead of leaving poisoned work queued forever.
5. The service-only projector revalidates the lease, source event, signed raw
   direction and tenant boundary before writing an idempotent receive-side
   effect. Bodyless/media-only input follows the same identity checks, then
   receives the fixed system marker and an append-only handoff to the configured
   intake Sales operator instead of a terminal missing-body outcome.
6. Only after the projection returns a bounded disposition does the worker call
   the service-only, tenant-bound WAHA finish wrapper. It delegates to the
   existing durable finish contract but repairs the older terminal envelope by
   returning the validated organization/work/attempt tuple. Invalid responses
   or repository failures are not acknowledged; the lease expires for safe
   retry.

The trigger request ID and deterministic projection/finish request IDs make an
authenticated scheduler replay repeat-safe. The worker never calls WAHA, so it
cannot create an ambiguous outbound result.

## Configuration

All values are server-only. The browser still receives only the Supabase
publishable key.

```dotenv
EVO_PLATFORM_WAHA_INGRESS_ENABLED=0
EVO_PLATFORM_WAHA_WORKER_ENABLED=0
EVO_PLATFORM_ORGANIZATION_ID=
EVO_PLATFORM_SUPABASE_SECRET_KEY=
EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=
EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=
EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET=
```

Both feature flags must be explicitly enabled. The database independently
checks that the configured intake Sales membership is active, belongs to the
same organization, has a current organization scope and uses a published Sales
bundle containing `organization.read` and `communication.read.full`. Adding a
new live-checked conversation scope does not rotate `access_version`, so inbound
traffic does not invalidate the operator's otherwise-current session;
revocation and reassignment remain separate audited operations.

The public customer participant stores only an opaque random reference derived
from its generated participant UUID. The full WAHA chat identifier is retained
only in the private binding table; it is never copied or deterministically
hashed into an exposed participant row.

WAHA message IDs may themselves embed the full chat identifier. P5B therefore
stores each raw message ID only in a second private append-only binding. The
exposed Platform message keeps both WAHA identity columns null; later ACK
reconciliation must use the private binding rather than re-exposing that raw
provider value.

An immutable `message_identity_source = private_waha_binding` marker is the
only shape allowed to omit every public provider message ID. A deferred
database constraint requires the exact private WAHA binding to exist before
the projection transaction can commit, so the marker cannot become a silent
identity fallback.

For bodyless/media-only input, the handoff uses the verified source webhook
event UUID as its deterministic request identity. Replays therefore cannot add
another handoff before or after the terminal projection effect is stored. The
conversation remains in the Platform intake Sales queue; this is human-review
assignment evidence, not an amoCRM ownership claim or canonical sales handoff.

## Evidence and provider boundary

Local proof must include the focused Node tests, disposable PostgreSQL/RLS
suite, migration reset and existing authenticated `/whatsapp` read-path tests.
The browser proof must include a signed bodyless/media-only event, the private
worker, the visible system marker, one readable handoff event and the absence
of raw chat/message identifiers in the accepted frontend and public RPC rows.
Synthetic event bodies prove parsing, idempotency and authorization only; they
are not WAHA provider proof.

Real provider proof remains blocked on separately authorized credentials, test
number, WAHA session/webhook mutation and controlled cutover. The legacy Lead
Agent/webhook/session path remains deployed and frozen as rollback.

Implementation constraints follow the current primary documentation:

- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase PGMQ functions and visibility timeout](https://supabase.com/docs/guides/queues/pgmq)
- [WAHA event payloads, `message.any` and ACKs](https://waha.devlike.pro/docs/how-to/events/)
- [WAHA receive-message identifiers](https://waha.devlike.pro/docs/how-to/receive-messages/)
