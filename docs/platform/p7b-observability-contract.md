# P7B private observability implementation contract

Status: implementation contract; it becomes authoritative only when this
document and its append-only plan block are independently reviewed and merged.

Version date: 2026-08-13 (Asia/Bishkek)

Parent Block-ID: `EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13`

Amendment Block-ID: `EVO-P7B-OBSERVABILITY-CONTRACT-2026-08-13`

## Accepted baseline and boundary

- Main is `e4d10b96d0ef4061fdb03ec85430cb65d86e39fd`, produced by
  merged PR #157. Exact-main CI run `31701995589` passed Main CRM, EVO
  Inbox and EVO Lead Agent; Changed range was skipped for the push event.
- P7A is accepted and migrations are contiguous `001-071`.
- P7B is repository/disposable-loopback work only. It authorizes no managed
  Supabase change, production deploy or probe, DNS change, customer data,
  provider call, WAHA session change, live send, amoCRM write, pager/log-drain
  delivery, retention deletion or service retirement.
- `/api/health` remains dependency-free process liveness and is not changed
  into a provider/readiness probe.
- P7B completes only after P7B1, P7B2 and P7B3 below are accepted. P7C does not
  start earlier.

## Execution order

1. `P7B1` adds migration `072` after a fresh ordinal/ownership check, the
   service-only safe aggregate RPC, request-scoped private CRM readiness and
   metrics routes, and the pure deterministic alert evaluator.
2. `P7B2` changes Inbox readiness to the documented WAHA `GET /health`
   contract, adds private probe authentication, hardens scoped structured
   logging, adds the fixed operations runbook, and extends edge/Compose
   validation. Existing Lead Agent frozen/readiness semantics do not change.
3. `P7B3` runs the complete disposable OrbStack-backed acceptance path with
   local synthetic failures and loopback stubs only. It adds no new product
   behavior.

Each sub-block must be independently reviewable. A later sub-block cannot
weaken an earlier privacy, authentication, SQL or evidence boundary.

## Disabled-by-default configuration

The feature is enabled only when
`EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED === "1"`. Missing, empty, differently
cased or otherwise valued input is disabled. The same exact flag is evaluated
independently inside CRM and Inbox; enabling one deployed process does not
implicitly enable the other.

CRM and Inbox use separate runtime-random secrets:

- CRM: `EVO_PLATFORM_P7B_OBSERVABILITY_SECRET`;
- Inbox: `EVO_INBOX_P7B_OBSERVABILITY_SECRET`.

Each secret is server-only, already trimmed, 32 to 128 UTF-8 bytes, contains no
ASCII control character, and must not equal any WAHA, webhook, worker,
autonomous-reply, Supabase or Lead Agent secret. Leading/trailing whitespace,
unsafe or missing configuration fails closed before a database or provider
call. Only safe empty examples enter committed environment templates.

The CRM collector reuses exact server-side Platform connection inputs
`NEXT_PUBLIC_SUPABASE_URL` and `EVO_PLATFORM_SUPABASE_SECRET_KEY`; the latter is
never exposed despite the former's existing public name. It does not require or
reuse the WAHA-ingress enable flag or one organization ID. Inbox uses its
existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`EVO_INBOX_WAHA_BASE_URL` and `EVO_INBOX_WAHA_API_KEY`. Every Supabase URL is an
origin-only absolute URL: no userinfo, non-root path, query or fragment; HTTPS
is required except HTTP loopback in non-production, reusing the accepted
`src/lib/supabase/config.ts` predicate. The Inbox WAHA URL is also origin-only.
In production it must be exactly `http://evo-inbox-waha:3000`; in tests it may
be HTTP on `localhost`, any `127.0.0.0/8` address or `[::1]` with one explicit
port from `1` through `65535`. HTTPS, userinfo, paths, queries, fragments,
non-loopback test hosts and every other production origin fail before the plain
WAHA API key or any network request is created. No new browser-visible
credential is created.

## Exact private HTTP contract

CRM exposes exact `GET /api/readiness` and `GET /metrics`. Inbox retains exact
`GET /api/readiness`. Requests with a query string, body, another method or a
near path are rejected.

