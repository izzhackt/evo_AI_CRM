# EVO brand and UX refresh — 09.09.2026

## Sources and intent

Owner: read https://britishdesign.ru/about/blog/386562/ and redo EVO UX/UI with
colours/logos from the EVO logobook. Article read 09.09.2026. Apply simplicity,
grouping, familiar language, clear hierarchy, accessible targets, consistent
states and feedback. Three clicks is a useful short-path heuristic, not a reason
to pack every action onto one screen. No universal 5–9-item limit is imposed.

Brand source: `docs/company/brand/evo-admissions-logobook.pdf`, inspected pages
5 (original lockup), 13 (clear space), 14 (prohibited treatments), 20 (palette),
22 (type). Primary #d70217, monochrome and white variants; preserve proportions,
no shadow/gradient/transparency/re-lettering on the logo. Source PNG from the
reviewed contractor brand pack matches the primary lockup. The unchanged
`Основной логотип.png` is copied to `public/brand/evo-logo.png` (1843×842 RGBA),
SHA-256 `a0cab0e419cefc7df84cfdb1ebee5b554f0794fab579fd098247968af3a8c094`.
`EvoLogo` statically imports it so Next bundles the file under `_next/static/media`;
the existing authentication proxy is unchanged. A direct `/brand/` URL was caught
redirecting in the real browser and replaced before handoff.

The source PDF repeats the red label under the burgundy swatch and labels the
white swatch black. The contractor PDF resolves burgundy to #970026 but does not
justify inventing colours. Use the shared primary red, black and neutral surfaces.
Keep existing Golos/JetBrains UI fonts; do not embed unlicensed trial fonts.

## Visual contract

Visual thesis: a calm, light EVO workbench with recognisable original branding,
strong dark headings and sparing red action emphasis.

Content hierarchy: persistent brand/navigation; one page title and primary action;
working filters/data; secondary controls progressively disclosed. No marketing
hero, ornamental dashboard mosaic or patterns behind working data.

Interaction thesis: clear hover/focus; immediate existing pending/result feedback;
short colour transitions only, respecting reduced motion. No entrance animation
delays access to the work surface.

- Reuse current tokens and components; no second design system or new runtime.
- Raise small routine text to readable sizes and controls to comfortable targets.
- Neutral surfaces, no decorative tints on data rows. Brand red means action or
  current navigation, while statuses retain explicit text and their existing tones.
- Keep table precision and horizontal table scrolling; no page-wide mobile overflow.
- Make low-frequency Admin role preview collapsible without hiding active preview.
- Preserve link-based tabs, real query filters, server forms and version checks.
- Use original full logo once per shell; do not repeat competing brand blocks.

Implementation reference: Next.js App Router global CSS/local asset behavior
verified via Context7 against official Next.js 16.2.9 documentation:
https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/01-getting-started/11-css.mdx
and https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/02-components/font.mdx.

## Proof and limitations

Baseline: main bd4af5cb. Existing Chrome profile initially showed cached Admin UI
and empty cases, but fresh navigation redirected to `session_invalid`. That cached
screen is a visual baseline, not current authenticated proof.

Implemented: original logo in staff/login/portal shells, primary/action colours,
readable type, simplified navigation with collapsed inactive Admin preview,
report/directory hierarchy and accessible table scroll regions. No data, Auth,
role-policy, schema, provider, or server-action changes.

Validated on Node 22.23.1 / actual Next 16.2.11:

- Production build with canonical managed-Supabase public connection configuration:
  PASS, including TypeScript and the knowledge-import bundle. No copied secret file.
- Scoped ESLint and `git diff --check`: PASS.
- 27 source-contract and actual-token tests across `v3-brand-design`,
  `v3-student-portal-ui`, `v3-supabase-integration`: PASS. These are not live
  Supabase integration proof. Updated the portal target assertion from 40 to 44px.
