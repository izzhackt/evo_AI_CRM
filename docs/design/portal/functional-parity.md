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

### B-2 follow-up: isolated source acceptance, 2026-09-20

After PR #941, the coordinator authorized continuing source acceptance on a
disposable local Supabase with real Auth, PostgREST and PostgreSQL, using
ordinary sign-in and the actual Next.js/RPC path. Shared migrations and release
remain deferred. This environment change is necessary to test the new function
without treating a shared production schema change as harmless QA setup;
the related SQL208 changes existing production behavior before frontend rollout.

A owns local schema/bootstrap exclusively. B supplies the exact migration207
from PR #929 (`8e76b8b3e5a20f6236d616b870df88b55395c72e5eea69359ec90f65d5852707`)
and uses explicitly isolated QA identities and the minimum QA records created
through supported paths. No customer records, forged JWTs, response mocks,
disabled RLS, or invented RPC success are part of this acceptance.

Planned checks: normal Student login, real RPC result matching Home, populated
and empty states, first-publication/latest-content behavior, four-item limit,
other-role/unauthenticated denial and tenant isolation; RU/KY and desktop/mobile
for the affected section. A boundary that cannot be exercised through the real
local path must remain explicitly unverified. These checks are **pending**;
the historical evidence above is unchanged. Local acceptance will not be
reported as managed-environment or real-customer acceptance.

### B-2 real local acceptance, completed 2026-09-20

Source tested: `6b6153125a6cf722ea2712367ec24552ede90423`. SQL207 and its seven
runtime/test files are unchanged from the previously reviewed `17ee1cb8`.
The final browser environment was the composed local001–209 stack:207 from
this PR,208 from PR935, and the separately reviewed prospective Student scope
fix209 from PR942. The shared database is still untouched.

The real empty Student RPC succeeded on the initial local001–208 stack.
Ordinary public signup/approval exposed a pre-existing missing case-scope grant,
so Home could not open for that account. The original case was preserved as
failure evidence. After A applied209 through the local CLI, two NEW Students
used the product registration helper, ordinary Auth/submission/Admin approval
and fresh password sessions. The browser opened `/portal` and `/portal/home`.
This is not a replay of the historical managed QA or a manually repaired fixture.

Five existing reviewed China templates were actually staged and published by a
normally signed-in local Admin using the product catalogue RPCs. Student207
returned four, excluding the oldest. A subsequent supported overview revision
of the second institution preserved all four first-publication timestamps and
their order. An attempted identity rename was correctly rejected with22023;
name/country/city are immutable in148, so latest-content differentiation within
207's identity-only DTO is not independently claimed. No history timestamp was
edited and no clock was replaced.

Normal anonymous, Sales and Admissions calls to207 returned respectively
401/403/403 with42501 and no data. The actual Home IDs/order matched the actual
Student RPC. RU/KY were checked at1280×900 and390×844, with document width equal
to viewport width. KY was selected and saved through the real profile form.

The local-only `scripts/bind-local-student-intake.mjs` was independently reviewed
and applied solely by A before registration. It checks disposable project,
workdir/container ownership, loopback origins and local Docker/OrbStack, then
binds one previously empty intake configuration to an existing active local
organization/department. It creates no Student/case or authorization grant.
Its SHA256 is `edad4bffabe12cc189215cde6c80e92024dcbf36462bc47d85ffa124c4334b4b`.
Actual negative invocations rejected missing arguments, invalid UUIDs and a
non-disposable workdir before database execution.

Safe local artifacts under `/private/tmp/evo-database-foundation.WhSt8z`:

| Artifact | SHA256 |
|---|---|
| b-home-ui-evidence.json | `056cd49497861d65e7172efbea286224218edea9053bd8067c5e6a8cebdc973d` |
| b-209-home-desktop-ru.png | `9bb6baaadb68d060ec4a56c65126623aef6512f42cb28fa5fdec290dc1c52d01` |
| b-209-home-mobile-ru.png | `74932df3ea8da7897aeb8470270ed8753637d9b61124224ed7421e9b4672f6ff` |
| b-209-home-desktop-ky.png | `29e0c0dd1ee09ed9257989f56155081df93b608162930736bbc08b01989d45fb` |
| b-209-home-mobile-ky.png | `ae00aa50aab5e66dd88cea89d39c009e841e33adacb59ba8c2c464206a75a7fd` |

Limits: the true empty RPC was exercised, but the empty Home after209 was not;
the immutable published catalogue was not erased for a screenshot. A second
tenant, exact30-day/future timestamp boundaries, native iPhone and VoiceOver
were not executed. No managed schema write, production deployment, provider or
customer acceptance is claimed. Those limits remain visible at merge/release.

### B-4 follow-up found during real approval acceptance

Reproduction on the same source/composed schema: a freshly approved pending
Student opens `/portal`. The sidebar correctly omits assisted-only sections,
but the overview still offers “Все документы”, “Все начисления” and
“Открыть обращения”, describes a curator and renders “Обращения пока
недоступны”. Actual own-case help correctly returns42501 at the approved tier.
Align the overview's actions/copy with the existing approved/assisted contract
in a separate B-4 slice; keep those authorization boundaries intact. This is a
UX inconsistency, not evidence that209 should grant assisted permissions.
