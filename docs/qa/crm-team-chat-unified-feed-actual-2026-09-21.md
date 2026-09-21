# A15f: actual local unified chat UI — 2026-09-21

Source: e1250b584a74af42a598db7ffcc4a00cf40f1838 (PR #992), integrated with main e5709f1344b3cb9160d0ba12378c2021a08877d3. Local schema 001–230, 287 business tables. Ordinary existing Sales and Admin accounts in the previously authorized isolated QA organization. This is technical local acceptance, not production, customer or native iPhone acceptance.

## Observed application behavior

- Five new posts through the actual UI: recovered unfrozen V1 root A; V2 root B; direct reply D to A; reply E to D retaining root A; V2 root C sent with Enter while Admin read A. Shift+Enter created the exact second line of D. No extra post was used to replace a failed scenario.
- Legacy edit recovery without a version prevented immediate submission. The explicit current-text preview showed D's actual text; continuing generated a fresh request and expectedVersion1. Saving advanced D to2; Sales-own confirmed deletion advanced it to3. E remained, and its quote updated to the edited text and then the deletion label in both actor views.
- Frozen V2 E retry after D deletion returned its original receipt/version1. The historical V1 retry used its original actor/request/body and returned the original message. Full 287-table state, catalog and inherited ROOT effect snapshots were identical before/after both retries.
- Admin read A and C while B remained unread above the unchanged legacy read floor. Actual body geometry/foreground/focus observations and server seen acknowledgements were captured. Search result/quote previews did not introduce seen markers. The count remained52 after reloading C; search query, results and focus survived return. D's later deletion is separately recorded.
- Latest history50 →64 unique rows; search `LOCAL`50 →61 results. Retained historical root/reply permalinks focused the correct row. Quote context returned to the original quote focus and64-row loaded range. No direct legacy mark-read command was issued.
- One composer remained in all tested views. Unsent typed draft survived reload; textarea height was160px for long text and44px empty. Enter/Shift+Enter used real key actions. Unknown replay inputs were readonly and retained their original request IDs.
- Owned-browser offline mode caused a real failed search request and visible error; restoring the connection returned the actual empty result. No successful response was mocked. A confirmed post followed by an intentionally failed *post refresh* was not separately tested.
- One batched Impeccable pass inspected desktop1440px and mobile390/320px, populated/empty/error screens, focus and both OS/theme preferences. No horizontal viewport overflow; one composer remained reachable. Existing V3 deliberately forces its light color scheme under a dark preference; this does not establish a separate dark design. Browser dev-tools badge is development chrome.

## Scoped findings and limits

The read/search transport error uses generic copy about an uncertain write and saved draft. Recovery works, but that explanation is misleading for a read-only search. Record a copy refinement in A15g alongside its separate grouping/density/channel-preview work; no claim that all chat UX is finished.

Not exercised here: native iPhone, screen reader, native OS IME, real permission revocation, moderator deletion, real storage-quota exhaustion, and a dedicated loading-state screenshot. Existing source/revocation unit evidence remains source evidence only. Public config isolation tests retain their existing test doubles; browser/Auth/database proof above uses the actual local application path.

## Data and cleanup

Seven unique UI command receipts were captured: five posts, one own edit, one own deletion. Saved snapshots show deltas +5messages/+2quote mappings/+7changes/+7receipts/+7audits/+4seen, with all281 unrelated full business tables equal, complete schema/catalog equal, preferences/read floors equal, every prior seen tuple retained. The additional seen tuples belong only to Admin and A/C/E plus one finite historical reply; B is absent.

Ordinary UI logout completed for both own sessions. The after-logout snapshot retains all224 inherited session IDs/full-row hashes including ROOT's orphan, with both own sessions absent. Refresh and identity row hashes equal the baseline; Auth users/identities count8. Two user-row hashes changed during ordinary logins; exact field attribution is unverified. Full business state/catalog are equal before/after logout. Both named browsers closed, Next launcher and browser PIDs absent, loopback33242 no listener, own saved token states removed.

The Mac filled its disk after the successful after-logout snapshot. New shell launches failed with SQLite shared-memory I/O errors and OrbStack's socket disappeared. Existing Next session was stopped via Ctrl-C; named browsers were closed through the alternate Node process path. Only coordinator-authorized disposable build/dependency directories were removed, with no source, Git, evidence or protected dependencies removed. Recovery is a distinct environment epoch.

## Final read-only reconciliation and release

After ROOT reviewed the separate recovery adapter, one final repeatable-read,
read-only SELECT verified the recovered database. Full state/catalog/inherited
ROOT effects exactly match the saved after-logout snapshot. The frozen verifier
confirmed all original rows, exact new message bodies/versions/quote relationships,
seven actor-bound canonical receipts/audits, and finite seen tuples. PASS.

The window is released to ROOT995. DB container/network/config are unchanged;
the new DB StartedAt is `2026-09-21T09:47:45.070484085Z`, Kong StartedAt
`2026-09-21T09:47:45.704057585Z`. Earlier UI/Auth evidence retains its pre-recovery
epoch. No post-recovery Auth, browser, Next or business write was performed.

Private evidence directory: `/private/tmp/evo-a15f-ui-e1250b58`; credentials
excluded. Durable review pins:

| Evidence | SHA-256 |
|---|---|
| Final full observer | `ae9b4b65dea90c0a74a0ed30bceb3e5d99fe1d937f1efed2cd081c5d4d39f989` |
| Saved-data reconciliation | `4c73384aa031fad8454f4ed855a2fbedf12798ff6d09ee2e197e5e132a3359d1` |
| Released receipt | `01b3c17b9331fbddb4f6da7eac6972c2f5fbfbefc699cc3f1460ebce0678cb51` |
| Own closure | `6907c40eead81238848d224936c70fb1e225a619231781a4db0f04de208a1d96` |
| Frozen pre-recovery manifest | `316162dd5759de1981a5a62b23b14aa8e8870fe6ecf09120dc185474878e3f9c` |

The later integration of main `47d4a4746` adds independent website/package work;
all13 chat implementation/test files and package/lock remain byte-identical to
the actual UI source `e1250b58`. That integration is not a new browser run.
A15g and the full first36 product plan remain open; no deployment is included.
