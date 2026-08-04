# BW5 — university/college catalog import boundary

- Status: implementation candidate; exact-head CI and final review pending
- Date: 2026-08-04
- Block-ID: `EVO-BW5-CATALOG-IMPORT-BOUNDARY-2026-08-04`
- Starting main: `cb74856305ed4a71d3bfa0ad94a19637bb6ffa48`
- Additive migration: `056_platform_university_catalog_import_boundary.sql`
- Parent contract: [`EVO_PLATFORM_LONG_RUN_PLAN.md`](../EVO_PLATFORM_LONG_RUN_PLAN.md)
- Requirements: [`EVO_PLATFORM_TZ.md`](../specs/EVO_PLATFORM_TZ.md),
  FR-106, FR-107, FR-108 and FR-110

## Purpose and evidence boundary

BW5 adds a reviewable, PII-free import boundary for university and college
metadata inside the accepted `/applications` frontend. An import source or
staged row cannot write directly to the approved catalog or a student case.
Only an explicit Admin review of a successfully validated batch can promote
catalog rows.

This candidate is repository/local evidence only. It does not prove a real
Notion, Google Drive, Google Sheets or PDF import; a managed Supabase apply;
production data; or provider readiness.

## Data model and flow

| Object | Purpose | Publication rule |
| --- | --- | --- |
| `source_registry` | Existing reviewed source URL, kind and exact revision | Admin review is required before a batch can reference it |
| `catalog_import_batches` | Immutable source/revision boundary and review state | `staging` → `validated`; a validated batch may be approved, and a staging or validated batch may be rejected |
| `catalog_import_candidates` | Typed institution metadata only; no raw provider payload | Validation records safe error codes; rows remain audit evidence |
| `catalog_institutions` | Approved university/college metadata with source and batch provenance | Created atomically only by Admin batch approval |
| `university_applications.catalog_institution_id` | Nullable durable link to the approved catalog row | Existing manual application flow remains valid |

The implemented path is:

1. Admin registers and reviews a supported source in the existing source
   registry. A batch accepts only a reviewed source with an exact revision.
2. Admin creates a university or college batch pinned to that source revision.
3. Admin stages typed candidate fields. The source-row key is a one-way hash of
   organization plus the source record reference, so it is stable across
   batches without storing the source reference itself.
4. Admin validates the batch. Missing/invalid fields and duplicate approved or
   within-batch records produce allowlisted validation errors.
5. Admin explicitly approves a validated batch or rejects a staging/validated
   batch. Approval requires every candidate to be valid and promotes all rows
   atomically; rejection promotes none. Replay uses request IDs and input
   hashes, with audit events for every mutation.
6. Staff with the existing `application.manage` permission and case scope may
   create an application from an approved catalog row. This does not broaden
   the established case-authorization contract.

All three new catalog tables have RLS enabled and forced. Direct table writes
are revoked; authenticated mutations go through the narrow audited RPCs.

## Role boundary

| Role | Read approved catalog | View/manage sources and import staging |
| --- | --- | --- |
| Admin | Yes | Yes; organization-scoped only |
| Sales | Yes | No |
| Curator | Yes | No |
| Finance | No | No |
| Student | No | No |

Cross-organization reads are denied. Catalog-backed application creation still
requires the pre-existing `application.manage` permission and the target
student-case object scope; catalog visibility alone is insufficient.

## Provider and data boundary

- Supported source kinds are `google_spreadsheet`, `google_drive_file` and
  `notion_database`. They are discovery/import inputs, never the runtime
  database or a public dependency.
- The real university source is blocked behind the AbdyldaYT Notion sign-in.
  No authorized source snapshot was available in this run.
- No confirmed college dataset was available, so the candidate contains no
  invented college or university records.
- Tests use synthetic institutions and UUIDs only. Raw source payloads,
  customer messages, customer PII and credentials are not stored in catalog
  tables, fixtures or this evidence file.
- No provider request, managed Supabase mutation or production mutation was
  performed.

## Independent pre-commit findings closed

Read-only app and SQL reviews found the following issues before the final SHA
review. Each was repaired without expanding the BW5 scope:

