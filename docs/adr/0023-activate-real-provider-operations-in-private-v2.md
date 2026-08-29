# ADR 0023: Activate real provider operations in private V2

- Status: Accepted
- Date: 2026-08-29
- Decision owners: EVO owner
- Supersedes: the no-real-provider-call, no-outbound-WhatsApp and no-amoCRM-
  write restrictions of ADR 0022 for active issues #464-#467 only
- Preserves: ADR 0022 self-hosted PostgreSQL architecture, fixed-role model,
  private local contour, replace-not-layer discipline and frozen V1 boundary

## Context

The V2 foundation completed under #407 and #424-#433 proves the main CRM on
real local PostgreSQL, Drizzle migrations, the two-field development gate,
three fixed technical roles, private files, canonical Sales/Admissions
workflows, staff WhatsApp reads and a human-reviewable Gemini proposal model.

That foundation deliberately stopped before real provider use. Gemini was
present but locally blocked, WAHA exposed only a read-only session preflight,
and the active V2 amoCRM path was read-only. Manual-send and autonomous legacy
paths were removed rather than retained as dormant fallbacks.

On 2026-08-29 the owner changed that boundary. The goal is now to validate the
heavy CRM product with the existing connected Gemini, WAHA and amoCRM accounts,
not to keep building a provider-free shell. The owner authorized:

- real Gemini use without an artificial call-count or cost gate;
- a permanent staff-controlled WhatsApp outbound capability;
- permanent amoCRM writes, including the contact, lead, link, pipeline/status,
  responsible-user, note and tag operations required by the workflow;
- continued execution without routine per-call confirmation inside this
  decision;
- one minimized existing real conversation/case for truthful provider
  acceptance.

Full machine access is not the architecture authority for those side effects;
this ADR and parent #463 are. The authorization does not deploy V2 over V1,
run a frozen V1 sender/writer, migrate historical data or approve cutover.

## Decision

### 1. Keep PostgreSQL as the only business authority

Canonical V2 people, leads, conversations, messages, cases and business
transitions remain authoritative in PostgreSQL. Provider calls are explicit
commands derived from and correlated back to that state.

WAHA transport state and amoCRM entity IDs are provider bindings/evidence. They
do not create a second workflow authority. There is no dual read/write,
write-through compatibility path, fallback repository or shadow runtime.

### 2. Keep Gemini advisory and exercise it for real

The existing server-only `@google/genai` Interactions adapter is the only V2
proposal path. It uses one explicitly configured model, `store: false`,
synchronous execution, disabled tools and structured JSON. EVO treats the
response as untrusted input, validates it and stores only a valid proposal.

An authorized staff role must Accept, Edit or Reject the proposal. Gemini
cannot invoke WhatsApp, amoCRM or another consequential command. A completed
command receipt replays instead of issuing a duplicate provider call. There is
no arbitrary call-count limit in the architecture; calls still need a real
product purpose and exact authorized context.

### 3. Add one human-controlled WAHA outbound path

V2 adds one server-only WAHA adapter for the official `POST /api/sendText`
operation and one send command on the canonical conversation UI.

Immediately before send, the server rechecks the fixed role and current
conversation ownership. The exact final text may be staff-authored or taken
from an accepted/edited Gemini proposal. The command persists one unique send
intent and request identity in PostgreSQL before the network call.

A successful response records the provider message identity. WAHA message
creation and ACK/delivery progression are reconciled into the same canonical
outbound state. Exact request replay returns the stored outcome; changed
payload reuse conflicts. A timeout or lost response becomes an explicit
unknown state and must be reconciled before any retry. No autonomous reply,
broadcast, alternate sender, retry-until-success worker or fallback route is
allowed.

### 4. Add one PostgreSQL-authoritative amoCRM writer

V2 adds a new canonical server-only amoCRM integration. It does not revive the
legacy SQLite/Supabase writer. Before writing, the integration discovers the
real account, pipeline, status, responsible-user, custom-field and existing
entity metadata and persists explicit mappings/provider bindings.

Server-authorized product commands may:

- create and update contacts and leads;
- link the intended contact and lead;
- set the required pipeline, status and responsible user;
- create or apply the required notes and tags.

Every command has a durable PostgreSQL identity and provider result/read-back.
Exact replay is idempotent. Changed request content conflicts. Rate limits,
invalid mappings, insufficient rights, expired credentials and provider errors
stay visible. An ambiguous response is reconciled before retry so it cannot
silently duplicate a contact, lead, note or transition.

