# EVO Student 360 gap report

Status: evidence-backed audit draft; no runtime or production change
Baseline: origin/main d243b2bb370d052750278e7f5cc2625991d5f870, 2026-08-17

## Present in connected code

The clients/id adapter composes scoped case, Sales handoff summary, route,
profile, country checklist, applications, documents, visa, safe finance and
contract/checklist report. Admin assignment and lifecycle use dedicated RPCs.
Local authorization tests exist; managed/production proof does not.

## Gaps

| Priority | Gap | Evidence | Closure |
| --- | --- | --- | --- |
| P0 | Tasks absent | Adapter returns empty tasks/columns/assignees | Connect task repository/actions/UI and role/audit tests |
| P0 | Updates/timeline absent | Adapter returns empty updates; stage timeline static | Actor/source/time case updates and Portal publication |
| P0 | Case audit hidden | Audit empty and view flag false | Bounded case audit viewer using migration 071 |
| P0 | amoCRM context incomplete | Only responsible Sales name; no lead/contact/stage/freshness | Read-only canonical context with real mapping proof |
| P0 | Split backend | Global documents, visa and finance routes use legacy SQLite | Platform-native queues sharing Student 360 repositories |
| P1 | Application deadline/intake missing | Deadline mapped null; no application fields | Versioned source-backed fields and overdue tests |
| P1 | Visa appointment missing | Connected appointment mapped null | Persist and validate appointment/timezone/source |
| P1 | Team contacts placeholders | Email dash and phone null | Safe assignment-derived contact projection |
| P1 | Finance role blocked | Admissions guard denies Finance; payment actions Admin-only | Dedicated Finance-safe workspace |
| P1 | Closure readiness incomplete | Risk counts only | Full open-item/storage/owner readiness projection |
| P1 | OZO/checklist warning not actionable | Warning only | Named Admin owner, deep link and completion state |
| P2 | Identity incomplete | Student email/phone empty | Minimized canonical identity projection |
| P2 | AI summary disabled | Explicit false capability | Draft-only cited summary after record completion |
| P2 | Metrics misleading | Open counts use overdue counts | Exact definitions and freshness |

## Recommended order

1. Connect tasks, updates and closure readiness.
2. Replace legacy global operations queues.
3. Add amoCRM context only after real mapping/freshness proof.
4. Add application deadline/intake and visa appointment with provenance.
5. Expose Finance-safe actions.
6. Add case audit, then draft-only AI assistance.

Production completion requires real Admin, Sales, Curator, Finance and Student
identities in managed Supabase and consistent state across Student 360, global
queues and Portal. Fixture/local CI is insufficient.
