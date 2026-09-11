# Compact Student Portal — selected concept 03

Date: 2026-09-11. Status: PR #724 merged; exact-main CI failed on an ambiguous preview-test locator, release skipped; narrow E2E correction in progress.
Branch: `izzhackt/student-portal-compact`, based on `2c4bce39`.

## User outcome

A light, compact personal workspace with burgundy action header, the most
important real action expanded, a short remaining queue, and visible EVO work
and access to existing support. Desktop sidebar becomes complete, usable
navigation on mobile. The first screen must also work honestly before a plan
exists and when the student is waiting on EVO.

## Ownership and implementation

- PortalShell/PortalPage and CSS modules: student layout and navigation only.
- OverviewView and portal overview pages: compact hierarchy, direct links to
  actual document requirements/payment obligations; no pretend controls.
- Private portal overview read model may expose the existing sorted action
  choices as a list, without new RPCs, elevated credentials or staff coupling.
- Existing CaseHelpWorkspace remains the real support path. No new chat or
  context association may be claimed without its existing implementation.
- Admin preview remains labelled and loads no private student case. Empty
  data is a genuine empty state, not an invitation to invent activity.
- Staff `/v3` admissions/universities, shared university views, global brand
  tokens, APIs, auth and database schema are not owned by this change.
- Keep the complete existing portal navigation, route guards, logout,
  document actions, notifications and assessments available.

## Parallel work

A different Codex task can own staff Admissions/Universities in a separate
branch/worktree. Do not share a dev port or working directory. Coordinate any
request to change shared source contracts; integrate reviewed branches through
GitHub. This task does not create or dispatch a separate user-owned task.

## Validation

Use Node 22 and repository lint/type/build checks. Exercise the actual Next.js
routes against available real services, including Admin preview and mobile
navigation; never create sample student data or bypass auth for screenshots.
Inspect the real runtime before choosing the isolated validation path; the
existing localhost:3000 is a production SSH tunnel, not a disposable dev server.
Record exactly what was exercised and any Student account limitation. No live
acceptance or deployment claim without corresponding evidence. Review and
push the bounded code changes to GitHub after checks.

## Framework reference

Next.js 16.3.4 layouts preserve the surrounding UI across navigation; the
client sidebar can use `usePathname` for active links while content and auth
remain server-side. Reviewed official docs on 2026-09-10:
- https://nextjs.org/docs/app/getting-started/layouts-and-pages
- https://nextjs.org/docs/app/api-reference/functions/use-pathname

Context7 lookup was attempted; the service reported its monthly quota exceeded.
Official Next.js documentation was read directly for this implementation.

## Validation evidence — 2026-09-10

- Node 22.23.1, clean `npm ci --ignore-scripts`, full `npm run lint`, `npm run
  typecheck`, and optimized `npm run build` passed. The final build includes the
  Escape-key fix verified below.
- Five existing real-file UI contract checks passed: complete route inventory,
  Student guard/staff-shell separation, strict page source wiring, actor/action
  links, and responsive/semantic navigation. Existing decoder expectations were
  updated for the new action-list field. Fixture/mock suites were not used as
  validation of this change.
- Real Chrome Admin session opened the actual changed Next.js application on
  localhost:3001, using only the running application's two public Supabase
  settings. No service-role or entire production env was copied.
- Actual Admin preview, document empty state and published university catalogue
  rendered; navigation closed on selection, active section was correct, all
  seven links were reachable on mobile. The final optimized build was exercised
  again, including Escape with focus on the menu trigger (a bug found in the
  first browser pass and fixed). Narrow layout measured 381 CSS px with no
  horizontal overflow. Desktop layout was visually inspected as well.
- Real Student /portal actions were not exercised: the available authenticated
  session is Admin, and preview intentionally loads no Student case. No case,
  student identity, upload, payment, message, or assessment answer was created.
