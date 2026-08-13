# P7 security, reliability and operations contract

Status: authoritative implementation contract; P7A accepted, P7B build
contract frozen

Version date: 2026-08-13 (Asia/Bishkek)

Plan Block-ID: `EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13`

Accepted baseline:

- merged P6D main SHA: `1e53d93d8c70c286e56c5d057928e9f080c58a44`;
- exact-main push CI run: `31650640795`;
- contiguous migrations: `001-070`;
- primary-source evidence: `docs/research/p7-official-evidence-2026-08-13.md`.

Accepted progress:

- PR #154 merged this contract as
  `b9faadd24686a22bf70db176c6192304c942b2dd`;
- PR #156 merged P7A as
  `47e2e211ba77d36e3296b12ad0b8087276ca712d`, including migration `071`;
- exact-main push CI run `31688954104` passed Main CRM, EVO Inbox and EVO
  Lead Agent; Changed range was skipped on the push event as expected;
- PR #157 merged the accepted-status refresh and OrbStack-only local runtime
  policy as `e4d10b96d0ef4061fdb03ec85430cb65d86e39fd`;
- exact-main push CI run `31701995589` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped on the push event as expected;
- P7A evidence is repository/disposable-local only. Its runtime remains
  disabled by default, and it proves no managed Supabase, production or
  real-provider behavior;
- P7B is the next authorized block. P7C follows, while P7D remains blocked
  until the owner supplies its numeric capacity and human accessibility inputs.
- the build-ready P7B route, SQL, signal, alert and proof details are frozen in
  `docs/platform/p7b-observability-contract.md`; its independently reviewed
  merge is the authority gate for P7B implementation.

This contract expands the append-only Block-ID above. If wording conflicts,
`docs/PLAN_CHANGES.md` and `docs/EVO_PLATFORM_LONG_RUN_PLAN.md` take
precedence. This amendment changes no application code, schema, runtime,
credential, provider, customer data, managed environment or production state.

## Outcome and sequence

P7 makes the merged P5-P6 Platform safe to inspect, operate, recover and
evaluate without treating local fixtures as production evidence. It executes
only as:

1. `P7-PLAN` - this reviewed docs-only authority gate;
2. `P7A` - safe Admin-only Platform audit search/export;
3. `P7B` - private structured observability, alert evaluation and runbooks;
4. `P7C` - isolated database restore plus a separate private Storage restore;
5. `P7D` - owner-approved-capacity load evidence and automated plus human
   accessibility closure.

Each implementation block requires its own fresh worktree, focused tests,
independent exact-head review, green exact-head CI, direct merge of only that
reviewed head and green exact-main push CI. P8 remains blocked until P7D is
complete and every unavailable managed/provider/production segment is recorded
as blocked or deferred.

## Global truth and safety boundary

- Repository and disposable loopback proof is not managed Supabase,
  production, real-provider or customer-data proof.
- No P7 block authorizes production deployment/migration, DNS, WAHA session or
  QR mutation, live WhatsApp send, amoCRM write, broad outbound automation,
  service deletion, retention deletion or destructive production restore.
- Lead Agent and the rollback path remain deployed/frozen. P4B mapping
  activation and writes remain deferred.
- DEC-009, DEC-010, DEC-012 and DEC-017 remain open. Work may proceed around
  them, but no affected plan/cost, capacity, RPO/RTO, privacy/retention or
  release claim may be inferred.
- Missing credentials, plan tier, isolated target, operator, numeric limit or
  human reviewer is a visible blocker, never a mock-success condition.

## P7A - safe Platform audit search/export

### Existing seam and problem

`platform.audit_events` is append-only and RLS-bound to `audit.read`, but its
base row contains private `actor_principal`, raw `before_state`, raw
`after_state` and free-text `reason`. Authenticated currently has direct table
`SELECT`. The accepted `/settings?tab=audit` path still reads legacy SQLite via
`listOperationalAuditTrail()`, which is explicitly not a security audit trail.

### Required implementation

- Use expected next-free migration `071` only after a fresh ownership check;
  this plan does not reserve the ordinal.