The existing SQLite readiness behavior may remain only in explicit legacy
fixture/non-Platform runtime. When connected Platform runtime is selected,
these P7B routes never fall back to SQLite or treat a SQLite probe as Platform
readiness.

Every admitted request requires exactly one value for:

- `x-evo-observability-request-id`: canonical lowercase, non-nil UUID;
- `x-evo-observability-timestamp`: exactly 13 decimal millisecond digits and no
  more than 300,000 milliseconds in the past or future;
- `x-evo-observability-hmac-algorithm`: exact lowercase `sha256`;
- `x-evo-observability-hmac`: exact lowercase 64-character hexadecimal HMAC.

The signed bytes are UTF-8:

```text
GET\n<exact-path>\n<lowercase-request-uuid>\n<timestamp>
```

CRM and Inbox verify with their distinct secrets using constant-time
comparison. The feature-disabled, malformed, stale, future, unsigned or
incorrectly signed path returns an empty `404` with `Cache-Control: no-store`
and performs no SQL/provider call. This read-only signature has no replay
ledger; the bounded timestamp and path binding prevent cross-route reuse.

The public edge continues to return `404` for `/api/readiness`, `/metrics`,
`/api/internal/*` and Lead Agent `/admin/*` before requests reach an app. No
WAHA or Lead Agent port is published. Private network placement never replaces
the application signature check.

The root proxy admits only exact `/api/readiness` and `/metrics` directly to
their route handlers before staff-cookie refresh, just as Inbox middleware
already admits its exact readiness path. Near paths remain disconnected. The
route handler—not a staff session or legacy route—owns the feature flag,
signature, method/query/body and safe-response decision.

## Migration 072 and safe aggregate RPC

After rechecking that `071` is the current tip, P7B1 adds exact signature:

```sql
platform.platform_operational_signals_v1(p_request_id uuid) returns jsonb
```

The function is PostgreSQL-owned `SECURITY DEFINER`, has an empty
`search_path`, exact `statement_timeout = 3000ms` and `lock_timeout = 1000ms`,
validates a non-nil request UUID, and grants `EXECUTE` only to `service_role`.
`PUBLIC`, `anon` and `authenticated` receive no execution or underlying
private-table access. It accepts no organization, membership, role, provider,
threshold or free-text input and returns one global aggregate snapshot with no
tenant dimension. The server-side caller applies a 5,000-millisecond abort
bound and performs no automatic retry.

The JSON has exactly these keys:

- `schema_version` (`p7b-v1`), `observed_at`, `saturated`;
- `queue_ready_count`, `queue_retry_wait_count`, `queue_leased_count`,
  `queue_expired_lease_count`, `queue_oldest_ready_age_seconds`,
  `queue_oldest_retry_wait_age_seconds`;
- `dead_letter_count`, `unknown_delivery_open_count`,
  `provider_conflict_open_count`;
- `private_media_pending_count`, `private_media_processing_count`,
  `private_media_retryable_error_count`,
  `private_media_terminal_error_count`, `private_media_expired_lease_count`,
  `private_media_oldest_unarchived_age_seconds`;
- `autonomy_queued_count`, `autonomy_dispatching_count`,
  `autonomy_unknown_count`, `autonomy_manual_review_count`,
  `autonomy_oldest_queued_age_seconds`,
  `autonomy_oldest_dispatching_age_seconds`;
- `waha_readiness`, `waha_evidence_kind`, `waha_age_seconds`,
  `waha_evidence_future`;
- `ai_readiness`, `ai_evidence_kind`, `ai_age_seconds`,
  `ai_evidence_future`;
- `audit_append_status`.

Counts are integers clamped to `1,000,000`; ages are nullable integer seconds
clamped to the closed range `0..31,536,000`. `saturated` is true only when a raw
count exceeds `1,000,000`, a raw age exceeds `31,536,000`, or a future source
timestamp requires a negative raw age to be clamped to zero. A naturally zero
age or exactly capped count/age is not saturation. Status and evidence fields
use the existing Platform enum vocabulary only. No kind, organization, case,
actor, message, phone, provider reference, object key, reason, payload or free
text is returned.

