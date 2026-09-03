# EVO Admissions CRM

EVO is one private staff product for Sales, Student 360, Admissions, Finance,
Tasks, Documents, WhatsApp and human-reviewed AI workflows. The active
production-successor application lives at the repository root and uses one
managed Supabase foundation for Postgres, staff Auth, private Storage, RLS and
the limited Realtime capabilities the product needs.

The active container topology is deliberately small:

- `app`: the root Next.js application;
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

Routine validation:

```bash
npm run test:security
npm run lint
npm run typecheck
npm run build
```

The real disposable Supabase/PostgreSQL/Auth/Storage and browser contract is:

```bash
npm run test:database:local
```

The final isolated release-candidate proof additionally builds and boots the
exact `linux/amd64` app image with private WAHA on OrbStack:

```bash
npm run test:p6d:orbstack
```

Do not put secrets, WhatsApp session data, customer personal data, Supabase
server keys, provider tokens or production environment files in Git or command
output.

## Release boundary

The current successor runbook is
[`deploy/production-release.md`](deploy/production-release.md). It is a gated
exact-SHA contract, not authorization to deploy. Production, managed-Supabase
migration, public traffic, webhook ownership transfer, customer migration and
V1 retirement require their later explicit acceptance/cutover gates.

The intended production location remains `/opt/evo-crm` on `hermes-vps`, with
the public CRM route owned by `evo-edge-caddy` on `evo_public_web`. WAHA remains
private. The frozen `/opt/evo-inbox` contour must not be used as successor
authority.

## Knowledge workspace

Human-facing EVO knowledge lives outside the repository at
`/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания`. Follow the privacy,
provenance and approval rules in `AGENTS.md`; never publish raw archives or
credentials into an AI knowledge base.
