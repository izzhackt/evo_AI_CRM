# Сохранённая анкета — реальный локальный сценарий

Frozen source: `0cc1f5c7199c040ac652ae40678da13aec845ef9`, clean at start/end.
Command: `EVO_NODE_BIN=/opt/homebrew/opt/node@22/bin/node bash scripts/test-postgres-v2-foundation.sh --student-profile-fields-only`
with Node22.23.1 first on PATH. OrbStack Running/contextorbstack verified.
Browser plugin unavailable; repository Playwright/Chromium1440x1000 used.

Actual Auth → case/profile → draft → confirmed fields → final DOCX → exact POST
replay → cold browser history → historical/current file download passed. Storage
readback matched both files. The browser issued no fake routes or Auth bypass.

- Real Admin Auth, one synthetic profile, revision14; nine required fields plus
  extended/confirmed-empty values, stale editor draft and other edits preserved.
- Two persisted private DOCX artifacts, no duplicates from replay or downloads.
- Draft10817 bytes, SHA256
  `5e66f3143b6b743f5969e28017835f397efd40087e23b6a2f36b8d9965c7323e`.
- Final10849 bytes, SHA256
  `9e97a032338c77eead41f3b123f4ccd5823aa6d2255acd27ffe1a3ecb85cce9b`.
- Warm/cold downloads returned those same bytes without rendering again.
- Page identity/meaningful content/framework-overlay/interaction checks passed.
  Screenshots show current final and historical draft with separate download
  controls. Console:0 errors,1 warning whose text was not retained; it remains
  unclassified, not a claim of a warning-free console.
- Original process exited0 with `STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED` only
  after `cleanupVerified:true`. Owned app/port, local project containers/networks/
  volumes, temporary directory and lock were cleaned. No rerun was needed after
  a long Docker inspect/start delay; the original live handle completed naturally.

Receipt SHA256 `837e48f0b92c0b22e031265342b96043befe52fa80ab3e228d74c95abc8ee1dd`.
Operator-local receipt:
`output/student-profile-fields/0cc1f5c7199c040ac652ae40678da13aec845ef9/foundation-25442-55470/acceptance.json`.
Terminal receipt `01a09c8201a27093b5a2f9957faec637`; full acceptance readback
`01a09c83b1cd7d83a33af70afeeed90c`.

Limits: synthetic data, isolated001–161+164 rather than contiguous162–164 release.
No mobile, lost-reply reconciliation, Gemini, managed bucket, real client or
production acceptance. This supports the planned same-slice removal of the old
transient producer; full university forms/packages and D3–D6 remain open.

## Same-slice retirement follow-up

Independent source review approved deletion of the old transient route/handler,
tracing/tests and forward164 legacy grant revocation. The new producer/UI/template
are unchanged from the browser-proved source. Route/manifest23 checks passed
`01a09c8713f970009d49931c9c6c6270`; scoped lint passed.
Actual production build passed `01a09c91d4c07350943fe5441b3c45b0`; final app manifest
has the three document-exports routes and no profile-exports route. Template
SHA256 remains `2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0`.

Final isolated SQL passed exit0 `01a09c966f7a723381b15ba2ca4110e6`, including legacy
runtime-role/PUBLIC denial and all persisted behavior; owned container removed.
A preceding run exposed a test-only1µs expiry bound error, corrected with a shared
statement timestamp without altering production SQL or assertions. These are
matching delta checks, not a second browser proof or a production release.
