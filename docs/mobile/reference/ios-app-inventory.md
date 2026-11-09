# EVO admissions iOS v1.1 - behavioral inventory (reference for the Expo rewrite)

Worktree: `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO/.worktrees/mobile-expo/ios` (branch `izzhackt/mobile-expo`).
All paths below are relative to `ios/` unless they start with `src/`, `docs/`, `supabase/`, `scripts/`, `tests/`.
Line refs are from the working tree as read on 2026-11-09. Swift = ~44.8k lines total (app + tests); 416 `func test*` in 49 test files.
(`ios/README.md` still says "171/172 unit tests" - stale.)

Contents: 0 Facts at a glance - 1 Screens - 2 Backend calls - 3 Local logic to port - 4 Bundled resources - 5 Config - 6 What tests assert - 7 Gaps vs current web - 8 Port risks / decisions for the RN team.

---

## 0. Facts at a glance

- Native SwiftUI, iOS 17.0+, **iPhone only** (`TARGETED_DEVICE_FAMILY: "1"`), **portrait only**, light/dark automatic (`UIUserInterfaceStyle: Automatic`). No Catalyst. `project.yml:62-80`, `Generated/Info.plist`.
- Bundle id `com.evoadmissions.app` (tests: `com.evoadmissions.app.tests`), display name "EVO admissions", `MARKETING_VERSION 1.1.0`, `CURRENT_PROJECT_VERSION 1`. xcodegen project; `developmentLanguage: ru`.
- Languages: **RU (base) + KY (Kyrgyz)** only, no EN. `Resources/Localizable.xcstrings` = 926 keys (ru source, ky complete); `Resources/CSCA.xcstrings` = 189 keys (separate table, KY "pending native proofreading"). Bilingual *content* from the server/JSON carries `ru`/`ky` fields; picked by `AppLocale.pick` (`Views/CatalogLabels.swift:11-27`).
- Dependencies: `supabase-swift` (>=2.0.0; README says 2.55.2 resolved) and `SwiftMath` 1.7.3 exact (LaTeX typesetting for CSCA). Third-party notices screen is required by App Store review #1215.
- **One backend**: Supabase (self-hosted, `https://supabase.evoadmissions.com`) via PostgREST RPC, schema `platform` (`db: .init(schema: "platform")`, `Services/SupabaseService.swift:22-28`), plus 6 route handlers of the Next.js cabinet (`https://app.evoadmissions.com`, `AppConfig.portalWebBaseURL`). No direct table queries, no `.from(...)`, no Supabase Storage SDK calls, no Realtime/WebSocket, no push, no deep links, no camera.
- Session: supabase-swift default storage = **Keychain**, service `supabase.gotrue.swift` (no custom code). Router consumes `auth.authStateChanges`.
- All writes are idempotent by a client-generated `p_request_id` (UUID) and retries must resend the *frozen* request (same id + same payload). This is the most important behavioral invariant of the app.
- Privacy rule repeated across the code: answers, verdicts, results, server error texts never reach logs or the UI; UI shows catalog keys only.

---

## 1. Screens / views (`EVOAdmissions/Views/**`, 52 files)

### 1.1 App shell and routing

**`App/EVOAdmissionsApp.swift`** -> `RootView` (`Views/RootView.swift`). `SessionRouter` (`Services/SessionRouter.swift`, @MainActor ObservableObject) holds a state enum and `RootView` switches on it:

| Router state | Screen |
|---|---|
| `.signedOut` / `.authenticating` | `SignInView` |
| `.resolvingAccess` | full-screen spinner |
| `.active(PortalSession{authority, portalCase})` | `TabShell` |
| `.needsApplication(ApplicationEntry)` | `ApplicationWizardView` in `NavigationStack` (toolbar: "Выйти" cancel, secondary action "Удалить аккаунт" -> `AccountDeletionSheet`) |
| `.applicationStatus(StudentApplication)` | `ApplicationStatusView` |
| `.accessPending` | `AccessPendingView` |
| `.networkError(message)` | `NetworkErrorView` (retry) |

Routing algorithm (`SessionRouter.resolveAccess`, :237-270 approx; `Services/ApplicationIntakePolicy.swift` `ApplicationAccessPolicy`):
1. `current_actor_authority()` -> 0/1 row. If `isStudent` (`platformRole == "student"`) then `student_portal_cases()`.
2. `authorityRoute(isStudent, caseCount)`: student with exactly 1 case -> `.active`; student with no case -> `.applicationFlow`; anything else (staff, multi-case) -> `.accessPending`.
3. `.applicationFlow`: read `studentSessionIdentity()` (email, emailConfirmed, `app_metadata.evo_staff_password_request_id` marker, validated `user_metadata.student_application_draft`) and `own_student_application_v1()`. `applicationRoute(...)`: unconfirmed email or staff-provisioned marker -> accessPending; has application -> status; valid metadata draft -> `resumeSubmit` (submit draft with `expected_revision 0`, then clear metadata; on conflict read the existing application); else wizard. For the wizard, tries `POST /api/portal/invite-acceptance` (bearer) to prefill name for `intakeFlow == "anketa_v1"`; failure never blocks.
4. Errors: transport (`ConnectionFailure.isTransport`) -> `.networkError("sign_in_error_network")`; HTTP 5xx -> `error_server_unavailable`; otherwise `.accessPending`. Before showing accessPending it calls `auth.user()` and treats only error code `user_not_found` as "account deleted" (migration 280): signs out locally, SignIn shows `account_deleted_notice`.
5. Auth events: `.initialSession/.signedIn/.tokenRefreshed` with session -> resolveAccess; `.signedOut` -> signedOut; ignored while `inviteFlowActive`.
6. `signOut` = `auth.signOut(scope: .local)` (keeps other sessions).
7. `AccessTier`: `caseState == "pending"` -> `approved` (self-service student); `active`/`closed` -> `assisted` (EVO-accompanied client). Also `ProgramPreparationContext.canStart = caseState == "active" && portalActivatedAt != nil` (`Services/ProgramPreparationModel.swift:3-20`).
8. `RootView` also owns a `ProgramPreparationSession` (env object): activated on `.active`, reset on `.signedOut`; holds in-memory frozen intents; a changed actor/case drops them.

**`TabShell`** (`Views/TabShell.swift`): `TabView`, tint AccentColor, selection haptic (`.sensoryFeedback(.selection)`), 160 ms fade on tab content.
- approved tier: Главная | Университеты | Профессии | Английский | Профиль
- assisted tier: Главная | **Моё поступление** | Университеты | Английский | Профиль ("Профессии" becomes a push row on Home; Tests is never a tab, reachable from Home/English/Profile)
- Starts `UniversityIndexStore.shared.load(organizationId:)` at session start (`.task(id: organizationId)`), not only when the Universities tab is visited.
- `AIConsentModel.live()` is a single @StateObject shared by Home card and Profile row (dies on sign-out).

Navigation: every tab owns its `NavigationStack`. Cross-stack routes are value types: `PortalRoute{professions, favorites}`, `FavoriteUniversityRoute`, `ProfessionRoute`, `CSCARoute{home, topic(String), lesson(UUID), test(CSCATestKind), testResult(UUID), review, progress, sessions, licenses}`, `AtlasRoute`, `ProgramPreparationRoute(applicationId)`. University pages are also opened with closure links (`AtlasLink`) because value links broke across stacks (iOS 26 note in `Views/AtlasComponents.swift:56-62`).

### 1.2 Unauthenticated / onboarding

