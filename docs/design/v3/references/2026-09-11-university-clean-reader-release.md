# University reader cleanup — release and publication record

Owner follow-up [#729](https://github.com/izzhackt/evo_AI_CRM/issues/729).
Contract: [catalogue run plan](../university-catalog-completion-run-plan.md).
Times are UTC. This extends, rather than replaces, the original 143-card
[catalogue acceptance](2026-09-11-university-catalog-production-acceptance.md).

Current status: COMPLETE. Accepted application `4dc5ead9`; all82 content updates
published, catalogue143 current /0 conflicts /0 remaining. The sections below
separate the first reader/content acceptance from the final wrapper correction.

## Initial shared-reader and content acceptance

- Independent review approved exact head
  `091d91a016aa602e8e67481d4a3afa1cb024a02a`, based on
  `add7b19fbac94229455528f2895b7ce519765cfd`; all blocking findings resolved.
- [PR 730](https://github.com/izzhackt/evo_AI_CRM/pull/730) merged as
  `1a7f870bb350ef5ab6dd4cd67596d321e3e71cbc`; its tree matched the reviewed tree.
- [Fast checks 34567639683](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34567639683)
  passed all selected jobs. Migration boundary correctly skipped: no migration.
- Focused real catalogue/action checks: 24/24 PASS, including actual React/Next
  server rendering of all 143 reviewed entries, unknown-row omission and
  ECUST/XISU deadline scope plus Macerata requirements. ESLint and build passed.
- [Manual full CI 34567818877](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34567818877)
  passed every job for exact `1a7f870b`; it was dispatched once.
- [Release 34568354768, attempt 1](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34568354768)
  completed successfully at 06:08:06, including managed-ledger guards,
  authenticated read-only V3 browser smoke and **Accept exact V3 candidate**.

At the executor's post-release readback, the app was healthy with zero restarts:

| Evidence | Value |
| --- | --- |
| Accepted release | `v3-r34568354768-a1-1a7f870b` |
| Revision | `1a7f870bb350ef5ab6dd4cd67596d321e3e71cbc` |
| Image | `sha256:3b0f63265f1f4603e7abc7af5aea05755870e4551639b074c149dcfaf92f4618` |
| Acceptance-record SHA-256 | `8c1b265743326c6dc5ea5e5603dc548ac385acbbdb1ccad44baa25d534fc4369` |
| Pending candidate | Absent |
| Release arm | `false`, set and read back after completion |

The actual acceptance file hash matches the protected current pointer. Literal
generated rollback command (not executed):

```sh
sudo -- /opt/evo-crm/release-evidence/v3-r34568354768-a1-1a7f870b/rollback-command.sh
```

HTTPS health from Hermes returned `ok:true,status:live`. Local Mac curl could
not validate its issuer chain; no TLS bypass was used. The localhost SSH tunnel
had disconnected during computer sleep; it was restored to the same app at
`127.0.0.1:3000 -> 172.16.8.4:3000`, and its real health returned live again.
No new database, migration, backup, provider change or Auth bypass was performed.
The standing owner deferral of a new recovery proof remains in force.

## Published content and actual browser readback

82 existing cards have 110 changed fields. All 143 institutions and 251 selected
programmes remain. Confirmed requirements were moved from mixed editorial notes
into normal programme descriptions/deadline labels. Original notes, IDs, sources,
photos, dates and statuses remain. EMA's conflicting language becomes null;
two ZISU labels retain Chinese without an unknown explanation-language annotation.

After computer sleep Chrome automation disconnected. A fresh task tab recovered
the existing Admin session without a new login, credential change or Auth bypass.
At approximately06:58 the ordinary Admin batch showed143 prepared /61 current /
0 conflicts. Root confirmed and started the82-card publication once. The batch
completed with82 published /0 remaining; its fresh reload at approximately07:02
showed143 current /0 conflicts /0 remaining. Do not repeat the publication.

Actual post-change Chrome through the production tunnel verified:

- Staff ECUST: CSCA requirements, April30 scholarship scope, July10 self-sponsored
  deadline and closed status retained; photo loaded, attribution/source links
  present; real desktop screenshot and DOM showed no horizontal overflow.
- Staff APU: known September/November dates remain; Foundation's unknown November
  day/intake is omitted while its September24 date and academic requirements stay.
- Staff EMA: no conflicting language row or missing-intake paragraph;3-year
  duration,180ECTS,8-week internship and B2 requirement remain.
- Admin Student EMA: same published facts, photo loaded, no horizontal overflow
  or editorial note panel. This is explicitly a read-only Admin preview, not a
  separate Student-account login or private-data persistence proof.
- Actual preview search returned UTM and XISU and opened their real cards.
  UTM retained July17 and closed status on all three programmes; its photo loaded.
  XISU retained March31 with the explicit2026 scholarship-route qualification,
  and a plain Chinese Language Programme heading without missing duration rows.

The first live preview revealed one missed clarification sentence in its PortalPage
description, outside the shared reader. The identical sentence exists on the real
Student detail route. This triggered the corrective release below, not an Auth,
schema or content change. The two wrapper descriptions were changed to
`Программы, условия поступления и даты наборов.` A regression reads both real
route sources: it failed before the change and passed after it. The focused
catalogue suite passed16/16, scoped ESLint and diff-check passed. Source proof was
kept separate from the final live acceptance below.

## Corrective wrapper release

- [PR731](https://github.com/izzhackt/evo_AI_CRM/pull/731) merged as
  `4dc5ead9f0db80885b30c0097b8856f1fbcbef78`. Independent review approved exact
  `49dda9600444c22011801330f43fcae78c592d52` against accepted `1a7f870b`;
  the merge tree matches that reviewed tree.
- [Fast checks34572896530](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34572896530)
  passed every selected job; no migration boundary was selected.
- [Manual full CI34573219849](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34573219849)
  was dispatched with the explicit exact-current-main proof revision at07:11:20.
  All five jobs passed.
- [Guarded release34573853260, attempt1](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34573853260)
  completed successfully at07:24:33, including authenticated read-only smoke and
  **Accept exact V3 candidate**.

Root's final server and browser readback confirmed:

| Evidence | Value |
| --- | --- |
| Accepted release | `v3-r34573853260-a1-4dc5ead9` |
| Revision | `4dc5ead9f0db80885b30c0097b8856f1fbcbef78` |
| Image | `sha256:67733d97fba4fa483b12cc771a96306e6ae69fe0e3243696f9ebfd2d51566b14` |
| Acceptance-record SHA-256 | `2cdc2f28f9fc7a5c837441eb7dd301876dcc1c8e965f5845a6e664e8da2810f5` |
| Container | Healthy, zero restarts |
| Pending candidate | Absent, checked independently |
| Release arm | `false`, set and read back |

Actual acceptance-record hash matches the protected current pointer. Public HTTPS
health from Hermes and localhost tunnel health both returned live; the app retained
172.16.8.4, so the existing tunnel needed no further change. Unauthenticated
`/api/version` correctly returned401; no bypass was attempted. Generated literal
rollback command was read, not executed:

```sh
sudo -- /opt/evo-crm/release-evidence/v3-r34573853260-a1-4dc5ead9/rollback-command.sh
```

At approximately07:26, a fresh Admin Student XISU reload displayed
`Программы, условия поступления и даты наборов.` Its March31 scholarship scope,
Chinese-language course, source links and loaded real photo remained. Actual
desktop screenshot/DOM showed no horizontal overflow. Captured warning/error
entries came from a Chrome extension toolbar, not an EVO-origin script; extension
settings were not changed. Separate Student login/persistence and mobile viewport
proof were not performed in this copy-only correction.

The post-correction Admin batch reload still showed143 current /0 conflicts /
0 remaining. No second content publication or migration was performed. The live
preview was left open; this final evidence-only documentation update needs no
new app build/full CI/release.

Research gaps remain out of reader UI: 79 programme languages and 76 durations
are null; 112 programmes have no intake records; 85 intake records remain
uncertain. EMA teaching-language and UMPRUM IELTS/TOEFL conflicts remain open.
APU's November Foundation start day is unknown. Huashang, Hubei Arts and Science
and China Jiliang language offers remain explicitly archival, not current offers.
