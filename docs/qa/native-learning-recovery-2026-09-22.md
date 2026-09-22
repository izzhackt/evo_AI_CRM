# Native learning recovery — 22 September 2026

Status: SOURCE_REVIEW_AND_SIMULATOR_COMPILE_PASS; real changed-path validation pending (fresh Mac-locked observation).
Base: b4fc3f91d71a28916307abae554d057e343f138e.

The bounded source review found: assessment exit can acknowledge an older
pending snapshot while newer visible answers remain dirty; assessment failed
reload is retried as a write; lesson failed reload leaves a no-op Retry.

Contract: failed reads retry reads only; uncertain writes retain their frozen
request identity and payload. No silent draft overwrite on failed recovery.
Only explicit successful read adopts saved state. Save and Exit checks the
latest visible answers after any successful write/replay before dismissal.
Existing server authority, version checks, copy, design and native logout stay
unchanged. No mocks or new business fixtures.

Validation will use the ordinary Swift app and existing local Student lesson
and assessment records after ROOT assigns the exclusive QA window. This file
will distinguish source checks from actual execution. No native/runtime proof
is claimed by the precode contract.

## Implementation

Precode commit `c06247cb` precedes the code. Only AssessmentRunnerView.swift
and LessonRunnerView.swift product files change. Each model retains a
read-required flag across failed reads; successful explicit adoption clears
it. It blocks conflicting writes and input while unresolved. Network retry
chooses read recovery when required, otherwise preserves the existing frozen
write. The existing localized conflict/reload prompts are reused for recovery
so a failed read no longer asks the user to repeat saving. Styles, translations,
server contracts and request ID construction remain unchanged.

Assessment Save and Exit now rechecks unconfirmed work after the awaited
write: confirming snapshot A cannot dismiss newer visible answers B. B is
retained for the next explicit save. No automatic extra write is introduced.

## Source checks performed

- `xcrun swiftc -frontend -parse ios/EVOAdmissions/Views/AssessmentRunnerView.swift ios/EVOAdmissions/Views/LessonRunnerView.swift`: exit0. Syntax only; not typecheck, build or actual app acceptance.
- `git diff --check`: exit0.
- No mock service, generated business fixture, implementation-mirroring test
  or runtime substitute was used. At this initial syntax-only stage no dependency installation/native build ran:
  free disk was491MiB before worktree setup and369MiB afterward.

## Minimal real-local validation plan (not executed)

After ROOT assigns the exclusive local QA window and enough disk for the
changed app, reuse cached Swift packages and the existing ordinary post209
Student/account/case from the private B handover. Fresh read-only readiness
must identify its existing assessment draft and lesson draft; historical
records are pointers, not a current baseline. Do not start a new attempt or
create fixture data merely to fill missing cases. Build/install only the
owned local QA app configured to the existing local Supabase project;
production, provider and #1026/#980 are out of this block.

1. Assessment: open the same existing draft in native and the ordinary local
   web runner. One coordinated web save makes native revision stale. Native
   save must conflict. Explicit Load saved while the dedicated native test
   device has real network interruption must fail without changing answers.
   Restore that device's connectivity and retry: observe the real attempt
   read RPC, no save/start/complete, then only successful read adoption.
2. Lesson: use an existing draft with sufficient unanswered exercises. A
   coordinated ordinary web answer makes native revision stale. Native
   answer conflicts; explicit reload during native network interruption
   fails. Online Retry must issue learningLesson read, not no-op/start/save.
   Form and revision remain unchanged across the failed read.
3. Assessment exit: during real native network interruption, attempt save A
   and observe its retained failure. Edit to B; restore connectivity and use
   Save and Exit. The frozen A request succeeds, but the runner remains open
   with B dirty. A second explicit Save and Exit confirms B before dismiss;
   ordinary readback/reopen must show B. Observe same request ID/payload for
   the first retry and a new request only for the later explicit B save.

Use only a real isolated device/network control approved for this window;
no mocked service/responses, synthetic write receipts, disabling shared DB/Auth
or broad host/network changes. If the ordinary native surface/network control
or needed existing draft is unavailable, report that exact gap rather than
substituting a test harness for actual. ROOT coordinates the finite allowed
write budget and companion web session before execution. No Complete calls.
Capture actual RPC outcomes and the smallest task/attempt state delta, preserve
all incoming Auth sessions, close only owned sessions/app/resources. Source
checks do not prove these transitions. No actual has run in this source phase.

## Simulator compile and current execution boundary

Exact product source `dc5b627fc0276aefd1bd07e5a528ccbe16955f1a` received
independent source review PASS (`8971fee262736f49936a1058942acd5d35e13dec30f16bf44bfe3d273ad27da8`).
A real Xcode Debug iOS Simulator build for the existing selected device passed
with cached packages, automatic package resolution disabled, and no downloads.
The final built plist was checked for distinct bundle
`com.evoadmissions.qa.learning20260922` and local-only Supabase origin
`http://127.0.0.1:57596`. The future dedicated TCP relay targets57495;
57496 is existing QA Postgres and is not used or changed.

Setup history is preserved: missing ignored Local.xcconfig, then two JSON
resources omitted by sparse checkout caused build failures. Both were repaired
without product changes. A subsequent successful compile exposed an inherited
literal QA bundle ID during artifact inspection; its private plist was corrected
and rebuilt before any installation. Prior products were not replaced.

Final build receipt SHA `4ca054c7dca49c4caeb0295ba064b37ced406e40568a082c75adc7626a83cd38`;
completion SHA `cb810520dcb42ac20da8938919b28f44643956cf5f712ad496f509d0a82cb121`
in `/private/tmp/evo-native-learning-build-20260922/`.
One fresh CUA Simulator observation reported the Mac locked and automatic
unlock unavailable. No installation, app launch, Auth, relay, database or
changed-path UI execution followed. Compile is not actual recovery acceptance.
ROOT coordinates the next exclusive window after ordinary Mac unlock;
accepted #1026/#980 are not reopened by this work.
