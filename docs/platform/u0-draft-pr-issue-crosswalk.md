# U0 crosswalk: draft PRs and historical open issues

- Owner: EVO product owner and technical owner
- Status: active backlog disposition for parent #376
- Snapshot date: 2026-08-24 (Asia/Bishkek)
- Snapshot base: GitHub `origin/main`
  `31d26b6e6bdc8a96fcf9f48210e417d43619370d`
- Scope: all 16 open PRs (all were draft) and all 11 open pre-#376 issues at
  snapshot time
- Authority: #376, #377 and ADR 0020

## How to read the disposition

Each item has one execution disposition:

- **Source material only** — retain facts, tests or design observations; no
  implementation is pre-approved and no branch may merge directly.
- **Rebuild in Ux** — selectively recreate only still-valid behavior from
  current `main` inside the named U-slice, with that slice's tests, review and
  exact-head CI. The old branch remains untouched.
- **Superseded** — the old execution contract is replaced by #376/U0-U14.
  Immutable evidence may still be consulted, but the issue must not execute.
- **Requires human review** — no U-slice currently owns the whole decision, or
  execution needs business, privacy, cost, destructive-action or external-
  write authority.

This document does not close, delete, edit, rebase or merge any listed item.
Disposition is an execution-routing decision, not a statement that all old
content is correct.

## Current draft PRs — complete 16/16 inventory

