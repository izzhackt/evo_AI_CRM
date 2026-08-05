# P4B amoCRM mapping selection and approval contract

Date: 2026-08-04 (Asia/Almaty)

Block-ID: `EVO-P4B-AMOCRM-MAPPING-SELECTION-APPROVAL-PLAN-2026-08-04`

## Outcome

P4B is a docs-only launch-control gate. It defines the smallest next slice of
the canonical amoCRM adapter after merged P4A discovery. A later, separate
implementation PR may let a current same-organization Admin review one
immutable discovery version and approve a bounded mapping for messaging use.

P4B does not add application code, a migration, credentials, OAuth custody,
provider calls, webhook intake, identity sync, reconciliation, jobs or
canonical amoCRM writes. Local approval is operational configuration evidence;
it is not real-provider proof.

## Immutable input boundary

- `platform_private.amocrm_mapping_discovery_versions` remains append-only.
- A discovered snapshot is evidence and is never edited, deleted, relabeled or
  given a mutable `active` flag by the approval workflow.
- An approval always references one exact discovery row belonging to the same
  `organization_id` and `amocrm_account_id`.
- The approved use is fixed to `messaging`. A future use case requires its own
  reviewed contract instead of reusing the messaging selection implicitly.
- Sanitized discovery metadata remains separate from approval decisions and
  from any future provider delivery or synchronization evidence.

## Approval lifecycle contract

The later implementation must use append-only approval events. Each event
records the organization, amoCRM account, messaging use, discovery version,
selected bindings, actor, timestamp, reason and the prior approval it
supersedes when applicable.

Allowed event kinds are:

- `approved`: makes the referenced selection current;
- `revoked`: removes the current selection without deleting its history.

The current approved mapping is a deterministic projection of the latest
valid event for the organization/account/use tuple. It is not a mutable flag on
the discovery row. Approval, supersession and revocation require a non-empty
reason. Historical events remain immutable and queryable through audited,
bounded server projections.

Exactly one current selection may exist for one organization, amoCRM account
and `messaging` use. The approving transaction must serialize competing
changes, validate the expected prior event and fail on stale concurrent input.

## Selected binding contract

The approval references only IDs already present in the selected sanitized
snapshot:

- one sales `pipeline_id`;
- one signed-contract `status_id` belonging to that pipeline;
- the canonical responsible-user source rule
  `lead.responsible_user_id`, validated against the discovered account users
  when a lead is later resolved;
- explicitly named required lead and contact custom-field bindings, with every
  field ID validated against the correct entity collection in the snapshot.

The implementation must reject unknown IDs, a status from another pipeline,
cross-account or cross-organization references, duplicate semantic binding
keys, inactive responsible-user evidence used as an approval shortcut, and a
discovery version whose account identity does not match the approval scope.
No global amoCRM ID may be hardcoded.

## Authorization and data-access contract

- Approval, supersession and revocation are Admin-only server actions/RPCs.
- Server authorization uses verified Supabase claims plus the current live
  authority bundle. Missing, inactive, blocked, stale or cross-organization
  authority fails closed.
- Auth-admin status without current Platform organization authority grants no
  access.
- `anon`, non-Admin roles and direct browser/Data API table writes are denied.
- The browser uses only the publishable key. Service-role and amoCRM secrets
  remain server-only and are not introduced by P4B.
- Every successful decision records actor, before/after references, reason,
  request ID and timestamp in immutable audit evidence.

## Existing frontend boundary

The later implementation must extend the accepted Platform `/whatsapp`
integration-health seam and existing design language. It must not create a
parallel admin application, generic settings console, duplicate Inbox CRM or
new pipeline/funnel surface.

An Admin may receive a compact review-and-approve control on that existing
surface. Other authorized staff may receive only a bounded read-only state.
When no mapping is approved, only behavior that depends on canonical amoCRM
mapping is blocked with an explicit `mapping not approved` state; local
provider-free conversation and draft-review evidence must not be presented as
provider-linked success.

## Later implementation ownership

Only after this docs-only amendment is independently reviewed,
controller-merged and green on exact-main CI may a P4B implementation PR open.
That PR may own:

- the next-free additive migration (expected `059`, rechecked against fresh
  `origin/main` and open migration ownership);
- the typed mapping-approval contract and server repository/actions;
- minimal accepted `/whatsapp` integration-health and Admin review controls;
- focused authorization, RLS, audit, concurrency and browser-state tests.

It must not own OAuth storage, provider discovery execution, webhook routes,
identity/context synchronization, outbox/jobs, reconciliation, canonical
writes, WAHA/AI behavior, a new frontend or legacy SQLite/root-auth changes.

## Acceptance evidence for the later implementation

The implementation PR must prove at least:

1. a current same-organization Admin can approve one valid discovered mapping;
2. a second Admin decision supersedes the prior approval only with the expected
   prior reference and a reason;
3. revocation leaves immutable history and produces no current selection;
4. `anon`, Sales, Curator, Finance and Student cannot create approval events;
5. a cross-organization Admin, stale authority, inactive membership and
   Auth-admin without Platform authority all fail closed;
6. unknown discovery versions, account mismatches, invalid pipeline/status
   relationships and invalid custom-field bindings are rejected;
7. discovery and approval rows cannot be updated, deleted or truncated through
   browser-accessible paths;
8. concurrent stale approvals cannot create two current selections;
9. the accepted frontend shows Admin controls only to Admin and a truthful
   fail-closed state when no current approval exists;
10. no browser bundle contains service-role, OAuth or amoCRM secrets;
11. audit evidence contains actor, before/after, reason, request ID and time;
12. clean disposable PostgreSQL/RLS and local Supabase tests pass from the
    canonical migration history, followed by exact-resource cleanup.

Focused unit/contract/browser tests are local evidence only. A live amoCRM
account, provider discovery, account mapping correctness and provider
availability remain blocked until separately authorized and exercised.

## Rollback

This P4B plan amendment is docs-only and can be reverted as one documentation
commit before dependent implementation merges.

The later implementation must be additive. Runtime rollback stops consuming
the current-approval projection and returns mapping-dependent behavior to the
fail-closed `not approved` state. Rollback must not delete or rewrite discovery
versions, approval history or audit evidence.
