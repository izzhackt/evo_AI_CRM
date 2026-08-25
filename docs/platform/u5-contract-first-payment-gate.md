# U5 contract and first-payment handoff gate

Status: active Issue #382 implementation contract

- Parent: #376
- Depends on: merged U4/#381 and PR #396
- Starting main: `cfc75ca29a66546886de320aa80c454d18104b92`
- Plan authority: ADR 0021 and `EVO-LONG-RUN-1-NET-NEW-PILOT-2026-08-25`
- Evidence boundary: repository plus disposable local Supabase only; no managed,
  production, provider, WhatsApp, WAHA, amoCRM or customer-data mutation

## Outcome

The canonical Sales lead owns an explicit contract/first-payment gate. Staff
can see why the normal Admissions handoff is blocked, which evidence was
confirmed, and whether an authorized exceptional override exists. Nothing in
U5 performs the handoff; U6 consumes this database boundary.

## Canonical facts

One organization-scoped gate is keyed by the existing canonical lead and holds:

- contract state, evidence reference, confirming membership and timestamp;
- expected first-payment amount, ISO 4217 currency and due date;
- first-payment received date, evidence reference, confirming membership and
  timestamp;
- the latest explicit override reason, membership and timestamp;
- positive optimistic `gate_version` and updated time.

`gate_state` is derived, never supplied by a browser:

- `satisfied` only when contract and first payment are both confirmed;
- `overridden` only while the gate is otherwise incomplete and an authorized
  override exists;
- `blocked` otherwise.

`normal_handoff_allowed` is true only for `satisfied`. An overridden gate may
be consumed only by an explicit exceptional U6 path; it must never make a
normal handoff appear satisfied.

## Permission contract

Job title and the three pilot roles grant no U5 sensitive authority by
themselves. The live append-only individual grants are:

- `contract.evidence.confirm`;
- `finance.first.payment.confirm`;
- `admissions.handoff.gate.override`.

The existing Admin permission lifecycle grants/revokes all three keys and bumps
access version. The override key may be granted only to an active Admin
membership and still requires that explicit individual grant; an Admin title
alone is insufficient. An inactive membership, stale token,
cross-organization membership or missing latest grant is denied.

Evidence references are bounded metadata, not public file URLs or copied raw
documents. If a binary source is needed, it remains in the existing private
organization-scoped Supabase Storage path and the established object policy is
the access authority. U5 adds no public bucket and does not upload customer
files.

## Database boundary

Migration `087_platform_contract_payment_gate.sql` is forward-only and owns:

- the canonical gate/current-state table and private idempotency receipts;
- RLS, least-privilege grants and append-only audit evidence;
- `platform.staff_lead_admissions_gate(p_lead_id UUID)`;
- `platform.mutate_lead_admissions_gate(...)` for `confirm_contract`,
  `confirm_first_payment` and `override_gate`;
- a reusable database handoff assertion/read boundary for U6.

The migration deliberately does not backfill an existing lead. An `AFTER
INSERT` trigger initializes a blocked version-1 gate only for canonical leads
created after migration 087; legacy/history enrollment remains U10 policy and
cannot happen silently.

Every mutation uses a request UUID, expected version and normalized payload.
Same request plus same payload returns the committed receipt; conflicting reuse
fails. Stale versions, partial evidence, invalid dates/currency/amount, empty
override reason and no-op writes fail before canonical state changes.

Direct browser table writes are not granted. RPC code re-resolves the live JWT
authority and tenant at mutation time. Audit/receipt rows are immutable.

## Staff UI

The existing canonical `/sales/[leadId]` detail renders one gate card with:

- a truthful blocked/satisfied/overridden badge and handoff explanation;
- current contract/payment/override facts and actor/time provenance;
- only the controls allowed by the actor-specific permission booleans;
- explicit unavailable/invalid/forbidden/stale/conflict outcomes;
- no fake default data and no external action.

The Admin staff settings surface manages all three individual sensitive
permissions. Client controls are presentation only; database authorization is
the authority.

## Required proof

- Migration history is contiguous through 087 and clean reset succeeds.
- Real disposable PostgreSQL/Supabase tests cover allowed/denied contract and
  payment confirmation, job-title-without-grant denial, blocked/satisfied/
  overridden state, normal-versus-exceptional handoff semantics, override
  reason, inactive membership, tenant isolation, idempotency/conflict and
  append-only audit.
- Unit tests prove strict FormData/RPC boundary validation, exact arguments,
  foreign-tenant/malformed response rejection and truthful error mapping.
- Real local Auth/PostgREST/Next.js browser proof renders and mutates the gate
  through the canonical Sales detail and proves cross-tenant absence.
- Existing Node security, lint, build and repository gates remain green.

## Exclusions

No payment processing, banking, invoice, ledger, broad finance product,
Admissions handoff execution, outbound WhatsApp, amoCRM write, provider call,
legacy fallback, production deployment or managed Supabase/customer-data
mutation is part of U5.
