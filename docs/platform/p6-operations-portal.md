# P6 operations and Student Portal contract

Status: authoritative docs-only implementation contract.

Plan Block-ID: `EVO-P6-OPERATIONS-PORTAL-PLAN-2026-08-11`

Accepted baseline:

- merged P5F3 main SHA: `81ae079594baaa4a453501a99ad0ed5c3ba408d6`
- exact-main CI run: `31514964102`
- contiguous migrations: `001-067`

This document decomposes P6 before implementation. It changes no product code,
migration, runtime configuration, provider state, credential, customer data or
production service.

## Purpose

P6 finishes the amoCRM-independent operational and Student Portal path behind
the accepted Claude Design frontend. It reuses the Supabase-native admissions,
document, finance and notification foundations already merged in P2D, P2E and
BW7. It does not copy the legacy SQLite staff notification feed and does not
infer sales identity, responsible Sales, sales stage, contract handoff or
Portal activation from local data.

P6 is complete only after the P6A, P6B, P6C and P6D gates below are each
reviewed, merged and proved. P6A-P6C alone are not broad P6 completion.

## Existing foundation and current gap

Migration `043_platform_documents_finance_notifications.sql` already provides:

- durable notification, delivery-intent and append-only event tables;
- `platform.create_individual_notification(...)`, which creates one `in_app`
  and one consent-gated `individual_whatsapp` intent but performs no send;
- actor-bound `platform.my_notifications()` with no provider IDs, consent
  evidence or staff internals;
- `platform.mark_own_notification_read(...)`, restricted to the current active
  Student and their own visible case;
- the reviewed staff document boundary
  `platform.review_document_version(...)`.

The accepted `/portal/notifications` page does not use those durable rows. It
currently derives presentation rows from `student_portal_updates`, whose
repository deliberately reports no unread state. No application path calls the
read acknowledgement RPC, no business event publishes a durable Student
notification, and no private Realtime invalidation refreshes the page.

The current public notification pair is also not an exact in-app-only P6
contract. `platform.create_individual_notification(...)` creates both `in_app`
and `individual_whatsapp` intents, while `platform.my_notifications()` expects
both channels to exist. P6 therefore cannot claim an in-app-only behavior
simply by wiring those two public functions unchanged.

The Portal already derives clear next actions for rejected documents, required
documents, tasks, pending payments and overdue payments. P6 must preserve that
safe visible behavior; it must not manufacture a deadline or write a durable
notification merely because a page was read.

## Core invariants

- GitHub `main` and immutable migrations `001-067` remain the shared source of
  truth. Any schema change begins at the next free migration.
- The accepted Claude Design frontend remains the sole Platform UI; P6 may wire
  data and states but must not redesign it.
- All Student reads are session-derived, self-only and fail closed through
  exact RPC response validation. The browser never chooses an organization,
  membership or student case to expand its authority.
- Base notification tables remain deny-by-default. Browser writes occur only
  through reviewed `SECURITY DEFINER` RPCs with a fixed `search_path`, live
  authorization and exact object scope.
- Realtime carries only a private invalidation signal. The client refetches the
  authorized RPC; notification body, case identifiers and provider state are
  not broadcast as payload.
- Every new P6 application/producer path is guarded by an exact server-side
  feature flag that is disabled by default and enabled only in its dedicated
  disposable proof.
- A durable `individual_whatsapp` intent is not a send, delivery or provider
  proof. P6 does not claim, route or dispatch that intent.
- No P6 path calls WAHA, creates a communication message, resolves a phone
  number, enables outbound automation or reuses the P5 autonomous transport.
- The legacy staff `/notifications` feed remains a separate read-only legacy
  surface. P6 does not silently turn it into the Platform notification model.
- P4B mapping activation and amoCRM writes remain deferred. P4R context remains
  read-only and cannot authorize a P6 operation.
- Individual WhatsApp notification delivery remains a separate future target;
  this P6 amendment neither cancels nor activates it.

## P6A — read-only overdue Portal actions

### Scope

P6A is the thinnest real Student Portal slice with no notification side effect:

