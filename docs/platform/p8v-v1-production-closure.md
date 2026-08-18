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