- Real Chrome login: original logo loaded, proportions intact; light/dark theme;
  2560px and measured 393×852 CSS viewport, `scrollWidth === innerWidth`.
  Email/password/submit target height measured 44px. Existing language/theme
  controls are 36/38px, not claimed as 44px. Responsive override reset afterward.
- Independent source review identified old profile-error E2E text; corrected it
  and the three role-preview disclosure steps without removing assertions.

Local preview: `http://localhost:3100/login`, separate from the unchanged port3000
production tunnel. It uses normal authentication against the canonical backend,
not mock records or an Auth bypass. Production was not deployed.

**Acceptance status:** staff checks below are complete and are not Student proof.
The original Student visual gap is closed by the separately owner-approved,
isolated E4 acceptance recorded below. No canonical business records were seeded
or changed. Exact-head CI/review remains a separate merge gate; this note does
not claim a merge, deployment, or normal Student invitation proof.

### Owner-approved access restoration — 09.09, 11:12 UTC

The owner explicitly approved resetting the existing smoke Admin password and
updating its associated GitHub secret. The exact existing confirmed Auth user was
resolved before mutation; only `password` was sent to the server-side Auth Admin
update endpoint. Auth user ID, email and metadata were checked unchanged.
This follows the [official server-side password update contract](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

Real password sign-in, Auth `getUser` identity and `platform.current_actor_authority`
returned the intended active Admin in the canonical organization at 11:12:57 UTC.
The verification session was signed out locally, not globally. No role creation,
promotion, new user, session bypass or business mutation occurred.
`EVO_PRODUCTION_SMOKE_ADMIN_EMAIL` and `EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD` were
updated through stdin at 11:12:58 and 11:12:59 UTC; GitHub timestamps rechecked.
Secret values stayed out of scripts, command arguments, logs, chat and Git.

The owner handoff is ignored local `.env.evo-smoke`, mode 0600; do not commit it.
Do not rotate again on resume. The owner subsequently signed in normally; the
read-only browser result is recorded below. This API proof alone does not
validate those pages or a complete production browser smoke.

### Real authenticated staff acceptance — 09.09

Chrome, the actual Next 16.2.11 production build served at localhost:3100,
canonical managed backend, owner-entered Admin session. Measured CSS viewports:
1440×900 and 393×852 (browser zoom means emulation dimensions are not CSS dimensions).
No mocks, seeded records, record submissions, provider messages or production deploy.

- All seven staff routes loaded meaningful content with the correct title/heading:
  main, pipeline, inbox, profile, calendar, knowledge and settings. No framework
  error overlay. Empty lead/case/conversation queues were kept genuinely empty.
- Report GET filters: August 2026 = 9 records, September = 6, all 2026 = 187
  (50 on page 1), all 2025 = 22. The 2025 archive filter returned a real zero-record
  state. URL, selected filter, count and rendered rows agreed. One existing sale
  opened in its detail form; no save/archive/import action was submitted.
- Mobile month/record selectors initially collapsed to about 52px. A two-column
  filter grid now yields 153px-wide, 44px-high selectors; the desktop compact row
  is preserved (176/160px selectors).
- Mobile report initially leaked absolutely positioned `sr-only` action labels
  beyond its scroll region: document width 919px at a 393px viewport. Positioned
  scroll containers contain these labels; retake document width 384px, no page
  overflow. The 960px records table and 400px totals table scroll inside their
  regions. Tab/ArrowRight moved them by 53/48px with a visible red focus outline.
- Directory search for country + Active updated `case_q`/`case_status` and showed
  the honest no-results message. Reset initially retained the native select's
  old value despite a clean URL. A URL-keyed form plus ordinary document navigation
  for Reset clears both applied and unapplied input; both scenarios rechecked.
  React's [uncontrolled select](https://react.dev/reference/react-dom/components/select)
  and [key-based reset](https://react.dev/learn/preserving-and-resetting-state)
  contracts were verified against the official docs. No query policy changed.
- Admin preview opened normally; Sales preview displayed its warning even with
  the disclosure closed. Restored Admin and verified the preview warning gone.
- Console inspection found 60 errors from a Chrome extension's own toolbar script,
  no application-origin warning/error in the inspected log. The extension was not
  changed. Screenshot evidence was inspected privately, not committed with PII.
- Final production build/TypeScript/import bundle, scoped ESLint, diff check and
  29 source/token checks pass. These source checks do not pretend to be live DB
  or Student-session tests. Independent final-head review is recorded in PR #692.

At the staff-acceptance checkpoint, no real Student session/assigned case was
available. Staff role preview was not counted as a Student login. The later
explicitly approved isolated synthetic-fixture run below closes only the visual
gap; it does not reopen managed SMTP or deferred #687.

### Owner-approved isolated Student visual acceptance — 09.09

Source baseline: `df914fc7d1dae33600d0b2802b6787f45233a942` plus the exact
three-file delta committed with this note: `scripts/test-e4-student-portal-browser.sh`,
`tests/e2e/student-portal.spec.ts`, and `src/components/v3/portal/OverviewView.tsx`.
This is not a claim that the unmodified baseline passed. The browser spec is the
actual E4 entry point; there is no `scripts/check-e4-student-portal-browser.mjs`.

Real isolated Supabase Auth/Postgres/Storage with migrations 001–134 and the real
Next application, using an owner-approved fictional Student. The fixture was
preactivated: Auth Admin user creation with `email_confirm: true` and the existing
fixture seeder's replica-mode setup are not the normal invitation/authority path.
Browser sign-in and subsequent reads/mutation used real Auth, app routes and DB;
no mock backend, managed-production writes, invitations or provider messages.

- E4 result: **6 passed, 6 intentional viewport skips**, exit 0, marker
  `E4_STUDENT_PORTAL_BROWSER_VERIFIED`. All five routes (`/portal`, documents,
  applications, payments, notifications) passed at 1360×1000 desktop, 393×852
  mobile, and forced-dark desktop. Skips avoid repeating viewport-specific tests;
  none of the five-route quality checks was skipped.
- Each route passed real response/navigation, loaded CSS/font/original logo,
  forced-light token, geometry, automated axe and browser-error checks. Separate
  checks passed anonymous/Student/Admin routing, keyboard access to the offscreen
  mobile notification tab, and notification UI → persisted DB/audit → idempotent
  replay → reload. This run does not prove document upload/download bytes.
- Real axe failures exposed invalid nested definition-list groups in the overview.
  The minimal `dl` grouping fix preserves the layout and content. Two stale test
  oracles were corrected: exact passport action copy and a CSS byte-size threshold
  replaced by assertions of actually rendered brand tokens, font and loaded logo.
- **15 successful full-page screenshots captured and visually inspected**: five
  routes × `desktop-chromium`, `mobile-393-chromium`, `forced-dark-chromium`.
  Private OS-temp evidence directory:
  `evo-e4-student-portal-evidence.vK64Hz/screenshots` (directories 0700, PNGs 0600).
  Files are named `<project>-portal[{-documents,-applications,-payments,-notifications}].png`.
  No clipping, page-wide overflow, missing brand assets or framework error overlay
  was found. The Next dev indicator is development-only, not production UI proof.
- Supporting checks: 15/15 portal UI unit tests, scoped ESLint, shell syntax and
  `git diff --check` passed. Harness runs an owned app copy without checkout
  `.env`/`.next`; the live 3100 preview and 3000 SSH tunnel remain untouched.
  Owned E4 containers/volumes were cleaned up; the old local stack remains at 125.

Reproduce with Node 22.23.1: `EVO_NODE_BIN=/opt/homebrew/opt/node@22/bin/node bash scripts/test-e4-student-portal-browser.sh`
(put that Node directory first in `PATH`). The final run used only loopback
`http://127.0.0.1:60229`, project `evo-e4-29300-33869-e511617a`, now removed.
Normal invite → callback/password → authority provisioning remains separately
unproven. This local visual/persistence evidence is not managed-production proof.
