# P8V v1 production closure

Date: 2026-08-18
Issue: #287
Status: execution-plan gate

## Outcome

Complete the agreed EVO Platform v1 on the real Hermes and managed Supabase
boundaries, then prove the staff workflow through the real system. The ordered
user journey is:

1. authenticated staff login;
2. signed WhatsApp intake from the existing private CRM WAHA session;
3. amoCRM contact/lead resolution and canonical context binding;
4. durable client memory and reviewed knowledge retrieval;
5. one staff-triggered Gemini draft;
6. staff review and explicit manual-send authorization;
7. one approved non-customer WhatsApp send;
8. immutable audit, retry/reconciliation and rollback proof.

Independent blockers do not justify a fake fallback. A blocked boundary is
recorded and skipped while unrelated preparation, tests and read-only evidence
continue. A v1 result is not `verified` unless every step above is real.

## Fresh repository boundary

The plan starts from exact main
`8dfeb7b8cc85588b1d886e61fb843a14122f5b16`, tree
`879c9fcdedca442c1bad750ae485f850aa8c5e90`, parent
`93d07740e15b05067af31b4aa03c865b6b1cebda`, with successful exact-main CI
run `32084838298`. P8U4 retained local candidate evidence remains immutable;
it is preparation evidence, not production evidence.

Every repository block uses a separate clean worktree, exact-head PR review,
4/4 CI, squash merge and exact-main green CI. Production artifacts must be
rebuilt from the final reviewed application commit rather than silently
deploying an older private candidate.

## Observed production baseline

The controller performed read-only checks on 2026-08-18 before writing this
plan:

- Hermes is `x86_64`; CRM app, CRM WAHA, Lead Agent, Inbox app and Inbox WAHA
  are running, healthy and have restart count zero.
- Deployed application images are older than the current repository. CRM is at
  source tag `564332b4...`, Inbox at `a09a72fc...`, and Lead Agent is on the
  retained rollback image.
- `crm.evoadmissions.com` and `inbox.evoadmissions.com` do not resolve. The two
  exact sslip.io fallbacks return HTTP 200 health responses.
- Root CRM has none of the Platform Supabase/Auth, organization/account,
  Gemini or staff-assistant settings. Deploying current root code before Auth
  readiness would replace a working legacy boundary with an unusable login.
- Managed Supabase responds through the existing server credential. It has one
  legacy account and one confirmed Auth user. Managed knowledge contains only
  two `internal` documents and 26 `internal` chunks; there are no managed bundle
  revisions and no AI assistant audits. The `platform` schema is not currently
  available through PostgREST, so actor authority cannot be proven from the
  production web path.
- CRM WAHA is reachable and reports `crm_primary` and `china_curator` as
  `WORKING`; only `crm_primary` has a webhook. The WAHA images and sessions are
  preservation boundaries, not rollout targets.
- Gemini model inventory is reachable with the existing Lead Agent credential
  and includes exact `gemini-3.5-flash`.
- Lead Agent has an amoCRM base URL and token-file path, but the token file is
  absent. The companion database contains only one blocked WAHA integration
  setting and no amoCRM integration. Real amoCRM linking is therefore blocked
  until a valid credential/config is restored.
- The repository can authorize and enqueue `manual_whatsapp_send`, but no
  production worker consumes that durable work kind. Manual authorization is
  not yet a real send path.

## Fixed implementation seams

The test-first seams are frozen from the owner's requested workflow:

1. the existing private `crm_primary` WAHA webhook to Lead Agent, amoCRM-first
   contact/lead resolution, and the signed Lead-Agent-to-CRM sync route;
2. the durable `manual_whatsapp_send` claim/dispatch/finish worker;
3. the protected `POST /api/platform-ai/staff-assistant` route;
4. the authenticated browser login and staff conversation workspace;
5. the redacted reconciliation/result command.

Tests may inject transport collaborators for deterministic failure coverage,
but only real managed Supabase, WAHA, amoCRM and Gemini execution counts as
production proof.

## Block V1 — core engine closure

Implement only behavior that blocks the agreed workflow:

- preserve the existing ingress owner exactly: `crm_primary` posts only to the
  private Lead Agent `/webhooks/waha`; Lead Agent resolves or creates the
  amoCRM contact and lead first, then posts a signed internal sync to
  `http://evo-crm-app:3000/api/internal/lead-agent/whatsapp`. The root CRM WAHA
  webhook remains compatibility-only and this rollout must not create a second
  inbound owner or repoint the session;
- add a private, HMAC-authenticated worker route that claims exactly
  `manual_whatsapp_send`, validates the bound authorization/conversation/source
  message/draft/final-text hash, calls the existing private WAHA
  `POST /api/sendText` with the configured exact session, and finishes the
  durable item with provider message evidence;
- use immutable business keys and the existing single-attempt manual-send
  contract so UI retries are idempotent and a provider ambiguity enters manual
  review rather than sending twice;
- record body-free immutable audit and reconciliation state; never retain the
  message body, phone, cookie, credential or provider payload in rollout
  evidence;
- expose safe operator state for queued, leased, succeeded, retry-wait,
  dead-letter and reconciliation-required outcomes;
- keep autonomous replies disabled. The manual worker must refuse work that is
  not backed by a staff authorization.

The real trigger owner is one new private Compose service named
`evo-crm-manual-send-worker`, built from the exact same reviewed CRM image. It
runs only the committed `scripts/manual-whatsapp-send-worker.mjs`, has no public
port, joins only `evo_crm_private`, and calls the CRM worker route with its own
process-only HMAC. The loop starts one claim at most every five seconds, permits
one in-flight item, applies a ten-second HTTP deadline and never retries a
provider-ambiguous manual send. A mode-`0600` heartbeat is refreshed after each
completed or empty claim; the container healthcheck fails when it is older than
thirty seconds. Route-owned lease or dispatch failures update durable safe
operator state and surface through reconciliation; a running-but-stale worker
cannot be reported healthy. Responsibility is closed at the HTTP boundary: a
connection/DNS/timeout failure before any response changes only the sidecar's
local heartbeat/health and does not claim or mutate durable work. The CRM route
transaction alone owns claim/lease/dispatch/finish state. If the request may
have reached CRM but the response is lost, the sidecar does not issue an
immediate second trigger; lease expiry opens the existing unknown-result
reconciliation path before another claim. The HMAC is owned by the CRM Compose
boundary in the ignored root-owned production env and is never shared with
WAHA or Lead Agent secrets.

The WAHA transport follows the current official endpoint contract for
`POST /api/sendText` with exact `session`, `chatId` and text fields:
https://waha.devlike.pro/docs/how-to/send-messages/. amoCRM reads/writes use only
documented OAuth v4 endpoints:
https://developers.kommo.com/reference/kommo-api-reference.

## Block V2 — production preparation

Before a production effect, freeze and review:

- exact current-main CRM, Inbox and Lead Agent source/tree/image identities;
- linux/amd64 portable artifacts, SBOMs and network-none smoke evidence;
- exact existing WAHA image/session/network identities and rollback images;
- exact Compose/env source-to-retained-copy matrix with regular/non-symlink,
  root-owned and mode preconditions;
- migration ledger before/after and the exact contiguous repository range;
- singular live account resolution and singular active Platform organization;
- deterministic production-account-bound client/internal bundles rebuilt twice
  from the still-frozen 11/291 vaults;
- presence-only validation for Supabase URL/publishable/secret keys, Platform
  organization/account IDs, Gemini key and all worker HMACs; values never enter
  commands, logs, PRs or evidence;
- exact legacy runtime images/config and reverse-order rollback commands.