| View | File | Purpose, actions, states |
|---|---|---|
| `SignInView` | `Views/SignInView.swift` | Title, **email** + password (`AuthField`), "Забыли пароль?" (sheet), "Войти", divider, "Подать анкету" (fullScreenCover with wizard, anonymous mode), "У меня приглашение" (sheet `InviteEntryView`, sets `router.inviteFlowActive`). Errors by key from `AuthMessagePolicy.signInMessageKey`; `accountDeletedNotice`; VoiceOver announcements; motion stagger entrance. |
| `PasswordResetRequestView` (same file :230+) | | Email field -> `router.requestPasswordReset` -> neutral "sent" message for every outcome except rate limit/invalid email/failure; **60 s resend lock after `.sent`**. Calls `resetPasswordForEmail` directly (see 2.1, #1287). |
| `InviteEntryView` + `InviteEntryViewModel` | `Views/InviteEntryView.swift` (245 lines) | Paste the invite link or the 56-hex `token_hash` from `…/auth/callback?token_hash=…&type=invite`; explicit confirm button -> `verifyOTP(tokenHash,type:.invite)` -> `POST /api/portal/invite-acceptance` (bearer) -> set password (`auth.update(password)`, confirm field, show/hide) -> `router.inviteFlowFinished()` (honest re-route; `anketa_v1` goes to the wizard). Parsing rules: `InviteLinkPolicy` in `ApplicationIntakePolicy.swift`. |
| `ApplicationWizardView` + VM | `Views/ApplicationWizardView.swift` (879) | 9 steps (`ApplicationWizardStep`): countries -> intake (season+year) -> education (level + grade + scale) -> fields (study fields, custom field add, search) -> levels -> nationality -> english (exam+score or self-assessed level) -> budget (tuition + funding) -> account. Account step: first/last name, phone, email+password (anonymous mode only), one **consent toggle** + `PrivacyPolicyLink`. Progress bar, direction-aware step transition, per-step gate messages (`ApplicationWizardPolicy.validationKey`), selection limits, "Пока не решил" exclusive with countries. Draft (no password) persisted in `UserDefaults` (see 3.9). Modes: `.anonymous` (registers via web route, then shows confirmation panel: masked email, resend with capability, "sign in", mailto `evoadmissions@gmail.com`), `.signedIn(email, expectedRevision)` (invited, resume, resubmit -> `submit_student_application_v1`). Idempotent `requestId` per wizard session. |
| `ApplicationStatusView` | `Views/ApplicationStatusView.swift` | Status (pending/approved/rejected) title+lead, rejection reason, "Исправить анкету" (rejected -> `router.startResubmit`), "Обновить статус"/"Открыть кабинет" (`refreshApplicationStatus`: checks `auth.user()` for deletion, `refreshSession()`, re-resolve), logout, "Удалить аккаунт" sheet, 12-row localized answers list. Clears draft keys on appear. Also pushed from Home for approved tier (`home_open_application`). |
| `AccessPendingView` | `Views/AccessPendingView.swift` | "Доступ готовится / кабинет недоступен" with retry, sign-out, account-deletion sheet. |
| `NetworkErrorView` | `Views/NetworkErrorView.swift` | message + "Повторить" -> `router.retry()`. |

### 1.3 Tab: Главная (`Views/HomeView.swift`, 402 lines)

`NavigationStack(path:)`; `List` of sections, each with its own `loading/loaded/failed` state + retry row (a failed read never shows as an empty state). Pull-to-refresh and refresh on `scenePhase == .active`. Order depends on tier (`HomeView.swift:97-123`):
1. Greeting ("Привет, <displayName>!" / plain).
2. (assisted + needs attention) Admission block first.
3. `AIConsentCardSection` (assisted only; until a decision on current policy version).
4. `CountryTimelineSection` ("Путь поступления"; first for approved).
5. `CSCAHomeCardSection` (only when country choice == CN).
6. Learning (next lesson: first draft, else first not-completed lesson; "Продолжить/Начать") and Tests (draft -> "Продолжить" opens `AssessmentRunnerView` fullScreenCover; link to `TestsContentView`) - tests first if a draft exists.
7. (assisted, calm) Admission block + timeline.
8. (approved) Application status row.
9. Favorites (<=N rows w/ nearest intake line, link "all favorites", empty state button -> Universities tab).
10. (assisted) Professions row.
Data: `HomeViewModel` reads `learning_modules_v1`, `student_assessments_v1`, `student_university_favorites_v1` + `student_university_catalog_by_ids_v1`, `own_student_application_v1`; `AdmissionHubModel` (below); `CountryTimelineModel`; `CSCAHomeCardModel`; `AIConsentModel`.

### 1.4 Tab: Моё поступление (assisted only) - `Views/MyAdmissionView.swift`

`AdmissionHubModel`: `student_portal_overview_v2` + `student_portal_documents` + `student_portal_finance_v2`, merged into an action queue by `AdmissionActionPolicy` (sort oldest due first, undated last, skip settled/cancelled, stable ties: document first). Shows stage (`AdmissionStageLabel`), primary action row (`AdmissionActionRow` -> Documents or Payments), EVO task + due, curator name, `ProgramPreparationListSection` (programme preparations + "Восстановление пакета" link), and links: Документы, Оплата, Уведомления, Сообщения. Pull-to-refresh, retry.
- **`AdmissionDocumentsView`** (`Views/AdmissionDocumentsView.swift`, 686): legacy checklist from `student_portal_documents` (slot, instructions, status, deadline, last file/version number, review decision, rework reason). Upload via `.fileImporter` (pdf/jpeg/png, <=25 MB) -> `POST /api/portal/document-slots/{slotId}/versions` multipart bearer w/ **frozen `Idempotency-Key`**; retry (same bytes+key); download via `GET /api/portal/document-versions/{versionId}/download` (302 -> signed URL, Authorization stripped on cross-host redirect) then QuickLook preview. Progress "Принято X из Y".
- **`AdmissionPaymentsView`**: `student_portal_finance_v2` rows; amounts in minor units, ru-RU number format for both locales; `dueAt == null` -> no due line, `nextAction == null` -> no next-step block; overdue flag.
- **`AdmissionNotificationsView`**: `student_portal_notifications_v2` (cap 500), unread highlighted, tap marks read via `mark_own_student_portal_notification_read_v2` with **deterministic UUIDv5 request id** (same formula as web server action; test vectors in `AdmissionPolicyTests.testReadRequestIdMatchesTheWebReferenceVectors`), "mark all" loops the single command. Target map: `document*` -> Documents, `payment*` -> Payments, package/document-review notifications -> `ProgramPackageNotificationView`/`ProgramDocumentNotificationView`, `case_help_answer` -> inline disclosure (no iOS screen), else no link.
- **`MessagesThreadView`** (`Views/MessagesThreadView.swift`, 385): case chat. Pages of 30 with before-cursor (`portal_case_chat_page_v1`), displayed ascending; **30 s polling of the first page** while the screen is visible (cancelled on leave) with dedupe by numeric `sequenceId`; send via `portal_case_chat_post_v1` (stable request id per attempt; editing text after a failure mints a new id); no optimistic insert; document-attachment cards render a neutral label when label is null; task cards not rendered.
- **Programme preparation** (assisted + `canStart`): `ProgramPreparationView` (`prep_detail_title`), `CatalogIntakePreparationAction` (button on university intake rows: select intake -> `student_select_catalog_intake_v1`), requirements init (`student_initialize_application_requirements_v1`), programme documents (`ProgramDocumentControls`: pick file -> upload via `/api/portal/application-document-uploads`, choose-saved/reuse picker `ProgramDocumentReusablePicker`, submit -> `submit_application_document_v1`, history `ProgramDocumentHistoryView`, notification detail), package (`ProgramPackageSection`: preview sheet with per-item selection, `application_package_submit_v1`, sent receipt, history, review history, detail with `ProgramPackageDetailView`, recovery `ProgramPackageRecoveryView`: check status / retry same / reload pending). Every command persists a metadata-only frozen intent (see 3.8) so an uncertain outcome can be re-sent identically.

### 1.5 Tab: Университеты (`UniversityAtlasView`, v2 "atlas")

Hierarchy: Countries grid (6 product countries, photo, "N университетов · M городов", searchable by university name across countries) -> `CountryAtlasView` (segmented Города | Карта; city cards with photo/short text/"interesting fact"; "Другие вузы страны" bucket; MapKit map with clustered pins `CountryAtlasMap`) -> `CityAtlasView` (header photo + text + fact with source link and verified date + university cards) -> `UniversityDetailView`. Toolbar link to Favorites. Alert `favorite_error` on failed toggle.
- `UniversityDetailView` (542): one `student_university_detail_v1` call; shows list-version while loading, honest stale banner on refresh error; photo with CC attribution (`UniversityPhotoView`), place links "Страна › Город", favorite heart (`FavoriteHeartButton`), facts, programs (`UniversityProgramCard`) and intakes (`UniversityIntakeView`: open/closed/needs-confirmation computed from deadline + timezone), cost block (`UniversityCostSection`, only if published rows), consultation CTA (sheet `ConsultationRequestSheet`), preparation CTA for assisted/active. 42501 -> "unavailable".
- `FavoritesView`: list (own favourites + batch card read in chunks of <=30), hidden-favourites notice (`student_hidden_university_favorites_v1`), "Compare" sheet = plain facts table (no ratings, no admission chances).
- Legacy list+map `UniversitiesView`/`UniversitiesMapView` (filters country/level, search debounce 300 ms, paged `student_university_catalog`, all pages <=12) **is no longer reachable from TabShell** (comment `TabShell.swift:36-41`; deletion tracked as #1206 n2). Do not port.

### 1.6 Tab: Профессии (approved tier; push from Home for assisted)
`ProfessionsView` / `ProfessionsContentView`: grid of tiles from `profession_cards_v1` (ORVIS scale tags); `ProfessionCardView` from `profession_card_v1` (day, environment, skills, interesting/hard, trial task, where to study; "where to study" links resolve `institutionPhotoKey` against the catalog, unresolved stay plain text). Link to tests. No salaries, no "chances".

### 1.7 Tab: Английский
`EnglishView`: CSCA entry row (-> `CSCARoute.home`), module map from `learning_modules_v1` with own progress, lessons list; `LessonContentView` (goal + theory blocks with examples; start/resume/redo) -> `LessonRunnerView` (fullScreenCover, see 3.4); `ReviewRunnerView` (mistake bank, push). Tests entry -> `TestsContentView`.

### 1.8 Tab: Профиль (`Views/ProfileView.swift`)
Sections: data (name, email, access line), "Мои результаты тестов" link, language Picker RU/KY (+ Save only if differs from last server-saved value), consultation (history of own requests newest-first <=20, CTA opens `ConsultationRequestSheet`; open request shown immediately), AI-consent row (`AIConsentSettingsSection`, assisted only), app section (Privacy policy `Link`, Licenses, app version), session (sign-out), account deletion (`AccountDeletionContent`: confirmation dialog, server-backed status incl. processing/due date). Pull-to-refresh.

### 1.9 Tests / assessments (not a tab)
- `TestsContentView`/`TestsViewModel` (`Views/TestsView.swift`): instruments + attempt history (`student_assessments_v1`), `InstrumentCard` (start/continue), `AttemptSummaryRow` -> `AssessmentResultScreen` (loads full attempt by id).
- `AssessmentRunnerView` (fullScreenCover, one question per screen, debounced autosave ~900 ms, optimistic-lock revision, same-`request_id` retry with same snapshot, 40001 -> reload attempt, exit only via "Сохранить и выйти"/confirmation dialogs).
- `AssessmentResultView`: band (from versioned metadata), per-topic breakdown, per-question feedback, for ORVIS scales + professions with attribution; no CEFR/certificates.

### 1.10 CSCA (China exam prep) - `Views/CSCA/*` (11 files, ~4.9k lines)
Entry: Home card (`CSCAHomeCardSection`, China only), English tab row, timeline step link (`appModule`). Stack routes via `CSCARouteView`:
- `CSCAHomeView`: overview sections (`CSCAOverviewSections`: what is CSCA, who needs it, subjects & format, cost, FAQ, hero photo with credit; open for newcomers/collapsed one-liner for active students, toggle persisted in UserDefaults `csca_overview`), next-step row (test/lesson/review), diagnostic & mock test rows (`CSCATestRow`), review row (due count), topic list with state badges, target session row, progress, sessions, licenses footer.
- `CSCATopic`/`CSCALessonView`: theory (`CSCATheoryBlockView`: paragraphs, formulas, figures, tables, worked examples) + check items + practice; per-item card (`CSCAItemViews`: stem w/ figure, 4 options, verdict, explain with step-by-step solution, terms, "Report an error" sheet <=500 chars).
- `CSCATestIntroView` -> `CSCATestRunnerView` (fullScreenCover): timed diagnostic/mock on **server clock**; navigator sheet (empty/answered/flagged cells), flag items, countdown label, exit/finish confirmations.
- `CSCATestResultView`/`CSCATestResultLoader` (counts by section/topic, pace vs 75 s/item, each item with explain), `CSCAReviewView` (spaced repetition boxes 1/3/7/14 days), `CSCAProgressView` (streak, tests history), sessions screen (official session calendar + registration window state), `LicensesView`.
- `CSCAFigureView`/`CSCAFigureCanvas`: figures are drawn natively from a strict SVG subset (no WebView); zoom sheet. `CSCAMathText`: `$...$` fragments typeset with SwiftMath into template images inline with text; VoiceOver spoken labels.

### 1.11 Shared UI
`Theme.swift` (semantic colors with WCAG contrast numbers; assets `AccentColor #D70217 / #FF8A8A dark`, `AccentFill`, `AccentText`, `SecondaryText`, `DangerText`), `Motion.swift` + `MotionPolicy.swift` (160/200/240 ms ease-out cubic-bezier(0,0,0.2,1), 6 pt lift, 30 ms stagger for first 6 cards, ceiling 400 ms, Reduce Motion aware, press scale 0.98), `AtlasComponents.swift` (photo view w/ constant aspect + disk/memory cache, `AtlasParagraph` UILabel wrapper to avoid iOS 26 Text truncation), `StatusBadge`, `CatalogLabels.swift` (status/level labels), `PrivacyPolicyLink` (`https://evoadmissions.com/ru/privacy/`), `AIConsentViews`, `ConsultationRequestSheet` (free text, optional institution; open request shown first; no test results attached), `AccountDeletionView`. App icon: one 1024 PNG (`Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, generated by `scripts/generate-app-icon.py`). Reference screenshots: `docs/*.png` (wave5/7 states).

### 1.12 "Путь поступления" (`Views/CountryTimelineSection.swift`)
`CountryTimelineModel`: reads `student_country_choice_v1`; if no choice -> `CountryChoiceCard` (6 countries + "Пока не решил"; save via `set_student_country_choice_v1`, frozen attempt id reused after a failure); else timeline from bundled JSON for that country (or `undecided`). Rows per step with timing label, "who" tags (student/evo/university/embassy), items, links; step opens a sheet (`CountryTimelineStepSheet`, "Шаг N из M"); `appModule: "csca"` links push `CSCARoute.home` in the Home stack; "Сменить страну" sheet; three disclaimers (timing, documents, decisions) under timeline and in every step sheet; items with `status: verify` are never shown.

---

## 2. Backend calls (`EVOAdmissions/Services/**`)

Client: `SupabaseClient(supabaseURL: AppConfig.supabaseURL, supabaseKey: AppConfig.supabasePublishableKey, options: db schema "platform")` (`SupabaseService.swift:22-28`). Every RPC is `POST /rest/v1/rpc/<name>` against schema `platform`; params are JSON with the exact `p_*` names below. Errors surfaced as PostgrestError `code`/`message`.

### 2.1 Supabase Auth (`SupabaseService.swift`)
| Call | file:line | Notes |
|---|---|---|
| `auth.signIn(email,password)` | 33 | email only (no login/username). |
| `auth.resetPasswordForEmail(email, redirectTo)` | 40 | **#1287**: direct GoTrue recover, bypasses the web membership check; `redirectTo = <portalWebBase origin>/auth/callback` (`AuthMessagePolicy.recoveryRedirect`, :`Services/AuthMessagePolicy.swift`). Outcome policy: all 4xx / user_not_found / email_not_confirmed / user_banned / per-address 429 ("you can only request this after N seconds", code `over_email_send_rate_limit`) -> neutral `.sent`; other 429 -> rateLimited; `email_address_invalid`/`validation_failed` -> invalidEmail; transport/5xx -> failed. 60 s resend delay (`recoveryResendSeconds`). Called from `SessionRouter.requestPasswordReset` (:~118). README: e2e (email -> web new-password page) not verified on a device; PLAN_CHANGES.md ~61433 records #1287 as open owner decision. |
| `auth.signOut(scope: .local)` | 45 | |
| `auth.user()` (GET /user) | 53 | deleted-account probe: only error code `user_not_found` => deleted (`DeletedAccountPolicy.isDeletedUser`, PortalProfileModels). |
| `auth.session.accessToken` | 637 | fresh bearer for web route handlers (SDK refreshes). |
| `auth.session.user` (email, `emailConfirmedAt`, `appMetadata.evo_staff_password_request_id`, `userMetadata.student_application_draft`) | 684-701 | |
| `auth.update(UserAttributes(data:[student_application_draft: null]))` | 740 | clear metadata draft after submit. |
| `auth.verifyOTP(tokenHash, type:.invite)` | 748 | invite acceptance, establishes session. |
| `auth.update(UserAttributes(password:))` | 754 | set password (invite). |
| `auth.refreshSession()` | 760 | before re-resolving access on status screen. |
| `auth.authStateChanges` | `SessionRouter.swift:~76` | AsyncStream consumed for routing. |
| `auth.currentSession` | `SessionRouter.inviteFlowFinished` | |
No `signUp` anywhere: account creation is the web route `POST /api/portal/registration`.

### 2.2 RPCs (schema `platform`; "Dead" = wrapper exists but no caller)
Identity/portal
- `current_actor_authority()` -> rows[0]: `auth_user_id, profile_id, membership_id, organization_id, display_name, platform_role, platform_access_version` (`SupabaseService.swift:64-70`, model `PortalModels.swift:1-26`).
- `student_portal_cases()` -> rows: `case_id, student_display_name, target_country, target_degree, program_direction, intake, route_approval_status, operational_stage, case_state, next_action, portal_activated_at` (:74).
- `own_student_application_v1()` -> application or JSON null (strict `StudentApplication.decodeOptionalValidated`) (:706).
- `submit_student_application_v1(p_request_id:String, p_questionnaire:StudentApplicationDraft, p_expected_revision:Int64)` (:714). Draft = exactly 19 keys: `schemaVersion, requestId, firstName, lastName, phone, destinationCountries[], intakeSeason, intakeYear, educationLevel, averageGrade, gradeScale, studyFields[], studyLevels[], nationality, english{mode:"exam",exam,score}|{mode:"self",level}, tuitionBudget, fundingSource, consent, consentVersion` (`ApplicationIntakeModels.swift`). Whole numbers must be encoded as JSON integers.
- `get_own_portal_profile_v1()` -> `displayName, email, portalLanguage, caseState, deletionRequestedAt, hasOpenDeletionRequest` (:337). `set_own_portal_language_v1(p_language)` ("ru"|"ky") -> `{portalLanguage}` (:346).
- `request_account_deletion_v2(p_request_id)` -> `{requestId,status,requestedAt,dueAt}` (:358); `own_account_deletion_request_v1()` -> same or null (:368). Migration 280.
- `create_portal_consultation_request_v1(p_request_id, p_institution_id?, p_note?)` (:381); `own_portal_consultation_requests_v1()` -> list newest first, <=20 (:402). Receipt: `requestId,status,institutionId,institutionName,note,requestedAt,handledAt`. Migration 197.
- `portal_ai_consent_get_v1()` / `portal_ai_consent_set_v1(p_status:"granted"|"declined", p_policy_version:"2026-10-25", p_source:"ios", p_request_id)` -> `{status|null, policyVersion|null, decidedAt|null, currentPolicyVersion}` (`SupabaseService+AIConsent.swift:11,20`). Migration 320.
- `student_country_choice_v1()` -> `{country|null, source:none|saved|…, savedAt}` (`CountryChoiceService.swift:17`); `set_student_country_choice_v1(p_country, p_request_id)` (:33). Migration 284. Response must be `source == saved && country == requested`.

University atlas / catalog
- `student_university_index_v1(p_known_version?)` -> full index `{version,countries,cities,universities}` or `{notModified}`; body kept raw for disk cache (`SupabaseService+UniversityAtlas.swift:16`). 42501 = student no longer active in org -> drop cache.
- `student_university_detail_v1(p_institution_id)` -> `{university,country,city,favored,openConsultation,preparations{studentCaseId,items},costs{rows,fxRates}}` (:29). 42501 => unavailable.
- `student_university_catalog(p_query?, p_country?, p_level?, p_offset)` page of 30 + `nextOffset`; and single card via `p_institution_id` (`SupabaseService.swift:87-127`) - only legacy/dead UI and `studentUniversityCard` (1 ref).
- `student_university_catalog_by_ids_v1(p_institution_ids[<=30])` (:323). `set_university_favorite_v1(p_institution_id,p_favored)` -> `{institutionId,favored,favoritesCount}` (:288); `student_university_favorites_v1()` (:304); `student_hidden_university_favorites_v1()` -> `{hiddenCount}` (:313).
- `student_select_catalog_intake_v1(CatalogPreparationIntent{studentCaseId,institutionId,programId,intakeId,publicationVersion,requestId})` (:214; error mapping `CatalogPreparationFailure.serverReason`); `student_catalog_preparations_v1(p_student_case_id)` (:229).

Admission accompaniment (assisted)
- `student_portal_overview_v2()` row (:577), `student_portal_documents()` (:587), `student_portal_finance_v2()` (:597), `student_portal_notifications_v2()` (:605), `mark_own_student_portal_notification_read_v2(p_notification_id,p_request_id)` (:618), `portal_case_chat_page_v1(p_before_sequence_id?)` (:543), `portal_case_chat_post_v1(p_request_id,p_body)` (:558). Field lists: `AdmissionModels.swift`, `PortalCaseChatModels.swift`.
- Programme requirements & documents: `student_initialize_application_requirements_v1` (:247), `student_application_requirements_v2` (:262, **dead**), `student_application_documents_v1` (:806, **dead**), `submit_application_document_v1` (:815; PT409 messages `application_document_stale_requirements|mapping_changed|previous_submission_changed|file_unavailable` -> definitive failure `program_document_changed_refresh`), `application_document_history_v1` (:831, p_limit 20, cursor), `application_document_reusable_versions_v1` (:844), `student_application_document_notification_v1` (:859).
- Packages (`ApplicationPackageService.swift`): `application_package_readiness_v1` (:7, params `p_student_case_id,p_application_id,p_selections[]`), `application_package_submit_v1` (:16), `application_package_review_v1` (:20), `application_package_recover_v1` (:25), `application_package_detail_v1` (:29), `application_package_history_v1` (:36), `application_package_review_history_v1` (:42), `application_package_queue_v1` (:46, **dead**), `application_package_notification_v1` (:51). Error key map `programPackageErrorKey` (42501 -> access unavailable; messages `application_package_stale_requirements|previous_package_changed|previous_submission_changed` -> changed; `application_package_not_ready`). All UUID params are sent lowercase strings; responses are cross-validated against the requested ids (mismatch = invalid response).

English learning / tests / professions
- `learning_modules_v1()` (:413), `learning_lesson_v1(p_lesson_id)` (:422), `start_learning_lesson_v1(p_lesson_id,p_request_id)` (:435), `save_learning_answer_v1(p_attempt_id,p_expected_revision,p_exercise_id,p_answer,p_request_id)` (:453), `complete_learning_lesson_v1(p_attempt_id,p_expected_revision,p_request_id)` (:485), `learning_review_v1(p_module_id)` (:510, cap 20), `learning_review_check_v1(p_exercise_id,p_answer)` (:521, stateless). `LearningAnswer` shapes: choice/matching/short/reading (`LearningRunnerModels.swift`; short answer trimmed, cap 300).
- `student_assessments_v1()` (:133), `student_assessment_attempt_v1(p_attempt_id)` (:142), `start_student_assessment_v1(p_instrument_key,p_request_id)` (:153), `save_student_assessment_answers_v1` and `complete_student_assessment_v1` (p_attempt_id, p_expected_revision:Int64, p_answers:{qid:optionId}, p_request_id) (:169,:191).
- `profession_cards_v1()` (:641), `profession_card_v1(p_card_id)` (:649).

CSCA (`Services/CSCAService.swift`; contract `docs/portal/csca-contract.md`; migrations 285/286). Track is always `"csca-math"`.
- Reads: `learning_track_home_v1(p_track)` (:56), `learning_lesson_v2(p_lesson_id)` (:61), `learning_test_attempt_v1(p_attempt_id)` (:66), `learning_review_v2(p_track)` (:71), `learning_track_progress_v1(p_track)` (:76).
- Writes: `start_learning_lesson_v1` (:84), `save_learning_answer_v1` (:99, answer `{selected:"a"}`), `complete_learning_lesson_v1` (:113), `start_learning_test_v1(p_form_id,p_request_id)` (:124), `save_learning_test_v1(p_attempt_id,p_expected_revision,p_answers{itemKey:optionKey},p_flags[],p_item_seconds{itemKey:int},p_request_id)` (:140, whole-state replace), `complete_learning_test_v1` (:154), `record_learning_review_v1(p_track,p_item_key,p_answer,p_request_id)` (:172), `report_learning_item_v1(p_track,p_item_key,p_message,p_request_id)` (:188), `set_learning_target_session_v1(p_track,p_session_key|null)` (:214; **explicit JSON null to clear**).
- Error classification `CSCAFailure.classify` (`Services/CSCA/CSCAPolicy.swift:293`): 40001 conflict (re-read), 42501 denied, 22023+message `learning_test_deadline_passed|learning_test_completed|learning_test_early_finish_forbidden|learning_review_not_due|learning_report_limit|Learning exercise is already answered`, other 22023 invalid, URLError/no code network.

### 2.3 Web route handlers on `AppConfig.portalWebBaseURL` (default `https://app.evoadmissions.com`, `App/AppConfig.swift:41-55`; http allowed only if configured)
| Method + path | Auth | Request | Responses | Code |
|---|---|---|---|---|
| `POST /api/portal/registration` | anonymous | JSON exactly `{questionnaire, email, password}`; headers `Content-Type`/`Accept: application/json`, `X-EVO-Registration-Flow: email-confirmation-v1` | 202 `{status:"pending_confirmation", maskedEmail, expiresAt, dispatch:accepted|failed|unknown, retryAfterSeconds|null, resendCapability:"v1.<16>.<…>.<22>"}`; 400 invalid/password/password_too_long; 409 conflict; 429 rate_limit; 503 unavailable/create_unknown; 426 upgrade_required. Unknown/ambiguous => `createUnknown` (never blindly re-create). Body <=16 KiB. | `ApplicationIntakeTransfer.swift:12-25`, `SupabaseService.swift:765-779`, `StudentRegistrationOutcome.decode` (`ApplicationIntakeModels.swift`) |
| `POST /api/portal/registration/resend` | capability token | JSON `{cap}` same headers | 200 confirmed / 410 expired / 429 rate_limit / 409 account_conflict else unavailable | `ApplicationIntakeTransfer.swift:27-39`, `SupabaseService.swift:781` |
| `POST /api/portal/invite-acceptance` | Bearer | none | 200 `{status:"accepted", intakeFlow, accountPending, displayName}`; 401; 409 (no receipt); else unavailable | `ApplicationIntakeTransfer.swift:41-52`, `SupabaseService.swift:791` |
| `POST /api/portal/document-slots/{slotId}/versions` | Bearer | multipart/form-data with exactly one part `file`; header `Idempotency-Key: <uuid>` (frozen per attempt) | 201 `{document:{documentSlotId,documentVersionId,versionNumber,originalFilename,declaredMimeType,byteSize}}`; 400/415 badFile, 403, 409, 413 (>25 MB), 422 scanRejected, 429, else unavailable | `PortalDocumentTransfer.swift` (uploadRequest/multipartBody/failure mapping), `Views/AdmissionDocumentsView.swift:115-165` |
| `GET /api/portal/document-versions/{versionId}/download` | Bearer | | 302 Location = short-lived signed storage URL on another host (Authorization must be stripped on cross-host redirect: `PortalDownloadRedirectDelegate`); bytes written to temp, QuickLook | `PortalDocumentTransfer.swift`, `AdmissionDocumentsView.swift:195-232` |
| `POST /api/portal/application-document-uploads` | Bearer | multipart (part named `file`, filename fixed `upload`), headers `Idempotency-Key: <request uuid>`, `X-EVO-Upload-Intent: <base64url JSON of frozen intent {protocolVersion:1,studentCaseId,applicationId,requirementsRevisionId,requirementItemId,documentSlotId,file{originalFilename,declaredMimeType,byteSize,sha256Hex}}, <=6144 bytes, <=8192 header chars>` | 201 + receipt (validated against intent+requestId); error body `ApplicationDocumentHTTPFailure{code,notWritten}` | `ApplicationDocumentUpload.swift:92-123`, `Services/ProgramDocumentModel.swift:60-110` |
| `GET /api/portal/application-document-downloads?studentCaseId&applicationId&requirementsRevisionId&requirementItemId&documentSlotId&documentVersionId` | Bearer | six lowercase UUIDs | 200 bytes (size+sha256 must match the known file summary), redirects handled by the same delegate; temp file `program-documents/<uuid>/document.(pdf|jpg|png)` mode 0600, `.completeFileProtection` | `ApplicationDocumentUpload.swift:137-150`, `ProgramDocumentModel.swift:165-200` |
Allowed upload types: `application/pdf`, `image/jpeg`, `image/png`; max 25 MiB (`PortalDocumentTransfer.allowedMimeTypes/maxByteSize`). Validation of filename (<=255 scalars, no controls, no `/`, `\`).

Web routes that exist but the iOS app does **not** use: `GET /api/portal/updates?s=<section>` (light poll, `src/lib/server/light-poll-route-handlers.ts`), `/api/portal/case-files/[fileKind]`.

### 2.4 Storage / REST / realtime
- No `client.storage`, no signed-URL calls from the app: signed URLs appear only as 302 targets of the web download handlers.
- **Public bucket reads (unauthenticated GET, no SDK)** for atlas photos: bucket `portal-university-photos`: original `{SUPABASE_URL}/storage/v1/object/public/portal-university-photos/<path>` and sized `{SUPABASE_URL}/storage/v1/render/image/public/portal-university-photos/<path>?width=<step>&quality=70` (width steps 320,480,640,800,1080,1280,1600,2048; sized first, then original; if sized is rejected but the original loads the loader switches to originals for the rest of the launch). Path regex `[a-z0-9][a-z0-9._-]*(/…)*`, no `..`. Country/city photos: path from index. University photos: only via manifest `scripts/portal/university-photos-manifest.json` entry verified+migrated; otherwise placeholder, never a third-party hotlink. (`Services/UniversityAtlas/AtlasPhotoSource.swift`, `Services/AtlasImageLoader.swift`).
- No PostgREST table queries (`.from`). No Realtime. Only polling: chat 30 s (`MessagesThreadView.swift:159`), CSCA test runner 1 s countdown tick + 10 s batched save (3.3), Home/foreground refresh on `scenePhase == .active`, assessment autosave debounce 900 ms (`AssessmentRunnerView.swift:159`), legacy list search debounce 300 ms.

---

## 3. Local logic that has to be ported

### 3.1 University atlas
- Index store (`Services/UniversityAtlas/UniversityIndexStore.swift`): per-organization; show disk copy first, then **one version check per launch** (`p_known_version`), pull-to-refresh always checks; `notModified` must match the current version else error and keep copy but flag `refreshFailed`; failure with copy keeps copy; failure without copy -> `connection` vs `unavailable`; 42501 deletes copy + memory; org switch drops earlier answer; single-flight fetch.
- Disk cache (`UniversityIndexDiskCache.swift`): file `Caches/university-index/index-v1-<orgId>.json` = exact response body; invalid wrapper = delete; write only full responses; file protection until first unlock.
- Strict-but-degrading parsing (`UniversityIndexModels.swift`, `AtlasCatalogParse.swift`, `AtlasStrictDecoding.swift`, `CatalogText.swift`): broken university skipped alone, broken city moves its universities to "other", country counts recounted from universities and logged, per-field degradation; text/URL rules shared with web via `tests/fixtures/catalog-text-vectors.json`; log line shape `catalog parse degrade ...` (`CatalogParseLog`).
- Policy (`UniversityAtlasPolicy.swift`): search normalisation (case/diacritics, matches web on production names, index order), city order by interface language, plural forms RU/KY, "nearest intake" (future deadline first, else start day/month) and label formatting, map pins only for verified coordinates (`UniversityMapPolicy`, `UniversityGeoLibrary`), clustering by zoom, identical coordinates never hide a university, cost block planning (`UniversityCostPolicy`: minor units, exponent, locale formatting, USD estimate column only if any row has it, rates to 5 significant digits, grouping/order, academic-year rule, source short names), intake status (`UniversityCatalogItem`: open/closed/needs confirmation from deadline+time+timezone; past deadline = closed even if source says open), photo credit rules (`UniversityPhotoLibrary`: photoKey -> url + CC attribution), `StudyCountries` (6 codes + `undecided`, names by language).
- `SingleFlightReloadGate`, `FavoritesStore` (optimistic toggle, rollback + `toggleFailed` alert, truth = server receipt, ignore taps in flight; merge states in `FavoritesNavigationModel` test helper).

### 3.2 Country choice and timeline
`CountryTimeline.swift` (869 lines) is a strict port of web `src/lib/portal/country-timeline.ts`: closed key sets, value dictionaries, text rules with **JS regex semantics** (`\s`/trim incl. U+FEFF, U+000B; `$`=end only; `\b` ASCII), raw-file scan rejecting BOM and duplicate keys at any depth, `validUntil` => `undated` text variants, offsets (week/month), `selectCountryTimeline` (choice -> country file, unknown -> general route `undecided`; broken country file -> general route), Bishkek "today" (`Asia/Bishkek`), module link map (`csca` -> internal route), hide `status: verify` items, no CSCA session dates in the exams step. Parity is enforced by `Fixtures/country-timeline-parity.json` generated by `scripts/portal/write-country-timeline-ios-parity.mjs` and test `CountryTimelineTests`. In RN, **import the web TypeScript parser directly** (same JSON files) rather than porting regexes.

### 3.3 CSCA engine (all heavy logic is server-side; client rules below)
- Strict decoders (`Services/CSCA/CSCAModels.swift`, 1247 lines): required keys incl. nullable ones, closed enums (`state`, `kind`, `completion`, `status`) fail on unknown, unknown theory block kinds / test kinds / nextStep kinds skipped silently, item projection has a closed key set (an extra key such as a leaked answer key fails decode). Never keep answer keys client-side; verdict/explain come only in save receipts / completed attempts.
- Lessons & practice (198 write path): attempt created on first "Проверить"; each answer final (second answer -> `alreadyAnswered`); completion once every exercise answered; retry with same request id + same input after network failure; 40001 -> re-read lesson first (`CSCALessonModel`, `CSCALessonView.swift`).
- Timed tests (`CSCATestRunnerModel`, `CSCATestRunnerView.swift:144-505`): **server clock** `CSCAServerClock(serverNow, receivedAt)` anchored to a monotonic clock (survives device time change/sleep; a replayed older receipt never winds the clock back; `keepingLater`); display-only countdown, server enforces deadline (grace) and finishes expired drafts; mock tests have no "Finish" (client completes when time is out); diagnostic can be finished early only where allowed (`learning_test_early_finish_forbidden`). Save schedule `CSCASaveSchedule`: batch every 10 s if dirty, on navigation not more often than every 2 s, always on background/deadline, one request in flight, latest revision; `CSCAFrozenTestSave` (resend unchanged after transport failure) + `CSCASaveQueue` (max 3 requests per save so answers given after a lost request still go out); `CSCAItemTimer` seconds per item added to server `item_seconds`, clamped 0..3600; navigator cell states; flags toggle; refresh on scenePhase.
- Review (spaced repetition boxes 1->1 d, 2->3 d, 3->7 d, 4->14 d; `learning_review_not_due`), report text normalisation (<=500 chars, `CSCAReportText`), session plan (`CSCASessionPlan`: foundation > 28 days, intensification <= 28, sprint <= 7 days before `examFrom`; labelled EVO rule of thumb), registration window states (pending/upcoming/open/closed, closes-soon <= 60 days, Bishkek day), timestamps with fractional seconds, day labels in `Asia/Bishkek`.
- Home card rule (`CSCAHomeCardPolicy`, port of `src/lib/portal/csca-home-card.ts`): visible only for country CN, nearest non-finished session by `examFrom` (finished = `examTo < home.today`), summary line from overview.json.
- Overview content (`CSCAOverview.swift`, 825 lines, parser port of `src/lib/portal/csca-overview.ts`): strict parse with field-path errors, "no em/en dash" rule, narrow-subject shared facts, EVO status enum, photo manifest checks (sha/size) and photo file picked by screen scale (720 for 2x, 1280 for 3x, 240 thumb), open/collapsed rule + `csca_overview` UserDefaults choice (`CSCAOverviewChoice`), plural forms of "closes in N days".
- Math: `CSCATeX` splits on `$` (always a delimiter, odd segments are formulas, trailing unmatched `$` stays text), spoken labels (`\frac` "over", `^2` "squared", `\log_a` "log base a"), prime glyph handling; every fixture formula must parse in SwiftMath. RN needs a LaTeX renderer (KaTeX/MathJax-RN or react-native-math-view equivalent) and a test that all fixture formulas render.
- Figures: `CSCASVG.swift` parser for a strict SVG profile (palette of 6 colors `paper #ffffff, ink #191714, muted #6b6660, grid #e4dfd7, accent #d70217, ok #177245` mapped 1:1 to dark `#1e1c19 #f2efe9 #a39d94 #2c2925 #ff4a57 #4cc38a`; path grammar, transform lists, text runs with super/subscript shifts); anything outside the profile (element, attribute, color, entity, DTD, comment) rejects the figure and the screen shows alt text; parsed figures cached by content checksum. RN: react-native-svg with the same whitelist.
- Localization: CSCA strings are in their own table; tests forbid dashes and forbidden claims ("never a CSCA score": results are "оценка EVO по нашим заданиям").

### 3.4 English lessons / review / assessments
- Lesson runner (`Views/LessonRunnerView.swift` 1138 lines; model :29-355, policy `LearningRunnerPolicy`/`LearningRunnerModels.swift`): intro phase (goal+theory only for fresh attempts), exercises one by one, explicit "Ответить", verdict+explain from save receipt, resume at first unanswered (or completion if all answered), pending write state machine (`PendingLearningWrite{requestId,operation,expectedRevision}`): only network failures reuse the frozen request; conflict 40001 -> explicit reload; completion only when every exercise answered (share correct is not a threshold). Exercise types: choice, matching (drag/tap pairs; payload `matches:[Int]`, stealing a right from previous left), short answer (trim, 300 cap), reading (all questions required, stray keys dropped). Option label fallback chain, prompt prefers English content.
- Review runner: stateless `learning_review_check_v1`, progress only on screen.
- Assessment runner: see 1.9.

### 3.5 Offline / caching (the whole list - there is no general offline mode)
| What | Where | Policy |
|---|---|---|
| University index body | `Caches/university-index/index-v1-<org>.json` | see 3.1 |
| Atlas/campus photos | `URLCache` under `Caches/catalog-photos` + `NSCache<NSString,UIImage>` (`Services/AtlasImageLoader.swift:21-34`) | paths contain sha256 so long caching is safe |
| CSCA overview images | `NSCache` in `CSCAOverviewImages` (decode off main) | bundled WebP |
| CSCA figures | in-memory `CSCAFigureCache` keyed by checksum | |
| Wizard draft | `UserDefaults` | see 3.9 |
| Pending program-document intents | `Application Support/ProgramDocumentPending/…` | see 3.8 |
| Pending package intents | `Application Support/ProgramPackagePending/…` | see 3.8 |
| Session | Keychain | |
No offline reading of cabinet data: failed reads show per-section retry.

### 3.6 Keychain
Only via supabase-swift default storage (service `supabase.gotrue.swift`). RN: `expo-secure-store` adapter for `supabase-js` `auth.storage` (note SecureStore 2 KB iOS limit historically; use chunked/AsyncStorage+encryption key pattern). Not required: biometric lock (none).

### 3.7 Deep links / push / camera / pickers
- **None implemented**: no `onOpenURL`, no URL scheme, no associated domains, no entitlements file, no APNs/`aps-environment`, no `UNUserNotificationCenter`, no camera/photo-library/location usage, no Info.plist usage-description strings. Invite and password-reset links open in the system browser (web `/auth/callback`); the invite is "paste link or token" inside the app by design.
- File selection = SwiftUI `.fileImporter` (Files app, security-scoped URL) with `[.pdf,.jpeg,.png]` in `AdmissionDocumentsView.swift:270`, `ProgramDocumentView.swift:83,136`. Reads the file with `FileHandle`, size from resource values, MIME from `contentType.preferredMIMEType`; rejects non-regular files, empty, >25 MiB, other MIME. In RN: `expo-document-picker` (+ optionally `expo-image-picker` if camera/photo roll is added; then permission strings and privacy answers change).
- Map: MapKit (`CountryAtlasMap`, `UniversitiesMapView`) with Apple attribution; RN: `react-native-maps` (Apple Maps on iOS, Google on Android needs key) or MapLibre.
- Haptics: `.sensoryFeedback(.selection)` on tab change; SF Symbol effects (bounce/replace).
- Accessibility is a first-class requirement: min 44 pt targets, VoiceOver announcements for errors, language-tagged speech runs for English content, Dynamic Type incl. accessibility sizes, Reduce Motion, WCAG-checked colors (tests: `FillContrastSourceTests`).

### 3.8 Persistent "frozen intent" stores (program documents/packages)
- `ApplicationDocumentPendingStore` (`Services/ApplicationDocumentPending.swift`): one JSON file per owner/application/item/operation (`upload` | `submit`) in `Application Support/ProgramDocumentPending`, dir 0700, excluded from backup, files 0600; contains owner `{actorId, membershipId, organizationId, studentCaseId}`, `requestId`, intent (metadata only: filenames, MIME, size, sha256 - **never bytes or tokens**). Load re-validates ownership and ids; corrupt record blocks dispatch only. A retry requires the same file (size+sha256) else `changedFile`.
- `ApplicationPackagePendingStore` (`Services/ApplicationPackagePending.swift`): same pattern for package submit/review (`freeze`, `pending(for:)`, `clear`, recovery via `application_package_recover_v1`).
- Rules: HTTP 201 -> clear; definitive "not written" failure -> clear; uncertain -> keep and show "check status"/"retry same"; session scope change drops in-memory selections (`ProgramPreparationSession.generation`). Uploads and submits use a per-item lock (`document/<app>/<item>`).

### 3.9 Wizard, drafts, validation
- `ApplicationContract` mirrors `src/lib/student-application-contract.ts` (value sets: seasons `spring|summer|autumn|winter|undecided`, education levels, study levels, grade scales `100|5|4|10|20`, tuition budgets, funding sources, English levels, exams ielts 0-9/.5, toefl 1-6/.5, toefl_120 0-120, pte 10-90, duolingo 10-160/5; 12 RU study-field canonical strings; nationalities = ISO list; legacy countries `DE FR ES NL PL HU AT GB CY` still accepted from stored data but not offered; consentVersion `2026-09-18`; metadata key `student_application_draft`). `ApplicationDraftValidator` is a rule-for-rule mirror of `validateStudentApplicationDraft` (text trimmed/bounded/no control chars, phone `^\+?[0-9 ()-]{7,40}$`, UUID v1-8 pattern, unique bounded sets). Step gates and order of messages mirror `ApplicationWizard.tsx:135-149`. Canonical values stay RU/ISO; KY only changes labels.
- Draft keys (UserDefaults, JSON `{values, step}`, no password): anonymous `evo-application-draft-v1`; signed-in `evo-application-draft-v1:<email>:<expectedRevision>`; cleared on the status screen.
- Registration response handling + resend capability held only in memory (never persisted).

### 3.10 Account deletion, AI consent, language, misc
- Account deletion (`AccountDeletionView.swift`): `request_account_deletion_v2` with a request id stable per model instance; status from server (`own_account_deletion_request_v1`) so it survives relaunch/other device; accounts deleted by the team show "Аккаунт удалён" at next launch (see 2.1/1.1). App Store 5.1.1(v).
- AI consent (App Store 5.1.2(i)): offered only to assisted tier (`AIConsentPolicy.isOffered`); card on Home until decided on **current policy version** (server `currentPolicyVersion` must equal build constant `2026-10-25`, else no buttons - "update app"); allow/decline/revoke map to `granted|declined`; same choice reuses its request id until the server answers, a different choice or next decision gets a new id; failed save changes nothing; rejected save re-reads; second tap while sending ignored; read started before a save never overwrites it; failed background refresh keeps shown decision; text copy verbatim from owner contract, KY names both AI providers.
- Language: Profile picker; server write first (`set_own_portal_language_v1`), then `UserDefaults["AppleLanguages"]=[lang]` (full effect after restart; screen says so). In RN: store in app state and apply immediately instead.
- `PostgresTimestamp.swift`: parses timestamptz with microseconds / no fraction / Z; garbage never becomes a fabricated date. `ServerUUID`: safe parse, never trap. `ConnectionFailure`: transport vs "maybe reached server" (timeout, dropped connection) vs other -> hint key.
- `ThirdPartyNotices` + `Resources/Licenses/*` (13 files) feed `LicensesView`; list must match resolved packages. In RN, ship a licenses screen generated from the actual dependency set.

---

## 4. Bundled resources

Declared in `project.yml` (app target :40-95; test target mirrors them). **Single-source pattern: the iOS build includes the web files from `src/` directly (not copies).**

| Resource | Source of truth | Used by |
|---|---|---|
| `src/lib/university-photo-library.json` (91 KB) | web | `UniversityPhotoLibrary` photoKey -> url + CC attribution (fallback for unknown key) |
| `src/lib/university-geo-library.json` (22 KB) | web | `UniversityGeoLibrary` verified campus coordinates for map pins |
| `src/lib/study-countries.json` (CN, MY, AE, TR, IT, CZ + `undecided`; ru/ky names; `kyProofreading: pending`) | web + CRM | wizard, country choice, filters |
| `src/content/timelines/{cn,my,ae,tr,it,cz,undecided}.json` (+ `SCHEMA.md` not bundled) | web | CountryTimeline |
| `src/content/csca/overview.json` (11.6 KB), `photos.json` | web | CSCA overview |
| `src/content/csca/photos/campus-sichuan-{240,720,1280}.webp`, `campus-xiamen-{720,1280}.webp` (jpg 720 exist for browsers only, not bundled) | web | overview hero photos |
| `scripts/portal/university-photos-manifest.json` (117 KB) | web scripts | managed university photo path (bucket) |
| `tests/fixtures/catalog-text-vectors.json` (test target only) | web tests | `CatalogTextTests` shared vectors |
| `Resources/Localizable.xcstrings` (926 keys), `Resources/CSCA.xcstrings` (189) | iOS only | UI strings RU/KY (web has its own `src/lib/portal/i18n.ts`) |
| `Resources/Licenses/*.txt` (13) | iOS only | LicensesView |
| `Resources/PrivacyInfo.xcprivacy` | iOS only | App Store |
| `Resources/Assets.xcassets` (AppIcon 1024, AccentColor, AccentFill, AccentText, SecondaryText, DangerText, with dark/high-contrast variants) | iOS only | |
No custom fonts in the app (system font, SF Symbols ~ icon set); SwiftMath ships its own math fonts (GUST + STIX OFL, covered in Licenses). No images other than the five WebP and the icon.

Test fixtures (`EVOAdmissionsTests/Fixtures/`, real/hand-built server responses; reusable as RN contract fixtures):
- `atlas-index-demo.json`, `atlas-index-not-modified-demo.json`, `atlas-detail-bilkent-demo.json`, `atlas-detail-tongji-demo.json` (demo-server captures)
- `csca-overview-parity.json`, `country-timeline-parity.json` = **iOS parity fixtures generated by web scripts** (`scripts/portal/write-csca-overview-ios-parity.mjs`, `write-country-timeline-ios-parity.mjs`); the web test `tests/portal-country-timeline-ios-parity.test.mjs` also pins them. They are the single best cross-platform acceptance test for the TS ports.
- `CSCA/*.json` (37 files): `csca_home_fresh|after|after_mock`, `csca_modules_v2_csca|english`, `csca_lesson_*` (start, save_1..4, complete, with_draft, m2-derivative/exp-log, m3-line-circle l1/p1), `csca_test_start_diagnostic|mock`, `csca_test_save|save_mock`, `csca_test_complete_diagnostic`, `csca_test_mock_timeout`, `csca_review_v2_due|not_due`, `csca_record_review_correct|first`, `csca_progress|after_mock`, `csca_report`, `csca_target_session`, `csca_error_*.error.json` (stale_revision, mock_early_finish, report_empty, review_not_due, test_completed, unknown_track).
- `AtlasFixtures.swift` and other tests embed inline JSON for the other RPC shapes (each cites migration lines).

---

## 5. Config

- `project.yml`: targets "EVO admissions" (app, iOS 17, Swift 5.0 mode) and `EVOAdmissionsTests` (hostless: compiles only pure Codable/logic files, no Supabase SDK, no UI; depends on SwiftMath). Scheme runs tests in Debug; archive config Release.
- Config injection: `Info.plist` keys `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PORTAL_WEB_BASE_URL` resolved from xcconfig. Debug <- gitignored `Local.xcconfig` (sample `Local.xcconfig.example`: `SUPABASE_URL = https:/$()/supabase.evoadmissions.com`, key placeholder, `PORTAL_WEB_BASE_URL = https:/$()/app.evoadmissions.com`; note xcconfig `//` comment gotcha handled by `/$()/`). Release <- `ReleaseBase.xcconfig` (`#include? "Release.xcconfig"`) <- gitignored `Release.xcconfig` written by script.
- `scripts/write-release-config.sh` (POSIX sh): inputs env `SUPABASE_URL` (required, https only, host chars `[A-Za-z0-9.-]`, optional port, no path), `SUPABASE_PUBLISHABLE_KEY` (required, `^[A-Za-z0-9._-]+$`, **rejects `sb_secret_*` and JWT with `"role":"service_role"`**), `DEVELOPMENT_TEAM` (optional, 10 chars `[A-Z0-9]`), `PORTAL_WEB_BASE_URL` (default `https://app.evoadmissions.com`, https only), `RELEASE_XCCONFIG_PATH`; writes `Release.xcconfig` with `umask 077`, atomic mv, never prints the key (prints length). `scripts/check-release-config.sh` is a pre-build phase: in Release requires https URLs, non-secret key, no `NSAppTransportSecurity` in Info.plist, and on archive (`ACTION=install`) a non-placeholder key (`*REPLACE*|*PLACEHOLDER*|*placeholder*|your-*`) and a Team ID. RN equivalent: `app.config.ts` + EAS env/secrets with the same validation (https, not service_role/secret key). All values are public client values; Supabase URL and publishable key are baked into the app.
- `AppConfig`: Supabase URL/key missing => `fatalError` at launch; `PORTAL_WEB_BASE_URL` missing/empty/hostless/non-http(s) => fallback `https://app.evoadmissions.com`.
- Bundle id `com.evoadmissions.app`; **no entitlements file**; capabilities: none (no push, associated domains, keychain sharing, sign-in with Apple). `ITSAppUsesNonExemptEncryption: NO`. ATS: default (no exceptions in release; a local-dev exception was only ever hand-added to Generated/Info.plist and must never be committed).
- Info.plist (`Generated/Info.plist`): `CFBundleDisplayName`, version/build from build settings, `UILaunchScreen {}`, `UISupportedInterfaceOrientations` = portrait, `UIUserInterfaceStyle` = Automatic, the three config keys. **No `NS*UsageDescription` strings.**
- `Resources/PrivacyInfo.xcprivacy`: `NSPrivacyTracking false`, no tracking domains; collected data (all Linked=true, Tracking=false, purpose AppFunctionality): Name, EmailAddress, PhoneNumber, Health, OtherFinancialInfo, EmailsOrTextMessages, PhotosorVideos, CustomerSupport, OtherUserContent, UserID, ProductInteraction, OtherDataTypes; accessed APIs: UserDefaults reason `CA92.1`. Full mapping data-type -> screen -> code in `docs/app-store/app-privacy.md` (must be kept 1:1 with the manifest). Expo: set `ios.privacyManifests` in app config; Android needs a Play Data safety form.
- `ExportOptions-AppStore.plist`: method `app-store-connect`, destination upload, automatic signing, `manageAppVersionAndBuildNumber false`, `uploadSymbols true`. Release order and checklist: `README.md` "Выпуск в App Store"; store copy in `docs/app-store/` (`listing-ru|en.md`, `review-notes.md`, `age-rating.md`, `app-privacy.md`, `authorization-letter.md`, `owner-checklist.md`). Privacy policy URL `https://evoadmissions.com/ru/privacy/` (`AppLinks.privacyPolicy` in `ThirdPartyNotices.swift:136`).
- Planning docs the iOS code cites (read before porting): `docs/adr/0030-portal-iphone-swiftui-supabase-transport.md`, `docs/design/portal/port-0-contracts.md`, `docs/portal/csca-contract.md`, `docs/portal/country-timeline-contract.md`, `docs/catalog/geography-costs-contract.md`, `docs/design/portal/design-contract.md`, `docs/archive/plans/2026-10-16-student-app-v2-plan.md`.

---

## 6. What the tests assert (acceptance criteria by area)

`EVOAdmissionsTests/` = hostless XCTest (no UI, no network); 416 test funcs / 49 files. Fixtures are real or hand-written server payloads. Grouped:

**Auth & session**
- `AuthMessagePolicyTests`: sign-in error keys come from the catalog (invalid_credentials, email_not_confirmed, rate limits, legacy 400 without code, transport); recovery **never reveals whether the account exists** (all 4xx, user_not_found, banned, per-address limit => `.sent`); recovery link = `<origin>/auth/callback` ignoring base path; email shape check.
- `PortalProfileDecodingTests` (incl. `testOnlyUserNotFoundMeansTheAccountWasDeleted`), `ConnectionFailureTests` (no-connection errors never reached server; timeout/dropped may have), `ServerUUIDTests` (no crashes on malformed ids).
- `ProfileLanguagePolicyTests`: save button hidden when equal to last *saved* value, shown while saving, can switch back after save without restart.

**Application / registration (anketa)** - `ApplicationIntakePolicyTests` (19), `ApplicationIntakeDecodingTests` (13)
- Valid draft passes; each contract rule rejects; destinations = product list + undecided, mutually exclusive; legacy countries valid but not offered; saved drafts drop removed countries; exam score ranges; step validation order = web order; account-step names first problem in screen order; resubmit keeps answers and **requires fresh consent**; selection limits; credential gates; registration outcome -> message mapping = web; authority route table; application route (resume semantics, staff marker); invite link parsing; invited name prefill split.
- Decoding: pending/rejected/approved(needs case link)/undecided rows, null -> nil, exact 19-key draft round trip, english exam/self encoding, registration outcome vocabulary, **ambiguous create can never offer a blind re-create**, strict pending-confirmation shape + resend transport, invite-acceptance status mapping, request builders (headers/paths).

**Admission accompaniment** - `AdmissionDecodingTests`, `AdmissionPolicyTests`, `PortalCaseChat*`
- Overview with/without actions & curator, partial action group never assembles an action, checklist rows, payments incl. undated tranche, notifications, read receipt, upload receipt.
- Queue sort/skip/ties; undated payment has no due line; unparseable timestamp renders nothing; frozen upload key (retry same, other file new, success clears); read-request-id matches **web reference vectors**; mark-all targets unread only; notification target map = web; multipart body has exactly one `file` part; upload failure map (400/415, 403, 409, 413, 422, 429).
- Chat: merge DESC pages into ASC display, dedupe by sequenceId preferring incoming, polling keeps earlier pages, numeric (not lexicographic) ordering, send gate mirrors server bounds; decode pages with document/task/quote rows, empty thread, post receipt.

**Universities / atlas** - `UniversityIndexDecodingTests`, `UniversityIndexStoreTests`, `UniversityDetailDecodingTests`, `UniversityAtlasPolicyTests` (22), `UniversityCostPolicyTests` (14), `UniversityCatalog*Tests`, `UniversityMapPolicyTests`, `UniversityGeo/PhotoLibraryTests`, `AtlasImageLoaderTests`, `CatalogTextTests`, `Favorites*`, `StudyCountriesTests`, `SingleFlightReloadGateTests`
- Real demo index/detail decode; notModified same version; only a broken envelope refuses the whole response; per-part degradation + counts recounted/logged; store: first launch no version + save body, copy first then one check per launch, notModified-other-version keeps copy + marks refresh failed, failure with/without copy, 42501 removes copy, org switch drops earlier answer.
- Search normalisation equals web on production names; city order by language; nearest intake rules; map pins only verified; photo: sized then original, object path cannot escape bucket, width steps, **only managed copy** (no hotlinks), licenses match web; loader: missing object does not disable sized variants, rejected variant with working original switches to originals; disk cache keeps exact body per org.
- Cost: no rows => no block; USD/lira rows, official/agency rows, minor units & locale, rate to 5 significant digits, grouping/order/labels like web, curator-cost phrase absent. Intake status: explicit closed, past deadline closed even if source says open, deadline today with passed time in timezone, missing timezone needs confirmation.
- Filters (legacy): empty->nil, query clamp 100, country/level domain checks; map: all pages until nil nextOffset, dedupe, non-advancing offset error, 13th page error, clustering rules.
- Shared text vectors with SQL/web (`catalog-text-vectors.json`), photo-source hosts belong to the named source.
- Favorites decode (add/remove receipts, newest first, by-ids with null nextOffset, hidden count); favourites rows have a destination in every stack.

**Country choice & timeline** - `CountryChoiceTests`, `CountryTimelineTests` (22)
- All server `source` values accepted, other shapes rejected, retry reuses request id. Timeline: every bundled file parses strictly; bundled files == repository files; selection equals web selection (parity fingerprints); unknown choice shows picker; six countries show their own timeline; verify items never shown; three disclaimers in every view; no promises/internal details/dashes in any view; no CSCA session dates in exams step; dates vanish after `validUntil`; CSCA link opens module or csca.cn; only known app screens openable; who-labels follow language; broken/duplicate-key/BOM file falls back to general route; JS-semantics text rules; digit groups only with two no-break spaces; general route names no assisted section/partner; today = Bishkek date.

**CSCA** - `CSCADecodingTests` (24), `CSCAPolicyTests` (17), `CSCAOverviewTests` (12), `CSCAHomeCardTests`, `CSCASVGTests`, `CSCATeXTests`, `CSCAStringsTests`
- Decode every fixture; nullable keys required; unknown nextStep/test kind skipped; unknown topic state fails; every lesson decodes with typed theory; unknown theory block skipped, known block with extra key fails; item projection with answer key fails; draft carries explain only for answered; save receipt says nothing about correctness; diagnostic start has no keys + server clock; mock start carries figures; timeout result not draft; review only after completion; progress & streak; report/target receipts; modules v2 keeps English separate.
- Policy: timestamp fraction kept; Bishkek days; clock from `serverNow`, ignores device time, accepts saves until deadline+grace, replayed receipt never winds clock back; countdown label; save schedule; frozen retry then newer answers; save queue refusals/server state; item timer accumulates & clamps; failure classification from real errors; session stages from real calendar; navigator states; report text rule; review intervals.
- Overview: bundled files parse strictly; equal repo files; photos match licence manifest (hash); parsed equals web parser (parity fixture); narrow subjects share facts once; every file variant gets web decision; raw file problems refused before decoding; open/collapsed rule; started only after activity; photo file follows screen scale like srcset; registration window closes-in up to 60 days; plural forms.
- Home card: only China (saved or default); nearest unfinished session; closes-in only for open window <= 60 days; summary untouched; strings in RU and KY without dashes; hidden on failure and first in the Continue group.
- SVG: all nine real figures parse; text runs keep super/subscript shifts & spaces; palette roles + dark swap; path grammar; transforms; out-of-profile rejected. TeX: segments at `$`; spoken rules; primes; every fixture formula parses in SwiftMath.
- Strings: every key has RU and KY, format arguments match, no dashes/forbidden claims.

**English learning & assessments** - `LearningDecodingTests`, `LearningRunnerDecodingTests`, `LearningRunnerPolicyTests`, `AssessmentDecodingTests`, `ProfessionDecodingTests`
- Modules/lessons/all exercise types decode; save receipts for choice/matching/short/reading; attempt with all stored answer shapes; exact answer payload encoding; review items/check; runner policy (resume position, theory only for fresh attempts, SQLSTATE classification, only network failures reuse frozen request, recovery offers re-read, matching draft rules, short answer trim+300, reading requires every question, option label fallback, prompt prefers English). Assessments: catalog, draft attempt payload, completed English result, ORVIS result, microsecond/no-fraction/Z dates, garbage not turned into dates, catalog date labels. Professions: grid + full body.

**AI consent** - `AIConsentPolicyTests` (20), `AIConsentModelTests` (16), `AIConsentSourceTests`, `AIConsentStringsTests`
- Decode not-asked/granted/declined, extra keys ignored, unknown status rejected, `currentPolicyVersion` required; set-params use contract names/values; version constant `2026-10-25`; offered only to assisted tier (self-service gets none and never reads); card asks until decided on current version; actions per state (allow/decline vs revoke); text current only when server version matches build; date only with decision; privacy link stays the Russian policy page; same choice keeps request id until server answers; model: loading -> server state, failed first read is `failed` not "unasked", refresh failure keeps decision, cancellation never leaves model loading, save sends contract + shows server receipt, failed save changes nothing + retry reuses id, rejected save re-reads and asks to update, second tap ignored, stale read cannot overwrite save. Source tests assert the exact two RPC names are the only calls and screens are tier-gated. Strings: both languages, owner copy verbatim, KY names both providers.

**Consultation / Programme** - `ConsultationDecodingTests` (open with institution, handled without, list newest first, empty). (No tests exist for packages/program documents beyond what's embedded in `ApplicationIntake*`/Admission tests; the pending stores have no hostless test target entries besides models - treat their behavior in section 3.8 as untested spec.)

**UX infrastructure** - `MotionPolicyTests` (durations equal web tokens, all within calm budget/400 ms ceiling, offsets and press scale small, stagger only first 6 cards, progress clamp, step direction, each entrance once per key), `LocalizationKeysTests` (every server status/auth message/bundle-looked-up/literal UI key has RU+KY, no interpolated key literals), `FillContrastSourceTests` (prominent buttons use solid fill, bordered use accent text, accent color never a solid fill under white text), `ThirdPartyNoticesTests` (notices == every resolved package and version, license texts ship, reflow keeps words in order, privacy link equals store listing).

Rule of thumb for the RN port: re-implement these as Jest tests on the same fixtures (copy `Fixtures/**` verbatim) before porting UI.

---

## 7. Known gaps of the iOS app vs the current web (as of main @ `2218479ee`, 2026-11-07..09)

1. **Sign-in is email-only.** Web now signs students in by a `name.surname` **login** or email (migration 340, commit `5c8ca6080`). Login -> email resolution is a *server action* (`src/lib/server/student-login.ts` -> service-role RPC `student_login_email_v1`) invoked from `src/lib/staff-auth-actions.ts`; there is **no public API route**, so a mobile app cannot resolve logins today. Needs a new bearer-less rate-limited route (or accept email-only on mobile).
2. **Registration without invite.** iOS still calls the old route `POST /api/portal/registration` (`src/app/api/portal/registration/route.ts`, handler in `src/lib/server/student-portal-intake-route-handlers.ts`) with body keys exactly `email,password,questionnaire`. The web now allows new accounts only through a one-time 7-day **personal registration link** (migration 341). Server keeps `invite === null` as "the iPhone app, which has no link field yet: unchanged until the app gets one" (`student-public-registration.ts:20-22`, handler comment :57). `invite` status maps to HTTP 403. RN must either keep that exemption (security decision) or add an invite field/flow.
3. **No consents at registration.** Web (commit `dc1029d05`, migration 345): final step has two required boxes - consent now also accepts the Privacy Policy, **consent version `2026-11-07`** (`2026-09-18` stays valid for stored questionnaires and the iPhone app), and an AI-assistants checkbox stored in metadata key `student_ai_consent_choice` and written as the student's own consent after email confirmation (`src/lib/server/student-registration-ai-consent.ts`). iOS has one `consent` toggle with version `2026-09-18`, policy link only, and AI consent asked later on Home (assisted tier only).
4. **Old design.** Web cabinet was redesigned (#1412 "по образцу Акылмана", #1340, #1416/#1417, light theme default #1132); iOS is stock SwiftUI with red accent `#D70217`, system List/TabView styling. RN app is to follow the new web design (DESIGN.md / `docs/design/v3`), not iOS visuals.
5. **Password reset bypasses membership check** (#1287): iOS calls GoTrue `resetPasswordForEmail` directly (`SupabaseService.swift:39-41`); the web path (#1195) is a server action with a membership check. Open owner decision in `docs/PLAN_CHANGES.md` (~line 61433). Recovery link opens the web page `/auth/callback` in the browser (not the app); never verified end-to-end from a real iPhone (README).
6. **No unread/polling signal**: web has `GET /api/portal/updates?s=<section>` (A4) returning count + version hash + server revision (stale-build detection); iOS never calls it (refresh only on pull / foreground / chat 30 s poll). No badge counts, no push.
7. **No push, no deep/universal links, no camera/photo-library capture** (documents only via Files picker). Invite acceptance is paste-a-link.
8. **KY translations pending proofreading** (`study-countries.json` `kyProofreading: pending`, CSCA table, AI-consent KY "awaits native reader").
9. **Web features absent on iOS**: `case_help_answer` full page (iOS shows a disclosure), `/portal/applications` and package-queue UI (`application_package_queue_v1` wrapper unused), `application_package_queue_v1`/`student_application_requirements_v2`/`student_application_documents_v1` wrappers have no caller, `/api/portal/case-files/[fileKind]`, `/auth/*` pages (set/new/reset password, signup confirmation) - handled by browser.
10. **Dead/legacy code to leave behind**: `UniversitiesView`, `UniversitiesMapView`, `UniversitiesViewModel` (+ `student_university_catalog` list RPC use), `FavoritesNavigationModel` is test-only helper.
11. Not verified on a device (README): signing, archive, upload; password-reset e2e; production Release smoke.

---

## 8. Port risks / decisions for the RN team

- **Idempotency discipline** is the contract: keep frozen request objects (id + payload + revision) per command and resend identically after transport errors; never regenerate ids on retry; deterministic UUIDv5 for notification read ids (use the web reference vectors in `AdmissionPolicyTests`/web code).
- **Two backends, two auth styles**: PostgREST with user JWT (refresh-aware) and web routes with `Authorization: Bearer <access_token>`; strip Authorization on cross-host redirects (RN `fetch` follows redirects automatically - use `redirect: "manual"` for the two download routes and fetch the signed URL without the header).
- **Multipart upload**: exactly one `file` part; app-document route additionally needs `X-EVO-Upload-Intent` (base64url of sorted-keys JSON, no escaped slashes) and sha256 of the bytes (expo-crypto) - sorted-key canonical JSON matters.
- **Strict decoders**: port the "fail closed / skip unknown kind / degrade per part" rules; consider zod schemas generated from fixtures. Share parsers with web by importing `src/lib/portal/*.ts` (country-timeline, csca-overview, csca-home-card, student-application-contract, ai-consent, messages) where they are pure.
- **Time**: all "today" logic is `Asia/Bishkek`; CSCA countdown must use a monotonic clock anchored to `serverNow` (use `performance.now()`/`expo` monotonic, not `Date.now()`); background/foreground transitions force a save.
- **Math/figures**: choose a LaTeX renderer that supports the formula subset in fixtures and test every fixture formula; SVG whitelist renderer for figures with dark palette swap.
- **Storage**: Keychain/SecureStore for session; AsyncStorage/MMKV for wizard draft (without password) and `csca_overview` choice; filesystem for index cache (cache dir) and pending-intent files (app support, excluded from backup, no bytes/tokens).
- **Android**: not present in the iOS reference - decide map provider, file picker, secure storage, privacy declarations (Play Data safety), and that no `NS*UsageDescription`/entitlements are needed unless camera/push are added.
- **Do not port**: legacy catalog list/map, the `AppleLanguages` restart workaround, `AtlasParagraph` (iOS 26 truncation bug), SF Symbol effects as-is.
