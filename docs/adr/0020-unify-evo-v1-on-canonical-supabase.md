# ADR 0020: Unify EVO v1 on canonical Supabase

- Status: accepted
- Decision date: 2026-08-23
- Recorded: 2026-08-24 (Asia/Bishkek)
- Decision owner: EVO product owner
- Parent product contract: GitHub issue #376
- First execution slice: GitHub issue #377 (U0)
- Current execution slice: GitHub issue #379 (U2; U0 and U1 merged)
- Starting repository baseline:
  `31d26b6e6bdc8a96fcf9f48210e417d43619370d`
- Execution contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Decision log: `docs/PLAN_CHANGES.md`

## Context

EVO needs one internal product in which sales, communication, admissions,
documents, applications, finance control and tasks form one workflow. The
repository already contains useful Supabase-native capabilities, but its
authority documents describe several incompatible generations:

- root CRM, EVO Inbox and EVO Lead Agent as separate product/runtime contours;
- amoCRM as canonical owner of client, lead, responsible staff and sales stage;
- a greenfield rule that excludes legacy operational-data migration;
- a bounded autonomous inbound-reply lane;
- a signed-contract-only Sales-to-Admissions handoff;
- P/BW/NW/P8 execution sequences that predate parent contract #376.

Keeping those decisions active would preserve multiple truths and make a safe
pilot impossible to evaluate. A single superseding target and backlog boundary
is required before any new runtime implementation.

## Decision

### One internal product

EVO is one all-in-one internal platform with one login, one accepted staff UI,
one organization/role model and one end-to-end workflow. CRM, Inbox, Lead
Agent, Admissions, Finance, Tasks, Documents and AI are modules inside that
product. They are not separate products, separate staff entry points or
independent operational authorities.

The first internal pilot has three human-facing roles:

- Sales Manager;
- Admissions Manager, backed by the existing canonical admissions role;
- Director/Admin.

Permissions such as contract confirmation and payment confirmation are
explicit capabilities. A job title alone does not grant a sensitive action.
Student Portal follows in a later milestone and is not a first-pilot blocker.

### One canonical operational foundation

Supabase is the permanent canonical foundation:

- Postgres owns client, lead, stage, responsible staff, next action, deadline,
  Student Case, applications, visa, payment-control state, tasks,
  communication workflow and audit;
- Supabase Auth owns staff identity and organization membership;
- private Storage owns accepted private documents and media objects;
- RLS and repeated server authorization enforce organization, role and object
  scope;
- Realtime and server-side functions/queues may serve the same canonical model
  where their reviewed semantics fit.

The root `supabase/` migration chain remains the sole repository schema
authority. Merged migrations stay immutable and corrections use forward
migrations.

SQLite is not restored as a runtime, repository, read or fallback path.
Existing SQLite, companion Supabase, Inbox and Lead Agent data may be archived
and migrated once with provenance, checksums, rejection reporting and
reconciliation. That migration does not authorize dual-read, dual-write,
write-through, fallback repositories, parallel UI or compatibility layers.
After a source is cut over, it accepts no new operational writes.

### External adapters

amoCRM is a temporary read/import adapter and migration source. EVO may retain
verified external identifiers and provenance, but amoCRM is not the target
authority for client, lead, stage, responsible staff or workflow. Permanent
two-way synchronization is rejected. The first live stage writes nothing to
amoCRM.

WAHA is a private WhatsApp transport adapter. It owns observable provider
transport evidence such as session/message identifiers and ACK state, but it
does not own EVO identity, workflow, authorization, memory or audit. WAHA has
no public port.

AI providers return suggestions only. Permitted v1 assistance includes
summarization, classification, next-action suggestions, draft generation and
gap/deadline detection. Every consequential output requires human review. AI
cannot send messages, change stages, assign staff, accept documents or confirm
payments.

### Workflow and rollout

The normal Sales-to-Admissions handoff requires both a confirmed contract and
the first mandatory payment. The handoff creates or updates one Student Case,
preserves Sales context and provenance, assigns Admissions ownership and
creates the starter checklist/tasks. A Director/Admin override requires a
reason, actor, time and immutable audit event.

The first live stage is receive-only. It may prove real inbound WhatsApp,
permitted external reads and real internal work in EVO, but it sends no
outbound WhatsApp message and writes nothing to amoCRM. Any later external
write requires a separate owner decision, bounded scope and real rollback.

