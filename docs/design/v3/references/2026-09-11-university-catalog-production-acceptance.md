# University catalogue: production acceptance ledger, 11 September 2026

Status: **APPLICATION ACCEPTED / 143 CATALOGUE CARDS PUBLISHED / TWO-PHOTO CORRECTION PENDING**.
The application and catalogue content are live. Browser acceptance found two
failed photo embeds; their corrective release is not yet accepted.
Times below are UTC unless explicitly stated; the run date uses Asia/Dubai.

Contract: [university completion run plan](../university-catalog-completion-run-plan.md).
Tracking: [issue 725](https://github.com/izzhackt/evo_AI_CRM/issues/725).
Update this ledger only from actual run receipts, server readback and browser
observations. It is the continuation record, not permission to skip release gates.

## Reviewed and merged implementation

- Independent review approved exact head
  `ed8c090d032a61de2848a848c52e77cbbbb263a9`, based on
  `2c4bce396efd7bd515000a135db75cefe5aea8d9`. No open findings remained.
- [PR 726](https://github.com/izzhackt/evo_AI_CRM/pull/726) merged at
  `2026-09-10T20:32:00Z` as
  `88d0354f828f1e753b902480de38b075d63442d9`. Its tree equals the reviewed tree;
  this was independently checked with `git diff --quiet` between the two SHAs.
- [PR checks 34526286528](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34526286528)
  passed all six jobs: Changed range, Release contracts, Migration boundary,
  Lint, Build and Fast checks. The migration-boundary job took 5m27s. This is
  CI database evidence, not proof that migration 151 ran against managed production.
- The reviewer independently reran the focused catalogue/action suite: **23/23
  passed**. Actual local outputs for full typecheck, ESLint and production Next.js
  build plus knowledge-import esbuild were inspected and successful. Diff-check
  was clean. These checks do not exercise production Admin publication.

Prepared package: **143 institutions, 251 selected programmes, 15 countries**.
All 143 reference a photo from the reviewed 144-entry registry; HIT Shenzhen is
the unused reviewed image. Source-roster coverage and the original 16 canonical
identities are checked. This is not an exhaustive catalogue of every degree at
each university: 78 programme languages, 76 durations and intake data for 112 programmes
remain unconfirmed/absent, as recorded in the plan. Three historical Chinese
language-course offers explicitly require reconfirmation.

## Pre-release baseline

The executor's baseline check retained the previously accepted application:

| Evidence | Baseline value |
| --- | --- |
| App revision | `32693abb3fac3bcdb345d0851363d57c474016ef` |
| Accepted pointer | `v3-r34483764042-a1-32693abb` |
| Image | `sha256:9cc169dd7b2e753e621b118de18509184f670ce53c3740415b79aecdd4311c85` |
| Acceptance SHA-256 | `394446c215debbd3ca3a98ef4cf739029f685a2c6cedbbdebc0715083e324329` |
| Pending release | Absent at the baseline check |
| Published catalogue | Previously accepted 16 institutions; not a new 143-card readback |

These identifiers match the [prior accepted Admin preview record](../student-portal-admin-preview-plan.md).
They describe the predecessor, not this run's deployment outcome. Recheck live
pointer, image, health/restarts, pending state and arm after the new release.

## Exact-main CI and schema evidence

| Run | SHA / observed result |
| --- | --- |
| [Baseline ledger check 34526349419](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34526349419) | `2c4bce39`; success. At `2026-09-10T20:26:21Z`, local 150 / production 150, no missing or extra versions. Read-only. |
| [Candidate ledger check 34526969891](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34526969891) | `88d0354f`; success. At `2026-09-10T20:32:28Z`, local 151 / production 150, only missing version 151, no extra versions. Read-only, not an apply. |
| [Full platform CI 34526967052](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34526967052) | Exact `88d0354f`; completed successfully at `2026-09-10T20:40:41Z`. All five jobs passed: Current main admission, Main CRM database/browser proof, Main CRM Node/static, Dependency audit and Main CRM aggregate. Started with production release unarmed. This is not managed schema or application release proof. |
| [Managed schema apply 34527897803](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34527897803) | Exact `88d0354f`; success. Dry-run listed only `151_platform_university_catalog_completion.sql`. Actual application started at `2026-09-10T20:42:31Z`, finished at `20:42:33Z`, and the managed post-apply ledger listed all versions `001`–`151` at `20:42:35Z`. |

Migration 151 extends only the reviewed photo vocabulary and non-degree
`language` level in the content validator and catalogue filter. No direct SQL
content import, identity rewrite, ACL change or edit to applied 148/150 is part
of this run. **Managed application of 151 and the post-apply ledger are now
confirmed.** This does not publish any catalogue content or replace the application.

## Release sequence and rerun boundary

Required order: successful exact-main CI → guarded application of only 151 →
acceptance of the new application → explicit Admin publication → complete
catalogue/photo readback. Keep the same current-main candidate while releasing;
do not merge this closeout document ahead of a current-main-bound armed release.

The initial [release run 34527806723](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34527806723)
was skipped on attempt 1 while the arm was false. After CI and managed schema
proof completed, the executor verified current main `88d0354f`, configured and
current actor IDs both `72846050`, and arm=true. The ordinary workflow rerun was
accepted: **attempt 2 completed successfully**, with both `Build immutable
exact-main V3 image` and `Deploy pending V3 and accept exact proof` successful
against the same `88d0354f`. The exact-main CI proof remains run
`34526967052`; CI was not rerun.

GitHub documents that reruns retain the original
`GITHUB_SHA`/`GITHUB_REF` and the privileges of the original triggering actor.
See [GitHub: re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
The completed jobs and the live receipts below support application acceptance.
Guards remained unchanged and no other revision was substituted. Final release
arm=false was read back after completion.

## Accepted application and publication checkpoint

| Evidence | New accepted application |
| --- | --- |
| Release run / attempt | `34527806723` / `2`; both jobs completed successfully |
| Revision | `88d0354f828f1e753b902480de38b075d63442d9` |
| Accepted pointer | `v3-r34527806723-a2-88d0354f` |
| Image | `sha256:a364db850eac737d38b8497b3b78e1e6e2b41d6665f51e7060086ac8898e76ae` |
| Acceptance SHA-256 | `71ee2a2b36ac828c5e8833d4c3a98a35da7d4fc6b904cb4e2b44baef53e367fd`; independent server `sha256sum` matches the pointer |
| Container | Healthy; restarts `0` at readback |
| Pending release | Absent at accepted-state readback |
| Public HTTPS | Fallback `https://evo-crm.72.62.119.112.sslip.io` login returned HTTP `200` |
| Release arm | `false`, verified after release |

The executor opened the new batch screen in real Chrome through
`http://localhost:3000`. It loaded **143 candidates**, with **7 already current**,
**0 identity conflicts**, and **136 to publish**: 127 new institutions plus
9 updates. The Admin explicitly selected the confirmation checkbox and clicked
the publish action. Processing began with Beijing Institute of Technology.
The executor then observed the completed UI result: **136 published, 0 remaining,
no errors**. After a full page reload, the Admin batch screen reread the database
and showed **143 prepared, 143 already current, 0 requiring reconciliation**,
with 143 rows and no pending actions. These current-state comparisons confirm
the published content matches the prepared catalogue after a fresh read.

The reread programme/version distribution was:

| Institutions | Programmes per institution | Published version |
| ---: | ---: | ---: |
| 71 | 1 | 1 |
| 39 | 2 | 1 |
| 21 | 3 | 1 |
| 8 | 3 | 2 |
| 1 | 3 | 3 |
| 3 | 4 | 1 |

Totals independently recomputed from those observations: **143 institutions,
251 programmes; 134 version-1, 8 version-2 and 1 version-3 publications**.
This is successful live Admin publication and readback. Browser findings below
separately qualify photo acceptance and the Admin Student preview.

## Actual browser catalogue and photo acceptance

The executor checked all five staff catalogue pages in real Chrome through the
Hermes tunnel. DOM readback returned **30 / 30 / 30 / 30 / 23 cards**, totalling
**143 unique institution IDs and 251 programmes**. All 16 previously published
institution IDs remained present.

Photo readback on the same pages returned **30 / 28 / 30 / 30 / 23 loaded
images**, or **141/143**. The two actual failures were:

- **GBS Dubai:** the original image returns HTTP 200 and opens directly, but its
  `Cross-Origin-Resource-Policy: same-origin` header prevents embedding in EVO.
  A successful direct image request is therefore not successful UI acceptance.
- **Guangzhou Huashang Vocational College:** the original image host fails DNS
  resolution with `ENOTFOUND` / `ESERVFAIL`.

The executor researched official related-source alternatives and changed only
these two photo-registry records. The image identities and same `photoKey`
values are retained; no migration or database content republication is needed.
See the [photo corrective evidence](2026-09-10-university-completion-photos.md).
Replacement-source checks do not yet prove the new embeds work inside EVO:
**the corrective application release and browser readback remain pending**.

Actual Admin Student preview opened the real published catalogue without the
Admin management controls. The language-level filter returned **22 institutions
and 27 programmes**. Combining Malaysia with the language-level filter returned
zero results, correctly; Malaysia with all levels returned13 institutions and39
programmes. APU detail opened with3 programmes,13 HTTPS source links and a loaded
960px photo explicitly captioned as the historical UCTI building, not current MRANTI.
This proves the Admin preview only, not a real Student/private-session journey.

Before new content is published, the predecessor reader remains compatible with
the old catalogue. After new photo keys / `language` publications, old app
`32693abb` can reject an entire catalogue page. A blind rollback to that image is
therefore not a compatible catalogue recovery. Use a compatible forward fix or
an independently verified rollback; never rewrite immutable publication history
or weaken the parser to conceal incompatibility.

## Pending acceptance evidence

- Reviewed and guarded corrective release for the two photo registry changes,
  with new accepted revision/receipts and final arm=false readback. Verify both
  formerly failed embeds inside EVO; do not count direct image HTTP 200 as proof.
- Recheck the two changed photos in staff and Admin Student preview after the
  corrective release. Other preview/filter/detail checks above passed; this is
  not real Student/private-session acceptance.
- Final public/tunnel catalogue checks after publication, against the same
  accepted Hermes app; the public login and tunnel batch screen already loaded.
  No separate local application/database.

The standing owner decision remains one persistent Supabase database and no new
backup/rehearsal. Auth remains enabled. No WhatsApp, amoCRM, applicant-file or
other unrelated production mutation is authorized by this catalogue ledger.
