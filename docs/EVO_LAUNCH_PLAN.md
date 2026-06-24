# EVO Launch Plan

Status: contract v0, created 2026-06-24 in the workspace timezone.

This document is the execution contract for launch-control work in this repo.
Implementation lanes are blocked until this plan and `docs/PLAN_CHANGES.md` are
reviewed and merged. If scope, architecture, acceptance criteria, file
ownership, or merge order changes, update `docs/PLAN_CHANGES.md` before coding.

## Goal Slice

Current slice: `/goal-qa-launch`.

Deliverables for this slice:

- Run a fresh-browser QA pass at desktop and mobile viewports covering login,
  role routing, staff CRM, student portal, integration truthfulness,
  prepared-versus-live AI boundaries, i18n switching, responsive layout,
  security/secret handling, validation/build readiness, and presentation demo
  clarity.
- Capture meaningful local screenshots and record their paths in a QA report
  without committing large generated binaries unless the repo adds an artifact
  convention.
- Score one checklist across passes, improve only the weakest safe area inside
  release/presentation readiness scope, and rerun the full flow after any
  change.
- Name missing WhatsApp, telephony, amoCRM, or Anthropic credentials as
  `not_configured` or blockers. Do not claim live integration success without
  real provider credentials and responses.
- Preserve the prepared AI boundary: prepared responses may be used for the
  first presentation only as labeled prepared content and never as live
  Anthropic success.
- Run real repo validation after the QA pass, or record the exact blocker.
- Commit only this slice with a Conventional Commit.
- Request independent code-reviewer approval before merge.

Out of scope for this slice:

- Redoing admissions CRM.
- Redoing student portal.
- Rebuilding amoCRM architecture.
- WhatsApp, telephony, amoCRM, or Anthropic integration changes except copy or
  status clarity that prevents fake/demo success claims.
- Claiming live WhatsApp, telephony, amoCRM, or Anthropic success without real
  credentials and provider responses.
- Unauthenticated amoCRM webhook mutations.
- Prepared-response AI workflow redesign.
- Role model redesign or broad authentication/authorization changes.
- New database migration framework.
- Deployment.

## Execution Rules

- Use the real repo stack and real execution paths.
- Do not claim integration success from mocks, fallback paths, demo modes, sample
  payloads, or synthetic data.
- If a real service or credential is unavailable, the lane must fail clearly and
  name the missing input.
- Prepared AI responses are allowed only for the first presentation because the
  user explicitly requested them. They must not be represented as live Anthropic
  integration success.
- Keep each future lane small enough for review and tied to one mergeable block.
- Every future implementation block needs independent code-reviewer approval
  before merge.

## Repository Snapshot

The current repo is a Next.js App Router application for an education CRM.
Primary stack observed in `package.json`:

- Next.js `16.2.9`
- React `19.2.4`
- TypeScript `^5`
- Tailwind CSS `^4`
- ESLint `^9` with `eslint-config-next`
- SQLite through `better-sqlite3`
- Anthropic TypeScript SDK `@anthropic-ai/sdk`

Important source areas:

- `src/app/`: App Router pages, layouts, and route handlers.
- `src/app/api/ai/*/route.ts`: AI draft and client summary endpoints.
- `src/app/api/webhooks/*/route.ts`: WhatsApp and telephony webhook endpoints.
- `src/lib/db.ts`: SQLite schema bootstrap, seed data, settings, password hash
  helpers, and database access.
- `src/lib/auth.ts`: HTTP-only cookie session handling.
- `src/lib/actions.ts`: Server Actions for auth, CRM operations, WhatsApp send,
  settings, and locale.
- `src/lib/ai.ts`: Anthropic client and prompt execution.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API send/receive integration.
- `src/lib/queries.ts`: read models for dashboard, CRM, WhatsApp, calls, and
  portal views.

## Research Summary

Research was checked on 2026-06-24 against current local and online sources:

- Local Next.js docs in `node_modules/next/dist/docs/` were inspected as required
  by `AGENTS.md`, including App Router route handlers, environment variables, and
  the production checklist.
- Context7 official Next.js docs for `/vercel/next.js/v16.2.9` confirm route
  handlers live under `app/**/route.ts`, supported HTTP methods are exported
  functions, `next build` is the production build gate, and `next typegen && tsc
  --noEmit` is the documented route/type validation path.
- Context7 official Anthropic TypeScript SDK docs confirm server-side SDK usage
  through `client.messages.create`, API-key configuration, and message arrays as
  the real request path. Launch validation must use a real configured API key or
  explicitly report `not_configured`.
- Context7 `better-sqlite3` docs confirm direct database opening, prepared
  statements, PRAGMA usage, transactions, and WAL mode as normal production
  patterns for SQLite-backed Node.js apps.