`waha_evidence_future` and `ai_evidence_future` are booleans. Each is true when
at least one applicable organization's selected latest event is later than the
observation clock, and false when no selected event is future (including when
no event exists). They are the only per-dependency future markers and allow the
server to distinguish a genuine age zero from a clamped negative age without
receiving a raw timestamp.

Queue/dead-letter/review/media/autonomy values come only from existing
application-owned Platform tables, never direct browser or app access to raw
PGMQ queues. Required tenant-leading/state/time indexes may be added only when
the focused plan proves the existing indexes cannot support the aggregate.
Every count uses an index-supported inner `LIMIT 1000001` and therefore reads
at most the saturation boundary plus one matching index entry. Every oldest-age
query is an ordered index seek with `LIMIT 1`; no exact count over unbounded
history is permitted. The app admits only one in-flight collection promise per
process: concurrent valid readiness and metrics requests await that same
snapshot, while the 5,000-millisecond caller abort remains authoritative. A
completed snapshot is not cached across later requests.

The current-state predicates are exact:

- durable queue counts come from `platform_private.durable_work_items` by exact
  state `queued`, `retry_wait` and `leased`; expired lease is the leased subset
  whose non-null `leased_until` is at or before the observation clock;
- oldest queued age is non-negative clock minus `available_at`, and oldest
  retry-wait age is non-negative clock minus `updated_at`, considering only the
  matching nonterminal state;
- dead letters are the persistent rows in
  `platform_private.durable_work_dead_letters`;
- unknown-delivery and provider-conflict counts are
  `platform.work_review_cases` whose status is `open`, grouped by the exact
  `review_kind`;
- private-media counts and oldest unarchived age come from current rows in
  `platform_private.waha_media_archive_work`, by exact state and `created_at`,
  excluding `archived` from the age calculation; expired media lease is the
  `processing` subset whose non-null `lease_expires_at` is at or before the
  observation clock;
- autonomy counts come from the latest lifecycle row per
  `platform_private.autonomous_reply_intents` intent; queued and dispatching
  ages use that latest row's `created_at` only when its state remains `queued`
  or `dispatching`, respectively.

Persistent terminal evidence remains counted; P7B never deletes, silently
acknowledges or time-expires a dead letter, terminal media error, autonomous
unknown result or manual-review intent to make an alert green.

For this aggregate, an applicable Platform organization has status `active`
and satisfies at least one of these exact predicates:

- it has an active Admin membership, an active organization record scope and
  that membership's latest scope assignment is granted;
- it has any current WAHA or AI health event;
- it owns a durable work item in `queued`, `retry_wait` or `leased`, a durable
  dead letter, or an open unknown-delivery/provider-conflict review;
- it owns private-media work not in `archived`; or
- it owns an autonomous intent whose latest lifecycle state is `queued`,
  `dispatching`, `unknown` or `manual_review`.

The operational predicates are a union with the Admin predicate, not a filter
after it. Thus revoking or losing the last Admin cannot hide live/stuck work or
make another organization's healthy evidence turn the global result green.
Dependency state is `ready` only when the latest evidence for every such
organization is `ready`, has exact
evidence kind `provider_observed`, and is at most 300 seconds old. Missing,
`local_non_provider`, `configuration_check`, `configured_unverified`,
`unconfigured`, `blocked` or stale evidence is not ready. Local synthetic
evidence written by P7B must not be labeled or relabeled as
`provider_observed`. Older explicitly named synthetic fixtures may remain for
their accepted phase tests, but they are not real-provider proof and cannot
make the full aggregate green while any applicable organization is missing
current real-provider evidence.

For each dependency, global readiness precedence from worst to best is
`unconfigured`, `configured_unverified`, `blocked`, then `ready`. A missing
organization event contributes `unconfigured`. Global evidence kind is null if
any organization event is missing; otherwise its worst-to-best precedence is
`configuration_check`, `local_non_provider`, then `provider_observed`. Age is
the maximum whole-second age across the latest organization events and is null
only when no event exists. Future-dated evidence is not ready. A private
revoked `platform_private.p7b_observability_clock()` returns
`statement_timestamp()` in production; disposable SQL tests may replace it
transaction-locally and must restore it by rollback.

