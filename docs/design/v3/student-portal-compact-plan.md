# Compact Student Portal — selected concept 03

Date: 2026-09-10. Status: implemented and locally validated; awaiting review/release.
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
