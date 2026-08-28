# ADR 0022: Build EVO V2 as a self-hosted PostgreSQL monolith

- Status: accepted
- Decision date: 2026-08-28 (Asia/Dubai)
- Decision owner: EVO product owner
- Supersedes in conflict for V2: ADR 0014, ADR 0015, ADR 0020, ADR 0021
- Execution contract: `docs/EVO_LAUNCH_PLAN.md`
- Decision log: `docs/PLAN_CHANGES.md`
- Verified baseline: GitHub `origin/main` at
  `9b185dba93b2363d9bf942483b2c0febee4c3b30`

## Context

The repository's latest accepted long-run documents made Supabase the permanent
canonical runtime for the unified EVO product. That direction produced useful
business rules, UI shape, audit expectations and bounded provider behavior, but
it no longer matches the owner's current execution choice.

On 2026-08-28 the owner selected a new heavy development line:

- V2 must be self-hosted and must not depend on Supabase runtime services.
- Breaking changes are acceptable.
- There must be no dual-read, dual-write, compatibility layer or fallback path.
- V1 staging and production stay frozen until a later explicit replacement
  decision.
- V2 must prove real behavior with real services, real PostgreSQL and real
  browser validation, while stopping at provider, staff, paid-infrastructure,
  pilot-time and cutover authorization gates.

Without a new ADR, the active repo contract would still tell implementers that
Supabase Auth, Storage and migrations are the target authority. That would make
the next V2 PRs formally stale even if the code were technically correct.

## Decision

### One product, new runtime

EVO remains one internal product with one accepted staff UI, one login, one
role model and one end-to-end workflow across CRM, Admissions, Documents,
Applications, Visa, Finance control, Tasks, Communications, AI and
Administration.

V2 changes the runtime foundation only:

- one self-hosted Next.js application runtime;
- one private self-hosted PostgreSQL service as the canonical operational
  database;
- one reviewed SQL migration chain generated from Drizzle schema definitions;
- one application-owned private file storage path;
- one Better Auth session system for staff authentication.

### Database and migration authority

PostgreSQL owns canonical operational state for:

- staff organizations, memberships, roles and capabilities;
- leads, people, cases, tasks, communications, applications, visa milestones
  and finance stop state;
- immutable audit records and idempotency ledgers;
- private file metadata, checksums, ownership and restore inventory;
- AI proposal lineage and human-review decisions.

Drizzle schema definitions plus committed SQL migration files are the only V2
schema authority. Merged migrations are immutable. Corrections use forward
migrations and must run against a real disposable PostgreSQL environment before
merge.

### Authentication

Better Auth owns V2 staff authentication and session lifecycle.

The initial V2 authentication contract is:

- email/password sessions backed by the database;
- secure HttpOnly cookies set and read server-side;
- trusted origins configured explicitly;
- no public self-registration for staff;
- staff creation only through authorized admin tooling or a reviewed bootstrap
  path;
- logout, revocation and inactive membership must fail closed.

The first accepted human-facing roles are `admin`, `sales` and `admissions`.
Sensitive actions still require explicit server-side capabilities.

### Authorization and tenant isolation

Authentication does not grant authorization. V2 enforces default-deny access at
two layers:

1. application services, route handlers and server actions;
2. PostgreSQL grants plus Row-Level Security where practical.

Each request must set explicit database session context such as the effective
actor, organization and role. Policies and authorization helpers must treat
missing or malformed context as denied access.

No route may rely on hidden buttons or client-side filtering for protection.
Cross-tenant access, inactive membership access, direct object identifier
guessing and privilege escalation through stale sessions are explicit negative
test cases.

### Private file handling

Private file bytes live outside the public web root on a dedicated private
application volume. The application serves files only through authenticated
routes after authorization checks.

PostgreSQL stores:

- logical document/file identifiers;
- checksum and media metadata;
- case or entity ownership;
- version lineage and review/resubmission state;
- access audit and restore inventory.

Database backup and private-file backup are separate required evidence streams.
A database-only restore does not prove that V2 can recover accepted files.

