# ADR 0022: Validate the self-hosted EVO V2 product before production infrastructure

- Status: accepted
- Decision date: 2026-08-28 (Asia/Dubai)
- Decision owner: EVO product owner
- Parent contract: GitHub issue #407
- Active implementation sequence: GitHub issues #424 through #433
- Supersedes in conflict for V2: ADR 0014, ADR 0015, ADR 0020 and ADR 0021
- Preserves: frozen V1 staging/production, V1 history and rollback artifacts
- Verified starting baseline:
  `9b185dba93b2363d9bf942483b2c0febee4c3b30`

## Context

The previous target coupled EVO to Supabase Auth, RPC/RLS helpers, Realtime,
Storage, the Supabase CLI test stack and Supabase-aware release gates. The
owner selected a self-hosted V2 with no Supabase runtime, dual-read, dual-write,
compatibility layer or fallback path.

The first V2 plan then reproduced a production-readiness program: full staff
authentication, multi-organization tenancy, recovery drills, managed
acceptance, a timed pilot and cutover planning. That delayed the owner's more
important question: does the main CRM product work end to end on a clean
self-hosted foundation?

The owner therefore narrowed active V2 scope. Build and validate the heavy CRM
product locally first. Production infrastructure and real-use readiness are a
later, separately authorized program.

## Decision

### Product-first local V2

V2 remains one internal EVO product with one staff UI and one workflow across:

- Sales pipeline and lead qualification;
- WhatsApp communications;
- contract and first-payment control;
- Sales-to-Admissions handoff;
- Student 360;
- Admissions tasks, private documents, applications and visa;
- minimal finance stop/release;
- human-reviewed Gemini drafts;
- a minimal event log for business-transition debugging and verification.

The active contour is private and local. It contains no real staff identity or
applicant/customer data and creates no public or production claim.

### Canonical runtime

The active runtime uses:

- the existing Next.js application;
- one real private local PostgreSQL service;
- Drizzle schema definitions and committed reviewed SQL migrations;
- application-owned private document bytes with PostgreSQL metadata;
- real application, browser, database and file execution paths.

The completed V2 product path contains no Supabase SDK, Supabase Auth,
Supabase Storage, Supabase Realtime, Supabase migration/config/runtime
environment dependency, SQLite fallback or compatibility repository.

Merged V2 migrations are immutable. Corrections use forward migrations. Every
migration slice is applied to a real disposable PostgreSQL instance before
merge.

### Two-field development gate

The access screen has exactly two fields:

1. a technical profile identifier;
2. that profile's secret.

The identifier maps on the server to one of three profiles configured only in
ignored local secret state:

- Director/Admin;
- Sales Manager;
- Admissions Manager.

The browser receives neither the credential map nor secret values. Comparison
happens only on the server, returns one generic failure, logs no submitted
value and uses a timing-safe secret comparison. Success creates a short-lived
signed HttpOnly cookie containing only the selected technical role and expiry.
The cookie is SameSite-protected, Secure under HTTPS and cleared on logout.
Editing client state or cookie contents cannot change the role.

This is a private development gate, not staff authentication. It does not
include accounts, signup, invitations, password recovery, revocation or real
identity proof.

### Fixed role behavior

The product has exactly three active test roles:

- Sales Manager owns the Sales pipeline, qualification, ownership, next action
  and pre-handoff workflow;
- Admissions Manager owns handed-off Student 360 work, tasks, documents,
  applications and visa milestones;
- Director/Admin is the full functional superset, may perform explicit
  overrides and may preview the exact Sales or Admissions interface.

The gate-selected role is resolved on the server. Route handlers, server
services and transactional database commands enforce role boundaries. UI
hiding alone is not authorization.

The product-first contour uses one local EVO organization. It does not build
organizations, memberships, multi-tenant administration, cross-organization
RLS or fine-grained per-user grants. Database constraints and service checks
still prevent a role from invoking another role's consequential command.

### Replace, do not layer

A completed V2 slice owns one active runtime path, data authority,
auth/session path, private-file path and UI for each capability it replaces.
Real database, application and browser proof triggers deletion of the
superseded active code, imports, dependencies, implementation-level tests,
environment/config, scripts, routes, webhooks/workers and parallel screens in
that same slice. Outcome tests at the new module interface replace old
implementation tests. A scoped `rg` inventory and a fail-closed no-fallback
proof are merge evidence.

Frozen V1 staging/production plus historical ADRs, migrations and evidence are
the only exception. They remain inert deployment/rollback inputs and cannot be
imported, executed, bundled or treated as V2 authority. Any temporary
coexistence requires explicit owner approval with named files, reason,
expiry/exit criteria and a deletion issue.