The current staff-assistant code requires the new `sb_publishable_...` and
`sb_secret_...` credentials. Existing legacy anon/service-role JWTs do not
satisfy that contract. Do not broaden or weaken the accepted credential
formats merely to avoid obtaining the correct provider keys.

### V2.1 exact execution contract

Issue #290 binds V2 to application commit
`0f1454d014bbc9eca9d7381dfe557e980965543e`, tree
`19599bcf043dc4a555c8996c21e7801934b64633`, parent
`a7c589c2c735d4ef2d15ab5153eb07dba07d6286`, and exact-main push CI
`32093566626`. The release version is `2026-08-18.p8v2.1`. The only candidate
source tags are, in order:

1. `evo-crm:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`;
2. `evo-inbox:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`;
3. `evo-lead-agent:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`.

The matching archive names are respectively
`evo-crm-0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64.tar`,
`evo-inbox-0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64.tar`, and
`evo-lead-agent-0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64.tar`.
The reviewed builder runs from a separate clean release-control checkout against
a separate detached clean application checkout. Before every local Docker
command, `orb status` must be exactly `Running` and `docker context show` must
be exactly `orbstack`. The three tags and every new evidence destination must
be absent. The build uses `--platform linux/amd64`; retained identity must prove
empty variant, exact OCI source/revision/version labels, exact tag to image ID,
OCI-index to platform-manifest binding, closed archive entries, SBOM identity,
and network-none smoke. SBOM and smoke always use the immutable image ID. The
sole post-inspection tag use is Docker archive serialization, because the
portable archive must retain the canonical tag; successful image inventories
immediately before and after serialization plus exact archive descriptor-to-ID,
revision and tag binding make any retag race fail closed.

The local retained component roots are beneath the clean application checkout:

- `.evo-release-evidence/p8v2-build-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`;
- `.evo-release-evidence/p8v2-portable-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`;
- `.evo-release-evidence/p8v2-knowledge-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`;
- final `.evo-release-evidence/p8v2-preparation-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`.

The secret-bearing rollback component root exists only on Hermes at exact path
`/opt/evo-release-evidence/p8v2-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`.
It is never copied to the controller, printed, committed or indexed by the safe
final root. The controller retains only UUID/secret-free rollback identities.

Each root must be newly created as a real non-symlink mode-`0700` directory;
every retained artifact is a regular non-symlink mode-`0600` file. Paths are
realpath-contained, writes are temporary-file plus atomic rename, destinations
must be absent, and no glob is authorized. Intermediate component roots are
validation evidence only. The retained knowledge root contains only the
UUID-free `knowledge-build-result.json`; it never contains a bundle, manifest
or raw builder report. The final root alone is the V2 completion result;
component artifacts are copied into it only after all success prerequisites
pass. On a blocker, the final root contains only the closed
`v2-preparation-result.json`, while completed component roots remain immutable
and are referenced only by safe SHA-256 identities, never private paths.
The ordered result state machine ends with a distinct `evidence_publication`
step. Candidate, baseline, migration, rollback, identity, knowledge and
configuration failures use `preparation_blocked`; an atomic-write, privacy,
evidence-graph or UUID-bearing temporary-root cleanup failure uses
`evidence_failed` and a terminal `failed` step. The two result classes cannot be
interchanged by schema or runtime validation.

The retained production pre-state is the following exact ordered container
boundary, all required healthy with restart count zero before and after V2:

1. `evo-crm-app-1`, container
   `7b3b6d026c84055045a0e31d520d2946dbf2dc181d5829c6ea1088d872366c46`, image
   `sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580`;
2. `evo-crm-waha-1`, container
   `0d1017e3304dfb3e1dce37ca00a2826b019429266763e211ed399b938baaa750`, image
   `sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c`;
3. `evo-crm-lead-agent-1`, container
   `7e8539399eb69cee8b109c5b0580bf06dd77ff4648c9b0e622edd09af9743e88`, image
   `sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7`;
4. `evo-inbox-app-1`, container
   `c78a94b69114e24dba918db7bab574b20f85b83dd5756a3016b2c9652cfd2592`, image
   `sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b`;
5. `evo-inbox-waha`, container
   `048c820d3f607772ce6b4720832a53ce10e979c80af00ee53bbcaed628a8c7e9`, image
   `sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c`.

V2 may read these identities but may not load images, retag on Hermes, recreate,
reload or restart any service. WAHA images, sessions and networks are immutable.
The rollback capture uses explicit `install -m 0600` into the exact absent
destination names below; each present source must be a regular non-symlink
`root:root` file with the stated source mode. No variable-derived name or glob
is allowed:

1. `/opt/evo-crm/docker-compose.prod.yml` (`0644`) to
   `crm-current-docker-compose.prod.yml`;
2. `/opt/evo-crm/.env.production` (`0600`) to `crm-env.production`;
3. `/opt/evo-crm/.env.lead-agent` (`0600`) to `crm-env.lead-agent`;
4. `/opt/evo-crm/.env.waha` (`0600`) to `crm-env.waha`;
5. `/opt/evo-inbox/docker-compose.prod.yml` (`0644`) to
   `inbox-current-docker-compose.prod.yml`;
6. `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production` (`0600`) to
   `inbox-env.production`;
7. `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha` (`0600`) to
   `inbox-env.waha`.

The eighth exact configuration row is
`/opt/evo-crm/.env.manual-send-worker`. The observed pre-state requires it to be
absent because the worker is not deployed. V2 records that absence. If it is
present at action time, it must instead be a regular non-symlink `root:root`
mode-`0600` source captured as `crm-env.manual-send-worker`, and the observation
is a blocking baseline drift. V3 may create this file only from separately
approved process-only values; on rollback it must stop/remove the new worker
and restore this exact absent/present pre-state.

It also captures the five exact Compose files named by the live container
labels, all required regular non-symlink root-owned with the stated source
mode:

1. CRM app:
   `/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo/docker-compose.prod.yml`
   (`0644`) to `crm-app-compose.prod.yml`;
2. CRM WAHA:
   `/opt/evo-releases/1f0d1a810014e2ecee496cb9c3a7217a70c86486/repo/docker-compose.prod.yml`
   (`0644`) to `crm-waha-compose.prod.yml`;
3. Lead Agent:
   `/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo/docker-compose.prod.yml`
   (`0600`) to `lead-agent-compose.prod.yml`;
4. Inbox app:
   `/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml`
   (`0644`) to `inbox-app-compose.prod.yml`;
5. Inbox WAHA:
   `/opt/evo-releases/1f0d1a810014e2ecee496cb9c3a7217a70c86486/repo/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml`
   (`0644`) to `inbox-waha-compose.prod.yml`.

The three application rollback image references are exactly
`evo-crm:564332b420a1fb1bd6232dda945d044bb922d3f0`,
`evo-inbox:a09a72fc55d869c861df520f76d62413a2315fc1`, and
`evo-lead-agent:rollback-2026-08-15.p8d.1`, bound respectively to the frozen
image IDs above. V2 saves each immutable ID to an exact absent private rollback
archive on Hermes, hashes it, and proves the exact reference still maps to the
exact ID before and after save. The two WAHA references remain the exact digest
`devlikeapro/waha@sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c`
and are not saved, loaded, retagged or changed.

The capture records only filename, source mode, retained mode, size and SHA-256;
it never prints or parses secret values. Missing, extra, symlinked, wrong-owner,
wrong-mode or colliding files block. The retained rollback record also binds the
five exact container/image/network records above and these exact application
selectors: CRM project `evo-crm`, working directory
`/opt/evo-releases/564332b420a1fb1bd6232dda945d044bb922d3f0/repo`, service `app`;
Inbox project `evo-inbox`, working directory
`/opt/evo-releases/a09a72fc55d869c861df520f76d62413a2315fc1/repo/agent-lead2-inbox/deploy`,
service `app`; Lead Agent project `evo-crm`, working directory
`/opt/evo-releases/b2303eccb78b7c102ec702e9821f765f6dfaba88/repo`, service `lead-agent`.
The exact render/rollback mapping is closed as follows. `$R` denotes only the
literal retained rollback root above and is resolved/realpath-checked once; it
is never supplied by an operator. Every render uses `docker compose config -q`
so interpolated secrets are not printed, followed in V3 only by the same prefix
and `up -d --no-deps <service>`:

