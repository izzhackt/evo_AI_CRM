# EVO Inbox Companion

EVO Inbox Companion is the first EVO-owned WhatsApp admissions inbox workspace
derived from the MIT-licensed WACRM base. It lives inside
`izzhackt/evo_AI_CRM` at `agent-lead2-crmwhatsapp/` and is intentionally
separate from the current EVO Admissions CRM runtime.

## Source And License

- Upstream source: `https://github.com/ArnasDon/wacrm`
- Vendored commit: `274db1c7ce42540f989ab3f3f069d1ce7166855a`
- Upstream license: MIT, preserved in `LICENSE`

The package identity is now EVO-owned, but the WACRM MIT notice remains intact.

## First-Launch Scope

Active first-launch surfaces are the EVO Inbox shell, contacts, pipeline context,
AI draft/knowledge-base configuration, account settings, and supporting
read-only dashboards.

The following WACRM surfaces are intentionally disabled for first launch:

- Meta Cloud API setup and verification
- Meta templates and template sync/submission
- Broadcasts and public broadcast API
- Broad automations and automation cron/engine paths
- Flow-driven sending and flow cron/activation paths
- AI auto-reply

Disabled runtime paths fail closed with `410` and
`error: "first_launch_disabled"`. This is intentional product pruning, not a
missing configuration state.

Managed Supabase schema, environment, RLS, and validation workflow notes live in
`docs/supabase-managed-store.md`. This repo keeps the companion migrations with
the app and stores only companion data plus amoCRM shadow identifiers in
Supabase; amoCRM remains the canonical identity and sales-state system.

WAHA is the active first-launch WhatsApp transport boundary. Account admins save
the WAHA base URL, session name, API key, and webhook HMAC secret through the
WhatsApp WAHA settings panel. Public fields are stored in
`integration_settings.public_config`; the API key and HMAC secret are encrypted
in `integration_secrets`. The default session is `evo-inbox`, manual text
sending uses WAHA `POST /api/sendText` with `{ session, chatId, text }`, and
WAHA `session.status` webhooks are accepted only at `/api/waha/webhook` with a
valid `X-Webhook-Hmac` sha512 signature.

amoCRM identity resolution is implemented as a narrow server-side boundary.
amoCRM credentials and token material are encrypted in `integration_secrets`;
non-secret account/pipeline settings live in `integration_settings`. The first
scope resolves by phone, creates missing contacts/leads through amoCRM API v4
when configured, and stores only `amo_contact_id` / `amo_lead_id` shadow fields
locally. If amoCRM configuration or provider calls fail, identity-dependent
writes fail clearly instead of presenting a local-only lead as real.

Live WAHA, live amoCRM, live AI provider validation, DNS, Caddy, and VPS
deployment are not claimed unless real credentials and real provider responses
were exercised.

## Local Commands

Run commands from this folder:

```bash
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
```

`npm ci --include=dev` is the install command for local validation because this
VPS npm config omits dev dependencies by default, while lint/typecheck/test
require the dev toolchain.

Production review artifacts for `inbox.evoadmissions.com` live in
`deploy/`, with the deployment preflight notes in
`docs/hermes-vps-deployment.md` and the issue #20 real proof checklist in
`docs/production-proof-checklist.md`.
