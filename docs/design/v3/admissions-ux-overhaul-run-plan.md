# Admissions UX overhaul — run plan (2026-09-18)

Branch: `izzhackt/admissions-product-redesign` (worktree from main `39999cc2`).
Journal: `docs/PLAN_CHANGES.md` entry 2026-09-18 «admissions UX overhaul».
This is a presentation-layer overhaul. It does not change the data model,
routes, RPCs, or access rules.

## Why

The owner asked for a full UX/UI rework with Admissions as the first finished
area: staff do their whole daily student workflow inside the platform, students
do their part in the portal. The composition gaps this slice closes were found
in a full read of the current main:

- Tasks are invisible on the case card; staff must leave the case to see them.
- Case help (Обращения) — the main staff↔student channel on a case — is buried
  inside the Route tab.
- The Route tab is an all-or-nothing fetch: one failed read blanks everything.
- `notFound()` renders the bare framework 404 outside the shell (no sidebar,
  no way back); only `/v3/tasks` has a loading skeleton.
- `/v3/main`, `/v3/pipeline`, `/v3/knowledge` hand-copy PartShell markup.
- Two incompatible `Card` components; `StatCard`/`PageHeader` in `ui.tsx` are
  dead code while ~40 files hand-copy the card recipe.
- Sidebar uses the identical folder icon for EVO Docs, Universities and
  Knowledge.
- Portal: `PortalShell`/`OverviewView` use bespoke CSS modules with hardcoded
  px values while sibling views use shared tokens; the overview action queue is
  nested `<details>`; notifications have deep links for only one category and
  no bulk mark-as-read; uploads show no progress; timestamps are silently in
  Asia/Bishkek.

## Fixed constraints (do not violate)

1. **No SQL.** Migration 177 is reserved for PR830. No new migrations, RPCs, or
   schema reads beyond what existing `src/lib` sources expose.
2. **URL contract is frozen.** `?id=` (lead), `?case=` (case),
   `?section=docs|summary`, `?tab=…`, and every other query key parsed today
   keep their names and semantics. `src/lib/v3/navigation.ts` active-item logic
   may be extended, not broken.
3. **Brand and quiet UI.** Tokens in `src/app/(v3)/v3.css` are authoritative
   (light-only, red `#d70217` accent, hairline borders, radius 10/8/6, shadows
   only on popovers). Never tint a panel/row/column; color carries real state
   only. No permanent instructional captions; explanation only where it helps a
   decision (error, disabled-with-reason, limit, data-loss risk). Labels come
   from `src/lib/v3/wording.ts` — extend it rather than inlining new strings
   when a term is reused.
4. **Test invariants.** `tests/v3-brand-design.test.mjs` pins: v3.css contrast
   pairs and `--accent #d70217`; the exact `evo-logo.png` and `EvoLogo` usage;
   `data-testid="staff-role-preview"` `<details>` in `StaffRolesSection.tsx`
   and NOT in `AppShell.tsx`; `preview-active`/`preview-role-admin` testids in
   `AppShell.tsx`; reduced-motion + `scroll-behavior: auto !important` in
   v3.css; `--text-base: 16px` in globals.css; the `key={JSON.stringify(...)}`
   native-form reset in `ProfileCaseDirectory.tsx`; `role="region"` scroll
   containers in `SalesRegisterView.tsx`. Keep all of these green
   (`npm run test:brand-ui`).
5. **Privacy.** Student assessments never appear in any staff surface. No new
   data exposure across roles; presentation-only changes must not widen what a
   `sales` presentation role can see.
6. **Replace, don't layer.** When a component is superseded, migrate its
   consumers and delete it in the same slice. No parallel old/new variants.
7. **Server-component architecture stays.** Pages remain async server
   components reading `src/lib/v3/*-source.ts`; mutations stay server actions.
   New interactivity is client components over existing actions only.

## Design language (applies to every touched screen)

- Composition: `PartShell` page title → optional one-line context → content
  cards. One primary action per screen, red, top-right in the page header;
  secondary actions are ghost buttons.
