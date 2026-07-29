# P2G durable work, retry and reconciliation contract

- Owner: технический ответственный EVO Admissions
- Snapshot date: 2026-07-29
- Starting checkpoint: `8567455f281fa157fb088970db1c2a2397850843`
- Plan block: P2G
- Provider proof: `not-required` for local Queue mechanics; no external
  provider call is authorized or claimed

## Outcome and boundary

P2G adds the first real retryable work primitive for the target EVO Platform.
It uses the PGMQ extension shipped with local Supabase PostgreSQL rather than a
mock table, in-memory worker or at-most-once `pop()`. The repository contract is
implemented by forward-only migration
`045_platform_durable_work_queues.sql`.
The frozen candidate is 3,425 lines, 91,620 bytes, SHA-256
`a657c32c3dadec369b54157914a229b112c58beb395ee4a2ae99025d804723a2`.

This block proves only database, Queue, idempotency, retry, dead-letter,
reconciliation and authorization behavior in disposable local environments.
It does not:

- call WAHA, amoCRM/Kommo or an AI provider;
- send a WhatsApp message;
- activate an auto-reply, broadcast or unattended outbound worker;
- apply a migration to managed staging or production;
- change a production session, webhook or service.

The underlying behavior follows the official
[Supabase Queues guide](https://supabase.com/docs/guides/queues),
[Queues API](https://supabase.com/docs/guides/queues/api) and
[PGMQ project documentation](https://github.com/pgmq/pgmq). `read()` with a
visibility timeout is the claim primitive. `set_vt()` changes the retry/lease
deadline for the same message. Successful or terminal work leaves the active
queue through `archive()`.

## Fixed Queue and payload contract

Only two hard-coded queues exist:

- `platform_work_v1` — active retryable work;
- `platform_dead_letter_v1` — pointer-only terminal failure evidence that no
  active worker polls.

Callers cannot supply a queue name. A Queue message contains exactly:

```json
{
  "v": 1,
  "work_item_id": "00000000-0000-0000-0000-000000000000",
  "kind": "provider_webhook_process"
}
```

Customer text, phone numbers, provider payloads, verification headers, secrets,
tokens, prompts and error details are forbidden in Queue messages. They remain
in the appropriate RLS-protected or backend-only rows and are referenced by an
internal UUID.

The v1 work kinds are deliberately narrow:

- `provider_webhook_process` accepts only a verified, persisted P2F webhook
  event;
- `ai_draft_generate` accepts only an explicit P2F draft request;
- `manual_whatsapp_send` accepts only one exact P2F manual-send authorization.

There is no work kind for auto-reply, broadcast, mass send or free-form
outbound text.

## Durable state and idempotency

Backend-only tables retain:

- the current work item and its exact source reference;
- every claim/attempt and lease;
- append-only state-transition events;
- exhausted/terminal dead-letter evidence;
- request-id replay results and business-key hashes.

The business key is stored as a lowercase 64-character SHA-256 value. An exact
replay returns the original result. Reusing the same key with a different kind,
organization or source fails closed. A manual-send authorization can be bound
to at most one work item, so duplicate Queue delivery cannot make a second send
eligible.

`claim_durable_work` calls `pgmq.read()` and records the returned `msg_id` and
`read_ct`. Concurrent consumers therefore skip each other's locked/invisible
messages. Completion requires the current non-expired attempt; a stale worker
cannot commit after another consumer has reclaimed the item.

Retryable failure keeps the same PGMQ message and uses `set_vt()` with an
explicit delay. Once the attempt budget is exhausted, the active message is
archived, an immutable dead-letter row is written and a pointer-only record is
placed on `platform_dead_letter_v1`.

## Unknown delivery and conflict

An unknown provider result is not an ordinary failure:

1. it is valid only for `manual_whatsapp_send`;
2. manual-send work has exactly one attempt;
3. the active Queue message is archived immediately;
4. the exact one-use manual authorization is recorded in P2F reconciliation
   evidence;
5. an Admin review case is opened;
6. no retry or dead-letter message is created.

Waiting beyond the old visibility timeout therefore cannot make the work
visible again. If a worker lease expires before a send result is recorded, the
database treats that ambiguity as `unknown_manual_review`, archives the active
message and opens the same reconciliation path instead of reclaiming or
dead-lettering it. Resolving the review case records reason, before/after state
and audit evidence but never sends, requeues or reuses the authorization. A
later send requires a new human-reviewed draft/final text and a new manual
authorization.

A reconciliation conflict follows the same no-retry/manual-review boundary and
is valid only for persisted webhook-processing work.

## Authorization

The five Platform roles remain unchanged. Versioned permissions
`workreview.read` and `workreview.resolve` belong only to the Admin bundle.
Admin access is still restricted to the actor's organization. Other staff,
Students, anonymous callers and cross-organization Admins receive no review
case or event rows.

Queue schemas/tables and backend work ledgers are outside browser access.
`anon`, `authenticated`, `supabase_auth_admin` and browser sessions cannot
invoke Queue mutation RPCs. `service_role` also receives no direct `pgmq`
access; it can execute only the reviewed hard-coded Platform functions.

Every exposed relation has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL
SECURITY`. Direct table mutation remains denied; Admin review resolution uses
one reason-required, replay-safe audited RPC.

## Evidence gate

Before the P2G PR can be approved, the exact candidate must demonstrate:

- a clean 001–045 migration replay on the pinned Supabase PostgreSQL image;
- real PGMQ concurrent claims, rollback, visibility expiry and same-message
  retry;
- exact replay and conflicting-replay behavior;
- success archive and exhausted-work dead-letter evidence;
- unknown-result absence from both active and dead-letter queues after the
  former visibility deadline;
- browser/service ACL and cross-role/cross-organization negative tests;
- immutable migration history and no secret/PII leakage;
- the full repository gates required by launch-control.

The migration-specific gates are green:

- disposable Supabase PostgreSQL 17/PGMQ, migrations 001–045 plus RLS,
  inventory and real Queue runtime: log SHA-256
  `f4efe1bc74e5216f93d533b5f6e2bdd78d1138e841e68d296446f7535e751c44`;
- project-local Supabase CLI 2.110.0 clean reset, Auth/PostgREST checks and the
  same Queue runtime: log SHA-256
  `1575a5e8b01668bc485cc400fdbedb25b89be00a05ef1c6f6ba8cdef2c9c6eb2`.

Both gates used only synthetic `example.invalid` identities and disposable
local containers/stacks. Independent SHA-bound review, exact-head CI and the
full repository gates remain required before controller merge.

Passing these tests is still not real-provider proof, managed Supabase parity,
deployment approval or production completion.
