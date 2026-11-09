# Open problems: student app and student cabinet (as of origin/main 2218479ee, 2026-11-09)

Read-only audit. Checked in worktree рабочая копия `mobile-expo`, repo izzhackt/evo_AI_CRM.
Size: S under half a day, M 1-2 days, L more. "Web" = cabinet at app.evoadmissions.com, "Mobile" = new Expo app.

## Summary table

| ID | Problem | Affects | Fix | Size | Risk |
|---|---|---|---|---|---|
| SEC-1 | `POST /api/portal/registration` creates student accounts with no invite | web+mobile (security) | require `invite` | S | low if Expo app sends the link |
| #1287 | iPhone calls Auth `resetPasswordForEmail` directly, no staff-membership check | mobile (+ direct `/auth/v1/recover`) | new public server route that reuses the web recovery logic | S-M | low |
| #1355 | two "home" pages (`/portal/home`, `/portal`) | both | one home | M | medium (smoke anchors) |
| #1356 | three ways to write to EVO | both | one chat entry | M | medium |
| #1357 | programs under five names, shown in two places | both | one name, one place | S-M | low |
| #1358 | notifications: two names, two screens | both | one name, redirect | S | low |
| #1359 | "Оплата" has no how-to-pay and no action | both | payment instructions and a chat button | M | needs owner content |
| #1360 | Profile cannot change password/phone; Logout only here | both | "My data" block, change password | M | medium |
| #1361 | two upload paths; empty document list is a dead end | both | one path, empty-state action | S-M | low |
| #1362 | 9-step signup, draft only in sessionStorage | both | account first, server draft | L | medium |
| #1363 | student login shows EN though the cabinet is RU/KY | web (mobile must not copy) | hide EN, relabel | S | low |
| #1364 | phone: chat input below the fold on `/portal/messages` | web (partly addressed by #1412) | verify, close | S | low |
| #1365 | "Add student" form (staff) | staff only, NOT student app | out of scope | - | - |
| M-1 | Login by `name.surname` (migration 340) exists only in web action | mobile | new login route | S-M | medium |
| F-1 | Admin staff password reset does not revoke old sessions | web (staff) | `admin.signOut` global | S | low |
| F-2 | Staff sign-out does not clear `evo_session_only` | - | ALREADY FIXED (b3f0f29d6) | - | - |
| F-3 | `tests/e2e/student-portal.spec.ts` stale after #1412 | test suite | update tests | M | low |
| F-4 | Chat unread state bug | - | NOT FOUND as one defect; two weak spots listed | - | - |

Other open issues from the search (portal, кабинет, студент, iPhone, iOS, регистрац, пароль, consent, согласие) add nothing beyond this list. #1371 (staff settings) and #1329 (amoCRM import) are not student-app problems. The "регистрац", "consent" and "согласие" searches found nothing open except #1360 and #1362.

---

## SEC-1. Registration without an invite (security)

**What the route does.** `src/app/api/portal/registration/route.ts:5` is `POST = createStudentPortalRegistrationHandler()` from `src/lib/server/student-portal-intake-route-handlers.ts:133`.
- It is anonymous: no cookie, no bearer, no session. `src/lib/platform-route-contract.ts:318` (`isPublicStudentRegistrationApi`) lets the proxy pass it without a session gate.
- Request gate: header `SIGNUP_CONFIRMATION_FLOW_HEADER` must equal the flow version (else 426), `Content-Type: application/json`, body of at most 16 KiB, exactly the keys `email,password,questionnaire` (`REGISTRATION_KEYS`, line ~52).
- It then calls `beginStudentSignup(email, password, draft)` at `student-portal-intake-route-handlers.ts:~166`. `invite` is not passed, so it defaults to `null`.
- In `src/lib/server/student-signup-confirmation-runtime.ts:69-75` this goes to `createPublicStudentAccount(..., invite=null, aiConsent=false)`. In `src/lib/server/student-public-registration.ts` the check `if (invite !== null)` is skipped (the comment says "`invite` null is the iPhone app"). `consume_invite` is skipped too (`const used = invite === null ? "consumed" : ...`).
- Result: `auth.admin.createUser({email_confirm:false})`, a confirmation email goes out and `claim_student_login_v1` runs. The only abuse limit is the DB RPC `reserve_student_signup_attempt_v1`, which rate-limits per address.