1. Reuse existing Platform-owned task, document and finance projections plus
   the accepted `nextAction` synthesis on `/portal` and `/portal/payments`.
2. Add a clearly labelled read-only "requires attention" group to
   `/portal/notifications`; it is not an unread notification and has no
   acknowledgement control.
3. Keep the state derived only from authoritative Platform values such as an
   explicit due time, confirmed payments, valid refunds, review outcomes and
   task deadlines. Outstanding payment state comes from the fixed finance
   projection, not a browser calculation.
4. Preserve two-Student/cross-organization isolation and fail-closed response
   handling through the existing repository/session seams.

P6A must not create a notification record, must not enqueue a scheduler and
must not mutate any overdue state merely because a page was read.

### Acceptance

- The intended Student sees overdue and attention state in the accepted Portal
  from existing Platform projections only.
- No route in this block creates a durable notification, intent, event or
  provider work item.
- A second Student in the same organization and a Student in another
  organization cannot read the first Student's Portal actions.
- Anonymous, inactive, wrong-role, stale-authority and malformed-topic paths
  fail closed.
- The Portal response and DOM expose no provider IDs, raw consent evidence,
  staff-internal fields, phone-bearing identifiers or private state.
- No WAHA request, provider queue claim, notification row, communication row or
  delivery claim is made.

### Non-goals

- durable notification publication;
- read acknowledgement;
- live individual WhatsApp notification delivery;
- staff-recipient durable notifications or migration of the legacy staff feed;
- time-based overdue notification synthesis;
- changes to document Storage/scanning or Student Profile automation;
- real provider, managed Supabase, staging or production proof.

## P6B — durable in-app-only Student Portal notifications

P6B starts only after P6A is accepted. It adds the first durable notification
publication/read lifecycle and reuses P6A's authoritative Portal state rather
than inventing a new source of truth.

### Scope

1. Add a new versioned in-app-only notification projection and read
   acknowledgement contract over the existing durable tables. It may wrap or
   replace the current public RPC pair, but it must not require a WhatsApp
   intent.
2. Replace update-derived rows on `/portal/notifications` with that exact safe
   in-app-only projection.
3. Add the first deterministic producer at an existing reviewed human event:
   a document result of `correction_required` or `rejected`.
4. Make review and notification publication atomic or durably retriable with
   one exact source event, deterministic dedupe and no duplicate notification.
   Migration `043` stays immutable; additive migration `068` may add a narrow
   wrapper, projection or creator if the current public RPC pair cannot provide
   that guarantee.
5. Add private, authorization-bound Realtime invalidation so an open Portal
   notification view refetches without manual reload or public payload.

P6B accepts only the in-app visibility/read path. It must not create a new
`individual_whatsapp` intent in this block, and it must not label any dormant
historical WhatsApp intent as sent or delivered.

### Acceptance

- One authorized staff document review produces exactly one durable Student
  in-app-only notification for the same scoped case.
- The intended Student sees it in the accepted Portal without a manual reload,
  can mark only that notification read, and sees the persisted state after
  reload.
- A second Student in the same organization and a Student in another
  organization cannot read, acknowledge or subscribe to it.
- Anonymous, inactive, wrong-role, stale-authority and malformed-topic paths
  fail closed.
- The Portal response and DOM expose no provider IDs, raw consent evidence,
  staff-internal fields, phone-bearing identifiers or private Realtime topic.
- The producer is idempotent and review failure cannot leave a success-looking
  notification; notification failure cannot be reported as a completed atomic
  review-and-notify action.
- No WAHA request, provider queue claim, `individual_whatsapp` intent,
  communication row or delivery claim is made.

### Non-goals

- live individual WhatsApp notification delivery;
- dormant or active creation of new WhatsApp notification intents;
- staff-recipient durable notifications or migration of the legacy staff feed;
- time-based overdue notification synthesis;
- changes to document Storage/scanning or Student Profile automation;
- real provider, managed Supabase, staging or production proof.

## P6C — overdue transition notifications

