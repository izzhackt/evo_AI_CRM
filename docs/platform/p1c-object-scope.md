# P1C Staff Object-Scope Authorization

Date: 2026-07-28 (Asia/Bishkek)
Block-ID: `EVO-P1C-OBJECT-SCOPE-2026-07-28`
Baseline: `origin/main@89ca7de30dec2f2533b8c9ff98f08e212838df89`

## Purpose

P1C makes the current SQLite application enforce the P0 role and handoff
contract at the object boundary. Route visibility remains a coarse first
check. Every migrated read and Server Action also evaluates the authenticated
actor against the target student case.

This is an interim current-app control. P2 must reproduce the same predicates
in Supabase RLS; P1C is not a substitute for RLS or Supabase Auth.

## Access contract

| Actor and case relationship | Read | Write |
| --- | --- | --- |
| Admin | Full current-app case access | Existing Admin capabilities; lifecycle rules still apply |
| Responsible Sales, case `pending` | Full pre-handoff operational case | Profile, applications, documents, tasks and updates |
| Same responsible Sales, case `active` or `closed` | Explicit non-sensitive handoff summary only | None |
| Assigned Curator, case `active` or `closed` | Full assigned operational case | Profile, applications, documents, visa, tasks, updates and audited lifecycle transitions |
| Other Sales or Curator | None | None |
| Finance | Finance projection only | Existing Finance/Admin payment actions |
| Student | Own activated portal through the existing session-to-client link | No staff action |

The Sales post-handoff projection selects only the case ID, student name,
operational stage, target country/degree, case state, assigned Curator name and
handoff time. It does not select contact details, notes, risks, applications,
documents, visa data, tasks, updates, payment history, audit reasons or
conversation content.

Missing and unauthorized objects use the same generic denial so callers cannot
use error details to enumerate records.

## Implementation seams

- `src/lib/access.ts` is the pure role/ownership/case-state policy and produces
  parameterized SQL predicates.
- Actor-aware queries apply those predicates in SQLite rather than fetching all
  rows and filtering in JavaScript.
- Server Actions authenticate independently and re-check the parent student
  case before a mutation.
- Finance no longer has the broad `/clients` route; finance pages use a
  payment-only projection and a minimal `{client id, name}` selector projection
  for creating a student's first obligation; they do not deep-link to Student
  360.
- Clientless task updates are Admin-wide or limited to the Sales/Finance
  assignee. Replayed updates for another user's personal or lead-linked task
  fail closed.
- Student Portal keeps its existing session-scoped, activation-gated query.
- P1B assignment, close/reopen reason and append-only audit semantics remain
  unchanged.

## Deliberate boundaries

- WhatsApp, conversation ownership and unified history are P1D/P5 work.
- This block does not create a configurable permission schema.
- This block does not change the SQLite schema or production data.
- Supabase Auth/RLS and organization isolation are P2/P3 work.
- Rich finance obligations/evidence/refunds and private document storage are P6
  work.
- No production deployment, migration, provider call or customer-data test is
  authorized by this block.

## Migration and rollback

There is no database migration. Rollback is the code-only revert of this block.
Because the change removes access and does not rewrite records, rollback does
not require data restoration. Production release still requires the separate
P3 inventory/backup/cutover gate.

## Acceptance evidence

- The policy contract is tested red-first, then green, as a data-driven actor ×
  ownership × case-state × capability matrix.
- Playwright covers full Admin access, responsible Sales pre-handoff access,
  post-handoff Sales summary-only access, assigned Curator access and denial
  for a different Curator,
  Finance projection, SQL-scoped queues/direct URLs and replayed Server Action
  denial for both client and clientless task objects with database immutability.
- The complete repository validation gate and exact GitHub head-SHA CI are
  recorded in the PR. Real-provider proof is `not-required`: P1C is a local
  authorization block and makes no provider-readiness claim.
