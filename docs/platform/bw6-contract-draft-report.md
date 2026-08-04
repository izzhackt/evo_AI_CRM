# BW6 — contract draft and post-contract report boundary

- Status: controller-merged in PR #114; exact-main CI green
- Date: 2026-08-04
- Block-ID: `EVO-BW6-CONTRACT-DRAFT-REPORT-2026-08-04`
- Starting main: `1061bad81b27deee98d9c69380b3e543dc281924`
- Expected additive migration: `057_platform_contract_draft_report.sql`
- Parent contract: [`EVO_PLATFORM_LONG_RUN_PLAN.md`](../EVO_PLATFORM_LONG_RUN_PLAN.md)
- Requirements: [`EVO_PLATFORM_TZ.md`](../specs/EVO_PLATFORM_TZ.md),
  FR-093, FR-101 and FR-102

## Purpose and evidence boundary

BW6 connects versioned contract drafts and post-contract service reports to the
existing Student 360 frontend. It does not create a second document system or
parallel UI. A generated artifact may use only a source-reviewed template and
an explicit typed manifest whose values are resolved from authorized Platform
records. Chat text, raw provider payloads, document bodies and legacy SQLite
records are never generation inputs.

The repository slice stores a deterministic plain-text draft plus structured
snapshots. It does not claim that this internal artifact is the externally
signed legal contract. Real legal template approval, PDF/DOCX generation,
electronic signature, managed Storage publication and customer delivery are
outside this block and require separately authorized evidence.

## Data and workflow contract

| Object | Purpose | Mutation rule |
| --- | --- | --- |
| Contract template version | Approved plain-text template, strict field manifest, checklist blueprint and reviewed source provenance | Admin creates, approves or retires append-only versions |
| Student-case contract draft | Immutable rendered output and exact input/template/hash snapshot | Authorized case owner generates a new version; approval or rejection changes status only |
| Post-contract item | Delivered/open work, owner, evidence and next action | Admin or assigned Curator updates the live checklist with an audit event |
| Post-contract report | Immutable counts and item snapshot for one case | Generated only from valid checklist items; approval or rejection changes status only |

The intended path is:

1. Admin selects a reviewed `source_registry` entry and creates a template
   version. The form accepts plain text plus bounded line-based manifest and
   checklist definitions; it never accepts arbitrary executable expressions.
2. Admin approves the template only after every placeholder maps to an
   allowlisted typed Platform source. Approved and retired template content is
   immutable.
3. A responsible Sales user on a pending case, the assigned Curator on an
   active/closed case, or Admin generates a contract draft. The database
   resolves values itself from the case, minimized profile, applied country
   version and approved OP handoff fields; the browser cannot supply a
   replacement payload.
4. An authorized case owner approves or rejects the immutable draft with a
   reason. Regeneration creates a new version; replay of one request ID cannot
   create a duplicate.
5. Admin or the assigned Curator seeds and updates post-contract items for an
   active/closed case. A delivered item requires evidence. An open,
   in-progress or blocked item requires an owner and next action.
6. A report snapshots the validated items and their delivered/open/blocked
   counts. Its content remains immutable and is approved or rejected with
   separate audit evidence.

Every mutation uses a bounded reason, request ID, advisory-lock/idempotency
contract and append-only `audit_events`. Direct authenticated table writes are
revoked; RLS and the RPC guard both enforce organization and case scope.

## Authorization contract

| Role | Template lifecycle | Contract draft | Post-contract checklist/report |
| --- | --- | --- | --- |
| Admin | Create, approve, retire | Generate and review in organization scope | Manage, generate and review in organization scope |
| Sales | No | Generate and review only for the responsible pending case | No |
| Curator | No | Generate and review only for the assigned active/closed case | Manage, generate and review only for the assigned active/closed case |
| Finance | No | No | No |
| Student | No | No | No |

Sales post-handoff summary access does not expose BW6 artifacts. Finance access
is not inferred from operational finance permissions. Student Portal exposure
is deferred until an explicitly approved external-document contract exists.

## Typed input and rendering boundary

- Template placeholders are identifiers, not code. Unknown, duplicate or
  unmanifested placeholders fail closed.
- Manifest sources are a fixed allowlist of case/profile/country/handoff
  fields. Dynamic commercial values may be read only from the already approved
  scalar handoff map and must match the declared type.
- Rendering produces plain text. Template content is never injected as HTML.
- Input, output, template and report snapshots carry SHA-256 evidence and
  version identifiers.
- Synthetic tests use no customer names, messages, phone numbers, documents or
  provider records.

## Validation ledger

| Gate | Result | Honest boundary |
| --- | --- | --- |
| Migration history and disposable PostgreSQL inventory/RLS | Pass — `npm run test:security` | Applied all 57 contiguous migrations and passed BW6 inventory plus role, tenant, object, lifecycle, immutability and idempotency denial suites; disposable local PostgreSQL only |
| Connected local Supabase/Auth/browser flow | Pass — `npm run test:supabase:local`, 27/27 connected browser tests | Exercised the existing Student 360 frontend with synthetic Auth identities, private Storage and durable-work checks; local proof only |
| Node unit/security, lint, typecheck, build and scenarios | Pass — 142/142 unit tests and 39/39 scenarios | `npm run lint`, Next type generation, `tsc --noEmit` and production build passed; repository and UI contract only |
| Generic E2E/a11y regression | Pass — 89 passed, 55 intentionally skipped | Accessibility coverage passed; this does not replace the connected Supabase path or provider proof |
| EVO Inbox compatibility | Pass — 788/788 tests, lint, typecheck, build and audits | Schema contract freshness only; seven pre-existing lint warnings, no Inbox/provider mutation |
| Retained EVO Lead Agent compatibility | Pass — Ruff and 124/124 tests | Repository compatibility only; no service, provider or production mutation |
| Secret and legacy-boundary checks | Pass — gitleaks and browser-bundle symbol scans clean | Platform modules do not import the legacy SQLite/auth/`wa_*` data plane; scans do not prove managed-environment configuration |
| Exact-head GitHub CI and independent review | Pass | Independent exact-SHA review and all four required PR jobs passed before controller merge; exact-main push CI run `30918820654` is green |
| Real legal template/provider/production proof | Blocked | No approved real template, e-sign/PDF provider, managed apply or production authority is claimed |

## Migration and rollback note

The BW6 migration is additive and must remain unapplied to managed environments
in this run. Before an authorized remote apply, rollback is branch/PR
abandonment. After a separately authorized apply, rollback is forward-only:
disable the Student 360 entry points and RPC execute grants, preserve immutable
artifacts and audit rows, and ship a reviewed compensating migration. No
destructive down migration or silent artifact deletion is allowed.