- Revoke browser-role direct reads of `platform.audit_events`. Stop if a live
  accepted Platform consumer is found to depend on that access.
- Add actor-derived Admin-only search/export RPCs. The caller supplies filters
  but never organization, membership, role or authority.
- Use UTC start-inclusive/end-exclusive time filters, exact allowlisted action
  and resource-type filters, optional Platform resource UUID, page size
  `1..100`, an immutable `(created_at,id)` snapshot boundary and a descending
  `(created_at,id)` cursor. New appends after the snapshot cannot move or
  duplicate existing pages.
- Search output is an exact safe projection: Platform audit UUID/timestamp,
  action, resource type/Platform UUID, actor kind/safe staff display label,
  request UUID, a fixed safe reason code or `restricted`, and allowlisted
  changed-field codes. Raw before/after JSON, free-text reason, actor principal,
  secret/provider references, provider payload, object key, private Realtime
  topic and phone-bearing identifiers never enter RPC output, DOM or CSV.
- Export uses the same canonical filters and snapshot, requires an explicit
  window no longer than 31 days and fails visibly above 5,000 rows rather than
  truncating.
- Bind export request UUID, canonical filters, snapshot, row count and row-set
  SHA-256 in a private replay ledger. Exact replay returns the same receipt and
  appends no second event; changed input under the same UUID fails closed.
- Expose one same-origin authenticated `POST` download. `GET` is mutation-free.
  The successful export appends exactly one `audit.export` event containing
  filters/count/hash only, never row contents.
- CSV is deterministic with fixed columns, `Cache-Control: private, no-store`,
  no Storage persistence, RFC-compatible quoting, CR/LF neutralization and
  spreadsheet-formula protection after leading whitespace for `=`, `+`, `-`
  and `@`.
- Connect the accepted Platform Settings presentation only. Connected runtime
  has no SQLite or service-role browser fallback.
- Runtime activation uses the exact server-only
  `EVO_PLATFORM_P7A_AUDIT_ENABLED=1` flag. The committed example remains `0`,
  so repository configuration alone cannot expose the connected audit surface.

### Required acceptance

- Active own-organization Admin search/export succeeds.
- Sales, Curator, Finance, Student, anonymous, inactive, stale-authority and
  cross-organization access fails at SQL, server route/action and visible DOM.
- Direct table reads and malformed, oversized or out-of-scope filters fail.
- Pagination is deterministic while later audit events append.
- Same-request replay is byte/hash stable; conflicting replay fails.
- DOM and CSV scans prove excluded private fields/phone patterns and formula
  injection are absent.
- A dedicated disposable Auth/PostgREST/Postgres/browser path proves the real
  repository seam without a provider or production claim.

## P7B - private observability, alerts and runbooks

### Required implementation

- Keep `/api/health` as dependency-free process liveness.
- Add bounded Platform readiness and safe aggregate operational signals.
  `/api/readiness`, `/metrics`, `/api/internal/*` and Lead Agent
  admin/readiness remain private and public edge requests continue to receive
  `404`; no WAHA or Lead Agent port is published.
- Use documented WAHA `GET /health` semantics only. Do not invent a WAHA
  Prometheus endpoint or expose the health payload publicly.
- Operational output may contain allowlisted component/status/count/age values,
  request UUID, service, method, route template, status class and elapsed time.
  Tenant/user/case/message/phone labels, query strings, bodies, cookies,
  authorization values, customer content, provider payload, object key and
  secrets are forbidden.
- Evaluate alerts deterministically for readiness failure, unknown delivery,
  queue/dead-letter state, audit-append failure and absent/failed restore
  evidence. Every alert maps severity, owner category and runbook.
- External pager/log-drain delivery stays blocked until destination,
  credentials, supported plan/cost and accountable owner are approved.
- Update runtime-hardening validation and runbooks for Supabase unavailable,
  queue growth, unknown delivery, WAHA degraded, AI unavailable, private media,
  audit, restore and rollback/kill-switch incidents.

### Required acceptance

