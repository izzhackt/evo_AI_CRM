# Contributing To EVO Inbox

EVO Inbox is a production component of the private
[`izzhackt/evo_AI_CRM`](https://github.com/izzhackt/evo_AI_CRM) repository. It
is not maintained as a generic WACRM template or as an independent upstream
fork. Start with the repository-level [`CONTRIBUTING.md`](../CONTRIBUTING.md),
then use this guide for Inbox-specific work.

## Product Boundary

EVO Inbox is the operator-facing WhatsApp companion for EVO Admissions. Its
first-launch boundary is deliberately narrow:

- WAHA owns WhatsApp transport through the dedicated `evo-inbox` session.
- managed Supabase stores Inbox application data;
- amoCRM owns lead and contact identity;
- the Inbox AI assistant prepares drafts, while automatic sending remains off;
- broadcasts, bulk automation, and the old Meta-first product surfaces are not
  part of the EVO first launch.

Do not reuse the CRM WAHA session, CRM webhook, CRM database, or lead-agent
secrets. Do not expose WAHA directly to the public internet. Architecture
changes require an ADR or launch-plan change before implementation.

## Local Setup

Run commands from this directory:

```bash
cp .env.local.example .env.local
npm ci --include=dev
npm run dev
```

Fill `.env.local` with authorized development values. Never commit Supabase
service-role keys, encryption keys, WAHA credentials, amoCRM tokens, AI-provider
keys, customer data, or WhatsApp session material.

The application requires real Supabase configuration to exercise its real data
path. If an integration credential is unavailable, keep the failure explicit
and report the missing input; do not create a fake success path.

## Workflow

1. Work from the parent repository and its GitHub Issue tracker.
2. Read the relevant ADRs in `../docs/adr/`, the current launch plan, and
   `docs/hermes-vps-deployment.md` when deployment is involved.
3. Create an issue-focused branch from the reviewed shared baseline.
4. Keep changes within the Issue's acceptance criteria and named write set.
5. Add or update tests for changed behavior.
6. Open a pull request in `izzhackt/evo_AI_CRM`; do not send EVO changes to the
   WACRM upstream project.

For a visible product change, include desktop and mobile evidence. For WAHA,
amoCRM, Supabase, AI, DNS, Caddy, or VPS claims, record the real service and
environment exercised. A local unit test is useful evidence, but it is not a
substitute for a requested live integration proof.

## Required Validation

Run the complete local gate before requesting review:

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
```

When a database migration changes, apply and verify it against the authorized
managed Supabase project named by the Issue. When a production integration
changes, also run the relevant real preflight or proof checklist in `docs/`.
State any credential, provider, DNS, or deployment blocker exactly in the pull
request.

## Pull Request Checklist

- Link the parent GitHub Issue.
- Explain operator-visible behavior and data ownership impact.
- List validation commands and actual results.
- Include screenshots for UI changes.
- Identify new environment values, migrations, deployment steps, and rollback
  risks.
- Confirm that no secrets, customer data, session files, or database exports
  entered the diff.
- Request owner review for deployment, authentication, webhook, encryption, or
  provider-boundary changes.

Report vulnerabilities through the parent repository's private
[`SECURITY.md`](../SECURITY.md) process, never through a normal Issue or pull
request.

## WACRM Provenance And License

EVO Inbox was derived from the MIT-licensed WACRM codebase. Preserve the
existing [`LICENSE`](./LICENSE) file and its attribution in redistributions.
EVO product ownership does not remove the upstream license notice.

Upstream fixes may be reviewed and ported deliberately through a normal EVO
pull request. Do not merge or rebase the WACRM repository wholesale: EVO Inbox
has different product, data, security, and deployment boundaries.
