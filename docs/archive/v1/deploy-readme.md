# HISTORICAL V1 ONLY — DO NOT EXECUTE

This file preserves the superseded multi-runtime V1 deployment notes. Its
commands are rollback/decision evidence only and are not valid V2 instructions.
Use `deploy/README.md` and `deploy/production-release.md` for the successor.

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
`WAHA_API_KEY=sha512:<hash>`. The forward Platform manual-send adapter keeps the
plain key only in its Supabase Vault runtime binding, provisioned through the
current server-only operator command. Do not copy it into CRM Settings or the
frozen Lead Agent environment.

Create `/opt/evo-crm/.env.lead-agent` from `deploy/env.lead-agent.example`.
This file now describes only the retained, frozen rollback service. It is not a
future WAHA webhook owner and must not contain the Platform ingress HMAC secret.
Keep these fail-closed values:

```txt
EVO_AGENT_WAHA_SESSION=evo-inbox
EVO_AGENT_WAHA_WEBHOOK_SECRET=
EVO_AGENT_WAHA_WEBHOOK_URL=
EVO_AGENT_FROZEN=true
EVO_AGENT_WORKER_ENABLED=false
EVO_AGENT_AUTOREPLY_ENABLED=false
EVO_AGENT_OUTBOUND_ENABLED=false
```

The target boundary is the server-managed EVO Platform route
`/api/internal/platform-messaging/waha/events` with exact session `evo-inbox`.
It uses the separate `EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET`; never copy or
reuse that secret in `EVO_AGENT_WAHA_WEBHOOK_SECRET`. Keep Platform ingress
disabled until a separately authorized cutover provisions and verifies the
real provider configuration.

The lead-agent source is tracked by the parent `izzhackt/evo_AI_CRM` repo under:

```txt
$EVO_RELEASE_REPO/evo-lead-agent
```

Do not clone `nik1t7n/kanttsp-lead-agent` into this path for EVO production.
Build the parent repository's exact reviewed main SHA using the release
runbook, which includes the EVO-specific lead-agent source.

Do not configure WAHA from legacy CRM Settings or the Lead Agent CLI. The
fixture page is read-only for WhatsApp, and `evo-lead-agent-waha-setup` exits
with `lead_agent_waha_setup_retired` without calling WAHA. Keep the WAHA
dashboard/API private; real QR/session work requires a separately authorized
server-side cutover procedure.

Official integration behavior checked for this rollout:

- Google Gemini API docs require an API key and document
  `gemini-3.5-flash` as a Gemini model usable from the Python SDK:
  `https://ai.google.dev/gemini-api/docs/api-key` and
  `https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5`.
- WAHA docs receive inbound messages through webhook events such as `message`
  and support session webhook configuration with HMAC signing:
  `https://waha.devlike.pro/docs/how-to/receive-messages/` and
  `https://waha.devlike.pro/docs/overview/changelog/`.

Do not use Lead Agent env audit, preflight, or setup output as proof that the
Platform webhook is ready. Those commands describe the retained contour; the
setup command is intentionally retired. A future live proof must separately
verify the enabled Platform ingress, its dedicated HMAC secret, canonical
Supabase persistence, exact `evo-inbox` provider session and operator-visible
projection. Repository configuration alone is not provider proof.

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
