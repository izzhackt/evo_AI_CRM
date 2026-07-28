# P2B schema and secret-grant containment

- Block: P2B
- Date: 2026-07-28
- Starting main: `8ad755b5039390f418dbe12924a806f069f93b53`
- Plan: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Detailed contract: `docs/platform/p2-supabase-foundation.md`
- Provider proof: not required for this repository/disposable-local block

## Result

Migration 040 establishes the first target Platform namespaces and contains the
legacy Inbox tables that hold encrypted provider credentials or credential
verification hashes. It creates no Platform domain table, organization,
membership or role. It does not link or mutate a managed Supabase project.

The resulting boundary is:

| Surface | Effective boundary after 040 |
|---|---|
| `platform` | Exposed in local PostgREST configuration; schema `USAGE` only for `authenticated` and `service_role`; no blanket object grants and no anonymous access |
| `platform_private` | Excluded from PostgREST; no `anon` or `authenticated` access; least-privilege service-role defaults |
| `pgmq_public` | Excluded from PostgREST; browser grants are revoked when the provider schema exists |
| legacy secret-bearing tables | `whatsapp_config`, `ai_configs`, `webhook_endpoints`, `api_keys` and `integration_secrets` are service-role-only |

PostgreSQL grants apply to whole tables unless access is deliberately narrowed.
For that reason, retaining a table-level browser `SELECT` while revoking only a
secret column would not provide the required boundary. Migration 040 revokes
the browser table grants and the matching permissive policies, then grants the
backend role only `SELECT`, `INSERT`, `UPDATE` and `DELETE`. It does not grant
`TRUNCATE`, `REFERENCES` or `TRIGGER`.

The implementation follows the official
[Supabase custom-schema exposure model](https://supabase.com/docs/guides/api/using-custom-schemas),
[Supabase API security guidance](https://supabase.com/docs/guides/api/securing-your-api)
and
[PostgreSQL privilege model](https://www.postgresql.org/docs/current/ddl-priv.html).

## Legacy consumer reconciliation

The revocation was preceded by a repository consumer inventory. Current
behavior is preserved as follows:

| Data | Current consumer boundary |
|---|---|
| `ai_configs.api_key` and `embeddings_api_key` | Cookie authentication and account/role resolution run first. Account-scoped service stores then read or write ciphertext. Responses expose only safe configuration and `has_*` booleans. |
| `api_keys.key_hash` | Dashboard list/create/revoke routes authorize the caller first, then use account-scoped service stores. List/create responses select an explicit public column set; the hash is never returned. |
| `integration_secrets.encrypted_value` | The active WAHA/amoCRM settings paths already use the backend integrations client. Direct authenticated DML is removed. |
| `webhook_endpoints.secret` | API-key context and webhook delivery already use backend clients and explicit safe response columns. |
| `whatsapp_config.access_token` | Active first-launch WAHA configuration uses `integration_secrets`, not this legacy Meta table. Legacy Meta media/react/send/webhook/template/broadcast/flow/automation surfaces are deliberately intercepted with HTTP 410 before their handlers. Retained API-key/background consumers use service-role clients. |

The shared service client disables session persistence, token refresh and URL
session detection. It is created only from server environment variables and is
never imported into a client component. No provider credential or real secret
was used in these checks.

## Evidence

### Immutable and forward migration history

The checksum manifest remains authoritative for the byte-identical 001–039
baseline. The verifier now requires the exact migration 040 filename and
accepts only contiguous later migrations:

```json
{"ok":true,"checked":39,"range":"001-039","current":"040","total":40}
```

The old Inbox migration path remains pointer-only. Local reset derives the
expected ledger from the canonical filenames rather than hardcoding 040, so
future 041+ migrations must remain contiguous.

### Disposable PostgreSQL authorization

The PostgreSQL harness applies 001–040, reapplies 038, 039 and 040 to exercise
idempotency, and proves:

- `anon` cannot resolve `platform`, `platform_private` or `pgmq_public`;
- `authenticated` can resolve `platform` but cannot create objects there;
- browser roles cannot access `platform_private` or queue API objects;
- real authenticated queries for `access_token`, both AI key columns,
  webhook `secret`, API `key_hash` and integration `encrypted_value` fail with
  `insufficient_privilege`;
- a real authenticated direct insert into `integration_secrets` fails;
- service-role DML remains available without the three excess table
  privileges;
- future tables, sequences, functions and types created by the migration owner
  inherit fail-closed browser defaults and narrow service defaults;
- legacy signup creates only legacy account/profile records and no Platform
  relation or membership;
- the authorization protections from migrations 038 and 039 remain intact.

The test uses synthetic `example.test` identities only. It loads no customer
message, phone number, session or production database.

### Local Supabase and PostgREST

The pinned project-local Supabase CLI `2.110.0` reset a disposable local stack
through all 40 migrations. The local and applied ledgers matched exactly.
Runtime PostgREST configuration exposed:

```text
public,platform,graphql_public
```

It did not expose `platform_private` or `pgmq_public`. No seed data was loaded
and the local containers were stopped after the check.

### Application contract

Focused Inbox tests cover account-scoped AI config, AI credential testing,
readiness, API-key list/create/revoke, corrupt ciphertext, safe response
projection and the disabled legacy Meta paths. The schema contract also checks
the 040 namespace, grant and PostgREST configuration.

The full root, Inbox, retained Lead Agent and browser gates are recorded in the
P2B pull request for its exact head SHA.

## Rollback and provider boundary

Before any remote application, the repository change is reversible with the
branch. After application, rollback is a reviewed forward migration; it must
not restore browser access to base secret-bearing tables. A repair must add a
safe server path or reviewed projection instead.

This block proves repository code, a disposable PostgreSQL authorization
matrix and an isolated local Supabase/PostgREST reset only. It does not prove:

- a linked managed Supabase project or remote migration-ledger parity;
- selected region, plan, PITR or cost;
- production database or Storage backup/restore;
- live WAHA, WhatsApp, amoCRM or AI-provider behavior;
- production deployment or cutover.

The next sequential gate is P2C: Platform organizations, identities, business
roles, object scopes and append-only audit with a complete cross-role and
cross-organization denial matrix.