If there is no applicable active organization, both dependencies are
`unconfigured` with null evidence/age and the audit append status is
`unavailable`; the empty system is therefore not ready. Latest health event is
selected deterministically by `observed_at DESC, id DESC`; latest membership
scope assignment uses `assignment_version DESC`; latest autonomous lifecycle
uses `created_at DESC, id DESC`.

`audit_append_status` is produced by a nested transactional insert probe against
`platform.audit_events` using the lowest-UUID applicable active organization
and the request UUID. The probe uses only fixed system actor/action/resource/
reason/state values and the organization UUID as its resource UUID. The
deliberate sentinel exception rolls back the probe row. A successful
rolled-back insert is `ready`; an insert/trigger/permission failure is `failed`;
no applicable organization is `unavailable`. The probe must create no durable
audit noise and expose no SQL error detail.

Database and Storage restore-evidence status remain exact `missing` in the
server composition until P7C supplies reviewed real evidence. P7B does not add
a fake restore row, environment override or configured-equals-passed path.
The pure evaluator still tests `missing` and `failed` inputs.

## Readiness and metrics output

CRM readiness JSON has exact top-level keys `schema_version`, `ok`, `status`,
`service`, `request_id`, `observed_at`, `components`, `signals` and `alerts`.
Components and alerts use fixed codes only; an alert has exact keys `code`,
`severity`, `owner_category` and `runbook_id`. Arrays are deterministically
sorted. There is no free-text message, URL, stack, SQL/provider error or
customer identifier.

Component codes are exactly `supabase`, `audit_append`, `waha`, `ai`,
`restore_database` and `restore_storage`. Normalized component status is exactly
`ready`, `failed`, `unavailable`, `missing`, `unverified` or `stale`; each
component admits only the subset meaningful to its evidence source.
`components` is an object with those six exact keys; every value has exact keys
`status` and nullable integer `age_seconds`. `signals` is the exact validated
SQL object above, not a second independently inferred snapshot, and is null
only when the SQL collection itself failed. `schema_version` is `p7b-v1`,
`service` is `evo-crm`, and `status` is exactly `ready` or `not_ready`.

Runtime readiness returns `503` when Supabase collection fails, the audit
append probe is not ready, or required WAHA/AI evidence is missing,
unverified, stale or failed. Operational backlog/manual-review/restore alerts
remain visible but do not by themselves change an otherwise valid runtime
readiness status. Missing provider evidence can therefore never become green,
while missing recovery evidence is not misrepresented as process downtime.

Dependency-to-component normalization is exact:

- SQL call success makes `supabase=ready`; SQL call failure makes it
  `unavailable`;
- audit append `ready|failed|unavailable` maps directly to component
  `ready|failed|unavailable`;
- a WAHA/AI dependency whose global readiness is `ready`, evidence kind is
  `provider_observed` and age is `0..300` maps to `ready`;
- `ready` with null/wrong evidence kind maps to `unverified`; any non-ready
  enum with a latest event also maps to `unverified`, except exact `blocked`
  maps to `failed`;
- no event maps to `missing`; exact per-dependency `*_evidence_future=true`
  always maps to `failed`; otherwise age above 300 seconds maps to `stale` only
  when readiness/evidence would have mapped to `ready`, and existing `failed`
  or `unverified` wins over `stale`;
- restore input `missing|failed|ready` maps directly and is not inferred from
  environment configuration.

Component `age_seconds` is present only for WAHA/AI and restore components;
Supabase and audit append always return null age in P7B. `ok` is true exactly
when `status=ready` and false exactly when `status=not_ready`.

Inbox normalizes its live probes independently and exactly. Missing or unsafe
Supabase/WAHA configuration maps to `missing`; timeout, network failure,
redirect rejection or response-cap overflow maps to `unavailable`; and an HTTP
status other than `200` maps to `failed`. Supabase is `ready` only for a bounded
`200` JSON object with exact top-level `name: "GoTrue"` and a nonempty bounded
string `version`. WAHA is `ready` only for a bounded `200` JSON object with
exact top-level `status: "ok"`. Wrong JSON media type, malformed/non-object
JSON, missing/wrong required fields and WAHA `error`, `shutting_down` or any
other status map to `failed`. Inbox live-probe components always return null
`age_seconds`. It never maps configured input to `unverified` or `ready`
without completing the corresponding live request. The accepted Supabase Auth
health shape is documented at:

