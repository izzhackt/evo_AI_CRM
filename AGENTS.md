# AGENTS.md

## UX/UI changes — owner instruction, 2026-09-21

- Use the Impeccable skill for every change affecting CRM, portal, web or iPhone
  design and interaction. Consult its relevant planning/critique guidance before
  editing, and assess the implemented result through the real UI afterward.
- Preserve the agreed EVO identity and functional requirements. Design advice
  must account for permissions, data, states and existing user workflows.
- Reuse the session's loaded context; follow the skill's bounded inspection
  process. Record the advice applied and actual UI evidence in the slice's
  plan or QA receipt. The skill does not replace functional validation.

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
- Keep WAHA and its dashboards/APIs private unless explicit authenticated
  public access is added.

## Fast Execution And Validation — 2026-09-18

The owner approves fast, scope-local execution. This supersedes earlier blanket
instructions to run a full heavy suite for every change or release candidate.

- Make the smallest requested change and verify the changed function on its
  real application path. Use the actual authorized Auth, database, Storage or
  provider path that the change affects; a browser change needs its real UI
  journey. Production writes and provider actions still need their own authority.
- Select only checks needed for the changed behavior and its direct risks.
  Do not automatically run full migration/RLS, Supabase/Chromium, broad security
  or unrelated regression suites. Expand validation only for a demonstrated
  dependency/risk or an explicit user request. For prose-only edits, review the
  diff and run `git diff --check`; do not launch product tests.
- Reuse existing evidence when the relevant code, inputs and environment remain
  unchanged. State its exact revision and limits; never relabel old proof as a
  new run or retry an unchanged failure merely to obtain green status.
- Do not substitute mocks, fake data, canned responses or fallback success for
  execution of the real changed path. Explicitly authorized isolated QA remains
  technical evidence, not real-customer/provider acceptance. Report missing
  access, failed checks and unverified behavior; never fabricate success.
- Preserve authentication, authorization/RLS, tenant and Student-private data
  boundaries, idempotency and secret handling. Validate affected safeguards
  within the changed scope; speed does not permit weakening them.
- Record unrelated failures separately without expanding the task to fix or
  investigate them. Report whether they actually block the requested outcome.
- Protected short PR checks, independent exact-head review and managed release
  controls remain enforced. The owner explicitly approves the lightweight
  release contract on 2026-09-18: exact-main admission, one immutable build,
  short real changed-function smoke and rollback. Do not require the retired
  blanket full-suite prerequisite. Preserve provenance, authentication, live
  main/arm checks and truthful receipts; never forge or bypass release evidence.

## Shared EVO Workspace And Repository Boundaries

- This CRM GitHub repository is public; the authenticated staff product and its
  private runtime data are not public. Never copy confidential company material
  into this repository, issues, PRs or logs.
- The canonical local parent is
  `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO`, containing independent
  `evo_AI_CRM/` and `evoadmissions-website/` checkouts. Their Git histories,
  dependencies and releases remain separate; this is not a monorepo.
