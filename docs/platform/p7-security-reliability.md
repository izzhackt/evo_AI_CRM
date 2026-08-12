# P7 security, reliability and operations contract

Status: authoritative docs-only implementation contract.

Plan Block-ID: `EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-12`

Accepted baseline:

- merged P6D main SHA: `1e53d93d8c70c286e56c5d057928e9f080c58a44`
- exact-main CI run: `31650640795`
- contiguous migrations: `001-070`
- external primary-source evidence: `docs/research/p7-official-evidence-2026-08-12.md`

This document decomposes P7 before implementation. It changes no product code,
migration, runtime configuration, provider state, credential, customer data or
production service.

## Purpose

P7 closes the first security/reliability lane after the merged P6 operator and
Portal path. It does not reopen amoCRM mapping activation, production deploy,
real provider proof, or Lead Agent retirement. It narrows broad “security and
reliability” language into a small sequence of reviewable slices with honest
evidence boundaries:

1. repo-owned admin audit search/export;
2. structured observability and health;
3. isolated database-plus-separate-Storage backup/restore rehearsal;
4. bounded load and accessibility evidence.

P7 is complete only after P7A-P7D below are each reviewed, merged and proved.
Partial completion is not broad P7 completion.

## Current external constraints from primary docs

The official-source evidence in `docs/research/p7-official-evidence-2026-08-12.md`
sets hard limits for this lane:

- Supabase database backups do not include Storage objects, and restoring a
  backup does not restore objects deleted after that backup.
- Supabase project log drains are documented only for Pro, Team and Enterprise
  plans.
- Supabase Platform Audit Log Drains are configured at the organization level,
  and the dashboard currently provides no direct export of those audit logs.
- PostgreSQL `pg_dump`/`pg_restore` support selective, isolated archive/restore
  workflows for disposable destinations, but restore remains a trusted-code
  operation and must not target production casually.
- k6 thresholds are the documented pass/fail mechanism for load assertions.
- WCAG conformance evaluation requires both automated and human evaluation, and
  WCAG-EM is a method, not a new requirement set.
- WAHA officially documents `/health` and its health-indicator payload. This
  amendment does not assume undocumented WAHA metrics/export endpoints.

## Non-goals

- no production restore, PITR trigger, or managed Supabase restore;
- no production DNS, deploy, migration, or WAHA session mutation;
- no undocumented WAHA `/metrics` or hidden dashboard scraping claim;
- no claim that automated accessibility scans alone prove WCAG conformance;
- no broad “security complete” claim from a single slice;
- no expansion into P8 release execution or P10 audit in this PR.

## P7A — repo-owned admin audit search/export

P7A starts first because it is the thinnest truthful slice.

### Scope

- Build a Platform-owned admin audit search/export path over repository-owned
  audit tables and fields only.
- Search/filter/export only data that already exists inside the Platform data
  plane and is already authorized for staff administration.
- Keep export bounded, authenticated, and reviewable. No unbounded raw dump.

### Boundaries

- Do not present Supabase organization audit logs as if they were repository
  rows.
- Do not claim dashboard export parity with Supabase Platform Audit Logs,
  because the official docs say dashboard export is currently unavailable.
- If owner plan or organization access for Supabase audit log drains is absent,
  record that as an external blocker rather than fabricating a substitute.

### Acceptance

- Admin-only positive path plus non-admin denial.
- Search/filter/export path is deterministic, auditable and bounded.
- Export contains only allowed fields and excludes secrets, tokens and private
  provider credentials.
- Validation includes repo security/RLS checks, exact affected browser proof,
  and a separate negative export-authorization case.

## P7B — structured observability and documented health

P7B starts only after P7A is accepted.

### Scope

- Add or refine structured Platform logs, correlation/request IDs, and
  actionable health/readiness signals for the root Platform path.
- Use only documented WAHA observability contracts. The documented WAHA health
  contract is `GET /health` with status plus indicator details.
- Add project log-drain configuration/runbook work only where the real plan
  tier and owner destination exist.

### Boundaries

- Do not claim a WAHA Prometheus/metrics endpoint unless it is separately
  documented and verified.
- Do not claim Supabase audit-log export through the dashboard.
- Do not bind implementation to a paid drain destination before the owner
  confirms the destination and plan authority.

### Acceptance

- Documented health/readiness semantics are explicit and fail closed.
- Logs are structured enough to correlate a request or background operation
  without exposing secrets or customer-private payloads unnecessarily.
- Optional drain/export work is reported separately as verified or blocked,
  depending on real plan/credential authority.

## P7C — isolated backup and restore rehearsal

P7C starts only after P7B is accepted.

### Scope

- Inventory the Platform stores touched by the current MVP lane: database,
  private Storage objects, encrypted settings, and release/config artifacts.
- Rehearse restore only into isolated disposable destinations.
- Keep database and Storage restore as separate procedures and proofs.

### Boundaries

- Do not restore into production.
- Do not imply that a successful database restore also restored Storage
  objects.
- Do not imply managed Supabase PITR or dashboard restore authority from local
  `pg_dump`/`pg_restore` proof.

### Acceptance

- Database restore path uses a documented archive format suitable for
  `pg_restore` and restores into a disposable target only.
- Storage restore path is separately inventoried and verified.
- Decryption-sensitive or secret-bound artifacts are either proved safely or
  recorded as blocked with the exact missing authority.

## P7D — bounded load and accessibility evidence

P7D starts only after P7C is accepted.

### Scope

- Add a small production-like load harness for the approved Platform slice with
  explicit k6 thresholds.
- Add an accessibility review that combines automated checks with human
  evaluation against the accepted frontend states.

### Boundaries

- No “scale proof” claim beyond the measured bounded scenario.
- No WCAG conformance claim from automation alone.
- No hidden production traffic generation.

### Acceptance

- k6 thresholds are explicit, versioned and gate pass/fail for the tested
  scenario.
- Accessibility evidence covers keyboard/focus flows and other human-reviewed
  states that automation alone cannot prove.
- The report separates verified issues, blocked checks and deferred broader
  work.

## Ordered merge boundary

- This amendment is docs-only and is the only active block until it is reviewed
  and merged.
- After exact-main CI is green for this amendment, implementation proceeds
  sequentially as P7A, then P7B, then P7C, then P7D.
- P8 starts only after all intended P7 slices are accepted and merged.
- P10 remains the later authorized-scope audit and must report P4B
  activation/writes as deferred unless a later explicit authority changes that.