- Existing source limitation remains explicit: the overview RPC exposes one
  document action; finance exposes eligible obligations. The queue shows that
  actual combined projection and keeps links to the complete document/payment
  sections. It does not claim a new all-document task API.
- Anonymous `/portal` returned HTTP 307 to `/login`.
- Read-only review found no further correctness or access-boundary defect.
  Production's localhost:3000 tunnel and server runtime remain the existing
  accepted release. This document is local implementation evidence, not release
  or populated-Student acceptance evidence.


## Authorized integration and mobile release — 2026-09-11

The owner explicitly requested publishing the compact design in PR #724 and
making the mobile version ready after seeing the old horizontal navigation.
Integrate the current shared main, preserving its reviewed university catalogue
copy and detail metadata. No new database, migration, identity, Student data,
private assessment access or provider action is needed.

Acceptance before release: complete seven-section navigation at 320/393 px and
desktop; no page-level horizontal overflow; readable cards/forms; 44 px menu
controls; keyboard tab order, Escape dismissal and trigger focus restoration;
close navigation on route selection or leaving its region. Verify actual
Admin preview routes and genuine published catalogue in the browser. Capture
only UI evidence without private Student data. The Admin preview cannot prove
populated Student-case actions or Student assessment persistence.

Run Node 22.23.1 lint, typecheck, optimized build and focused real-file contracts;
obtain independent review, exact-head CI, exact-main CI and normal guarded release
evidence before claiming publication. Root coordinator owns live browser/release
checks and the existing localhost:3000 tunnel.

The W3C APG disclosure-navigation guidance was checked live on September 11:
https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/
It supports semantic navigation with a real toggle button, aria-expanded and
aria-controls, normal Tab navigation, Escape with trigger focus restoration and
dismissal when focus leaves the region. Use these interaction requirements in
the existing real portal, not the illustrative site's sample content.

The W3C WCAG 2.2 Reflow explanation was also checked on September 11:
https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
Its 320 CSS px/no loss of information or function requirement informs the narrow
viewport check. Context7 Next.js resolution was retried by the coordinator; the
service still reports monthly quota exceeded, so current official docs are used.

Mobile route review found that retaining the previously expanded pathname could
reopen navigation after browser Back then Forward. Discard expansion as soon as
the pathname changes; do not remount the application or clear Student forms.
React's official state-adjustment guidance was checked on September 11:
https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
Use a guarded reset of this component's menu state during rendering, avoiding
an effect-driven second commit or resetting unrelated child state.

The real September 11 browser pass measured 320 CSS px innerWidth but only
310 px document clientWidth with its classic scrollbar. The inherited global
body minimum of 320 px caused 10 px page overflow. Remove that minimum only
when the compact portal shell is present, using the scoped CSS module selector
`body:has(.shell)`; retain ordinary content wrapping and do not hide overflow.
MDN's current :has() reference was checked for the ancestor-selector behavior:
https://developer.mozilla.org/en-US/docs/Web/CSS/:has


## Integrated candidate validation — 2026-09-11

