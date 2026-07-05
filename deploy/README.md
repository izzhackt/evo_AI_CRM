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
