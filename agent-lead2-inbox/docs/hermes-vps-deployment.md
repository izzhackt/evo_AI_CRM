# EVO Inbox hermes-vps deployment preflight

This is the companion-specific configuration for `inbox.evoadmissions.com`.
The actual production sequence is the repository-level
[EVO Production Release Runbook](../../deploy/production-release.md). It
deploys CRM and Inbox from one exact reviewed `main` SHA without changing the
existing `/opt/evo-crm` or `/opt/evo-inbox` checkouts.

## Source contract

- GitHub remains the source of truth.
- Target service name: `evo-inbox`.
- Clean release source:
  `/opt/evo-releases/<full-main-sha>/repo/agent-lead2-inbox`.
- Existing runtime secret files remain under the historical live-checkout path
  `/opt/evo-inbox/agent-lead2-crmwhatsapp/` and are passed to Compose by
  absolute path. They are never copied into the clean release. The reviewed
  source path is `agent-lead2-inbox/`; this release deliberately does not rename
  or clean the old server checkout.
- Target public host: `https://inbox.evoadmissions.com`.
- Temporary fallback host until DNS is created:
  `https://evo-inbox.72.62.119.112.sslip.io`.
- Caddy reverse-proxy target: `evo-inbox-app:3000`.
- Caddy Docker network: `${EVO_CADDY_NETWORK:-evo_public_web}`. This must be an EVO-owned neutral edge network, not an `acadis_*` project network.
- Public edge proxy: `evo-edge-caddy`, configured from
  `deploy/docker-compose.edge.yml` and `deploy/Caddyfile.evo-edge`.
- Private WAHA service: `evo-inbox-waha`, reachable from the companion app at
  `http://evo-inbox-waha:3000`.
- WAHA stays private on the companion Compose network. Do not add public
  `ports:` for WAHA.

The Next.js container uses `output: "standalone"`. Per the official Next.js
standalone output docs, `.next/standalone` contains the minimal server, while
`public` and `.next/static` must be copied into the runtime image for
`server.js` to serve assets:
https://nextjs.org/docs/pages/api-reference/config/next-config-js/output

`NEXT_PUBLIC_*` values used by browser code must be available during
`next build`, not only as container runtime variables. Pass the external
`EVO_INBOX_APP_ENV_FILE` to Compose with `--env-file` so the public Supabase
URL/key are available as Docker build args. Server-only secrets such as
`SUPABASE_SERVICE_ROLE_KEY` and `ENCRYPTION_KEY` remain runtime-only and must
not be passed as build args.

## Review artifacts

- `Dockerfile`
- `deploy/docker-compose.inbox.prod.yml`
- `deploy/docker-compose.edge.yml`
- `deploy/Caddyfile.inbox.evoadmissions.com`
- `deploy/Caddyfile.evo-edge`
- `deploy/env.production.example`
- `deploy/env.waha.example`
- `scripts/preflight-prod.mjs`

## Required runtime env

Set these on the target host in `.env.production`; do not commit real values.

| Variable                        | Purpose                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`          | Canonical URL, `https://inbox.evoadmissions.com`.            |
| `EVO_INBOX_DOMAIN`              | Expected DNS/Caddy hostname, `inbox.evoadmissions.com`.      |
| `EVO_CADDY_NETWORK`             | Docker network shared with Caddy, normally `evo_public_web`. |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase companion project URL.                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key.                               |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only Supabase service role key.                       |
| `ENCRYPTION_KEY`                | 64 hex chars for encrypted integration and AI secrets.       |

WAHA, amoCRM, and AI provider secrets are account-level settings stored
encrypted in Supabase. The private WAHA container stores only
`WAHA_API_KEY=sha512:<hash>` in `.env.waha`; the plain WAHA key is stored only
in encrypted EVO Inbox settings and, for the proof run, in `.env.production` as
`EVO_INBOX_WAHA_API_KEY`. For the proof run only, the preflight script also
checks `EVO_INBOX_WAHA_BASE_URL`, `EVO_INBOX_WAHA_API_KEY`,
`EVO_INBOX_WAHA_WEBHOOK_HMAC`, `EVO_INBOX_AMOCRM_BASE_URL`,
`EVO_INBOX_AMOCRM_ACCESS_TOKEN`, and `EVO_INBOX_GEMINI_API_KEY` from the
ignored `.env.gemini` seed file.

## Preflight commands

