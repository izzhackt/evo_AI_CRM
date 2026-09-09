# EVO Admissions CRM

EVO is one private staff product for Sales, Student 360, Admissions, Finance,
Tasks, Documents, WhatsApp and human-reviewed AI workflows. The active
production-successor application lives at the repository root and uses one
managed Supabase foundation for Postgres, staff Auth, private Storage, RLS and
the limited Realtime capabilities the product needs.

The production Compose topology is:

- `app`: the root Next.js application;
- `clamav`: the private document malware scanner, pinned by immutable image digest;
- `waha`: the private WhatsApp transport, pinned by immutable image digest.

The repository-retained `agent-lead2-inbox/` and `evo-lead-agent/` trees are
frozen V1 migration and rollback inputs. They are not separate target products,
are excluded from the successor image, and must not be started, imported or
used as release fallbacks. Historical deployment material is indexed under
[`docs/archive/`](docs/archive/README.md).

## Product authority

Read these before medium or large changes:

- [`AGENTS.md`](AGENTS.md) — repository boundaries and replacement discipline;
- [`CONTEXT.md`](CONTEXT.md) — domain context;
- [`docs/EVO_LAUNCH_PLAN.md`](docs/EVO_LAUNCH_PLAN.md) — active implementation
  contract;
- [`docs/PLAN_CHANGES.md`](docs/PLAN_CHANGES.md) — append-only decision ledger;
- [`docs/adr/`](docs/adr/) — architecture decisions.

GitHub `main` is the shared source of truth. Work through a GitHub Issue and a
reviewed exact-head PR; do not turn a local or VPS checkout into private
authority.

Resume the current September10 continuation from
[`business-operations-universities-run-plan.md`](docs/design/v3/business-operations-universities-run-plan.md):
daily Sales/Finance/Admissions gaps, native team-workspace integration and a
source-backed university catalogue for staff and Student. Status and release
evidence live in that plan; planned features are not yet deployment evidence.

The September 9 implementation baseline is recorded in
[`student-admissions-run-plan.md`](docs/design/v3/student-admissions-run-plan.md):
Student Portal, native English/career-interest tests, China/Malaysia Admissions,
and the shared [`DESIGN.md`](DESIGN.md) contract. This is authorized implementation
scope, not a claim that these additions are already deployed.
The preceding follow-up scope and acceptance history remain in
[`docs/design/v3/curator-ux-run-plan.md`](docs/design/v3/curator-ux-run-plan.md).
The earlier `run-plan.md` first-launch checklist is retained as history; do not
repeat a completed release when starting the September 8 curator/UX improvements.

## Local development

Requirements:

- Node.js 22 (pinned by `.nvmrc`);
- npm;
- Supabase CLI;
- OrbStack on macOS, with Docker context exactly `orbstack`;
- Playwright Chromium for the real browser gate.

Install and run the application with real ignored local Supabase credentials:

```bash
nvm use
npm ci
npm run dev
```

The application fails closed when Supabase URL, publishable key, server key or
organization authority is missing. It never falls back to SQLite, Drizzle,
fixtures or a companion application.

Validation follows the changed scope:

- **Documentation only:** check the changed-file classifier, `git diff --check`
  and links. Ordinary prose skips product checks; contract docs also run the
  short `Release contracts` suite. Lint, typecheck, build and migration-boundary
  suites are not required for prose-only changes.
- **Routine PR:** run the affected real tests, obtain independent review of the
  current commit, and pass the protected `Changed range` and `Fast checks` jobs
  with their selected checks.
- **Release:** run the manual `EVO platform CI` workflow once on the frozen
  current `main` commit. Its successful result admits that exact commit to the
  release lane. Repeat only if the candidate changes or a failed check needs a
  verified fix; do not repeat it for every PR or merge.

For a specific investigation, `npm run test:database:local` exercises the real
disposable Supabase/PostgreSQL/Auth/Storage and browser contract, and
`npm run test:p6d:orbstack` runs the isolated container candidate proof. Use these
when the affected case needs them; they are not an additional mandatory rollup
alongside the release workflow. Select lint, typecheck, build or security tests
for the changed code or failure under investigation.

Do not put secrets, WhatsApp session data, customer personal data, Supabase
server keys, provider tokens or production environment files in Git or command
output.

## Release boundary

The current successor runbook is
[`deploy/production-release.md`](deploy/production-release.md). It is a gated
exact-SHA contract. The owner direction recorded in `AGENTS.md` already
authorizes the #552 V3 deployment and active-runtime retirement after #551 and
all named prerequisites pass. Provider enablement, live provider calls and
webhook ownership transfer require their separate acceptance scope. Use the
active run plan for remaining access requirements and deployment steps.

The intended production location remains `/opt/evo-crm` on `hermes-vps`, with
the public CRM route owned by `evo-edge-caddy` on `evo_public_web`. WAHA remains
private. The frozen `/opt/evo-inbox` contour must not be used as successor
authority.

## Knowledge workspace

Human-facing EVO knowledge lives outside the repository at
`/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания`. Follow the privacy,
provenance and approval rules in `AGENTS.md`; never publish raw archives or
credentials into an AI knowledge base.