- [Shared EVO context](https://github.com/izzhackt/EVO) is a separate private
  metadata repository. When available, read its `AGENTS.md`, `CONTEXT.md` and
  brand index for cross-product work; follow this repository's launch plan,
  ADRs and `DESIGN.md` for CRM implementation. Shared-context access is not a
  prerequisite for a standalone CRM clone, build or test run.
- Keep runtime/test assets inside CRM, including `public/brand/evo-logo.png`,
  `assets/`, and `docs/company/brand/evo-admissions-logobook.pdf`. Do not replace
  them with imports or symlinks into the parent or website checkout. A shared
  brand reference is not permission to replace versioned product/test bytes.
- Corporate originals and their local registry belong to ignored `EVO/Компания/`,
  not this public repository or the shared metadata Git history. Existing
  knowledge-base and secret-storage boundaries below remain unchanged.
- Use canonical paths for new work. Temporary old-path directory aliases only
  preserve existing tasks; do not create a second checkout or prune worktrees
  as part of navigation cleanup.

## Current Product Authority

- Latest owner direction (2026-09-25): the staff CRM follows
  `docs/archive/plans/2026-09-25-crm-redesign-plan.md`, accepted with its review
  amendments and executed by one session. The production permissions and the
  limits of the executing environment are recorded there and in
  `docs/PLAN_CHANGES.md`; provider enablement is not included.
- Current September10 screenshot follow-up is
  `docs/design/v3/admin-realtime-university-expansion-run-plan.md`. Admin must be
  eligible for Sales/Admissions work under their own identity; preserve active
  membership, organization, business invariants and Student-private assessments.
  Clarify and verify existing native automatic chat, and extend reviewed real
  university content/photos. Do not reopen completed operations waves or activate
  WAHA. Use genuine inputs and state exactly which real journeys remain unverified.

- Latest September10 continuation approves the audited business gaps and adds
  universities with real pictures/details/deadlines, production update and
  same-server localhost tunnel. Read
  `docs/design/v3/business-operations-universities-run-plan.md` first. It extends
  the team candidate, canonical Sales/Finance/Admissions and existing reviewed
  university catalog boundary056. Keep staff-only records out of Student DTOs.
  The catalogue is now approved; offer comparison and staff access to private
  assessments are still deferred. Follow the plan's explicit recovery record
  without repeating the owner's no-new-backup question or bypassing release gates.
- Latest September10 request approves implementation of the optimized plan for
  employee chat and task creation: `docs/design/v3/team-workspace-run-plan.md`,
  linked from `docs/EVO_LAUNCH_PLAN.md` and tracked in #708. Implementation is
  active, not evidence of deployment. Build native staff-only channels using existing
  Auth, discoverable case-task creation and separate canonical staff tasks;
  WhatsApp mirroring/provider activation remain explicit separate lanes.
  Preserve private Student results, current provider authority and the single
  persistent source. Read the new plan before resuming older unchecked lists.
  The owner explicitly defers WAHA confirmation because employee WhatsApp numbers
  are not available: do not pair, reconnect, activate webhooks or send messages.
  Native staff chat/tasks must work independently; prepare activation instructions.
  Do not extend the earlier fictional Student QA permission to staff identities.
- Latest September 9 owner direction: release the implemented Student/Admissions
  work without a new backup for now and expose the same server through a local
  SSH tunnel. See the narrow owner waiver in `docs/EVO_LAUNCH_PLAN.md` and the
  latest `docs/PLAN_CHANGES.md`; no backup/restore success may be fabricated, and
  all other release controls remain. At that time the existing Supabase project
  `iosckaqtovbbnssqcpde` was the single persistent product source; it is now the
  historical cloud project and rollback source (see the 2026-10-20 bullet
  below), and it is still never reset, replaced or deleted without a new
  explicit owner instruction. No disposable local preview database is
  requested. Resolve the exact single-account target
  and dependencies before consolidation; no permanent one-user product limit,
  Auth bypass or removal of Student-private authority is authorized.
- Since 2026-10-20 00:47 UTC the production database is the self-hosted
  Supabase on hermes-vps (`/opt/evo-supabase`, public address
  `https://supabase.evoadmissions.com`). The GitHub variable
  `EVO_SUPABASE_TARGET=selfhosted` selects it for release, schema ledger and
  the env contract (default `cloud`, kept for rollback). The cloud project
  `iosckaqtovbbnssqcpde` is kept untouched as the rollback source and treated
  as read-only: the owner said never to delete it, and no migration, write or
  reset happens there without an explicit owner instruction. Removing the
  cloud code path is tracked in #1271. There are no backups of the self-hosted
  database yet, by owner decision; the owner will say when. ADR 0034
  supersedes ADR 0024 on where the database lives; order, facts and rollback
  are in `docs/runbooks/selfhosted-cutover.md` and
  `docs/runbooks/infrastructure-map.md`.
- The current September 9 owner-authorized run is
  `docs/design/v3/student-admissions-run-plan.md`: extend the existing Student
  Portal with native English/career-interest tests and implement China/Malaysia
  Admissions in EVO. Read root `DESIGN.md` before UI changes. Its original EVO
  brand accent supersedes historical monochrome-only design instructions.
- The 2026-09-18 quiet-UI rule in `DESIGN.md` forbids permanent narration of
  ordinary controls: keyboard hints, normal draft/connected captions and idle
  character counters. Preserve behavior, accessible names, meaningful pending/
  success feedback and actionable errors; show limit guidance when it blocks an
  action. Put infrequent Admin tools in settings, with an obvious exit from an
  active role-view mode. Do not generalize this into hiding business conditions.
- Assessment answers/results are Student-owner private in this run, including
  denial on ordinary Admin/Curator product paths. Do not add staff tracking,
  test assignments or case-timeline projections. No invented CEFR certification.
- The 2026-09-17 owner direction retires `/preview/student` and its CRM link.
  Use a separate, explicitly authorized QA Student account on
  `https://app.evoadmissions.com` to check the real portal. Keep `/portal`
  authority and private assessments unchanged; no Admin impersonation or
  presentation-only replacement. #721 and its run plan remain historical evidence,
  not instructions to restore preview. Follow the current launch-plan QA gates.
- The owner explicitly permits bounded fictional Student QA identities/data for
  this run, with real Auth/backend/browser execution and isolation from working
  sales reports. This is not an Auth bypass, fake provider acceptance or blanket
  production seeding permission. Follow the plan's provisioning/cleanup gates.
- The owner requests sustained execution without further product questions;
  choose documented recommendations for uncertainties and report them for
  post-edit. Preserve authority for external messages, credentials and release
  gates. Completed earlier sequences and #687's separate owner-acceptance cleanup
  do not replace the current run or authorize unrelated migrations.
- For active production-successor work, the owner's 2026-09-04 direction,
  parent issue #543, ADRs 0024, 0026 and 0027 (ADR 0024 as superseded by ADR 0034
  on where the database lives), `docs/EVO_LAUNCH_PLAN.md`, and
  the latest merged `docs/PLAN_CHANGES.md` entry define the target. Integration
  sequence #594 through #600 is completed on `main`; the current active ordered
  sequence is #551 through #553. Root `CLAUDE.md` and
  `docs/design/v3/product.md` govern V3 product detail under those higher-level
  authorities. ADR 0022 and the no-Supabase parts of ADR 0023 remain completed
  local-validation history, not current runtime authority.