OAuth access and refresh values remain server-only. They are not stored in
business tables, browser state, logs, Git, issues or PR evidence. Refresh-token
rotation must be atomic and fail closed.

### 5. Use existing providers and minimum real context

The program uses the already connected Gemini, WAHA and amoCRM accounts. It
does not create paid infrastructure. Secrets are injected from ignored local
files or the authorized secret workflow and are never copied into the repo or
chat.

Real provider acceptance may use the minimum fields and bounded transcript
context from one owner-authorized existing real conversation/case. Private
identifiers remain outside GitHub evidence. There is no broad import, customer
dataset copy, historical migration, fake/demo business record or fixture-only
acceptance. If an exact safe case cannot be resolved, acceptance is blocked
rather than performed against an arbitrary customer.

### 6. Preserve the frozen V1 boundary

The new V2 adapters may exercise the shared external provider accounts within
the approved canonical commands. They must not import, execute or bundle the
frozen V1 sender/writer; change V1 containers, routes, webhooks, deployment
files or data authority; deploy V2 publicly; migrate historical customers; or
perform cutover.

Historical ADRs, migrations, runbooks, archived docs, evidence and other
decision/rollback documentation remain preserved and inert.

## Execution sequence

1. #464 — real Gemini provider acceptance.
2. #465 — canonical human-reviewed WhatsApp outbound.
3. #466 — PostgreSQL-authoritative amoCRM writes.
4. #467 — real provider end-to-end acceptance.

Each child is a small sequential PR. It requires independent plan-freshness
and implementation review, exact-head CI, `gh pr merge --match-head-commit`
and exact-main verification before the next child starts.

## Failure and evidence contract

- Missing/invalid credentials, a non-`WORKING` WAHA session, provider denial,
  an unresolvable case, missing amoCRM mapping, malformed response or timeout
  is a named blocked/error/unknown state, not fake success.
- Real provider, application, PostgreSQL and Chromium evidence is required for
  every operational claim.
- Provider/customer values are redacted from issue/PR evidence while stable
  local receipts and provider IDs prove correlation.
- After real proof, the same slice removes superseded active code, imports,
  dependencies, env/config, routes, scripts and implementation tests. A scoped
  inventory must prove that no legacy or fallback path remains.

## Alternatives rejected

- **Keep provider use acceptance-only.** Rejected because WhatsApp outbound and
  amoCRM writes are permanent CRM capabilities, not one-time diagnostics.
- **Revive the legacy writer or manual-send worker.** Rejected because it would
  restore the SQLite/Supabase-era authority and violate replace-not-layer.
- **Let amoCRM become canonical again.** Rejected because it would create dual
  authority and make the self-hosted V2 replacement incoherent.
- **Allow Gemini or a background worker to send.** Rejected because human
  review is the action authority.
- **Use fake provider responses or synthetic business acceptance.** Rejected
  because the goal is to verify the real heavy product path.

## Official provider contracts

- WAHA send, sessions, events and security:
  <https://waha.devlike.pro/docs/how-to/send-messages/>,
  <https://waha.devlike.pro/docs/how-to/sessions/>,
  <https://waha.devlike.pro/docs/how-to/events/>,
  <https://waha.devlike.pro/docs/how-to/security/>.
- Gemini Interactions and structured output:
  <https://ai.google.dev/gemini-api/docs/interactions-overview>,
  <https://ai.google.dev/gemini-api/docs/structured-output>.
- amoCRM/Kommo OAuth and entity operations:
  <https://developers.kommo.com/docs/oauth-20>,
  <https://developers.kommo.com/reference/add-contacts>,
  <https://developers.kommo.com/reference/adding-leads>,
  <https://developers.kommo.com/reference/link-entities>,
  <https://developers.kommo.com/reference/add-notes>.

## Consequences

- V2 can now prove its real customer-communication and external-CRM workflow
  instead of stopping at local draft/read mechanics.
- External calls become real side effects and must carry stronger durable
  request identity, unknown-outcome reconciliation and private evidence.
- Provider credentials and exact target resolution become genuine execution
  prerequisites, but routine approval prompts do not.
- Production authentication, public/VPS deployment, broad customer migration,
  readiness/recovery, pilot and cutover remain deferred.
