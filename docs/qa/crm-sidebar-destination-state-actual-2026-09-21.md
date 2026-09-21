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
