# ADR 0021: Run a net-new unified pilot with human-reviewed Gemini Flash

- Status: accepted
- Decision date: 2026-08-25 (Asia/Bishkek)
- Decision owner: EVO product owner
- Parent product contract: GitHub issue #376
- Supersedes in conflict: ADR 0020 active-data migration timing and generic AI-provider wording
- Execution program: GitHub issues #382 through #387; stop before #388
- Starting repository baseline: `cfc75ca29a66546886de320aa80c454d18104b92`
- Execution contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Decision log: `docs/PLAN_CHANGES.md`

## Context

ADR 0020 correctly established one EVO product and Supabase as canonical, but
its pre-pilot plan still required broad migration of active legacy data. That
would mix migration risk with proof of the new workflow and encourage runtime
compatibility paths. The owner instead selected a small net-new pilot whose
normal work starts and remains in EVO.

The earlier repository also contains several AI/provider generations. The
pilot needs one bounded operator-assistance path with a clear privacy and
consequence boundary, not a provider mesh or autonomous actor.

## Decision

### One product and one operational authority

EVO remains one internal product with one login, staff UI, role/permission
model and canonical client/case/workflow. Sales, Inbox, Lead Processing,
Admissions, Documents, Applications, Visa, Finance Control, Tasks, AI and
Administration are modules, not separate products.

Supabase/PostgreSQL owns pilot operational identity and state. Supabase Auth,
RLS, private Storage and server-side functions enforce that authority. SQLite,
dual-read, dual-write, write-through, fallback repositories and a second
operational source of truth are prohibited.

WAHA is a private WhatsApp transport adapter. amoCRM is legacy/read/import
only. Neither may receive normal pilot operational writes.

### Net-new pilot cohort

Pilot membership is derived from an explicit cutoff for new canonical cases or
an authorized, reasoned small allowlist. Membership and every inclusion/removal
carry provenance and immutable audit evidence.

Existing active and historical legacy cases do not enter automatically. They
stay outside the pilot or read-only until separately approved work after the
pilot. A specifically approved case may receive one bounded, provenance-
recorded identity/context import; that is not a live compatibility path.

Issue #387 implements cohort/legacy isolation, not a broad migration. Issue
#391 owns post-pilot historical/archive work after #390.

### One human-reviewed Gemini Flash adapter

The pilot uses only the stable `gemini-3.7-flash` model ID, verified from the
official model page on 2026-08-25 and pinned explicitly rather than through a
floating alias. The adapter is server-side and produces structured suggestions
that application code validates as untrusted input.

Every suggestion remains attached to its source case/conversation, identifies
source references, model and generation time, exposes uncertainty/limitations,
and requires an authorized human Accept, Edit or Reject decision. Acceptance
still leaves a draft; a separate deterministic action is required for any
consequential change.

Gemini never sends WhatsApp, writes amoCRM, changes stage/owner, confirms
payment, decides a document, completes a task, executes a handoff or performs
another external mutation. There is no Anthropic or multi-provider fallback.
Provider absence or failure is a truthful blocked state.

For privacy, requests are minimized to necessary source fragments, contain no
secrets/raw histories/attachments, avoid stateful storage and file/caching
features, and set `store: false` where the Interactions API is used. Before any
real customer data is permitted, the selected Cloud project/tier and applicable
terms must be separately approved. Long-run 1 authorizes only minimal sanitized
synthetic verification with an existing valid credential.

### Merge evidence

For #382 through #387, an independent GitHub Reviews API `APPROVED` record is
not mandatory. Each merge still requires the exact head SHA, exact-diff
self-review, all required exact-head CI, `--match-head-commit`, exact-main CI
verification and immutable issue evidence. A new head invalidates earlier CI
evidence.

## Deferred until after the pilot

- #388 truthful readiness, audit, backup and rollback;
- #389 real managed receive-only acceptance;
- #390 ten workdays and at least five real pilot cases;
- #391 historical/archive migration;
- broad active-data migration, outbound WhatsApp, amoCRM writes, autonomous AI,
  Student Portal, full accounting/payment processing and production rollout.

## Consequences

- The pilot can prove the new workflow without inheriting broad migration risk.
- Legacy systems cannot become a silent runtime fallback.
- AI value is visible to operators without granting model output authority.
- Local and synthetic provider proof remain explicitly weaker than managed or
  production proof.

## Official primary sources verified 2026-08-25

- Gemini 3.7 Flash stable model and capabilities:
  <https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash>
- Gemini structured output and its supported JSON Schema subset:
  <https://ai.google.dev/gemini-api/docs/structured-output>
- Gemini zero-data-retention controls and `store: false` requirement:
  <https://ai.google.dev/gemini-api/docs/zdr>
- Gemini API paid-service data terms:
  <https://ai.google.dev/gemini-api/terms>
- Supabase RLS/grant requirements for exposed tables:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase private Storage access control:
  <https://supabase.com/docs/guides/storage/security/access-control>
- Supabase Storage schema/API mutation boundary:
  <https://supabase.com/docs/guides/storage/schema/design>