- <https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR>

On a signed request whose SQL collection fails, readiness still returns the
same safe shape with `503`: Supabase and audit append are `unavailable`, WAHA
and AI are `unverified`, restore components remain `missing`, `signals` is
null, and the corresponding fixed alerts are emitted. No database error text
is returned. Inbox readiness returns the same common fields except `signals`
and `alerts`, uses exact service `evo-inbox-companion`, and has exact component
keys `supabase` and `waha`; each value has the same `status`/`age_seconds`
shape. It returns `200` only when both are ready and otherwise `503`.

`/metrics` uses Prometheus text format 0.0.4: UTF-8, LF line endings including
a final LF, deterministic `HELP`/`TYPE`/sample ordering, and exact
`Content-Type: text/plain; version=0.0.4; charset=utf-8`. Metric names begin
`evo_platform_`, use seconds as the time base, and use only fixed
low-cardinality `component`, `state` and `severity` label values. Tenant,
user, request, case, message, phone, provider and object identifiers are never
labels. The exact initial metric families and fixed label values are:

- `evo_platform_readiness` (`0|1`);
- `evo_platform_component_ready{component="supabase|audit_append|waha|ai"}`
  (`0|1`);
- `evo_platform_component_age_seconds{component="waha|ai"}` (sample omitted
  when the age is null);
- `evo_platform_queue_items{state="ready|retry_wait|leased|expired_lease|dead_letter"}`;
- `evo_platform_queue_oldest_age_seconds{state="ready|retry_wait"}` (sample
  omitted when the age is null);
- `evo_platform_review_items{state="unknown_delivery|provider_conflict"}`;
- `evo_platform_private_media_items{state="pending|processing|retryable_error|terminal_error|expired_lease"}`;
- `evo_platform_private_media_oldest_age_seconds` (sample omitted when null);
- `evo_platform_autonomy_items{state="queued|dispatching|unknown|manual_review"}`;
- `evo_platform_autonomy_oldest_queued_age_seconds` (sample omitted when null);
- `evo_platform_autonomy_oldest_dispatching_age_seconds` (sample omitted when
  null);
- `evo_platform_signal_saturated` (`0|1`);
- `evo_platform_active_alerts{severity="warning|critical"}`.

Every family is a gauge. No unlisted family or label value is admitted in
P7B. When SQL collection fails, signal-derived families are omitted, while
readiness, component-ready and active-alert families remain present with the
fixed safe failure state. Both routes return `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff` on authenticated responses.

A valid signed `/metrics` request returns HTTP `200` even when readiness is
zero so a scraper can observe the failure. An ordinary SQL/RPC collection
failure still returns `200` with readiness, fixed failure-component and
active-alert gauges, while signal-derived families are omitted. Only
invalid/disabled authentication returns empty `404`; inability to construct or
serialize even that safe fallback returns an empty `503` with no partial metric
body.

This follows the official Prometheus exposition and naming guidance:

- <https://prometheus.io/docs/instrumenting/exposition_formats/>
- <https://prometheus.io/docs/practices/naming/>

## Deterministic alert policy

These are fixed operational escalation thresholds, not capacity evidence, an
SLO, an SLA or approved production tuning:

- queue backlog warning when ready plus retry-wait count is `>=25`, or either
  oldest age is `>=300` seconds; critical when that count is `>=100`, or either
  oldest age is `>=900` seconds;
- any expired lease, dead letter, unknown delivery or provider conflict is
  critical;
- any terminal private-media error or expired media lease is critical; pending
  or retryable-error count `>=25`, or oldest unarchived age `>=300` seconds, is
  a warning;
- any autonomous unknown outcome is critical, any manual-review intent is a
  warning, queued age `>=300` seconds is a warning, queued age `>=900` seconds
  is critical, and dispatching age `>=300` seconds is critical;
- a saturated signal is critical;
- unavailable Supabase, failed/unavailable audit append, or missing,
  unverified, stale or failed required WAHA/AI evidence is critical;
