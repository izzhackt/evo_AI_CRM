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

**Still required before completion/merge:** ordinary active Admin login, then
read-only desktop/mobile checks of staff navigation, report year/month filters,
real report rows, directory/empty states and role-preview disclosure. A real
Student session is needed to verify portal routes. Do not seed business records,
bypass Auth or mutate business data to manufacture visual proof.

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
Do not rotate again on resume. Ordinary browser entry and the real internal UI
checks remain pending; this API proof does not validate those pages or a complete
production browser smoke. Keep the PR draft until the visual gap is resolved.
