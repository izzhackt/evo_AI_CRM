# EVO Inbox Remote Codex Long Runs

> [!WARNING]
> **Historical runbook — superseded.** Its branch names, prompts, and workspace
> assumptions describe an earlier implementation phase and must not be used for
> a new run. Start from GitHub `main`, follow `CONTRIBUTING.md` and `AGENTS.md`,
> and use `docs/EVO_LAUNCH_PLAN.md` plus current GitHub Issues for active work.
> This file is retained only as execution-history context.

This runbook is for running long Codex sessions from `hermes-vps` while keeping GitHub as the source of truth.

## Source Of Truth Model

- GitHub repo: `https://github.com/izzhackt/evo_AI_CRM`
- Code/PR/issues source of truth: GitHub
- CRM identity source of truth: amoCRM
- Companion app data store: managed Supabase Cloud
- Production runtime: `hermes-vps`
- Public app URL: `https://inbox.evoadmissions.com`
- First WAHA session: `evo-inbox`

Do not rsync a dirty local working tree into production. Push planning docs and implementation branches to GitHub first, then clone or pull on the server. Use a non-production workspace for Codex implementation runs; only the deployment issue should touch `/opt/evo-crm` or Caddy production config.

Current local planning context was created on `izzhacktcodex/waha-integration`, which is ahead of `main`. Until those commits are merged to `main`, remote Codex runs should start from the pushed planning branch or from a new EVO Inbox branch based on it.

## Recommended Server Workspace Setup

Run on `hermes-vps`:

```bash
mkdir -p /opt/codex-workspaces
cd /opt/codex-workspaces

if [ ! -d evo_AI_CRM ]; then
  git clone https://github.com/izzhackt/evo_AI_CRM.git evo_AI_CRM
fi

cd /opt/codex-workspaces/evo_AI_CRM
git fetch origin

# Use the branch that contains the current launch-plan context.
git checkout izzhacktcodex/waha-integration
git pull --ff-only origin izzhacktcodex/waha-integration

# Create the implementation branch when starting the first run.
git checkout -b izzhacktcodex/evo-inbox-waha-companion
```

If the repo is private and HTTPS auth is not configured on the server:

```bash
gh auth status || gh auth login
gh auth setup-git
```

Before each long run:

```bash
cd /opt/codex-workspaces/evo_AI_CRM
git status --short
git fetch origin
```

After each long run:

```bash
git status --short
git log --oneline -5
```

Push branches and open PRs from the server or let Codex do it when the slice is ready. Do not deploy to production until the deployment issue says to.

## Long Run 1 Prompt: Workspace, WACRM Base, Product Pruning

Use this prompt in a fresh Codex session on `hermes-vps`:

```text
You are working in /opt/codex-workspaces/evo_AI_CRM on branch izzhacktcodex/evo-inbox-waha-companion.

Goal: implement the first EVO Inbox companion slices from docs/EVO_INBOX_COMPANION_PRD.md and docs/EVO_INBOX_IMPLEMENTATION_ISSUES.md:
- issue 1: Vendor WACRM Base And Establish EVO Inbox Workspace
- issue 2: Remove Meta/Bulk-Automation Product Surface For First Launch

Must follow:
- Read AGENTS.md, CONTEXT.md, docs/EVO_INBOX_COMPANION_PRD.md, docs/EVO_INBOX_IMPLEMENTATION_ISSUES.md, docs/EVO_LAUNCH_PLAN.md, docs/PLAN_CHANGES.md, and relevant ADRs before editing.
- Work only in the named slice. Do not implement WAHA, Supabase, amoCRM, AI, or VPS deployment yet except for stubs/docs needed to keep the app buildable.
- Create agent-lead2-crmwhatsapp/ from WACRM under MIT license. Preserve the MIT notice.
- Establish install/lint/typecheck/test/build commands for the companion app.
- Remove or disable active first-launch surfaces for Meta Cloud API, Meta templates, broadcasts, broad automations, flow-driven sending, and auto-reply.
- Do not claim live Meta, WAHA, Supabase, amoCRM, AI, DNS, Caddy, or VPS success.
- Use real commands only. If a command cannot run because dependencies or credentials are missing, report the exact blocker.
- Before coding, append any scope/architecture change to docs/PLAN_CHANGES.md.
- Finish with a concise report: changed files, commands run, blockers, and next issue.

Validation target:
- companion app install command
- companion app lint/typecheck/test/build if available
- parent repo checks only if parent files are touched beyond docs/config

Do not deploy. Do not touch /opt/evo-crm production runtime.
```

