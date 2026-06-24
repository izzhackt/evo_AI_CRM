# QA Launch Report

Generated: 2026-06-24, workspace timezone.

## Scope

Goal: `/goal-qa-launch`.

Method:

- Production build served with `next start`.
- Fresh Playwright browser contexts for every pass; no saved login, cookies, or site data.
- Desktop viewport: 1440x900.
- Mobile viewport: 390x844.
- Isolated local SQLite databases under `/tmp/evo-qa-launch/`.
- No live WhatsApp, telephony, amoCRM, or Anthropic credentials supplied.

## Browser QA

Pass 1:

- Result: 15/18 checks passed.
- Screenshots: `/tmp/evo-qa-launch/screenshots/pass1/`.
- Weakest safe issue: WhatsApp disconnected state used demo-mode wording instead of an explicit `not_configured` blocker.
- Other misses were QA-script handling: locale verification needed a reload after the cookie-backed Server Action, and an intentional AI `not_configured` API request produced an expected browser 400 console entry.

Pass 2:

- Result: 18/18 checks passed.
- Screenshots:
  - `/tmp/evo-qa-launch/screenshots/pass2/01-desktop-login-fresh.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/02-desktop-admin-dashboard.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/03-desktop-sales.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/04-desktop-student-360.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/05-desktop-reports.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/06-desktop-settings.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/07-desktop-whatsapp.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/08-desktop-prepared-ai-drawer.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/09-desktop-client-portal.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/10-mobile-sales-dashboard.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/11-mobile-sales-pipeline.png`
  - `/tmp/evo-qa-launch/screenshots/pass2/12-mobile-client-portal.png`

Checklist scores after pass 2:

| Area | Score | Evidence |
| --- | ---: | --- |
| Auth and role routing | 10/10 | Unauthenticated `/dashboard` redirected to `/login`; admin and client logins routed correctly; client was redirected from staff route to `/portal`. |
| Staff CRM flow | 10/10 | Dashboard, sales, Student 360, reports, settings, and WhatsApp pages rendered at desktop size. |
| Student portal flow | 10/10 | Client portal rendered at desktop and mobile sizes with scoped student dashboard content. |
| Integration truthfulness | 9/10 | WhatsApp, telephony, and amoCRM missing credentials surfaced as `not_configured`/blocked states; no live provider success was claimed. |
| AI/prepared boundary | 10/10 | Anthropic summary returned `not_configured`; prepared WhatsApp drawer was labeled as deterministic first-presentation content. |
| i18n/language switching | 9/10 | English locale rendered after LangSwitcher submit and reload. |
| Responsive layout | 9/10 | Staff dashboard, sales pipeline, and portal had no horizontal overflow at 390x844. |
| Security/secret handling | 9/10 | Role routing held; amoCRM missing fields were named without secret leakage. |
| Validation/build readiness | 10/10 | Static gates, production build, scenarios, audit, and production browser smoke pass after the PostCSS override. |
| Presentation demo clarity | 9/10 | WhatsApp copy now uses `not_configured`; prepared AI remains labeled and separate from live Anthropic success. |

## Changes Made

- Updated WhatsApp disconnected copy in Russian, Kyrgyz, and English from demo-mode wording to explicit `WhatsApp not_configured`.
- Updated WhatsApp conversation message status rendering so historical non-live outbound rows display `not_configured` instead of `(демо)`.
- Added this QA report and refreshed scenario evidence from the required scenario runner.
- Updated telephony webhook behavior so missing `tel_api_key` returns explicit `not_configured` and does not insert calls; refreshed the telephony scenario to prove missing-key rejection, invalid-key rejection, and valid keyed insertion.

## Validation

Passed:

- `node node_modules/eslint/bin/eslint.js .`
- `node node_modules/next/dist/bin/next typegen`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/next/dist/bin/next build`
- `npm run scenarios` - 36/36 scenarios passed.
- Fresh-browser QA pass 2 - 18/18 checks passed.

Original QA advisory, now resolved:

- The QA pass initially found `npm audit --audit-level=moderate` exiting 1 on PostCSS advisory `GHSA-qx2v-qp2m-jg93` through `next@16.2.9`; npm suggested `npm audit fix --force`, which would install `next@9.3.3` and is a breaking downgrade.
- The production-hardening pass added an npm override for `postcss@8.5.15`. Current `npm audit --audit-level=moderate` returns 0 vulnerabilities, and `npm ls next postcss eslint-config-next --depth=3` shows `next@16.2.9` using deduped `postcss@8.5.15`.

## Production Hardening Addendum

Additional validation after the PostCSS override:

- `npm audit --audit-level=moderate` - passed, 0 vulnerabilities.
- `node node_modules/eslint/bin/eslint.js .` - passed.
- `node node_modules/next/dist/bin/next typegen` - passed.
- `node node_modules/typescript/bin/tsc --noEmit` - passed.
- `node node_modules/next/dist/bin/next build` - passed.
- `npm run scenarios` - passed, 36/36 scenarios.
- Production browser smoke on `next start` - passed, 7/7 checks.
- Smoke screenshots:
  - `/tmp/evo-production-hardening-smoke/01-admin-dashboard.png`
  - `/tmp/evo-production-hardening-smoke/02-admin-settings.png`
  - `/tmp/evo-production-hardening-smoke/03-mobile-client-portal.png`

## Named Blockers

- WhatsApp Cloud API credentials are not configured; WhatsApp send success is blocked until real Meta credentials are supplied and validated.
- Telephony provider credentials/configuration are not configured for live provider verification.
- amoCRM credentials are not configured in the QA environment; status remains `not_configured` with required fields named.
- Anthropic API key is not configured; live AI endpoints return `not_configured`.

## Stop Reason

Stopped on success after one scoped copy/status clarity fix, a full green browser QA rerun, and a production-hardening pass that resolved the audit advisory.