- EVO remains one internal product with one access surface, one UI, one role
  model and one workflow. CRM, Inbox, Lead Agent, Admissions, Finance, Tasks,
  Documents and AI are modules, not separate target products.
- The active product is the V3 surface running on the ready-made Supabase
  foundation retained from V1 (managed until 2026-10-20, self-hosted since,
  ADR 0034). One dedicated EVO Supabase instance supplies canonical Postgres,
  Supabase Auth, private Storage, RLS and only the Realtime capabilities the
  product actually uses. The cloud project was preferred while the read-only
  audit proved its identity, migration history, data and security state; it is
  now the rollback source.
- `claude/v3-frontend` at `c53c978e251754509948240fc7eef40d3a74da90` is the
  historical pinned integration input for completed #594, not an active target
  or independent runtime authority. Its selected surface and governing V3 docs
  now exist on `main`. After completed #600, V3 is the sole authenticated root
  and product UI; do not resurrect a V2 screen. Do not blindly merge historical
  branch-wide deploy, workflow, archive, SQLite, Drizzle or runtime-contract
  changes that would regress completed `main` work or delete frozen history.
- Root `supabase/` is the sole target migration authority. Do not ship Drizzle
  `evo_*`, SQLite or another PostgreSQL schema as a second production business
  authority. Successor domain gaps move into `platform` or `platform_private`
  through reviewed forward Supabase migrations.
