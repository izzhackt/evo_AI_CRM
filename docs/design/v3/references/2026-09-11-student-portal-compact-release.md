# Compact Student Portal — release acceptance record

Contract: [compact portal run](../student-portal-compact-plan.md).
Owner authorized publication and mobile readiness on September 11. Times are UTC.

Status: compact implementation and the narrow smoke-test correction are merged.
The first full CI attempt failed and skipped release; the corrected exact-main
CI passed all five jobs. Guarded release accepted `6ac8007f`; independent
server/health and actual post-release Portal CUA passed. The compact desktop
and mobile interface is published on the accepted application.

## Reviewed and merged revision

- [PR #724](https://github.com/izzhackt/evo_AI_CRM/pull/724) merged at
  2026-09-11 07:43:44 as `f9133a0488add0f6afefa3e5cdc3163952db4cd6`.
- Reviewed head: `19dc24648416f15c060342b67bcbf2b815a7cbb8`. Both revisions
  have tree `a19dee5a69aadd74f54a7f1e61c33e443d60349b`.
- [Full CI 34575893217](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34575893217)
  targeted exact merged revision `f9133a04` and failed in the Admin preview
  browser test. Sixteen other browser tests passed; two were expected skips.
- [Release 34576407176](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34576407176)
  was skipped after failed CI. It did not publish the compact portal.

The final optimized candidate used real Supabase Auth, the genuine published
catalogue and existing Admin preview on localhost:3001. Local lint/type/build,
six selected real-file contracts and desktop/320/393 CSS px CUA passed; the
[run plan](../student-portal-compact-plan.md#integrated-candidate-validation--2026-09-11)
records precise measurements, menu/keyboard/history behavior and proof limits.

## CI locator correction

At `tests/e2e/supabase-staff-auth.spec.ts:744`, the selector
`nav a[href="/preview/student/documents"]` matches both the sidebar's Документы
link and the valid overview shortcut Все документы. Playwright correctly rejects
the ambiguous click. Scope the section-loop and Tests link to the actual named
navigation landmark Разделы кабинета. Preserve URL, question-navigation, no-write
and role-denial assertions unchanged; no `.first()`, skipped check or product
markup change is needed.

Current official Playwright guidance was checked on September 11:
https://playwright.dev/docs/locators#locate-by-role
It recommends role plus accessible name and scoped locators to resolve the
intended control. The existing overview navigation keeps its distinct name
Документы и обязательства. The corrected exact-main real-auth CI must pass
before release.

The narrow correction passed scoped ESLint and `npm run typecheck` on Node
22.23.1. Playwright discovery with the real suite configuration lists exactly
one matching Admin-preview test; discovery is not execution. A fresh interactive
selector check was unavailable after the Mac locked/detached its browser debugger.
The previously recorded actual UI checks remain valid because product code is
unchanged. The configured-auth CI rerun below supplied the runtime verification.
Local logs: `/tmp/evo-portal-preview-navigation-lint.log`,
`/tmp/evo-portal-preview-navigation-typecheck.log` and
`/tmp/evo-portal-preview-navigation-discovery.log`.

## Reviewed correction and second full-CI attempt

- [PR #733](https://github.com/izzhackt/evo_AI_CRM/pull/733) merged at
  2026-09-11 07:58:00 as `6ac8007fe5f0a323ec1f23e7af23b9443810574e`.
  Its tree is identical to reviewed correction head
  `697999aa5431dd05c0efa18f48832a003ac99461`.
- [Correction PR checks 34576714164](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34576714164)
  passed on that exact reviewed head.
- [Full main CI 34576885307](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34576885307)
  passed all five jobs on exact merged `6ac8007f`, including the database
  and browser gate (8m 6s). The configured-auth suite passed 17 tests with two
  expected skips. The corrected “Admin previews Student screens and authored
  questions without saving an attempt” test passed in 14.6s at 08:02:27.
  Coordinator read the actual job log, retained locally at
  `/tmp/evo-portal-ci34576885307-browser.log`. This proves the configured
  CI browser path, not private production Student journeys.

This correction changes only the two E2E navigation selections and their
documentation. Product runtime and the prior measured mobile/desktop evidence
are unchanged; none of the existing test assertions was removed or weakened.

## Guarded production acceptance

[Guarded release 34577575858, attempt 1](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34577575858)
succeeded in both jobs after corrected full CI, completing at 08:11:21. The coordinator verified the
named **Authenticated read-only V3 browser smoke** and **Accept exact V3
candidate** steps succeeded, then set the release arm to `false` and read it back.

Independent preflight and coordinator server readback confirmed:

| Evidence | Value |
| --- | --- |
| Accepted release | `v3-r34577575858-a1-6ac8007f` |
| Revision | `6ac8007fe5f0a323ec1f23e7af23b9443810574e` |
| Image tag | `evo-crm:6ac8007fe5f0a323ec1f23e7af23b9443810574e` |
| Image ID | `sha256:1bac0d399296519ef7b95aed05afd3be192a800fbda64eb17b512028d8e5aa07` |
| Acceptance-record SHA-256 | `7aa8e3952d35067bf9b705e1e54fb73996c7ca74e0bc6f6cf16c62ecabeb53e8` |
| Pending candidate | Absent |
| App | Healthy, zero restarts |
| Release arm | `false`, set and read back after success |

The active app container is
`816fbb73d2836f4dfe3acaaa49093ba4326398211f9281fcfc168b473ca0961e`,
private IP `172.16.8.4`. Public HTTPS health returned
`ok:true,status:live,service:evo-crm`. WAHA and ClamAV retained their baseline
container IDs, healthy with zero restarts. No provider activation was needed.

Literal generated rollback command, not executed:

```sh
sudo -- /opt/evo-crm/release-evidence/v3-r34577575858-a1-6ac8007f/rollback-command.sh
```

For the earlier failed gate, the coordinator set `EVO_PRODUCTION_RELEASE_ARMED=false`
and read back `false` successfully at approximately 07:52. Independent release
preflight confirmed the previous accepted revision remained `4dc5ead9` and no
pending candidate existed. The skipped release introduced no production change.

The later successful release above replaces that earlier accepted application.
The protected release and independent live readback, not the earlier local
screenshots, establish the current deployment.

## Live interface readback

The coordinator recovered CUA through a fresh tab in the same Chrome profile
and existing authenticated Admin session at
`http://localhost:3000/preview/student`. The earlier tab's detached debugger was
stale tooling; a new live tab rendered the application. No login bypass or new
identity was used. This is the actual accepted Hermes application through the
existing localhost tunnel, separate from the earlier candidate on port 3001.

Actual post-release checks passed:

- Desktop: `innerWidth == clientWidth == scrollWidth == 2016`. The native CUA
  screenshot shows the new sidebar, burgundy action panel and EVO/curator column.
- Mobile 393 CSS px: client and scroll widths were both 383 with the classic
  scrollbar. The home screenshot shows the compact mobile layout. All seven
  navigation links were 44 px high; Escape closed the menu and restored focus
  to Меню with `aria-expanded=false`.
- At actual 320 CSS px, all seven routes (home, documents, applications,
  universities, payments, notifications and tests) passed URL, heading and
  menu-dismissal checks. Client and scroll widths matched: 310 with the classic
  scrollbar or 320 without it. No horizontal overflow was present.
- The actual authored English first-question preview rendered at 320 CSS px
  with client and scroll widths both 310. No answer was selected and no
  business write was performed in this production inspection.
- localhost:3000 health returned live; anonymous Admin-preview access returned
  307 to login. The authenticated live tab was returned to home and restored
  to desktop size for the owner.

The fresh live Chrome console contained two React130 errors from an extension
toolbar at 08:13:25, with no EVO stack; it was not an entirely empty console.
Native post-release desktop/mobile CUA screenshots are recorded in the
coordinating task's tool evidence. Earlier candidate checks additionally covered
outside/Tab/history dismissal, the real UMPRUM detail and transient English/career
question selection/navigation; those remain separately labelled candidate
results, not additional production actions. The isolated owned port 3001
validation server was stopped after successful live inspection; the production
port 3000 SSH tunnel remains in place.

## Scope and remaining proof limits

The release changes compact Student/Admin-preview presentation and mobile
interaction. It retains the reviewed catalogue improvements and existing auth,
role and private-assessment boundaries. No migration, catalogue republication,
new Student identity, provider activation or business write is needed.

Admin preview loads no private Student case. It cannot prove populated Student
actions, uploads, payments, private test attempts/results or persisted
assessments. Authored question-preview choices are transient and ungraded.
