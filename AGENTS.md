# AGENTS.md

## How To Work In This Repo

- Treat this repo as the production EVO Admissions CRM workspace.
- Treat GitHub as the latest shared source of truth for code, migrations,
  docs, runbooks, issues, and PR state. Push reviewed repo changes promptly
  after validation so local/VPS worktrees do not become private sources of
  truth.
- Analyze current repo state and deployment context before editing. Use
  `rg`/targeted reads first; do not guess from memory.
- For integrations, architecture, external APIs, or "do it properly" requests,
  verify current official docs first and cite the researched behavior in docs or
  implementation notes.
- For medium/large work, use launch-control: keep `docs/EVO_LAUNCH_PLAN.md` as
  the implementation contract and append architecture/scope changes to
  `docs/PLAN_CHANGES.md` before coding.
- Do not claim live WhatsApp, amoCRM, Anthropic, telephony, or deployment
  success unless the real service was exercised with real credentials.
- If real credentials/services are missing, fail clearly and name the exact
  blocker.
- Do not hardcode credentials, WhatsApp session data, customer personal data,
  amoCRM tokens, WAHA API keys, Anthropic keys, or server secrets.
- Keep real runtime secrets only in ignored `.env*` files, VPS secret files,
  provider dashboards, or encrypted application settings; commit only safe
  examples such as `.env.example` and documented placeholder values.
- Keep WAHA, the lead-agent, and their dashboards/APIs private unless explicit
  authenticated public access is added.

## Local Container Runtime

- On macOS, use OrbStack as the only allowed local container runtime for this
  repository. Do not use Docker Desktop, Colima, Rancher Desktop, or another
  local Docker engine for EVO builds, tests, Compose stacks, Supabase, or
  disposable databases.
- Before any local `docker`, `docker compose`, or container-backed Supabase
  command, verify `orb status` reports `Running` and `docker context show`
  returns exactly `orbstack`. If OrbStack is stopped, start it with
  `orb start`, select it with `docker context use orbstack`, and verify both
  checks again before continuing.
- Fail closed if the OrbStack preflight does not pass. Never fall back to
  `desktop-linux`, `default`, or another container context, and do not claim
  local container validation unless it ran on OrbStack.
- This policy applies only to local macOS execution. It does not change the
  remote Docker Compose runtime on `hermes-vps`.

## Production Server

- Target server: `hermes-vps` (`root@72.62.119.112` via SSH config).
- Target path: `/opt/evo-crm`.
- Public CRM URL: `https://crm.evoadmissions.com`.
- Fallback URL in Caddy: `https://evo-crm.72.62.119.112.sslip.io`.
- Production runs with `docker compose -f docker-compose.prod.yml` as project
  `evo-crm`.
- The app container is `evo-crm-app-1`, image `evo-crm:latest`, private network
  alias `evo-crm-app:3000`.
- Public EVO routes should be served by `evo-edge-caddy` on `evo_public_web`,
  not by `/opt/acadis` or any `acadis_*` Docker network.
- Do not introduce new EVO dependencies on the `acadis_*` Docker networks;
  Arcadis/acadis is a separate project boundary. EVO services should use their
  own Compose projects and neutral EVO-owned proxy/network names.

## EVO Inbox Companion Boundary

- Target path: `/opt/evo-inbox`.
- Public companion URL: `https://inbox.evoadmissions.com`.
- Compose project: `evo-inbox`.
- Public edge/proxy network: `evo_public_web`.
- Public edge proxy: `evo-edge-caddy`, configured from
  `agent-lead2-inbox/deploy/docker-compose.edge.yml` and
  `agent-lead2-inbox/deploy/Caddyfile.evo-edge`.
- `acadis-caddy-1` is not an EVO edge dependency. If it owns `80/443`, archive
  or stop the Acadis stack and move public routes onto `evo-edge-caddy`.
- Private WAHA service: `evo-inbox-waha`, reachable only on the companion
  Compose private network at `http://evo-inbox-waha:3000`.
- First-launch WAHA session: `evo-inbox`.
- Do not reuse `/opt/evo-crm`, `evo-crm-waha`, `crm_primary`, or the lead-agent
  webhook path for the companion app. EVO Inbox owns its own WAHA webhook at
  `/api/waha/webhook`, its own HMAC secret, and its own encrypted WAHA settings.
- Do not publish WAHA ports publicly. Operator access to WAHA QR/dashboard must
  use a private server-side path such as SSH tunnel or an authenticated internal
  admin surface.

## WhatsApp And Lead-Agent Boundary

- This section describes the existing production CRM/lead-agent path, not the
  EVO Inbox companion app.
- WAHA is a private Compose service, not a public port.
- CRM-to-WAHA base URL: `http://evo-crm-waha:3000`.
- The lead-agent owns WAHA inbound automation:
  `http://evo-lead-agent:8000/webhooks/waha`.
- The CRM legacy WAHA webhook route may remain for compatibility, but new WAHA
  session configuration should point at the lead-agent private webhook.
- The lead-agent resolves/creates amoCRM contact and lead first, then posts a
  signed internal sync event to:
  `http://evo-crm-app:3000/api/internal/lead-agent/whatsapp`.
- amoCRM is the source of truth for lead/contact identity and sales status.
- EVO CRM is the staff/operator UI and stores local shadow fields such as
  `amo_lead_id`, `amo_contact_id`, and `agent_state`.
- Store `WAHA_API_KEY=sha512:<hash>` in `/opt/evo-crm/.env.waha`; store the
  plain WAHA API key only in encrypted CRM settings and `.env.lead-agent`.
- Use separate secrets for WAHA webhook HMAC and lead-agent-to-CRM sync HMAC.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `izzhackt/evo_AI_CRM` using the `gh` CLI authenticated with a PAT; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: read root `CONTEXT.md` and root `docs/adr/` when they exist. See `docs/agents/domain.md`.
