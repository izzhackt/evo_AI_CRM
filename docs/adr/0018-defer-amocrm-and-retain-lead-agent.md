# ADR 0018: Defer canonical amoCRM integration and retain Lead Agent

- Status: historical current-state safety decision; target ownership and active
  sequence superseded by ADR 0020
- Date: 2026-08-06
- Refines: ADR 0014, ADR 0016 and ADR 0017
- Supersedes in conflict: the execution order, P8 acceptance boundary and Lead
  Agent retirement/removal language in the earlier plans and ADRs
- Superseded for target architecture and execution by: ADR 0020

## Context

P4A's local, read-only mapping-discovery contract is merged. P4B implementation
work is preserved on remote branch
`izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`; it has no implementation PR. Its
focused repository checks passed, but the attempted full local Supabase gate
failed closed in the real Auth/PostgREST hook before Playwright. That run is
failed/non-evidence and proves neither P4B acceptance nor a real amoCRM account.

The owner has deferred P4/P4B so the team can continue useful capabilities that
do not depend on canonical amoCRM. The same owner decision removes P9 from the
authorized execution scope. It does not authorize provider or production
mutation.

## Decision

1. P4/P4B is preserved and deferred, not cancelled. Resumption requires a new
   owner decision and fresh launch-control evidence from the preserved branch
   or a reviewed successor.
2. The current execution order is P5, P6, P7, P8 and P10. Historical phase
   labels are retained; P10 follows P8 and phases are not renumbered.
3. P5-P8 may implement and prove only capabilities that remain correct without
   canonical amoCRM. No mock, SQLite shim, hardcoded mapping, fake provider,
   inferred sales identity/stage or silent fallback may replace P4.
4. amoCRM-dependent identity resolution, contact/lead linkage, responsible
   Sales ownership, canonical sales stage, contract-stage handoff, mapping
   approval and the amoCRM portion of end-to-end acceptance remain fail-closed
   and are reported `DEFERRED`, never passed.
5. P8 accepts only the real executable P5-P7 paths within the authorized scope.
   Missing credentials, test identities or production authority remain
   explicit blockers and are never replaced with synthetic provider proof.
6. P9 is removed from the current execution scope. EVO Lead Agent, the legacy
   webhook/session path and rollback path remain deployed and frozen. They must
   not be deactivated, retired or deleted under this decision.
7. P10 is an audit of the newly authorized scope. It must list P4 as deferred,
   Lead Agent as retained and every provider/production blocker separately. It
   must not claim that the original full EVO Platform target is complete.
8. Student Profile document reading, extraction, autofill and form export remain
   a separate system outside `evo_AI_CRM` under ADR 0017.

## Consequences

- P5 can build the real Supabase/WAHA messaging path, draft-only AI, human
  review/manual-send state and audit without pretending to resolve amoCRM.
- P6 and P7 can advance their independent admissions, Portal, document,
  finance, notification, security and recovery scopes.
- A conversation or student case that requires canonical amoCRM identity or
  stage remains visibly unavailable until P4 resumes.
- No production deployment/migration, DNS change, WAHA QR/session/webhook
  mutation, live WhatsApp send, real amoCRM write, auto-reply/outbound enablement
  or service deletion is authorized.
