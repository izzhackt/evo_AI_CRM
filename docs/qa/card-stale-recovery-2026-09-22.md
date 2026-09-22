# Explicit lead-card stale recovery — 2026-09-22

Source b22b1927: bounded ordinary Admin local UI and two-write recovery exercise completed; original harness STOPs and scope limits below.

The four lead-card sections retain their shared client revision and unsaved sibling drafts during normal independent saves. On stale/request-conflict only, the existing explicit «Обновить карточку» action now reloads the current document. This resets revision, action/request state and fields together; no revision-driven remount or automatic refresh was added. The warning explicitly states that all unsaved changes on this page will be discarded. Current URL, permissions, writer payloads and design remain unchanged.

Why: `router.refresh()` merges server output while retaining mounted client state; `useState(initialRevision)` does not reinitialize on updated props. Thus the previous recovery could continue submitting an obsolete revision. References: [Next.js useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router), [React useState](https://react.dev/reference/react/useState).

Source checks: Node 22 scoped ESLint on the two changed components and `git diff --check` passed. Existing dependencies reused from a checkout with identical package-lock; no installation, build, full suite, mocks or runtime execution.

## Minimal real local validation plan (not executed)

Use one existing authorized local QA staff identity in two ordinary browser tabs and one existing editable QA lead; ROOT must select the exact lead and authorize the finite field changes before the window. No new accounts, grants or fixtures.

1. Both tabs load the same revision. In tab A leave an unsaved sibling draft; in B save one ordinary nonfinancial card field (write 1). A submits a different card with its old revision and receives genuine stale (no successful write).
2. Read the discard warning, click «Обновить карточку», observe a real document reload at the same URL. Verify refreshed values and revision, cleared error state and newly initialized request identity.
3. In A retain a new unsaved sibling draft while saving the other card once (write 2). Verify successful recovery and that this ordinary save leaves the sibling draft intact. No second save for that unsaved draft.

Compare the selected row/revision and attributable receipts/audit against the authorized two-write budget; preserve other records and own ordinary Auth/session closure. Request-conflict uses the same explicit reload boundary but is source-covered unless an existing real condition represents it. No production/customer write, provider acceptance or full-plan completion is claimed.

## Actual bounded local result

Existing authorized Admin and existing QA lead, source `b22b1927dff602d31412de7cad6324d03ed10e04`, local schema239. First ordinary session opened two tabs, saved one nonfinancial education value and obtained genuine stale from the older tab. Clicking explicit recovery changed document timeOrigin, confirming real reload. The subsequent field assertion stopped because its expected string retained a leading space which the product correctly trimmed; the original STOP remains immutable. Raw DOM value at that assertion was not captured, so no stronger field-readback claim is made for that moment.

A narrowly corrected continuation used a new ordinary session, verified the actual normalized field and revision, restored the exact original value with the second authorized save, and confirmed an unsaved wishes draft survived this ordinary save. No first save or stale submission was replayed. Final selected-row fields exactly match baseline; revision +2, request receipts +2 and audit events +2, with two selected-lead save audits. No financial fields changed. No broad whole-database/Auth equality claim is made.

An earlier browser-launch STOP occurred before Auth because the bundled Chromium executable was absent; the installed Chrome channel was used instead, without downloads. Both owned sessions logged out locally with204 and browser contexts closed. Owned dev PIDs2737/2743 exited; port33276 refused connections; own generated build caches removed. Other runtimes untouched. Two private screenshots preserve stale/saved UI. Impeccable detector ran once on both changed components and returned zero findings.

Evidence remains private at `/private/tmp/evo-card-stale-actual-20260922/`: original `result.json`, `browser-launch-stop.json`, corrected `continuation-result.json`, selected `before.json`/`after-stop.json`/`final.json`, `verification.json`, `closure.json`, screenshots and hash manifest. This proves the bounded local path, not production deployment or all card/role variants.