- One `Card` primitive (from `src/components/ui.tsx`): hairline border,
  `--surface`, radius 10, optional eyebrow title row with a right-side action.
- Density: 16px body, 14px working rows, 12px only for secondary metadata.
  Tables get comfortable row height (≥44px targets), no horizontal page
  scroll at 393px (tables get labeled local scroll regions).
- Status is a `Badge` with text, never bare color. Overdue = danger text +
  date; blocked = warn badge with the blocker named.
- Empty states: one sentence naming what appears here and, when allowed, the
  create action. No decorative imagery.
- Loading: route-level `loading.tsx` skeletons that echo the final layout
  (title bar + card blocks), no spinners-only screens.

## Work packages

### F. Foundation (must land first; everything else builds on it)

Files: `src/components/ui.tsx`, `src/components/icons.tsx`,
`src/components/v3/AppShell.tsx`, `src/components/v3/PartShell.tsx`,
`src/components/v3/MainHeader.tsx`, `src/app/(v3)/**` route-group chrome,
`src/app/(portal)/**` chrome, `src/app/globals.css` / `src/app/(v3)/v3.css`
(only if a token gap is proven).

1. Rebuild `ui.tsx` as the single kit: `Card` (merge the
   `src/components/v3/profile/Card.tsx` API into it — id/title/aside/eyebrow —
   then delete the profile Card and migrate its 7 consumers), `PageHeader`
   (title, description, primary action slot — used by PartShell), `StatCard`
   (single `tone` vocabulary; drop the redundant primary/accent duplicate),
   `Badge`, `EmptyState`, `SkeletonBlock`, and the shared class recipes.
   Fix `rounded-control` misuse → `rounded-ctl` (2 files).
2. `PartShell`: adopt `PageHeader`; add an optional `action` slot; migrate
   `/v3/main`, `/v3/pipeline`, `/v3/knowledge` onto it and delete their
   hand-rolled copies.
3. `AppShell`: distinct icons per nav item (no duplicates), light sidebar per
   the approved variant 2, active/collapse behavior unchanged, testids
   preserved. Keep exactly one EVO logo with accessible name «EVO Admissions».
4. Add `src/app/(v3)/not-found.tsx` and `src/app/(v3)/error.tsx` rendering
   inside the shell frame with a human message and links back to allowed
   sections; same for `(portal)` (`not-found.tsx`, reuse existing
   `error.tsx` style). Note: route-group `not-found.tsx` only fires for
   `notFound()` thrown inside the group — that is exactly the dead-end case.
5. `loading.tsx` skeletons for `/v3/profile`, `/v3/pipeline`, `/v3/inbox`,
   `/v3/calendar`, `/v3/universities`, `/v3/main` and the portal root.

### P1. Case workspace (staff)

Files: `src/app/(v3)/v3/profile/page.tsx`, `src/components/v3/profile/**`.

1. **Case header** (new component, rendered for `?case=` targets above the
   tabs): student name + «Студент»/«Лид» state, direction, curator (read-only,
   with an admin-only link to the coverage panel), current stage n/7 with the
   stage name, next action + due date, and the active blocker if any. Data
   comes from the already-loaded profile/admissions workspace DTOs — no new
   reads.
2. **Overview tab recomposition**: order = next action → case tasks → case
   help → key facts → notes. Case tasks: reuse the existing task read source
   scoped to the case (the same data the directory row count uses) with a
   «Создать задачу» link (existing `/v3/tasks?create=case&case=…` contract).
   Case help: move `CaseHelpWorkspace` here from the Route tab (staff side).
3. **Route tab**: independent sections — stage panel, applications, visa,
   partner packets each render/fail independently (each own try/catch server
   read where the sources already are separate calls); flatten the accordion
   nesting one level (stage facts as titled groups, not nested `<details>`);
   editor lock stays but scoped to the section being edited.
4. Keep every existing capability reachable: documents, packets, anketa,
   money, contract, history tabs stay functional with the new primitives.