**Web comparison.** Since commit 5c8ca6080 (07.11, "register only by personal link") the web action `registerStudentAction` (`src/lib/student-signup-actions.ts:78-80`) returns `{status:"invite"}` when `invite` is empty, and passes `(email, password, draft, invite, true)`. The link is a 32-character token, `/apply?invite=<token>`, with only its sha256 in the DB (`src/lib/server/student-registration-link.ts`), checked by `check_student_registration_link_v1` and consumed by `consume_student_registration_link_v1`. So the personal-link rule (owner decision 07.11) is bypassed by anyone who posts directly to the API. The status mapping already has `invite: 403` (`REGISTRATION_HTTP_STATUS`).

**Who calls it.**
- The SwiftUI app in `ios/`: `ApplicationIntakeTransfer.swift:12-17,27`, `SupabaseService.swift`, `ApplicationWizardView.swift`.
- `/api/portal/registration/resend` (same handler file) takes only a signed `cap` from a prior registration, so it is not a bypass.
- The local synthetic demo stack `evo-video-demo` (docs/PLAN_CHANGES.md ~49640) registered accounts through it. That is the only non-app dependency found. No scripts, website or other backend code call it (grep over the repo, excluding node_modules).
- Tests: `tests/student-portal-intake-routes.test.mjs`, `tests/fixed-role-route-contract.test.mjs:613-618`.
- The iPhone app is not yet public (the App Store waits on the owner), so no production user should depend on it.

**Safe fix (recommended).** Do not leave it open and do not just return a bare 403.
1. Add a required `invite` string to the exact-key contract (`email,invite,password,questionnaire`). Missing or empty returns 403 `{status:"invite"}` before any Auth work. Pass it to `beginStudentSignup(email, password, draft, invite, aiConsent)`. Existing `invite: 403` mapping and `checkRegistrationLink` / `consumeRegistrationLink` do the rest, with no new SQL.
2. Add `aiConsent` as an optional boolean if the Expo app should record the registration consent like the web (web passes `true`; the route passes `false` today).
3. Remove `invite: string | null` null handling in `createPublicStudentAccount`, or make `null` throw, so the bypass cannot return.
4. Update `ApplicationIntakeDecodingTests` / `student-portal-intake-routes.test.mjs` and the comment at `student-portal-intake-route-handlers.ts:~64` ("never comes from the app").
5. The Expo app needs a way to receive the link: universal link / deep link on `/apply?invite=` or pasting it. A tiny public "check link" call is optional (`checkRegistrationLink` already returns `displayName` for a greeting).
6. Fastest stop-gap before the Expo release: make the handler return 403 `{status:"invite"}` for every request (one-line change). Note the old SwiftUI app and the demo stack then cannot register. That is acceptable because the iPhone app is unreleased, but the `evo-video-demo` seed would need a link.

**Affects:** web (the same backend), mobile. **Size:** S. **Risk:** low; only unreleased iOS builds and the demo script break.

---

## #1287. Password reset from the app skips the staff check