Migration occurs in two stages:

1. archive, migrate and reconcile active operational records required for the
   pilot;
2. after a stable pilot, migrate or archive historical closed records.

The active execution order is parent #376 and child issues #377-#391 (U0-U14).
Earlier P/BW/NW/P8 plans, draft PRs and pre-#376 open issues are immutable
source evidence only according to the U0 crosswalk. None may merge directly.

## Supersession

This ADR is current target authority and supersedes conflicting target or
execution clauses as follows:

- ADR 0001 remains source-only for human-reviewed AI and no-send safety; its
  exact provider and separate Lead Agent replacement are not current authority.
- ADRs 0002-0013 remain companion-era history; they do not authorize a
  separate Inbox product, separate login, amoCRM-owned identity, outbound
  first proof or companion lifecycle.
- ADR 0014 remains architecture history, but amoCRM canonical ownership, the
  signed-contract-only handoff and its first-release role/automation contract
  are superseded.
- ADR 0015 remains active for the single migration authority, schema separation
  and migration immutability where it does not conflict with this ADR.
- ADR 0016 remains source for the accepted UI and Supabase-native direction.
  Its no-legacy-import rule and thin-messaging-first execution order are
  superseded; one-time reconciled migration is required, while runtime SQLite
  and compatibility bridges remain prohibited.
- ADR 0017 remains active for keeping Student Profile extraction/autofill
  automation outside this repository.
- ADR 0018 remains current-state safety history only; it does not preserve Lead
  Agent or amoCRM as target authorities.
- ADR 0019 is superseded where it authorizes autonomous replies or canonical
  amoCRM context. Its fail-closed evidence patterns remain source material.

Historical deployment/provider observations remain true only for the exact
system, SHA, evidence and date they recorded. They confer no current
production authority.

## Consequences

- Existing conforming Supabase schemas and UI may be reused only after a
  current U-slice revalidates them against this ADR.
- Stale draft branches are never rebased and merged wholesale merely because
  their code looks useful; their value is selectively rebuilt from current
  `main` in the crosswalk's named slice.
- The active-data migration is a controlled one-time movement, not a long-lived
  coexistence architecture.
- Repository tests prove repository behavior only. Managed Supabase, WAHA,
  amoCRM, AI, deployment, backup and rollback need their own real evidence.
- U0 is documentation-only and stops after #377. It changes no schema,
  provider, production service, customer data or runtime behavior.
- U1 is repository/disposable-local staff authorization only and stops after
  #378. It does not authorize U2, managed Supabase or provider/production work.

## Rejected alternatives

### Keep amoCRM canonical indefinitely

Rejected because staff would still depend on an external sales record for the
identity, ownership and stage of work that EVO must operate end to end.

### Keep greenfield data and skip migration

Rejected because the pilot needs active client, conversation, contract,
payment, task, document and case continuity. The accepted alternative is a
reconciled one-time migration without runtime compatibility paths.

### Preserve separate CRM, Inbox and Lead Agent products

Rejected because multiple logins, role systems and workflows reproduce the
problem the platform is meant to solve.

### Allow bounded autonomous replies in v1

Rejected because #376 makes AI advisory and human-reviewed. A later external-
write stage requires a new explicit decision and cannot inherit ADR 0019.

## Evidence boundary and primary sources

This ADR records product authority; it is not provider or deployment evidence.
Current official documentation confirms that a Supabase project centers Auth,
Postgres, Storage, Realtime and related services on the same Postgres-backed
project, that exposed tables require RLS, that Storage authorization is RLS-
based, that WAHA sessions/webhooks are transport boundaries, and that Kommo
offers bounded lead reads and event webhooks suitable for a temporary adapter:

- <https://supabase.com/docs/guides/getting-started/architecture>
- <https://supabase.com/docs/guides/auth/architecture>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/docs/guides/storage/security/access-control>
- <https://waha.devlike.pro/docs/how-to/sessions/>
- <https://waha.devlike.pro/docs/how-to/events/>
- <https://waha.devlike.pro/docs/how-to/security/>
- <https://developers.kommo.com/reference/leads-list>
- <https://developers.kommo.com/docs/webhooks-general>
