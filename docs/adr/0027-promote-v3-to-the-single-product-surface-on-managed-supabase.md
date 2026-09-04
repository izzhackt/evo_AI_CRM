# ADR 0027: Promote V3 to the single product surface on managed Supabase

- Status: accepted
- Decision date: 2026-09-04 (Asia/Dubai)
- Decision owner: EVO product owner
- Execution parent: GitHub issue #543
- Ordered children: GitHub issues #594 through #600
- Supersedes: the V3-design-reference-only boundary in `docs/EVO_LAUNCH_PLAN.md`
  and AGENTS guidance that treated `claude/v3-frontend` as out-of-band
- Retains: ADR 0024 managed-Supabase authority, ADR 0026 provider-acceptance
  limits, and the replace-do-not-layer rule

## Context

The repository now has two truths in tension. Managed Supabase, Supabase Auth,
private Storage and the single-runtime cleanup path are already the accepted
runtime foundation on `main`. Separately, `claude/v3-frontend` contains the
next staff UI and the product-direction documents that now express the owner's
current intent: V3 becomes the product surface, while the existing server-side
business engine and canonical Supabase model remain authoritative.

Keeping V3 as a side branch while continuing backend or cleanup work on `main`
would raise merge cost and encourage duplicate interfaces or rewritten logic.
The branch already isolates its UI under `src/app/(v3)/`, `src/components/v3/`
and `src/lib/v3/`, so the safe next move is to merge it intentionally on top of
the current `main`, then continue replacement slice by slice.

## Decision

EVO will continue as one managed-Supabase product with V3 as its active UI
direction. The first active successor slice is to merge `claude/v3-frontend`
into `main`, reconcile it with the current Supabase/runtime contract, and make
V3 the product surface without reviving removed SQLite, Drizzle, legacy-worker
or fallback paths.

The product engine is not rewritten for that merge. Existing server actions in
`src/lib/server/` and the canonical CRM repository remain the authoritative
business-logic path. V3 connects to them through forms and source adapters; it
does not introduce duplicate domain rules, alternate repositories or a second
UI for the same completed capability.

Root `supabase/` remains the sole migration authority. Before adding schema,
reuse canonical capabilities already present in Supabase migrations, including
the document checklist/review model from migrations 043, 046, 053 and 055,
visa cases and commands from migration 042, lead ownership and extended sales
workflow from migration 086, and the platform audit slice already guarded by
`EVO_PLATFORM_P7A_AUDIT_ENABLED`.

`src/lib/v3/*` becomes the preferred V3 data-access rewrite boundary. When
authority or response shape changes, update the V3 source adapters before
changing screens. Keep one wording dictionary in `src/lib/v3/wording.ts`; do
not add a third status dictionary or an in-app WhatsApp session-connection UI.

## Consequences

- The repository stops treating V3 as a waiting-room branch and instead absorbs
  it as the next product surface under the current managed-Supabase contract.
- Replacement stays slice-based: a V2 screen disappears only when the same
  business action is available and proved in V3 on the canonical server path.
- Current `main` cleanup work remains preserved. The V3 merge must reconcile,
  not regress, the retired-route contract, private API boundaries, Supabase
  Auth path, release contract and historical-archive protections already merged
  on `main`.
- Production/provider mutation remains controlled. This ADR does not itself
  authorize managed-Supabase schema pushes, customer-data mutation, webhook
  ownership transfer, provider enablement or V1 runtime retirement.
