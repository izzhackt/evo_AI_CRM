# Team workspace — implementation candidate, 2026-09-10

Status: code candidate, **not production acceptance**. Issue #708; branch
`izzhackt/team-workspace-implementation`, base main
`71d97dd987fb5d24f8f2913c03b4a0028f0b06fc`. The eventual PR records the exact head.

## Implementation

- 139: existing staff directory/membership commands plus active participants,
  invitation/recovery request ledger, definitive Auth rejection readback and
  no-blind-resend reconciliation. Admin UI and `/auth/staff` password setup.
- 140: independent staff tasks, creator/assignee/Admin access, exact replay,
  optimistic versions, same-department assignment and event history. Existing
  Admissions case commands remain canonical; case selection is paginated.
- 141: three staff-only channels, durable messages, one-level replies, search,
  mentions, read/mute state and tombstones. Private Realtime carries invalidation
  only; every content read rechecks current authority/channel. No new chat service.
- 142: atomic message-to-task creation with source-version checks and durable
  receipt; separately authorized task↔message links; generic staff notification
  events/read state. Student notifications and assessment privacy are unchanged.
- Shared shell: Option2 department navigation, distinct client Inbox, global task
  action and notifications. Existing EVO logo/colors/tokens; no Slack skin or new
  design framework. Every source-linked task creation confirms title/assignee.

Useful code entry points: `src/app/(v3)/v3/tasks/page.tsx`,
`src/app/(v3)/v3/team-chat/page.tsx`, `src/components/v3/settings/StaffSection.tsx`,
`src/components/v3/StaffNotifications.tsx`, `src/lib/v3/staff-notification-source.ts`,
`src/lib/server/platform-staff-task-repository.ts`, migrations139–142.
The canonical settings section is `staff`.

## Observed checks (bounded, no business-data simulation)

- Node22.23.1 integrated production build passed, including TypeScript. A missing
  route-label union entry found by the first build was fixed. No separate duplicate tsc.
- Navigation/role/route checks: 26/26. Updated V3 inventory/calendar/route/Auth
  rejection checks: 32/32. Brand/settings/profile checks: 14/14. These batches
  overlap route coverage; do not sum them into a unique test-count claim.
- Worker task field checks: 3/3. Scoped ESLint and `git diff --check` passed.
- Suite-manifest check: 6/6 after refreshing stale exact-count assertions. The
  current-main package already listed three more files than that older assertion;
  this branch adds one Auth-rejection test. CI now resolves132 unique files from
  271 occurrences (139 duplicates eliminated); local unit resolves127/169/42.
  No test or serial-provider classification was removed; this does not claim
  that the full132-file suite was executed during this bounded candidate check.
- Real local database **schema only** was read from
  `supabase_db_evo-platform-local` (ledger through125), with no user/customer rows.
  In one disposable, network-isolated PostgreSQL17.6.1.165 container, a clean
  template received that schema and migrations126–142 with `ON_ERROR_STOP=1`.
  This is neither a production migration nor a backup of business data.
- Final rehearsal database `evo_team_candidate_v3`: migration application passed;
  `auth.users=0`, `platform.profiles=0`. `plpgsql_check` found no errors in the
  new staff/chat PL/pgSQL functions and new workflow triggers. Non-blocking
  initializer-cast warnings remain (UUID[] in chat/mention, older JSONB function).
- Catalog check: new messages/notification/auth-ledger/provenance tables grant
  no direct anon/authenticated/service-role access. Staff tasks retain intentional
  authenticated SELECT with their role-scoped RLS. Task→chat source lookup under
  authenticated role with no identity returned NULL, not content.
- Notification page under the actual authenticated role without an identity
  rejected with `staff_notifications_forbidden`. The Auth rejection-receipt RPC
  permits service_role, not authenticated; the last-Admin trigger checker reported
  no errors. These are real negative/catalog checks, not positive user journeys.

No real staff account, message, task, invitation email, provider call or production
row was created by this validation. No live SMTP/Realtime/multi-user outcome is
inferred from static checks or the empty schema rehearsal.

## Independent review and recovery corrections

Separate reviewers found and the implementers corrected:

- Definitive Auth4xx rejection previously left the recipient locked indefinitely.
  It now has a narrow rejection receipt, contradictory-side-effect readback,
  explicit new-request confirmation and cooldown; unknown/5xx never auto-resend.
- A second case-task creation retained the first success state; the form now
  resets to the fresh server-issued request after successful refresh.
- A pending case-search result could contaminate a newer query/cursor; stale
  responses are now discarded on query edits.
- Unknown task writes now preserve an immutable payload snapshot and exact retry;
  explicit recovery waits for canonical refreshed props without losing the draft.
- Unknown moderation can be hidden/reopened without changing its reason/request
  identity. Definite cancellation resets action state for the next attempt.
- Global task creation now sends an explicit UI-open intent, so clicking it on
  an already mounted tasks page opens the form without remounting a saved draft
  or uncertain submission. Ordinary refresh does not override local disclosure state.

Final integration review/PR status is recorded on the exact GitHub head. Code
review approval is distinct from the live acceptance still listed below.

## Open acceptance and release boundaries

Two confirmed real employees and an authorized invitation recipient are still
needed. No synthetic employee authority was approved. Real staff invitation,
two-user messages/tasks/notifications, blocked-session behavior and browser
desktop/mobile checks remain open. Existing production is unchanged; previous
localhost3000 is the old accepted image, not this candidate, and3101 was not
listening at the prior readback.

R5 also needs current recovery authority; do not reuse the prior Student release
waiver automatically, create a new backup against owner instructions, or pretend
image rollback reverses schema changes. Keep migrations unapplied to production
until the release gate is resolved. See the
[activation runbook](../../../runbooks/team-workspace-activation.md).

WAHA pairing/QR/sends/session checks are explicitly deferred until numbers exist.
The native workspace does not depend on them. W2 WhatsApp mirroring is a separate
optional implementation lane, not a secretly enabled or completed bridge.