### Bounded external adapters

The earlier bounded adapter rules remain in force unless a later explicit owner
decision changes them:

- WAHA is private and receive-only for the approved acceptance stage.
- amoCRM is read-only or import-only, never canonical operational authority.
- Gemini is server-side and human-reviewed; it cannot autonomously send,
  confirm, assign, hand off or override permissions.

### V1 boundary

V1 staging and production remain frozen deployment boundaries. This ADR does
not authorize:

- deployment over V1;
- deletion of V1;
- migration of real customer data;
- WhatsApp send;
- amoCRM write;
- paid infrastructure creation;
- final cutover.

## Supersession

For V2 work, this ADR supersedes conflicting target-runtime clauses in earlier
documents as follows:

- ADR 0014 remains useful only as history for the unified-product shape, bounded
  adapters and audit intent. Its Supabase-native runtime and amoCRM-era details
  are not current V2 authority.
- ADR 0015 remains historical evidence for migration immutability and schema
  discipline, but its `supabase/` chain, Supabase-managed schemas and provider
  assumptions are not V2 authority.
- ADR 0020 remains historical evidence for one product, one workflow and no
  fallback runtime. Its rule that Supabase is the permanent canonical
  foundation is superseded for V2.
- ADR 0021 remains historical evidence for the net-new pilot boundary and
  human-reviewed Gemini constraint. Its Supabase-specific runtime authority and
  its execution order are superseded for V2.

Historical provider, deployment and production observations remain true only
for the exact older system, SHA and date they described. They do not become V2
acceptance evidence.

## Consequences

- V2 implementation must begin with a contract reset before foundation code.
- The repository may temporarily contain legacy Supabase code while V1 remains
  frozen, but no completed V2 runtime path may depend on it.
- The first V2 foundation slices must add new PostgreSQL, Better Auth,
  authorization and private-file paths before removing older code wholesale.
- Real browser login/logout and denied-access checks become first-class proof,
  not optional polish.
- Backup and restore evidence must cover both database state and private-file
  bytes.

## Rejected alternatives

### Keep Supabase for runtime and only self-host the database later

Rejected because it preserves the exact runtime dependency the owner removed and
would invite partial compatibility paths.

### Introduce a compatibility bridge or dual-write migration period

Rejected because it increases drift risk, hides source-of-truth ambiguity and
contradicts the owner's explicit no-bridge instruction.

### Use public staff signup and rely on role review after login

Rejected because staff identity creation is a privileged operational action and
must default to deny.

### Rely on application-layer checks only

Rejected because a second enforcement layer in PostgreSQL reduces blast radius
from handler mistakes and direct-query mistakes.

### Store private files in public object URLs with obscured names

Rejected because obscurity is not authorization and does not provide auditable
access control.

## Official primary sources

- Better Auth Next.js integration:
  <https://better-auth.com/docs/integrations/next>
- Better Auth email/password authentication:
  <https://better-auth.com/docs/authentication/email-password>
- Better Auth options and trusted origins:
  <https://better-auth.com/docs/reference/options>
- Better Auth database and CLI schema generation:
  <https://better-auth.com/docs/concepts/database>
  and <https://better-auth.com/docs/concepts/cli>
- Better Auth Drizzle adapter:
  <https://better-auth.com/docs/adapters/drizzle>
- Drizzle migrations overview:
  <https://orm.drizzle.team/docs/migrations>
- Drizzle migration generation:
  <https://orm.drizzle.team/docs/drizzle-kit-generate>
- Drizzle migration application:
  <https://orm.drizzle.team/docs/drizzle-kit-migrate>
- Drizzle config and migration log:
  <https://orm.drizzle.team/docs/drizzle-config-file>
- PostgreSQL row security:
  <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
- PostgreSQL CREATE POLICY default-deny behavior:
  <https://www.postgresql.org/docs/current/sql-createpolicy.html>
- Next.js async cookies and App Router route handlers:
  <https://nextjs.org/docs/app/api-reference/functions/cookies>
  and <https://nextjs.org/docs/app/api-reference/file-conventions/route>