- Supabase Auth is the sole real-staff authentication path. Supabase private
  Storage is the sole active private-file path. Keep the accepted Admin, Sales
  and Admissions product behavior, with Admin as the functional superset and
  exact role-preview authority, mapped to real staff identities and
  server-enforced RLS/authorization.
- Do not rebuild product logic that already exists. The existing server actions
  in `src/lib/server/` and the canonical CRM repository are the current
  business engine, not dead UI code. New or extended V3 actions use real forms,
  `useActionState`, server validation and `expected_version`; remove any
  superseded path in the same proven replacement slice instead of restoring a
  V2 screen as fallback.
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
- Keep the accepted human-reviewed Gemini, staff-controlled WhatsApp and
  explicit amoCRM command semantics in V3. Gemini never sends or changes CRM
  state; WhatsApp has no autonomous/broadcast path or blind retry; amoCRM is an
  integration, never a competing business authority.
- Active V3 reuses the private sales WAHA transport session `crm_primary`.
  Its `WORKING` proof from 2026-09-02 is historical: the 2026-09-07 read-only
  check reported `SCAN_QR_CODE`, and the owner declined QR pairing. Do not
  claim current connectivity or restart, relink or pair the session. This is
  session/container reuse only: Supabase remains the sole business authority,
  and V3 must not run the frozen V1 sender, writer or webhook worker, create
  dual inbound processing, or fall back to `evo-inbox`. Completed #566/#568 verification
  confirmed `crm_primary` readiness read-only, but did not require a selected
  inbound message, Gemini provider call or WhatsApp send. Those slices prove
  implementation and fail-closed readiness, not real message delivery. Moving
  webhook ownership to V3 remains a separate controlled
  cutover with exactly one active owner.
  Update 2026-10-06: that cutover happened on the owner's instruction —
  `crm_primary` (GOWS) was paired and posts to the CRM direct ingress (see
  «WhatsApp (state 2026-11-02)»). Re-pairing, QR, logout or restart of
  the session by an agent still need the owner's explicit permission.
  Update 2026-10-20: the owner asked to connect the session himself from the
  platform. An Admin now does that with the «Подключение WhatsApp» block in
  «Настройки → Интеграции» (QR or a pairing code by phone number); the agent
  never presses it, never calls the same WAHA endpoints directly, and the
  block has no logout or reset.
- Сливает в `main` только владелец или ИИ по его прямой команде в чате. Production
  deploy, provider mutation и schema-apply — отдельные gates из
  `docs/EVO_LAUNCH_PLAN.md`.
- Validation must also avoid duplicate work inside a gate. When a full proof
  is explicitly required, it applies migrations once through local Supabase,
  executes each Node test file once through the canonical CI manifest,
  installs only Chromium headless
  shell in the browser job, and does not run standalone typecheck before a
  production Next build. Keep the historical migration-boundary harness as a
  separate path-triggered gate. Required PR contexts must always be emitted;
  prose-only documentation skips product lint/typecheck/build, unknown or empty
  ranges fail the classifier, and mixed known paths select the union of their
  risk-matched checks.
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
- Current public URLs: `https://crm.evoadmissions.com` for staff and
  `https://app.evoadmissions.com` for Students, both on the same app. Domain
  cutover was accepted on 2026-09-17; `docs/EVO_LAUNCH_PLAN.md` records the exact
  release, DNS/TLS, edge and Auth proof. Real Student sign-in is not claimed.
- Preserve the public Host through the edge and host-only auth cookies; no
  wildcard cookie domain or origin bypass. Staff callback is exactly
  `https://crm.evoadmissions.com/auth/staff`; Student callback is exactly
  `https://app.evoadmissions.com/auth/callback`.
- Release health is exactly `https://crm.evoadmissions.com/api/health`.
  The retired sslip origin uses GET-only navigation redirects; never redirect
  auth POSTs or restore sslip as an active app fallback. See `deploy/README.md`.
