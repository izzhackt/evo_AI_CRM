# P2D — student admissions domain and object-scope RLS

Status: implementation evidence for the P2D repository block
Date: 2026-07-28
Starting main: `f9bda9cd0554d225211fb9e3d0b1969be262a838`
Plan contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`

## Purpose and proof boundary

P2D adds the first operational admissions slice to the canonical Platform
schema. It turns the P2C identity, role-bundle and record-scope primitives into
database-enforced student-case access. The block covers student cases,
assignment and handoff, university applications, visa state, tasks and
append-only lifecycle evidence.

This remains a repository and disposable local Supabase/PostgreSQL proof. It
does not:

- migrate root SQLite users or operational data;
- create or update a real amoCRM contact or lead;
- discover a real account-specific signed-contract status mapping;
- enable a production Student Portal;
- apply migration 042 to a managed or production Supabase project;
- prove live WAHA, amoCRM, AI or end-to-end traffic.

Those boundaries belong to P3–P8 and require the credentials, sanitized test
identities and production authority named in the launch plan.

## Domain model

Migration `042_platform_student_admissions.sql` adds ten FORCE-RLS relations:

1. `student_cases`;
2. `student_case_assignment_events`;
3. `student_case_lifecycle_events`;
4. `student_case_updates`;
5. `university_applications`;
6. `university_application_events`;
7. `visa_cases`;
8. `visa_case_events`;
9. `case_tasks`;
10. `case_task_events`.

Every tenant-owned parent/child relationship includes the organization in its
key. Application, visa and task events also prove that the referenced parent
belongs to the same student case; a matching UUID from another case or
organization is not sufficient.

The migration intentionally permits more than one student case for the same
student identity and more than one university application for a case. The
exact account-specific amoCRM lead mapping and duplicate/exception policy
remain P4 work and are not replaced with a global hardcoded identifier.

## Authority lifecycle

### Pending case creation

Only the narrow backend ingest operation can create a pending case. It requires
an active organization, an active Student membership, an active Sales
membership, a nonblank external source key and explicit signed-contract
evidence. Creation:

- creates record scope version 1;
- grants full case scope to the responsible Sales membership;
- bumps that Sales profile's live access version;
- writes the case and append-only audit event atomically.

Direct `service_role` table writes are not part of the contract.

### Assignment and handoff

Only a live Admin can assign or reassign a Curator. A nonblank reason is
mandatory. Initial assignment changes `pending` to `active`, records handoff
and Portal activation, rotates the case to a new immutable scope version, and
grants the new scope to the Curator and Student.

The pre-contract Sales scope is not carried into the new full-access scope.
After handoff, Sales can use only the fixed safe-summary projection. A
reassignment rotates the scope again, revokes the former Curator's effective
object access through the inactive old scope, preserves the original handoff
and Portal activation timestamps, and records before/after evidence.

### Case lifecycle and route

Admin or the currently assigned Curator can close an active case or reopen a
closed case only with a nonblank reason. Closing does not erase history or
reactivate old scopes. Operational route changes are distinct from amoCRM sales
stage and cannot overwrite its canonical pipeline/status authority.

## Role and object-scope contract

| Actor | Before handoff | After handoff |
| --- | --- | --- |
| Admin | Full organization-scoped case administration | Full organization-scoped case administration |
| Responsible Sales | Full access to its pending case, applications, tasks and updates | Fixed nonsecret case summary only |
| Assigned Curator | No access before assignment | Full assigned case, applications, visa, tasks and updates |
| Former Curator | Not applicable | No access after reassignment |
| Finance | No P2D admissions-domain access | No P2D admissions-domain access |
| Student | No Portal access while pending | Fixed self-only Portal projections for an activated assigned case |
| Other same-org user | No access | No access |
| Cross-org user | No access | No access |

Base relations are staff-full projections: they are not safe Student or
post-handoff Sales APIs because RLS controls rows, not sensitive columns.
Student Portal and Sales summary reads therefore use fixed
`SECURITY DEFINER` functions with reviewed outputs, an empty `search_path`,
immediate `PUBLIC` revocation and signature-specific execution grants.

The Sales summary is limited to:

- case ID;
- student display name;
- target country;
- target degree;
- case state;
- assigned Curator display name;
- handoff timestamp.

Student projections do not accept an arbitrary student-case ID that could be
used to enumerate another student's records.

## Mutation and evidence rules

- Assignment/reassignment and close/reopen require a reason.
- External university statuses `submitted`, `under_review`, `offer`,
  `rejected` and `enrolled` require a nonblank evidence reference.
- External visa decisions `approved` and `rejected` require a nonblank evidence
  reference.
- The P2D visa vocabulary is exactly `not_required`, `not_started`, `docs`,
  `appointment`, `submitted`, `approved`, `rejected`, `closed`.
- A task assignee must be a live eligible membership in the same organization.
- Domain event tables are append-only and protected from truncate.
- Parent business rows cannot be hard-deleted or truncated while retention and
  legal deletion policy remain open.
- Every mutation is request-idempotent. Reusing a request ID with any different
  normalized operation argument fails rather than returning a result from a
  different request.
- Unknown provider delivery and auto-reply behavior do not exist in this
  domain slice.

P2D publishes immutable version-2 role bundles and advances all memberships
that already carry authority, including inactive or blocked memberships.
Version 1 remains unchanged. Every distinct affected profile receives one live
access-version bump, with role history and system audit evidence, so later
reactivation cannot revive stale v1 authority.

## Required local evidence

The block is accepted only when all of the following pass:

- canonical migration history pins the exact migration 042 name, byte count and
  SHA-256 and rejects same-length drift, wrong names, gaps and rewrites;
- migration 001–042 applies to a clean disposable PostgreSQL database;
- the P2C suite runs at the exact 041 boundary, leaving active, inactive and
  blocked memberships for the 042 upgrade proof;
- the P2D matrix uses two students in one organization and an additional
  organization;
- positive and negative Admin, Sales, Curator, Finance and Student paths cover
  pre-handoff, handoff, reassignment, stale tokens and scope versions 1–3;
- two concurrent university applications are accepted while cross-student and
  cross-organization reads and mutations are denied;
- fixed Sales and Student projections expose only their documented columns;
- replay, mismatch, evidence, reason, immutable event and hard-delete failures
  are exercised;
- final inventory proves PostgreSQL ownership, RLS plus FORCE RLS, indexed
  composite foreign keys, no browser write policies, no privileged normal
  projection views, exact function grants and no direct `service_role` domain
  access;
- root, Inbox and retained Lead Agent regression gates remain green.

## Security rationale

Supabase documents that RLS should be enabled on every exposed table and that
database authorization must supplement coarse JWT claims. It also notes that
ordinary PostgreSQL views can bypass RLS by default. P2D therefore keeps live
membership, bundle, access-version and record-scope checks in the database and
uses narrowly reviewed functions rather than broad views for reduced
projections.

`SECURITY DEFINER` is treated as a privileged boundary: functions set an empty
search path, schema-qualify referenced objects, return a fixed shape, revoke
`PUBLIC` execution immediately and grant only the exact required signature.

Primary references:

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [PostgreSQL CREATE FUNCTION security](https://www.postgresql.org/docs/current/sql-createfunction.html)

## Repository evidence collected

The final candidate was validated with Node `22.23.1` and only synthetic local
identities/data:

- migration 042: 131,664 bytes, SHA-256
  `bf965fd5feb301969c2134576b67d546f515e697e17840440c54bb46149ce16b`;
- canonical history: 42 contiguous pinned migrations, with tamper, wrong-name
  and gap tests;
- disposable PostgreSQL 15: 001–042 plus P2C boundary fixtures, P2D
  admissions/RLS matrix and final catalog/grant inventory passed;
- disposable local Supabase CLI `2.110.0`: clean reset, real local Auth hook,
  stale/blocked-token invalidation and PostgREST RLS passed for eight synthetic
  users, five roles and two organizations;
- root: security and 13 unit tests, lint, Next type generation, TypeScript,
  production build and 39 scenarios passed; the full 144-test
  Playwright/a11y matrix exited green with its configured skips;
- Inbox: lint with seven pre-existing warnings and zero errors, typecheck, 783
  tests, production build and audits passed;
- retained Lead Agent: Ruff and 124 tests passed;
- both deployed JavaScript dependency graphs reported zero production
  vulnerabilities; nine known development-only findings remain constrained by
  the committed `GHSA-mh99-v99m-4gvg` allowlist through 2026-08-31;
- browser static bundles and the P2D changed scope passed credential-pattern
  scans.

No P0 DOCX source changed in P2D, so the deterministic/rendered P0 document
evidence remains unchanged. No managed provider or production endpoint was
called.

## Rollback

No destructive down migration is supplied. If migration 042 has been applied,
rollback is a reviewed forward migration that removes grants or disables the
new call surface without deleting admissions history. No production migration
or rollback is authorized by this repository block.
