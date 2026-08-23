# EVO Platform frontend implementation plan

Status: the delivered frontend route/design record is retained; current
product, role, data and rollout authority comes from #376 and ADR 0020.

## Plain-language outcome

The root CRM contained the real login, permissions, and admissions data when
this frontend slice was implemented. The Claude Design work supplied the
desired visual and interaction language, and the root CRM became the one
staff-facing frontend without pretending that its backend had already been
unified.

The target backend and migration contract is now
[`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`](../../EVO_PLATFORM_LONG_RUN_PLAN.md),
governed by [ADR 0020](../../adr/0020-unify-evo-v1-on-canonical-supabase.md). The
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

## Current role mapping

The first internal pilot has three human-facing roles:

- `admin`, presented as Director/Admin: staff administration, management
  reporting and audited exceptional actions;
- `sales`, presented as Sales Manager: owns the sales queue and customer
  conversation until the contract-plus-first-payment handoff gate;
- the existing canonical admissions role, presented as Admissions Manager:
  after assignment, owns the student case, applications, documents, `/visa`,
  tasks and communication.

Contract confirmation and payment confirmation are explicit permissions, not
implicit job-title powers. Finance is an internal module, not a fourth pilot
role. Student Portal follows after the internal pilot and is not a pilot role.

There is no separate `visa` business role. The `/visa` route, entity and icon
remain inside the Admissions workflow. U1 maps staff accounts to the three-role
contract explicitly and fails closed on ambiguous legacy roles. Its verified
token carries the exact organization, membership, permission-bundle ID/version,
role and access version; every server and database decision compares those
claims with current Supabase rows. `invited`, `suspended`, `inactive` and
`blocked` memberships have no live authority. The connected Admin staff screen
uses audited RPCs and ordinary user sessions, never a browser service-role key.
See [`u1-unified-staff-access.md`](../../platform/u1-unified-staff-access.md).

Conversation and message history stay unified across the sales-to-curator
handoff. After handoff, Sales may see only the authorized non-sensitive summary,
not Curator-only records or sensitive documents.

The prototype role switcher is test/demo navigation only. It is not an
authorization control to reproduce in production.

## Inbox implementation boundary

`/whatsapp` is the Inbox module inside the same EVO product and login. Existing
root shadow records, Inbox Supabase data and Lead Agent state are migration
inputs only; U3/U10 must not connect them through a runtime read bridge,
dual-write, fallback repository or parallel UI.

The target is one canonical EVO Supabase model. amoCRM is a temporary
read/import adapter, and WAHA is a private transport adapter. The first live
stage receives and displays inbound messages but performs no outbound WhatsApp
send and no amoCRM write.

AI is advisory and human-reviewed. It may propose content only from approved,
versioned knowledge, with uncertainty and risk visible. A human may accept,
edit or reject the suggestion, but stage one contains no send action. AI never
sends, changes a stage, assigns staff, accepts documents or confirms payments.
EVO may promise only its own contracted work, never admission, scholarship,
visa or another external decision.

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
