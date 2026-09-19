# EVO admissions — iOS

Native SwiftUI client for the EVO Portal, per
[`docs/adr/0030-portal-iphone-swiftui-supabase-transport.md`](../docs/adr/0030-portal-iphone-swiftui-supabase-transport.md)
and [`docs/design/portal/port-0-contracts.md`](../docs/design/portal/port-0-contracts.md).
It calls the same `platform.*` Supabase RPCs as the web portal directly over
PostgREST — no second backend, no bearer gateway.

## Setup

1. `which xcodegen || brew install xcodegen`
2. Copy `Local.xcconfig.example` to `Local.xcconfig` in this directory and fill
   in the real Supabase project URL and publishable key. `Local.xcconfig` is
   git-ignored — never commit it.
3. `xcodegen generate` (regenerates `EVOAdmissions.xcodeproj` from
   `project.yml`; re-run it after editing `project.yml` or adding/removing
   source files).
4. Open `EVOAdmissions.xcodeproj` or build from the CLI:
   ```
   xcodebuild -project ios/EVOAdmissions.xcodeproj -scheme "EVO admissions" \
     -destination "platform=iOS Simulator,name=<device>" build
   ```

The generated `.xcodeproj` and `Generated/Info.plist` are committed so a
fresh clone builds without regenerating; `xcodegen generate` remains the
source of truth for structural changes.

## Architecture (PORT-2 foundation)

- **`App/`** — `EVOAdmissionsApp` entry point, `AppConfig` (reads
  `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` from `Info.plist`, fails loudly
  with `fatalError` if either is missing/empty).
- **`Services/SupabaseService`** — the shared `SupabaseClient`, schema
  `platform`, wrapping `current_actor_authority()`, `student_portal_cases()`,
  `student_university_catalog()` (list pages + single card by
  `p_institution_id`) and the private-assessment RPCs of migration 135
  (`student_assessments_v1`, `student_assessment_attempt_v1`,
  `start/save/complete_student_assessment_…_v1` with client `request_id`
  idempotency).
- **`Services/SessionRouter`** — drives navigation from Supabase auth state
  (`authStateChanges`) plus the authority/case RPCs: signedOut →
  authenticating → resolvingAccess → `active(PortalSession)` /
  `accessPending` / `networkError`.
- **`Services/PortalModels` / `AssessmentModels`** — Codable mirrors of the
  SQL return shapes (migrations 148/150/151 and 135). Timestamps from JSONB
  stay raw strings, parsed for display by `Services/PostgresTimestamp`.
- **`Services/UniversityPhotoLibrary`** — decodes the bundled
  `src/lib/university-photo-library.json` (the SAME file the web renders,
  wired in `project.yml`, not a copy): photoKey → url + CC attribution.
- **`Views/`** — `SignInView`, `AccessPendingView`, `NetworkErrorView`,
  `TabShell` (tabs by access tier), `HomeView`, `UniversitiesView` (paged
  list) + `UniversityDetailView` (card with photo attribution, facts,
  programs and intake statuses), `TestsView` + `AssessmentRunnerView`
  (one question per screen, debounced autosave, retry with the same
  `request_id`, revision-conflict reload, save-and-exit protection) +
  `AssessmentResultView` (bands/topics/feedback, ORVIS scales — no CEFR),
  `ProfileView` (name, email, honest access line, app version, sign out),
  `PlaceholderView` for «Моё поступление».
- **`Resources/Localizable.xcstrings`** — String Catalog, `ru` base, complete
  `ky` for every string. `developmentLanguage: ru` in `project.yml` so the
  simulator (device locale `en`) still falls back to `ru`, not raw keys.
- **`EVOAdmissionsTests/`** — hostless XCTest bundle: decoder tests against
  fixtures hand-written from the SQL contracts (migrations 135/148/150/151;
  each fixture cites its source lines), the shared intake-status logic and
  the real photo library. `xcodebuild … test` runs them without launching
  the app or touching the network.

Privacy rule carried from the plan: assessment answers/results are never
printed, logged or embedded in error messages anywhere in this target.

### Session persistence (verified, not assumed)

Read from `supabase-swift` 2.55.2 source directly:
`SupabaseClientOptions.AuthOptions.storage` defaults to
`AuthClient.Configuration.defaultLocalStorage`
(`Sources/Auth/Storage/AuthLocalStorage.swift`), which resolves to
`KeychainLocalStorage()` on Apple platforms — that file's own doc comment
calls it "the default local storage used by the library". `SupabaseService`
passes no custom `auth.storage`, so a signed-in session is written to the
Keychain (service `supabase.gotrue.swift`) and survives relaunches with no
code of ours involved.

