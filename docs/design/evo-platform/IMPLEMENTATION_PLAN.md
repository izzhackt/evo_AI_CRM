# EVO Platform frontend implementation plan

## Plain-language outcome

The root CRM contained the real login, permissions, and admissions data when
this frontend slice was implemented. The Claude Design work supplied the
desired visual and interaction language, and the root CRM became the one
staff-facing frontend without pretending that its backend had already been
unified.

The target backend and migration contract is now
[`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`](../../EVO_PLATFORM_LONG_RUN_PLAN.md),
supported by [ADR 0014](../../adr/0014-unified-evo-platform-target-architecture.md). The
frontend remains the UI contract; it is not evidence that Supabase, amoCRM,
WAHA, or AI provider paths are live.

## Route map

| Product surface | Canonical application route |
|---|---|
| Staff sign-in | `/login` |
| Command center | `/dashboard` |
| Sales funnel/list | `/sales` |
| Lead 360 | `/sales/[id]` |
| Student list | `/clients` |
| Student 360 | `/clients/[id]` |
| Applications | `/applications` |
| Documents | `/documents` |
| Visa workspace | `/visa` |
| Finance | `/finance` |
| Tasks/calendar | `/tasks` |
| Calls/meetings | `/calls` |
| Unified WhatsApp Inbox | `/whatsapp` |
| Team chat/updates | `/chat` |
| Notifications | `/notifications` plus staff-shell preview/count |
| Reports | `/reports` |
| Administration/integrations/audit | `/settings` |
| Student Portal | `/portal` |

## Role mapping

The target first-release business roles are:

- `admin`: administration and management reporting; only Admin may invite or
  block staff and assign or reassign a Curator, with a mandatory reason and
  before/after audit;
- `sales`: owns the sales queue and customer conversation until the signed
  contract is confirmed from an account-specific amoCRM pipeline/status
  mapping;
- `curator`: after Admin assignment, owns the whole student case, including
  multiple applications, documents, `/visa`, tasks, and communication;
- `finance`: manages the authorized finance surface without receiving Curator
  or sales ownership;
- `client/student`: uses the Student Portal after the confirmed contract and
  Admin Curator assignment.

There is no separate `visa` business role. The `/visa` route, entity, and icon
remain. The current root runtime still contains a legacy `visa` role until the
planned explicit migration moves existing users to `curator`; this is a known
implementation gap, not a target permission.

Conversation and message history stay unified across the sales-to-curator
handoff. After handoff, Sales may see only the authorized non-sensitive summary,
not Curator-only records or sensitive documents.

The prototype role switcher is test/demo navigation only. It is not an
authorization control to reproduce in production.

## Inbox implementation boundary

The initial redesigned `/whatsapp` route uses the root CRM's existing local
WhatsApp shadow records and guarded send/draft actions. The UI must name that
source and must not imply it reads EVO Inbox Supabase.

The separate EVO Inbox app remains the current Supabase/WAHA runtime. Connecting
its data to the root workspace requires a later authenticated read adapter or
explicit migration plan; that backend work is not hidden inside this frontend
slice.

The target replaces that split ownership with one logical platform data model
in a dedicated Supabase production project, with physically isolated
non-production environments, and one private production WAHA session
`evo-inbox`. amoCRM remains canonical for contact, lead, responsible sales
manager, and sales stage; an operational admissions status never replaces the
amoCRM sales stage.

AI remains draft-only. It may propose Russian or English according to the last
customer message, but uncertain language detection must stop for manual
selection or human handoff. Only approved, versioned knowledge may be used.
A staff member reviews/edits and manually sends every customer reply. EVO may
promise only its own contracted work, never admission, scholarship, visa, or
another external decision.

## Delivery increments

1. Design tokens, logo component, shared accessible primitives and responsive
   staff shell.
2. Dashboard, funnel, Lead 360 and urgent mobile navigation.
3. Student 360, applications, documents, visa and finance.
4. Tasks, calls, Inbox, notifications, reports and administration.
5. Student Portal mobile and desktop layouts.
6. Cross-flow browser validation, copy/source-truth audit and implementation
   handoff.

## Engineering rules

- Preserve Server Components for authentication, database reads and route-level
  data loading.
- Use small Client Components only for filters, tabs, drawers, dialogs, mobile
  navigation and other interaction.
- Use semantic HTML first: buttons/links, real tables, labelled inputs,
  accessible dialogs and tab patterns.
- Respect visible focus and `prefers-reduced-motion`.
- Do not add a frontend-only copy of a canonical business value when a current
  server read model exists.
- Do not imply that an external provider is connected merely because a chip or
  demo state renders.
- Implement only the target role set; do not widen route or object access to
  match a prototype persona.
- Do not represent root CRM WhatsApp shadow data as EVO Inbox Supabase data.
- Keep the visual contract while server-side authorization migrates; hidden
  navigation alone is never an access control.

## Validation matrix

| Check | Required evidence |
|---|---|
| Code quality | lint, TypeScript/build and affected automated tests |
| Desktop | real browser at 1440x1024 |
| Tablet | real browser at 834x1194 with no page-level horizontal overflow |
| Staff urgent mobile | Inbox, tasks and notifications at 390x844 |
| Student mobile | main critical flow at 390x844 |
| Student desktop | true desktop layout, not embedded phone chrome |
| Keyboard | skip link, visible focus, navigation, tabs and overlays |
| Source-of-truth | amoCRM/sales and CRM/operational stages visibly distinct |
| Handoff/RBAC | Admin-only Curator assignment; Sales pre-contract, Curator post-handoff; negative object-scope checks |
| AI safety | RU/EN draft can be reviewed/edited; uncertain language stops; no automatic send path |
| Provider truth | simulated/unavailable/connected states labelled honestly |
