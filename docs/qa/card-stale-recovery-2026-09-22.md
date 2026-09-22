# Explicit lead-card stale recovery — 2026-09-22

Source change; actual local UI acceptance pending the ROOT-coordinated window.

The four lead-card sections retain their shared client revision and unsaved sibling drafts during normal independent saves. On stale/request-conflict only, the existing explicit «Обновить карточку» action now reloads the current document. This resets revision, action/request state and fields together; no revision-driven remount or automatic refresh was added. The warning explicitly states that all unsaved changes on this page will be discarded. Current URL, permissions, writer payloads and design remain unchanged.

Why: `router.refresh()` merges server output while retaining mounted client state; `useState(initialRevision)` does not reinitialize on updated props. Thus the previous recovery could continue submitting an obsolete revision. References: [Next.js useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router), [React useState](https://react.dev/reference/react/useState).

Source checks: Node 22 scoped ESLint on the two changed components and `git diff --check` passed. Existing dependencies reused from a checkout with identical package-lock; no installation, build, full suite, mocks or runtime execution.

## Minimal real local validation plan (not executed)

Use one existing authorized local QA staff identity in two ordinary browser tabs and one existing editable QA lead; ROOT must select the exact lead and authorize the finite field changes before the window. No new accounts, grants or fixtures.

1. Both tabs load the same revision. In tab A leave an unsaved sibling draft; in B save one ordinary nonfinancial card field (write 1). A submits a different card with its old revision and receives genuine stale (no successful write).
2. Read the discard warning, click «Обновить карточку», observe a real document reload at the same URL. Verify refreshed values and revision, cleared error state and newly initialized request identity.
3. In A retain a new unsaved sibling draft while saving the other card once (write 2). Verify successful recovery and that this ordinary save leaves the sibling draft intact. No second save for that unsaved draft.

Compare the selected row/revision and attributable receipts/audit against the authorized two-write budget; preserve other records and own ordinary Auth/session closure. Request-conflict uses the same explicit reload boundary but is source-covered unless an existing real condition represents it. No production/customer write, provider acceptance or full-plan completion is claimed.
