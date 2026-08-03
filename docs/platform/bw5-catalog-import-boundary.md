# BW5 — university/college catalog import boundary

- Status: implementation candidate; exact-head CI and final review pending
- Date: 2026-08-03
- Block-ID: `EVO-BW5-CATALOG-IMPORT-BOUNDARY-2026-08-03`
- Starting main: `9ef7a7264c901f9c25e35ccbf106afe00c3c91ad`
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
| Low | The UI/action tests covered only the Admin happy path. | Focused tests now cover rejection redirects, pre-validation approval absence, live Admin guard calls, Curator read-only visibility and dynamic field state; runtime execution remains part of the blocked local Supabase gate. |
| Low | A null source-record key fell through to a generic database constraint error. | The RPC now rejects it explicitly with `22023`; the RLS suite asserts the controlled failure. |
| Low | The catalog-backed application RPC lacked complete role/object-scope proof. | The RLS suite now covers assigned Sales/Curator success and Finance, Student, unassigned Curator and cross-organization denial, including audit assertions. |
| Low | The first exact-head Inbox CI run still pinned migration freshness to 055. | The companion schema-contract assertion now follows the additive 056 boundary; its full local test suite passes 788/788. |
| Low | The first exact-head PostgreSQL run exposed an implicit text result in the candidate-validation enum assignment. | Both `CASE` branches now cast explicitly to `platform.catalog_candidate_validation_status`; fresh exact-head PostgreSQL execution remains required. |

This preflight is not the required independent exact-head launch-control
review. That review must run after commit and exact-head CI.

## Verification ledger

Verified locally on Node.js 22.23.1:

| Check | Result | Boundary |
| --- | --- | --- |
| `npm ci` | Pass; 435 packages, zero reported vulnerabilities | Dependency install only |
| `npm run test:supabase:history` | Pass; current migration is 056 | History/static contract; does not execute 056 |
| `npm run test:security:node` | Pass | Static/Node security tests |
| `npm run test:unit` | Pass, 112/112 | Includes five BW5 catalog tests |
| `npm run lint` | Pass | Source lint only |
| Next type generation and `tsc --noEmit` | Pass | Type contract |
| `npm run build` | Pass; Next.js generated 39 pages | Production build, not deployment |
| `npm run scenarios` | Pass, 39/39 | Synthetic scenario evaluation |
| Production audit and approved development allowlist audit | Pass; zero vulnerabilities | Package advisory state at check time |
| Full Playwright with one retry | Exit 0; 87 passed, 54 skipped, 3 unrelated host-timing flakes passed on retry | Generic regression/a11y proof only; the BW5 Supabase-auth browser path was skipped with the rest of that environment-dependent suite |
| `git diff --check` and shell syntax check | Pass | Patch/shell syntax only |

The disposable PostgreSQL gate did **not** complete locally. OrbStack restarted
hundreds of unrelated containers and exhausted host resources/network
interfaces; the isolated Postgres container did not finish `initdb` within the
bounded 300-second deadline. The harness failed closed and removed the BW5
validation container. Therefore:

- migration 056 and its inventory/RLS tests have not executed locally;
- `npm run test:supabase:local` has not completed for BW5;
- the dedicated BW5 Supabase-auth browser test has not executed locally;
- these failures are not clean RLS, audit or local Supabase proof.

Before approval or merge, the exact-head GitHub **Main CRM** job must pass
`npm run test:security` on its disposable PostgreSQL host, applying migrations
001–056 and executing both BW5 inventory and RLS suites. All four required
exact-head CI jobs and the independent SHA-bound launch-control review must be
green. Managed Supabase, production and real-provider proof remain blocked even
after repository CI passes.

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