## Bundle identifier

`com.evoadmissions.app` is **provisional**, set for this foundation slice so
the project builds and installs to a simulator. The final identifier (and
Apple Developer team / App Store Connect record) is an owner decision at the
App Store step (plan §13), not made here.

## Deferred to later slices

- **Golos font bundling** — the app uses SF (system) fonts for now; brand
  typography is a later slice.
- **App icon artwork** — `Assets.xcassets/AppIcon.appiconset` has an empty
  1024×1024 slot so the asset catalog compiles; real icon art is a later
  slice.
- **Anketa / case-less flow on phone** — a student authority with zero or
  more-than-one case routes to `AccessPendingView` in v1; the case-less
  application flow is explicitly out of scope for PORT-2 (plan/ADR 0030).

## What was verified for wave 5 (избранное/профиль/консультация/обучение-read)

- Contracts: migrations 195 (favourites), 196 (portal profile language +
  account deletion request), 197 (consultation requests), 198/199 (learning
  READ + professions). Codable mirrors live in
  `Services/{Favorites,PortalProfile,Consultation,Learning,Profession}Models.swift`,
  each field commented with its SQL source lines.
- `xcodebuild … build` and `xcodebuild … test` for `iPhone 17 Pro` — both
  exit code 0; `Executed 38 tests, with 0 failures` (20 new decoder tests
  against fixtures hand-written from the 195–199 return shapes).
- Tab bar now follows the design contract: approved = Главная ·
  Университеты · Профессии · Английский · Профиль; assisted = Главная ·
  Моё поступление · Университеты · Английский · Профиль. «Тесты» became
  entries inside «Английский»/«Профессии» and «Профиль» (`TestsContentView`).
- App installed and launched on the simulator; `SignInView` renders
  (`docs/wave5-signin.png`).
- **Not exercised live in this session** (no sign-in was performed here;
  no mock API was added): live favourites toggling/receipts, the favorites
  section and comparison against live data, profile RPC (language save,
  deletion request), consultation create/history, learning module map,
  lesson content and profession cards against the production RPCs, and both
  access tiers' tab sets with a live session. All of these are implemented
  against the documented SQL contracts and covered at the decoder level by
  fixtures. A QA portal account exists for the owner's own verification
  (see `.env.student-portal-qa.json` in the main worktree root — untracked).

## What was verified for the catalog/tests/profile slice (real simulator, no mocks)

- `xcodebuild … build` and `xcodebuild … test` for `iPhone 17 Pro`
  (iOS 26.5 simulator) — succeeded; 18 unit tests, 0 failures.
- App installed and launched on the simulator; `SignInView` renders the real
  `ru` catalog (`docs/tests-catalog-signin.png`) and, relaunched with
  `-AppleLanguages (ky)`, the real `ky` catalog
  (`docs/tests-catalog-signin-ky.png`).
- Codable decoders exercised against fixtures hand-written from the SQL
  return shapes of migrations 135 and 148/150/151 (sources cited inside each
  test file), plus the real bundled photo library (144 entries, url +
  attribution present for every key).
- **Not exercised without an account** (no test credentials exist for this
  project; none were invented, no mock API was added): live
  `student_university_catalog` list/card responses, live
  `student_assessments_v1` catalogue, a real runner session
  (start/autosave/complete/interrupt-resume), the result screen against a
  live graded attempt, ProfileView with a live session email, and TabShell
  routing for approved/assisted tiers. These are implemented against the
  documented RPC contracts and covered at the decoder level only.

## Foundation-slice verification (kept for history)

- `xcodebuild … build` for `iPhone 17 Pro` (iOS 26.5 simulator) — succeeded.
- App installed and launched on the simulator; `SignInView` renders with the
  real `ru` String Catalog strings (screenshot:
  `docs/foundation-screenshot.png`).
- A bogus email/password submitted from the running app made a real network
  call to the configured Supabase project and surfaced the SDK's real error,
  `"Invalid login credentials"`, inline under the fields — not a fabricated
  or mocked message (screenshot: `docs/foundation-signin-error.png`).
- **Not verified**: signing in with a real account. No test credentials
  exist for this project; none were invented. `AccessPendingView`,
  `NetworkErrorView` and `TabShell` are implemented against the documented
  RPC contracts (`docs/design/portal/port-0-contracts.md`) but have not been
  exercised against a live authorized session.
