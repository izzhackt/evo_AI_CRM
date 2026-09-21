# A15f: source implementation of the unified chat feed

Status: implementation in draft PR#992; independent implementation review and
actual browser/application acceptance remain pending. This document is not a
runtime, migration, deployment or visual acceptance receipt.

Base: main115b895a55b4c8e9994f41a1289c09f1ffe676ac (PR#987). Precode97a18b8f
received independent approval before implementation. A227's earlier API/SQL
proof remains evidence for its unchanged backend only. No SQL, RPC contract,
permission, global style, AppShell or external provider change is included here.

## Implemented source path

- The authenticated page reads the V2 timeline/context and keeps validated public
  realtime configuration. The old `readV3TeamChat` function remains available for
  V1 changes/search/metadata callers.
- One chronological range renders roots and replies; direct quotes point to the
  current original. A version-aware cache is separate from the displayed range.
  Unknown V1 change identities are hydrated through V2 before entering a range.
- One composer handles new V2 posts/direct replies, V1 edits and recovered V1
  drafts. Session storage is scoped to the same organization/member/channel;
  recovery never auto-sends or rewrites a record on read. Unknown submissions
  freeze request ID, body, mentions and target. Missing edit versions and edit
  conflicts use an explicit current-text preview and resume action.
- Search is channel-local and plain-text highlighted. Context navigation keeps
  result pages, query, anchor and focus for return. Before/after pages extend one
  boundary; latest replaces the range. Visible-message anchors survive source
  updates and viewport resize; actual scroll behavior still requires the browser.
- Edit uses the shared composer. Delete/moderation retains its separate original
  operation outside the changing message range, including an unknown result and
  moderation reason. Confirmed write success is separate from refresh failure.
- Sparse seen uses 500ms stable body visibility with the agreed height threshold,
  active visible document, unobscured body hit-test and exclusion of search,
  quotes, own/deleted text, channel layers, open menus and dialogs. At most50 IDs
  are queued; only a complete server acknowledgement refreshes unread metadata.
  Errors retain the bounded batch for explicit retry. No legacy read command is
  issued. Revocation stops future work and clears protected visible state.

## Focused source validation

Node22.23.1 with unchanged package lock86fc8affba3bce2c732ea4e1c5b51b9f34601819b6ffab9eee6b950b7ec570e0.
The isolated worktree reuses matching dependencies through an ignored symlink.

Commands used:

```sh
node --experimental-strip-types --test tests/team-chat-feed.test.mjs tests/team-chat-drafts.test.mjs tests/team-chat-mute-removal.test.mjs tests/platform-runtime-public-config.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/components/v3/team-chat src/lib/team-chat-feed.ts src/lib/team-chat-drafts.ts src/lib/v3/team-chat-source.ts 'src/app/(v3)/v3/team-chat/page.tsx' tests/team-chat-feed.test.mjs tests/team-chat-drafts.test.mjs tests/team-chat-mute-removal.test.mjs tests/platform-runtime-public-config.test.mjs
git diff --check
```

The existing public-config isolation tests still use their original test doubles;
they establish the public configuration boundary only. The new pure tests cover
cache/range/version behavior and frozen/legacy draft handling. None of these
checks substitutes for actual Auth, database, browser, keyboard or assistive
technology verification. Exact command results and source hashes accompany the
implementation commit in the local source evidence manifest.

## Next acceptance boundary

ROOT owns the shared local runtime. This source work made no database, Auth,
Storage, application HTTP, browser or app-server calls. ROOT subsequently reported
PR#991 merged at82260fdc and runtime handed to B228, followed by ROOT229. A15f
may use runtime only after ROOT allocates its window and allowed message/seen
effects are pinned. The coordinator remains the authority for the next slot.

The accepted A15f plan retains the actual journeys: old replies/deep links;
more-than50 message paging; reply-to-reply and current edited/deleted quotes;
recovered V1/frozen V2 attempts without duplicates; IME/Enter/autosize; search
return; scroll/resize; storage errors; successful sending followed by failed
refresh; and A→skipB→C seen with B remaining unread after reload. Compare real
light/dark desktop and320/390px in one batched Impeccable round, then one fix batch
and at most one confirmation. No native iPhone or screen-reader success claimed.

A15g grouping/density and full channel preview/time projection remain separate.

## Independent source review correction

Review of6914fc67 requested one P2 correction: a late transport rejection could
replace the terminal forbidden state and remount the editor. Failure reporting
now ignores responses after revocation, and cache commits also stop. The ordering
regression invokes the actual component callbacks with an isolated deferred
transport: it fails before the fix, then proves the editor stays absent and the
private realtime effect does not reconnect. This is unit evidence, not browser
or database authorization proof. The focused set now passes19/19; delta ESLint,
TypeScript and diff check pass. Independent delta review and actual UI remain.