- Production runs with `docker compose -f docker-compose.prod.yml` as project
  `evo-crm`.
- The app container is `evo-crm-app-1`, image `evo-crm:latest`, private network
  alias `evo-crm-app:3000`.
- Public EVO routes should be served by `evo-edge-caddy` on `evo_public_web`
  (config in `deploy/edge/`), not by `/opt/acadis` or any `acadis_*` Docker
  network.
- Do not introduce new EVO dependencies on the `acadis_*` Docker networks;
  Arcadis/acadis is a separate project boundary. EVO services should use their
  own Compose projects and neutral EVO-owned proxy/network names.

## WhatsApp (state 2026-11-02)

- The lead-agent and the EVO Inbox companion were retired and removed from
  the repository on 2026-11-02. Their final tree is kept under the git tag
  `archive/lead-agent-and-inbox-2026-11-02`; do not restore, start, import or
  route through them.
- The private WAHA container `evo-crm-waha` (base URL
  `http://evo-crm-waha:3000`, no public port) still exists, but the WhatsApp
  connection has been broken since 2026-10-12. Do not claim it works.
- The WAHA path into the CRM is the private route
  `http://evo-crm-app:3000/api/v2/whatsapp/inbound` (HMAC from
  `EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET`; off unless
  `EVO_PLATFORM_WAHA_INGRESS_ENABLED=1`; the public edge answers 404).
- The replacement is Wazzup. Stage 1 code is merged (#1310): ADR
  `docs/adr/0036-receive-sales-whatsapp-via-wazzup-sidecar.md`, runbook
  `docs/runbooks/wazzup-whatsapp.md`, plan
  `docs/plans/2026-10-27-wazzup-whatsapp-plan.md`. Intake is OFF until the
  owner enables it.
- Agents never reset WAHA sessions, never request a QR or pairing code, never
  log out or restart a session, and never enable broadcasts or auto-replies
  without the owner's explicit permission. AI only writes drafts for staff
  review. The Admin links WhatsApp himself from «Настройки → Интеграции».
- `/opt/evo-crm/.env.waha` keeps only `WAHA_API_KEY=sha512:<hash>`; the plain
  key lives only in the Supabase Vault runtime binding. Keep separate secrets
  for the WAHA webhook HMAC and for Wazzup.
- Public EVO routes go through `evo-edge-caddy` on `evo_public_web`; its
  config lives in `deploy/edge/` (`Caddyfile.evo-edge`,
  `docker-compose.edge.yml`). No EVO service may depend on `acadis_*` networks.
- Runbooks: `docs/runbooks/wazzup-whatsapp.md`,
  `docs/runbooks/whatsapp-go-live.md`, `docs/runbooks/whatsapp-history-import.md`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `izzhackt/evo_AI_CRM` using the `gh` CLI authenticated with a PAT; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: read root `CONTEXT.md` and root `docs/adr/` when they exist. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CRM Knowledge Base delivery — 2026-09-19

- The owner requested full implementation of `docs/archive/plans/2026-09-19-crm-knowledge-base-plan.md`, including real local-source import, sorting and export. CRM becomes the Admin knowledge workplace only after verified import/read/export; the four local roots remain unchanged source archives.
- CRM «Клиентская база» means dossiers backed by existing CRM identities/cases. The historical local «Клиентская база знаний ЭВО» contains general approved AI knowledge; import it into internal topics preserving its provenance/approval, never into personal dossiers by name alone. AI publication/bundles remain a separate authority.
- Astra owns the knowledge scope. Fable retains Portal/App and the current schema/release coordinator role until an explicit handoff. No parallel schema apply, migration-number claim or arm/disarm. Shared changes are small, isolated and reviewed against fresh main.
- Private inventory, migration state, files and export receipts stay outside this public repository. SOPS ciphertext stays separate; decryption/signing keys never enter knowledge storage or exports.