| Severity | Finding | Remediation and regression proof |
| --- | --- | --- |
| Medium | The source-row key included the batch ID, so the same source record was not stable across batches. | `deriveCatalogSourceRecordKey` now hashes organization plus source-record reference only. Unit coverage proves same-tenant stability and cross-tenant separation. |
| Low | Rejecting a source redirected to the success outcome `source_reviewed`. | The action now emits `source_rejected`; UI copy and a focused source assertion cover the rejected result. |
| Medium | Three Admin review-reason inputs relied on placeholder text instead of programmatic labels. | Each field now has an explicit `label` binding; the environment-dependent BW5 browser suite includes Axe checks for pending and validated states. |
| Low | Manual-institution browser validation depended on whether any catalog row existed, not on the selected mode. | A focused client field component defaults to required manual input and disables it only while an approved catalog row is selected. |
| Low | The UI/action tests covered only the Admin happy path. | Focused tests now cover rejection redirects, pre-validation approval absence, live Admin guard calls, Curator read-only visibility and dynamic field state; the connected local Supabase gate passes 26/26 browser tests. |
| Low | A null source-record key fell through to a generic database constraint error. | The RPC now rejects it explicitly with `22023`; the RLS suite asserts the controlled failure. |
| Low | The catalog-backed application RPC lacked complete role/object-scope proof. | The RLS suite now covers assigned Sales/Curator success and Finance, Student, unassigned Curator and cross-organization denial, including audit assertions. |
| Low | The first exact-head Inbox CI run still pinned migration freshness to 055. | The companion schema-contract assertion now follows the additive 056 boundary; its full local test suite passes 788/788. |
| Low | The first exact-head PostgreSQL run exposed an implicit text result in the candidate-validation enum assignment. | Both `CASE` branches now cast explicitly to `platform.catalog_candidate_validation_status`; fresh exact-head PostgreSQL execution remains required. |
| Medium | A valid one-character institution name was accepted by migration 056 but rejected by the TypeScript projection. | The projection now follows the database nonblank contract, with a focused one-character regression assertion. |
| Medium | Admin batch selection and review showed source kind/revision but not the canonical source URL, so two sources could be ambiguous. | Source kind, canonical URL and revision are now visible in the selector, batch list and selected-batch header; browser proof asserts the pinned URL before staging. |
| Low | The browser fixture used a noncanonical second Notion URL and lacked a crafted staging-to-approval RPC denial. | Both synthetic URLs now use distinct 32-hex IDs, and the SQL RLS suite asserts `staging → approve` fails with `55000` before validation. |
| Low | BW5 browser assertions attached test hooks to a custom `Card` that does not forward arbitrary DOM props and used one stale RU button label. | Test hooks now sit on real DOM containers, both approved-catalog assertions target semantic rows, and both staging paths use the accepted accessible name. |

This preflight is not the required independent exact-head launch-control
review. That review must run after commit and exact-head CI.

## Verification ledger

Verified locally on Node.js 22.23.1:

| Check | Result | Boundary |
| --- | --- | --- |
| `npm ci` | Pass; 429 packages installed, 430 audited, zero reported vulnerabilities | Dependency install only |
| `npm run test:supabase:history` | Pass; current migration is 056 | History/static contract; does not execute 056 |
| `npm run test:security:node` | Pass, 130/130 | Static/Node security tests |
| `npm run test:unit` | Pass, 127/127 | Includes six BW5 catalog tests and the projection-alignment regression |
| `npm run lint` | Pass | Source lint only |
| Next type generation and `tsc --noEmit` | Pass | Type contract |
| `npm run build` | Pass; Next.js generated 40 static page outputs | Production build, not deployment |
| `npm run scenarios` | Pass, 39/39 | Synthetic scenario evaluation |
| Production audit and approved development allowlist audit | Pass; zero vulnerabilities | Package advisory state at check time |
| `npm run test:security:postgres` | Exit 0; migrations 001–056 and the BW5 inventory/RLS suites passed | Disposable PostgreSQL only; includes direct-write, cross-role, cross-org, object-scope and staging-approval denials |
| `npm run test:supabase:local` | Exit 0; 56 migrations, 26/26 browser tests, Auth/RLS/private Storage/PGMQ passed | Synthetic local-provider proof only; exact `evo-platform-local` resources and lock were absent after cleanup |
| Full `npm run test:e2e` | Exit 0; 89 passed, 55 environment/viewport skips | Generic regression and a11y proof; BW5's environment-dependent path is proved separately by `test:supabase:local` |
| EVO Inbox install/lint/typecheck/tests/build/audits | Pass; 788/788 tests, 56/56 build pages, zero vulnerabilities | Companion schema-contract compatibility only; no Inbox provider or production mutation |
| Scoped Gitleaks diff scan and `.next/static` provider-secret-name scan | Pass; no leaks or server-only provider key names found | Current local patch/build only; release artifact and runtime configuration remain separate gates |
| `git diff --check` and shell syntax check | Pass | Patch/shell syntax only |

The local gate used OrbStack only for repository-scoped disposable resources.
After success, the exact `evo-platform-local` container, volume and network
labels and the singleton lock were empty; the pre-existing Inbox inventory
remained 12 containers and 3 volumes. This is cleanup evidence, not a claim
about a managed or production environment.

Before approval or merge, all four exact-head CI jobs and the independent
SHA-bound launch-control review must be green. The GitHub **Main CRM** job must
independently apply migrations 001–056 and execute both BW5 inventory/RLS
suites. Managed Supabase, production and real-provider proof remain blocked
even after repository CI passes.

## Migration and rollback note

Migration 056 is additive: it creates three catalog tables and audited RPCs,
publishes version-10 role bundles, and adds a nullable catalog foreign key to
`university_applications`. It imports no legacy SQLite or provider data and has
not been applied to a managed environment.

Before any remote apply, rollback is branch/PR abandonment. After a separately
authorized apply, do not run a destructive down migration: disable the UI/RPC
entry points and use a reviewed forward migration to retire permissions or
repair the schema while retaining provenance and audit rows. Any future real
source import needs separate authorized access and its own sanitized evidence.