- CRM app: project `evo-crm`, file `$R/crm-app-compose.prod.yml`,
  `--env-file $R/crm-env.production`, service `app`, with exact env selectors
  `EVO_CRM_APP_ENV_FILE=$R/crm-env.production`,
  `EVO_CRM_LEAD_AGENT_ENV_FILE=$R/crm-env.lead-agent`,
  `EVO_CRM_WAHA_ENV_FILE=$R/crm-env.waha`,
  `EVO_RELEASE_REVISION=564332b420a1fb1bd6232dda945d044bb922d3f0`,
  `EVO_RELEASE_VERSION=2026-07-24.1`, repository source, live WAHA digest and
  `EVO_CADDY_NETWORK=evo_public_web`;
- Inbox app: project `evo-inbox`, file `$R/inbox-app-compose.prod.yml`,
  `--env-file $R/inbox-env.production`, service `app`, with
  `EVO_INBOX_APP_ENV_FILE=$R/inbox-env.production`,
  `EVO_INBOX_WAHA_ENV_FILE=$R/inbox-env.waha`,
  `EVO_RELEASE_REVISION=a09a72fc55d869c861df520f76d62413a2315fc1`,
  `EVO_RELEASE_VERSION=2026-07-24.2`, repository source, live WAHA digest,
  `EVO_CADDY_NETWORK=evo_public_web`, the retained production Inbox domain,
  WAHA base URL and all three retained public build settings loaded only from
  `$R/inbox-env.production`;
- Lead Agent: project `evo-crm`, file `$R/lead-agent-compose.prod.yml`,
  `--env-file $R/crm-env.production`, service `lead-agent`, with the same three
  CRM env-file selectors, `EVO_RELEASE_REVISION` and `EVO_RELEASE_VERSION` both
  exactly `rollback-2026-08-15.p8d.1`, repository source, live WAHA digest and
  `EVO_CADDY_NETWORK=evo_public_web`.

V2 verifies these three `config -q` renders and the exact image reference/ID
mapping without executing `up`. V3 executes a selected rollback in reverse
application order and then verifies frozen image ID, exact networks, health and
restart count zero. No rollback command is executed in V2.

The repository migration ledger must be exactly contiguous `001` through `077`.
The observed managed-production ledger must be exactly contiguous `001` through
`076` with exactly migration `077` pending; any other gap, duplicate or unknown
version blocks. Managed production is read only in V2: record both exact ranges,
counts, the singular pending version and project health without applying
anything. Resolve exactly one
live target account and exactly one active Platform organization using the
existing server-side credential path. UUID values stay process-only: evidence
records only `exactly_one_active` plus deterministic account-bound artifact
hashes. The configured `EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID` and
`EVO_PLATFORM_ORGANIZATION_ID` must parse as UUIDs and equal those singular live
identities in process memory; the configured Supabase URL must resolve to the
same exact production project used for resolution. Zero/multiple live rows,
missing/malformed settings, identity mismatch or project mismatch block. UUIDs
must never be taken from prior notes, a placeholder, literal command text,
stdout, stderr or committed evidence.

Build the still-frozen client vault of exactly 11 Markdown documents and the
internal approved vault of exactly 291 Markdown documents twice each in four
distinct newly created temporary mode-`0700` directories outside every retained
evidence root. The live account UUID is passed directly
from singular resolution into the existing builder process without printing or
persistence outside the bundle/manifest format that requires it. Require
byte-identical bundle and manifest outputs per audience, exact document/path/
source-hash bindings, the existing PII/forbidden-root gate and zero vault drift.
Every one of the four UUID-bearing temporary roots, including its bundle,
manifest and report, is removed and absence-verified in a finally-style path on
every success or failure after creation. Cleanup failure is a blocking
`evidence_failed` result and cannot authorize import or deployment. Final safe knowledge
evidence records only audience, 11/291 count, bundle SHA-256, manifest SHA-256,
and frozen-vault validation statuses. It does not import or embed anything.

