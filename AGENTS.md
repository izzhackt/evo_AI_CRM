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
- Do not claim live WhatsApp, amoCRM, Gemini, Anthropic, telephony, or deployment
  success unless the real service was exercised with real credentials.
- If real credentials/services are missing, fail clearly and name the exact
  blocker.
- Do not hardcode credentials, WhatsApp session data, customer personal data,
  amoCRM tokens, WAHA API keys, Gemini/Anthropic keys, or server secrets.
- Keep real runtime secrets only in ignored `.env*` files, VPS secret files,
  provider dashboards, or encrypted application settings; commit only safe
  examples such as `.env.example` and documented placeholder values.
- Keep WAHA, the lead-agent, and their dashboards/APIs private unless explicit
  authenticated public access is added.

## Current Product Authority

- For active production-successor work, the owner's 2026-09-02 direction,
  parent issue #543, ADR 0024, `docs/EVO_LAUNCH_PLAN.md`, and the latest merged
  `docs/PLAN_CHANGES.md` entry define the target and #544 through #553 order;
  provider parent #549 executes sequentially through #565, #566, #567 and #568.
  ADR 0022 and the no-Supabase parts of ADR 0023 remain completed
  local-validation history, not current runtime authority.
- EVO remains one internal product with one access surface, one UI, one role
  model and one workflow. CRM, Inbox, Lead Agent, Admissions, Finance, Tasks,
  Documents and AI are modules, not separate target products.
- The target is the current V2 staff experience and proved CRM/provider
  workflows running on the ready-made managed Supabase foundation retained
  from V1. One dedicated EVO Supabase project supplies canonical Postgres,
  Supabase Auth, private Storage, RLS and only the Realtime capabilities the
  product actually uses. The existing project is preferred when the read-only
  audit proves its identity, migration history, data and security state.
- Root `supabase/` is the sole target migration authority. Do not ship Drizzle
  `evo_*`, SQLite or another PostgreSQL schema as a second production business
  authority. V2-only domain gaps move into `platform` or `platform_private`
  through reviewed forward Supabase migrations.
- Supabase Auth replaces the two-field development gate for real staff.
  Supabase private Storage replaces application-local document bytes. Keep the
  accepted Admin, Sales and Admissions product behavior, with Admin as the
  functional superset and exact role-preview authority, while mapping it to
  real staff identities and server-enforced RLS/authorization.
- Keep the V2 human-reviewed Gemini, staff-controlled WhatsApp and explicit
  amoCRM command semantics. Gemini never sends or changes CRM state; WhatsApp
  has no autonomous/broadcast path or blind retry; amoCRM is an integration,
  never a competing business authority.
- The 2026-09-02 owner direction authorizes this repository transition,
  read-only inventory, staging preparation and scoped cleanup without routine
  approval pauses. Production data mutation, traffic cutover and destructive
  retirement execute only after the plan's exact target, backup/restore,
  migration-rehearsal and acceptance gates pass; missing access or ambiguous
  external state fails clearly.
- Historical V1/V2 code is not copied wholesale. Reuse managed Supabase,
  deployment and security capabilities that remain correct; retire SQLite,
  the development gate, local document storage, superseded workers/provider
  paths, duplicate repositories/routes and stale dependencies after their one
  replacement path has real proof.

## Production Successor Replacement Discipline

- The successor uses **replace, do not layer**. A completed slice has exactly one active
  runtime path, data authority, auth/session path, private-file path and UI for
  every capability that slice replaces.
- Do not retain `Legacy*`, `Connected*` or `Fixture*` parallel screens;
  SQLite/Supabase compatibility adapters; dual reads/writes; fallback
  repositories; shadow runtimes; permanent feature flags; superseded
  webhooks/workers; or stale package, environment, config, script and deploy
  dependencies "just in case."
- After real database, application and browser proof exists, delete the
  superseded runtime code, imports, dependencies, implementation-level tests,
  environment/config entries, scripts and routes in the same slice. Replace
  old implementation tests with outcome tests at the new module interface.
- Before merge, attach a scoped `rg`/inventory proving that no active import or
  runtime reference to the superseded path remains. Also prove that a missing
  or failed primary path stops clearly instead of falling back.
- Frozen V1 staging/production and historical ADRs, migrations, runbooks,
  archived docs, evidence and other historical decision/rollback documentation
  are the only exception. Preserve them as deployment/rollback inputs until a
  separately authorized cutover, but never import, execute, bundle or treat
  them as V2 authority.
- Temporary coexistence requires explicit owner approval naming every file,
  the reason, an expiry or exit criterion and a deletion issue. Open-ended
  compatibility is prohibited.

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

## EVO Knowledge Base Conventions

- The local EVO knowledge workspace is
  `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания`.
- Use Russian names for human-facing folders and files. Do not add ordering
  prefixes such as `01_`, `02_`, `10_`, or `30_` to knowledge-base names.
- Keep `Внутренняя база знаний ЭВО`, `Клиентская база знаний ЭВО`,
  `Сырой архив ЭВО`, and `Секреты и доступы ЭВО` physically separate.
- Preserve Gmail, WhatsApp, Notion, Drive, Chrome, OCR, transcript and
  attachment originals unchanged in the raw archive with provenance and
  checksums. Do not publish raw material directly to an AI knowledge base.
- An agent may approve and publish clear, non-sensitive, well-sourced,
  non-conflicting routine knowledge. Escalate low-confidence or same-authority
  conflicts and material legal, price, guarantee, refund, credential, or
  personal-data decisions to the user or EVO director.
- Resolve competing knowledge using this order: latest user or EVO director
  confirmation; applicable signed agreement for its legal scope; current
  official university, embassy, or government source; newest active EVO
  document outside trash; latest confirmed Gmail or WhatsApp agreement; then
  legacy Notion pages and drafts.
- Do not analyze content under exported Google Drive or Gmail trash folders or
  Gmail Spam. Classify sensitive applicant files only by archive metadata; do
  not extract their content, OCR, or text into an AI knowledge base.
- Analyze eligible business attachments, deduplicate identical files by
  SHA-256, and retain every source location as provenance.
- Store credentials and tokens only in the encrypted
  `Секреты и доступы ЭВО` workflow. Never put secret values in Obsidian notes,
  source manifests, Git, chat output, or raw export indexes.

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

## Current Production EVO Inbox Companion Boundary

This section records the currently deployed companion contour as migration and
rollback input. It does not authorize a separate target product, login, UI,
canonical store or new dependency.

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
- The CRM legacy WAHA webhook route describes the frozen V1 deployment only.
  It is not V2 compatibility permission: V2 must not import, execute, bundle or
  route through it, and the replacing V2 slice must remove its superseded
  active references after real proof.
- The lead-agent resolves/creates amoCRM contact and lead first, then posts a
  signed internal sync event to:
  `http://evo-crm-app:3000/api/internal/lead-agent/whatsapp`.
- The existing production path treats amoCRM as its lead/contact and sales-
  status authority. This is current-state migration evidence, not target
  authority; #376 and ADR 0021 make EVO/Supabase canonical for every net-new
  pilot case without a compatibility or fallback write path.
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