**Web action** `requestStudentPasswordRecoveryAction` (`src/lib/student-password-recovery-actions.ts:~60-90`), all steps:
1. `exactActionStringFields(form, ["email"])` plus `studentOriginRequest()` (Origin/host check): if either fails, `unavailable`.
2. `normalizeStudentRecoveryEmail`: bad email, `invalid_email`.
3. `admitStudentRecoveryRequest(x-forwarded-for, email)` (`src/lib/server/student-password-recovery.ts:213-227`): in-memory limiter per IP then per sha256(email). `ip_limited` returns `rate_limited` at once; `address_limited` returns neutral `sent` without work.
4. `requestStatus(email)` builds `redirectTo = studentInviteCallbackUrl(...)` (fixed student origin callback, `/auth/callback`) and calls `requestStudentPasswordRecovery` (`student-password-recovery.ts:254`) -> `runStudentRecoveryRequest` (`src/lib/server/student-recovery-request.ts`):
   - `findRawAuthUserByExactEmail` -> migration 314 RPC `platform.auth_user_by_exact_email_v1(p_email)` (service_role only; exact-email point lookup; NULL if none, 21000 if ambiguous).
   - If the user has the staff marker (`evo_staff_password_request_id` / `evo_staff_invitation_request_id`) -> staff.
   - Else RPC `platform.auth_user_has_staff_membership_v1(p_auth_user_id)` (service_role only; TRUE if any membership in any status whose role is not `student`, including role NULL).
   - Staff -> no email, answer neutral `sent`. Unknown / student -> `isolatedClient().auth.resetPasswordForEmail(email, {redirectTo})`. The membership-lookup failure also answers `sent` and sends nothing; an address-lookup failure answers `unavailable`.
5. `answerAtFixedDeadline` (`student-password-recovery-timing.ts`) holds every post-admission answer to `STUDENT_RECOVERY_RESPONSE_DEADLINE_MS = 1500` ms from start. The work continues after a missed deadline; the answer is `sent`.
6. The email link opens the web `/auth/callback` interstitial (CSRF-bound POST), then `/auth/new-password`. The new password is set in the browser, so the mobile app does not have to handle the recovery token at all.

**Does a server route for mobile exist?** No. `ls src/app/api/portal` shows only application-document-downloads, application-document-uploads, case-files, document-slots, document-versions, invite-acceptance, registration, updates. The old iOS app still calls `client.auth.resetPasswordForEmail` directly (`ios/EVOAdmissions/Services/SupabaseService.swift:39-41`), the exact gap #1287 describes.

**Proposed route** `POST /api/portal/password-recovery`, body `{email}` (exact key), public like registration:
- Add the path to `isPublicStudentRegistrationApi` in `src/lib/platform-route-contract.ts:~318` (or a sibling function) and to `tests/fixed-role-route-contract.test.mjs`.
- New handler beside `createStudentPortalRegistrationHandler` with injected ports. Same gate shape: version header (426), JSON content-type (415), bounded body, exact keys. Native clients send no `Origin`, so the web `studentOriginRequest` check cannot be reused; the header + exact contract + rate limits are the boundary.
- Logic = the web action body: `normalizeStudentRecoveryEmail` -> `admitStudentRecoveryRequest` -> `requestStudentPasswordRecovery(email, redirectTo)` held by `answerAtFixedDeadline(..., 1500)`. Neutral response `{status:"sent"}`; only `rate_limited` (429), `invalid_email` (400) and `unavailable` (503) differ. `requestStatus` is a private helper in the actions file: extract it to `src/lib/server/` so both callers share it.
- Mobile then shows "Check your email" and the link opens the web page.
- Caveat 1: the limiter is in-memory per process (`requestLimiter`); the IP key comes from `x-forwarded-for`, so confirm the edge sets it truthfully. Caveat 2: the route does NOT close direct `https://<supabase>/auth/v1/recover` calls (the issue's variant 2 limit). Full closure is the Send Email hook (variant 1) or restricting `/auth/v1/recover` at the self-hosted gateway to the server; that is a separate decision, record it in `docs/PLAN_CHANGES.md` (the issue's acceptance criterion).

**Affects:** mobile, and the direct-API hole affects web. **Size:** S-M. **Risk:** low (logic reused unchanged).

---

## Student cabinet issues (all verified against code in the issue text; files are the issue's cited lines)

