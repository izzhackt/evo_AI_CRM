# CRM sidebar — partial local UI evidence, 2026-09-21

PR #1010 remains draft. Product/source `32f50df4f3e386911816b442e6871beb8591e54d`
was exercised with the existing ordinary Admin on isolated local schema001–235.
This report does **not** grant full UI acceptance or production delivery.
The navigation key and its19 passing tests are described in the [source proof](crm-sidebar-destination-state-source-2026-09-21.md).

## What actually ran

The first batch completed1440 calendar Next month/Back/Forward/Week/back,
retained both disclosure choices, checked the active destination, and reached
390. Its1440 screenshot shows the existing EVO shell and calendar. At390 the
Next month/Back/Forward assertions completed; Week then timed out because the
script had reopened the mobile sidebar over the target link. This was an
incorrect action sequence in the script. No product edit followed.

One independently reviewed confirmation explicitly closed the real mobile menu
before that content click and preserved the earlier screenshot/STOP. It stopped
at1440 on the same-document guard, before any confirmation screenshot. A single
read-only observation after the stop recorded a document navigation to the next
month. Its cause is not established; neither hydration failure nor a product
regression is claimed. Matching disclosure state alone did not override that
guard. Remaining390 branches and320 were not completed.

The two visual attempts are preserved. There is no third visual/polish round,
no replacement screenshot, forced click, native-fallback success or automatic
retry. All unchanged source tests are reused at their original revision.

## Resource closure

The final observer and verifier passed: all290 business tables, catalogue and
effects stayed unchanged; all33 Auth/Storage projections were reconciled. Incoming
sessions, refresh tokens and AMR rows were restored. The only allowed differences
were this Admin's ordinary sign-in metadata and two login/logout audit rows.
Own local logout returned204. The owned browser, server process/group and port
33254 were closed; user port33216 was untouched. The captured own token file was
removed after reconciliation. Intentional Ctrl-C produced launcher exit1; exact
process/port closure was proved separately and was not relabelled exit0.

Resource release to B32 is PASS; product acceptance is still incomplete.
Private evidence digests: fresh before `dc90cb19`, final `4cd13328`, strict verifier
`3a153e3d`, resource release `6f6ff7ed`; independent saved-evidence diagnosis
`1ff02f8f`. Original files remain private and immutable.

## Remaining bounded functional check

The independently reviewed plan `93841526` / review `aee13ab1` keeps the original
client-navigation guarantee and fills only the missing390/320 branches after
B32 → B1006 releases the shared environment. It adds no visual captures or style
changes. Fresh source/runtime/ordinary-actor binding and final closure remain
required; this prepared plan is not an executed result.

- Use one initial calendar entry before control state; no repeated goto between
  viewport sizes. Close the real mobile overlay before content clicks.
- Observe the actual trusted Link click without cancelling it or changing router,
  history or browser behavior. The installed Next Link calls preventDefault on
  its client path; pair that observation with exact URL/period, unchanged
  performance.timeOrigin and no main-document request. Content aria-busy=false
  only means the calendar has settled; it does not prove Link hydration.
- Finish390 Week/back, Escape/focus, reopen, same-destination close/preserve and
  different-destination close/reset. Keep the already completed390 month checks
  as historical evidence rather than repeating them.
- At320, finish Next month/Back/Forward/Week/back and the same mobile navigation
  branches. Record each stage immediately. No1440 repeat or screenshots.
- Stop at the first unexpected result and retain its stage. No native fallback,
  blind retry, new account/task/permission or business write. Independent final
  review and protected CI still gate merge.

Native GET submission, hard reload/new document and persistence across sessions
remain outside the code guarantee. Broader typography/header work, iPhone and
production are not established by this slice.


## ROOT22F continuation — partial functional result and release

A single functional attempt on source `34b6bd0b21cc148e81635ff46e552f0227345c06`
completed 390 Week and Back with changed/restored period, unchanged document epoch,
zero document requests and preserved groups; Escape closed the mobile menu and
restored toggle focus. No 1440 repeat, screenshot or retry was performed.

The next same-sidebar stage stopped after its 10-second waiter. The saved source
comparison proves a harness mismatch: the sidebar uses bare `/v3/calendar`, whose
resolver defaults to week, while the waiter defaulted a missing view to month.
That contradictory predicate explains this timeout; no product navigation bug
is inferred. The click/menu-close observation alone does not complete same-sidebar
acceptance: final rendered-period/group/epoch assertions for the stage are absent.
Different-destination and 320 stages were not run. This STOP and the two earlier
STOPs remain separate, unchanged evidence.

A future corrected inert proposal is preparation only, with no execution or
runtime admission claimed. Keep the real bare-link/week behavior and explicitly
select Month before any later month-only sequence. Do not alter the product to
fit the old waiter. Product acceptance remains false; PR #1010 stays draft.

Strict final reconciled all 290 business and 33 Auth/Storage tables, catalogue and
effects. Business/Storage writes are zero; prior sessions, refresh tokens and AMR
were restored, with only own sign-in metadata and two login/logout audits.
Own Auth API `scope=local` logout returned 204; UI logout is not claimed. The owned
browser closed and captured Auth file was deleted. Server 19605, launcher 19581,
process group 19564 and port 33254 were closed; user port 33216 remained unchanged.
Intentional Ctrl-C exit 1 is retained separately from resource closure. Resource
release passed to A15, independently of incomplete product acceptance.

| Private evidence | SHA-256 |
|---|---|
| ROOT22F release | `11e05efb15e557b7d8e8eb15ba9b55f35b370015f7bc13f08d416074f228d199` |
| Fresh final | `e2c3ee441c1a3ef86e1eed5529687b19a8701278cc24e1ac02fc16559f608b60` |
| Strict final verifier | `dcab67dc8b21155a899f9055bc8d4b8fbae50d2fcd9e1f1854e177b4cdb40f41` |
| Saved STOP/source diagnosis | `d2119336b4089f26e0234c0ebe6b9dd5251d36a7b0d53b6e46ef83ae0730deed` |

The documentation integration retains main #1013's two Company download result
and current rows 14/32 alongside this branch's sidebar history. The two sidebar
product/test files are unchanged from 34b6bd0b; no product tests or runtime were
repeated for this checkpoint. Final independent review and CI still gate merge.


### Prepared remainder — not executed or admitted

The corrected inert script `04f53dc175ee005260ba637ed8f4e14cf29877d5be305fe62d1535c048f1b253`
passed independent preparation-only review
`9f334e2a548a74b29364ecc76fa26ac4c9883c504e9bdfce9be7457d0ccb4379`.
Bare Calendar expects week; at 320 the ordinary «Месяц» Link precedes the monthly
sequence. Already passed 390 Week/Back/Escape and 1440 are excluded. The remaining
390 same/different-destination and 320 checks stay queued after A15 and B1006,
with a new fresh source/release/actor binding. The proposal is UNBOUND and is not
execution or runtime admission; neither item22 nor full UI acceptance is complete.
