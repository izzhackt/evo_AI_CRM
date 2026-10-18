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


## 2026-10-16 iPhone «Путь поступления» (S4, version 1.1)

Version naming (owner decision 17.10.2026): the first App Store submission of the iPhone app is version 1.1 and contains every iPhone screen merged by PR #1215 (the 1.0.0 code line of #1172, universities v2, this admission path, CSCA); there is no separate 1.0 submission and no later «build 1.1»; «version 1.1» in the headings below is this first submission.

Home shows the admission path of the student's country from the same seven bundled files as the web (`src/content/timelines/*.json`) and the same selection rules (docs/portal/country-timeline-contract.md §3). Self-serve student: first section; client: right after the case section. Steps sit on a numbered vertical line; a step opens a sheet with its checklist («Что сделать»), «Когда шаг пройден» and links; the three disclaimers stand under the timeline and in every step sheet. «Сменить страну» opens the six countries and «Пока не решил» under the web's lead «Путь обновится сразу после выбора.»; a default choice names its source under the button («Страна из вашей анкеты.», «Страна из вашего дела.»). With no choice Home shows the «Выберите страну» card with the web's lead. Saving goes through `set_student_country_choice_v1` (284) with a new request id per tap and the same id on a retry after a failure, then rereads `student_country_choice_v1`; VoiceOver hears «Сохраняем выбор…», the error, or the new heading. At accessibility text sizes a step becomes a plain row with «Шаг N из M» instead of the line.

