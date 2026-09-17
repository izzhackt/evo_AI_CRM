# EVO production-successor deployment boundary

Status: active V3 deployment contract. This document describes the release
candidate; it does not authorize a production deployment, traffic cutover,
provider mutation, customer-data change, or retirement of frozen V1.

The successor has one runtime topology:

| Component | Authority | Deployment boundary |
| --- | --- | --- |
| EVO staff application | root Next.js application | Compose service `app` |
| Document malware scanner | pinned ClamAV image | Compose service `clamav`, private network only |
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

## Canonical domain cutover

Accepted on 2026-09-17: staff use
`https://crm.evoadmissions.com`; Students use `https://app.evoadmissions.com`.
Both terminate HTTPS at `evo-edge-caddy` and reach the same `evo-crm-app:3000`
on `evo_public_web`. Preserve the original public Host and host-only cookies;
do not share sessions with the marketing site or use wildcard origin rules.
Exact callbacks are `https://crm.evoadmissions.com/auth/staff` and
`https://app.evoadmissions.com/auth/callback`.

At the preparation checkpoint, both authoritative nameservers returned
`72.62.119.112` with TTL 300; final Caddy validation had passed without reload.
That checkpoint is superseded by the [launch-plan receipt](../docs/EVO_LAUNCH_PLAN.md):
CI `35166365096` and managed release `35167122534` succeeded for
`62b16ca8a12d8181ffbad03a000ca0695cb59689`. Server readback at 00:43:03 UTC
confirmed release `v3-r35167122534-a1-62b16ca8`, healthy runtime, zero restarts,
no pending candidate and a passed authenticated staff browser receipt.
Final edge reload at 00:43:23 UTC matched the reviewed config without restart;
all 24 public checks passed at 00:43:27 UTC. Mac Chrome rendered both login
pages and audience links. This is not proof of real Student login or email
delivery; custom SMTP remains off and no emails were sent.

Completed cutover sequence (retain these boundaries for later releases):

1. Bootstrapped trusted HTTPS for both names on the existing app; the old sslip
   route remained only during the pending transition and rollback window.
2. Configured exact Supabase callbacks and compatible invite/recovery templates
   per [team activation](../docs/runbooks/team-workspace-activation.md).
3. After new TLS/health passed, updated only mutable operator
   `EVO_CRM_DOMAIN=crm.evoadmissions.com` and GitHub variable
   `EVO_RELEASE_EXTERNAL_HEALTH_URL=https://crm.evoadmissions.com/api/health`.
   Completed the [exact-SHA managed release](production-release.md); do not edit
   old accepted snapshots or bypass controller sealing on subsequent releases.
4. After acceptance, retired the old sslip app origin: GET navigation returns
   308 and POST returns 405. Never redirect auth POSTs or retain an alternate app.
   Preserve unrelated edge routes, private API guards, DNS/mail and WAHA.

See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) and
[Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

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

`docker-compose.prod.yml` declares exactly `app`, private `clamav` and private
`waha`.

- `app` joins `evo_crm_private` and the pre-existing EVO web network.
- `clamav` joins only `evo_crm_private`; it has no host-published port.
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
