# Item22: compact mobile CRM header

2026-09-22. Base `43410559be30375d51c4a0be0de4f0d3449bd7e2` after #1019. This is a bounded refinement of the existing EVO Operate surface, not a new shell. Product work begins after this precode checkpoint.

## Why and exact change

Current ordinary Admin screenshots from the accepted #1019 manage path show two full header rows on390/320. Keep both rows, logo132px, visible «Создать задачу», menu, single notifications instance and all roles/handlers. Reduce only responsive spacing in `src/components/v3/AppShell.tsx`:

- Logo/menu row: `py-3` → `py-2`; retain `md:px-6 md:py-5`.
- Global actions: `min-h-16 py-2` → `min-h-14 py-1 md:min-h-16 md:py-2`; preserve wrapping, gap and horizontal padding.

No fixed height, hidden action, typography/token change, data/API/permission/migration change or desktop redesign. Natural row growth remains possible. Expected normal-height saving is about16px; it is a hypothesis until actual measurement. The earlier private proposal's4px top padding is superseded by8px because the existing logo focus outline uses2px width plus4px offset. [CSS outline-offset](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/outline-offset) places the outline outside the element; preserve visible keyboard focus.

## Existing evidence and independent direction

Existing AppShell/StaffNotifications bytes match accepted source4bf6. Incumbent images `manage-after-{1440,390,320}.png` belong to the accepted #1019 actual batch; reuse as historical visual evidence, not a new run. Existing sidebar destination state, task UUID/modifier-click semantics, notification state/polling, preview return, skip link, focus/order and44px controls remain unchanged.

Private precode v2 SHA627a4cfff2e6d7d759c9453d234f0765dfdebb635ec766da1b1e6fcba3a1f772; independent review c242de8ba0f7befff682d6e7902a96df85cb6a147ccbf2235908bdf51b205ae9 and revised-padding addendum ac1da62cb3085df6cf0a3b2957f2d7e733e7e55c405dce895adf6255cc355bb1. Impeccable context is already loaded for this session; read craft-floor immediately before editing, preserve EVO/Golos and existing actions.

## Narrow actual validation

Use the same existing manage route as #1019 instead of the older private proposal's chat route. This explicit scope amendment exercises the shared shell against fresh incumbent images and avoids unrelated chat seen effects or overlap with A1020. It is not chat acceptance.

One ordinary existing Admin session after the current B→A shared QA owners release. One1440/390/320 batch: actual header geometry, no horizontal overflow, visible unchanged actions and44px targets. One keyboard sequence: skip link, realTab to logo with computed outline/viewport geometry and one additional320 focus screenshot, ShiftTab back, skip-to-content, menu open/Escape/focus, notifications open/Escape/focus. Opening notifications may invoke its ordinary read action; do not activate notification read/mark-all, create a task, change roles, submit forms or create fixtures. Preserve existing Auth/data boundaries and close only owned resources.

Exactly four screenshots in one planned pass; at most one corrective pass if a demonstrated defect requires it. Existing images alone do not establish a precise pixel reduction. Standard CLI has no verified text-only browser zoom control: retain that explicit gap rather than simulate it with CSS injection/device scale. Existing preview/badge/role variants absent from current authorized inputs remain source evidence only. No VoiceOver/WCAG/native/full E2E/production claim.

Scoped AppShell lint and normal TypeScript check; inspect exact diff and independent review. No CSS-mirror unit test or broad unrelated suite. Final exact-head protected checks and independent real-evidence review before merge.

## Actual checkpoint — 22 September 2026

Source e999 passed one ordinary Admin batch at1440/390/320 plus320 logo-focus screenshot. Mobile row heights are76.328125px and56px; bottom133.328125px. Controls≥44px, no horizontal overflow, keyboard sequence PASS. Computed focus outline is2px with3px offset (the earlier4px was an assumption). No paired16px saving or text-onlyzoom is claimed. Strict final and owned cleanup accepted independently441f869a; original port timeout preserved, later read-only closure PASS. See [actual receipt](../qa/crm-mobile-header-spacing-actual-2026-09-22.md). Final-head review/CI/merge remain separate.
