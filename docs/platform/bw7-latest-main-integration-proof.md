# BW7 — latest-main integration proof

- Status: implementation and local validation complete; exact-head review, CI
  and controller merge pending
- Date: 2026-08-04
- Block-ID: `EVO-BW7-INTEGRATION-PROOF-2026-08-04`
- Starting main: `a2ecadbe05dcf6993bbd558f3d80fa405a571a7c`
- Migration: none; canonical history remains 001–057
- Parent contract: [`EVO_PLATFORM_LONG_RUN_PLAN.md`](../EVO_PLATFORM_LONG_RUN_PLAN.md)

## Purpose and evidence boundary

BW7 closes the smallest missing adapter between the accepted Student 360 UI
and the already-merged Supabase assignment contract. It does not create a new
frontend or change the lifecycle. Admin now sees RLS-authorized active Curator
memberships, submits the existing assignment form to
`platform.assign_student_case_curator(...)`, and reads the resulting Curator
and Portal activation state back through authenticated RLS queries.

The proof is real for the disposable local Supabase, Auth, PostgREST and Next.js
runtime. It is not staging, managed Supabase, amoCRM, WAHA, AI-provider,
customer-message or production evidence. The legacy SQLite data plane remains
unreachable from Platform sessions and its sentinel file is never created.

## One-case lifecycle exercised

The connected browser gate uses one dedicated synthetic Student identity and
one student case:

1. Responsible Sales opens the pending case in the accepted Student 360 page,
   generates an immutable contract draft from an approved typed template and
   records staff approval.
2. The linked Student signs in before assignment and is held at
   `/platform-pending`; a direct `/portal` request remains fail-closed.
3. Admin opens the same case, selects an active Curator through the existing
   `curator-assignment-form`, supplies a reason and submits a render-time UUID
   request ID.
4. The database RPC atomically sets the Curator, rotates record scope, changes
   the case from `pending` to `active`, sets handoff and first Portal activation,
   bumps affected live-authority versions and appends exactly one audit event.
5. The assigned Curator signs in with fresh authority, opens the same case,
   creates the versioned post-contract checklist and approves a generated report.
6. The linked Student signs in with fresh authority and reaches the read-only
   Student Portal profile. Internal contract/report controls are absent and the
   staff route redirects away.
7. Responsible Sales signs in again after handoff and receives only the fixed
   `platform-sales-handoff-summary`; full case, assignment and contract/report
   controls remain absent.

The broader 28-test connected suite also retains BW1–BW6 provenance,
applications/catalog, Student Profile, private-document, knowledge/decision,
manual-draft and cross-role/cross-organization negative paths. BW7 does not
claim that every prior object belongs to the one synthetic lifecycle case.

## Authorization and failure behavior

- The browser uses only the local publishable key. Server authorization still
  resolves `getClaims()` plus live Platform authority; table access remains RLS.
- Only Admin receives Curator options or the assignment server action. The RPC
  independently requires `case.curator.assign`, organization scope, active
  Curator membership, a reason and an idempotency request ID.
- Current assignment state is selected from `platform.student_cases` under the
  existing full-case RLS predicate. Active Curator/profile reads use the
  existing organization membership/profile policies.
- Malformed UUIDs, timestamps, cross-organization rows, wrong roles, missing
  profiles or unexpected RPC responses fail closed with a safe unavailable
  result.
- The assignment form preserves its request ID across uncertain results. The
  database remains the owner of replay protection and append-only audit.

## Validation ledger

| Gate | Result | Honest boundary |
| --- | --- | --- |
| Root security/unit/static, typecheck, lint and build | Pass — `npm run test:security`, 144/144 unit tests, Next typegen, `tsc --noEmit`, lint and production build | Assignment DTOs reject cross-org/wrong-role shapes; Student 360 source is checked for RPC wiring, request ID and legacy-import absence |
| Real connected local gate | Pass — `npm run test:supabase:local` | 28/28 Playwright tests, 57 contiguous migrations, Auth/PostgREST RLS, private Storage and PGMQ; synthetic local data only |
| Same-case BW7 browser path | Pass | Sales draft, pre-assignment Student Portal denial, Admin assignment, atomic activation, Curator checklist/report, Student Portal and post-handoff Sales summary all use one case and fresh role sessions |
| Root scenarios, E2E/a11y and audits | Pass — 39/39 scenarios; Playwright 89 passed and 55 intentionally skipped; production and development audits report zero vulnerabilities | Local repository/UI regression only; scenarios stop at explicit not-configured provider states |
| Retained service compatibility | Pass — EVO Inbox 788/788 tests plus lint/typecheck/build/audits; Lead Agent 124/124 tests plus Ruff | Local compatibility only; no Inbox, WAHA, amoCRM, AI-provider or production mutation |
| Legacy and cleanup boundary | Pass | SQLite sentinel absent; exact-project EVO validation containers, volumes and processes absent after the run; Inbox resources untouched |
| Persistent staging | Blocked | No isolated staging project/credentials and no authorized staging exercise are available in this run |
| Real provider/production proof | Blocked | No amoCRM lead, WAHA session/message, AI provider, managed migration, customer data or production mutation was exercised |

Two development runs reached the intended safe UI state but failed strict
test-only assertions: the first used an ambiguous Student-name locator, and the
second expected a percent-encoded pending redirect although the application
returned the equivalent `from=/portal` query. The locator was scoped to
`#portal-main`, the redirect assertion was aligned to the actual route contract,
and a subsequent complete clean reset passed 28/28. Neither failed run is
counted as clean evidence.

## Rollback note

BW7 has no migration and no managed-environment state. Before merge, rollback
is branch/PR abandonment. After merge, a reviewed code revert may remove the
assignment adapter and browser fixture while preserving migrations 001–057 and
all historical audit contracts. No production deployment or destructive data
operation is part of this block.