Error states (review #1208 round 1, m1): a failed or malformed first read shows the choose card with «Не удалось загрузить сохранённый выбор. Выберите страну или обновите экран.» and «Обновить», as the web shows the picker with `readError`; a failed background refresh (pull to refresh, return to the app) keeps the timeline already shown; a broken bundled general route shows a plain row without a useless retry.

Parity: both parsers read the same raw files, so the files must be canonical JSON (`JSON.stringify(JSON.parse(raw), null, 2) + "\n"`). `JSON.parse` keeps the last value of a repeated key and `JSONDecoder` the first; the iPhone therefore rejects a file with a repeated key or a byte order mark before decoding (that country falls back to the general route), and `tests/portal-country-timeline-ios-parity.test.mjs` fails the web side on any non-canonical file. The Swift regexes follow JavaScript semantics (`$` as `\z`, `\s` and `trim()` with U+FEFF and U+000B, ASCII `\b`). `scripts/portal/write-country-timeline-ios-parity.mjs` writes SHA-256 fingerprints of the web `selectCountryTimeline` output (7 choices, RU and KY, before `validUntil`, on `validUntil` and the day after, CN with a CSCA module route, a neutral one and the real web map, on RU and KY: 46 cases) plus the SHA-256 of every raw content file to `ios/EVOAdmissionsTests/Fixtures/country-timeline-parity.json`; `CountryTimelineTests` recomputes them from the Swift port and the bundled files, and the node test runs the script's `--check`, so a content edit without regenerating fails on both sides. Since 2026-10-18 both platforms pass the CSCA module (below), so the China exams step links to the CSCA section instead of csca.cn.

Real checks on 2026-10-16, round 1 (version 1.1 head after review): `CountryTimelineTests` (18), `CountryChoiceTests` (3) and `StudyCountriesTests` (2) 23/23 on an iOS 26.5 Simulator. Mutations: `today >= validUntil` fails 14 fixture cases on the boundary day; dropping the raw-JSON check fails the repeated-key tests; a repeated `status` in it.json fails the canonical and freshness node tests while the existing web content test stays green. Differential run of the PR's Swift parser (macOS build of the same files) against the web parser on 1148 generated variants of the seven files (BOM, repeated keys, line ends, U+FEFF, U+000B, U+0085, U+2028, NBSP, `.pdf` endings, promise and internal markers with odd spaces): before the fix 180 decisions differed, after it 0 except the 84 repeated-key variants, which the iPhone rejects by design and the web blocks by the canonical test. Live journey on the local evo-video-demo stack (synthetic student, credentials read at runtime, scratch XCUITest outside the repo) through a local fault-injection proxy: KY and RU source note and change lead; save with the response dropped after the server saved shows the error, the retry with the same request id closes the sheet on Italy (general route) with exactly one receipt row; pull to refresh and return to the app with the network down keep the Italy timeline; a failed first read shows the card, lead, notice and countries, and «Обновить» loads the saved Italy. 13 screenshots, journey logs and the proxy log are in the canonical checkout's ignored `output/student-app-v2/screens/timeline-ios-r2/`. No demo data was changed except the test choice rows, which were deleted afterwards (choices 0, requests 0, `audit_events` 975 before and after, 0 disabled triggers). Round 0 note: the earlier choose-card check disabled triggers on shared demo tables; that is not repeated, a dedicated synthetic student without a country is the way next time.

Impeccable: a single-context critique of the new states ran on these screenshots (no sub-agent tool in this session; the detector does not scan SwiftUI and returned no findings). It found the choose-card lead truncated to one line in the List row; fixed with `fixedSize` and rechecked live in RU and KY. Other notes: seven options exceed four decision points but are the product list; the section header «Путь поступления» above the card title «Выберите страну» repeats context. No owner questions were asked.

Limits: Simulator only, no hardware. VoiceOver not checked by ear: XCUITest shows the selected row as one button «Китай» with the selected trait in both A/B builds, so the hidden checkmark is a guard, not a measured fix; announcements and the external-link hint are not observable there. Colours stay on system `.secondary` and red until #1172 lands; `TimelinePalette` and `TimelineLinkTint` are the only places to switch to its `secondaryText`, `dangerText` and accent tokens. The «Выберите страну» card for `source = none` was not shown live (every demo student has a default country). KY text needs native proofreading. No production sign-in or deploy.

Integration with the #1172 code (earlier called build 1.0; under the owner decision it is not submitted separately) in the combined branch `izzhackt/ios-1-1-integration`: `TimelinePalette` and `TimelineLinkTint` now use the `Theme.swift` tokens (`secondaryText`, `dangerText`, `AccentColor` with its dark variant #FF8A8A), and the section header «Путь поступления: …», the step sheet headers, the change-sheet lead and the three disclaimers in every footer take `secondaryText` as well, like the other Home sections (review #1208 round 2, r2-m1). Measured on light-theme Simulator screenshots of the integrated build against the local evo-video-demo stack (synthetic hero student): the disclaimers under the timeline #636366 on #F2F2F7 5.37:1, the change-sheet lead 5.45:1, «Сменить страну» and the selected checkmark #D70217 on white 5.37:1. Dark theme was not measured.

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

## 2026-10-16: web «Путь поступления» on Home (S4)

Web block per `docs/portal/country-timeline-contract.md` §7: country timeline or general route named after the chosen country, steps expand read-only into checklist and «Когда шаг пройден», three disclaimers, «Сменить страну» with six countries and «Пока не решил» saved through `set_student_country_choice_v1` (284). The iPhone builds the same screen from the same seven JSON files and the same RPC in its own PR; until then parity is the shared content, selection rules and saved choice, not the iPhone screen.

Real check: next dev on port 3106 against the local evo-video-demo stack, own headless Chromium, two assisted demo students at 1440x900 and 390x844, 36/36 journey checks (default from the application, China, steps, reload, Italy as general route, «Пока не решил», KY, dark). Synthetic choices removed afterwards. Not exercised: a self-serve student (no demo credentials), the «Выберите страну» card on the live path (every demo student has a default; static axe render only), save failure and retry, iPhone, production.


## 2026-10-18: «Путь поступления» exams step opens the CSCA section (web and iPhone)

The China exams step (`cn-2-exams`) has one link, «CSCA: даты сессий и регистрация», with `appModule: "csca"` and `url: https://csca.cn`. Until now neither platform passed a module (the CSCA section did not exist when S4 shipped), so the link opened csca.cn. Contract `docs/portal/country-timeline-contract.md` §3 item 6 and §7.

- Web: `TIMELINE_MODULE_ROUTES = { csca: "/portal/csca" }`. The link is the existing internal branch of `CountryTimeline`: `IntentPrefetchLink` (next/link), same tab, no external icon, no «внешняя ссылка» text; its accessible name is the label. The old test `tests/portal-country-timeline-ui.test.mjs` «module routes match the app routes» was failing on `main` (the route file exists, the map was empty; no CI runs the Node manifest); it passes now, and a new test pins the render shape.
- iPhone: `CountryTimelineModules.routes = ["csca": "csca"]` (`Services/CountryTimeline.swift`) is passed to `select(modules:)`. In the step sheet the CSCA link is a row with a chevron and the VoiceOver hint «Откроется раздел в приложении.» (`home_timeline_module_hint`, KY needs native proofreading). Tapping it closes the sheet and, once the sheet has dismissed, appends `CSCARoute.home` to the Home stack path, the same `CSCARouteView(route: .home)` that the «CSCA» row of the English tab pushes; «Назад» returns to Home and the tab stays «Главная». External links keep `Link` with the arrow icon. An internal link to a screen the app cannot open (`CountryTimelineModules.canOpen`) is not shown. `HomeView` declares `navigationDestination(for: CSCARoute.self)` and uses `NavigationStack(path:)`. A first version used `navigationDestination(isPresented:)`; on the Simulator the CSCA screen opened but its inner rows (`NavigationLink(value:)`, e.g. the next-step lesson) did nothing, so it was replaced by the path push.
- csca.cn stays one tap away: it is the fallback `url` and the official link inside the CSCA section (web: source and «Регистрация на csca.cn» in the sessions block; iPhone: source link on the sessions screen).
- Parity: `scripts/portal/write-country-timeline-ios-parity.mjs` now also fingerprints China with the real web map (`TIMELINE_MODULE_ROUTES`) on RU and KY (46 cases, the 44 old ones unchanged), and `tests/portal-country-timeline-ios-parity.test.mjs` compares the module keys of the web map and `CountryTimelineModules.routes`, so a module added on one platform only fails the web side.
- Known property: the Home stack and the English stack can both show CSCA, and both use `CSCAHomeModel.shared` (every entry resets and rereads it). Checked on the Simulator: CSCA open in the English tab, then the Home link, a child screen from the Home stack, and the English stack still on CSCA. Not checked: an English-stack lesson open while the Home link is used (the lesson screens take titles from the shared model).

Real checks on 2026-10-18 on the local evo-video-demo stack (synthetic students, no production). Web: next dev on 3125, own headless Chromium, student «Алтынай Демо»: «Сменить страну» → China, exams step opened, one link in the step with `href="/portal/csca"`, no `target`, no icon, 252x44 px at 1440 and 44 px at 390, click lands on `/portal/csca` in the same tab (one page, no popup), the CSCA section holds three csca.cn links, back returns to Home with the step still open; 15 of 15 checks, no page errors. iPhone: own iPhone 17 Pro Simulator (iOS 26.5), the Debug app against the same stack, a scratch XCUITest outside the repo: RU and KY step sheet → link row (74 pt high) → CSCA screen with the tab still Home → «Назад»; both stacks check above. Unit tests on the own Simulator: `CountryTimelineTests` (22, two new), `CountryChoiceTests`, `LocalizationKeysTests`, `StudyCountriesTests`, 32 of 32; mutation: an empty `routes` map fails 8 assertions. The synthetic saved country choice created by the web check was deleted afterwards. Screenshots stay outside Git in the canonical checkout's `output/student-app-v2/screens/timeline-csca-route/`. Not verified: VoiceOver by ear, iOS 17, dark theme of the new row, Dynamic Type accessibility sizes, any production surface.

## 2026-10-16: CSCA S5.1, web screens (iPhone pending)

Web `/portal/csca/*` over RPC 285/286 (`docs/portal/csca-contract.md` §17): track home (subjects, next step, topic map, timed tests, mistakes, progress, official sessions with target choice), lesson with typed theory blocks (KaTeX HTML+MathML, SVG figures with dark palette swap), practice, timed test (server clock, batched saves, no early finish for the mock, review after finish), spaced review and progress. RU/KY strings in the `csca` portal dictionary (KY pending native proofreading).

Real evidence on the local `evo-video-demo` stack only (synthetic students, no production): headless Chromium at 1440×900 and 390×844, light and dark, RU and KY; diagnostic finished early with review; a real 450 s mock deadline auto-submitted by the client and returned `Время вышло`; lesson answers wrong and right (keyboard), report sent, practice, review answer moving an item to box 2, progress. Screenshots and receipts are kept outside Git in `output/student-app-v2/screens/csca-web/` of the canonical checkout.

iPhone parity is not built in this slice: SwiftMath spike, figures in `WKWebView`, the same six screens. Until then the iPhone has no CSCA entry (`learning_modules_v1` returns English only). Superseded by «CSCA S5.1, iPhone» below: the iPhone has the CSCA screens in version 1.1 and the exam overview since PR #1215.

Review round 1 (web and server, same PR): the timed-test clock runs on page monotonic time and never moves back on a save receipt, and a replayed save now returns its stored receipt with a fresh `serverNow`; finishing never completes without answers that failed to send while the server still takes saves (early finish returns to the items with a notice, at the deadline the web retries until deadline + 15 s); time on the current item is saved on finish, on hiding the page and on leaving by a portal link; «Продолжить тест» reads the known draft first and shows the result of an expired one, and a start on a form whose draft just expired returns that finished attempt (both clients); «Ошибки» finish expired tests first; completion dates are Bishkek dates; figures span the card on phones and never shrink labels below 12 px (they scroll inside their frame below that width). Contract `docs/portal/csca-contract.md` §7, §11, §15.

## 2026-10-16: CSCA S5.1, iPhone (version 1.1, PR #1210)

Superseding the line «iPhone parity is not built in this slice» above: the iPhone now has the same CSCA screens over the same RPC 285/286 and JSON (`docs/portal/csca-contract.md`): track home (next step, diagnostic and mock, mistakes, progress, syllabus sections with topic state, official sessions with target choice), lesson and practice with typed theory blocks, item card with per-option explanations, step-by-step solution and «Сообщить об ошибке», timed test with navigator and «Вернуться позже», result and review after finish, spaced review and progress. Entry: a «CSCA» row above the English list in the «Английский» tab, shown even when the English list fails or is empty (owner default: navigation unchanged).

How the iPhone renders differently from the web:

- Formulas: SwiftMath 1.7.3 images inside SwiftUI `Text` instead of KaTeX HTML+MathML; `'` is set as the U+2032 prime glyph. VoiceOver reads a spoken label built from TeX, with English runs marked `en` (SwiftUI passes it as `UIAccessibilitySpeechAttributeLanguage`), where the web exposes MathML.
- Figures: an own strict-profile SVG parser and SwiftUI `Canvas`, not `WKWebView` as first planned (no web process per figure, no async layout jumps); anything outside the §15 profile shows the alt text.
- Test clock: monotonic time anchored at each `serverNow`, the web uses the page clock with the same offset rule.

Behaviour aligned with the web after review round 1: a failed finish always leaves «Закрыть» and, for a refusal with time left, returns to the test with the error; 40001 adopts the server attempt with the conflict notice; a save retry after a transport failure resends the same request; a new choice after a failed lesson or review write drops the frozen request; the exit dialog says whether the last answers are saved.

Known divergences: the iPhone uses a 10 s retry cadence for a frozen test save (web 3 s); an unknown `nextStep` kind or test kind is skipped on the iPhone (contract §1), the web ships with the server and needs no rule.

Evidence on the local `evo-video-demo` stack only (synthetic student, no production), through a local fault-injection proxy: m7 English failure with CSCA reachable, frozen save resent with the same request id (server replay 200), exit dialog texts, failed finish with «Закрыть» then a real finish, a second-device save adopted with the notice, a new lesson choice sent after a failed check, the three pilot lessons on iPhone 17 Pro Max light and dark. Not verified: iOS 17 runtime (only iOS 26.5 is installed), manual VoiceOver listening, scroll hitch ratio (the simulator reports scroll duration only). Screenshots stay outside Git in the canonical checkout `output/student-app-v2/screens/csca-ios-r1/`.

Review round 2 (head `2f1551dd3`): a save now sends the frozen retry and, once it lands, the current state in a fresh request, as the web does, so finishing and leaving carry the answers given after a network failure. Two iPhone rules beyond the web: finishing waits while answers could not be sent over the network and the server still takes saves («Отправить ответы ещё раз»), where the web completes with the saved state; and the test clock never moves back on a save receipt, because a replayed save returns its first `serverNow` (the web still re-anchors on it, handed to #1207, where the server could return a fresh `serverNow` instead). Evidence on `evo-video-demo` through the fault-injection proxy, before and after the fix: the completed attempt held 1 of 3 answers before and 3 of 3 after; the countdown went 03:33 to 03:58 when the replay landed before and 03:33 to 03:27 after. Screenshots outside Git in `output/student-app-v2/screens/csca-ios-r2/` of the canonical checkout.

After #1207 review round 1 (merged into this branch): both divergences of round 2 are closed on the web side. A replayed save now returns its stored receipt with a fresh `serverNow`, and the web clock also keeps the later estimate on save receipts, so neither client winds the countdown back. The web no longer completes without answers that failed to send while the server still takes saves: an early finish returns to the items with a notice, and at the deadline the web retries by itself until deadline + 15 s, where the iPhone shows «Отправить ответы ещё раз». A start on a form whose draft just expired now returns that finished attempt, which the iPhone already shows as the result (`attempt.isCompleted`). The iPhone code needs no change for these server rules.

## 2026-10-17: CSCA exam overview, iPhone (version 1.1, PR #1215)

The iPhone CSCA home now opens with the same exam overview as the web `/portal/csca` (#1217, contract `docs/portal/csca-contract.md` §19): what CSCA is with the hero photo, «Кому нужен CSCA», «Предметы и формат», «Стоимость экзамена», the three questions and the «Сведения об экзамене подтверждены EVO …» line. Same content files as the web, bundled through `ios/project.yml` (`src/content/csca/overview.json`, `photos.json` and the WebP 240, 720 and 1280 files of the licence manifest, about 360 KB; the JPEG fallbacks are browser only and stay out of the app).

- Parser: `CSCAOverviewParser` (`ios/EVOAdmissions/Services/CSCA/CSCAOverview.swift`) ports `parseCscaOverview` and `parseCscaOverviewPhotos` rule for rule, in the same order and with the same error text, with JavaScript regex semantics shared with the timeline port; a file with a byte order mark or a repeated key is refused before `JSONDecoder`. `scripts/portal/write-csca-overview-ios-parity.mjs` writes `ios/EVOAdmissionsTests/Fixtures/csca-overview-parity.json`: SHA-256 of both raw files, fingerprints of the parsed overview, the manifest and the subject labels (`cscaGroupFacts`, `cscaSubjectFacts`) in RU and KY, the open or collapsed rule, and 81 file variants (61 overview, 20 manifest; 8 accepted) with the web decision. `CSCAOverviewTests` applies the same edits to the bundled files and must reach the same decision and text; `tests/portal-csca-overview-ios-parity.test.mjs` fails the web side on a stale fixture, a repeated key or a byte order mark.
- Returning and new students: the same rule `choice ?? !started` (`CSCAHome.hasStarted` mirrors `cscaHasStarted`); the choice is kept per device in UserDefaults under the web cookie's name `csca_overview` (`open`, `closed`). Collapsed: a 56 pt thumbnail (above the text at accessibility sizes, so the summary keeps the full width), the English name, the summary and «Об экзамене»; open: the name and «Об экзамене» on top, then the hero photo, the intro and «К занятиям», which scrolls to the module and moves VoiceOver focus there. The toggle is a neutral bordered button 44 pt high (system gray tint with the label in the primary text colour, an allowed tint of `FillContrastSourceTests`, like the country choice buttons) with the VoiceOver value «Развёрнуто» or «Свёрнуто»; the web toggle is neutral too. If the home fails to load, the overview still shows above the error, open unless the viewer chose otherwise.
- Subjects: one inset card per group with its shared facts once in a label-over-value grid (one column from `xxxLarge`), then the subjects with «В EVO» (the status symbol stays on the first line when the status wraps). VoiceOver reads every subject as one element with all four facts in the web table's column order and the status, for example «Mathematics, математика. Язык теста: Китайский или английский. Время: 60 мин. Вопросов с выбором ответа: 48. Шкала баллов: от 0 до 100. В EVO: Уроки и тесты»; the shared grid is hidden from VoiceOver because every subject carries those facts. English names are spoken with the English voice.
- Fees: one row per line of the table, stacked with the column labels at accessibility sizes; VoiceOver reads «Число предметов: 1. Взнос, CNY: 450». Questions are three `DisclosureGroup`s; the dates answer ends with «К сессиям CSCA», which opens the «Сессии CSCA» screen (the web scrolls to the block on the same page), and without sessions it shows the `withoutSessions` text instead.
- Photos: the narrowest WebP not narrower than the frame in pixels (720 for 2x, 1280 for 3x, 240 for the thumbnail), cropped at the manifest's `objectPosition` like `object-fit: cover`, decoded off the main thread; the frame keeps its size before the image arrives. The © button is the university photo credit (`AtlasPhotoCreditButton`): «Фото: <author>» linked to the Pexels page and «Лицензия: Pexels License», VoiceOver value «CSCA» or «Кому нужен CSCA».
- Sessions: the registration line now follows the web `sessionLabels`: «Регистрация откроется …», «Регистрация до … (время Бишкека) · закрывается через N дней» (N ≤ 60, bold, «закрывается сегодня» on the last day, Bishkek days), «Регистрация закрыта …»; an unpublished window keeps the existing iPhone text. The home sessions row shows it for the chosen session and, with no choice, for the soonest closing window. Not ported: the «Регистрация на csca.cn» link inside a session row (the row is the target button; the screen footer keeps the csca.cn source link).
- Strings: `csca_overview_toggle`, `csca_overview_skip`, `csca_overview_checked`, `csca_overview_state_open`, `csca_overview_state_closed`, `csca_registration_until`, `csca_registration_opens`, `csca_registration_closed`, `csca_closes_in` (RU one, few, many) and `csca_closes_today` in `CSCA.xcstrings`, RU and KY, KY `needs_review`; the unused `csca_registration_window` is gone. All overview text comes from the JSON (KY marked `needs_native_proofreading` there).

Real checks on 2026-10-17: the full unit suite on an own iOS 26.5 Simulator; the node tests `portal-csca-overview-ios-parity`, `portal-csca-overview` and `portal-country-timeline-ios-parity`. Mutations: dropping the percentile rule and accepting an empty score range in the Swift parser fail two parity variants; changing `contentVersion` in `overview.json` fails the fixture freshness test. Live journey on the local `evo-video-demo` stack (synthetic hero student, read only: no target was set and no database row was written) with a scratch XCUITest outside the repo on own Simulators: iPhone 17 Pro (402 pt) light, dark and accessibility XL, iPhone SE (375 pt) light and dark with Increase Contrast; collapsed by default for a student who has started, open after «Об экзамене», still open after relaunch, the dates answer opening the sessions screen with «закрывается через 4 дня», the home sessions row with the same window, the © credit. Native design audit with the impeccable skill (HIG, Dynamic Type, VoiceOver, 44 pt, dark, Increase Contrast) over the source and these screenshots: one finding fixed, the collapsed row at accessibility sizes kept the thumbnail beside the text and wrapped the summary into eight lines with the toggle below the fold; it now stacks, rechecked at accessibility XL. Screenshots and journey logs stay outside Git in the canonical checkout's `output/student-app-v2/screens/ios-csca-overview/`.

After the exact-head verification of `f76a8bb77`: the «Сведения об экзамене подтверждены EVO …» footer took the system section-footer colour, #85858B on #F2F2F7 at 3.29:1 in light mode, below the 4.5:1 that `CSCAColor` promises (the web line is #6b6660, 5.68:1). It now uses `CSCAColor.secondaryText`. Measured on own iPhone 17 Pro Simulator screenshots against `evo-video-demo` (synthetic hero student, read only): #5F5A54 on #F2F2F7 6.12:1 in light mode, on #EBEBF0 5.74:1 with Increase Contrast, #B3ADA4 on black 9.43:1 in dark mode; screenshots in the canonical checkout's `output/student-app-v2/screens/ios-csca-overview-footer/`. The older CSCA home footers (`csca_section_weight`, `csca_disclaimer`) still use the system colour; they predate this slice and are not changed here.

Not verified: the open default for a student who has not started (every demo student has CSCA activity; covered by the unit tests of the rule only) and the overview above a failed home load (not exercised live), KY screens, VoiceOver by ear (labels read from the accessibility tree), iOS 17 runtime, hardware, production.

## 2026-10-16 · S3 Университеты v2: веб (S3.3, PR #1202) и iPhone (S3.4, PR #1206)

План 4.6 и 7.3: один продукт, одни данные (`student_university_index_v1` и
`student_university_detail_v1`, миграция 283), одни правила показа. Запись
сделана по итогам review раунда 1 PR #1206 (head `0203b253d`) и сверена
заново после review раунда 2 (head `4f92d152f`) и раунда 3 (head
`5dccea54b`): правила ниже на iPhone повторены по коду веба `26d15935b`
(#1202 после его review раунда 2).

| Что | Веб | iPhone | Как проверено на iPhone |
|---|---|---|---|
| Первый экран | шесть стран с фото, «N университетов · M городов», поиск по названию | то же, `.searchable` | снимки `01`, `02` |
| Поиск | `normalizeUniversitySearch`: NFKD, без диакритики, `ı→i`, `ł→l`, `ø`/`œ→o`, `ß→ss`, апострофы как `'`, порядок индекса | то же правило в `UniversityAtlasPolicy.normalize`, порядок индекса | XCTest на названиях production, ожидаемые строки получены вызовом веб-функции |
| Порядок городов | больше вузов выше, затем название на языке интерфейса | то же (`cities(of:in:kyrgyz:)`) | XCTest: в KY «Бээжин» первым среди городов с одним вузом |
| Карточка города | фото, название, число вузов, полный текст, «Интересный факт» | то же, текст без обрезки | снимки `03b` в светлой, тёмной теме и AX L |
| «Другие вузы страны» | заголовок и пояснение «карточка города пока не готова» | то же | XCTest разбора; в демо таких вузов нет |
| Экран города | текст, «Интересный факт», ссылка на источник | то же, у ссылки ещё дата проверки | снимки `05` |
| Страница вуза: путь | «Страна › Город» ссылками в `nav` «Путь по каталогу» | ссылки на экраны страны и города из любого стека («Университеты», «Главная», «Профессии»), группа с подписью «Путь по каталогу» для VoiceOver; индекс грузится на старте сессии, без индекса экраны страны и города показывают загрузку или сбой с повтором, а не «не найдена» | UI-прогон холодного запуска: копия индекса удалена, вкладку «Университеты» не открывали, «Главная» → вуз из избранного → «Китай» → «Шанхай» → вуз (снимки `r3-01`…`r3-06`); XCTest выбора состояния экрана |
| Порядок блоков | описание, консультация, «Стоимость», программы | то же | UI-прогон сверяет положение кнопки и заголовка |
| «Стоимость» | нет строк: нет блока; виды в порядке продукта; подпись строки и уточнения через « · »; «≈ USD» если ориентир есть хотя бы у одной строки; годы новые первыми; «Источник: …, проверено 16 октября 2026 г.»; «Курс: 1 USD = 6,691 CNY (ЕЦБ, 15 октября 2026 г.)»; «Окончательную сумму указывает университет.» | то же содержание; строки идут столбиком, как в узкой раскладке веба | XCTest на ответах Tongji и Bilkent, снимки `06b`, `06c` |
| Ссылка на страницу стоимости | «сайт университета» ссылкой в строке источника | отдельная строка «Стоимость на сайте университета» (при нескольких страницах с адресом сайта) | снимок `06c` |
| Фото вуза | только перенесённая копия из бакета (`managedUniversityPhotoUrl`); нет копии: на карточке «Проверенное фото кампуса пока не добавлено», на странице вуза блока фото нет (N6), прямой ссылки нет | то же; в миниатюре строки поиска и «Других вузов страны» (64 pt) вместо текста значок; заглушка карточки растёт по тексту при AX5 | XCTest на настоящем манифесте: ни одного адреса вне бакета; по выгрузке production фото из бакета у 70 из 116 вузов, заглушка у 46; снимки `r4-05` (страница без фото), `r4-10`…`r4-12` (AX5) |
| Атрибуция фото | «©» на каждом фото, которое видит студент, в том числе на плитках поиска; у мест автор ссылкой на свою страницу (если есть), источник всегда ссылкой на страницу файла, лицензия ссылкой (F13); у фото вуза автор ссылкой на страницу файла; у официальных медиа «Фото: <вуз>, официальный сайт»; Escape и нажатие вне панели закрывают её, открыта одна (N3); у мест «©» сверху, у вузов снизу | то же; в строках поиска и «Других вузов страны» «©» 44 pt рядом с сердечком, миниатюру не закрывает; поповер закрывается касанием вне него, открыт один; VoiceOver читает у «©» название места или вуза (на вебе пока нет) | XCTest ссылок подписи; UI-прогон: «©» шапки страны справа сверху, «Источник: Pexels», «Фото: <автор>» и «Лицензия» ссылками; «©» карточки вуза у нижнего края фото, сердечко сверху; «©» в строке поиска Chang’an University; на локальной сборке два ключа демо помечены перенесёнными (снимки `r4-01`…`r4-07`, светлая и тёмная тема, AX5) |
| «Профессии» | вузы профессии из индекса (F6 веба) | пока прежнее чтение карточек, перенос в S1.3 (запись PLAN_CHANGES) | не менялось в этом PR |
| Текст и ссылки каталога | одно правило с базой (`catalog_text_ok`, `catalog_url_ok`, `src/lib/catalog-text.ts`): кодовые точки, запрещённый класс знаков, без пробелов по краям; общие векторы `tests/fixtures/catalog-text-vectors.json` | то же правило (`CatalogText`), те же векторы в bundle тестов, строки классов сверены с `catalog-text.ts` | XCTest `CatalogTextTests` |
| Неверная часть ответа | индекс отвергается только при неверной обёртке; город, вуз, поле страны, строка стоимости, курс деградируют по одному; строка журнала `portal_university_catalog_item_degraded` | то же, строка той же формы в системный журнал устройства | XCTest мутацией живых ответов демо, те же случаи, что веб-тест |

Общее для обеих платформ и пока открыто: запрос «xian» без апострофа не
находит «Xi’an» ни на вебе, ни на iPhone (по «xi'an» находит). Менять
правило нужно сразу на обеих платформах.

Не проверено: кыргызский интерфейс на снимках, VoiceOver на устройстве,
показ перенесённого фото вуза на демо-стеке (там 0 из 29 перенесённых, в
локальном бакете копий вузов нет), production-сборка iPhone. Снимки лежат в
игнорируемой папке канонического checkout `output/student-app-v2/screens/`
(`ios-r2/` раунд 1, `ios-r3/` раунд 2, `ios/r4-*` раунд 3), данные демо
синтетические.

## 2026-10-18: CSCA card on Home for students who chose China (Q16)

Owner decision 18.10.2026. One compact card on «Главная», on web and iPhone, only for a student whose chosen country is China. The choice is the one that drives «Путь поступления» (`student_country_choice_v1`, 284): a saved choice and the default from the application or the case count the same. No new RPC, no migration.

| Rule | Web | iPhone |
|---|---|---|
| Visible when | choice country is `CN` (`cscaHomeCardVisible`, `src/lib/portal/csca-home-card.ts`) | the same (`CSCAHomeCardPolicy.isVisible`, `ios/EVOAdmissions/Services/CSCA/CSCAHomeCard.swift`) |
| Hidden for | IT, MY, AE, TR, CZ, «Пока не решил», no choice, a failed choice read, a failed `learning_track_home_v1` read; never an error card (the CSCA section shows its own error) | the same; after a choice change the card appears or disappears at once, without a restart |
| Content | title «CSCA»; one line `summary` of `src/content/csca/overview.json` (RU or KY, no new claims); nearest official session; one action «К подготовке» | the same text from the same JSON (`CSCAHomeCardPolicy.summary`) |
| Nearest session | first by start date of the sessions whose last exam day is not before `today` of the server answer; none left: title, summary and action stay | the same (`nearestSession`) |
| «Регистрация закрывается через N дней» | only for an open window with N at most 60, from the same `sessionLabels` as the sessions block; a closed, not yet open or unpublished window and N above 60 show the session dates alone | the same, from `CSCASessionRegistration.closesSoon` |
| Action | `/portal/csca` | the CSCA screen, pushed in the Home stack by `NavigationLink(value: CSCARoute.home)`, which appends to the same `path` as the «Путь поступления» step link (#1249), so the card and the step link open the same screen and its child screens (Back returns to Home) |
| Reads | `readCscaHome()` hangs off the choice read inside the one `Promise.all` of the page: two chained RPCs like the favourites, so the wave is not deeper; a student with another country triggers no CSCA read | the same chain inside `refresh()` and again when the choice changes, one read at a time |
| Place | first card of «Продолжить» for both tiers (plan v2 §9.1); the order of «Путь поступления» is unchanged | first block of the «Обучение и тесты» group, directly before «Обучение» and «Тесты» (a test draft puts «Тесты» first, the card stays above both). The path is not always right above it: for a self-serve student and for a client whose case needs attention the order is path, card, learning and tests; for a client with a calm case the card follows the greeting and the admission section and the path come below learning and tests |
| Markup | `article.pt-home-card` with `h3` «CSCA», one link described by the heading, no live region | list section headed «CSCA», one combined row, one navigation link with the title as hint |

Differences, named: the iPhone writes the session dates in the words of its own sessions screen («14 ноября и 15 ноября 2026 г.»), the web writes «14 и 15 ноября 2026 г.». Known KY date-format difference (review finding F2, not fixed here): the web writes KY dates as «14-ноябрь жана 15-ноябрь, 2026» (`sessionDatesLabel`), the iPhone keeps the order of its existing sessions screen, «14-ноябрь жана 2026-ж., 15-ноябрь» (`csca_session_dates` with `CSCATime`); the card repeats whatever the client's sessions screen already shows, so the card and the screen agree on each client, and aligning the two clients is a separate change to the iPhone sessions screen. A failed background refresh on the iPhone keeps a card already shown, the web rereads on every visit; before the data arrives the iPhone shows nothing (no spinner, no empty section). KY («Жакынкы сессия», «Каттоо {срок}», «Даярдыкка») is a draft for native proofreading (`needs_review` in `CSCA.xcstrings`). The word «Подготовка» is not in the title (plan v2 §9.1), only in the action the owner gave.

Not changed here: the CSCA link inside the «Путь поступления» step (it landed separately in #1249: `TIMELINE_MODULE_ROUTES` holds `csca: "/portal/csca"` and the iPhone step sheet appends `CSCARoute.home` to the Home path; this card uses the same route and the same stack destination), and the KY date order of the iPhone sessions screen (F2 above).

Real checks on 2026-10-18, local `evo-video-demo` stack (synthetic students, no production), through a local fault-injection proxy that logs paths only: web `next dev` on port 3121 with an own headless Chromium, iPhone on an own iPhone 17 Pro Simulator (iOS 26.5) driven by a scratch XCUITest outside the repo.

- Web (52 checks, 1440, 390 and 320 px, light, dark, RU, KY): the hero (China from the case) shows the card as the first card of «Продолжить» with the summary line, «Ближайшая сессия: 14 и 15 ноября 2026 г.», «Регистрация закрывается через 3 дня» and one «К подготовке» (Enter opens `/portal/csca`); one real `Сменить страну` journey Italy, China, «Пока не решил», China (card gone, back without reload, persisted after reload); a student with Malaysia by default chooses China (card) and Italy (gone); a student with Czechia never sees it; with `learning_track_home_v1` answering 500 the card is gone, the China path and «Продолжить» still render, no alert; axe has no violations in the card (light and dark); no horizontal scroll; the link is 44 px high with a visible focus ring. The proxy log shows `learning_track_home_v1` only for the three students with China.
- iPhone (scratch XCUITest, light, dark, accessibility extra large, RU and KY): card present for the hero, text and one action, the action opens the CSCA screen with Back to Home; Italy, China, «Пока не решил» and China again through the real sheet with the card appearing and disappearing without a restart; with the CSCA RPC failing no card and no error text, the China path intact; the KY card shows the three KY lines.
- After merging `origin/main` 191511b0f (#1249 and the timelines of #1245), 2026-10-18, same local stack (hero, China from the case), web `next dev` on port 3127 and an own iPhone 17 Pro Simulator (iOS 26.5, deleted afterwards), a scratch XCUITest outside the repo: the card action «К подготовке» and the «Экзамены: CSCA и язык» step link (step sheet, then «CSCA: даты сессий и регистрация») both open the CSCA screen in the Home stack, the sessions row inside CSCA opens its child screen «Сессии CSCA», Back returns to CSCA and then to Home with the card still there; both entries one after the other in one run also work. Web: the card is the first card of «Продолжить», its link and the timeline step link both go to `/portal/csca` and both clicks open it. No rows were written (`student_country_choices` 0, `audit_events` 975 before and after).
- Unit: `tests/portal-csca-home-card.test.mjs` (10), `CSCAHomeCardTests` (6) with `CSCAStringsTests`, `CountryChoiceTests`, `FillContrastSourceTests`, `LocalizationKeysTests`, `CSCAPolicyTests`; four web and two iPhone mutations (any choice shows, finished sessions not skipped, card without data, CSCA read for everyone) fail the tests.

Not verified: a failed background refresh keeping a shown card on the iPhone (a code rule, not exercised), the self-serve tier on a device (no demo student without a case; its place is covered by the markup test, the tier uses the same grid), VoiceOver by ear, iOS 17 runtime, hardware, production, a student without any choice (`source = none`) on the live stack (covered by the rule tests only), Increase Contrast. Screenshots and journey results stay outside Git in the canonical checkout's `output/owner-decisions-2026-10-18/q16-csca-home-card/`.
