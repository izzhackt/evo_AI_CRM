# P2A Supabase repository baseline

- Block: P2A
- Date: 2026-07-28
- Starting main: `1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5`
- Plan: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Detailed contract: `docs/platform/p2-supabase-foundation.md`
- Provider proof: not required for this repository/local-only block

## Result

P2A establishes root `supabase/` as the only repository migration authority.
The former EVO Inbox path contains only a pointer README. No migration 040 was
created, no managed project was linked, and no remote or production migration
was applied.

The canonical baseline contains:

- 39 migrations, numbered contiguously from 001 through 039;
- 230,757 bytes of SQL copied byte-for-byte from the starting main;
- a deterministic SHA-256/byte-count manifest tied to the source commit;
- relocated PostgreSQL bootstrap, policy assertions, and catalog inventory;
- project-local Supabase CLI `2.110.0` and root `supabase/config.toml`;
- an isolated local Docker project named `evo-platform-local`, PostgreSQL 17,
  and reserved ports `45420–45429`;
- the existing PostgreSQL authorization matrix on `pgvector/pgvector:pg15`,
  preserving the legacy compatibility check on PostgreSQL 15.

The local PostgreSQL major used by the future managed project is not inferred
from these checks. Exact managed version/ledger parity remains a separate gate.

## Evidence

### Immutable source

Every root migration was compared directly with:

```text
1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5:
agent-lead2-inbox/supabase/migrations/<same filename>
```

Result: 39/39 byte-identical. The manifest verifier returned:

```json
{"ok":true,"checked":39,"range":"001-039"}
```

Focused verifier tests passed 5/5, including rejection of byte/SHA drift,
non-contiguous history, migration 040, nondeterministic provenance, and a
duplicate SQL file under the companion path.

### Catalog equivalence

The same disposable PostgreSQL bootstrap and ordered 001–039 chain were run
before and after relocation. The catalog-only output covers exposed relations,
RLS flags, API-role relation/column grants, policies, RPC/function grants,
security-definer posture, buckets, and Storage policies.

| Snapshot | SHA-256 | Bytes |
|---|---|---:|
| before relocation | `98cafd45d4ec88df64ca0268f4d8b4bc5b22062304fb146e41d8cc9f1f1bc005` | 192,190 |
| after relocation | `98cafd45d4ec88df64ca0268f4d8b4bc5b22062304fb146e41d8cc9f1f1bc005` | 192,190 |

`cmp` returned success: the inventories are byte-identical.

### Real disposable database checks

With Node `22.23.1`:

```bash
npm run test:supabase:history
npm run test:security:postgres
npm run test:supabase:local
```

Results:

- the PostgreSQL authorization/RLS suite passed, including expected denial
  assertions;
- Supabase CLI `2.110.0` started only its isolated local database;
- a clean start and explicit `db reset --local --no-seed` both applied 001–039;
- the CLI local and applied ledgers were both contiguous and ended at 039;
- no seed or customer-like data was loaded;
- key-bearing local CLI output was captured and not printed;
- the `evo-platform-local` containers and reserved ports were absent after the
  cleanup trap;
- an unrelated local Supabase stack remained untouched.

## Rollback and next gate

Before any authorized remote apply, rollback is a repository-only revert of the
path/config/tooling block. There is no database rollback because P2A performed
no remote mutation.

P2B may begin at expected migration 040 only from this immutable root history.
Managed ledger parity, project selection, region, plan, PITR, credentials and
remote restore remain blocked until separately authorized and evidenced.
