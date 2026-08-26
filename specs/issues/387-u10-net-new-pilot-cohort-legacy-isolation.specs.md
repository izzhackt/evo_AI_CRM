# Issue #387 Specs

Status: exact-main-rebased implementation spec for Issue #387
Date: 2026-08-27 (Asia/Dubai)
Parent: #376
Depends on: #386, completed through PR #401 and exact-main run `33017855457`
Blocks: #388

## Outcome

The pilot gains an explicit net-new cohort boundary and legacy isolation so a
pilot case can operate only through canonical EVO/Supabase paths without a
hidden fallback into legacy writes.

## Included scope

- explicit pilot configuration with a net-new cutoff and clear enable/disable
  state;
- automatic pilot eligibility only for new canonical cases that satisfy the
  exact cutoff rule;
- authorized manual include/exclude for exceptional cases with required reason,
  provenance and immutable audit evidence;
- visible current pilot status and provenance on canonical Student Cases and
  bounded read models;
- truthful write-boundary evaluation for pilot versus forbidden legacy paths;
- bounded pilot counts and status suitable for the next readiness slice;
- rollback/removal that preserves append-only membership history and audit.

## Excluded scope

- no broad migration of active legacy records;
- no historical closed-record migration;
- no dual-write;
- no silent copy of an old case into the pilot;
- no legacy CRM fallback for normal pilot operations;
- no provider, deployment or production claim.

## Canonical implementation constraints

- Reuse canonical `platform.student_cases` as the visible case authority.
- Reuse existing handoff/case/read/audit seams rather than introducing a
  parallel pilot product or a second case table.
- Keep operational writes inside EVO/Supabase only.
- Any path that would require a forbidden legacy write must fail closed with a
  truthful blocked result.
- Current case membership may be stored on the canonical case row for efficient
  reads, but membership changes must also be preserved as append-only events.

## Exact automatic-entry rule

Automatic inclusion is insert-only and must never scan or update existing
cases. It requires one active organization configuration and all of the
following timestamps to be at or after its exact cutoff:

- canonical Client `created_at`;
- canonical Lead `created_at`;
- canonical Student Case `created_at`.

The case must also bind the same organization, Client and Lead, and its
`source_key` must equal `canonical-lead:<canonical_lead_id>`. A direct or legacy
case without those exact canonical bindings remains outside. A later config
change never backfills prior cases.

## Staff-observable acceptance criteria

- [ ] New eligible canonical cases enter the pilot automatically only after the
      explicit cutoff/config rule.
- [ ] Existing legacy cases do not enter automatically.
- [ ] Authorized staff can include or exclude a case with visible reason,
      provenance and audit.
- [ ] Pilot status and provenance are visible on the canonical case detail.
- [ ] Forbidden legacy-write paths are blocked truthfully.
- [ ] Canonical EVO writes continue correctly for pilot cases.

## Authorization and RLS negative cases

- [ ] Unauthorized pilot config changes are denied.
- [ ] Unauthorized include/exclude actions are denied.
- [ ] Cross-organization pilot visibility or mutation is denied.
- [ ] Replay/rerun stays idempotent for config and include/exclude request IDs.
- [ ] Forbidden legacy-write paths fail closed and do not silently downgrade to
      a compatibility path.

## Evidence required to close

- [ ] exact PR head SHA is identified;
- [ ] exact-diff self-review is complete with no known unresolved blocker;
- [ ] all required exact-head CI checks are green;
- [ ] merge is protected with `--match-head-commit`;
- [ ] exact-main verification is complete;
- [ ] isolated proof covers eligible new case entry, legacy-case exclusion,
      authorized include/exclude, unauthorized denial, blocked legacy write,
      canonical EVO write continuity, audit and tenant isolation.

## Production boundary

Repository and disposable-local proof only. No managed/provider claim and no
historical/archive migration.