- Missing/failed dependency returns safe `503` readiness and never turns
  missing provider evidence green.
- Public readiness/metrics/internal/admin requests receive `404`; private
  synthetic probes receive only safe fields.
- Controlled local failures prove correlation, severity, owner, runbook and
  credential-header redaction without sending an external alert.
- Compose/Caddy tests prove private networks, no published WAHA/Lead Agent port,
  and bounded resources/logging.

## P7C - isolated database and separate Storage restore

### Required implementation

- Use two distinctly named, empty, disposable loopback Supabase environments
  and synthetic data only. Refuse non-loopback, identical source/destination,
  non-empty unowned destination, production markers and destructive cleanup.
- Create a PostgreSQL archive/manifest separately from a private Storage-object
  archive/manifest. Each manifest records schema/version, count/size, SHA-256,
  exact source/destination identity and measured timestamps, never credentials
  or object contents.
- Restore PostgreSQL into the empty destination. Restore private Storage bytes
  through supported Storage APIs, never by writing Storage catalog tables.
- Keep artifacts in an exact per-run `0700` location using an encrypted
  mechanism with an ephemeral test key. Managed key ownership remains blocked.
- Cleanup removes exact drill-owned resources/artifacts only.

### Required acceptance

- Destination migration/schema state, synthetic Auth actors, tenant/object
  isolation, append-only audit history and representative P5-P6 records match.
- Private document/media counts, sizes and byte SHA-256 values match;
  authorized reads work and cross-user/cross-organization reads fail.
- Database and Storage produce separate reports. Measured duration/data-loss
  window are observations, not approved RPO/RTO.
- Absent, corrupt, partial or wrong-destination artifacts fail closed.
- Managed Supabase/PITR and S3/versioning/deleted-object recovery remain blocked
  without separately approved projects, buckets and credentials.

## P7D - capacity and accessibility closure

### Entry gate

The owner must first approve a numeric capacity profile covering staff and
concurrent sessions, cases/messages/files, request mix, duration and allowed
error rate. A human accessibility reviewer and explicit
assistive-technology/browser/device matrix must also be available. Without both
inputs P7D is `BLOCKED`; no default load or Axe-only result can complete it.

### Required implementation and acceptance

- A bounded k6 harness refuses production/public-provider targets, absent
  numeric limits, unbounded duration and non-synthetic credentials.
- Run only against an isolated synthetic Platform with WAHA, Gemini,
  amoCRM-write and autonomous-send/provider lanes disabled.
- At the approved profile, explicit k6 thresholds gate pass/fail and record
  latency, errors, consistency, tenant isolation and queue/audit invariants.
  Results are observations, not an invented company SLO.
- Run Axe WCAG 2.2 A/AA plus responsive evidence at `1440x1024`, `834x1194`
  and `390x844` over critical accepted P5-P7 staff and Portal routes.
- Complete human keyboard, focus order/visibility, dialog semantics, zoom,
  screen-reader announcement and responsive evaluation. Accessibility
  conformance cannot be claimed from automation or a partial page alone.
- Fix only verified regressions inside the accepted Claude Design. Any finding
  requiring a new workflow, design system or architecture stops for a separate
  amendment.

## External blockers and stop conditions

Open inputs:

1. DEC-009 managed Supabase region/plan/PITR/cost owner, distinct restore
   project, direct database credential and separate Storage/S3 destination.
2. Log-drain/pager destination, supported paid plan and operational owner.
3. DEC-010 numeric capacity plus SLO/RPO/RTO decisions.
4. DEC-012 privacy, residency, retention/legal deletion and provider DPA.
5. DEC-017 release window, freeze rules and rollback authority.
6. Dedicated sanitized private WAHA identity/session authority for later real
   provider evidence.
7. Human accessibility reviewer and approved AT/browser/device matrix.

Stop before any raw audit/provider exposure, widened audit authority, public
operational endpoint, managed/production/customer/provider mutation,
non-isolated restore, unapproved load, Axe-only accessibility completion, or a
discovered architecture/product-flow change. Record the blocker and require a
new reviewed amendment instead of silently expanding P7.
