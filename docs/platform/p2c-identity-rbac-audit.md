# P2C — Platform identity, RBAC and append-only audit

Status: implementation evidence for the P2C repository block
Date: 2026-07-28
Starting main: `0d38a8bb36fa423de14467f798141fac199ab047`
Plan contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`

## Purpose

P2C creates the first identity and authorization boundary owned by the unified
Platform. It does not cut the root application over from SQLite or legacy auth.
It adds an isolated Supabase model that later P2D–P2I migrations can reference
without inheriting the legacy Inbox account roles.

The only Platform business roles are:

- `admin`;
- `sales`;
- `curator`;
- `finance`;
- `student`.

`student` is the machine identifier for the Client/Student class. The legacy
root `client` role and Inbox `owner/admin/agent/viewer` roles are not mapped by
this migration. A normal Supabase signup does not create a Platform profile,
membership, role or record scope.

## Data and tenant boundary

Migration `041_platform_identity_rbac_audit.sql` owns:

- organizations and auth-linked Platform profiles;
- one active organization membership per profile;
- immutable, versioned role/permission bundles;
- a structurally role-matched current membership bundle and append-only role
  history;
- typed, organization-bound record scopes and membership scope assignments;
- append-only audit events with a unique request/idempotency identifier.

Tenant-owned relationships use organization-qualified unique keys so future
domain migrations can use composite foreign keys. Soft lifecycle state and
`ON DELETE RESTRICT` are used while retention and legal-deletion policy remain
open.

## Live authorization contract

Browser authorization never trusts a JWT role by itself. Every allowed row
requires all of the following live facts:

1. a valid Supabase Auth user;
2. an active Platform profile;
3. exactly one active membership;
4. an active organization;
5. the current published role-matched permission bundle;
6. an exact `platform_role` claim match;
7. an exact positive `platform_access_version` claim match;
8. the permission and, for administrative mutation, the organization scope
   required by the operation.

Missing, malformed, forged or stale Platform claims fail closed. Authority
changes increment the profile access version, so an already-issued token loses
row access before it is refreshed.

The custom access-token hook is a `SECURITY INVOKER` function in
`platform_private`. Only Supabase's internal `supabase_auth_admin` role receives
the exact schema, function and column-level read grants it needs before a JWT
exists. Zero or multiple effective memberships remove both Platform claims.
Neither browser roles nor `service_role` can invoke the hook or use that read
path.

## Mutation and audit boundary

P2C supersedes the broad future-object `service_role` defaults established as a
temporary P2B bootstrap boundary. Default table, sequence, function and type
privileges in `platform` and `platform_private` are revoked. New backend access
must be granted to a reviewed function signature.

Direct identity, role, scope and audit DML is denied to browser roles and to
`service_role`. The reviewed mutation surface consists of operation-specific
functions:

- a service-only first-organization/first-Admin bootstrap with a fixed service
  principal;
- Admin-only member provisioning;
- Admin-only membership role change;
- Admin-only membership status change;
- Admin-only organization-scope assignment and revocation.

Admin functions derive the human actor from `auth.uid()`. They lock the target,
enforce same-organization permission and scope, require a reason and request
ID, mutate authority, increment access version, append role/scope history where
applicable and append the audit event in one transaction. A replay with the same
request ID returns the prior result; reuse for another action or subject fails.
At least one active, organization-scoped Admin is preserved.

Published permission bundles, role history and audit rows are immutable.
Corrections require a forward migration or a new append-only record.

## Evidence gate

The block is accepted only when all of these pass on synthetic data:

- canonical history verification through migration 041;
- disposable PostgreSQL role/grant/RLS matrix for all five roles;
- cross-organization, forged-role, stale-token, blocked/inactive and
  no-membership denials;
- direct browser and direct `service_role` mutation denials;
- bundle, scope, composite-key, uniqueness, append-only and index assertions;
- a real local Supabase Auth/PostgREST run that signs users up and in, observes
  hook-issued claims, exercises each role, changes a role, refreshes, blocks the
  membership and verifies that refreshed claims are removed;
- the unchanged root, Inbox, retained Lead Agent and full browser gates required
  by the launch plan.

The local Auth smoke reads only the local API URL and publishable key. It never
reads or prints the local secret key, service-role key, JWT secret, generated
passwords, tokens or synthetic email addresses.

### Recorded current-branch evidence

All commands used Node `22.23.1` where Node was involved. The exact current
branch produced:

- `npm run test:security`: canonical history 001–041, 57/57 Node security
  tests and the real disposable PostgreSQL role/RLS suite passed;
- `npm run test:supabase:local`: Supabase CLI `2.110.0` performed a clean
  no-seed reset, then real local Auth/PostgREST exercised 8 synthetic users,
  all 5 roles, 2 organizations, stale-token denial and blocked-claim removal;
- `npm run test:unit`: 12/12 tests passed;
- root lint, Next type generation, `tsc --noEmit`, build and production audit
  passed; the build produced 38 routes and the production audit found zero
  vulnerabilities;
- `npm run scenarios`: 39/39 scenarios passed;
- root Playwright: 89 passed and 55 policy/environment skips out of 144
  configured tests, including the affected authorization and accessibility
  coverage;
- EVO Inbox: lint passed with 7 pre-existing warnings, typecheck/build passed
  with 56/56 static pages, 89/89 test files and 782/782 tests passed, and the
  production audit found zero vulnerabilities;
- EVO Lead Agent: locked dependency sync and Ruff passed; Pytest passed
  124/124 with one upstream Starlette/httpx deprecation warning;
- Gitleaks `8.30.1` found zero secrets in all 15 changed files and in the
  current root (41 files) and Inbox (73 files) static browser bundles; targeted
  client-code scans found zero provider-secret identifiers, public sensitive
  environment names or credential shapes;
- both root and Inbox development audits contain only the 9 reviewed,
  allowlisted development-only findings under `GHSA-mh99-v99m-4gvg`, with
  review due by 2026-08-31.

No test contacted a managed Supabase project or a real customer/provider.
Expected negative PostgreSQL errors are assertions that unauthorized actions
were rejected, not failing checks. The DOCX authority was not changed by P2C,
so its P0 deterministic generation/render evidence remains unchanged rather
than being regenerated in this block.

## Rollback and truth boundary

Before remote application this block is reversible with its branch. After a
database has applied migration 041, rollback is a reviewed forward migration;
published audit/history must not be deleted and broad direct grants must not be
restored.

`real-provider-proof: not-required` for this block. The evidence proves local
Supabase Auth, PostgreSQL, RLS and PostgREST behavior only. It does not prove a
linked managed project, remote migration parity, region/plan/PITR, production
backup or restore, root auth cutover, amoCRM, WAHA, WhatsApp, AI, deployment or
production readiness.

## Primary references

- [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [Supabase Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas)
- [Supabase local CLI configuration](https://supabase.com/docs/guides/local-development/cli/config)
