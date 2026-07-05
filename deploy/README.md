# EVO CRM Production Deployment

Target server: `hermes-vps`

Target path: `/opt/evo-crm`

The app runs as a Docker Compose project named `evo-crm`. It does not publish
host ports. The app container joins the existing Caddy web network and is
reached by Caddy at `evo-crm-app:3000`.

## Required Environment

Create `/opt/evo-crm/.env.production` from `deploy/env.production.example`.
Generate secrets on the server:

```bash
openssl rand -base64 48
openssl rand -base64 32
```

Do not commit or print the real values.

## Build And Start

```bash
cd /opt/evo-crm
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 app
```

## Bootstrap First Admin

Run once after the app container is healthy:

```bash
cd /opt/evo-crm
docker compose -f docker-compose.prod.yml exec \
  -e EVO_ADMIN_EMAIL='admin@example.com' \
  -e EVO_ADMIN_PASSWORD='replace-with-long-password' \
  -e EVO_ADMIN_NAME='EVO Admin' \
  app node scripts/bootstrap-admin.mjs
```

## Backup

```bash
cd /opt/evo-crm
docker compose -f docker-compose.prod.yml exec app node scripts/backup-sqlite.mjs
```

Backups are written to the `evo_crm_backups` Docker volume.

## Caddy

Append `deploy/Caddyfile.evo-crm` to the active Caddyfile used by the existing
`acadis-caddy-1` container, then reload Caddy.

Do not replace the existing Caddyfile without backing it up.

## WAHA

WAHA runs in the same Compose project as a private service named `waha`. It does
not publish a host port. The CRM reaches it on the Docker network at:

```txt
http://evo-crm-waha:3000
```

Create `/opt/evo-crm/.env.waha` from `deploy/env.waha.example`. Generate a
plain API key and store only its SHA-512 hash there as
`WAHA_API_KEY=sha512:<hash>`. Store the plain API key in CRM Settings and in
`/opt/evo-crm/.env.lead-agent`.

Create `/opt/evo-crm/.env.lead-agent` from `deploy/env.lead-agent.example`.
The lead-agent service is the WAHA webhook owner. It resolves amoCRM identity
first, then posts a signed internal sync event to the CRM operator UI.

For the Gemini receive-only rollout, `/opt/evo-crm/.env.lead-agent` must include
all of these exact settings before the live message test:

```txt
EVO_AGENT_WAHA_API_KEY=<plain key matching .env.waha hash>
EVO_AGENT_WAHA_SESSION=crm_primary
EVO_AGENT_WAHA_WEBHOOK_SECRET=<WAHA webhook HMAC secret>
EVO_AGENT_WAHA_WEBHOOK_URL=http://evo-lead-agent:8000/webhooks/waha
EVO_AGENT_AMO_BASE_URL=https://<subdomain>.amocrm.ru
EVO_AGENT_AMO_CLIENT_ID=<amoCRM integration id>
EVO_AGENT_AMO_CLIENT_SECRET=<amoCRM integration secret>
EVO_AGENT_AMO_REDIRECT_URI=<amoCRM redirect URI>
EVO_AGENT_AMO_REFRESH_TOKEN=<amoCRM refresh token for initial token file creation>
EVO_AGENT_AMO_TOKEN_FILE=/app/data/amo-token.json
EVO_AGENT_CRM_SYNC_SECRET=<matches CRM Settings lead-agent sync secret>
EVO_AGENT_ADMIN_API_KEY=<private admin key>
GEMINI_API_KEY=<Gemini API key>
EVO_AGENT_GEMINI_MODEL=gemini-3.5-flash
EVO_AGENT_AUTOREPLY_ENABLED=true
EVO_AGENT_OUTBOUND_ENABLED=false
```

`EVO_AGENT_AUTOREPLY_ENABLED=true` enables internal Gemini draft review in the
lead-agent pipeline. `EVO_AGENT_OUTBOUND_ENABLED=false` is mandatory for the
first receive-only proof; do not enable outbound WhatsApp in this rollout.
The production Compose file intentionally reads these flags from
`.env.lead-agent` instead of hard-coding them, so readiness can prove the real
server setting.

