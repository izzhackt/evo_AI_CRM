# EVO production-successor deployment boundary

Status: active V3 deployment contract. This document describes the release
candidate; it does not authorize a production deployment, traffic cutover,
provider mutation, customer-data change, or retirement of frozen V1.

The successor has one runtime topology:

| Component | Authority | Deployment boundary |
| --- | --- | --- |
| EVO staff application | root Next.js application | Compose service `app` |
| WhatsApp transport | existing private WAHA session `crm_primary` | Compose service `waha`, private network only |
| Business data and authorization | one managed Supabase project | external Postgres, Auth, RLS, and private Storage |

There is no active SQLite or Drizzle business store, companion Inbox
application, Lead Agent service, manual-send worker, local staff bootstrap, or
second application UI. amoCRM and Gemini remain explicit integrations; neither
is a second data authority.

Use [production-release.md](production-release.md) for the exact-SHA release,
[fast-app-release.md](fast-app-release.md) for automatic execution and exact
rollback, and [runtime-hardening.md](runtime-hardening.md) for health, privacy,
resource, and log rules. The managed-Supabase recovery boundary is in
[`docs/DISASTER_RECOVERY.md`](../docs/DISASTER_RECOVERY.md). The superseded V1
multi-runtime material is retained under
[`docs/archive/v1`](../docs/archive/v1/README.md) and must not be executed.

## Active inputs

Keep real values outside every release checkout:

- `/opt/evo-crm/.env.production`, matching `deploy/env.production.example`;
- `/opt/evo-crm/.env.waha`, matching `deploy/env.waha.example`; and
- the existing protected `evo_crm_waha_sessions` volume for `crm_primary`.

The release controller also requires an exact 40-character
`EVO_RELEASE_REVISION`, an immutable `EVO_RELEASE_VERSION`, and an immutable
`EVO_WAHA_IMAGE_DIGEST`. Never use a moving app or WAHA tag as release proof.

The application environment must contain the managed Supabase URL, publishable
key, server-only secret key, and canonical organization identifier. Missing or
invalid Supabase configuration must stop the application path clearly; it must
never select SQLite, a local repository, fixtures, or a frozen worker instead.

Supabase staff accounts and roles are managed through Supabase Auth and the
canonical migrations in root `supabase/`. Do not run the removed V1 local-admin
bootstrap or maintain a second credential store.

## Network and storage boundary

`docker-compose.prod.yml` declares exactly `app` and `waha`.

- `app` joins `evo_crm_private` and the pre-existing EVO web network.
- `waha` joins only `evo_crm_private`; it has no host-published port.
- WAHA session bytes remain in `evo_crm_waha_sessions`.
- Canonical documents live in private Supabase Storage, not the app output
  volume. `evo_crm_output` is non-authoritative generated output only.
- The Compose file does not create or operate Supabase, Caddy, Inbox, Lead
  Agent, or any manual worker.

The release lane must not log environment values, Supabase keys, WAHA keys,
session data, customer content, phone numbers, or provider payloads.

## Current authorization boundary

Repository validation and isolated local recovery proof run without routine
approval. The owner’s 2026-09-04 direction already authorizes the one #552 V3
production cutover after #551 and every named prerequisite pass; no second
routine approval is added. Missing access or failed prerequisites stop clearly.
Webhook ownership change, schema apply/restore, WAHA session change, provider
write and customer-data operation remain separate controlled actions.
