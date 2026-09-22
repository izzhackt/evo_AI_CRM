# Sales import placement — actual local acceptance, 2026-09-21

PR #1007 moves the existing initial-import form out of the daily sales report.
The report retains a scoped entry and Admin Settings has its own scoped link.
The original importer, write actions, permission checks and SQL are unchanged.

## Revision and environment

- Actual clean application source: `3035e912b501ac5a5c6538a9c521657609d7e20d`,
  integrating accepted main `29e0fb46` with reviewed product `6ff11d18`.
- Source integration review `0739913d`; CI run `35613381037`: five checks passed,
  three unrelated checks skipped. Seven navigation tests and scoped lint/typecheck
  from the unchanged product revision are reused, not reported as a new run.
- Existing local235 database, existing Admin and custom staff account. The
  configuration alias `sales` is not a claim of a coarse Sales role: its active
  membership has `current_role=null` and the ordinary JWT has the `staff` fallback.
- Immediate baseline was B1006 resource release `0f78c26c`. B1006 profile testing
  remains STOP/draft; its separate successful closure only transferred the runtime.
- Historical ordinary report/management responses from source `3616ea17` supplied
  an existing visible September 2026 review record and capability evidence. Fresh
  before `dabbc727` proved identical business, permissions, catalog and effects;
  actor IDs and relevant readers/SQL were unchanged. No fresh RPC run is claimed
  for these reused readiness responses.

## Real UI paths

Both actors used ordinary login and the actual local application:

- The daily report has no importer. Admin sees the scoped import entry; the
  custom staff actor has no entry and a direct import URL shows the denial state
  without a file input or form.
- Report → import → Back retains year, month, review filter and offset semantics.
  Annual/archive contexts retain their Back context; invalid month13 shows the
  validation message without an importer.
- Explicit record/new/edit/saved contexts take precedence over `mode=import`.
  The existing record opens its preview. Admin's new-sale route shows its actual
  existing permission denial; the custom staff account sees its existing editor.
  Neither path grants additional rights or submits a form.
- Admin Settings → import works with the actual capability. Its default Back
  URL includes a normalized year and month.
- Screens at1440/390/320 were captured and inspected for both actors. No document
  overflow; the focused Back control is44px high and works with the keyboard.
  No visual product correction was needed.

The first Admin batch reached record precedence after completing core navigation
and all three captures, then stopped because the driver expected the report
heading instead of the actual record heading. The corrected confirmation stopped
at an origin check during keyboard navigation, before new screenshots. Both
STOPs are retained. One independently reviewed, finite **functional-only**
continuation completed the remaining four precedence checks and Settings in the
same session; it made no screenshots or repeated visual pass. Sales completed
its first batch after the same navigation-wait ordering correction. These were
QA-driver corrections; application source was unchanged.

## Effects and closure

Final observer `6fd1ecbd` and unchanged strict verifier `f2bdbb91` passed:

- All290 business tables, catalog/ledger and business effects are identical.
- All33 Auth/Storage tables were reconciled. Existing sessions/refresh tokens and
  AMR rows are restored exactly; no users, roles or fixtures were added.
- Only the two owned users' normal sign-in metadata and four login/logout audit
  rows changed. Both local logouts returned204 and both browser contexts closed.
- Only the owned Next process/port33244 was stopped; user port33216 was untouched.
  Its launch-binding guard stopped after reviewed UI-only binding corrections.
  ROOT preserved that STOP, verified the exact original PID/starttime/command and
  both logouts, then sent SIGINT. The owned PTY exited0 and the port closed.

Private evidence stays outside Git; no tokens, account credentials or raw state
are copied into this report. The intermediate live-session snapshot is observation
only, not a whole-Auth equality claim.

Independent bounded actual/closure review `ea65e11a` approved this scope.

## Limits

No import file was selected or submitted; file retention through refresh,
transient permission-read failure, capability revocation and other actors/preview
were not exercised. Existing forms/actions remain unchanged. This is local
technical acceptance of placement and scoped navigation, not production delivery,
financial business acceptance or completion of all item7 / items1–36.