- amoCRM's current developer docs describe `/api/v4/leads` as the deal endpoint
  with pipeline/status IDs, responsible user IDs, custom field values, and
  embedded contacts/companies; `/api/v4/contacts` carries contact custom field
  values; OAuth access and refresh tokens come from `POST /oauth2/access_token`.
- The existing README describes demo accounts, WhatsApp demo mode, IP telephony
  webhooks, client portal, multilingual UI, SQLite backup, and Anthropic-powered
  AI features. Those claims must be verified against the actual app before any
  production or sales-readiness claim.

Current risk surfaced by repo inspection:

- The repo has demo accounts and seeded demo data in `src/lib/db.ts`.
- `src/lib/auth.ts` has a development fallback `AUTH_SECRET`.
- `src/lib/whatsapp.ts` must not return a `demo` send status when WhatsApp
  credentials are missing; missing credentials must produce a visible failed
  send state rather than fake delivery success.
- README must not say missing WhatsApp keys use demo mode. Prepared AI text is
  acceptable only for explicitly labeled presentation behavior, not production
  launch or delivery success.
- AI routes depend on live Anthropic configuration and should fail as
  `not_configured` when no key exists.
- There is currently no explicit `typecheck` script and no test script in
  `package.json`.
- `npm audit --audit-level=moderate` currently fails on an existing PostCSS XSS
  advisory reached through Next.js. The suggested `npm audit fix --force` would
  install an incompatible Next.js downgrade, so this must be handled in a future
  security or dependency lane, not hidden inside this docs-only slice.
- `npm run build` passes after local dependency repair, but Next.js warns that it
  inferred the workspace root from `/Users/iskhak.tazhibaev/package-lock.json`
  because another lockfile exists above the repo. A future config lane should
  either set the documented Turbopack root or remove the stray parent lockfile.

## Acceptance Criteria

### This QA Launch Readiness Slice

- `docs/PLAN_CHANGES.md` has an append-only `/goal-qa-launch` entry before
  runtime or test coding because this lane changes active scope, acceptance
  criteria, file ownership, merge-order status, and validation evidence.
- `docs/QA_LAUNCH_REPORT.md` records the QA method, scored checklist, desktop
  and mobile screenshots paths, pass/fail evidence, changes made, validation
  output, stop reason, and named blockers.
- Browser QA starts from a fresh context with no saved login, cookies, or site
  data, then covers login and critical staff/client flows at 1440x900 and
  390x844 or comparable desktop/mobile sizes.
- The single checklist scores auth/role routing, staff CRM flow, student portal
  flow, integration truthfulness, AI/prepared boundary, i18n/language switching,
  responsive layout, security/secret handling, validation/build readiness, and
  presentation demo clarity.
- Any implementation change is limited to launch-blocking bug fixes, blocker or
  prepared/live copy clarity, validation/scenario coverage, QA report/runbook
  documentation, or small UI polish needed for critical flows.
- Missing WhatsApp, telephony, amoCRM, and Anthropic credentials are reported as
  explicit `not_configured` / `blocked` states or blockers, never as demo or
  hidden mock success.
- Existing staff CRM, student portal, amoCRM settings/status, WhatsApp,
  telephony, and AI boundaries continue to build and smoke successfully after
  the changes.