Each of #1355-#1361 is a UX/IA defect in the web cabinet; the Expo app mirrors `/portal`, so the mobile build should implement the fixed version, not copy the defect. Since #1412 (commit 84bc5151e, 09.11) the phone shell changed: `PHONE_TABS = ["/portal/home","/portal","/portal/documents","/portal/messages"]` (`src/components/portal/Shell.tsx:~105`), a left drawer replaces the old "Ещё" sheet, and "Входящие" is a messenger-style list. Some text in #1355/#1364 is therefore partly outdated.

- **#1355** Two home pages: login goes to `/portal` (`student-portal-auth-actions.ts:146`, `student-signup-actions.ts:97`), whose "next step" card was removed (`OverviewView.tsx:48-76`); the real "Что сделать сейчас" lives on `/portal/home` (`HomeView.tsx:154-203`). Fix: one home with the next-step card; "Вузы"/"Программы" below as "Мой список"; drop the "Поступление" menu item; phone tabs Home / Documents / Inbox. Mobile: build one Home screen from `HomeView`'s data. Risk: Shell comment says `a[href="/portal"]`, heading and entry-after-login are frozen smoke anchors (`scripts/release/evo-production-browser-smoke.mjs`), so change them in one PR with the smoke script. Size M.
- **#1356** Three ways to message EVO (Inbox chat; "Вопрос куратору" `portal/page.tsx:59`; "Записаться на консультацию" `profile/page.tsx:203`, `universities/Detail.tsx:239`). Fix: single chat; consultation as a button in chat. Mobile: implement chat only plus one "request a call" action. Size M; needs backend decision on whether the one-off question (`CaseHelpWorkspace`) merges into the chat thread.
- **#1357** Programs: five names; one `PreparationList` in two tabs (`portal/page.tsx:92,100`, `documents/page.tsx:72-85`; `i18n.ts:1533,1543,2416-2429`). Fix: "Мои программы" everywhere, one place, button "Добавить в мои программы". Size S-M, low risk (strings and one tab).
- **#1358** Notifications: bell goes to `/portal/messages?view=updates` (`PortalNotificationUpdates.tsx:90`) but the detail pages link to `/portal/notifications` (`notifications/[id]/page.tsx:37`, `document-notifications/...:30`, `package-notifications/...:18`). Fix: redirect `/portal/notifications` and repoint the links; one name. Mobile: single notification list. Size S, low.
- **#1359** "Оплата": no how-to-pay, no "Я оплатил" (`PaymentsView.tsx:28-112`), word "Начисления" (`i18n.ts:1638-1640`). Fix: per-payment instructions or a bank-details block plus "Написать куратору". Needs owner content (requisites, text); never invent them. Size M. Money-adjacent: no payment execution in the app.
- **#1360** Profile has no edit/change-password/logout-in-menu (`profile/page.tsx:152-240`; `Shell.tsx:69-90,108`). Fix: "Мои данные" block; "Сменить пароль" sends the same recovery email (can use the new route from #1287); phone number edit through a curator request or direct update; Logout in the drawer. Mobile gets this for free if it implements Profile properly. Size M. Risk medium: phone and email edits touch Auth identity, so check the Auth changes (email must go through Auth confirm, not a profile field). A password change inside a session should use `updateUser({password})` after re-auth; password rules are 12 to 72 bytes (`student-public-registration.ts`).
- **#1361** Two upload paths and a dead-end empty list (`DocumentUploadDialog.tsx:36-76`, `DocumentsView.tsx:44-56,149-155`, `documents/page.tsx:61`; see #843). Fix: row-level "Загрузить" only, empty state "Написать куратору". Note mobile uploads use `/api/portal/document-slots/{id}/versions` (bearer, already in the route contract at `platform-route-contract.ts:~113`). Size S-M.
- **#1362** Signup: 9 steps, account at the end, draft only in `sessionStorage` (`ApplicationWizard.tsx:134,138,155`), 12-character password rule without hint (`i18n.ts:420,426,452,458,2015`). Fix: create account first (name, phone/email, password), keep the draft on the server, continue from any device; merge "Образование" and "Ступень". On mobile use persistent storage for the draft at minimum. Conflicts with SEC-1: with the invite rule, the account is still created only with a valid invite. A server-side draft must not be allowed before account creation. Size L. Risk medium: auth, PII.
- **#1363** `/login` shows RU/KY/EN (`login/page.tsx:135`, `LangSwitcher.tsx:11`, `i18n-data.ts:1`), cabinet is RU/KY only (`portal/i18n.ts:5-9`), labels "Email или логин" / "Войти в CRM" for students (`login/page.tsx:41,69,115-117`). Mobile: RU + KY only. Fix on web: show RU/KY on the student host, "Войти" without "CRM". Size S, low.
- **#1364** Phone chat input off-screen. The issue was filed before #1412, which changed the phone Inbox to list-then-chat (`messages/page.tsx`: `data-open`, `paneOpen`, back arrow) and `useMarkCaseChatRead`. Check at 375 px before doing anything; likely resolved or reduced. Not a mobile-app concern (the Expo chat has its own keyboard-avoiding layout). Size S.
- **#1365** "Add student" (staff UI: `AddStudentDrawer.tsx`, `admissions-direct-student-contract.ts:368-407`). Not part of the student app or cabinet. Excluded.

