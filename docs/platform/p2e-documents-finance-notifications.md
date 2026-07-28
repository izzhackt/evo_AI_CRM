# P2E — document metadata, manual finance and notification intent

- Status: repository candidate; migration, API, RLS and local tests are
  implemented, while independent review and exact-head CI remain pending
- Date: 2026-07-28
- Starting database boundary: migration 042
- Additive migration: 043
- Parent contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Foundation contract: `docs/platform/p2-supabase-foundation.md`

## Purpose and proof boundary

P2E extends the P2D student-case model with three database-owned areas:

1. document checklist, version, validation and review metadata;
2. manual obligations, payments, refunds and finance stop factors;
3. durable in-app and individual-WhatsApp notification intent.

This is a database authorization contract, not proof that a file was uploaded,
scanned or downloaded, or that a WhatsApp message was queued, sent or
delivered. Migration 043 and its local evidence are recorded below. They remain
a repository candidate until independent SHA-bound review and exact-head CI.

P2E does not call amoCRM, WAHA, WhatsApp, a malware scanner or a managed
Supabase project. It does not apply a production migration or change the
accepted P0 plan.

## Additive boundary after migration 042

Migration 042 already owns student cases, Curator assignment and scope
rotation, applications, visa cases, tasks and their lifecycle evidence.
Migration 043 references those tenant-qualified case and membership keys; it
does not duplicate their authority model or edit migrations 001–042.

The new slice remains additive:

- no legacy table rename or drop;
- no root-auth, SQLite, Inbox or Lead Agent cutover;
- no Storage bucket or `storage` schema mutation;
- no Queue, provider-delivery or ACK implementation;
- no real customer data or secret.

## Document metadata contract

A document slot is a logical checklist requirement for a student case. A
document version is an immutable metadata record for one submission attempt.
Resubmission creates a later version linked to the earlier one; it never
overwrites the previous version or its review history.

The model must retain:

- the versioned route/program checklist source and stable slot identity;
- tenant and student-case identity on every parent and child record;
- declared PDF/JPG/PNG media type and declared size no greater than 25 MB;
- version order, creator, timestamps and an opaque evidence reference;
- validation, integrity and malware state;
- reviewer decision, reviewer, time and reason;
- the relationship between a correction request and its resubmission.

Declared metadata is not proof of the binary contents. Integrity or malware
state may advance only with explicit evidence through a narrow trusted path.
Missing, failed or inconsistent evidence remains fail-closed; it must not be
shown as a clean, available or successfully uploaded file. A negative review
decision requires a non-empty reason. AI observations, if added later, cannot
change validation or review decisions.

P2E stores no binary object, bucket/path, signed URL or preview-success claim.
Any metadata access-event record reserved in migration 043 is only an audited
intent/state record; it is not proof that a Storage object was opened or
downloaded.
Real private Storage upload, object-policy enforcement, scanner execution,
download/access audit and preview-failure behavior belong to P2H.

### Document visibility

| Actor | P2E access |
| --- | --- |
| Admin | Full document metadata and review workflow inside the actor's organization |
| Current Curator | Full metadata and review workflow only for the currently assigned case |
| Responsible Sales before handoff | Fixed-column checklist progress only; no filenames, evidence, hashes, review notes or version internals |
| Activated Student | Fixed self-only version history, review outcome and resubmission guidance |
| Finance | No sensitive document metadata or review access |

Former Curators, post-handoff Sales, unrelated students and every
cross-organization actor receive no document rows. Reduced Sales and Student
responses are fixed projections, not filtered base-table access.

## Manual finance contract

EVO Platform is the manual operational finance source for v1. An obligation
must identify whether it is an EVO service fee or a third-party study cost.
Money is stored as a positive integer in the smallest currency unit together
with one normalized currency. Floating-point amounts are not authoritative.

Only Finance or Admin may create or change an obligation or confirm a payment,
refund or finance stop factor. Every confirmation requires an actor, effective
time, source, evidence reference and request/idempotency key. Confirmed payment
and refund history is append-only.

The database must reject:

- zero or negative obligations, payments and refunds;
- a payment in a currency different from its obligation;
- confirmed payments above the remaining obligation;
- a refund without an exact confirmed parent payment;
- a cross-case, cross-organization or cross-currency refund;
- cumulative refunds above that referenced payment;
- a confirmation without evidence;
- a replay whose payload differs from the first request.

A correction is a new evidence-bearing event, not an edit or deletion of
confirmed history. A stop factor is also explicit: it has a reason, owner,
blocked-action key, created evidence and resolved evidence. It cannot silently
become a global block or infer a business rule that is not represented.

Outstanding and overdue state are computed from the obligation, confirmed
payments, valid refunds, due time and current time. They are not manually
asserted and are never inferred from amoCRM pipeline or sales stage. Finance
state does not replace the fixed Portal activation rule: account-specific
contract evidence plus Admin Curator assignment.

### Finance visibility

| Actor | P2E access |
| --- | --- |
| Admin / Finance | Full evidence-backed obligation, payment, refund and stop-factor history inside the organization |
| Responsible Sales before handoff | Fixed operational status for the case; no evidence, internal notes, actor IDs or transaction history |
| Current Curator after handoff | Fixed operational status and next action for the assigned case; no evidence or internal transaction fields |
| Activated Student | Self-only safe obligation label/category, amount/currency, due time, derived status, overdue notice and next action; no source, evidence, actor IDs, payment/refund event history or stop-factor internals |

Sales, Curator and Student projections do not grant finance confirmation or
base-table access.

## Notification-intent contract

