# EVO V2 Launch Plan

Status: active V2 execution contract for the self-hosted replacement candidate
Date: 2026-08-28 (Asia/Dubai)
Authority: owner handoff, this plan, the latest merged `docs/PLAN_CHANGES.md`
entry, and ADR 0022
Verified shared baseline: GitHub `origin/main` at
`9b185dba93b2363d9bf942483b2c0febee4c3b30`

This file replaces the old Supabase-native launch contract as the active V2
plan. Earlier ADRs, issues, PRs and rollout notes remain historical evidence
for V1 and the prior long-run. They do not authorize new V2 implementation
work where they conflict with this plan.

## 1. Outcome and truth boundary

EVO V2 keeps the accepted internal staff product shape of V1: one login, one
staff UI, one role model and one end-to-end workflow across CRM, Admissions,
Documents, Applications, Visa, Finance control, Tasks, Communications and AI.
V2 changes the runtime foundation, not the product outcome.

V2 is a separate heavy development line. V1 staging and production are frozen
deployment boundaries:

- do not deploy V2 over V1;
- do not delete V1;
- do not migrate real customer data;
- do not send WhatsApp;
- do not write amoCRM;
- do not create paid infrastructure;
- do not perform final cutover without separate explicit owner authorization.

Repository proof is not provider proof. Local or disposable-environment checks
may prove code behavior, but they do not prove managed acceptance, pilot
operation or replacement readiness.

## 2. Architecture contract

### 2.1 Canonical runtime

- The completed V2 runtime must not depend on Supabase Auth, Supabase Storage,
  Supabase SDKs, Supabase migrations, Supabase environment variables or a
  Supabase compatibility layer.
- V2 uses one self-hosted Next.js application runtime and one private
  PostgreSQL service as the canonical operational foundation.
- The canonical operational database is PostgreSQL. Every business record,
  permission boundary, audit record, file metadata and restore ledger lives in
  PostgreSQL.
- Drizzle schema definitions and committed SQL migrations are the only V2
  database change authority. Migrations are immutable after merge; corrections
  use forward migrations.

### 2.2 Authentication

- Better Auth owns V2 staff authentication and session lifecycle.
- V2 uses database-backed email/password sessions with secure HttpOnly cookies
  and server-side session checks.
- Public self-registration is forbidden for staff. Staff accounts are created
  only by an authorized admin flow or a reviewed bootstrap path.
- Session absence, expiry or revocation must fail closed and redirect or reject
  server-side. Hiding UI controls is never sufficient authorization.

### 2.3 Authorization and tenant isolation

- V2 starts with three pilot staff roles: `admin`, `sales`, and `admissions`.
- Permissions are capability-based. Sensitive actions such as contract
  confirmation, payment confirmation, case reassignment, file release and admin
  export are explicit server-side checks, not implied by page visibility.
- Authorization is enforced twice:
  - in application services and route handlers;
  - in PostgreSQL, using default-deny grants and Row-Level Security where
    practical.
- The database session must carry explicit authorization context for each
  request, including actor, organization and effective role. SQL must treat
  missing context as denied, not global access.
- Cross-tenant access, inactive membership access and direct-object ID guessing
  must be denied even when a user can authenticate successfully.

### 2.4 Private files

- File bytes live on a dedicated private volume reachable only by the
  application runtime.
- File metadata, checksums, ownership, document version lineage, access audit
  and restore inventory live in PostgreSQL.
- Files are served through authenticated application routes, never through
  public bucket URLs or unauthenticated direct filesystem paths.
- V2 must separately back up and restore database state and private file bytes.
  A successful database restore is not evidence that files are recoverable.

### 2.5 External adapters

- WAHA remains a private receive-only transport boundary until a later explicit
  owner decision.
- amoCRM remains read-only or import-only as applicable; it is not a canonical
  operational authority.
- Gemini remains one human-reviewed server-side draft adapter. It cannot send,
  change ownership, confirm payments or bypass authorization.

## 3. Execution order

The active V2 sequence is:

| Block | Issue | Outcome | Notes |
| --- | --- | --- | --- |
| V2-0 | #424 | architecture and issue reset | docs, ADR, issue sequence, no product behavior change |
| V2-1 | #425 | self-hosted PostgreSQL and Drizzle migration gate | private Compose DB, health check, reviewed SQL migrations |
| V2-2 | #426 | Better Auth staff login/session/logout | no public signup, admin/bootstrap provisioning only |
| V2-3 | #427 | organizations, memberships, roles and default-deny authz | server enforcement plus PostgreSQL RLS/session context |
| V2-4 | #428 | private file foundation | authenticated routes, checksums, audit, backup/restore path |
| V2-5 | #429 | canonical operational PostgreSQL model | no compatibility paths |
| V2-6 | #430 | inbound lead to Sales qualification | canonical CRM entry and queue ownership |
| V2-7 | #431 | contract/first-payment gate and Sales-to-Admissions handoff | audited ownership transition |
| V2-8 | #432 | Admissions case workspace | tasks, documents, applications, visa, finance stop |
| V2-9 | #433 | human-reviewed Gemini and file resubmission flows | advisory only, no autonomous action |
| V2-10 | #433 | truthful admin health, audit, backup and rollback | blocked means blocked, not healthy |
| V2-11 | #434 | managed receive-only acceptance | real approved staff and one real inbound path |
| V2-12 | #435 | 10 workdays and 5 real cases | cannot be simulated or shortened |
| V2-13 | #436 | post-pilot archive and replacement readiness | archive/cutover planning only until approval |

