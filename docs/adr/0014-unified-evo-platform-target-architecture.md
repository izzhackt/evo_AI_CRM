# ADR 0014: Unify EVO Platform backend and operational data

- Status: historical target; superseded in conflict by ADR 0020; not deployed
- Date: 2026-07-28
- Decision owners: CEO/CTO authorization bundle and technical owner
- Supersedes for target architecture: ADR 0002, ADR 0006, ADR 0008, ADR 0009
- Superseded in conflict by: ADR 0020
- Execution contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`

## Context

The repository currently contains three operational contours: the root CRM on
SQLite and custom auth, EVO Inbox on a separate Supabase model, and EVO Lead
Agent as a private WAHA/amoCRM processing service. The existing configuration
also contains separate `crm_primary` and `evo-inbox` WhatsApp paths.

That split was a deliberate companion-era safety boundary. It is now an
obstacle to one staff workflow, one student portal, consistent object-level
authorization, one conversation history and auditable handoff. A new target
decision is required without pretending that current production has already
changed.

## Decision

Build one unified EVO Platform backend and one logical Platform data model.
Absorb EVO Inbox and the useful fail-closed Lead Agent capabilities into that
backend. Preserve the existing production contours until a controlled,
reversible cutover proves the target.

The decision has these fixed boundaries:

1. amoCRM remains canonical for contact, lead, responsible sales manager,
   pipeline and sales stage.
2. One dedicated production Supabase project owns EVO operational data. Local,
   persistent staging and supported preview branches remain isolated physical
   environments; production data is not copied into preview by default.
3. One private production WAHA session/number named `evo-inbox` and one webhook
   owner are the target. WAHA has no public port and no `acadis_*` dependency.
4. Roles v1 are `admin`, `sales`, `curator`, `finance` and `client/student`.
   `/visa` remains a module, not a separate business role.
5. AI is draft-only in RU or EN. Staff review/edit/manual-send is mandatory.
   Uncertain language requires manual selection or handoff.
6. There is no unattended outbound, auto-reply, broadcast or mass send.
7. Unknown send outcome is never retried automatically.

## Canonical data and handoff

amoCRM identifiers are account-specific. The adapter discovers, caches and
versions pipeline, status, custom-field and user mappings. Canonical writes use
`pipeline_id`, `status_id`, `responsible_user_id` and
`custom_fields_values`; global hardcoded IDs are prohibited.

amoCRM webhooks for lead add, update, status and responsible-user changes, plus
related enabled events, are persisted quickly, processed asynchronously and
reconciled periodically. Consumers are idempotent and prevent sync loops. The
adapter respects no more than 7 requests/s/IP and prefers no more than 50
writes per batch. Kommo `conversation.id`/`message.id`, WAHA message IDs and
Platform UUIDs are stored separately.

An account-specific signed-contract status creates a pending student case.
Portal activation and operational handoff happen only after Admin assigns a
Curator. Sales owns the queue and conversation before contract; Curator owns
the assigned student after handoff. The history remains unified, while Sales
retains only an allowed non-secret summary.

## Supabase, auth and RLS

Schema and configuration are code through `supabase/config.toml` and versioned
migrations. Clean reset, diff/pull discipline and environment parity are
required. Each Supabase branch isolates its Database, API credentials, Auth,
Storage and Edge Functions; production data is not copied to preview branches
by default.

Every exposed table has RLS. A publishable key may be used in the browser only
with RLS. Supabase secret/service-role and external provider secrets remain on
the backend. Custom JWT claims provide coarse role; organization, assignment,
student, conversation and object scope are enforced through RLS and repeated
server authorization.

Next.js 16 server auth uses `@supabase/ssr`, `proxy.ts`, asynchronous
`cookies()` and `getClaims()`. `getSession()` is not treated as a trusted
authorization decision.

Private Storage uses supported Storage APIs and authenticated or short-lived
signed downloads. Direct writes to storage schema tables are prohibited.
Documents are PDF/JPG/PNG up to 25 MB, versioned and subject to
integrity/malware state and audited access.

Durable retryable work uses Supabase Queues with idempotent consumers,
dead-letter and reconciliation. Database Webhooks may push asynchronous events
but do not replace the durable business queue. Vault may hold DB-resident
secrets behind strict access. PITR depends on the selected plan; database
backups do not include Storage objects, so Storage has a separate backup and
restore procedure.

Realtime channels are private. Their authorization uses simple, reviewable RLS
policies rather than duplicating business authorization in the browser.

## WAHA and messaging

The target webhook:

1. validates HMAC and timestamp;
2. persists the raw event before processing;
3. deduplicates `X-Webhook-Request-Id` and business key
   `session + payload.id`;
4. uses durable jobs, dead-letter and reconciliation;
5. consumes `message.any` for own API-send reconciliation;
6. audits `message.ack` states `ERROR`, `PENDING`, `SERVER`, `DEVICE`, `READ`
   and `PLAYED`;
7. sends only while the session is `WORKING`;
8. calls `/api/sendSeen` before the reviewed reply;
9. never automatically retries an unknown send result.

The target carries forward phone normalization, amoCRM resolution, note/task
mapping, handoff, retry and reconciliation. It does not carry forward
auto-reply as an active function.

## Operational ownership

Only Admin invites or blocks staff and assigns or reassigns Curator.
Reassignment records a mandatory reason, before/after and audit. Curator owns
documents, multiple university applications, visa, tasks and communication for
assigned students. Curator/Admin close or reopen a student case only with a
reason and audit.

Finance/Admin confirm obligations, payments and refunds manually with evidence
and audit. A future Excel/1C import is a separate integration, not a fake
connector in v1. Student Portal exposes a clear overdue notice and next action,
not sensitive internal fields.

Notifications v1 are durable in-app and individual WhatsApp notifications with
consent and deduplication. Broadcasts, mass sends and old automation flows are
out of scope.

AI uses only approved versioned knowledge. EVO may promise only delivery of its
own services and obligations; it cannot guarantee admission, scholarship, visa
or another external authority's decision.

## Historical migration and cutover boundary

The SQLite import/identity bridge and fixed-duration retirement details in this
section are superseded by ADR 0016. They remain below only as historical
decision context and are not current implementation authority.

The target is implemented incrementally and fail-closed:

- read-only SQLite inventory and backup first;
- deterministic UUID mapping, counts, orphans and checksums;
- staging import and temporary dual-read comparison;
- no long-term dual-write;
- read-only amoCRM sync before guarded writes;
- old webhook/session remains active until controlled proof;
- expand/contract migration, isolated restore and rollback rehearsal before
  production mutation.

The historical decision required a separate reviewed PR after at least 72
actual hours of stable real traffic, zero unexplained loss/duplicates,
reconciliation, full real E2E and proven rollback. ADR 0016 replaces the
fixed-duration condition with bounded controlled evidence, health and rollback;
this ADR still does not authorize early removal.

## Prohibited actions under this implementation run

This decision authorizes repository implementation and validation. It does not
authorize:

- production deployment or migration;
- DNS changes;
- WAHA QR, session or webhook mutation;
- live customer WhatsApp sends;
- creation or modification of real amoCRM contacts or leads;
- enabling auto-reply or outbound automation;
- stopping or deleting production services, Lead Agent or legacy paths.

Those actions require a separate evidence gate and explicit production
authorization.

## Supersession semantics

ADR 0002, 0006, 0008 and 0009 remain valid history for why the companion path
was isolated:

- ADR 0002 separated the companion app from the root CRM;
- ADR 0006 gave the companion app its own Supabase basis;
- ADR 0008 introduced the single `evo-inbox` session for companion launch;
- ADR 0009 let the companion resolve amoCRM identity.

This ADR supersedes them only for the target architecture. Until controlled
cutover, the old production topology remains current and must not be described
as already replaced.

## Consequences

Positive:

- one conversation and audit trail;
- one role/object-scope model;
- consistent Sales-to-Curator handoff;
- one operational source for admissions, documents, finance and portal state;
- removal of duplicate WhatsApp processing after proven cutover.

Costs and risks:

- deterministic migration from multiple stores;
- account-specific amoCRM discovery and conflict handling;
- strict RLS and private Storage policy surface;
- staged webhook ownership transfer and rollback;
- separate Storage backup alongside DB backup/PITR;
- real sanitized test sender number and sanitized lead; the historical elapsed
  soak condition is superseded by ADR 0016.

## Open release decisions

The following remain open and must not be guessed:

1. exact amoCRM account/pipeline/status/custom-field/user mappings;
2. Supabase region, plan, PITR and cost;
3. capacity, SLO, RPO and RTO;
4. retention, privacy, DPA and legal deletion period;
5. AI provider and data-handling policy;
6. dedicated sanitized test sender number, `evo-inbox` production QR/session
   recovery owner and controlled test-send authority;
7. release window, freeze and rollback authority.

## Primary sources

Supabase:

- [Branching](https://supabase.com/docs/guides/deployment/branching)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Queues](https://supabase.com/docs/guides/queues)
- [Server-side auth client](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
- [Vault](https://supabase.com/docs/guides/database/vault)
- [Backups and PITR](https://supabase.com/docs/guides/platform/backups)
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)

amoCRM/Kommo:

- [API limitations](https://developers.kommo.com/docs/limitations)
- [Webhooks general](https://developers.kommo.com/docs/webhooks-general)
- [Receiving Chats webhooks](https://developers.kommo.com/reference/receiving-chat-webhooks)
- [Updating a lead](https://developers.kommo.com/reference/updating-single-lead)
- [Webhook events](https://developers.kommo.com/reference/webhook-events)

WAHA:

- [Sessions](https://waha.devlike.pro/docs/how-to/sessions/)
- [Events and webhook security](https://waha.devlike.pro/docs/how-to/events/)
- [Sending messages](https://waha.devlike.pro/docs/how-to/send-messages/)

Next.js:

- [`proxy.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Async `cookies()`](https://nextjs.org/docs/app/api-reference/functions/cookies)
