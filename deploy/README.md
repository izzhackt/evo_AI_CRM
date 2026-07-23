# EVO CRM Production Deployment

Runtime health/readiness, private-route, resource-limit, correlation-log, and
alert ownership rules are in [runtime-hardening.md](./runtime-hardening.md).

Target server: `hermes-vps`

Existing runtime/secrets path: `/opt/evo-crm`

Clean release path: `/opt/evo-releases/<full-main-sha>/repo`

The app runs as Docker Compose project `evo-crm`. Its public app joins
`evo_public_web` at `evo-crm-app:3000`; CRM WAHA and the lead-agent communicate
only on `evo_crm_private`.

Use [production-release.md](production-release.md) for every production
release. It pins one reviewed `main` SHA in a clean detached worktree, keeps
server secrets outside release source, backs up local state, captures rollback
images/configuration, and deploys one service boundary at a time.

## Required Environment

Keep these existing server files outside the detached release worktree:

- `/opt/evo-crm/.env.production`
- `/opt/evo-crm/.env.waha`
- `/opt/evo-crm/.env.lead-agent`

Create them from the matching safe examples when provisioning a new server.
Generate secrets on the server:

```bash
openssl rand -base64 48
openssl rand -base64 32
```

Do not commit or print the real values.

## Bootstrap First Admin

Run once after the app container is healthy:

```bash
read -r -s -p 'Initial admin password: ' EVO_ADMIN_PASSWORD
printf '\n'
export EVO_ADMIN_PASSWORD
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" exec \
  -e EVO_ADMIN_EMAIL='admin@example.com' \
  -e EVO_ADMIN_PASSWORD \
  -e EVO_ADMIN_NAME='EVO Admin' \
  app node scripts/bootstrap-admin.mjs
unset EVO_ADMIN_PASSWORD
```

## Backup

The release runbook requires both the application SQLite logical backup and a
consistent snapshot of CRM data, backups, output, WAHA sessions, lead-agent
data, Inbox WAHA sessions, and Caddy state before deployment. The normal
logical backup is written to the `evo_crm_backups` Docker volume.

## EVO Edge Caddy

Public EVO traffic is owned by `evo-edge-caddy`, not by a Caddy container or
network from another project. The canonical edge definitions are:

- `agent-lead2-inbox/deploy/docker-compose.edge.yml`
- `agent-lead2-inbox/deploy/Caddyfile.evo-edge`

Both `evo-edge-caddy` and the CRM app must join the external
`evo_public_web` network. Ensure `/opt/evo-crm/.env.production` contains this
exact value before starting or recreating the CRM:

```dotenv
EVO_CADDY_NETWORK=evo_public_web
```

Create the shared network once if it does not exist:

```bash
docker network inspect evo_public_web >/dev/null 2>&1 \
  || docker network create evo_public_web
```

CRM internal traffic uses a separate pre-provisioned bridge. It has no
published host ports; declaring it `external` in Compose only keeps Compose from
trying to recreate a bridge that live containers must join before rollout:

```bash
docker network inspect evo_crm_private >/dev/null 2>&1 \
  || docker network create evo_crm_private
```

`deploy/Caddyfile.evo-crm` is a CRM-only reference snippet. The combined
`Caddyfile.evo-edge` is the production source for both CRM and Inbox public
routes, the existing Invite Bishkek and legacy Inbox fallback routes, and the
Codex route. Follow the release runbook to validate the candidate before
reconciling the edge and to perform a graceful Caddy reload. Do not attach EVO
services to an `acadis_*` network and do not run a second public proxy for EVO.

Verify fallback routes after the reload:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://evo-crm.72.62.119.112.sslip.io/login
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://evo-inbox.72.62.119.112.sslip.io/api/health
```

Check `crm.evoadmissions.com` and `inbox.evoadmissions.com` separately as DNS
gates. Do not report either canonical URL as working until it resolves to the
VPS and its HTTPS request succeeds.

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

The lead-agent source is tracked by the parent `izzhackt/evo_AI_CRM` repo under:

```txt
$EVO_RELEASE_REPO/evo-lead-agent
```

Do not clone `nik1t7n/kanttsp-lead-agent` into this path for EVO production.
Build the parent repository's exact reviewed main SHA using the release
runbook, which includes the EVO-specific lead-agent source.

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
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" exec lead-agent \
  evo-lead-agent-env-audit --db /app/data/evo-lead-agent.db --pretty
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" exec lead-agent sh -lc '
  evo-lead-agent-waha-setup \
    --base-url "$EVO_AGENT_WAHA_BASE_URL" \
    --api-key "$EVO_AGENT_WAHA_API_KEY" \
    --session "$EVO_AGENT_WAHA_SESSION" \
    --webhook-url "$EVO_AGENT_WAHA_WEBHOOK_URL" \
    --webhook-secret "$EVO_AGENT_WAHA_WEBHOOK_SECRET" \
    --qr-output /app/data/waha-crm-primary-qr.png \
    --pretty
'
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" exec lead-agent \
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