Run from the clean release's `agent-lead2-inbox/` directory after the release
runbook has set `EVO_RELEASE_REPO` and the external secret paths:

```bash
cd "$EVO_RELEASE_REPO/agent-lead2-inbox"
set -a
. "$EVO_INBOX_APP_ENV_FILE"
. /opt/evo-inbox/agent-lead2-crmwhatsapp/.env.gemini
set +a
npm run preflight:prod
npm run lint
npm run typecheck
npm test
npm run build
docker build -t evo-inbox:preflight .
```

`npm run preflight:prod` is intentionally local. It fails clearly on missing
Supabase, WAHA, amoCRM, AI, `ENCRYPTION_KEY`, and DNS/Caddy inputs, but it does
not call live services or prove production. Issue #20 requires the real proof
sequence in `docs/production-proof-checklist.md`.

## Seed WAHA runtime settings

After `.env.production` contains the live Supabase keys, `ENCRYPTION_KEY`, and
WAHA proof variables, seed the encrypted account-level WAHA runtime settings:

```bash
cd "$EVO_RELEASE_REPO/agent-lead2-inbox"
set -a
. "$EVO_INBOX_APP_ENV_FILE"
set +a
npm run seed:prod-waha
```

Required seed variables:

| Variable                      | Purpose                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `EVO_INBOX_ACCOUNT_ID`        | Optional when exactly one Supabase `accounts` row exists; required when there are multiple accounts. |
| `EVO_INBOX_CONFIG_USER_ID`    | Optional audit user id; falls back to `accounts.owner_user_id` when present.                         |
| `EVO_INBOX_WAHA_BASE_URL`     | Private app-to-WAHA URL, normally `http://evo-inbox-waha:3000`.                                      |
| `EVO_INBOX_WAHA_SESSION_NAME` | Optional WAHA session name; defaults to `evo-inbox`.                                                 |
| `EVO_INBOX_WAHA_API_KEY`      | Plain WAHA API key used by the app; stored encrypted in Supabase.                                    |
| `EVO_INBOX_WAHA_WEBHOOK_HMAC` | WAHA webhook HMAC secret; stored encrypted in Supabase.                                              |

The seed command upserts `integration_settings(provider='waha')` and encrypted
`integration_secrets` for `api_key` and `webhook_hmac_secret`. It prints only
the setting id, account id, public config, and secret names; it must not print
secret values.

## Seed Gemini AI draft settings

After `.env.production` contains the live Supabase keys and `ENCRYPTION_KEY`,
create `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.gemini` from
`deploy/env.gemini.example`, then seed the encrypted account-level AI config:

```bash
cd "$EVO_RELEASE_REPO/agent-lead2-inbox"
set -a
. "$EVO_INBOX_APP_ENV_FILE"
. /opt/evo-inbox/agent-lead2-crmwhatsapp/.env.gemini
set +a
npm run seed:prod-ai
```

Required seed variables:

| Variable                        | Purpose                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `EVO_INBOX_AI_PROVIDER`         | Must be `gemini` for this seed command.                                                              |
| `EVO_INBOX_AI_MODEL`            | Optional; defaults to `gemini-3.5-flash`.                                                            |
| `EVO_INBOX_AI_ACTIVE`           | Optional; defaults to `true`, enabling the operator-reviewed draft button.                           |
| `EVO_INBOX_EMBEDDINGS_PROVIDER` | Optional; defaults to `gemini`. Use `keyword` to seed keyword-only retrieval instead.                |
| `EVO_INBOX_ACCOUNT_ID`          | Optional when exactly one Supabase `accounts` row exists; required when there are multiple accounts. |
| `EVO_INBOX_CONFIG_USER_ID`      | Optional audit user id; falls back to `accounts.owner_user_id` when present.                         |
| `EVO_INBOX_GEMINI_API_KEY`      | Plain Gemini API key; validated with Google, then stored encrypted in Supabase.                      |
| `EVO_INBOX_AI_SYSTEM_PROMPT`    | Optional business instructions stored in `ai_configs.system_prompt`.                                 |

The seed command validates the Gemini key with Google's server-side
GenerateContent API and, when `EVO_INBOX_EMBEDDINGS_PROVIDER=gemini`, Google's
Gemini Embeddings API. It then upserts `ai_configs(provider='gemini')` with the
selected `embeddings_provider`. It prints only the provider, model, embeddings
provider, account id, active flags, and `has_api_key`; it must not print the key
or decrypted secret.

