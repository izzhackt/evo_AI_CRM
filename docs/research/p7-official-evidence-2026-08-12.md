# P7 official evidence refresh

Date: 2026-08-12 (Asia/Bishkek)
Scope: docs-only P7 security/reliability amendment
Method: primary-source refresh only; no production access

## Concise conclusion

P7 must stay narrower than the older broad wording. Current official docs support:

- separate database and Storage restore procedures;
- plan-gated Supabase log drains;
- organization-level Platform Audit Log Drains with no dashboard export;
- isolated `pg_dump`/`pg_restore` rehearsal into disposable destinations;
- k6 thresholds as explicit pass/fail load gates;
- accessibility evidence that combines automation and human evaluation;
- WAHA health checks through documented `/health`.

They do not support claiming that:

- a database backup restores Storage objects;
- Supabase dashboard audit logs are directly exportable;
- undocumented WAHA metrics endpoints are part of the contract;
- automated accessibility scans alone prove WCAG conformance.

## Primary-source notes

### 1. Supabase backups vs Storage objects

Supabase documents that database backups do **not** include Storage objects and
that restoring an old backup does not restore objects deleted later.

Source:

- https://supabase.com/docs/guides/platform/backups

Implication for P7:

- database restore and Storage restore must be separate acceptance items;
- P7C cannot claim “full restore” from a database backup alone.

### 2. Supabase log drains are plan-gated

Supabase documents that log drains are available only on Pro, Team and
Enterprise plans and are configured under Project Settings → Log Drains.

Source:

- https://supabase.com/docs/guides/monitoring-and-debugging/log-drains

Implication for P7:

- P7B may specify log-drain work only where real plan tier and destination
  authority exist;
- missing tier/destination must be reported as blocked, not mocked.

### 3. Supabase Platform Audit Logs are not the same as repo-owned audit rows

Supabase documents that Platform Audit Log Drains are configured under the
organization’s audit log drains, and that there is currently no way to export
those logs via dashboard.

Source:

- https://supabase.com/docs/guides/security/platform-audit-logs

Implication for P7:

- P7A should start with repo-owned audit search/export;
- any Supabase platform-audit drain/export work must stay explicitly separate.

### 4. PostgreSQL isolated dump/restore semantics

PostgreSQL documents that:

- `pg_dump` custom and directory formats are suitable for `pg_restore`;
- `pg_restore` restores archives created by `pg_dump` non-plain-text formats,
  and can restore directly into a named database or emit SQL;
- restore executes database code and therefore must target trusted,
  disposable destinations only.

Sources:

- https://www.postgresql.org/docs/current/app-pgdump.html
- https://www.postgresql.org/docs/current/app-pgrestore.html

Implication for P7:

- P7C should use an isolated archive-and-restore rehearsal;
- restore into production is out of scope.

### 5. k6 thresholds are the documented pass/fail gate

Grafana k6 documents that thresholds configure the conditions under which a
test is considered successful or failed.

Sources:

- https://grafana.com/docs/k6/latest/using-k6/metrics/
- https://grafana.com/docs/k6/latest/using-k6/k6-options/reference/

Implication for P7:

- P7D should express performance acceptance with explicit thresholds, not just
  collected timing output.

### 6. WCAG conformance needs human evaluation too

W3C documents that WCAG success-criteria testing involves a combination of
automated testing and human evaluation, and WCAG-EM is a methodology that is
independent of particular tools or assistive technologies.

Sources:

- https://www.w3.org/WAI/WCAG22/Understanding/conformance
- https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/

Implication for P7:

- P7D cannot claim accessibility completion from automation alone;
- the amendment must require human-reviewed flows.

### 7. WAHA documented observability

WAHA currently documents `GET /health`, health statuses, and health indicators
for media-file space, session-file space, and MongoDB.

Source:

- https://waha.devlike.pro/docs/how-to/observability/

Implication for P7:

- P7B may rely on documented WAHA health semantics;
- this amendment should not promise an undocumented WAHA metrics/export
  endpoint.
