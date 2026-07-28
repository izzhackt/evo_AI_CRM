# EVO Platform Supabase

This directory is the sole repository authority for EVO Platform Supabase
configuration, migrations, and database authorization tests.

## P2A baseline

- `migrations/001_...039_...` is the byte-identical legacy EVO Inbox history.
- `migration-history.json` records deterministic SHA-256 and byte counts tied
  to source commit `1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5`.
- `tests/` contains the disposable PostgreSQL bootstrap, authorization
  assertions, and catalog inventory.
- `config.toml` defines the isolated `evo-platform-local` development stack.
- There is no migration 040 in P2A. P2B owns the next verified migration.

The former `agent-lead2-inbox/supabase/` path is a pointer only. Never restore a
second SQL copy there. Once merged, migrations are immutable; corrections use a
new forward migration.

## Local checks

Use Node `22.23.1` and the project-local CLI. These commands do not link or
mutate a managed Supabase project:

```bash
npm ci
npm run test:supabase:history
npm run test:security:postgres
npm run test:supabase:local
```

`test:supabase:local` uses a dedicated local Docker project and ports
`45420–45429`, loads no seed/customer data, suppresses ephemeral local
credentials, and cleans up only its own containers.

Managed migration-ledger parity, production project selection, region, plan,
PITR and remote restore are separate authorized evidence gates.
