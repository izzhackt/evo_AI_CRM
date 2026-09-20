# AST-5 — portal functional parity receipts

## 2026-09-20 — iPhone operational stage

First block: display `student_portal_overview_v2.operational_stage` under case status. Same 11 standard translations and unknown-stage wording as web, complete RU/KY strings. Blank values are omitted. Failed refresh clears stale overview/actions and exposes existing retry state. No database/auth changes.

Real evidence: Xcode Simulator build succeeded using existing real Supabase config; installed without deleting app or QA session. Opened Home → My Admission with existing authenticated EVO QA Student. Real overview rendered the custom-stage label, curator and calm action state. Light screenshot and dark + maximum Dynamic Type inspected. Stage wraps; scrolling required at largest size. Existing long navigation title truncation is outside this change.

- [Light](evidence/functional-parity-2026-09-20/admission-stage-light.png)
- [Dark / maximum text](evidence/functional-parity-2026-09-20/admission-stage-dark-large.png)

Command: `xcodebuild -project ios/EVOAdmissions.xcodeproj -scheme 'EVO admissions' -destination 'platform=iOS Simulator,id=C3A01C7C-4C22-4DE8-8BD8-7DEC5F786FF2' -derivedDataPath .next/ios-build CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build`. Build log `.next/parity-proof/stage-build.log` is local.

Limits: only actual stage of existing QA case exercised; other stages verified against source dictionaries, no fabricated cases. KY source strings checked, KY render not exercised. No hardware, VoiceOver, injected network failure, product-wide E2E or production deployment claimed. Simulator restored to light / large.


## iPhone Home parity

Existing Student RPCs provide independent lesson, test, favorite and application sections; assisted next actions reuse AdmissionHubModel/AdmissionActionRow. Tab selection opens existing native destinations. First lesson draft wins, otherwise first incomplete lesson; first draft test resumes its attempt; four most recent favorites maximum with current-web nearest-intake policy. Absent application is stated explicitly.

Real checks: successful Xcode builds (`home-build.log`, `home-final-build.log`). Existing QA identity authenticated against real Supabase: one module / 12 lessons, zero lesson drafts, two draft tests, three favorites. Installed final Simulator build retained QA session. Home → first lesson showed real theory; Home → continue test opened question 2 with 1/36 answered; exited without editing answers. Home favorite European University Cyprus opened the actual university detail, confirming October 2026. Nanchang showed dates pending; MLA College showed 28 September 2026. Admission shortcut selected native admission tab. Dark/max text inspected; accessibility scroll action works and text wraps.

- [Continuation and favorites](evidence/functional-parity-2026-09-20/home-continue-favorites.png)
- [Dark / largest text](evidence/functional-parity-2026-09-20/home-dark-large.png)

An empty-state localization-key mismatch found during source inspection was corrected and the app rebuilt/reinstalled. No fabricated data. Approved-tier application UI, actual lesson-draft resumption, all-complete/empty/error states, KY render and hardware were not exercised: current QA account is assisted, has content/favorites and no lesson draft. No result submission or production deployment.


## Web notifications / authority

Single Atlas header bell replaces the old v3 status strip; RU/KY label/count/error/retry, assisted-only navigation, `actor.accessTier` authority in layout. Existing polling retained, Home included among operational refresh destinations; test/lesson runners excluded.

Real browser check on local Next development server port 3105 connected to live Supabase, existing QA Student. Normal login form submitted credentials process-only. Actual zero unread notifications rendered correctly in RU and KY; bell opened Notifications. Desktop 1365×900 and mobile 390×844 inspected, no horizontal page overflow or JS errors. One real Home RSC refresh observed after the 30-second polling interval. Browser receipt `.next/parity-proof/notifications-receipt.json`; script `.next/parity-proof/web-smoke.mjs`. Playwright CLI could not load process-local credentials (no filesystem API); direct Playwright library drove the same actual login form, without fixtures or bypassing Auth. No tokens/passwords in artifacts.

Screenshots (development server, Next dev indicator visible): [desktop](evidence/functional-parity-2026-09-20/notifications-desktop.png), [mobile RU](evidence/functional-parity-2026-09-20/notifications-mobile.png), [mobile KY](evidence/functional-parity-2026-09-20/notifications-mobile-ky.png).

Typecheck, scoped ESLint and two existing source-contract checks passed. First contract invocation missed the required react-server condition; corrected invocation passed. Impeccable detector reported only four pre-existing side-border declarations outside changed styles. No synthetic notifications/network responses; positive badge not exercised, approved-tier navigation source-reviewed only. No production release or full E2E.

Independent review found that the original absolute error panel could leave the mobile viewport. It now anchors to the viewport below the header. Real local-server outage exercised the error at 390 px (x=54, width=320) and 320 px (x=16, width=288), both fully inside the viewport. Manual Retry issued a real server-action POST while the outage continued. Restart restored the genuine zero-unread state. Successful manual recovery is not claimed: Next development reconnection reloaded before the first retry-after-restart attempt. Only this task’s port-3105 server was stopped; Supabase/production stayed untouched.

Error evidence: [390 px](evidence/functional-parity-2026-09-20/notifications-error-390.png), [320 px](evidence/functional-parity-2026-09-20/notifications-error-320.png). Local receipt `.next/parity-proof/notification-outage.json`.


## Web recent universities — implementation ready, runtime acceptance pending

Migration 207 adds a no-argument Student/tenant-scoped read RPC. `min(reviewed_at)` over the immutable published history gives first publication; latest content supplies display fields. Filter the result to the last 30 days (exclude future dates), sort date descending/id ascending, limit four. No backfill/content writes. Home uses the strict compact DTO and existing Atlas list rows, RU/KY, explicit empty/error states. Future unpublish work must update visible-catalogue semantics; no such operation currently exists.

Real data validation: live ledger 001–206; 143 published universities, 87 with later revisions and different first/latest timestamps. Ran the exact new RPC selection SQL read-only, scoped to the existing QA membership's organization. It returned Schiller International University, Tongmyong University, GBS (Global Banking School) — Dubai Campus, and University of Vienna (Universität Wien). Existing authenticated Student `student_university_catalog_by_ids_v1` confirmed all four IDs/name/country/city; strict TypeScript decoder accepted the actual result unchanged. This proves selection/data, not execution of the new RPC authorization wrapper.

New RPC genuinely returns HTTP 404 / PGRST202 until migration 207 is applied. Normal QA login → Home rendered the actual unavailable state in RU/KY at 1365 and 390 px, no horizontal overflow or page errors; the catalogue link navigated correctly. Impeccable adapt/craft-floor used with incumbent screenshots before editing. New section retains visual hierarchy and wraps on mobile. Filled/empty recent-list UI and new-RPC grants/Student isolation still require real execution after applying 207; no mock or response injection was used.

Evidence (Next development indicator visible): [desktop RU error](evidence/functional-parity-2026-09-20/recent-error-ru-1365.png), [mobile RU error](evidence/functional-parity-2026-09-20/recent-error-ru-390.png), [mobile KY error](evidence/functional-parity-2026-09-20/recent-error-ky-390.png). Local scripts/receipts: `.next/parity-proof/recent-live.py`, `recent-live.json`, `recent-ui.mjs`, `recent-ui.json`.

TypeScript, scoped ESLint and existing Home/route-entry contracts passed. Impeccable detector found no issues in the changed HomeView. Migration DDL parsed successfully on local PostgreSQL inside BEGIN/ROLLBACK; nothing persisted. Local schema stops at 125, so this is syntax/ACL-statement evidence only, not runtime evidence. No migration applied to production, no web release, no broad E2E, content expansion or App Store work.
