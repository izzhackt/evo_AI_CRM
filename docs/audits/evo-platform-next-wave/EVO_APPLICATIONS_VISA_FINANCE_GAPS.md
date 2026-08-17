# EVO applications, visa and finance gaps

Status: evidence-backed audit draft; no runtime or production change
Baseline: origin/main d243b2bb370d052750278e7f5cc2625991d5f870, 2026-08-17

## Executive finding

All three domains have Supabase-native schema/RPC foundations and case-level
projections. Applications has a connected global Platform route. Visa and
Finance global routes remain legacy SQLite. Evidence is code/local only.

## Applications

Present: separate applications/events, evidence-required statuses, approved
institution catalog/provenance and connected staff/Portal views.

| Priority | Gap | Closure |
| --- | --- | --- |
| P0 | Deadline and application intake absent | Versioned source/effective date/checked-at/stale fields |
| P0 | No university provider submission | Later real integration with idempotency/reconciliation |
| P1 | Program not normalized/versioned like institution | Reviewed program catalog/revision |
| P1 | No mutable-fact freshness policy | Source revision and stale state |
| P1 | No deadline attention workflow | Task/notification connection |

## Visa

Present: Curator-owned status model, evidence rules, events, Student 360 action
and Portal projection.

| Priority | Gap | Closure |
| --- | --- | --- |
| P0 | Global visa route is legacy | Platform-native queue/detail |
| P0 | Appointment not connected | Persisted timezone/source-validated appointment |
| P1 | Evidence/next-action timeline incomplete | Connected event timeline |
| P1 | Country checklist not composed | Link applied country requirements |
| P1 | Reminder catalog absent | Reviewed appointment/deadline notifications |

## Finance

Present: obligations, payment/refund/adjustment events, evidence, stop factors,
safe Portal projection and no fake bank/1C/Excel connector.

| Priority | Gap | Closure |
| --- | --- | --- |
| P0 | Global finance route is legacy | Platform-native Finance queue/detail |
| P0 | Finance role cannot mutate connected records | Dedicated Finance-safe guard/workspace |
| P1 | UI covers only obligation/full settlement | Partial payment, refund/adjustment and evidence flow |
| P1 | Stop-factor UI absent | Create/resolve workspace with audit |
| P1 | Evidence file path absent | Dedicated protected evidence slot and review |

## Recommended order

1. Replace Visa and Finance legacy queues.
2. Expose Finance-safe actions without admissions access.
3. Add application deadline/intake/source freshness and visa appointment.
4. Connect complete finance events/evidence and stop factors.
5. Add bounded attention/notification states.
6. Only then plan provider integrations.

An application offer does not approve a visa, payment does not advance an
application, and visa approval does not close the case automatically. No
managed, external-provider or production success is claimed.
