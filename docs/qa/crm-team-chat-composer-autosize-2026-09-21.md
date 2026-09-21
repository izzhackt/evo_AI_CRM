# A15b — chat composer autosize, 2026-09-21

Runtime: `1553d8b2066d466c3afb9db9f281cac3243d6936`.
Approved precode: `918c6eddad47fcb4b6dc12e41137fb5292eac136`.
Incumbent evidence: A15a runtime `10aa26179087ae9e8c87bb47c5e6747359ca3647`;
both composer/CSS files were unchanged before this slice. ROOT approved offline
implementation while B211 held the shared writer; the evidence-reuse decision
was recorded before runtime code in `381fa721`.

## Scope and result

Only TeamChatComposer.tsx and its existing textarea CSS change at runtime.
The mounted field measures its body before paint, including a restored draft or
initial edit body. A width-only ResizeObserver handles width/visibility changes,
defers its own measurement and disconnects/cancels pending work on unmount.
The borderless border-box field includes padding in scrollHeight and retains
existing CSS bounds44–160px. Text beyond the cap scrolls inside the field;
manual resizing is removed. No height animation or new visual language.

Draft keys, body/mentions/requestId/retryInput, immutable uncertain payload,
commands, pending/uncertain readonly,8000-character limit, Enter/Shift+Enter,
IME229/composition guards and focus behavior are unchanged. The existing saved
branch clears draft.body; the same sizing effect responds to that state change.
There is no SQL, Auth policy, provider, message-send or deployment change.

Impeccable Operate/refinement was applied to the current EVO/Golos interface.
Craft-floor was read immediately before editing. One batched desktop/mobile
inspection was performed; no runtime correction or extra polish pass followed.
Screenshots were inspected in tool output rather than committed.

## Scope checks

Node22.23.1, package/lock parity with existing dependencies verified and reused
through an ignored node_modules symlink:

- Scoped ESLint: **PASS**.
- Standard `next typegen` then `tsc --noEmit --incremental false`: **PASS**.
  The first bare tsc attempt lacked generated next-env/image declarations in the
  fresh worktree; standard type generation resolved it without product changes.
- Existing team-chat-mute-removal, platform-runtime-public-config and
  staff-task-context tests: **13 passed,0 failed**.
- `git diff --check`: **PASS**.

These existing unit/source tests contain doubles and are unit evidence only.
They do not substitute for the following actual Auth/UI check. No full-suite or
production acceptance is claimed. Independent source review approved exact1553d8b;
final PR head review and protected short CI are still required before merge.

## Actual unsent-composer check

ROOT released a local UI window after B211 publication. A fresh baseline was
captured from the pinned local Docker/Supabase instance before this check; it
was not compared with pre-B211 business state. The browser inherited Local Admin.
Normal sign-out/sign-in switched to the existing ordinary Local QA sales account;
no identity, role or permission was created or changed. Only the own localhost33233
server and own Chrome tab1055896616 were used.

The initial owned-tab general draft was empty. Controlled QA text was entered
through the real field, never submitted. No message/edit/delete/reaction/task or
Mark read command ran. The independently queried global history remained empty.

| Observed state | Actual CSS width | Field height | Evidence |
| --- | ---: | ---: | --- |
| Empty / one line |1280|44px|Normal editable field; one-line input stays compact|
| Shift+Enter |1280|62px|A second line; no send|
|12 lines |1280|160px|scrollHeight272px; internal overflow|
| Typing at the cap |1280|160px|scrollTop99.5px; caret visible at the last line|
| Replace with4 lines |1280|104px|Field shrinks|
| Same92-character draft |1280 /390 /320|62 /83 /125px|Width changes reflow existing text|
| Reload at320 |320|125px|Same visible draft restored and measured on mount|
| Sales channel |320|44px|Separate draft remained empty|
| Return to general |320|125px|Own92-character draft restored|
| Keyboard select-all/delete |320|44px|Actual value length0; empty Send disabled|
| IME composition / cancel |320|146 /44px|Candidate text grows the field; cancellation returns to empty|

Sizes came from actual DOM geometry after CDP Emulation overrides, not assumed
emulation request values. At the initial captures, clientWidth/scrollWidth matched
1280/1280,390/390 and320/320. After reload at320, documentElement.scrollWidth was330,
while body.clientWidth/body.scrollWidth were320/320 and no visible product element
extended beyond320. This **unresolved root-width discrepancy** prevents a blanket
post-reload no-overflow claim; the composer itself retained width190px and its
correct125px/44px heights. No unrelated shell change was made to hide the result.

IME candidate entry/cancellation used the documented
[Chrome DevTools Input API](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).
Native IME confirmation with Enter was not exercised because this window did not
authorize sends. Existing Enter/IME guards were reviewed as unchanged source.

Tooling notes: CUA `fill("")` selected existing text without deleting it, so that
attempt was not counted as a shrink pass; ordinary select-all/Backspace proved
zero-length shrink. Two post-reload locator-evaluate calls timed out while DOM
snapshots showed the field; subsequent read-only DOM geometry succeeded. The
browser also reported React130 errors from a chrome-extension toolbar; these
were not attributed to the application or expanded into this slice.

## Integrity receipt and limits

Private files under `/private/tmp/evo-database-foundation.WhSt8z/`:

- `a15b-before-ui.json`, SHA256
  `63f75884757f0344d7edb2f249e67b5eb711d7bb16f6e1f8f26ec1b21262c2b9`.
- `a15b-after-ui.json`, SHA256
  `d1cd9bc2f08e8dfa8b2b3b6ef60c510a8d2230ad53bcf2771e40dbf0ded0a8da`.
- `a15b-final-ui-receipt.json`, SHA256
  `800e78d46190bee3098f9afaaeb70d2e3d588d24b1f5b5f272bcedbe250bd536`.

The fresh before/after receipts match all281 business-table counts/hashes,
schema001–222, ledger, functions and schema metadata; runtime file hashes also
match. Auth user/identity **counts** are unchanged; session parity is not claimed
because normal login changed the browser session. Global team_chat_messages count0.
Raw QA data/credentials remain private and are not included in Git.

Own unsent text was cleared through the UI, composition cancelled, emulation
cleared, own tab closed, own server stopped and port33233 confirmed without a
listener before releasing the shared environment back to ROOT.

Actual populated reply/edit contexts, confirmed server-save clearing, pending/
uncertain network outcomes,8000-limit interaction, native IME Enter and hidden
requestId identity were **not proven** by this empty-history UI session. Their
existing source branches remain unchanged. No fake saved result, messages or
acceptance history was introduced. The rest of item15 (flat feed, quoted replies,
shared composer, contextual search and sparse seen tracking) remains separate in
EVO_TEAM_CHAT_REMAINDER_ANALYSIS_2026-09-21.md.
