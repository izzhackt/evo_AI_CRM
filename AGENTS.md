# AGENTS.md

## How To Work In This Repo

- Treat this repo as the production EVO Admissions CRM workspace.
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
- Keep WAHA, the lead-agent, and their dashboards/APIs private unless explicit
  authenticated public access is added.

## Production Server

- Target server: `hermes-vps` (`root@72.62.119.112` via SSH config).
- Target path: `/opt/evo-crm`.
- Public CRM URL: `https://crm.evoadmissions.com`.
- Fallback URL in Caddy: `https://evo-crm.72.62.119.112.sslip.io`.
- Production runs with `docker compose -f docker-compose.prod.yml` as project
  `evo-crm`.
- The app container is `evo-crm-app-1`, image `evo-crm:latest`, private network
  alias `evo-crm-app:3000`.
- Caddy runs in `/opt/acadis` as container `acadis-caddy-1` and reverse proxies
  to `evo-crm-app:3000` on Docker network `acadis_acadis_web`.

## WhatsApp And Lead-Agent Boundary

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