The lead-agent source is a private nested repo. Clone or update it on the VPS at:

```txt
/opt/evo-crm/evo-lead-agent
```

The parent CRM repo intentionally ignores that nested checkout; deploy both
repos together before running `docker compose -f docker-compose.prod.yml up -d
--build`.

Use separate shared secrets:

- `WAHA webhook HMAC secret` signs WAHA -> lead-agent webhooks.
- `lead-agent sync secret` signs lead-agent -> CRM internal sync calls.

Store CRM Settings as:

```txt
WA provider: WAHA
WAHA Base URL: http://evo-crm-waha:3000
WAHA session: crm_primary
WAHA webhook URL: http://evo-lead-agent:8000/webhooks/waha
lead-agent sync secret: same value as EVO_AGENT_CRM_SYNC_SECRET
```

Keep the WAHA dashboard/API private. Operators should scan QR only through the
authenticated CRM Settings page, which proxies `/api/waha/qr`.

Official integration behavior checked for this rollout:

- Google Gemini API docs require an API key and document
  `gemini-3.5-flash` as a Gemini model usable from the Python SDK:
  `https://ai.google.dev/gemini-api/docs/api-key` and
  `https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5`.
- WAHA docs receive inbound messages through webhook events such as `message`
  and support session webhook configuration with HMAC signing:
  `https://waha.devlike.pro/docs/how-to/receive-messages/` and
  `https://waha.devlike.pro/docs/overview/changelog/`.

Before issue #5 live proof, run the lead-agent gates on the VPS:

```bash
cd /opt/evo-crm
docker compose -f docker-compose.prod.yml exec lead-agent \
  evo-lead-agent-env-audit --db /app/data/evo-lead-agent.db --pretty
docker compose -f docker-compose.prod.yml exec lead-agent sh -lc '
  evo-lead-agent-waha-setup \
    --base-url "$EVO_AGENT_WAHA_BASE_URL" \
    --api-key "$EVO_AGENT_WAHA_API_KEY" \
    --session "$EVO_AGENT_WAHA_SESSION" \
    --webhook-url "$EVO_AGENT_WAHA_WEBHOOK_URL" \
    --webhook-secret "$EVO_AGENT_WAHA_WEBHOOK_SECRET" \
    --qr-output /app/data/waha-crm-primary-qr.png \
    --pretty
'
docker compose -f docker-compose.prod.yml exec lead-agent \
  evo-lead-agent-preflight --db /app/data/evo-lead-agent.db --pretty
```

Run these commands inside the `lead-agent` container because `/app/data` and
the private Docker DNS names (`evo-crm-waha`, `evo-lead-agent`, and
`evo-crm-app`) are container-network paths, not VPS host paths. The production
image installs the `evo-lead-agent-*` console scripts directly; it does not
require `uv` inside the container.

The env audit and preflight must name missing inputs exactly, for example
`EVO_AGENT_WAHA_API_KEY`, `EVO_AGENT_AMO_CLIENT_ID`,
`EVO_AGENT_CRM_SYNC_SECRET`, `GEMINI_API_KEY or GOOGLE_API_KEY or
EVO_AGENT_GEMINI_API_KEY`, or `EVO_AGENT_ADMIN_API_KEY`. A receive-only ready
report is not outbound readiness; outbound remains blocked until
`live_whatsapp_outbound` is intentionally approved in a later issue.

## DNS

Create this public DNS record before expecting HTTPS to validate:

```txt
crm.evoadmissions.com.  A  72.62.119.112
```

## Transcription Lab

The CRM deploys the transcription UI, but local MLX transcription is disabled in
production by default because the VPS is Ubuntu and the MLX worker is not
provisioned there. Keep `EVO_ENABLE_LOCAL_TRANSCRIPTION=0` unless a real Linux
worker path is added and verified.
