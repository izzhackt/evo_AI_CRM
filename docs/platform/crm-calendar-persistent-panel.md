# Calendar16b: persistent task panel

Pre-code contract, 22 September 2026. Base `ec3f62bad9b7f5030ecb2949a33d9f1a9b46d9ed`
contains merged disclosure16a/#1025. Implements accepted [§10](../EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md#10-личный-календарь).
Independent approved planning receipt: `0f8d0e2aa395bf9372773e1247f742cd3cfdb666d4671ab5f155c502e57366f4`;
approved plan SHA256 `2c64156a5fcb2e8848e4b7adad800476df5b23c5b524c1efe550d928c4a2b659`.

## Behaviour

- Keep one Calendar client owner, keyed only by verified organization/user/membership/access
  version/preview identity. Task, period, view, cursor and server request UUID no longer remount it.
- Keep one native dialog and one create form mounted. Desktop uses nonmodal `show()` in a side
  column; narrow layouts use `showModal()`. Details/create switch visibility, not create-form identity.
  No duplicate forms, portals between containers or custom focus trap.
- Native `close` has no state, URL or focus handler. Explicit Close/native cancel (preventDefault)
  are idempotent user-close intents. One layout effect changes dialog mode synchronously, preserving
  the connected focused descendant and supported text selection across resize. It does not navigate.
  Initial open focuses title/heading; explicit close returns to the surviving trigger or calendar heading.
- The case create label is «Задача по студенту». Keep the existing global staff composer unchanged.
  Cases remain explicitly selected. Draft fields, deadline and action request ID survive close/reopen,
  target/view/period/client history changes and resize. Hard reload, route exit and changed identity/
  access/preview are excluded; these do not create a new persistence store.
- The server-generated createRequestId seeds the initial attempt once, then serves only as a server
  render token. It must not replace action state.requestId or key a live draft.
- On create stale: capture the committed render token; lock until an explicit refresh was requested,
  all action/navigation/refresh pending ends, a different authorized server token is committed, and
  the existing case-assignee reader returns ready for that exact case/token. Refresh is not a Promise.
  Fields and request ID stay intact; the next manual Save is continuation, with no second acknowledgement
  button. A different authorized URL render may supply the fresh token; no causal URL nonce is added.
  Recheck current rights/preview and assignee eligibility; ignore obsolete candidate results.
- On saved: retain confirmation and lock until «Создать ещё», the only normal create-form reset,
  using the new UUID returned by the unchanged action. Invalid/forbidden/unavailable preserve draft;
  unknown outcome is not success or a new attempt. Request-conflict uses the action-returned UUID.
  Saved refresh remains; automatic create stale refresh is replaced by the explicit control.
- Known unavailable target becomes typed panel state in the same owner. Clear old target/capabilities
  and read the ordinary authorized workspace once with target=null. Keep existing return links.
  Other errors propagate and malformed query remains notFound; no fabricated empty success.
- Preserve disclosure16a, all URL/cursor/count/date/timezone semantics, case/staff boundaries,
  permissions and existing task changes/reasons/version acknowledgements. Shared DeadlineFields is
  used by global composer and TaskDetailPanel: its API/defaults/behaviour remain unchanged.

## Design and scope

Impeccable Operate/adapt advice: retain EVO/Golos and ordinary controls; use space beside the
schedule instead of pushing it down. Existing tokens establish 14px task titles and 12px metadata;
only local classes change. Global scale/touch-input 16px floor remain. Real16a incumbent1440/390/320
and independent review `4f7758c9` provide current visual context, not acceptance of16b.

Owned files: calendar/page.tsx, calendar/Calendar.tsx, create-form portion TaskControls.tsx,
local CalendarPanel.tsx/module CSS, two TaskChip typography classes, a small used lifecycle helper
and focused pure tests. No SQL, actions, global CSS/AppShell, shared composer or new authority.

## Validation and limits

Node22.23.1; scoped ESLint, typegen/tsc and meaningful state-transition tests (stale token/pending/
candidate correlation and saved reset), diff check. These do not prove live focus, saves or mutations.
After coordinated runtime handoff, existing authorized staff/tasks: one batched1440/390/320 path
checks one form, all draft values/request ID, resize focus/selection, close/reopen, real targets,
view/period/Back/Forward, Tab/Escape/return and computed14/12px. At most one bounded correction batch.
No new fixtures/actors/tasks for layout; absent target/state/cursor variants remain unverified.
Actual saved/stale/unknown acceptance needs an intentional authorized save; not claimed from pure tests.
Production and whole item16 acceptance remain separate.

## Official contracts checked for the accepted design

- [React useLayoutEffect](https://react.dev/reference/react/useLayoutEffect): synchronize browser dialog/focus before paint.
- [HTMLDialogElement.showModal](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal): top layer/inert background; close a nonmodal dialog before switching mode.
- [Next useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router): refresh merges new server payload with retained client state, not a completion Promise.
