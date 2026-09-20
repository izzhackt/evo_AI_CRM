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