- missing database or Storage restore evidence is a warning; failed evidence is
  critical, without changing runtime readiness.

Severity is exactly `warning` or `critical`. Owner category is exactly
`server_operator`, `whatsapp_operator`, `ai_operator` or
`data_recovery_owner`. Alert codes, severities, owners and runbooks are frozen
as follows; every code appears at most once, critical suppresses the matching
warning threshold, and alerts are sorted critical first then warning and by
code within severity:

| Alert code                        | Severity | Owner                 | Runbook                       |
| --------------------------------- | -------- | --------------------- | ----------------------------- |
| `supabase_unavailable`            | critical | `server_operator`     | `RB-P7B-SUPABASE-UNAVAILABLE` |
| `audit_append_failed`             | critical | `server_operator`     | `RB-P7B-AUDIT-APPEND`         |
| `waha_unavailable`                | critical | `whatsapp_operator`   | `RB-P7B-WAHA-DEGRADED`        |
| `ai_unavailable`                  | critical | `ai_operator`         | `RB-P7B-AI-UNAVAILABLE`       |
| `queue_backlog_warning`           | warning  | `server_operator`     | `RB-P7B-QUEUE-BACKLOG`        |
| `queue_backlog_critical`          | critical | `server_operator`     | `RB-P7B-QUEUE-BACKLOG`        |
| `queue_expired_lease`             | critical | `server_operator`     | `RB-P7B-QUEUE-BACKLOG`        |
| `queue_dead_letter`               | critical | `server_operator`     | `RB-P7B-QUEUE-BACKLOG`        |
| `unknown_delivery_open`           | critical | `whatsapp_operator`   | `RB-P7B-UNKNOWN-DELIVERY`     |
| `provider_conflict_open`          | critical | `whatsapp_operator`   | `RB-P7B-UNKNOWN-DELIVERY`     |
| `private_media_backlog`           | warning  | `whatsapp_operator`   | `RB-P7B-PRIVATE-MEDIA`        |
| `private_media_expired_lease`     | critical | `whatsapp_operator`   | `RB-P7B-PRIVATE-MEDIA`        |
| `private_media_terminal_error`    | critical | `whatsapp_operator`   | `RB-P7B-PRIVATE-MEDIA`        |
| `autonomy_queue_stalled_warning`  | warning  | `whatsapp_operator`   | `RB-P7B-ROLLBACK-KILL-SWITCH` |
| `autonomy_queue_stalled_critical` | critical | `whatsapp_operator`   | `RB-P7B-ROLLBACK-KILL-SWITCH` |
| `autonomy_dispatch_stalled`       | critical | `whatsapp_operator`   | `RB-P7B-ROLLBACK-KILL-SWITCH` |
| `autonomy_unknown`                | critical | `whatsapp_operator`   | `RB-P7B-ROLLBACK-KILL-SWITCH` |
| `autonomy_manual_review`          | warning  | `whatsapp_operator`   | `RB-P7B-ROLLBACK-KILL-SWITCH` |
| `restore_evidence_missing`        | warning  | `data_recovery_owner` | `RB-P7B-RESTORE-EVIDENCE`     |
| `restore_evidence_failed`         | critical | `data_recovery_owner` | `RB-P7B-RESTORE-EVIDENCE`     |
| `signal_saturated`                | critical | `server_operator`     | `RB-P7B-QUEUE-BACKLOG`        |

No environment value can silently raise, lower or disable these thresholds in
P7B.

Every alert maps to one fixed runbook ID in the implementation-owned
`docs/runbooks/p7b-operations.md`:

- `RB-P7B-SUPABASE-UNAVAILABLE`;
- `RB-P7B-QUEUE-BACKLOG`;
- `RB-P7B-UNKNOWN-DELIVERY`;
- `RB-P7B-WAHA-DEGRADED`;
- `RB-P7B-AI-UNAVAILABLE`;
- `RB-P7B-PRIVATE-MEDIA`;
- `RB-P7B-AUDIT-APPEND`;
- `RB-P7B-RESTORE-EVIDENCE`;
- `RB-P7B-ROLLBACK-KILL-SWITCH`.