| PR | Current shape | Disposition | Retained value and next owner |
| --- | --- | --- | --- |
| [#361](https://github.com/izzhackt/evo_AI_CRM/pull/361) Admissions filters/CSV | Draft stacked on #356, not `main` | **Rebuild in U7 (#384)** | Revalidate filters and navigation against the canonical case model. CSV export is not implicitly approved; U7 must confirm authorization, minimization and need before including it. |
| [#360](https://github.com/izzhackt/evo_AI_CRM/pull/360) case block visibility | Draft stacked on #359 | **Rebuild in U8 (#385)** | Reuse only the least-privilege visibility idea after U8 confirms the pilot-role model and canonical finance projections. |
| [#359](https://github.com/izzhackt/evo_AI_CRM/pull/359) finance stop factors | Draft based on `main` | **Rebuild in U8 (#385)** | Rebuild payment schedule, overdue and stop-factor behavior without preserving the old standalone `finance` role or SQLite fixture seam. |
| [#357](https://github.com/izzhackt/evo_AI_CRM/pull/357) audit questions | Draft based on `main` | **Rebuild in U11 (#388)** | Revalidate question-to-event mappings against the final U1-U10 audit vocabulary and bounded search contract. |
| [#356](https://github.com/izzhackt/evo_AI_CRM/pull/356) admissions country overview | Draft based on `main` | **Rebuild in U7 (#384)** | Revalidate the unified case view and visa-as-separate-state rule; do not preserve stale role or fixture assumptions. |
| [#347](https://github.com/izzhackt/evo_AI_CRM/pull/347) deployment verification | Draft based on `main` | **Rebuild in U11 (#388)** | Preserve fail-closed revision/health ideas. U11 must bind checks to the unified service topology; U12 owns real managed acceptance. |
| [#346](https://github.com/izzhackt/evo_AI_CRM/pull/346) staff management | Draft based on `main` | **Rebuild in U1 (#378)** | Rebuild on the three pilot roles, explicit sensitive permissions, revocation and audited role changes. Do not merge its five-role assumptions. |
| [#343](https://github.com/izzhackt/evo_AI_CRM/pull/343) Hermes environment facts | Docs draft based on `main` | **Rebuild in U11 (#388)** | Reuse the fact-classification method only. Every environment fact is time-bound and must be re-read before any current claim. |
| [#337](https://github.com/izzhackt/evo_AI_CRM/pull/337) catalogue programme migrations | Draft based on `main` | **Rebuild in U7 (#384)** | Re-audit the catalogue need and schema from current migration tip. Its proposed migration ordinals and old plan chain are not reservations. |
| [#334](https://github.com/izzhackt/evo_AI_CRM/pull/334) root Python tests in CI | Draft based on `main` | **Source material only** | Records a possible CI coverage gap. It is not required by a current U-slice and needs a separate current-main issue if still present. |
| [#322](https://github.com/izzhackt/evo_AI_CRM/pull/322) catalogue schema plan | Docs draft based on `main` | **Rebuild in U7 (#384)** | Revalidate source, schema and approval workflow. Proposed ADR/migration numbers have no authority. |
| [#320](https://github.com/izzhackt/evo_AI_CRM/pull/320) KPI definitions | Docs draft based on `main` | **Requires human review** | Product owner must approve KPI composition, owners, targets and exchange-rate policy. U11 may later implement only approved definitions. |
| [#319](https://github.com/izzhackt/evo_AI_CRM/pull/319) repository hygiene | Draft based on `main` | **Source material only** | #391 may consult its archive/privacy and duplicate-ADR observations. ADR numbering and ignore rules must be rechecked from current `main`; no direct merge. |
| [#317](https://github.com/izzhackt/evo_AI_CRM/pull/317) catalogue source inventory | Draft based on `main` | **Rebuild in U7 (#384)** | Re-run against the then-approved source boundary, retain provenance and revalidate all measured counts; do not inherit old vault snapshots as current. |
| [#316](https://github.com/izzhackt/evo_AI_CRM/pull/316) TZ traceability refresh | Docs draft based on `main` | **Rebuild in U11 (#388)** | Its traceability method is useful, but every readiness status and SHA predates #376 and must be regenerated after U1-U10. |
| [#159](https://github.com/izzhackt/evo_AI_CRM/pull/159) protected WAHA knowledge export | Draft based on `main` | **Source material only** | #391 may use its immutable archive/checksum patterns. Real-chat archive handling remains privacy-sensitive and needs explicit authorized scope; do not merge the old runtime tooling blindly. |

## Historical open issues — complete 11/11 pre-#376 inventory

| Issue | Disposition | Retained value and next owner |
| --- | --- | --- |
| [#1](https://github.com/izzhackt/evo_AI_CRM/issues/1) Gemini receive-only rollout PRD | **Superseded** | #376 replaces its separate Lead Agent/amoCRM-canonical product contract. Receive-only, fail-closed credential and evidence ideas remain source input for U3, U9 and U12. |
| [#5](https://github.com/izzhackt/evo_AI_CRM/issues/5) production receive-only proof | **Superseded** | U12 (#389) owns real managed receive-only acceptance after U1-U11. The old proof's amoCRM create/write and separate Lead Agent path are prohibited. |
| [#20](https://github.com/izzhackt/evo_AI_CRM/issues/20) companion production proof | **Superseded** | Separate Inbox product/login, amoCRM-owned identity and manual outbound proof conflict with #376. Inbound/private-WAHA evidence patterns may inform U3/U12 only. |
| [#42](https://github.com/izzhackt/evo_AI_CRM/issues/42) Inbox Prettier baseline | **Requires human review** | Broad mechanical formatting is outside U1-U14 and needs a separate owner-prioritized current-main issue if still valuable. |
| [#162](https://github.com/izzhackt/evo_AI_CRM/issues/162) managed recovery/consolidation | **Requires human review** | U11 owns truthful backup/rollback evidence and U10 owns active migration. Billed resources, real data and deleting a managed project remain separately authorized human actions. |
| [#167](https://github.com/izzhackt/evo_AI_CRM/issues/167) accessibility/capacity gate | **Source material only** | U11/U12 may reuse focused accessibility evidence patterns. Deferred capacity and device review are not accepted proof. |
| [#257](https://github.com/izzhackt/evo_AI_CRM/issues/257) importer identity retry | **Superseded** | Exact old candidate/importer facts remain immutable release history. U12 must build acceptance from the then-current exact candidate. |
| [#265](https://github.com/izzhackt/evo_AI_CRM/issues/265) post-P8D baseline | **Superseded** | Its blocked rollout baseline is time-bound source material. U11/U12 must collect a fresh unified-platform baseline. |
| [#266](https://github.com/izzhackt/evo_AI_CRM/issues/266) OZO assistant contracts | **Rebuild in U9 (#386)** | Reuse non-executable structured-output and semantic-validation ideas only after rebinding them to canonical U1-U8 context and human review. |
| [#287](https://github.com/izzhackt/evo_AI_CRM/issues/287) v1 production rollout | **Superseded** | U12 and U13 replace the broad old rollout. Manual WhatsApp send, amoCRM identity authority and old deployment topology are not inherited. |
| [#340](https://github.com/izzhackt/evo_AI_CRM/issues/340) P8V3H command parity | **Superseded** | Preserve exact failure/evidence facts as U12 source material only; the consumed old release path cannot resume. |

## Explicit non-draft source named by the new backlog

U3 also names merged PR
[#367](https://github.com/izzhackt/evo_AI_CRM/pull/367) as source material.
Its merge history remains immutable. U3 must audit the exact current `main`
behavior and rebuild only a still-current gap; the merged PR is not proof that
the U3 receive-only canonical flow already works.

## Active backlog boundary

The only active implementation sequence is:

`U0 #377 → U1 #378 → U2 #379 → U3 #380 → U4 #381 → U5 #382 → U6 #383 → U7 #384 → U8 #385 → U9 #386 → U10 #387 → U11 #388 → U12 #389 → U13 #390 → U14 #391`.

U0 stops after this documentation package. No row in this crosswalk authorizes
starting U1, touching production/providers, sending WhatsApp or writing amoCRM.
