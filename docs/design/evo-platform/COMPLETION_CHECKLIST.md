# EVO Platform frontend completion checklist

This is the final evidence ledger for the unified frontend.

- `[x]` — implemented in the real root application and verified.
- `[~]` — the frontend state is complete and truthful, but a provider, storage
  or management-owned backend step is not proven.
- `[—]` — intentionally not simulated because the current product has no
  approved or observable contract for that state.

A static example in the design-system catalogue does not complete an
application state. Provider cards, badges and demo records are never treated as
proof of a live integration.

## Product foundation

- [x] Source hierarchy and assumptions documented.
- [x] Information architecture complete.
- [x] Roles and permissions matrix complete.
- [x] Sales stages and operational student stages are visibly distinct.
- [x] amoCRM ownership and unavailable/unverified sync states are represented.
- [x] AI customer communication is draft-only with a manual send boundary.

## Design system

- [x] Brand-compliant foundations and logo treatment.
- [x] Color, typography, spacing, grid, radius, border, elevation and motion.
- [x] Navigation, forms, tables, kanban, status, modal, drawer and feedback.
- [x] Inbox/chat, document, timeline, notification and audit components.
- [x] Hover, focus, selected, disabled, read-only and responsive states.

## Staff Workspace

- [x] Authentication and access states.
- [x] Role-based dashboards.
- [x] Sales funnel and list.
- [x] Lead 360.
- [x] Communications workspace and WhatsApp conversation UI.
- [x] Students list/workspace.
- [x] Student 360.
- [x] Admissions strategy.
- [x] Applications list and detail.
- [x] Documents queue, review and history.
- [x] Visa queue and detail.
- [x] Finance overview and detail.
- [x] Tasks, calendar, calls and meetings.
- [x] Notifications.
- [x] Reports and drill-down.
- [x] Administration, roles, integrations, readiness and audit.

## Student Portal

- [x] Mobile authentication.
- [x] Home/progress/next action.
- [~] Documents and resubmission; the missing upload-storage boundary is shown
  instead of a fake upload success.
- [x] Applications and decisions.
- [x] Visa.
- [~] Payments; local case/payment records are represented, but no payment
  provider is claimed.
- [x] Messages and notifications.
- [x] My EVO Team.
- [x] Profile/security.
- [x] Desktop adaptation.

## System states

- [x] Loading and skeleton.
- [x] Empty and no-results.
- [x] Success and validation.
- [x] System error and recovery.
- [x] No-access, read-only and approval-required.
- [x] Integration missing/unavailable.
- [—] Offline/reconnecting is not shown because the current root application
  does not observe a trustworthy provider connection stream.
- [~] Sync unverified/failed states are explicit; live pending/conflict
  detection is not claimed.
- [—] Transport duplicates are deduplicated server-side; there is no approved
  user-resolvable duplicate-warning workflow to simulate.
- [x] Blocked state with reason, owner and next action.
- [~] Document correction/rejection is complete; upload failure stops honestly
  at missing storage.
- [x] Payment overdue/block/unblock for current local case records.
- [~] Stored message states map to
  received/sent/delivered/read/failed/unknown without inference; a real WAHA
  acknowledgement was not exercised in this frontend audit.

## Clickable application flows

- [x] Inquiry → qualification → meeting → contract → Student 360.
- [~] WhatsApp → prepared AI draft → operator review/manual-send control →
  stored delivery state → follow-up; no real outbound message was sent.
- [~] Document review → correction → resubmission → approval is complete;
  binary upload waits for approved storage.
- [x] Strategy → application → submission → decision → enrollment.
- [x] Visa end-to-end for current case records.
- [x] Payment overdue → resolution → unblock for current local records.
- [—] Admin invitation is not simulated because no approved invitation
  lifecycle exists; role-restricted experiences themselves are verified.
- [~] Student next action → document route → status update is complete; binary
  upload waits for approved storage.

## Responsive and handoff

- [x] Staff desktop at 1440 × 1024.
- [x] Staff tablet at 834 × 1194.
- [x] Student mobile at 390 × 844.
- [x] Staff urgent mobile Inbox/task/notification actions.
- [x] Project index links to every section and flow.
- [x] Assumptions and open decisions are annotated.
- [x] Frontend implementation handoff and validation evidence are complete.

## Final evidence

- Final audit: [`FINAL_FRONTEND_AUDIT_2026-07-24.md`](FINAL_FRONTEND_AUDIT_2026-07-24.md)
- Current browser captures:
  [`implementation-screenshots/final-audit/`](implementation-screenshots/final-audit/)
- Business scenario report: [`../../SCENARIO_EVALUATION.md`](../../SCENARIO_EVALUATION.md)
- Accessibility coverage: [`../../../tests/e2e/platform-accessibility.spec.ts`](../../../tests/e2e/platform-accessibility.spec.ts)
- Responsive/product browser coverage:
  [`../../../tests/e2e/`](../../../tests/e2e/)
