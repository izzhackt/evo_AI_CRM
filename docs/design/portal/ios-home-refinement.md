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

## Receipt

Pending implementation and real-path verification.
