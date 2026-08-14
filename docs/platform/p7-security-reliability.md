# P7 security, reliability and operations contract

Status: authoritative implementation contract; P7A and P7B accepted, P7C
deferred by owner decision, focused P7D contract active

Version date: 2026-08-14 (Asia/Bishkek)

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
- PR #160 merged P7B as
  `a6077ad6b7642deceead31dd11ed463548216d58`, including migration `072`;
- exact-main push CI run `31753423736` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped on the push event as expected;
- P7A evidence is repository/disposable-local only. Its runtime remains
  disabled by default, and it proves no managed Supabase, production or
  real-provider behavior;
- P7B is accepted. The owner deferred P7C recovery and the large P7D capacity
  stress test. Focused P7D accessibility is next under
  `docs/platform/p7d-focused-accessibility-contract.md` and issue #167;
- the managed P7C recovery and cost boundary remains frozen in
  `docs/platform/p7c-managed-recovery-contract.md` and issue #162;
  `inbox-prod` is a separate retained Inbox SaaS product outside P7C.

This contract expands the append-only Block-ID above. If wording conflicts,
`docs/PLAN_CHANGES.md` and `docs/EVO_PLATFORM_LONG_RUN_PLAN.md` take
precedence. This documentation change modifies no application code, schema,
runtime credential or customer data. It records the separately owner-authorized
completed organization transfer and display-name change described by the P7C
contract.

## Outcome and sequence

P7 makes the merged P5-P6 Platform safe to inspect, operate, recover and
evaluate without treating local fixtures as production evidence. It executes
only as:

1. `P7-PLAN` - this reviewed docs-only authority gate;
2. `P7A` - safe Admin-only Platform audit search/export;
3. `P7B` - private structured observability, alert evaluation and runbooks;
4. `P7C` - owner-deferred managed database plus separate private Storage
   recovery and Platform schema-promotion proof;
5. `P7D` - focused automated plus owner-led human accessibility closure, with
   large capacity stress explicitly deferred/unproved.

Each implementation block requires its own fresh worktree, focused tests,
independent exact-head review, green exact-head CI, direct merge of only that
reviewed head and green exact-main push CI. P8 candidate preparation may follow
the focused P7D contract; release remains blocked until focused accessibility
is complete and every unavailable managed/provider/production segment is
recorded as blocked or deferred.

## Global truth and safety boundary

- Repository and disposable loopback proof is not managed Supabase,
  production, real-provider or customer-data proof.
- No P7 block authorizes production deployment/migration, DNS, WAHA session or
  QR mutation, live WhatsApp send, amoCRM write, broad outbound automation,
  retention deletion or destructive production restore. The completed P7C
  managed project transfer and rename are the only superseding provider/service
  exception. Deferred recovery requires fresh authority.
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

## P7C - deferred managed recovery and Platform promotion

### Required implementation

- Follow `docs/platform/p7c-managed-recovery-contract.md` and issue #162.
- Use the real managed source, encrypted PostgreSQL export and separate Storage
  manifest. Restore only into a newly created, distinctly named, empty managed
  recovery project in the approved Pro organization and Singapore region.
- Keep the source project reference/region/credentials stable. The completed
  display-name and organization transfer is not a database migration.
- Prove current managed migration `039` compatibility and repository migrations
  through `072` on the recovery destination before seeking production migration
  authority.
- Leave `inbox-prod` untouched. It is a separate owned Inbox SaaS product and
  is not a P7C source, destination, migration or retirement target.

### Required acceptance

- Destination schema, migration history, safe aggregate counts, Auth identity
  counts, RLS/grants and required application reads match the source contract
  without exposing customer values.
- Database and Storage produce separate reports and encrypted artifact/manifest
  hashes. The current zero-object Storage result does not claim non-empty byte
  recovery.
- Managed restore duration/data-loss-window observations are not an approved
  RPO/RTO or PITR claim.
- Absent, corrupt, partial or wrong-destination artifacts fail closed.
- Production migration, PITR, non-empty Storage recovery and legacy deletion
  remain blocked until their exact contract prerequisites pass.

## P7D - focused accessibility closure; capacity deferred

### Entry gate

The owner deferred the large capacity stress test and approved the focused
small-launch/accessibility contract in
`docs/platform/p7d-focused-accessibility-contract.md`. Capacity remains
unproved. The owner is the human accessibility reviewer and approved the
Mac/iPhone/Android browser and assistive-technology matrix.

### Required implementation and acceptance

- Do not create a temporary load project or run the former large k6 profile.
  Reopen formal load testing only under the triggers and fresh authority in the
  focused contract; do not call capacity passed.
- Run the existing automated accessibility suite on the exact real release
  candidate and record its exact evidence without claiming formal conformance.
- Complete the focused human keyboard, focus, zoom, dialog, VoiceOver and
  mobile review on that same candidate.
- Fix only verified regressions inside the accepted Claude Design. Any finding
  requiring a new workflow, design system or architecture stops for a separate
  amendment.

## External blockers and stop conditions

Open inputs:

1. DEC-009 managed Supabase region/plan/PITR/cost owner, distinct restore
   project, direct database credential and separate Storage/S3 destination.
2. Log-drain/pager destination, supported paid plan and operational owner.
3. DEC-010 numeric capacity plus SLO/RPO/RTO decisions remains deferred.
4. DEC-012 privacy, residency, retention/legal deletion and provider DPA.
5. DEC-017 release window, freeze rules and rollback authority.
6. Dedicated sanitized private WAHA identity/session authority for later real
   provider evidence.
7. Human accessibility evidence on the exact real release candidate; the owner
   and Mac/iPhone/Android matrix are approved, but the review has not run.

Stop before any raw audit/provider exposure, widened audit authority, public
operational endpoint, managed/production/customer/provider mutation,
non-isolated restore, unapproved load, Axe-only accessibility completion, or a
discovered architecture/product-flow change. Record the blocker and require a
new reviewed amendment instead of silently expanding P7.
