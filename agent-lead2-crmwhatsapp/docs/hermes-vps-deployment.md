# EVO Inbox hermes-vps deployment preflight

This is review configuration for `inbox.evoadmissions.com`. It must not be
deployed from a dirty workstation, and this run does not touch `/opt/evo-crm`.

## Source contract

- GitHub remains the source of truth.
- Target service name: `evo-inbox`.
- Target path: `/opt/evo-inbox`.
- Target public host: `https://inbox.evoadmissions.com`.
- Caddy reverse-proxy target: `evo-inbox-app:3000`.
- Caddy Docker network: `${EVO_CADDY_NETWORK:-evo_public_web}`. This must be an EVO-owned neutral edge network, not an `acadis_*` project network.
- Private WAHA service: `evo-inbox-waha`, reachable from the companion app at
  `http://evo-inbox-waha:3000`.
- WAHA stays private on the companion Compose network. Do not add public
  `ports:` for WAHA.

The Next.js container uses `output: "standalone"`. Per the official Next.js
standalone output docs, `.next/standalone` contains the minimal server, while
`public` and `.next/static` must be copied into the runtime image for
`server.js` to serve assets:
https://nextjs.org/docs/pages/api-reference/config/next-config-js/output

## Review artifacts

- `Dockerfile`
- `deploy/docker-compose.inbox.prod.yml`
- `deploy/Caddyfile.inbox.evoadmissions.com`
- `deploy/env.production.example`
- `deploy/env.waha.example`
- `scripts/preflight-prod.mjs`

## Required runtime env

Set these on the target host in `.env.production`; do not commit real values.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL, `https://inbox.evoadmissions.com`. |
| `EVO_INBOX_DOMAIN` | Expected DNS/Caddy hostname, `inbox.evoadmissions.com`. |
| `EVO_CADDY_NETWORK` | Docker network shared with Caddy, normally `evo_public_web`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase companion project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key. |
| `ENCRYPTION_KEY` | 64 hex chars for encrypted integration and AI secrets. |

WAHA, amoCRM, and AI provider secrets are account-level settings stored
encrypted in Supabase. The private WAHA container stores only
`WAHA_API_KEY=sha512:<hash>` in `.env.waha`; the plain WAHA key is stored only
in encrypted EVO Inbox settings and, for the proof run, in `.env.production` as
`EVO_INBOX_WAHA_API_KEY`. For the proof run only, the preflight script also
checks `EVO_INBOX_WAHA_BASE_URL`, `EVO_INBOX_WAHA_API_KEY`,
`EVO_INBOX_WAHA_WEBHOOK_HMAC`, `EVO_INBOX_AMOCRM_BASE_URL`,
`EVO_INBOX_AMOCRM_ACCESS_TOKEN`, and either `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY`.

## Preflight commands

Run from `agent-lead2-crmwhatsapp/` after installing dependencies:

```bash
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

## Deployment outline

Only perform this after a reviewed PR is merged and real credentials are
available:

1. Fetch the reviewed commit on `hermes-vps` into `/opt/evo-inbox`.
2. Create `.env.production` from `deploy/env.production.example`.
3. Create `.env.waha` from `deploy/env.waha.example`.
4. Confirm DNS for `inbox.evoadmissions.com` points at the VPS.
5. Add `deploy/Caddyfile.inbox.evoadmissions.com` to the EVO-owned edge proxy
   config, with that proxy attached to `EVO_CADDY_NETWORK`.
6. Start the service with
   `docker compose -f deploy/docker-compose.inbox.prod.yml up -d --build`.
7. Confirm both `evo-inbox` app and `evo-inbox-waha` healthchecks pass.
8. Execute the issue #20 live proof checklist.
