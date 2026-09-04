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

- For active production-successor work, the owner's 2026-09-04 direction,
  parent issue #543, ADRs 0024, 0026 and 0027, `docs/EVO_LAUNCH_PLAN.md`, and
  the latest merged `docs/PLAN_CHANGES.md` entry define the target and active
  ordered sequence #594 through #600, then #551 through #553. Once #594 merges
  the V3 branch, root `CLAUDE.md` and `docs/design/v3/product.md` govern V3
  product detail under those higher-level authorities. ADR 0022 and the
  no-Supabase parts of ADR 0023 remain completed local-validation history, not
  current runtime authority.
- EVO remains one internal product with one access surface, one UI, one role
  model and one workflow. CRM, Inbox, Lead Agent, Admissions, Finance, Tasks,
  Documents and AI are modules, not separate target products.
- The target is the V3 product surface running on the ready-made managed
  Supabase foundation retained from V1. One dedicated EVO Supabase project
  supplies canonical Postgres, Supabase Auth, private Storage, RLS and only
  the Realtime capabilities the product actually uses. The existing project is
  preferred when the read-only audit proves its identity, migration history,
  data and security state.
- `claude/v3-frontend` at `c53c978e251754509948240fc7eef40d3a74da90` is the
  first active integration target, not a passive design reference. Bring its
  V3 surface onto current `main` before continuing the successor sequence, but
  do not blindly merge branch-wide deploy, workflow, archive, SQLite, Drizzle
  or runtime-contract changes that would regress completed `main` work or
  delete frozen history. After that integration, V3 is the product direction;
  V2 screens remain only until the same business action is wired into V3 and
  proved, then the superseded screen is deleted in that slice. The authenticated
  root moves to V3 only in #600 after those actions have replacement proof.
  Before changing or merging #594, read that pinned branch's complete
  `CLAUDE.md`, `docs/design/v3/product.md`, `docs/design/v3/frontend-rules.md`,
  `docs/design/v3/backend-gaps.md` and `docs/design/v3/handover-to-codex.md`;
  they are the pre-merge integration inputs even though the files do not yet
  exist on `main`.
- Root `supabase/` is the sole target migration authority. Do not ship Drizzle
  `evo_*`, SQLite or another PostgreSQL schema as a second production business
  authority. V2-only domain gaps move into `platform` or `platform_private`
  through reviewed forward Supabase migrations.
- Supabase Auth replaces the two-field development gate for real staff.
  Supabase private Storage replaces application-local document bytes. Keep the
  accepted Admin, Sales and Admissions product behavior, with Admin as the
  functional superset and exact role-preview authority, while mapping it to
  real staff identities and server-enforced RLS/authorization.
- Do not rebuild product logic that already exists. The existing server actions
  in `src/lib/server/` and the canonical CRM repository are the current
  business engine, not dead V2 UI code. Wire those actions into V3 with real
  forms, `useActionState`, server validation and `expected_version`, then
  remove the superseded V2 screen in the same replacement slice.
- Reuse the existing managed-Supabase capabilities already present in root
  migrations before building new schema. The current authoritative examples are
  document requirements/reviews from migrations 043, 046, 053 and 055; visa
  cases and commands from migration 042; lead ownership and extended sales
  workflow from migration 086; and the platform audit feature behind
  `EVO_PLATFORM_P7A_AUDIT_ENABLED`.
- `src/lib/v3/*` is the V3 data-access boundary. When authority or response
  shape changes, change the V3 source adapters before changing V3 screens, and
  do not create a second status dictionary or an in-app WhatsApp channel
  connection flow.
- Keep the V2 human-reviewed Gemini, staff-controlled WhatsApp and explicit
  amoCRM command semantics. Gemini never sends or changes CRM state; WhatsApp
  has no autonomous/broadcast path or blind retry; amoCRM is an integration,
  never a competing business authority.
- Active V3 reuses the already connected private sales WAHA transport session
  `crm_primary`, verified `WORKING` on 2026-09-02. This is session/container
  reuse only: Supabase remains the sole business authority, and V3 must not run
  the frozen V1 sender, writer or webhook worker, create dual inbound
  processing, or fall back to `evo-inbox`. Completed #566/#568 verification
  confirmed `crm_primary` readiness read-only, but did not require a selected
  inbound message, Gemini provider call or WhatsApp send. Those slices prove
  implementation and fail-closed readiness, not real message delivery. Moving
  webhook ownership to V3 remains a separate controlled
  cutover with exactly one active owner.
- The 2026-09-04 owner direction authorizes this repository transition,
  V3 integration, isolated recovery/migration rehearsal and scoped cleanup
  without routine approval pauses. It also authorizes #552 to perform the one
  V3 production deployment and active-runtime retirement after #551 and every
  named prerequisite pass; do not request a second routine approval at that
  point. Missing access, a failed prerequisite or ambiguous external state
  still fails clearly. Provider enablement, webhook ownership transfer and live
  provider calls remain outside that authorization.
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
  them as current V3 authority.
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
- Frozen companion rule: the companion app does not reuse `/opt/evo-crm`,
  `evo-crm-waha`, `crm_primary`, or the lead-agent webhook path. EVO Inbox owns
  its companion WAHA webhook at `/api/waha/webhook`, its own HMAC secret, and
  its own encrypted WAHA settings. This companion-only isolation record is not
  current V2 session authority; ADR 0025 authorizes active V2 to reuse the
  connected sales `crm_primary` transport under the single-runtime rules above.
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
