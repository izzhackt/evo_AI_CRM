# CRM sidebar: source proof for destination state

Item22 bounded refinement; product commit `d4c7dcdfb30d40843f599d3aa796aabeaaa7a4ae`,
precode `8731cc3b`, accepted base `06bec2b263697cab37e2a38f18b3681e864297ec`.

The Sidebar React key previously included the full query. A client transition
such as the next calendar month therefore remounted the Sidebar and discarded
the user's disclosure choices. The key now uses the already-authorized active
navigation destination. A separately tagged pathname is used when no allowed
link is active. Presentation role and platform access version remain reset
boundaries; changing to another destination still initializes its active group.

Only `src/lib/v3/navigation.ts` and its existing test file changed. Link filtering,
active classification, route guards, AppShell, mobile handlers, form submission,
visual styles, SQL, dependencies and data contracts are unchanged. Impeccable
Operate guidance is applied as preservation of task context within the existing
EVO shell, not a new visual direction.

## Validation executed

- Node22.23.1 navigation tests: **19 passed, 0 failed**. Existing role/link/current
  destination checks remain; added key relationships cover calendar/sales/profile/
  catalogue query contexts, real destination changes, malformed query classification,
  inaccessible-link fallback for a custom staff actor, role/access-version reset.
- Scoped ESLint for the two changed files: PASS.
- Repository `npm run typecheck`: PASS.
- `git diff --check`: PASS.

These tests exercise the real pure navigation builder. They do not prove mounted
React state, browser history or an ordinary authorized user's UI journey. The
existing Node typeless-package warning was informational; dependency metadata
was not changed to suppress it. No broad regression suite was run.

## Actual UI still pending

The ordinary local UI window follows B32 then A1008. Primary path: calendar
Next month through the existing Next Link, then client Back/Forward while checking
disclosures and the active calendar link. Capture same-document evidence along
with the real URL/period. On1440/390/320, verify the existing mobile close/reopen,
sidebar navigation, Escape and focus behavior in one bounded batch.

The report's initial native GET must finish **before** setting control disclosures;
only its existing Next Link reset can then test preservation. Native GET form
submission, hard reload, direct URL/new tab and persistence across sessions are
outside this fix. On mobile, existing focus loss may close the menu; preserved
disclosures are checked after reopening it. No new tasks, accounts, permission
changes, submissions or data writes are needed. Actual role changes are not claimed
from the pure test. Independent exact-head review, CI and actual UI acceptance
remain separate gates. This source proof does not close all of item22 or prove
production delivery.

## Later local execution checkpoint

The pending window above is historical. The [partial actual report](crm-sidebar-destination-state-actual-2026-09-21.md) records two preserved UI stops on32f50df4,
strict resource closure and the remaining bounded functional check. PR #1010
remains draft; full1440/390/320 acceptance is not claimed.
