# PR980: main integration and native return to sign-in

This is source integration and a narrow navigation correction. Native runtime
acceptance remains pending; this receipt does not replace the earlier local
web/API receipt or the stopped native logout check.

Inputs:

- Registration branch: `145047927dc14f80bf72bb438f1ce3e652132af1`.
- Main: `ac165cf992ea418c2a11745590a5dadb443e9d6f`.
- Explicit PR1026 dependency: `98d46259072822d4ebe73cd43799504caeb2bec4`.
- The scope was appended to both plan journals in `fcec3a83` before integration
  or UI code changes. Main integration is `b9cbf8b1`; PR1026 integration is
  `c53b52bc`.

## Resulting behavior

The anonymous wizard is presented by SignInView as a full-screen cover. Its
confirmation button previously called signOut while the router was already
signed out, leaving the cover visible. SignInView now supplies an explicit
onSignIn callback that sets its existing presentation binding to false. The
same sign-in form becomes visible, without an extra Auth request.

Callers that do not supply that callback retain the existing router signOut
path. PR1026 keeps its explicit local session scope. The wizard model, draft
persistence, resend capability lifetime, disabled state and 44pt button target
are unchanged. The conflict-hint action and other authenticated callers are
outside this correction and retain their existing behavior.

Impeccable was applied to the action/state transition using the native iOS
guidance. No visual theme, translations, copy, typography or layout was changed
by the navigation fix.

## Integration preservation and checks

- Both append-only journal histories were preserved with the complete main
  prefix, followed by each branch's additions. PR1026's current ledger and
  historical native STOP/contract documents remain intact.
- The localization merge adds all 11 registration keys to main's full catalog.
  Main's 105 new keys and three prep_review corrections are preserved; there
  were no semantic JSON conflicts and no registration edits to prior keys.
- Service and route-contract changes merged together; registration/resend,
  document APIs and the explicit local sign-out dependency are retained.
- `xcrun swiftc -frontend -parse` passed for ApplicationWizardView.swift,
  SignInView.swift and SupabaseService.swift. This checks syntax, not types,
  linking or runtime behavior. JSON union assertions and `git diff --check`
  passed. Independent review and CI must refer to the resulting exact head.

No build, dependency installation, Simulator launch, QA/Auth mutation, email,
database execution or deployment was performed in this slice. No screenshots
or real native interaction are claimed. PR980 remains draft until its separately
authorized native confirmation journey and outstanding acceptance are complete;
ROOT owns merges, the shared QA window and release decisions.