Main `4dc5ead9` was merged into the compact branch, retaining the current
catalogue copy and detail metadata. The subsequent docs-only main `06aba151`
(PR #732 release acceptance) was also integrated after browser validation;
its diff changes no product code or runtime assets, so that evidence remains valid. Bounded mobile fixes close the disclosure
on focus exit, outside pointer input and any pathname change; Escape restores
trigger focus. Main action/support targets are at least 44 px. The portal alone
removes the inherited body minimum responsible for narrow scrollbar overflow.

Local execution used Node 22.23.1 and the optimized actual Next.js application
on localhost:3001, with only the existing public Supabase URL/publishable key.
No service-role credentials or new persistent source were introduced. Passed:

- `npm run lint`; `npm run typecheck`; `npm run build`; `git diff --check`.
- Five existing real-file portal UI contracts: complete route inventory, Student
  guard, strict page wiring, exact actor/action links and responsive semantics.
- Existing real-file catalogue contract for neutral Student/Admin-preview
  university detail descriptions. Six selected contracts passed; fixture/mock
  decoder suites were not used as acceptance evidence.
- Anonymous real HTTP `/portal` returned 307 to `/login` after the final build.

Coordinator's real Chrome Admin CUA inspection of the final optimized candidate:

- All seven preview sections rendered at actual 320 and 393 CSS px. Chrome's
  saved 75% zoom was measured, not assumed: the capability width was adjusted
  to obtain actual `innerWidth` 320/393. At 320, `scrollWidth == clientWidth`
  (310 with the classic scrollbar, otherwise 320); at 393 the corresponding
  widths were 383/393. No page-level horizontal overflow remained.
- All seven mobile links were reachable and at least 44 px high. Selection
  closes navigation; Escape restores trigger focus; clicking the page heading
  outside it closes it; nine Tab presses leave/close it; browser Back to Tests
  and Forward to Universities keep it closed.
- The real published UMPRUM detail loaded and wrapped. English question preview
  supported Start, select, Next and Back with its documented in-memory choice;
  reload cleared selections and returned to Start. Career preview rendered its
  first four questions, selections and Next into part 2 of 23 at 320 px, with
  scroll/client width 310 and radio label heights at least 49.33 px.
- Desktop at actual width 2016 had scroll width 2016; the sidebar, burgundy
  action panel and EVO/curator column were visually inspected. Native CUA
  screenshots are in the coordinating Codex task's tool evidence, not invented
  file paths. No blank screen or framework error overlay appeared.
- Browser console contained extension/ad-block messages (toolbar React130,
  useCache and a receiving-end connection message at the ad-block timestamp),
  without an EVO stack. This is not a claim of an entirely empty console.

This proves the actual Admin preview, published catalogue, authored question
preview and responsive presentation. It does not prove populated Student-case
actions, uploads, payments, private attempts/results or persisted assessments.
No Student identity, private case, message or business write was created for
acceptance. Production is unchanged by this local validation; root coordinator
continues exact-head review/CI and the authorized guarded release separately.

Local command logs are `/tmp/evo-portal-compact-sep11-lint.log`,
`/tmp/evo-portal-compact-sep11-typecheck.log`,
`/tmp/evo-portal-compact-sep11-build.log`,
`/tmp/evo-portal-compact-sep11-contracts.log` and
`/tmp/evo-portal-compact-sep11-catalogue-contract.log`.


## Release closeout — 2026-09-11

PR #724 merged as `f9133a0488add0f6afefa3e5cdc3163952db4cd6`, with the same
tree as reviewed head `19dc2464`. Full CI 34575893217 failed on an ambiguous
preview navigation locator and release 34576407176 was skipped. Guarded release
and post-release browser acceptance are not yet confirmed;
follow the [release evidence record](references/2026-09-11-student-portal-compact-release.md).
The local candidate proof above remains separate from those production gates.


## Narrow CI correction — 2026-09-11

The real configured-auth Admin preview test failed because its broad `nav a`
selector now resolves both the primary sidebar link and a valid overview
shortcut. Scope only its section-loop and Tests link to the existing named
Разделы кабинета navigation landmark. Keep every URL, question-navigation,
zero-write and denied-role assertion intact. This is test disambiguation, not
a new product behavior, data model or acceptance waiver. Current official
Playwright locator guidance is linked in the release record. Run focused lint,
typecheck/discovery and the real browser path; exact-main CI and guarded release
remain mandatory. No production update occurred through the skipped release.

Scoped ESLint, Node 22.23.1 typecheck and Playwright single-test discovery passed
for the locator correction; the assertions and product code are unchanged.
The corrected real-auth E2E still awaits CI execution. A fresh CUA selector check
was unavailable after Mac lock/debugger detachment, so it is not claimed.
