# iPhone Home — action hierarchy, 2026-09-20

## Contract before implementation

Continuation of AST-5 Home, following the owner's request to continue and use
Impeccable advice. Preserve the native EVO visual language, routes, identities,
real progress, and existing read/write boundaries. Baseline native source is
`d1404aef` (Home implementation from #927).

The observed existing QA Student has no required admission action, an unstarted
lesson, and a saved test attempt (1/36). The current first viewport gives the
quiet admission summary priority over the unfinished test. Independent Impeccable
design assessment also identified wordy large-text copy and an ambiguous
module-progress denominator. This is a narrow refinement, not a new design.

Implementation:

1. Keep admission loading, failure, or a real next action before learning.
   Once admission is successfully loaded with no action, show its complete
   summary after learning/test continuation. Do not hide it or invent urgency.
2. A real saved test attempt precedes the lesson section; without a test draft,
   retain lesson-first order. No fabricated attempt or new recommendation rule.
3. Shorten the learning section heading and explicitly label the existing
   module-level lesson count in RU/KY; retain full lesson titles and real counts.
4. Ensure the visible continue-test button's label itself has a minimum 44-point
   height, retaining the native button style and existing destination.
5. Match the Kyrgyz admission shortcut's quoted name to the existing tab and
   screen title. This changes navigation copy, not the destination or authority.

Scope: HomeView and its localizations. Shared tab labels, services, auth, schema,
catalogue content, and product-wide E2E/App Store work are outside this slice.

## Validation

Build the native app, preserve the existing QA session, and inspect the actual
Home → existing saved test → return and Home → lesson → return paths. Inspect RU
and KY with real content, plus Dark Mode / maximum Dynamic Type. Use at most one
batched correction pass. Record unexercised action/error/empty states explicitly;
no synthetic responses or production case edits to manufacture them.

Official guidance consulted: [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
and the installed Impeccable `ios`, `clarify`, and `craft-floor` references.
Context7 returned its monthly-quota error; current Apple documentation was read
directly from Apple's documentation JSON endpoint. Native system navigation and
translucent bars remain intact.

## Bounded correction after first real inspection

Dark/default-size rendering confirms the low-contrast Home link candidate.
Use native systemRed for Home text links in dark mode only, preserving the
filled brand-red CTA and all other screens. At maximum Dynamic Type, expand
the CTA label to the row width so it can wrap with more room.

## Receipt

Two successful native Xcode builds, with the original Supabase configuration
and existing QA Keychain session. No app uninstall or auth changes. Final build
log: ignored `.next/home-proof/build-final.log`.

Real iPhone 17 Pro / iOS 26.5 Simulator paths:

- Home shows the existing saved English attempt above the new lesson and calm
  admission state; no fake state used. Continue opens question 2, 1/36 answered.
  Save/exit returns to Home with the same 1/36; no answer was edited/submitted.
  Repeated on the final build after the bounded color/button correction.
- Home lesson opens the existing first lesson and its real theory; native Back
  returns. No exercise attempt/result was created.
- KY is a process-only AppleLanguages override, not a profile/server mutation.
  Home content translates, and the corrected quoted admission name matches the
  actual destination reached by its button. Native admission stage still loads.
- Final light RU, light KY, dark regular text, and dark maximum Dynamic Type
  inspected. Large text wraps and remains scrollable; long titles/button words
  can still wrap inside words at the maximum size. No claim of full accessibility
  acceptance. No text-size cap was added.
- Restored light / default large text / original RU launch without locale flags.
  Current native screen is Home, existing QA session preserved.

[RU](evidence/home-refinement-2026-09-20/final-light-ru.png) ·
[KY](evidence/home-refinement-2026-09-20/final-light-ky.png) ·
[Dark](evidence/home-refinement-2026-09-20/final-dark-ru.png) ·
[Maximum text](evidence/home-refinement-2026-09-20/final-dark-large.png) ·
[KY admission shortcut](evidence/home-refinement-2026-09-20/home-admission-ky.png).

Captures use CUA's real Simulator-window screenshot API; shell screenshot output
was rejected by the command context filter as binary, so no file/image was
fabricated. Images include the Simulator frame, not just the iOS framebuffer.

Limits: actual QA is assisted, has a test draft and no required admission action.
Required-action/error-first ordering and no-draft lesson-first ordering were
source-reviewed, not manufactured with mocks or case edits. Approved tier,
VoiceOver, hardware, network failures, completed lesson state, full KY content
quality, product-wide E2E and production deployment are not claimed. Existing
long KY tab/admission titles and the server-provided Russian test title in KY
remain outside this Home slice.

Impeccable baseline: independent A/B, 23/32; no post-change rescore. Single
regex detector pass returned no findings, without verified SwiftUI semantic
coverage. No browser overlay or critique server; temporary snapshot input
removed. Snapshot saved locally in `.impeccable/critique`; first target run,
no historical score trend. Durable review: `ios-home-critique.md`. Questions
skipped because owner explicitly asked to continue. Final code reviewed
separately before merge.


### Final source fingerprints

- `ios/EVOAdmissions/Views/HomeView.swift`: SHA-256 `44854379b9d0471d3eacedde07283eec3c7ebf3b277d1bdefabbabecf6747c85`
- `ios/EVOAdmissions/Resources/Localizable.xcstrings`: SHA-256 `567b199fa0cf7f9c42bc07d2f71e06f35f85e099b0966e1d4de2e8d7d2b79adb`
