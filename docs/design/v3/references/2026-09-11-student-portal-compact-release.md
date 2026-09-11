# Compact Student Portal — release acceptance record

Contract: [compact portal run](../student-portal-compact-plan.md).
Owner authorized publication and mobile readiness on September 11. Times are UTC.

Status: implementation merged; full CI failed on an ambiguous E2E locator and
the guarded release was skipped. Production acceptance remains pending; the last
recorded accepted application is unchanged.

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
Документы и обязательства. Full real-auth CI must pass again before release.

The narrow correction passed scoped ESLint and `npm run typecheck` on Node
22.23.1. Playwright discovery with the real suite configuration lists exactly
one matching Admin-preview test; discovery is not execution. A fresh interactive
selector check was unavailable after the Mac locked/detached its browser debugger.
The previously recorded actual UI checks remain valid because product code is
unchanged. Exact configured-auth CI rerun remains the runtime verification gate.
Local logs: `/tmp/evo-portal-preview-navigation-lint.log`,
`/tmp/evo-portal-preview-navigation-typecheck.log` and
`/tmp/evo-portal-preview-navigation-discovery.log`.

## Guarded production acceptance

After the failed gate, the coordinator set `EVO_PRODUCTION_RELEASE_ARMED=false`
and read back `false` successfully at approximately 07:52. Independent release
preflight confirmed the previous accepted revision remains `4dc5ead9` and no
pending candidate exists. The skipped release introduced no production change.

New compact-portal acceptance still requires successful exact-main CI and a
guarded release, protected accepted pointer/revision/image, acceptance-file hash,
healthy application, no pending candidate and final release-arm readback. Do not
infer publication from the merged code or local screenshots.

## Live interface readback

Pending actual post-release browser and health checks through the existing
localhost:3000 tunnel and public CRM surface. This remains the same Hermes
application and managed Supabase project; localhost:3001 is only the isolated
pre-release validation server.

## Scope and remaining proof limits

The release changes compact Student/Admin-preview presentation and mobile
interaction. It retains the reviewed catalogue improvements and existing auth,
role and private-assessment boundaries. No migration, catalogue republication,
new Student identity, provider activation or business write is needed.

Admin preview loads no private Student case. It cannot prove populated Student
actions, uploads, payments, private test attempts/results or persisted
assessments. Authored question-preview choices are transient and ungraded.
