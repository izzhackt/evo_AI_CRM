# PR980: the same sign-in return for the conflict hint

This follow-up extends the source correction recorded in
`signup-confirmation-integration-2026-09-22.md`; its statement that the conflict
hint was outside the earlier slice remains a historical description of
`5c518e29f8a6cede18b0b0c18724fa6d4aa28ae9`. That head's independent review and
successful CI35680327507 are not evidence for this follow-up.

The hint is produced only by anonymous registration: outcome.conflict maps to
apply_server_conflict and sets conflictHint=true. The wizard then renders the
apply_go_to_login button inside the same SignInView full-screen cover. Its
previous action also called router.signOut without dismissing the cover.

Both sign-in buttons now use the same private returnToSignIn helper. It invokes
the existing presentation-owner callback when provided, or preserves the
authenticated router.signOut fallback otherwise. No hint visibility, model,
draft/resend, copy, layout, account/provider behavior or Auth boundary changes.
ROOT authorized this exact same-defect extension; scope was appended to both
plan journals before editing the view.

Validation is limited to Swift frontend syntax parsing for the changed view,
diff-check and independent exact-head source review/short CI. No local/native
build, runtime tap, new conflict account, Auth action, database write or email
is performed here. Actual native acceptance remains pending in the separate
ROOT-controlled QA window.