Each delivery-intent record represents exactly one recipient, one channel and
one deduplication key. P2E supports durable in-app state and an individual
WhatsApp intent. The schema has no audience array, segment, topic, group,
broadcast or “all users” representation.

An individual WhatsApp intent requires a current consent record and an
evidence-bearing consent snapshot. Revocation prevents new eligible WhatsApp
intents. Deduplication is scoped at least by organization, recipient, channel
and business event so the same request cannot create a second intent.

The recipient may read only their own in-app notification projection and
acknowledge its read state through a narrow mutation path. Creation is
case-scoped and permission-checked; browser roles receive no direct insert,
update or delete grant on notification base tables.

P2E intentionally does not store a provider success claim. Phone resolution,
provider identifiers and message contracts belong to P2F. Queue publication,
retry, dead-letter and reconciliation belong to P2G. WAHA send and ACK evidence
are later real-provider gates.

## RBAC, RLS and API invariants

Migration 043 extends RBAC through immutable version-3 role bundles. Version 2
remains unchanged. The upgrade copies existing authority,
adds only the P2E capabilities for each role, advances every existing
membership including inactive/blocked authority debt, bumps each affected
profile access version once, and records role-history and audit evidence.

Every new exposed relation uses both RLS and FORCE RLS. Tenant-owned foreign
keys include the organization, and their leading indexes support the same
tenant-qualified joins. Base relations are a full-authority boundary only;
reduced Sales, Curator and Student audiences use fixed-column projections.

All mutations use narrow security-definer RPCs with an empty search path. Each
RPC must re-check the live profile, membership, published role bundle,
permission, case assignment/ownership and organization scope, lock the target
rows, and write one audit event. Direct browser writes are revoked.
`service_role` receives no blanket direct DML on P2E business tables, and
private helpers are not browser-callable.

The same request ID and same canonical payload return the original result.
Reusing the request ID with another action, resource or payload fails.
Append-only evidence tables reject update, delete and truncate. Mutable summary
state may change only through its audited RPC; legal retention remains open, so
P2E introduces no irreversible automatic deletion.

Migration 043 adds 16 FORCE-RLS relations:

- documents: `document_requirements`, `document_slots`, `document_versions`,
  `document_validation_events`, `document_reviews`,
  `document_access_events`;
- finance: `payment_obligations`, `payment_events`, `payment_evidence`,
  `stop_factors`, `stop_factor_events`;
- notifications: `notification_consents`, `notification_consent_events`,
  `notifications`, `notification_delivery_intents`, `notification_events`.

Its 18 public RPC/projection names are
`create_document_requirement`, `retire_document_requirement`,
`create_document_slot`, `record_document_version_metadata`,
`attest_document_validation`, `review_document_version`,
`sales_document_checklist`, `student_portal_documents`,
`create_payment_obligation`, `record_payment_event`, `create_stop_factor`,
`resolve_stop_factor`, `case_finance_summaries`, `student_portal_finance`,
`set_own_notification_consent`, `create_individual_notification`,
`mark_own_notification_read` and `my_notifications`. Grants are pinned to exact
signatures in the migration; the service role receives only the two trusted
document metadata/validation bridges and no direct table DML.

## Candidate evidence ledger

| Evidence | Current status | Completion evidence to add |
| --- | --- | --- |
| Migration 043 filename and SHA-256 | Passed locally | `043_platform_documents_finance_notifications.sql`; 175,818 bytes; SHA-256 `0aff95600e068481f5ef5b5acd052c380c5b3620fc2b03bb18bc9151b2e3c8d2` |
| Immutable v3 bundle upgrade | Passed locally | Every P2D membership, including inactive/blocked, advances once; v1/v2 remain immutable; stale v2 claims fail |
| Exact RPC signatures and grants | Passed locally | 18 public functions; fixed signature grants; authenticated/service direct table DML denied |
| Disposable PostgreSQL 001–043 | Passed locally | Full harness exit 0; two-organization/two-student document, finance, notification, replay and inventory suites |
| Local Supabase Auth/PostgREST | Passed for platform boundary | CLI 2.110.0 clean reset; 43 contiguous migrations; 8 synthetic users, 5 roles, 2 organizations; Auth refresh/stale/blocked invalidation and PostgREST schema/RLS smoke |
| Repository quality gates | Passed locally | Root security/unit/lint/typegen/typecheck/build/scenarios/audit and Playwright: 89 passed, 55 configured skipped; Inbox lint/typecheck/build/audit and 784 tests passed; Lead Agent Ruff and 124 tests passed |
| Binary Storage and scanner | Out of P2E | P2H real local Storage/scanner evidence |
| Queue/provider delivery | Out of P2E | P2F/P2G data-contract and real Queue evidence; later provider E2E |
| Managed/production apply | Not authorized | Separate environment and release evidence |

The local Auth/PostgREST smoke proves real local platform exposure and
live-claim invalidation; the detailed P2E object matrix runs in disposable
PostgreSQL with synthetic JWT claims. Neither claim is provider or managed
Supabase proof.

## P2E completion gate

P2E is complete only when the implemented migration and exact API/grant
inventory are reviewed together and the disposable PostgreSQL plus real local
Auth/PostgREST matrix proves:

- Admin/current-Curator document access and every reduced/denied document path;
- evidence-backed metadata validation/review/rework replay behavior;
- Finance/Admin-only confirmation, strict payment/refund arithmetic and
  evidence requirements;
- computed overdue values and safe Sales/Curator/Student projections;
- singular-recipient notification intent, consent and deduplication;
- no broadcast representation, direct browser DML or cross-tenant reference;
- no change to migration 042 and no binary-upload, scanner, Queue or provider
  success claim.