## Long Run 2 Prompt: Supabase, WAHA, amoCRM, Inbound/Outbound Core

Use this prompt in a fresh Codex session after Long Run 1 is merged or intentionally continued on the same branch:

```text
You are working in /opt/codex-workspaces/evo_AI_CRM on branch izzhacktcodex/evo-inbox-waha-companion.

Goal: implement the core EVO Inbox backend/product path from docs/EVO_INBOX_COMPANION_PRD.md and docs/EVO_INBOX_IMPLEMENTATION_ISSUES.md:
- issue 3: Bootstrap Managed Supabase Companion Data Store
- issue 4: Add WAHA Session Configuration And Authenticated Webhook Boundary
- issue 5: Resolve Or Create amoCRM Identity For WhatsApp Senders
- issue 6: Deliver Inbound WAHA Message To EVO Inbox With amoCRM Shadow Identity
- issue 7: Send Manual Operator Reply Through WAHA

Must follow:
- Read AGENTS.md, CONTEXT.md, PRD, issue split doc, launch plan, plan changes, and ADRs before editing.
- Use managed Supabase Cloud as the companion data store; do not migrate the existing EVO SQLite CRM.
- Replace active Meta transport code with WAHA for session evo-inbox.
- WAHA webhooks must be authenticated with HMAC and idempotent by message id.
- amoCRM remains the identity source of truth. Resolve or create contact/lead by phone before presenting a real lead. Store only shadow amo_contact_id and amo_lead_id in Supabase.
- Manual outbound send through WAHA is in scope. Auto-reply is not.
- Do not use mocks, demos, sample payload success, or fake provider success. Tests may use local unit fakes only as test doubles, but runtime must fail clearly when real credentials are missing.
- If real Supabase/WAHA/amoCRM credentials are unavailable, implement the real paths and report exact live-validation blockers.
- Append plan changes before changing scope, data model, deployment shape, or acceptance criteria.

Validation target:
- companion app lint/typecheck/test/build
- targeted tests for Supabase schema/RLS boundaries where practical
- targeted tests for WAHA adapter/webhook HMAC/idempotency
- targeted tests for amoCRM resolver success/failure contracts
- targeted tests for manual WAHA send persistence

Do not deploy. Do not claim live service success unless real credentials and responses are exercised.
```

## Long Run 3 Prompt: AI Draft, Full Redesign, Deployment, Production Proof Prep

Use this prompt in a fresh Codex session after the core backend path is merged or stable:

```text
You are working in /opt/codex-workspaces/evo_AI_CRM on branch izzhacktcodex/evo-inbox-waha-companion.

Goal: finish the first-launch EVO Inbox product path from docs/EVO_INBOX_COMPANION_PRD.md and docs/EVO_INBOX_IMPLEMENTATION_ISSUES.md:
- issue 8: Retain AI Draft And Knowledge Base With Auto-Reply Disabled
- issue 9: Fully Redesign Retained Surfaces As EVO Inbox
- issue 10: Add hermes-vps Deployment For inbox.evoadmissions.com
- issue 11: Run Real Companion Production Proof only if real credentials/DNS/server access are available

Must follow:
- Read AGENTS.md, CONTEXT.md, PRD, issue split doc, launch plan, plan changes, and ADRs before editing.
- Keep WACRM's own AI assistant but launch in draft-only mode. Auto-reply remains off/hidden/disabled for first launch.
- Keep OpenAI/Anthropic BYO key behavior; no global hardcoded provider keys.
- Redesign retained surfaces as EVO Inbox: operator inbox, lead profile, amoCRM status, WAHA status, AI draft, knowledge base, readiness/settings. Remove disabled modules from active navigation.
- Follow frontend design rules: dense operator UI, no marketing landing page, no nested cards, stable responsive dimensions, no decorative gradient/orb theme, no text overlap. Verify with browser screenshots when a dev server can run.
- Add hermes-vps deployment config for a separate companion service behind Caddy at inbox.evoadmissions.com. Do not expose WAHA publicly.
- Production proof requires real DNS, Caddy, WAHA, Supabase, amoCRM, and AI provider credentials. If any are missing, stop and name exact blockers.
- Append plan changes before changing scope, deployment shape, data model, or acceptance criteria.

Validation target:
- companion app lint/typecheck/test/build
- browser checks for redesigned desktop/mobile first-launch surfaces
- Docker build for companion service if deployment files are touched
- production preflight only with real credentials
- production proof only with real inbound WhatsApp, real amoCRM identity, real Supabase persistence, real AI draft, and one manual WAHA reply

Do not claim production success from local-only checks.
```
