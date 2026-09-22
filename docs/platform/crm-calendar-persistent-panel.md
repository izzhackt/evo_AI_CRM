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
  Recheck current rights/preview; ignore obsolete candidate results. Exact fresh candidates unlock
  editing even when the former assignee is no longer eligible, so the user can repair the selection.
  Save remains disabled until the current selected assignee is eligible; no automatic submission.
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


## 22 September 2026 — confirmed native-picker Escape correction, before code

Actual checks on source `0a01800b321e81a04c6d520c46baf5a3aa7a2d15` preserved one form,
draft/request ID and focus/selection across 1440/390/320, and real internal scrolling. The first
native-select Escape check stopped; a bounded passive follow-up confirmed `select:open=true`
and focus before Escape, then the dialog cancel handler closed the panel. Both STOPs remain
recorded; subsequent picker state, target/history and typography checks were not proved.
Follow-up trace SHA256: `e9406f4bfeb62ff44205771d1ddccb8875a55fe90faecd44682d018812bef6d7`.

Fix only CalendarPanel's keyboard/cancel handling: capture a real Escape on an actually open
native select, leave its keydown default intact, skip the matching desktop handler and consume
only its paired dialog cancel. Keep an event-identity/cancel-pending ref through native default
processing; clear on keyup, pointerdown, fresh keydown, panel lifecycle and unmount. Repeated
keydown from the same held gesture retains its provenance. A focused closed select gets ordinary
Escape-close behavior. No microtask expiry (observed before native cancel), timer UX, custom
picker, focus-only exemption or native close event handler. Form/actions, geometry and focus
return remain unchanged; Impeccable Operate prioritizes the existing native interaction.

After the runtime was strictly closed, ROOT admitted this narrow correction under the existing
16b contract. Scoped lint/typecheck/diff and relevant existing checks are source proof. New real
regression must establish picker closed AND panel still open after the first Escape, followed by
normal panel close on a separate Escape from the same closed select, in modal/mobile and
nonmodal/desktop modes; ordinary title Escape and Close remain. Reuse unchanged layout evidence.
No mock native event test substitutes for browser behavior; actual correction acceptance is pending.
[MDN cancel](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/cancel_event)
and [WHATWG close requests](https://html.spec.whatwg.org/multipage/interaction.html#close-requests-and-close-watchers)
were checked for the narrow event contract. This is a behavioral defect correction, not further
visual polishing; it does not claim saved/stale/unknown outcomes or production acceptance.
