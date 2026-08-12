# P7 official evidence note

Checked: 2026-08-12 (Asia/Bishkek)

Purpose: record the primary-source constraints used by Block
`EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-12`. This is research evidence, not
provider, managed-environment, customer-data or production proof.

## Supabase database backups and PITR

Official source:
<https://supabase.com/docs/guides/platform/backups>

Verified boundary:

- database backups do not include Storage API object bytes;
- restoring a database backup does not restore Storage objects deleted after
  the backup;
- backup/PITR availability and retention depend on plan and configuration.

P7 implication: database restore and private Storage restore must be separate
P7C artifacts, procedures and reports. Local proof cannot claim managed PITR.

## Supabase Storage S3 compatibility

Official source:
<https://supabase.com/docs/guides/storage/s3/compatibility>

Verified boundary:

- S3 object versioning is not supported;
- deleted objects are permanently removed and cannot be restored through
  versioning.

P7 implication: P7C must explicitly inventory and copy private object bytes;
database metadata or a presumed version history is insufficient.

## Supabase Log Drains

Official source:
<https://supabase.com/docs/guides/monitoring-and-debugging/log-drains>

Verified boundary: project Log Drains stream Supabase stack logs to supported
external destinations and require a supported paid plan (documented for Pro,
Team and Enterprise).

P7 implication: local formatting and alert evaluation may be proved in P7B,
but external drain/pager delivery remains blocked until plan, destination,
credentials, cost and accountable owner are approved.

## Supabase Platform Audit Logs

Official source:
<https://supabase.com/docs/guides/security/platform-audit-logs>

Verified boundary:

- these logs record Supabase Platform API/dashboard actions by organization
  members, not EVO application-domain events;
- they are documented for Team and Enterprise plans;
- the dashboard currently has no direct log export.

P7 implication: Platform Audit Logs do not replace `platform.audit_events` or
authorize copying dashboard details into EVO. P7A implements a repo-owned safe
application audit projection/export only.

## PostgreSQL archive and restore

Official sources:

- <https://www.postgresql.org/docs/current/app-pgdump.html>
- <https://www.postgresql.org/docs/current/app-pgrestore.html>

Verified boundary:

- `pg_dump` produces a consistent single-database export without blocking
  ordinary readers/writers;
- custom/directory archives are consumed by `pg_restore` and support selective
  inspection/reordering;
- restoring a dump executes source-controlled database code and therefore
  requires a trusted source and isolated target.

P7 implication: P7C uses synthetic owned source data and an empty disposable
destination, verifies the archive before restore and never points the drill at
production.

## Grafana k6 thresholds

Official source:
<https://grafana.com/docs/k6/latest/using-k6/thresholds/>

Verified boundary: thresholds are explicit pass/fail criteria for test metrics;
a failed threshold makes the test fail with a non-zero outcome. Checks alone do
not change the overall exit status unless used through a threshold.

P7 implication: P7D needs an owner-approved numeric profile and explicit
thresholds. Timing output without thresholds is observation, not acceptance or
an SLO.

## WCAG 2.2 conformance evaluation

Official source:
<https://www.w3.org/WAI/WCAG22/Understanding/conformance.html>

Verified boundary:

- evaluation involves a combination of automated testing and human review;
- conformance applies to full pages, including responsive variations, rather
  than an excluded component or partial page.

P7 implication: Axe and responsive screenshots are useful evidence but cannot
complete P7D alone. Human keyboard, focus, zoom, dialog and screen-reader
evaluation against an approved matrix remains mandatory.

## WAHA observability

Official source:
<https://waha.devlike.pro/docs/how-to/observability/>

Verified boundary: WAHA documents `GET /health`, its `ok`, `error` and
`shutting_down` statuses, and indicator details such as media/session storage
space and MongoDB health where applicable.

P7 implication: P7B may consume documented health semantics through private
networking. It must not promise an undocumented WAHA metrics exporter or make
the detailed health payload public.

## Evidence classification

These sources constrain design and claims. They do not prove the EVO code,
credentials, plan tier, managed project, provider session, backup, restore,
load capacity, accessibility conformance or production release. Each such claim
requires the separately defined P7 implementation gate and its own evidence.
