# CRM-05: мобильная воронка — локальная проверка

- Base main: `3500fa8b4ef708358cc4a240656be9dbd43415b6`.
- Pre-code contract: `7f4c197b`.
- Runtime: `94bd7b958b86eacde595f5843cdff2e3eb569551`.
- Independent runtime review: APPROVED, crm_delivery, exact runtime SHA.
- Environment: owned local QA `evo-local-0fd3559d0240c989`, ledger001–214;
  ordinary existing Sales Auth, own Next33226. No mocks/seeded new inputs,
  no commands/save/role changes/provider/managed DB/deployment.

## Actual UI proof

Desktop rendered original seven-column board and URL-stage/due/assignment
filters. Existing query returned Новый3, Переданы4, five empty intermediate
stages. One batched desktop/mobile screenshot inspection preserved EVO identity.

At actual viewport390×844 (inner/client/scroll390), only one stage is visible,
all seven stage buttons have44px height, stage URL filter is hidden. Due and
assignment are a single collapsed disclosure; keyboard activation opens its
one set of links. Native search and owner controls remain visible.

Opened the existing QA B209 Student2 decision disclosure by keyboard, unchecked
«Без следующего действия», entered an unsaved next-action draft. Switched to
Переданы, through all five empty stages, and back to Новый. At each step the
visible-stage DOM contained exactly the selected stage. Draft, disclosure,
all form fields including request_id and expected_version matched the initial
snapshot exactly. URL did not change. No save button was activated. Network
absence is supported by the local-state implementation; no network event
capture was performed, so this receipt does not claim measured zero requests.

320px: inner/client/scroll320 with filters expanded and draft open. Opened a
real deep URL with stage=new, q=QA, due=unscheduled, assignment=mine, current
existing Sales owner and handed=all. Result: one matching existing lead,
«Этап: Новый», no fabricated stage counts, disclosure count2. Activated
«Показать все этапы»: only stage removed; q/due/assignment/owner/handed preserved.
Desktop viewport restoration showed all seven columns and both stage/due
filters even while the mobile disclosure remained closed.

Browser automation mouse clicks did not activate the native disclosure/checkbox
under device emulation; keyboard Enter/Space exercised the actual controls.
One locator-evaluation timeout was bypassed with fresh read-only DOM inspection.
This is browser/device-emulation and keyboard evidence, not real-device touch
or screen-reader acceptance. Unsaved draft was discarded by navigation; no
business write or cleanup occurred. Device override cleared after verification.

## Scope-local checks and limits

- ESLint: all3 changed runtime files PASS.
- TypeScript `tsc --noEmit`: PASS.
- Existing stage-entry, pipeline-notes and brand checks:20/20 PASS.
- `git diff --check`: PASS.
- Impeccable detector: exit0, no findings on final3 runtime files.
- Independent final-doc review and protected PR CI: pending at this receipt.

Terminal20/show-all/latest logic and cap4000 are unchanged, source-reviewed.
Actual data had4 terminal rows, so >20 and truncation are not runtime-proven.
No workflow transition, sales handoff, customer acceptance or final E2E claim.
This completes the mobile composition slice of CRM-05, not all36 plan items.


## Integration after948

Rebased onto main `011c0e49e7a95b845eb52d34e10cc2bfa00f9f1f`. Only two
pre-code document append conflicts were resolved by retaining full new main
and appending the original contract. All3 runtime files and the original QA
receipt match reviewed4b4dff06 byte-for-byte before this integration note.
Existing real-path evidence above keeps its original revision/schema boundary;
no unchanged UI business path was rerun. Fresh final review/CI target this rebase.