### Canonical CRM and event model

PostgreSQL owns the V2 records for people, leads, conversations, messages,
student cases, contract/payment evidence, handoffs, tasks, documents,
applications, visa milestones, finance stop state and AI proposals.

Commands preserve the existing business invariants:

- idempotent inbound processing and handoff;
- contract plus first mandatory payment before normal Admissions handoff;
- reasoned Director/Admin override;
- durable ownership and next action;
- finance stop enforced by server commands;
- AI output remains advisory and requires human Accept/Edit/Reject;
- no autonomous WhatsApp send, amoCRM write or provider-side mutation.

A small append-only event table records the actor role, business object,
transition, reason where required, timestamp and correlation/idempotency key.
It exists to debug and verify product behavior, not to implement a
compliance-style audit/export center.

### Private document persistence

Document keys are opaque and server-generated. User input cannot choose a
filesystem path. Upload, download and resubmission pass through application
routes that resolve the current technical role and case ownership. PostgreSQL
stores metadata, byte length, checksum and business linkage. Partial or failed
writes do not become accepted documents.

Local durable persistence is active scope. Full database/file restore drills,
off-host retention, production RPO/RTO and rollback evidence are deferred.

### WhatsApp and Gemini remain real product paths

The application must retain actual WhatsApp and Gemini adapters and truthful
blocked states. Tests may not replace them with mocks, demo providers or fake
success.

Provider calls or provider-side changes require real credentials and separate
authorization. Until those exist, the product path can be implemented and
browser-tested up to the real adapter boundary, which must return blocked.
Outbound WhatsApp and amoCRM writes remain forbidden.

### Real validation

Use real PostgreSQL, committed SQL migrations, actual application routes, real
file bytes and a real browser. Isolated technical records may prove mechanics;
they are not fake business acceptance and cannot be called real applicant or
provider proof.

Each active issue lands as one small sequential PR with independent exact-head
review, all protected exact-head checks, `gh pr merge --match-head-commit` and
exact-main CI verification.

## Active sequence

1. #424 contract and issue reset;
2. #425 PostgreSQL and Drizzle migration gate;
3. #426 two-field development gate and role sessions;
4. #427 fixed role behavior and Admin exact-role preview;
5. #428 private local document persistence;
6. #429 canonical CRM model and minimal event log;
7. #430 Sales pipeline, qualification and inbound WhatsApp workflow;
8. #431 contract/payment gate and audited handoff;
9. #432 Student 360, Admissions operations and finance stop/release;
10. #433 staff WhatsApp workflow and human-reviewed Gemini.

No production-readiness issue blocks this sequence.

## Deferred before real use

The following are one compact deferred set, not active issues or dependencies:
production-grade staff authentication/account lifecycle; multi-organization
tenancy and cross-organization RLS; fine-grained per-user grants; public/VPS
deployment, DNS/TLS/Caddy and paid infrastructure; production monitoring and
health center; compliance-style audit/export; full database/file restore drills
and production rollback proof; managed staff/provider acceptance; a 10-day or
five-case pilot; historical migration; replacement, cutover and tagging.

Before real staff, customer data, public/managed exposure or V1 replacement,
the owner must authorize a new plan for the applicable deferred controls. This
ADR grants no deployment, provider mutation, data migration or cutover.

## V1 boundary

V1 staging and production remain unchanged. Do not deploy V2 over V1, delete
V1, change its data, remove its images/runbooks/rollback artifacts, send
WhatsApp, write amoCRM, create paid infrastructure or perform cutover under
this ADR.

## Consequences

- The team tests the expensive CRM workflow before investing in production
  infrastructure.
- The two-field gate is intentionally minimal and cannot be mistaken for real
  staff security.
- Admin/Sales/Admissions behavior remains testable through the actual UI and
  server path.
- Deferred controls must be consciously reintroduced before real use rather
  than quietly smuggled into the product-validation critical path.
- V1 history and operational artifacts remain available and unchanged.

## Official primary sources verified 2026-08-28

- Drizzle SQL migration generation:
  <https://orm.drizzle.team/docs/drizzle-kit-generate>
- Drizzle migration commands and checks:
  <https://orm.drizzle.team/docs/kit-overview>
- PostgreSQL Row-Level Security behavior retained as future/deferred reference:
  <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
- Next.js server cookie API:
  <https://nextjs.org/docs/app/api-reference/functions/cookies>
- Node.js HMAC and timing-safe comparison primitives:
  <https://nodejs.org/api/crypto.html>
