# EVO Platform frontend implementation plan

## Plain-language outcome

The current CRM already contains the real login, permissions and admissions
data. The Claude Design work supplies the desired visual and interaction
language. This plan combines them: the root CRM becomes the one staff-facing
frontend, while existing backend ownership remains unchanged until separately
approved.

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

No new production role is created by this frontend work:

- `admin` receives the administration surface and the management
  dashboard/report viewpoint;
- `sales`, `curator`, `visa` and `finance` retain their existing server-side
  access;
- Inbox is available only to the existing roles already allowed to open
  `/whatsapp` (`admin`, `sales`, `curator`);
- `client` remains the Student Portal role.

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
- Do not add a new role or widen route access to match a prototype persona.
- Do not represent root CRM WhatsApp shadow data as EVO Inbox Supabase data.

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
| AI safety | draft can be reviewed/edited; no automatic send path |
| Provider truth | simulated/unavailable/connected states labelled honestly |