- Validation is run through the real repo commands for this slice:
  `node node_modules/eslint/bin/eslint.js .`,
  `node node_modules/next/dist/bin/next typegen`,
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/next/dist/bin/next build`, `npm run scenarios`, fresh
  browser QA rerun, and `npm audit --audit-level=moderate`.
- Pre-commit security audit is run with `npm audit --audit-level=moderate`; any
  existing advisory is documented rather than bypassed.
- The QA launch commit uses a Conventional Commit message.
- An independent code-reviewer reviews the QA launch diff and evidence against
  this goal before merge and returns `approved` or `changes_requested`.

### Launch Acceptance

The app is launch-ready only when all items below are true and evidenced:

- Auth: no production deployment uses default secrets, demo passwords, or
  unlabeled seeded demo accounts.
- Database: SQLite file path, WAL behavior, schema bootstrap, backup/restore, and
  seed policy are documented and verified on the real runtime target.
- CRM core: staff login, dashboard, sales pipeline, lead-to-client conversion,
  client profile, tasks, finance, reports, and client portal complete real flows
  against the real SQLite database.
- WhatsApp: Cloud API credentials and webhook verification are configured against
  Meta's real service, or the feature is visibly blocked. A `demo` status cannot
  be counted as send success.
- Telephony: webhook authentication and payload handling are validated against a
  real provider configuration or blocked with the missing provider named.
- AI: draft and summary endpoints run through the real Anthropic SDK with a real
  key, or return clear `not_configured`. Prepared responses may be used only in
  the first presentation and must be labeled as prepared content.
- Security: server inputs are schema-validated at API and Server Action
  boundaries, sensitive errors are not leaked, secrets are only environment or
  settings values, and role checks match the feature surface.
- UI: production-critical pages render without broken layout at desktop and
  mobile widths, with Russian/Kyrgyz/English locale switching preserved.
- Validation: lint, typecheck, build, and critical real E2E flows pass. Any
  unavailable credential or external system is a named blocker, not a fake pass.

## File Ownership

Planning and governance:

- `docs/EVO_LAUNCH_PLAN.md`: launch contract owner. Changes require a
  corresponding entry in `docs/PLAN_CHANGES.md` after this slice lands.
- `docs/PLAN_CHANGES.md`: append-only change log. Never rewrite prior entries.

Application architecture:

- `src/app/(staff)/**`: staff-facing CRM pages and navigation.
- `src/app/portal/**`: client portal experience.
- `src/app/login/**`, `src/app/register/**`, `src/app/page.tsx`: auth entry and
  role routing.
- `src/app/api/ai/**`: Anthropic-backed AI endpoints.
- `src/app/api/webhooks/**`: external webhook boundaries.
- `src/components/**`: shared UI and client components.
- `src/lib/db.ts`: schema, connection, seed, settings, password hashing.
- `src/lib/auth.ts`: session token signing and current user resolution.
- `src/lib/actions.ts`: Server Action mutations.
- `src/lib/queries.ts`: read models.
- `src/lib/ai.ts`: Anthropic client and AI generation contract.
- `src/lib/prepared-ai.ts`: deterministic prepared prompt library and response
  scenario generator for the first presentation.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API integration.
- `src/lib/i18n.ts`: locale keys and translations.
- `src/lib/domain.ts`: canonical CRM roles, route map, status values, domain
  entity types, and route access helpers.
- `src/lib/contracts/amo-crm.ts`: amoCRM adapter interface and sync DTOs.
- `src/lib/contracts/student-portal.ts`: client-visible portal contract.
- `src/lib/contracts/prepared-ai.ts`: prepared response boundary for the first
  presentation.
- `src/lib/contracts/index.ts`: public export surface for integration contracts.
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`:
  validation and build configuration.

Future lanes must name their write set before coding. If a lane needs to edit
outside its named ownership area, update `docs/PLAN_CHANGES.md` first.

`/goal-qa-launch` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: current-slice and acceptance update.
- `docs/PLAN_CHANGES.md`: append-only QA launch entry.
- `docs/QA_LAUNCH_REPORT.md`: QA checklist, screenshot paths, validation, stop
  reason, and blockers.
- `docs/SCENARIO_EVALUATION.md`: refreshed only by the required scenario runner
  as validation evidence.
- Runtime, scenario, or copy files only if the QA pass exposes a
  launch-blocking bug, fake-success claim, missing validation evidence, or small
  critical-flow UI issue inside this slice.

## Merge Order

1. `plan-contract`: docs-only launch contract. Blocks implementation lanes.
2. `brand-research`: docs-only product/domain research for copy and education
   flow realism.
3. `architecture-contract`: role, route, entity, amoCRM adapter, student portal,
   and prepared AI contracts.
4. `crm-baseline`: separate runtime baseline commit required so later slices can
   build from a clean checkout without mixing baseline and prepared-AI review.
5. `prepared-ai-prompts`: user-requested first-presentation prepared response
   layer with explicit prepared/live boundaries.
6. `admissions-crm-core`: core staff CRM surfaces for Command Center,
   Admissions Pipeline, Student 360, tasks, documents, applications, and finance
   overview.
7. `student-portal`: first production-quality authenticated student portal over
   the stable student, application, document, payment, task, and update
   contracts.
8. `amocrm-integration`: runtime amoCRM settings/status/adapter foundation with
   truthful configured/not-configured/blocked behavior. Completed before
   `/goal-qa-launch`.
9. `/goal-qa-launch`: combined release/presentation QA readiness lane covering
   validation-baseline, production truthfulness, security/secret checks,
   CRM-core flow verification, real integration blocker recording,
   presentation-readiness evidence, release-readiness reporting, and clean-tree
   final audit without rebuilding feature architecture.

Each lane must be merged or intentionally abandoned before the next lane starts.

## Required Validation Commands

Current baseline commands for this repo:

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
npm run scenarios
npm audit --audit-level=moderate
```

Future implementation lanes should add real integration and E2E checks to this
list rather than replacing these gates.

## Stop Conditions

Stop and escalate when:

- Required real credentials, provider accounts, data, or deployment targets are
  missing.
- A lane would need hidden mocks, demo paths, or fake success to pass.
- Scope, architecture, acceptance criteria, file ownership, or merge order needs
  to change and `docs/PLAN_CHANGES.md` has not been updated first.
- Independent reviewer approval is unavailable and the user has not explicitly
  waived the launch-control gate.
- Validation fails for reasons outside the lane's scope and cannot be fixed
  without changing the contract.
