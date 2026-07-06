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

WAHA, managed Supabase provisioning, amoCRM identity resolution, live AI provider
validation, DNS, Caddy, and VPS deployment are later implementation issues. This
slice does not claim live provider or deployment success.

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
