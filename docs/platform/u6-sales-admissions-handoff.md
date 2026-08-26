# U6 audited Sales-to-Admissions handoff

Status: active Issue #383 implementation contract

- Parent: #376
- Depends on: merged U5/#382 and PR #397
- Starting main: `76803cbb214a63aefaa53171ed0ebdf6acf33f32`
- Plan authority: ADR 0021 and
  `EVO-LONG-RUN-1-NET-NEW-PILOT-2026-08-25`
- Evidence boundary: repository plus disposable local Supabase only; no managed,
  production, provider, WhatsApp, WAHA, amoCRM or customer-data mutation

## Outcome

An eligible canonical Sales lead whose U5 gate allows handoff becomes exactly
one active Admissions case inside the same EVO product. The operator does not
re-enter the client or lead. The handoff assigns one explicit Admissions owner,
creates a bounded starter task set and preserves the Sales context,
conversation linkage and provenance that Admissions needs to begin work.

The mutation is one database transaction. A retry or concurrent request cannot
create another active case, another handoff record or duplicate starter tasks.

## Entry gate and authority

The database, not the browser, decides whether handoff is allowed:

- `normal` calls the U5 locked assertion and requires a currently `satisfied`
  contract/first-payment gate;
- `exceptional_override` calls the same assertion and requires a currently
  `overridden` gate whose reason and actor were already audited by U5;
- blocked, partial, stale, inactive, cross-organization and unauthorized paths
  fail before any Admissions row changes.

An active responsible Sales membership may execute the normal path for its own
canonical lead. An active Admin in the same organization may execute either an
allowed normal path or the explicit exceptional path. A role label or client
control never substitutes for the live tenant, membership, ownership and gate
checks performed inside the transaction. Both paths require the lead itself to
retain an active same-organization Sales owner with an active profile and
published role bundle; Admin authority does not repair an ownerless lead.

The target Admissions owner is an active same-organization `curator`
membership. `student_cases.current_curator_membership_id` remains the canonical
Admissions owner; U6 does not add a second owner field.

## Canonical identity and concurrency

The case identity is derived only from the canonical lead:

`source_key = 'canonical-lead:' || lead_id`

The existing organization-scoped `student_cases.source_key` unique constraint
is the final duplicate guard. The handoff RPC also takes a transaction advisory
lock for organization plus lead, locks the U5 gate through
`platform_private.assert_lead_admissions_handoff_gate(...)`, and locks the
canonical lead before it reads or writes the case.

An existing pending canonical case may be activated instead of duplicated only
when its organization, lead, client, source key, responsible Sales owner and
contract-evidence fields still match the locked canonical lead. Any mismatch
fails closed; U6 does not silently rewrite protected identity or gate evidence.

Each request has a UUID receipt with a normalized payload fingerprint. Reusing
the request UUID with the same payload returns the committed result. Reusing it
with different input fails as a conflict. A different request for an already
completed identical handoff returns the same active case without writing a
second handoff or task set. Changing owner or reason after completion is not a
retry and fails closed; existing audited reassignment workflows own later owner
changes. A completed U6 handoff remains the canonical case for that lead. If it
is later closed, this RPC neither reopens it nor creates a second lifecycle; a
future multi-lifecycle policy would require its own explicit audited design.

## Case and Student Portal separation

U6 creates an operational Admissions case, not a Student Portal account. The
existing schema is refined so that:

- an active case requires an Admissions owner and handoff timestamp;
- `portal_activated_at` remains null until a separate authorized portal action;
- `student_membership_id` may remain null before a student account is linked;
- target country and target degree may remain null until U7 completes the
  Admissions intake facts;
- no placeholder membership, country, degree or portal timestamp is invented
  to satisfy an old structural constraint.

Existing portal reads continue to require both a matching active student
membership and real portal activation. This refinement does not broaden
student access.

## Preserved handoff evidence

One organization-scoped handoff record binds the canonical client, lead and
student case and records:

- handoff mode and resulting state;
- Sales actor, Admissions owner and handoff time;
- bounded operator reason and server-owned source key;
- the U5 gate version/state consumed by the transaction;
- canonical Sales qualification, owner, stage, next action and deadline;
- canonical client display identity and lead provenance;
- linked canonical conversation identifiers and latest inbound context needed
  for the operational handoff, without raw export or attachment copying.

The immutable handoff snapshot explains what Admissions received at that time;
the canonical lead/client/conversation tables remain the live source of truth.
Generic audit events and private receipts remain append-only.

## Starter tasks

The same transaction creates a small server-owned set in the existing
`platform.case_tasks` domain:

1. review the inherited Sales context;
2. confirm the study route and missing intake facts;
3. prepare the initial document-request plan.

Each task has a stable source key unique within the case, is assigned to the
explicit Admissions owner and is visible in the existing connected Admissions
case page. U6 does not build the complete Admissions checklist, document,
application or visa workflow; that belongs to U7.

## Staff UI

The canonical `/sales/[leadId]` detail adds one handoff card beside the U5 gate.
It shows why handoff is available or blocked, requires an explicit Admissions
owner and reason, and displays the stable linked case after success. It never
creates a client, lead or case locally in the browser.

The existing connected `/clients/[caseId]` Admissions page displays the
assigned owner, inherited handoff evidence and starter tasks from authorized
server projections. Sales retains only the existing bounded summary view after
handoff; U6 does not grant Sales full Admissions-case access.

## Required proof

- Migration history is contiguous through 088 and a clean reset succeeds.
- Disposable PostgreSQL/Supabase tests prove normal and exceptional handoff,
  blocked gate, unauthorized/inactive/cross-tenant actors, invalid owner,
  direct duplicate creation, receipt replay/conflict, practical concurrency,
  append-only evidence and unchanged Student Portal denial.
- Unit tests prove strict FormData/RPC parsing, exact arguments, malformed or
  foreign-tenant response rejection, stable error mapping and Admissions
  projection normalization.
- Real local Auth/PostgREST/Next.js browser proof performs the canonical Sales
  handoff, repeats it safely and renders inherited context plus starter tasks
  for Admissions while cross-tenant and blocked paths remain absent/denied.
- Existing security, lint, build, migration-history and repository gates remain
  green on Node.js 22.23.1.

Implementation references revalidated on 2026-08-25:

- <https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS>
- <https://www.postgresql.org/docs/current/indexes-unique.html>
- <https://supabase.com/docs/guides/database/functions>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>

## Exclusions

No separate Admissions product, Student Portal activation, complete Admissions
workflow, payment processing, outbound WhatsApp, WAHA change, amoCRM write,
provider call, legacy fallback, production deployment or managed
Supabase/customer-data mutation is part of U6.
