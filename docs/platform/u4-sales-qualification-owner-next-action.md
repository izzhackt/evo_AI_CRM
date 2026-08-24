# U4 — Sales qualification, owner and next action

Status: implemented and validated in the clean repository/disposable-local
worktree for issue #381 on 2026-08-25. Independent exact-head review, pull
request CI, merge and exact-main proof remain pending.

Block-ID: `EVO-U4-SALES-QUALIFICATION-OWNER-NEXT-ACTION-2026-08-24`.

Starting baseline: merged U3/main at
`730a2c2af6269d59ee0ec5391d9bafe0398af068` (PR #395).

Authority: parent issue #376, issue #381, ADR 0020, the merged U1-U3
contracts, and the 2026-08-24 U4 entry in `docs/PLAN_CHANGES.md`.

## Outcome and scope

U4 makes the canonical EVO lead usable as a small, explicit Sales work item.
An authorized Sales user or Admin can change its qualification stage, set an
eligible owner, and keep one next action with one calendar due date. The
connected `/sales` queue and canonical lead detail show the committed state,
provide truthful connected/unconnected filters, and retain a durable record of
who changed what and when.

U4 owns only:

- the six pre-contract Sales stages defined below;
- owner claim/assignment rules for active Sales memberships;
- one paired next-action text and due date on the canonical lead;
- bounded Sales list, detail and owner-option reads;
- one atomic, version-checked mutation boundary;
- an immutable request receipt and durable audit event for every committed
  workflow change; and
- connected `/sales` and canonical lead-detail controls and states.

U4 does not own contract evidence, first-payment evidence, Sales-to-Admissions
handoff, Admissions state, finance, document workflow, tasks, AI proposals,
provider activation, deployment or migration of real legacy/customer data.
Those remain U5 or later. U4 sends no WhatsApp message, enables no manual or
automatic reply, writes nothing to amoCRM, calls no paid AI provider and does
not mutate a managed Supabase project, production host, DNS/TLS, WAHA session,
provider dashboard or customer record.

## Truth model

### Qualification stage

`platform.leads.stage_key` remains the canonical Sales-stage field. Migration
086 restricts the U4 vocabulary to exactly:

| Stored value | Staff meaning |
| --- | --- |
| `new` | New lead awaiting active Sales work |
| `contacting` | Sales is attempting or continuing contact |
| `qualified` | Sales has confirmed the lead is worth progressing |
| `meeting_scheduled` | A Sales meeting has been scheduled |
| `meeting_completed` | The scheduled Sales meeting is complete |
| `potential` | The lead remains a credible pre-contract opportunity |

`contract_signed` is deliberately excluded because contract evidence belongs
to U5/#382. Contact outcomes such as no answer, follow-up requested or wrong
number are not qualification stages in U4.

The active authority supplies a vocabulary but no evidenced adjacency graph.
U4 therefore permits any **distinct** transition from one value in the six-row
table to another value in that table and rejects every value outside the
table. An unchanged valid stage may be carried in a snapshot that changes the
owner or action; a request whose entire desired snapshot equals current state
is the no-op rejected below. This explicit rule avoids inventing business order
or silently treating later contract evidence as a Sales-stage click.

Migration 086 changes the one U3-created legacy value `new_inbound` to `new`
and changes the U3 projection function to create future inbound leads as
`new`. Before adding the database constraint, the migration checks all
remaining distinct stage values. Any value other than the six accepted values
causes the migration to abort with a diagnostic; it is never silently mapped,
deleted or retained as current truth.

### Connected and unconnected

Connection is one narrow relational fact:

- a lead is `connected` if and only if at least one row in
  `platform.communication_conversations` has
  `canonical_lead_id = platform.leads.id`;
- a lead is `unconnected` if and only if no such row exists.

This does not report WAHA/provider health, session state, delivery state,
inbound-work state, phone availability or live connectivity. A conversation
linked only to the same client does not make the lead connected. A provider
outage does not change an already linked lead to unconnected. If the bounded
read fails, the UI reports the queue as unavailable; it must not convert an
unknown result into `unconnected`.

### Owner

The stored owner remains `platform.leads.current_owner_membership_id`, never a
display name, email, provider user or amoCRM responsible-user value. A selectable
owner must be an active membership in the same organization, backed by an
active staff profile, with the live U1 Sales role and current published access
bundle. Inactive, suspended, revoked, stale-bundle, cross-organization,
Curator and Admin memberships are not eligible Sales-owner options.

| Actor | Visibility | Owner operation | Other workflow fields |
| --- | --- | --- | --- |
| Sales | Own leads and unowned leads in the same organization | May claim an unowned lead only to their own active membership; cannot reassign or relinquish it | May change stage/action only while already self-owned, or in the same atomic call that claims it |
| Admin | All leads in the same organization | May assign, reassign or unassign only against the eligible Sales-owner rule | May change stage/action for any visible organization lead |
| Curator | None through U4 Sales APIs | Denied | Denied |

A Sales user cannot mutate another Sales user's lead. An Admin can repair a
lead whose previous owner is no longer eligible, but cannot select that
ineligible membership as the new owner. All actor, target-owner and organization
checks are repeated inside the transaction; UI filtering is not authorization.

### Next action and due date

Migration 086 adds `next_action_text TEXT` and `next_action_due_date DATE` to
`platform.leads`. They are one pair:

- both are null, meaning no next action is scheduled; or
- text is trimmed to 1-500 characters and the date is a valid ISO calendar
  day (`YYYY-MM-DD`).

One null and one non-null value is invalid. `DATE` is intentional: this is a
business day, not an appointment instant, so browser/server timezone conversion
must not shift it. For this pilot, `due_today` and `overdue` compare against the
calendar date in `Asia/Bishkek`; overdue means a non-null due date earlier than
that date. A past date is accepted and remains visibly overdue rather than
being hidden or silently corrected.

Clearing is explicit. The mutation sets `p_clear_next_action = true` and sends
both action inputs as null for the desired empty state. When false, both values
are required. Supplying text/date while clearing, or null/partial values while
not clearing, fails. A stage/owner change may preserve an already empty action
by requesting the same empty snapshot; only removal of a previously populated
pair is an actual clear and requires a human reason.

## Migration 086 and durable invariants

The sole schema delta is
`supabase/migrations/086_platform_sales_workflow.sql`. It is forward-only and:

1. performs the fail-closed `new_inbound` normalization and stage preflight;
2. constrains `stage_key` to the six U4 values;
3. adds the paired next-action fields and `workflow_version BIGINT NOT NULL`
   with a positive initial value;
4. enforces the next-action null/present and text-length constraints;
5. extends the existing durable audit record with actor membership and
   resulting workflow version where needed by the U4 receipt;
6. creates a private append-only mutation-receipt table with a globally unique
   request UUID plus organization and actor scope;
7. publishes bounded U4 list, detail, owner-option and mutation functions;
8. replaces the U3 chat-binding function only enough to emit stage `new`; and
9. publishes access bundle v13 by copying v12, adding
   `lead.sales.workflow.manage` to Sales and Admin and
   `lead.sales.owner.assign` only to Admin, then rebinding active pilot
   memberships with the U1 access-version invalidation rule.

Database constraints, foreign keys, transaction authorization and execute
grants are the authority. TypeScript checks and disabled UI controls are early
feedback only.

Every actual workflow change increments `workflow_version` exactly once. A
request that changes none of stage, owner or next-action state fails with a
stable `workflow_no_change` result and writes neither audit nor receipt. There
is no direct authenticated browser `UPDATE` grant on leads and no direct
browser `INSERT` grant on the audit or receipt tables.

## Bounded read APIs

U4 adds these authenticated RPCs in schema `platform`:

- `staff_sales_lead_page(p_limit INTEGER, p_cursor_updated_at TIMESTAMPTZ,
  p_cursor_id UUID, p_connection_filter TEXT, p_stage_filter TEXT,
  p_assignment_filter TEXT, p_owner_membership_id UUID, p_due_filter TEXT,
  p_query TEXT)` returns open canonical lead identity, stage,
  eligible owner presentation, action/date, `workflow_version`, derived
  connected flag, safe secondary counts and a complete keyset cursor;
- `staff_sales_lead_detail(p_lead_id UUID)` returns the same authoritative open
  workflow state plus the existing safe U2/U3 detail context;
- `staff_sales_owner_options(p_limit INTEGER, p_cursor_label TEXT,
  p_cursor_id UUID, p_query TEXT)` returns only active eligible Sales
  memberships from the actor's organization, by opaque membership UUID and
  safe display label, ordered/cursored by `(display_label ASC, id ASC)`.

The page API has an explicit 1-101 database limit; application requests remain
at most 50. Its stable order/cursor is `(updated_at DESC, id DESC)`. It applies
organization/object visibility and all filters before ordering and `LIMIT`:

- connection: `all`, `connected`, `unconnected`;
- stage: one U4 value or all;
- assignment: all visible, mine or unassigned; Admin may additionally select
  one eligible owner UUID;
- due: all, scheduled, unscheduled, due today or overdue; and
- bounded normalized text query over the already accepted safe lead/client
  presentation fields.

Sales visibility is always intersected with self-owned or unowned; a query
parameter cannot widen it. Admin visibility is same-organization only. Curator,
anonymous, inactive, suspended, blocked, stale-token and cross-organization
callers fail closed. Invalid filters, incomplete cursors or unavailable reads
return explicit errors, not unfiltered fallback data. Filters and authorization
are proven with more than 1,000 leads so a default PostgREST cap cannot define
business behavior.

## Atomic mutation API

The only browser mutation is
`platform.mutate_sales_lead_workflow(...)`. It accepts:

- `p_lead_id UUID`;
- `p_expected_workflow_version BIGINT` from the last committed read;
- caller-generated `p_request_id UUID`;
- the desired `p_stage_key`;
- the desired `p_owner_membership_id` or null;
- desired `p_next_action_text` and `p_next_action_due_date`;
- `p_clear_next_action BOOLEAN`; and
- optional trimmed `p_reason` up to 500 characters.

This is a desired-state snapshot, not three loosely ordered writes. The
transaction resolves the exact live actor, takes a request-scoped transaction
advisory lock, checks a prior receipt, locks the lead with `SELECT ... FOR
UPDATE`, checks the expected version, validates role/object/target-owner/stage/
action rules, performs one lead update, appends one audit event and appends one
receipt. It returns the committed bounded result only after all writes succeed.
Any exception rolls back the lead, audit and receipt together.

Stage values are exact lowercase contract keys. Action text and reason are
trimmed before validation and receipt comparison; UUID/date/clear inputs retain
their typed values. Cross-organization and non-visible lead lookup uses one
`workflow_not_found_or_forbidden` result so the API does not become an object
enumeration seam. Other stable client-facing failures are
`workflow_invalid_stage`, `workflow_invalid_owner`,
`workflow_invalid_next_action`, `workflow_reason_required`,
`workflow_version_conflict`, `request_id_conflict` and
`workflow_no_change`. Unexpected database details remain server-side.

`workflow_version_conflict` uses PostgREST's explicit `PT409` custom SQLSTATE,
so the Data API returns an immediate HTTP 409 business conflict. It does not
reuse PostgreSQL `40001`, which denotes a transaction rollback/serialization
failure and must remain distinguishable from an ordinary stale form.

The globally unique request UUID is the idempotency identity. An exact retry by the same actor
for the same lead, expected version and normalized desired snapshot returns the
stored result and creates no second update or audit event. Reuse of that UUID
by another actor, another lead or any different normalized payload fails as
`request_id_conflict`. The request lock closes the race in which two copies of
the same UUID arrive before either receipt exists.

After the idempotency check, the lead row lock plus expected version provides
optimistic concurrency. For two different request IDs carrying the same
expected version, only the first committed change can win; the second returns
`workflow_version_conflict` with no write and must refresh. The function never
silently overwrites a newer owner, stage or action.

`p_reason` is mandatory for an actual Admin reassignment/unassignment and for
removal of a populated next-action pair. Other accepted changes persist the
supplied reason or the deterministic reason `sales_workflow_update`; the audit
reason is never null or blank.

## Audit and receipt contract

Every committed consequential change writes exactly one append-only audit
event containing at minimum:

- organization, canonical lead and action type;
- actor membership, actor profile/principal reference and database event time;
- safe before and after snapshots of stage, owner membership, next-action text,
  due date and workflow version;
- normalized reason;
- request UUID; and
- resulting workflow version.

The private receipt additionally retains the normalized request identity and
committed bounded response needed for replay comparison. Neither record stores
tokens, secrets, raw WAHA identifiers/payloads, phone/email query text or
provider credentials. Audit and receipt rows cannot be updated or deleted by
authenticated callers. Failed authorization, validation, stale-version and
request-collision attempts do not masquerade as committed audit events; tests
assert their stable error codes and unchanged lead/version.

## Security and function posture

The list/detail/options/mutation functions are `SECURITY DEFINER` for a narrow
reason: the browser must not receive broad table write grants, and the mutation
must atomically lock/update the lead and append private audit/receipt rows that
authenticated users cannot write directly. This posture does not trust the
definer automatically. Every function:

- sets an empty `search_path` and schema-qualifies every relation, type and
  helper;
- derives the actor from the JWT and live U1 membership/profile/bundle state;
- repeats organization, role, permission and object/owner checks;
- is revoked from `PUBLIC`, `anon` and `service_role` and granted only to
  `authenticated` where intended; and
- exposes only bounded, explicitly selected safe columns.

All exposed tables keep RLS enabled and forced, broad default privileges are
revoked, and direct-table policies remain no broader than the RPC contract.
The function is an audited least-privilege command boundary, not an RLS bypass
or a general compatibility API.

## Staff UI contract

The connected `/sales` page stays the only queue. It exposes explicit filter
controls for connection, stage, assignment/owner and due state, and it shows
the stored stage, owner, next action/date, connected truth and overdue state on
each canonical lead. A row/detail mutation uses opaque UUIDs and the latest
`workflow_version`; owner display text is presentation, never mutation
identity.

The canonical `/sales/:leadId` detail exposes the same bounded mutation
control. While submitting, duplicate clicks are disabled and the pending
request UUID remains stable. Success is shown only from the committed RPC
receipt, after which the server view is revalidated and a new UUID is created
for the next intent. There is no optimistic success. A stale version prompts a
refresh; validation/permission/request-collision/unavailable states are
distinct and do not expose database internals.

Empty states are filter-specific: no visible leads, no connected leads, no
unconnected leads, no overdue leads and no eligible owner options are different
facts. An RPC/Auth/PostgREST failure is an unavailable state with a retry path,
never a zero count. U3 conversation history remains receive-only and the U4
surface contains no reply, send, AI-send, amoCRM-write, contract or payment
control.

## Required local proof

Acceptance uses Node.js 22.23.1 and a clean disposable local Supabase stack. It
must cover:

- clean migration reset through contiguous migration 086 and history checks;
- real PostgreSQL constraints, grants, forced RLS and function execute grants;
- real local Supabase Auth/JWT plus PostgREST calls for Sales, Admin, Curator,
  anonymous, inactive, suspended, stale-token and cross-organization actors;
- Sales self-owned/unowned visibility, atomic self-claim and denial of
  reassignment, relinquish and another Sales user's lead;
- Admin assign/reassign/unassign, eligible-owner filtering and required reason;
- all six stages, allowed distinct transitions and rejection of outside/no-op
  transitions, including `contract_signed`;
- paired action/date constraints, explicit clear, past-date overdue behavior
  and Bishkek calendar-day filtering;
- exact connected/unconnected truth, including a same-client conversation that
  is not directly lead-linked;
- pre-pagination filters and complete stable traversal of more than 1,000
  leads without gaps, duplicates or silent truncation;
- exact idempotent replay, request-ID collision, two different request IDs at
  one expected version, row locking and stale-version rejection;
- one committed version increment, audit event and receipt per accepted change,
  with no partial state after every negative case;
- real connected browser proof for queue filters, row/detail mutation, pending,
  committed success, stale/denied/invalid/unavailable and exact empty states;
  and
- regression proof that U3 remains receive-only and raw WAHA/provider identity
  is not exposed.

The full candidate gates are `git diff --check`,
`npm run check:node-runtime`, `npm run test:supabase:history`,
`npm run test:security:postgres`, `npm run test:supabase:local`,
`npm run test:unit`, `npm run test:security:node`, `npm run lint`, and
`npm run build`. Failed, mocked or skipped affected paths are not acceptance
evidence.

The clean U4 candidate worktree passed those local gates on 2026-08-25 with
Node.js 22.23.1. The disposable Supabase gate reset all 86 contiguous
migrations through 086, passed its real local Auth/PostgREST/RLS checks and
passed the combined U2/U4 browser partition 2/2, including committed mutation
and repeated queue/detail reads. The complete unit suite passed 679/679;
`npm run test:security`, `npm run lint`, `npm run build`, runtime/history checks
and `git diff --check` all exited successfully. This is repository and
synthetic disposable-local evidence only. It is not exact-head CI, merge,
managed Supabase, deployment, provider or customer-conversation evidence.

## Primary-source implementation notes

The contract follows current official guidance:

- Supabase's Data API security model requires both object privileges and RLS;
  RLS alone does not repair broad grants, so migration 086 owns both and tests
  both ([Data API security](https://supabase.com/docs/guides/api/securing-your-api),
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- Supabase recommends invoker functions by default. U4's bounded definer
  exception exists only for private atomic writes and follows the documented
  protected-function posture, reinforced by PostgreSQL's function and
  `search_path` controls
  ([Database Functions](https://supabase.com/docs/guides/database/functions),
  [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html),
  [ALTER FUNCTION](https://www.postgresql.org/docs/current/sql-alterfunction.html)).
- Database constraints and row-security policies enforce integrity and tenant
  scope at the data boundary
  ([Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html),
  [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)).
- `SELECT ... FOR UPDATE`, transaction locks and isolation behavior provide
  the lead/request serialization and stale-write boundary described above
  ([Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html),
  [SELECT](https://www.postgresql.org/docs/current/sql-select.html),
  [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)).
- Unique receipt keys and PostgreSQL insert conflict handling provide the
  durable idempotency primitive; application memory is not the authority
  ([INSERT](https://www.postgresql.org/docs/current/sql-insert.html)).
- PostgREST forwards PostgreSQL error structure and documents `PTxyz` custom
  HTTP status codes; U4 therefore uses `PT409` for its stale-version business
  conflict rather than a retryable transaction error
  ([PostgREST errors](https://docs.postgrest.org/en/v14/references/errors.html)).
- Migration and database-test guidance requires replayable local migrations
  and policy tests in the same change
  ([Local migrations](https://supabase.com/docs/guides/local-development/database-migrations),
  [Database testing](https://supabase.com/docs/guides/database/testing),
  [CLI testing and linting](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)).

## Review, merge and stop boundary

U4 is one coherent repository/disposable-local PR from the exact starting
baseline. Before merge it requires one fresh independent read-only
launch-control review of the immutable head. That review first checks plan
freshness—the actual diff still matches this focused contract and the U4
`PLAN_CHANGES` entry—then checks implementation correctness. All four required
exact-head CI jobs (`Changed range`, `Main CRM`, `EVO Inbox`, `EVO Lead Agent`),
a final base/head refresh, and a squash merge guarded by that reviewed head SHA
must follow. After merge, exact-main push CI and branch/main tree equivalence
must be recorded on issue #381 before closure.

Repository/local proof does not prove a managed migration, production
deployment, provider behavior, a real customer conversation, backup/restore or
rollback. Migration 086 is forward-only; application rollback does not drop
the new fields, receipts or audit history. Stop after #381. Do not start
U5/#382 or any later slice.