P6C starts only after P6B is accepted. It adds one Platform-owned,
idempotent transition producer; it must not synthesize writes during a page
read.

### Ordered scope

1. Explicit Platform task `due_at` transitions first.
2. Explicit payment-obligation due time and evidence-backed outstanding balance
   second.
3. Application deadlines only after an authoritative Platform deadline field
   and owner are proved; no inferred or fabricated deadline is allowed.

The producer must have a single documented scheduler/owner, a bounded batch,
an exact HMAC-authenticated internal trigger, transition-version dedupe and a
durable request/result audit. It rechecks the current Platform state in the
same transaction that publishes the notification. Runtime execution is
disabled by default in every environment except an explicit disposable proof.

P6C uses the accepted P6B Portal read/acknowledgement path. It still does not
dispatch the dormant individual-WhatsApp intent.

### Overdue acceptance

- before-due, first-overdue, duplicate-run, resolved, reopened and concurrent
  worker cases are deterministic and replay-safe;
- only explicit Platform-owned due data participates;
- task/payment permissions and case scope remain unchanged;
- two-Student and cross-organization isolation pass in SQL and browser proof;
- no read-time write, SQLite fallback, amoCRM inference or provider call occurs.

## P6D — cross-domain P6 closure

P6D is a gap-closing integration proof, not a rewrite of foundations that are
already merged. Before implementation it inventories the accepted frontend
against existing P2D/P2E/BW7 RPCs and adds only missing repository/action
seams.

The final controlled browser path must prove two distinct Students and an
unrelated organization across:

- multiple university applications;
- assigned-Curator visa work;
- reasoned case close and reopen;
- versioned private document review;
- evidence-based manual finance and overdue Portal action;
- durable notification visibility and self-read state.

Each operation uses its existing live permission and object scope. P6D may not
create or infer an amoCRM contract event, responsible Sales assignment, sales
stage or canonical handoff. P6 is complete only when the cross-domain path,
negative isolation matrix and accepted UI all pass together.

## Validation and merge gates

Every implementation slice requires:

- focused typed repository/action tests and strict response-shape failures;
- disposable PostgreSQL/RLS tests for actor, tenant, object, replay and private
  Realtime topic boundaries;
- a dedicated singleton local Supabase/browser partition with runtime flags off
  in all other partitions;
- `git diff --check`, Node 22.23.1 unit/security tests, lint, Next route
  generation, TypeScript, build, staged secret scan and dependency audits;
- one fresh independent read-only review of the exact head, all four exact-head
  CI jobs green, direct merge of only that head, and green exact-main push CI
  before the next slice.

Synthetic local Supabase/browser evidence is application and authorization
proof. It is not managed-Supabase, WhatsApp-provider or production proof.

## Official source basis

Current Supabase guidance recommends Broadcast over Postgres Changes for
scalability and security. Private Broadcast requires Realtime Authorization on
`realtime.messages`, an authenticated client channel with `private: true`, and
topic-bound RLS. P6B therefore emits only a private invalidation and refetches
the authorized RPC. Policy helper functions remain private; exposed entrypoints
are limited to reviewed RPCs with exact `EXECUTE` grants.

- Supabase Row Level Security:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase database functions:
  <https://supabase.com/docs/guides/database/functions>
- Supabase subscribing to database changes:
  <https://supabase.com/docs/guides/realtime/subscribing-to-database-changes>
- Supabase Realtime authorization:
  <https://supabase.com/docs/guides/realtime/authorization>
- Supabase Realtime Broadcast:
  <https://supabase.com/docs/guides/realtime/broadcast>

## Rollback and blocked proof

Rollback keeps every P6 producer/scheduler disabled, removes application wiring
and forward-fixes additive migrations without deleting durable audit or
notification history. Existing migration `043` and its dormant consent-gated
WhatsApp intent model remain intact.

P6 does not authorize production migrations, deployment, credentials, customer
data, WAHA session changes, live customer sends, amoCRM writes, provider
cutover, legacy-service retirement or Lead Agent deletion. Those remain
separate explicit-authority and evidence gates.
