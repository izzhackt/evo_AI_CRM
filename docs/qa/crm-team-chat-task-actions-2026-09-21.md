# A15a — staff chat automatic task actions, 2026-09-21

Runtime: `10aa26179087ae9e8c87bb47c5e6747359ca3647`.
Base: main43bd20c8/#968. Precodef8a819e9 independently approved before runtime.
Contract: product UX/admissions plan §9 and the A15a appendix in EVO_LAUNCH_PLAN.
This covers the accepted task-action removal, not all of item15.

## Result and scope

Three runtime files,9 insertions/30 deletions:

- team-chat-source returns the unchanged canonical page/channels/participants,
  without auxiliary task-link batching or enrichment. Existing channel guards,
  canonical decoder and failure behavior remain.
- TeamChatMessageRow removes generated task links and Create task. Plain body
  links, message deep link «Ссылка», reply/edit/delete/moderation and focus refs
  are unchanged.
- TeamChat removes only the unused renderMessageAction callback/type/forwarding.

No SQL, package, stylesheet, DTO, Tasks route, command, realtime, draft, read-state
or Student case-chat changes. The optional linkedTaskIds field remains accepted
for old payloads. The general shell's separate Create task shortcut remains;
the accepted removal concerns actions/cards attached to chat messages.

The old source could fail the whole snapshot when task-link enrichment failed.
The new source does not make that auxiliary call. This is a source-backed
failure-coupling removal, not a measured performance or injected-failure claim.

## Actual incumbent UI before editing

Existing ordinary Local QA Sales, Chrome, own localhost33233 server. Confirmed
from source that mount/realtime/authority recheck only invoke readers; Mark read
is an explicit button, never triggered by this inspection. Actual general and
sales routes rendered successful empty histories and the existing composer.
Server output recorded GET200 and actual readTeamChatAction changes200 for both
channels. The composer was untouched; no message/task/Mark read command ran.

The fresh whole-state snapshot proved zero messages, chat preferences, change
rows, chat receipts and task-link records globally in this local database.
Therefore a populated menu/manual-link/linked-task UI path was unavailable.
No history, accounts or task links were fabricated to fill that gap.

Private a15a-before-ui.json matched the released root222 baseline; private
a15a-after-incumbent-ui.json matched all281 business tables, Auth counts,
schema/function metadata and ledger. Browser closed, ownserver stopped before
releasing the coordinator's read-only window.

## Checks after implementation

Node22.23.1 with the existing unchanged dependencies (package/lock parity with
base verified, reused through an ignored local node_modules symlink):

- team-chat-mute-removal, platform-runtime-public-config and staff-task-context:
  **13 passed,0 failed**.
- ESLint of the three changed runtime files: **PASS**.
- tsc --noEmit --incremental false: **PASS**.
- git diff --check: **PASS**.

These existing unit/source checks include test doubles and are reported only as
unit evidence. They do not stand in for real Auth/UI acceptance. No new mock,
demo path, fallback success or string-mirroring test was added. Previously
recorded unrelated knowledge assertions in v3-supabase-integration were not
rerun or changed for this slice; no whole-suite green claim is made.

## Impeccable and actual result inspection

Operate/refinement advice → preserve familiar EVO/Golos/tokens and useful
message controls; remove only the product-excluded action/dependency. Existing
incumbent UI was viewed before coding and craft-floor was read immediately
before editing. No decorative typography/layout changes were introduced.

After a separately coordinated read-only window, actual existing Sales opened
general → sales, then used mobile «Каналы» → general. Both histories remained
honestly empty; the untouched composer and disabled empty Send state rendered.
A single batched desktop/mobile inspection found no needed correction. Actual
clientWidth/scrollWidth pairs were1707/1707,520/520 and427/427, with zero message
articles at each size. Emulation requests were1280/390/320, but browser zoom
produced those larger measured CSS widths; exact CSS390/320 is **not claimed**.
Screenshots were inspected in the tool output, not added to Git. Temporary
viewport overrides were cleared and the own tab/server closed afterward.

Private a15a-before-result-ui.json pins the three runtime hashes to10aa2617.
Private a15a-after-result-ui.json proves unchanged full281 business tables,
Auth counts, schema/function metadata and ledger, and matching runtime hashes.
No server/provider/production change occurred.

## Explicit limits and remaining work

Positive populated-message/menu/manual-URL/linked-task navigation and populated
query-mode acceptance remain **unverified**, because local history is empty.
The source diff preserves those paths; that is not a substitute for positive UI
proof. No forced transport failure/retry or mutation acceptance was exercised.
Only successful ordinary Auth empty-history SSR/action reads and navigation are
proved here. Final independent exact-head reviews and protected short CI remain
separate gates. This file does not claim a production release.

The rest of item15 remains: flat chronology/quotes and historical reply/draft
compatibility, search-context restoration, real channel previews, autosize and
scroll behavior, sparse seen-message tracking. None is delivered by A15a.