Production scale note: run `docs/supabase-scale-retention.md` before live proof
or imports. Supabase Free is for proof/small pilot only; move to Pro before
sustained WhatsApp production traffic, imports above 50k messages, database size
above 250 MB, or thousands of knowledge chunks.

## Seed amoCRM identity settings

After the EVO Inbox amoCRM external/private integration is created and its
long-lived token is copied once, create
`/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.amocrm` from
`deploy/env.amocrm.example`, then seed the encrypted account-level amoCRM
configuration:

```bash
cd "$EVO_RELEASE_REPO/agent-lead2-inbox"
set -a
. "$EVO_INBOX_APP_ENV_FILE"
. /opt/evo-inbox/agent-lead2-crmwhatsapp/.env.amocrm
set +a
npm run seed:prod-amocrm
```

Required seed variables:

| Variable                        | Purpose                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `EVO_INBOX_AMOCRM_BASE_URL`     | amoCRM/Kommo account URL, for example `https://evoadmissions.amocrm.ru`.                             |
| `EVO_INBOX_AMOCRM_ACCESS_TOKEN` | Long-lived token copied from the integration Keys and scopes tab; stored encrypted after validation. |
| `EVO_INBOX_ACCOUNT_ID`          | Optional when exactly one Supabase `accounts` row exists; required when there are multiple accounts. |
| `EVO_INBOX_CONFIG_USER_ID`      | Optional audit user id; falls back to `accounts.owner_user_id` when present.                         |

Optional routing variables:

| Variable                               | Purpose                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `EVO_INBOX_AMOCRM_PIPELINE_ID`         | Force created leads into a specific amoCRM pipeline.        |
| `EVO_INBOX_AMOCRM_STATUS_ID`           | Force created leads into a specific amoCRM status.          |
| `EVO_INBOX_AMOCRM_RESPONSIBLE_USER_ID` | Assign created leads to a specific responsible amoCRM user. |

The seed command calls `GET /api/v4/account` on the amoCRM account with the
provided bearer token before writing anything to Supabase. It upserts
`integration_settings(provider='amocrm')`, stores only encrypted
`access_token` secret material, and resets existing `not_configured` or
`blocked` CRM sync rows back to `pending` so the internal retry endpoint can
resolve them. It prints only non-secret provider/account metadata and secret
names; it must not print the token.

## amoCRM sync retry

Inbound WAHA messages are saved to Supabase before amoCRM sync. If amoCRM is
missing or temporarily unavailable, conversations/messages keep
`crm_sync_status='pending'` or `not_configured` and remain visible in EVO Inbox.
After fixing amoCRM configuration, run the bounded internal retry through the
clean release Compose definition:

```bash
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  exec -T app \
  sh -lc 'curl -fsS -X POST http://127.0.0.1:3000/api/internal/crm-sync \
    -H "x-cron-secret: $AUTOMATION_CRON_SECRET" \
    -H "content-type: application/json" \
    --data "{\"limit\":20,\"include_blocked\":true}"'
```

The endpoint requires `AUTOMATION_CRON_SECRET`, uses the service-role Supabase
client only after that secret matches, and returns counts for synced, pending,
not configured, and blocked rows. It does not make Supabase canonical for lead
identity; synced rows must still match amoCRM shadow ids.

## Deployment outline

Do not deploy Inbox independently with `up -d --build`. Follow the central
release runbook, which:

1. verifies the exact merged `main` SHA and creates a clean detached worktree;
2. validates external secret-file paths without displaying their contents;
3. captures prior image IDs, configuration, SQLite backup, and consistent
   stateful-volume snapshots;
4. pins WAHA and Caddy to the currently approved immutable digests;
5. builds and inspects the SHA-tagged Inbox image;
6. deploys the Inbox app and private WAHA one boundary at a time;
7. validates Caddy before a graceful reload and checks the fallback URL;
8. records canonical DNS as passed or blocked without changing the provider;
9. provides exact image/config rollback from untouched prior checkouts.

Apply Supabase migration `036_reliable_amocrm_sync_buffer.sql` and run the
provider seed commands only when their separate reviewed rollout requires
them. A container healthcheck does not prove real WAHA, amoCRM, Gemini, or
outbound behavior; execute the issue #20 credentialed proof checklist
separately.

If any non-EVO proxy owns host ports `80/443`, stop the release and plan the
ownership change. Do not stop or remove Acadis resources as an automatic EVO
deployment step.