5. The `docsMode` create-student flow and `?section=docs|summary` views adopt
   the same primitives; behavior unchanged.

### P2. Curator dashboard, tasks, calendar (staff)

Files: `src/app/(v3)/v3/main/page.tsx`, `src/app/(v3)/v3/tasks/**`,
`src/app/(v3)/v3/calendar/**`, `src/components/v3/OperationsOverview.tsx`,
`src/components/v3/MetricCard.tsx`, related presentation components.

1. `/v3/main`: for actors with admissions capability and no sales-report
   capability, lead with «Мой день»: my students (assigned cases), nearest
   deadlines, overdue count, blockers — composed from existing
   `operations-source` / admissions direction summary / task sources. Sales
   actors keep the sales dashboard. Admin sees both (existing `?view=` logic).
   No new backend: if a desired number has no existing source, drop it rather
   than invent one.
2. De-duplicate `OperationsOverview`: it stays on `/v3/main`; on
   `/v3/calendar` replace it with a compact link card («Сводка на Главной»).
3. Tasks and calendar: adopt the shared primitives, keep all filters/URL
   state; calendar day/week/month markup unchanged in behavior.

### P3. Consistency pass (staff: pipeline, inbox, universities, knowledge, settings, team-chat)

Files: the respective `src/app/(v3)/v3/*/page.tsx` and
`src/components/v3/{Inbox,Pipeline,SalesRegisterView,FileManager,settings,universities,team-chat}*`.

Adopt PartShell/PageHeader/Card/Badge/EmptyState, normalize filter bars to the
shared recipe, ensure 393px reflow with labeled scroll regions, keep every
existing behavior and URL contract. `SalesRegisterView` keeps its pinned aria
regions. No feature changes here — purely visual/structural unification. Where
a screen already matches the system, leave it alone.

### P4. Student portal

Files: `src/app/(portal)/**`, `src/components/v3/portal/**`.

1. Replace `PortalShell.module.css` / `OverviewView.module.css` layouts with
   token-based Tailwind matching `ApplicationsView`/`PaymentsView`; delete the
   module files when no longer referenced. Keep nav semantics, logout, mobile
   menu behavior (menu reachable while scrolling, Escape returns focus).
2. Overview: flat action queue — each pending action is a row with title, due
   date, amount when relevant, and a direct link (document → documents page,
   payment → payments) — no nested `<details>`. Order stays earliest-due-first.
3. Notifications: presentation-only deep-link mapping by `eventCode` category
   (document events → `/portal/documents`, application/visa →
   `/portal/applications`, payment → `/portal/payments`, case-help → existing
   detail route); «Отметить все прочитанными» server action that loops the
   existing per-item `mark_own_student_portal_notification_read_v2` action
   over unread ids.
4. Uploads: switch the client POST to XHR with `upload.onprogress` to show a
   real percentage, keep the Idempotency-Key retry semantics and all server
   contracts; states: choosing → uploading n% → server confirming → receipt.
5. Timestamps: keep Asia/Bishkek values but label the zone once per view
   («время Бишкека») instead of silently ambiguous times.
6. Assessment privacy, auth flow, payments read-only scope: untouched.

### V. Validation (scoped, honest)

- `npx eslint` on touched files, `npm run typecheck`, `npm run build`,
  `npm run test:brand-ui`.
- Touched-contract unit suites: portal presentation/notification tests, any
  task/profile presentation tests that exist for changed files.
- Not claimed: live-auth browser gate (`test:v3:gate`) and production smoke —
  no live Supabase credentials in this environment. Named explicitly in the PR.

## Out of scope (deliberate)

- PR830 (public applications, approval gate, migration 177) — untouched; its
  rebase over this slice is noted in the PR description.
- Manager-oversight RPC gap (`require_admin_actor` on coverage) — needs SQL;
  recorded as a follow-up, not silently worked around.
- Payments acquiring, email self-service, password recovery, parent/partner
  portals — excluded by standing owner decisions.
- amoCRM/WhatsApp provider behavior — presentation of existing panels only.