Configuration evidence retains only safe presence/equality/format statuses and
never retains values; in process, the validator still performs the exact
format, identity and project cross-checks above. Root CRM requires
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EVO_PLATFORM_SUPABASE_SECRET_KEY`, `EVO_PLATFORM_ORGANIZATION_ID`,
`EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID`, `EVO_PLATFORM_GEMINI_API_KEY`,
`EVO_PLATFORM_STAFF_ASSISTANT_ENABLED`,
`EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED`,
`EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET`,
`EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED`, and `EVO_LEAD_AGENT_SYNC_SECRET`.
The manual worker also requires its separate root-owned mode-`0600`
`.env.manual-send-worker` containing only its dedicated trigger secret; the
fixed endpoint remains the non-secret Compose environment value. Lead Agent
additionally requires `EVO_AGENT_AMO_BASE_URL`,
`EVO_AGENT_AMO_CLIENT_ID`, `EVO_AGENT_AMO_CLIENT_SECRET`,
`EVO_AGENT_AMO_REDIRECT_URI`, exactly one valid `EVO_AGENT_AMO_TOKEN_FILE` or
`EVO_AGENT_AMO_REFRESH_TOKEN`, `EVO_AGENT_AMO_PIPELINE_ID`,
`EVO_AGENT_AMO_STATUS_ID`, `EVO_AGENT_AMO_RESPONSIBLE_USER_ID`,
`EVO_AGENT_CRM_BASE_URL`, `EVO_AGENT_CRM_SYNC_PATH`,
`EVO_AGENT_CRM_SYNC_SECRET`, and its separate `EVO_AGENT_WAHA_BASE_URL`,
`EVO_AGENT_WAHA_API_KEY`, `EVO_AGENT_WAHA_SESSION` and
`EVO_AGENT_WAHA_WEBHOOK_SECRET`. The
new Supabase keys must pass their
reviewed prefixes; a legacy anon/service-role JWT is reported as legacy, never
accepted as a substitute. The observed 2026-08-18 state is currently blocked:
the new root-CRM Platform settings are absent, and the configured Lead-Agent
amoCRM token file/OAuth refresh material is absent. V2 records those facts and
continues independent image, rollback, migration and vault-integrity work; it
cannot return `preparation_verified` or authorize V3.

The V2 implementation PR must add the closed result schema, runtime validator,
injected command/filesystem seams and negative behavioral tests for symlinks,
mode/owner drift, collisions, mutable-tag races, platform/label/hash drift,
partial progression, multiple/no account or organization, vault drift,
non-deterministic bundles, leaked UUID/private data and false success. Only
after independent review, exact-head 4/4 CI, squash merge, exact-main green CI,
a real read-only preflight and a separate action-time token may it perform the
bounded local build and read-only production capture. This amendment grants no
V3 production effect.

## Block V3 — one-boundary rollout

Execute only after the preparation PR and evidence are independently approved:

1. capture pre-state and start a bounded authorization window;
2. apply only missing reviewed migrations and re-read the ledger;
3. import client then internal knowledge atomically and verify exact revisions,
   document/chunk counts, audience isolation and source hashes;
4. deploy CRM, verify Auth/login/health/config before any other app;
5. deploy Inbox only if its current-main changes are required by the final
   release; otherwise prove it intentionally unchanged;
6. deploy Lead Agent, keep autoreply/outbound false and verify intake/handoff;
7. stop before the next boundary on any identity, health, restart, network,
   route, data or audit mismatch.

WAHA containers are never recreated by these commands. A failed application
boundary is unwound together with every earlier changed application boundary
in reverse order. Database migrations are forward-only; post-migration failure
uses application rollback plus a new corrective migration, never destructive
database rollback.

## Block V4 — real staff proof

Use an existing owner-authorized staff/admin account and one explicitly
non-customer test WhatsApp identity. Do not create demo users or synthetic
provider records.

The proof must retain UUID-free/body-free facts for:

- login success, role and organization authorization, refresh and logout;
- one signed inbound WhatsApp event becoming one operator-visible conversation;
- amoCRM contact/lead IDs present and canonical context resolved;
- durable client memory visible without exposing it in evidence;
- non-empty client/internal retrieval with exact bound source paths;
- one Gemini draft with exact model, no tools/store/retry and body-free audit;
- staff edit/approval and one manual send with WAHA provider acknowledgement;
- no autonomous reply, no unrelated outbound event and no duplicate send;
- audit chain and retry/reconciliation state;
- application rollback rehearsal or exact retained rollback validation.

If amoCRM credentials, Supabase management/database access, new API keys,
staff login credentials, a non-customer WhatsApp identity or DNS ownership is
unavailable, record that exact blocker and continue all independent gates. Do
not substitute local fixtures, fake users or customer content.

## Evidence and completion

This document is implementation/planning authority only. It grants no
production effect until all four schema files below, their real Draft 2020-12
behavioral tests, and the corresponding runner/verifier are independently
reviewed, merged and green on exact main:

- V1: `docs/schemas/p8v-v1-core-result.schema.json`, with result codes exactly
  `core_verified`, `core_failed`, or `evidence_failed`. Success requires the
  exact ordered five seam records from this plan, all `verified`; failure
  allows a truthful prefix only and forbids a later verified seam.
- V2: `docs/schemas/p8v-v1-preparation-result.schema.json`, with result codes
  exactly `preparation_verified`, `preparation_blocked`, or `evidence_failed`.
  Success requires exact ordered CRM/Inbox/Lead image records, five retained
  production-container records, migration/account/organization/config records,
  two knowledge-audience records and rollback records. Blocked evidence permits
  partial arrays only up to the named blocker and cannot contain a later
  verified record.
- V3: `docs/schemas/p8v-v1-rollout-result.schema.json`, with result codes exactly
  `rollout_verified`, `rollout_failed_rolled_back`,
  `rollout_failed_reconciliation_required`, or `evidence_failed`. Success
  requires the exact ordered pre-state, migration, client import, internal
  import, CRM, Inbox and Lead records. Every changed application has before and
  after records; failure lists the attempted boundary and reverse rollback of
  that boundary plus every earlier changed application. A forward-only
  migration can never be labelled rolled back.
- V4: `docs/schemas/p8v-v1-workflow-result.schema.json`, with result codes
  exactly `workflow_verified`, `workflow_blocked`, `workflow_failed`, or
  `evidence_failed`. Success requires exactly one ordered record for login,
  signed Lead-Agent-owned intake, amoCRM binding, client context, client and
  internal retrieval, draft, staff authorization, non-customer send,
  body-free audit/reconciliation and rollback validation. Every record is
  `verified`; blocked/failed branches are truthful prefixes and require all
  later records to be `not_run`.

V1, V3 and V4 evidence roots contain exactly their single named result JSON.
A successful V2 root contains exactly `v2-preparation-result.json`, the three
named image archives, `portable-image-identity.json`,
`knowledge-build-result.json`, `rollback-capture.json` and
`collection-index.json`; its index contains the six non-index/non-result
artifacts and the result binds the index SHA-256. Neither file self-hashes and
the result is not indexed. A blocked V2 root contains
only `v2-preparation-result.json`. Every root is a new real non-symlink
mode-`0700` directory and every file is a regular non-symlink mode-`0600` file.
Unknown keys, duplicate identities, wrong order/cardinality, impossible phase
progression, a success with a skipped item, or a failure with later effects must
fail schema and runtime validation.

The final handoff includes exact Git/tree/CI,
images, migrations, safe configuration statuses, knowledge counts/hashes,
workflow outcome, audit/reconciliation status, rollback state and remaining
blockers. It excludes secret values, UUIDs, cookies, phones, emails, message or
draft bodies, commands containing credentials, stderr and private paths.

Completion also requires no open rollout PR, clean current-main worktrees,
healthy expected containers, restart count zero after the observation window,
and an explicit statement of every skipped requirement.

### V2.2 final frozen-vault source correction

Before the first P8V2 execution, issue #294 supersedes only the two obsolete
local vault paths in the merged adapter. The exact client source is
`/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО`
and must contain exactly 11 Markdown documents. The exact internal source is
`/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ`
and must contain exactly 291 Markdown documents.

The existing builder remains the authority for canonical marker and path
validation: the client root owns its `evo_client_knowledge` marker, while the
internal approved child is bound to the parent `Внутренняя база знаний ЭВО`
`evo_internal_knowledge` marker. Both inputs are read-only, real non-symlink
directories. The deterministic double-build, process-only account binding,
finally cleanup and UUID-free evidence contract are unchanged. No other P8V2
identity or authority changes.

### V2.3 executable CLI correction

The first exact-main invocation stopped before any operation because the real
CLI import graph was cyclic. Issue #296 moves executable argument handling and
operation construction into `scripts/p8v2-production-preparation-cli.mjs`;
`scripts/p8v2-production-preparation.mjs` remains a pure library and operations
may import it without a reverse runtime import. `npm run p8v2:prepare` keeps the
same arguments and behavior. A subprocess negative freezes the no-authorization
exit code and safe stderr and rejects the prior unsettled-await symptom.

No preparation artifact, candidate tag or external action was produced by the
failed invocation. The original P8V2 authorization and collision-free evidence
identity may be retried only after this correction is reviewed, merged and
green on exact main. No production, provider, import, migration, deployment,
restart, WAHA, amoCRM or customer-data authority changes.

### V2.4 P8V2A nested OCI-index correction

The first effectful P8V2 preparation is retained as a safe blocked attempt. Its
closed result SHA-256 is
`c57ffdd2b572d42d52c5106f7c926dbd89596690f557e4113e45cdd494110c1b`.
Only the local CRM candidate was built, smoked, SBOM-scanned and archived. Its
tag/index ID is
`sha256:de201331d865c025fb6bffb0f991c8ed7acc5390b8ac3c838f61fe6e220f184e`
and archive SHA-256 is
`ae581ea790f38a1316cf7eca1b2bad822806b7772c1520aec681cf9378eef6a6`.
All P8V2 roots and artifacts are immutable. The attempt performed no SSH,
production read/write, migration, knowledge build/import, provider, deployment,
restart, WAHA, amoCRM or customer-data operation.

Current Buildx represents the loaded candidate as an OCI index. Saving it for
linux/amd64 retains a top tag descriptor whose payload is another OCI index
with exactly two children: the linux/amd64 OCI image manifest and the
unknown/unknown BuildKit provenance attestation manifest. P8V2A must validate
that full closed graph, including digest/size/media type, the attestation's
`vnd.docker.reference.digest` binding to the platform manifest, config/layers,
tag annotations, revision/source labels, Docker manifest mapping and exact tar
entry allowlist. The result records the top OCI index digest separately from
the linux/amd64 platform-manifest digest.

The retry identities are exact:

- release: `2026-08-18.p8v2a.1`;
- image version: `p8v2a-0f1454d0-20260818`;
- authorization: `PREPARE-P8V2A-2026-08-18.P8V2A.1`;
- tags: `evo-crm:0f1454d014bbc9eca9d7381dfe557e980965543e-p8v2a-linux-amd64`, `evo-inbox:0f1454d014bbc9eca9d7381dfe557e980965543e-p8v2a-linux-amd64`, and `evo-lead-agent:0f1454d014bbc9eca9d7381dfe557e980965543e-p8v2a-linux-amd64`;
- archives use the same three tag suffixes with `.tar`;
- local roots are `p8v2a-build-*`, `p8v2a-portable-*`, `p8v2a-knowledge-*` and `p8v2a-preparation-*` for the frozen application commit/date;
- remote rollback root is `/opt/evo-release-evidence/p8v2a-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`.

All P8V2 production, privacy, cleanup, configuration, rollback and no-provider
boundaries remain unchanged. P8V2A is not executable until reviewed code is
merged and exact-main CI is green; execution additionally requires its fresh
exact owner token.

### V2.5 P8V2B bounded Lead Agent smoke readiness correction

The exact P8V2A attempt on main
`df29599da8ca7f85354f233c6333d5e018d94977` is retained as immutable failed
evidence. Its result SHA-256 is
`cc902099b2864327897ca278d656f5180c81235cfb0b71f2b1ffb0b5a6401acc`.
All three local images built; CRM and Inbox completed smoke/SBOM/archive; Lead
Agent completed build/SBOM and stopped before smoke/archive. Production
baseline and all later phases remained `not_run`, so no external effect ran.

The exact retained Lead Agent tag maps to
`sha256:73a7f80ac04cab9e56180ac2a3ec2dd6de1acb85a5125170353d24b01d3be26e`.
A real isolated network-none diagnostic proved the expected `/health` response
after approximately one second. P8V2B therefore replaces only the immediate
Lead health assertion with a bounded readiness loop: 30 attempts maximum,
500-millisecond wait between failed attempts, one-second HTTP timeout per
attempt, and exact HTTP-200 JSON
`{"frozen":true,"ok":true,"ready":false,"status":"live"}`. The loop must
also fail immediately if the owned immutable container exits or its identity
drifts. Exhaustion, malformed success responses, restart or cleanup failure is
blocking. CRM and Inbox smoke behavior is unchanged.

The retry identities are exact:

- release: `2026-08-18.p8v2b.1`;
- image version: `p8v2b-0f1454d0-20260818`;
- authorization: `PREPARE-P8V2B-2026-08-18.P8V2B.1`;
- all three tags and archives use `-p8v2b-linux-amd64`;
- local build, portable, knowledge and preparation roots use `p8v2b-`;
- remote rollback root is `/opt/evo-release-evidence/p8v2b-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`.

All P8V2A roots/tags/artifacts remain immutable. P8V2B grants no production,
provider, migration, import, deployment, restart, WAHA, amoCRM, customer-data
or outbound authority. It requires reviewed code, exact-head CI, merge,
exact-main CI and a fresh exact owner token before execution.

### V2.6 P8V2C baseline-observation retry contract

P8V2B result SHA-256
`855ed075be872550322d273f9fb36da0dffccec39b9331e921579e704399779d`
is immutable. It records verified candidate images followed by
`production_baseline_drift`; every later step is `not_run`. Read-only live
inspection independently proves the expected five containers still have the
frozen IDs/images, `healthy`, and restart count `0`.

The exact baseline producer must render each row as
`name|container-id|image-id|health|restart-count` using Docker Go-template
actions in the supported form:

```text
{{.Name}}|{{.Id}}|{{.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{.RestartCount}}
```

One exported parameterized producer must render this exact row expression for
both production's five frozen names and a local five-container fixture. Tests
must byte-check the production rendering and execute the fixture rendering on
macOS through one guarded executor that runs `orb status` and requires
`Running`, then runs `docker context show` and requires exactly `orbstack`,
immediately before every Docker invocation. This includes inventories,
creation, inspection, row rendering, finally cleanup and absence proof; any
check failure stops before that Docker call and no fallback context is allowed.
Each fixture name is collision-free, every container carries one fresh
cryptographic owner nonce, and all five use one verified already-present
immutable local image ID with `--pull never`, network `none`, zero mounts and
restart `no`. The harness must refuse any pre-existing/foreign name, verify
name/ID/image/owner/runtime identity, produce and parse exactly five canonical
ordered rows, then in `finally` remove only verified owned IDs and prove all
owned IDs and names absent. Remote command failure, missing health, malformed
cardinality/order, identity drift, foreign-name occupation, restart or cleanup
drift remains blocking. Source-fragment-only assertions are insufficient.
Behavioral command-sequence tests must prove every Docker call has those two
immediately preceding checks and that context drift prevents the next Docker
command even during cleanup.

Writable identities advance exactly to release `2026-08-18.p8v2c.1`, version
`p8v2c-0f1454d0-20260818`, token
`PREPARE-P8V2C-2026-08-18.P8V2C.1`, `-p8v2c-linux-amd64` tags/archives,
`p8v2c-` local roots, label `evo.p8v2c.owner`, and remote rollback root
`/opt/evo-release-evidence/p8v2c-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`.
All P8V2B paths/tags/artifacts are immutable. No production mutation, migration,
import, provider, deploy, restart, outbound, WAHA, amoCRM or customer-data
authority is introduced. Retry requires reviewed merge, exact-main green CI and
the new exact owner token because the reviewed execution code changed.

### V2.7 P8V2D CRM/Inbox smoke readiness retry contract

The P8V2C result SHA-256
`b22ab4614f893a0577d42976612e00cc4b74466886d27c31cf49f03d41642c2a`
is immutable. It records `candidate_images` / `candidate_build_failed`, with
production baseline and all later phases `not_run`; no production/provider
effect occurred. P8V2C roots, artifacts and tags must not be changed or reused.

For `main_crm` and `evo_inbox`, the runner performs at most 30 health probes.
Each probe has a one-second timeout. Before every probe the exact container ID,
immutable image ID, owner nonce and running state are required. Exit code `3`
is the sole transient connection/startup state and is followed by exactly 500
milliseconds before another attempt. Exit code `0` is accepted only for HTTP
200 and the existing exact service JSON. Exit code `2`, any other exit code,
container exit, ownership/image/restart drift, attempt exhaustion,
OrbStack/context drift or cleanup failure is terminal. Finally cleanup remains
bound to the exact owned container ID and proves absence.

Writable identities are exactly release `2026-08-18.p8v2d.1`, version
`p8v2d-0f1454d0-20260818`, token
`PREPARE-P8V2D-2026-08-18.P8V2D.1`, `-p8v2d-linux-amd64` tags/archives,
`p8v2d-` local roots, label `evo.p8v2d.owner`, and remote rollback root
`/opt/evo-release-evidence/p8v2d-rollback-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`.
All application, knowledge, production, privacy, rollback and no-provider
boundaries are unchanged. Retry needs reviewed merge, exact-main green CI and
one fresh exact owner token because execution code changed.

## P8V2E correction — independent readiness after P8V2D stop

P8V2D retained immutable UUID-free result SHA-256
`a050cd16b1d48fa089031bc3a4240b8e55f3b492c89addc7376d8016de5e63b7`.
It verified candidates, production baseline, migration ledger and rollback,
then stopped at identity resolution with every later effect absent. P8V2E does
not repeat or replace those components.

P8V2E validates that exact result as a regular mode-`0600` closed-schema file
and scans its untouched bytes for UUIDs, credentials, contacts and private
paths. It validates both frozen vault sources independently of account binding
using the existing canonical marker/root, symlink, UTF-8, Markdown, PII and
forbidden-root rules. The deterministic source-set projection contains only
`{source_path, source_sha256}` records. Every `source_path` is the existing NFC
normalized POSIX-relative path, records are sorted by that exact path, object
keys are lexicographically sorted, and the array is serialized as UTF-8 JSON
with `ensure_ascii=false`, separators exactly `(',', ':')`, no indentation and
one final LF byte. The SHA-256 is over those exact bytes. A golden behavioral
test must reproduce both frozen hashes from the real helper and reject changed
order, Unicode normalization, escaping, separators or missing final LF. Exact
safe outputs are client
count `11`, SHA-256
`c8dcfdd7911fdf2b97204c5d843dbf45f701d5dbee72e78cfaea17ea7ab18689`,
and internal count `291`, SHA-256
`1bd7458ff70c0a31fde9f6bb1abfb7ec0152c1f286caf2a1de48081860121f9f`.
No bundle, manifest or report containing an account UUID is produced unless a
later authorized operation has a singular live account.

Identity observation uses the process-only `SUPABASE_ACCESS_TOKEN`. Project
status comes separately from `GET /v1/projects/iosckaqtovbbnssqcpde` and must
be HTTP `200` with bounded raw bytes that parse as an object. Its official
`ref` field must be the fixed project reference and `status` must be
`ACTIVE_HEALTHY`; missing/wrong types or values block. Other official response
fields are ignored and only safe reference-match/status values enter evidence.
Identity rows come only from
`POST /v1/projects/iosckaqtovbbnssqcpde/database/query/read-only`; request JSON
has exactly the `query` key, the response must be HTTP `201`, and the bounded
body must be an array of at most four closed `{kind,id}` rows. `kind` is exactly
`account` or `organization`; `id` must be a canonical UUID. The schema-qualified
SQL returns at most two distinct active `public.ai_configs.account_id` rows and
two `platform.organizations.id` rows where `status = 'active'`.
Received UUIDs remain in memory only. Evidence uses only `none_active`,
`exactly_one_active` or `multiple_active`, plus exact-production project status.
Transport, HTTP, body, row-shape or cardinality drift blocks without fallback
to PostgREST or a guessed identity.

The Hermes configuration observation reads only the existing exact env paths.
When a singular identity exists, its UUID and the fixed Supabase URL are sent
only as a bounded three-line SSH stdin frame to a fixed `bash -seu` script;
stdin is not command text or an environment variable, shell tracing is never
enabled, and the script validates framing before reading root-only files. The
remote comparison emits only booleans, `not_comparable` and closed blocker
codes. Malformed/duplicate env entries and an amoCRM token file that is not an
approved-contained regular non-symlink root-owned mode-`0600` file block.
Transport/parse failure uses `configuration_observation_failed`, never a
fabricated settings result. Tests use UUID sentinels and require their absence from argv, stdout,
stderr, exceptions and retained bytes.
It records the closed root-CRM, Lead-Agent and manual-worker blocker codes and
presence/format statuses defined by V2, never values. Identity equality is
`true` or `false` only when the corresponding identity is singular and is
otherwise `not_comparable`. The observation does not create or edit any env
file, organization, account, token or service.

The result schema path is
`docs/schemas/p8v2e-independent-readiness-result.schema.json`. The retained root
is exactly
`.evo-release-evidence/p8v2e-readiness-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`
and contains only `readiness-result.json`, a regular mode-`0600` file. Result
codes are `readiness_verified`, `readiness_blocked` and `evidence_failed`.
Verified requires exact retained P8V2D, both source sets, singular account and
organization, exact project and zero configuration blockers. Blocked requires
at least one closed readiness blocker while retaining all other completed
independent records. Closed blocker codes include retained-result SHA/mode/
schema/privacy drift; client/internal marker, root, count, source-set hash,
symlink, UTF-8, Markdown, PII and forbidden-root drift; Management API project,
transport, HTTP, body, row/cardinality drift; and the existing configuration
blockers. `evidence_failed` is reserved for failure to publish or remove the
single local result safely. Atomic write, final allowlist/mode/hash/schema/privacy
verification and partial-file cleanup are mandatory. The runner binds its own
clean current-main commit/tree and singular successful exact-main push CI plus
the exact frozen application commit/tree; it fails before remote reads if any
execution identity drifts.

The exact token is `PREPARE-P8V2E-2026-08-18.P8V2E.1`. It grants only the
described read-only local/Management-API/SSH checks and safe local evidence
write. It grants no Docker command, candidate mutation, rollback rewrite,
migration/import, provider call, deployment, restart, WAHA/amoCRM mutation,
outbound send, Auth change or customer-data access. Implementation, behavioral
negative tests, independent review, merge and exact-main CI must precede use.

## P8V2F — existing-project Supabase connection

P8V2F resolves only the observed Supabase connection blockers before the final
minimal rollout preflight. Fixed project ref and URL are the existing managed
production project. The safe pre-state is exactly one Auth user, one active
knowledge account, zero Platform organizations/profiles/active memberships,
ledger `001-076`, project `ACTIVE_HEALTHY`, exposed schemas exactly
`public,graphql_public`, and an existing regular non-symlink root-owned
mode-`0600` `/opt/evo-crm/.env.production` missing all five target settings.
An exact prepared retry may instead begin with the canonical exposed schemas,
one matching `EVO Admissions` organization/Admin/bootstrap audit, and all five
Hermes settings equal to the same process-only values. No mixed or partial
state is accepted.

The only Management API mutation is PATCH of `db_schema` to the canonical set
`public,platform,graphql_public`. The only database mutation is the existing
`platform.bootstrap_organization_admin` RPC with exact organization name
`EVO Admissions`, display name `EVO Admissions Admin`, fixed reason
`P8V2F production Platform bootstrap`, the singular Auth user and a
deterministic idempotency UUID derived in process from the exact authorization
token. Both publishable and secret keys must first succeed against the exact
project `/auth/v1/settings` endpoint; format-only acceptance is forbidden. All
HTTP bodies are streamed under `65536` bytes with redirect rejection and a
15-second deadline. The RPC response remains process-only. Post-state read-only SQL must
bind the same user to exactly one active Admin membership, require the matching
organization/bootstrap audit row, and retain no UUID. A second call with the
same deterministic request ID must replay the exact safe RPC projection and is
the service-role Data API privilege/idempotency proof; direct service-role table
SELECT is forbidden because migration `041` intentionally grants table SELECT
only to authenticated staff.

The Hermes writer accepts one bounded JSON frame on stdin, rejects extra keys,
duplicates, malformed key formats and partial/different target settings, then
atomically adds exactly the URL, publishable key, secret key, organization ID
and knowledge account ID. An exact all-present retry is accepted only when the
mode-`0600` rollback bytes contain none of the target keys and deterministically
reconstruct the current env byte-for-byte when the five settings are reapplied.
The original env is copied with mode `0600` into the
exact absent `/opt/evo-release-evidence/p8v2f-supabase-bootstrap-20260819`
mode-`0700` root. No secret rollback file leaves Hermes. Failure before the RPC
must restore every changed external setting and verify restored bytes, owner and
mode. Restore failure blocks. Failure after a verified RPC but
before verified Hermes configuration is `configuration_reconciliation_required`.
Once the bootstrap RPC is attempted, any lost/timeout/malformed response is
potentially committed: the runner must reread identity/audit state before any
PostgREST restoration. It preserves canonical schemas when exact prepared state
is observed, restores the old schemas only when readback definitively proves
zero organizations, profiles and memberships, and otherwise requires
reconciliation.

The local result root is exactly
`.evo-release-evidence/p8v2f-supabase-bootstrap-20260819`, real mode `0700`,
with sole regular mode-`0600` `p8v2f-supabase-bootstrap-result.json`. Closed
result codes are `supabase_prepared`, `configuration_failed`,
`configuration_reconciliation_required`, and `evidence_failed`. Success
retains only fixed names, counts, booleans, status enums and the SHA-256 of the
server rollback copy; it forbids UUID, key, email, token, env contents, private
paths and provider/customer data. No migration, import, provider, application
deployment/restart or feature-enable authority is included.
If normal result publication fails, the runner makes one bounded attempt to
retain the same safe state with result code `evidence_failed`; inability to
write the safe root remains a blocking `evidence_failed` exit and is never
reported as configuration success.

## P8V2G: PostgREST propagation retry

P8V2F is an immutable failed attempt, not an authorization to retry. Its exact
safe result SHA-256 is
`706dc7f9cdfb88b383a0e6e3314925bfdec7fe741f74acbfcbb700fdb7eddf6c`;
the result and post-attempt checks require old schema exposure restored, zero
application organization/profile/membership/audit rows, zero Hermes settings,
and zero migration/import/deploy/restart/provider/outbound effects. Its token
is consumed and its evidence roots must remain unchanged.

For P8V2G, `bootstrap_organization_admin` retains the exact deterministic
request ID and body. After the successful Management API schema PATCH, the
caller uses one monotonic 30,000 ms readiness deadline and no more than 12 RPC
attempts. Between attempts it waits exactly 1,000 ms, and only when the prior
response was fully received below the existing 64 KiB ceiling, parsed as JSON,
had HTTP status `406`, and had exact string field `code: "PGRST106"`.
Every attempt must use the identical URL, method, headers and serialized body.
The final successful response remains exact HTTP `200` with the existing safe
projection. The readiness error body is process-only and never enters retained
evidence.

An HTTP `406` with any other/missing code, another HTTP status, malformed or
oversized JSON, redirect, transport rejection, timeout, insufficient remaining
deadline, twelfth eligible `PGRST106`, or changed request bytes is immediately
terminal. It is never treated as generic transient traffic. Because a
transport failure or non-readiness response may be ambiguous, the existing
`rpcAttempted` readback-before-restoration logic remains mandatory. Exact
zero-state permits restoration of `public,graphql_public`; exact prepared state
permits reconciliation; every other state blocks.

P8V2G freezes version `p8v2g-supabase-bootstrap-result/v1`, authorization
`CONFIGURE-P8V2G-2026-08-19.P8V2G.1`, remote root
`/opt/evo-release-evidence/p8v2g-supabase-bootstrap-20260819`, local root
`.evo-release-evidence/p8v2g-supabase-bootstrap-20260819`, and sole result
`p8v2g-supabase-bootstrap-result.json`. Remote temporary env names also advance
to P8V2G. Every other P8V2F identity, privacy, rollback, failure-publication and
authority rule is inherited unchanged. No production use is allowed before
issue #309 implementation review, exact-head CI, merge, exact-main CI, final
read-only preflight, and the fresh exact P8V2G token.

## P8V2H explicit PostgREST cache reload

The retained P8V2G result SHA-256 is
`63049414f61ba895e20ebf5900d2badcf0b306635f574fad7fddb77aebc89514`.
It is immutable failed-attempt evidence: original schemas restored, identity
rows absent, Hermes settings absent and unrelated effects zero. Its token is
consumed.

After each successful `PATCH /v1/projects/{ref}/postgrest`, P8V2H must call
exactly once:

```text
POST /v1/projects/{ref}/database/query
{"query":"NOTIFY pgrst, 'reload config'; NOTIFY pgrst, 'reload schema';","read_only":false}
```

The request uses the existing process-only Management API token, HTTPS,
redirect rejection, a 15-second timeout and the existing streamed 64 KiB
response ceiling. Only HTTP `201` plus bounded valid JSON is success. The SQL
and body are constants; no parameter, interpolation, migration, DDL or business
data statement is accepted. The reload completes before the first bootstrap
RPC attempt. The RPC retains P8V2G's exact reason and deterministic request ID;
only the P8V2H action-time authorization changes. If exact zero-state permits
restoration, the original PostgREST schema PATCH is followed by the same fixed
reload before `restored` evidence.

Tests must execute the real request seam and prove exact ordering
`PATCH after -> reload -> RPC`; exact rollback ordering `PATCH before -> reload
-> initial-state readback`; one reload per successful PATCH; rejection of path,
method, SQL, body, status, JSON, redirect, timeout and size drift; and no reload
when a PATCH fails. Ambiguous bootstrap completion still enters live readback
before any restoration.

P8V2H freezes version `p8v2h-supabase-bootstrap-result/v1`, authorization
`CONFIGURE-P8V2H-2026-08-19.P8V2H.1`, remote root
`/opt/evo-release-evidence/p8v2h-supabase-bootstrap-20260819`, local root
`.evo-release-evidence/p8v2h-supabase-bootstrap-20260819`, result
`p8v2h-supabase-bootstrap-result.json`, and P8V2H-only Hermes temporary names.
The runner accepts the token only through process-only
`EVO_P8V2H_AUTHORIZATION`; the P8V2G variable/token pair is rejected.
All other P8V2G identity, key, privacy, rollback, evidence and authority
boundaries remain unchanged. No production use precedes issue #312 review,
exact-head CI, merge, exact-main CI, one final read-only preflight and the fresh
exact P8V2H token.
## P8V3D migration reconciliation contract

P8V3D is a continuation of the reviewed P8V3 rollout after one forward-only
effect. The immutable failed result is
`d38283828f3b2d51c063e85617b6732be7a2a44f4cb00bd36d2aaa8051467db7`, and the
immutable configuration rollback root is
`/opt/evo-release-rollback/2026-08-20.p8v3.1`. Both remain untouched.

The exact entry state is:

- managed migration ledger: ordered contiguous `001-077`, count `77`;
- five frozen production containers: exact preflight IDs/images, healthy,
  restart count zero;
- CRM target configuration restored and manual-worker env absent;
- prior P8V3 release root absent;
- client/internal imports, CRM/Inbox/Lead Agent deployment, WAHA changes,
  amoCRM writes, WhatsApp sends and staff drafts: zero.

The shared migration normalizer keeps its historical default boundaries and
adds an explicit closed accepted-last-version input. P8V3D passes only
`["077"]`; malformed, duplicate, unordered, gapped, earlier or later ledgers
fail before any production effect.

P8V3D preflight version is `p8v3d-production-preflight/v1`. Its migration
record is exactly `versions=001..077`, `range=001-077`, `count=77`. The rollout
migration phase performs only bounded read-only Management API queries. It
must verify the same ledger and the migration-077 table/functions plus exact
service-role execution and anon/authenticated denial boundaries. It returns:

```json
{"status":"verified","before_range":"001-077","before_count":77,"after_range":"001-077","after_count":77,"applied_versions":[]}
```

The object/grant proof uses only the official schema-qualified Management API
`POST /v1/projects/iosckaqtovbbnssqcpde/database/query/read-only`, requires
HTTP `201`, applies the existing bounded JSON response limit, and accepts
exactly one closed row of booleans. The row proves the provider-binding table
and the exact claim/sync/finish function signatures exist; `service_role` has
function execute, `anon` and `authenticated` do not; and none of those three
roles has direct table privileges. Missing/extra rows or fields, non-booleans,
or any false expected assertion block the migration step. No identifiers,
table contents or customer data enter the response or retained evidence.

No Supabase link role, CLI push, SQL execution, migration repair or history
mutation is permitted in that phase. A mismatch is `migration_failed`, leaves
all later steps `not_run`, and triggers the existing configuration rollback and
closed evidence publication.

P8V3D uses release `2026-08-20.p8v3d.1`, version
`p8v3d-0f1454d0-20260820`, importer `evo-p8v3d-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3d-20260820.1`, remote result
`p8v3d-rollout-result.json`, and exact authorization
`EXECUTE-P8V3D-2026-08-20.P8V3D.1`. The authorization remains unavailable
until the implementation PR is independently approved, merged, final current
main CI is green and a fresh preflight is approved. All P8V3 knowledge,
privacy, provider, deployment, rollback and real-post-deploy V4 proof
boundaries remain unchanged.

## P8V3E public knowledge-schema and cleanup contract

P8V3E preserves the immutable P8V3D failed result at local/remote SHA-256
`d6c7174de9a56d53e9c30d498a1423cb3ad698869c1845155934d826fa90cfc3`.
Before another attempt, read-only reconciliation must prove exact ledger
`001-077`/count `77`, no client bundle revision/document/chunk, exactly the
pre-existing two internal documents/26 internal chunks, restored configuration,
absent P8V3D release root/importer, and the same five healthy restart-zero
container/image identities. A mismatch blocks.

The production adapter must use `Accept-Profile: public` for both reads below:

- singular active `ai_configs.account_id` resolution;
- account/audience-bound `ai_knowledge_bundle_revisions` verification.

No fallback profile, implicit schema or cross-schema retry is allowed. The
request path, query cardinality and safe result projection remain closed.
This follows the official PostgREST schema-selection contract for `GET`/`HEAD`:
<https://postgrest.org/en/v11/references/api/schemas.html#get-head>.

Knowledge cleanup must first inventory the exact importer name and exact
knowledge-staging path. If neither was created, their proven absence is a
successful cleanup. If the directory exists, it must be a real non-symlink
directory beneath the exact release root; only the reviewed bundle/manifest
files may be removed, then directory emptiness and importer absence are proved.
Any symlink, non-directory replacement, unexpected entry, foreign importer,
failed removal or non-empty result is blocking. Local UUID-bearing build roots
remain finally-removed and absence-verified.

The retry identities are release `2026-08-20.p8v3e.1`, version
`p8v3e-0f1454d0-20260820`, importer `evo-p8v3e-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3e-20260820.1`, result
`p8v3e-rollout-result.json`, preflight `p8v3e-production-preflight/v1`, and
authorization `EXECUTE-P8V3E-2026-08-20.P8V3E.1`. The consumed P8V3D token is
invalid. A reviewed merge, final-tree CI, fresh minimal preflight and new owner
authorization are mandatory before any effect.

## P8V3F process-only Gemini credential and retry contract

P8V3F preserves the complete P8V3E local and Hermes evidence at exact SHA-256
`328dd56efc616b1492b42c399651733186a5167e8214798b8e21eef5f60fa185`, its
release root and its rollback root. Before another attempt, reconciliation must
prove the same `001-077` ledger, zero client revisions/documents/chunks, exact
two internal documents/26 chunks, restored configuration, absent P8V3E
importer, and the five unchanged healthy restart-zero containers. No P8V3E
artifact may be overwritten, removed or relabelled.

The sole new credential input is environment `GEMINI_API_KEY`, injected by the
encrypted Personal Secrets Vault into the controller process. The value must
be a single non-empty line of 16 through 512 bytes. It is prohibited from Git,
argv, filesystem staging, command labels, stdout, stderr and evidence. The
controller must reject the key value if it appears in any captured provider,
SSH or publication output. The absence of a configured project spend cap is an
owner-accepted billing risk for this retry; it does not weaken request count,
timeout or content bounds.

The final preflight performs exactly two no-retry HTTPS requests using the key
only in `x-goog-api-key`, with redirect rejection, 15-second timeout and a
streamed 64-KiB response ceiling:

1. one `models/gemini-embedding-2:batchEmbedContents` request containing only
   exact literal text `title: EVO P8V3F readiness | text: EVO P8V3F readiness
   probe`, no `taskType` field, and output dimensionality `1536`; HTTP 200 and
   exactly one finite 1536-number vector are required;
2. one `models/gemini-3.5-flash:generateContent` request containing only an
   instruction to return JSON `{\"reply\":\"READY\",\"handoff\":false}` with
   temperature `0`, candidate count `1`, maximum output tokens `32`, JSON MIME
   type and a closed two-field response schema; HTTP 200 and that exact parsed
   object are required.

The preflight result adds exactly `gemini.embedding_verified: true` and
`gemini.draft_verified: true`; it contains no provider response body, usage,
project identity, key fingerprint or content. Either request failure blocks
before staging, Supabase, Hermes configuration, import or deployment.

Official Embedding 2 guidance states that `task_type` is unsupported and that
retrieval documents use `title: {title} | text: {content}` in the prompt:
<https://ai.google.dev/gemini-api/docs/embeddings#task-types>. The P8V3F import
helper therefore removes the request `taskType` property and transforms only
the provider embedding input for each chunk to exact
`title: ${document.title} | text: ${chunkContent}`. Stored document/chunk
content and hashes remain the original unprefixed approved bytes.

The final clean execution checkout builds
`.next/platform-knowledge-import.mjs` twice into two private temporary roots
with the repository's fixed esbuild command. Both regular files must be
byte-identical, non-empty and at most 4 MiB. Preflight retains only exact
`importer.sha256`, `importer.size` and `importer.verified: true`. Execution
rebuilds once and requires exact SHA-256/size equality to the fresh preflight,
then transfers it as `${RELEASE_ROOT}/p8v3f-platform-knowledge-import.mjs`.
Hermes requires root:root mode 0600 and exact hash; the importer receives it at
`/tmp/p8v3f-platform-knowledge-import.mjs`, verifies exact hash, runs its
closed runtime probe, and uses that absolute file for both audience imports.
It never executes the older helper embedded in the unchanged CRM image. Every
local/remote/container helper copy is removed or retained only inside the
already private new release root according to the existing cleanup/evidence
rules; no P8V3E path is touched.

Configuration uses one fixed `ssh ... bash -seu` command and sends the key as
the sole newline-terminated stdin field. The remote script rejects missing,
extra-line or invalid input before writes, removes the key from its inherited
environment after reading, and parses the existing root CRM and Lead Agent
files with duplicate/malformed-row rejection. Under the new root-owned mode-
0700 rollback directory it records exact root-owned mode-0600 copies of
`env.production.before` and `env.lead-agent.before`, plus the existing
manual-worker prestate/copy rules. It then atomically writes root-owned mode-
0600 files so the Lead Agent has exact `GEMINI_API_KEY` and CRM has exact
`EVO_PLATFORM_GEMINI_API_KEY`, along with the already reviewed staff-assistant,
manual-worker and sync flags. Readback must prove both installed values equal
the process-only input without emitting either value.

Rollback restores both environment files and the worker prestate from the
exact retained bytes, then verifies their SHA-256, owner and mode. A missing,
foreign, symlinked, malformed or mismatched backup is blocking. Configuration
evidence retains only the existing installed-name set, one SHA-256 over the
ordered pair of pre-change file bytes, and safe verification booleans.

P8V3F freezes release `2026-08-20.p8v3f.1`, version
`p8v3f-0f1454d0-20260820`, importer `evo-p8v3f-knowledge-import`, release root
under the same immutable application commit, rollback root under that release
ID, evidence root `/opt/evo-release-evidence/p8v3f-20260820.1`, sole result
`p8v3f-rollout-result.json`, preflight `p8v3f-production-preflight/v1`, and
authorization `EXECUTE-P8V3F-2026-08-20.P8V3F.1`. The P8V3E token is invalid.
No production effect is permitted before issue #331 implementation, scoped
tests, independent approval, merge, final-tree CI, the fresh two-probe minimal
preflight and the exact new owner token.