Each block must land as a small sequential PR with:

- exact head SHA identified;
- real validation for that block;
- independent review verdict before merge;
- `gh pr merge --match-head-commit`;
- exact-main verification before the next block starts.

## 4. Acceptance criteria by block

### 4.1 V2-0 architecture reset

- `docs/EVO_LAUNCH_PLAN.md` names the self-hosted V2 contract truthfully.
- `docs/PLAN_CHANGES.md` contains an append-only owner-direction amendment.
- ADR 0022 supersedes the Supabase-specific target for V2 without rewriting
  history.
- The GitHub issue sequence matches the V2 block order and dependencies.

### 4.2 V2-1 PostgreSQL and migrations

- Local Compose starts a private PostgreSQL service with a real health check.
- Drizzle can generate and apply committed SQL migrations against a disposable
  real PostgreSQL environment.
- CI and local gates fail closed when migrations are missing, drifted or
  unverified.

### 4.3 V2-2 authentication

- An authorized staff member can sign in, persist a session, refresh, and sign
  out in the real app.
- No public staff signup route exists.
- Revoked or inactive accounts lose access without relying on client-side state.

### 4.4 V2-3 authorization

- Cross-role, cross-tenant and inactive-membership negative tests run against a
  real isolated PostgreSQL instance.
- The server rejects sensitive actions even if a client requests hidden routes
  directly.
- Missing database session context returns denied or empty scoped results.

### 4.5 V2-4 private files

- Upload, download and resubmission routes require authenticated authorized
  access.
- File metadata, checksum and version lineage are durable and audited.
- Database backup and file backup are exercised separately in non-production.

### 4.6 V2-5 through V2-8 product slices

- Each slice proves one complete staff-observable behavior end to end in the
  real app.
- Every slice preserves immutable audit, idempotency and authorization
  invariants.
- No slice invents applicant business acceptance with fake/demo records.

### 4.7 V2-9 through V2-12 later-stage evidence

- Health/readiness is truthful.
- Managed acceptance uses real approved staff and one authorized real inbound
  provider path.
- Pilot duration and case-count gates are met literally.
- Replacement readiness ends with a cutover and rollback plan, not an
  unauthorized deployment.

## 5. Validation contract

Before judging missing tooling in a fresh worktree:

- use Node `22.23.1`;
- run `npm ci --ignore-scripts`.

For local container-backed checks on macOS:

- require `orb status` = `Running`;
- require `docker context show` = `orbstack`;
- fail closed otherwise.

Every implementation block must run only the smallest real checks that prove
the changed behavior, then exact-head CI and exact-main verification. Mocks,
fake business data, fixture-only acceptance, dual-read, dual-write, fallback
repositories and compatibility layers are prohibited.

## 6. Current Supabase retirement inventory

At the start of V2, Supabase still appears in:

- root runtime auth/session helpers and `proxy.ts`;
- platform observability/readiness surfaces;
- `supabase/` migrations and PostgreSQL authorization harnesses;
- CI jobs and local reset scripts;
- production-preparation and release scripts;
- Playwright configuration and synthetic test fixtures;
- UI copy and historical documentation.

This is expected at the reset stage. V2 foundation work may coexist with that
legacy code in the repository while V1 remains frozen, but no completed V2
runtime path may keep a hidden Supabase dependency.

The earlier open issues `#388` through `#391`, and any earlier V2 backlog
attempts that conflict with the newest reset sequence, are historical and do
not override the active V2 contract.

## 7. Stop conditions

Continue through ordinary coding, test and CI failures. Stop only when the
next step would require:

- real staff identities or a real authorized applicant/lead;
- provider credentials or provider-side mutation;
- paid infrastructure;
- production deployment, V1 replacement, customer-data migration or another
  externally visible destructive action;
- a real observation window that has not elapsed yet.

## 8. Primary sources refreshed for this plan

- Better Auth Next.js integration and cookie handling:
  <https://better-auth.com/docs/integrations/next>
- Better Auth configuration and trusted origins:
  <https://better-auth.com/docs/reference/options>
- Drizzle migrations:
  <https://orm.drizzle.team/docs/migrations>
- Drizzle migration generation and application:
  <https://orm.drizzle.team/docs/drizzle-kit-generate>,
  <https://orm.drizzle.team/docs/drizzle-kit-migrate>
- PostgreSQL row security:
  <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
