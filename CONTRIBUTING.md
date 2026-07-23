# Contributing to EVO Admissions Platform

This is the working guide for EVO team members and approved collaborators. The
repository contains production software, infrastructure definitions, and
business documentation, so every change must be reviewable and reproducible.

## Understand The Source Of Truth

- GitHub `main` is the shared source of truth for reviewed code, migrations,
  documentation, and runbooks.
- GitHub Issues records work status and decisions that require action. Do not
  keep the only copy of a task in a local note or chat.
- The VPS is a runtime, not a development source. Do not make an untracked fix
  directly in `/opt/evo-crm` or `/opt/evo-inbox` and leave it there.
- Production data stays in its owning system. Do not copy customer records,
  WhatsApp sessions, database files, or provider secrets into Git.

Before changing an area, read:

1. [`AGENTS.md`](./AGENTS.md) for repository and production boundaries.
2. [`CONTEXT.md`](./CONTEXT.md) and the relevant records in
   [`docs/adr/`](./docs/adr/) for domain vocabulary and architecture decisions.
3. [`docs/EVO_LAUNCH_PLAN.md`](./docs/EVO_LAUNCH_PLAN.md) and
   [`docs/PLAN_CHANGES.md`](./docs/PLAN_CHANGES.md) for the current
   implementation contract.
4. The GitHub Issue that defines the change and its acceptance criteria.

For a medium or large change, update the launch plan and append any change to
scope, architecture, ownership, or merge order to `docs/PLAN_CHANGES.md`
before coding.

## Repository Map

- `src/`, `tests/`, and the root `package.json`: EVO Admissions CRM.
- `agent-lead2-inbox/`: EVO Inbox companion application.
- `evo-lead-agent/`: WhatsApp lead-agent service.
- `deploy/`, `docker-compose.prod.yml`, and
  `agent-lead2-inbox/deploy/`: production deployment definitions.
- `docs/`: product, architecture, operations, and business documentation.

Each application has its own dependencies and validation commands. Install and
run commands from the directory that owns the relevant package file.

## Prepare A Local Workspace

Clone the repository, switch to the Node version declared by the root project,
and install exact locked dependencies:

```bash
git clone https://github.com/izzhackt/evo_AI_CRM.git
cd evo_AI_CRM
nvm use
npm ci
```

Create local environment files only from committed `*.example` files. Replace
placeholders locally, never in a tracked file. Do not use production customer
data to make local development convenient.

For EVO Inbox:

```bash
cd agent-lead2-inbox
cp .env.local.example .env.local
npm ci --include=dev
```

For the lead agent:

```bash
cd evo-lead-agent
uv sync --extra dev
```

## Make A Change

1. Start from an up-to-date `main` branch.
2. Claim or create a GitHub Issue before substantial work.
3. Create a short, issue-focused branch. Do not work directly on `main`.
4. Keep one logical change in each pull request.
5. Follow existing code and documentation patterns before adding a new
   abstraction, dependency, or workflow.
6. Preserve unrelated local changes. Never rewrite another contributor's work
   to make your branch look clean.

Commit messages follow Conventional Commits, for example:

```text
feat(inbox): add operator conversation filter
fix(deploy): keep CRM on the EVO edge network
docs: document the admissions data owner map
```

## Validate The Real Change

Run the checks for every area you changed:

### Admissions CRM

```bash
npm run lint
npm run build
```

Run `npm run test:e2e` when a user workflow or browser-visible behavior
changes.

### EVO Inbox

```bash
cd agent-lead2-inbox
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
```

### Lead Agent

```bash
cd evo-lead-agent
uv run ruff check .
uv run pytest
```

Do not claim that WhatsApp, WAHA, amoCRM, Gemini, Supabase, DNS, Caddy, or a
deployment works unless the real authorized service was exercised. If a real
credential or service is unavailable, report the exact blocker instead of
substituting fake data or a simulated success.

## Open A Pull Request

The pull request must state:

- what changed and why;
- the GitHub Issue it resolves or advances;
- exact validation commands and their results;
- screenshots for visible UI changes;
- migration, deployment, privacy, and rollback risks;
- which real integrations were exercised and which remain blocked.

Request review from the code owners. Merge only after the required checks and
review are complete. Deploy reviewed GitHub commits; do not deploy an
uncommitted local or VPS working tree.

## Security And Sensitive Data

Never commit credentials, customer personal data, WhatsApp session material,
amoCRM tokens, WAHA API keys, AI-provider keys, database snapshots, or real
runtime environment files. Follow [`SECURITY.md`](./SECURITY.md) for private
reporting. A suspected vulnerability or exposed secret does not belong in a
normal Issue, pull request, screenshot, or log excerpt.