The evaluator returns alerts only. It sends no webhook, page, email, SMS or
provider request and stores no external-destination credential. External
delivery remains blocked on destination, supported plan/cost and accountable
owner approval.

## Cross-service and logging contract

Inbox readiness uses documented WAHA `GET /health` semantics only and accepts
WAHA as ready only for HTTP `200`, JSON media type, a bounded valid JSON object
and exact top-level `status: "ok"`. It sends the existing server-only WAHA API
key from exact environment variable `EVO_INBOX_WAHA_API_KEY` in `x-api-key`; it
does not load one account's encrypted settings for this global service probe,
weaken WAHA authentication or add `health` to the unauthenticated exclusion
list. The fixed Supabase Auth health and WAHA
requests each use a 3,000-millisecond timeout, `redirect: "error"`, no retry and
a 65,536-byte response cap. Missing/unsafe configuration performs no outbound
call and maps to `missing`.

Both root and Inbox WAHA Compose container liveness checks switch to exact
unauthenticated `GET /ping`, and both WAHA environment examples admit only
`ping` through `WAHA_API_KEY_EXCLUDE_PATH=ping`. Authenticated `GET /health` is
reserved for readiness. Tests pin this liveness/readiness split and forbid
excluding `health`.

The implementation must not expose or log either upstream payload,
session/contact/provider details, storage paths or secret. Local tests use a
loopback stub explicitly classified as synthetic; they are not provider
evidence. The existing Lead Agent private admin-key boundary and frozen versus
receive-only/outbound readiness meaning remain unchanged. Official WAHA health
semantics are documented at:

- <https://waha.devlike.pro/docs/how-to/observability/>
- <https://waha.devlike.pro/docs/how-to/security/>

P7B structured logs contain only request UUID, fixed event code, service,
method, route template, status class, elapsed milliseconds and optional fixed
component code. They never contain query strings, bodies, cookies,
authorization/signature headers, customer content, phone numbers, provider
payloads, object keys, secrets or arbitrary exception strings. Caddy keeps
credential-bearing request headers out of access logs.

## Acceptance and rollback

Unit/schema/static tests must prove exact DTO/RPC/header/metric/alert/runbook
contracts, saturation, stable ordering, secret redaction and negative near
paths. SQL authorization tests must prove service-role-only execution, no raw
queue/table grant, safe aggregates, cross-tenant non-disclosure and the
rolled-back audit probe.

Before any container-backed test on macOS, `orb status` must report `Running`
and `docker context show` must return exactly `orbstack`. P7B3 then uses the
real repository disposable Supabase/Compose path and local loopback dependency
stubs to prove accepted signatures, the truthful CRM `503`/unverified state
caused by absent real-provider evidence, a `200` metrics response whose
readiness gauge remains `0`, controlled dependency failures, public-edge `404`,
safe Prometheus parsing, alert correlation/runbook mapping, bounded
resources/logs and no external alert. Pure evaluator tests may exercise the
ready branch with an in-memory exact DTO, but that is branch coverage rather
than runtime/provider evidence. P7B3 uses synthetic data only and calls no real
provider or production service.

The required evidence commands and artifacts are fixed:

- P7B1: Node 22.23.1 focused P7B contract/route/alert/metrics tests,
  `npm run test:unit`, `npm run test:security:node`, migration-history and Inbox
  schema-contract tests, `npm run test:security:postgres`, TypeScript, scoped
  ESLint, build and diff-check;
- P7B2: Inbox Vitest plus root runtime-hardening/Compose/Caddy/source-contract
  tests, config syntax, TypeScript, build and diff-check;
- P7B3: `npm run test:supabase:local` with a dedicated P7B partition after the
  exact OrbStack preflight, plus retained redacted request/response/Prometheus
  and bounded-log assertions in test output. The harness cleans only its exact
  project/temp resources and leaves unrelated containers alone.

Every sub-block records exact commit SHA, command, exit status and test counts.
No skipped, timed-out, simulated or stale result is acceptance evidence.

Rollback disables the feature flag and private collectors/routes, reverts
application/runbook wiring, and forward-fixes migration `072` if required.
Audit/private operational evidence is not deleted. Merging this plan alone is
not implementation, runtime, provider, managed-environment or production proof.
