# U10 net-new pilot cohort and legacy-isolation contract

Status: exact-main-rebased implementation contract for Issue #387
Date: 2026-08-27 (Asia/Dubai)
Parent: #376
Depends on: #386, completed through PR #401 and exact-main run `33017855457`
Blocks: #388

## Outcome in plain language

The pilot must clearly know which cases belong to it and which do not. New
pilot work is allowed only inside canonical EVO/Supabase records. If a case
would require an old legacy write path, the system must say so honestly and
stop instead of silently falling back.

## Canonical product boundary

U10 extends the canonical `platform.student_cases` authority created by the
earlier U5-U9 slices. It does not create a second pilot application, a second
case table, a second workflow authority, a compatibility database, dual-write
behavior or a hidden bridge back into legacy CRM operations.

The visible pilot boundary belongs to:

- one organization;
- one canonical Student Case;
- one explicit pilot configuration state;
- one current pilot membership status and basis;
- append-only membership event history with provenance and actor evidence.

## Cohort rules

The pilot configuration owns:

- whether automatic pilot entry is enabled;
- the exact cutoff timestamp for new eligible canonical cases;
- provenance and actor metadata explaining who set it and why.

Automatic pilot entry is allowed only when all of these are true:

- the pilot configuration is active;
- the configuration already exists when the Student Case is inserted;
- the canonical Client, canonical Lead and canonical Student Case all have
  `created_at` timestamps at or after the exact cutoff;
- the case's organization, `canonical_client_id` and `canonical_lead_id` match
  those same canonical records;
- `source_key` is exactly `canonical-lead:<canonical_lead_id>`.

Existing legacy cases never enter automatically. The derivation runs only for
new case inserts; enabling or changing a configuration never scans, backfills
or updates earlier cases.

An Admin-only bounded exception may:

- manually include one exact case; or
- manually exclude one exact case.

Every manual change requires:

- a request ID for idempotent replay;
- a reason;
- provenance;
- immutable audit evidence.

Removing a case from the pilot changes current membership only. It does not
delete prior membership events or audit rows.

## Visible state

Each canonical Student Case must expose bounded pilot facts suitable for staff
reads:

- `outside`, `included` or `excluded`;
- why it is in that state;
- whether it came from the cutoff rule or a manual decision;
- who changed it and when.

Bounded read models may also expose organization-scoped counts for the next
readiness slice, but they must stay deterministic, tenant-scoped and fail
closed on foreign or malformed input.

## Legacy-write boundary

U10 adds a truthful evaluator for write authority:

- included pilot case plus canonical EVO/Supabase target: allowed;
- non-pilot case: no pilot authority;
- any path that would require a forbidden legacy write: blocked with an
  explicit result.

Blocked legacy paths may not:

- silently downgrade to compatibility mode;
- dual-write;
- create a hidden copy in a second system;
- claim success when no canonical write was allowed.

## Authorization boundary

- Pilot config and manual include/exclude are Admin-only.
- Read visibility remains organization-scoped and role-checked.
- Cross-organization, inactive, stale or unauthorized actors fail closed.
- Direct table mutation is not the contract; the accepted path remains bounded
  SQL functions with explicit permission checks, empty `search_path`, revoked
  public execute and exact grants.

## Required isolated proof

- automatic inclusion happens only for exact new eligible canonical cases;
- existing legacy cases stay excluded automatically;
- authorized include/exclude changes visible state and preserves history;
- unauthorized and cross-organization changes are denied;
- blocked legacy-write paths return truthful blocked results;
- canonical EVO writes continue for included pilot cases;
- browser and SQL proof show audit and tenant isolation;
- full disposable-local, lint, typecheck, build, exact-head and exact-main
  gates remain green.

## Evidence boundary

Repository and disposable-local Supabase evidence prove the contract only. They
do not prove managed Supabase, provider readiness, production deployment or
historical/archive migration.

## Official references verified for implementation

- PostgreSQL documents that row triggers execute inside the same transaction as
  the triggering statement, so a failed membership/audit write rolls the case
  insert back atomically:
  <https://www.postgresql.org/docs/current/trigger-definition.html>.
- PostgreSQL row security is default-deny when RLS is enabled and no applicable
  policy exists:
  <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>.
- Supabase documents that Data API access is the combination of grants and RLS,
  and that `SECURITY DEFINER` functions must pin an empty `search_path` and use
  schema-qualified names:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>.

These references support an insert-only database trigger for automatic entry,
default-deny direct table access, and narrowly granted tenant-aware RPCs. They
do not justify a backfill, provider call, compatibility write or service-role
bypass from the browser.