## M-1. Login by name.surname missing in the app

Migration 340 / commit 5c8ca6080: students sign in with a login (`name.surname`) as well as an email. The mapping `student_login_email_v1(p_login)` is called only on the server (`src/lib/server/student-login.ts`, used by `staff-auth-actions.ts:63`), so the browser never sees the email. The SwiftUI app signs in by email only (`SupabaseService.swift:32 signIn(email:password:)`). Expo needs one of: (a) email-only login (simplest; `.Email` field), or (b) a public route `POST /api/portal/login-resolve` that returns a session. Do NOT return the email to the client; the web deliberately hides it. Prefer (a) for v1, or (b) returning tokens from a server-side `signInWithPassword` with rate limits. Size S-M. Risk medium (enumeration and brute force; reuse the web's neutral error and limits).

## F-1. Admin password reset does not revoke sessions: CONFIRMED

`src/lib/server/staff-workspace-service.ts:~95-135`: the `recovery` branch is only `authClient.auth.resetPasswordForEmail(receipt.email, {redirectTo})`; the `password` branch only `admin.createUser`. No `admin.signOut(jwt, "global")` and no session/refresh-token revoke anywhere in that file or in `src/lib/staff-account-actions.ts` (`setStaffPasswordAction` signs out only `scope:"local"`, line 58). Same for the student reset at `student-password-recovery.ts:~402-423` (calls `updateUser({password})` then `admin.updateUserById`; no global sign-out). So a stolen session survives a password reset. Fix: after the password is changed (staff `setStaffPasswordAction` / student `setStudentRecoveryPasswordAction`), call `auth.admin.signOut(accessToken, "others")` or `"global"`; for admin-initiated recovery, revoke the target's sessions at the time of the reset request through a service call (needs the user id; `auth_user_by_exact_email_v1` gives it). Size S. Risk low; side effect: user is signed out on all devices (expected). Affects web (staff + students) and mobile sessions too. Note supabase-js has no "sign out another user" admin API except `admin.signOut(jwt)`, so for the target-user case a small SQL function on `auth.sessions` (service_role) may be needed: verify before choosing.

## F-2. Staff sign-out does not clear `evo_session_only`: NOT PRESENT (already fixed)

`src/lib/staff-auth-actions.ts:173-181` `logoutStaffAction` has `(await cookies()).delete(SESSION_ONLY_COOKIE)` in `finally` (added in b3f0f29d6, 2026-11-06, "split sign-in page with remember-this-device choice"). The cookie is set at `staff-auth-actions.ts:92-94` and read in `src/proxy.ts:230` and `src/lib/supabase/server.ts:31`. Minor leftover: the other staff `signOut` calls (`staff-auth-actions.ts:105,118,149` failed sign-in paths; `staff-account-actions.ts:35,58`) do not delete it, and `logoutStudentPortalAction` (`student-portal-auth-actions.ts:187-195`) deletes only the admin-preview cookie. Harmless because the flag is only set by staff login, but cheap to tidy. Mobile: not affected (no cookie).

## F-3. `tests/e2e/student-portal.spec.ts` stale after #1412: CONFIRMED (by reading, not run)

The file (934 lines, last touched in 1caa7716b / fd9c261ba) still assumes the pre-#1412 shell:
- `:507-549` test "every mobile Portal section is reachable ... from the tab bar and «Ещё»" looks for a button `name:"Ещё"`, `aria-expanded`, Escape-returns-focus; the sheet no longer exists (Shell.tsx comment: "Прежний лист «Ещё» больше не нужен"; phone has 4 tabs + a left drawer).
- `:507` and `:565-585` use `navigation.locator('a[href="/portal/home"]')` with `toHaveCount(1)`, but the Shell comment says that since #1412 there is a second identical `a[href="/portal"]` in the bottom bar hidden on wide screens, so strict "one link per section" counts can fail.
- `:206` `getByRole("img",{name:"EVO Admissions"})`: #1412 added a white logo on the dark menu, so the name may now match two images (strict-mode violation). `:~650` the "dark logo plate" test uses `.pt-topbar-logo` (changed by #1412, `EvoLogo.tsx`, `evo-logo-on-dark.png`).
- `:625,648` the theme toggle location is documented as "bottom of the rail / top bar" and was moved.
- Smoke commit 2218479ee ("смоук кабинета кликает видимую ссылку «Поступление»") shows the same effect in the release smoke.
Fix: rewrite those tests for drawer + 4 tabs, scope selectors to the visible nav, update logo/theme selectors. Needs a run against the real stack, which I did not do (read-only). Size M. Risk low (tests only). Per AGENTS.md, no CI runs this suite, so it will not fail visibly; it is a latent gap.

## F-4. Chat unread state bug: NOT FOUND as a specific defect

Looked at `src/components/portal/messages/useMarkCaseChatRead.ts`, `MessagesThread.tsx:82`, `InboxList.tsx`, `Shell.tsx:271-332`, `messages/page.tsx`. #1412 already changed the main bug in this area: a hidden chat (the phone's list view, a background tab) no longer marks messages read (`getClientRects().length === 0` guard, line 18). What remains:
1. The chat row in `InboxList` has no unread count; the only badge (`unreadCount`, `InboxList.tsx:49`) is the number of unread notifications on the "Что нового" row, and the Shell badge on "Входящие" (`Shell.tsx:311`, `unread` from `PortalNotificationUpdates`) is also notification-based. New curator chat messages show up only through their notification, so if a chat message does not create a notification, the student sees no unread chat. For the Expo app, define unread from the chat RPC (cursor vs. last read), not from notifications. Verify what `markPortalCaseChatReadAction` clears.
2. `markAllInboxUpdatesReadAction` (`messages/page.tsx:25-35`) loops one server action per notification (N round trips, partial progress on failure).
Neither is confirmed as the reported bug. Ask the owner for the repro (which screen, what was expected) before fixing. Size S-M once reproduced.

---

## Suggested order for the Expo build
1. SEC-1 (invite required) and #1287 (password-recovery route): server-side, ship before the Expo app goes to TestFlight; they are the two contracts the app depends on.
2. M-1 decision (email-only or login route).
3. Build the app on the target IA of #1355/#1356/#1357/#1358/#1361 (one home, one chat, "Мои программы", one notification list, row-level upload), and #1360 (profile data, change password, logout), #1359 only with owner-supplied payment text.
4. Web follow-ups in parallel: #1363, #1364 check, F-1, F-3.
5. #1362 (signup restructure) last; it is L and interacts with SEC-1.

Uncertain items: whether a hosted `/auth/v1/recover` restriction is feasible at the self-hosted gateway (not checked); the exact current text of #1364 after #1412 (not rendered); F-3 not executed.
