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
  `platform`, wrapping `current_actor_authority()`, `student_portal_cases()`
  and `student_university_catalog()`.
- **`Services/SessionRouter`** — drives navigation from Supabase auth state
  (`authStateChanges`) plus the authority/case RPCs: signedOut →
  authenticating → resolvingAccess → `active(PortalSession)` /
  `accessPending` / `networkError`.
- **`Views/`** — `SignInView`, `AccessPendingView`, `NetworkErrorView`,
  `TabShell` (tabs by access tier), `HomeView`, `UniversitiesView`,
  `PlaceholderView` for the not-yet-built tabs.
- **`Resources/Localizable.xcstrings`** — String Catalog, `ru` base, complete
  `ky` for every string. `developmentLanguage: ru` in `project.yml` so the
  simulator (device locale `en`) still falls back to `ru`, not raw keys.

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

## What was verified for this PR (real device/simulator, no mocks)

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
