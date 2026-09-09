# China/Malaysia Admissions implementation contract

Status: implementation started 2026-09-09; no deployment claim.
Parent: [run plan](student-admissions-run-plan.md), [DESIGN](../../../DESIGN.md).

## Authority and reuse

Continue the existing Sales → case → tasks/documents/applications/visa/finance
path. Full operational content: CN and MY. EUROPE/AE/TR are typed direction
filters only until their regulations are supplied. Historical direction may be
unknown; migration must not guess from names or silently bind templates.

Preserve immutable applied OZO and country-requirement versions. An editorial
playbook is an additional immutable, versioned checklist, not a replacement.
Cases use one existing `operational_stage` and a separate `admissions_version`.
Existing related object optimistic versions and least-privilege scope remain.

## Data and command surface

Migration137 owns schema, permission checks, replay receipts, transitions, reads
and regression tests. Migration138 owns original reviewed playbook seed only.

- Cases: direction, playbook version, admissions revision, next-action date,
  structured intake/selection/travel/housing/arrival/post-arrival facts.
- Existing applications: structured partner handoff and decision evidence,
  including distinct actual university submission date/reference/proof.
- Existing visa cases: CN/MY structured facts, no universal inferred fees or visa.
- Private immutable playbook versions: `id`, `direction`, `version`, `title`,
  `content` JSON, `published_at`. `content` contains `stages`, `tasks`, `messages`,
  `sources`, `limitations`; no personal contacts, private examples or documents.
- Append-only admissions events: actual transitions/arrival events for truthful
  period reporting. No assessment results in any staff projection.

Planned authenticated RPC commands: configure case admissions; update case facts;
transition stage; update application admissions details; update visa country
details. Read RPCs: case workspace, direction summary, existing paginated case
directory extended with direction/curator/attention. Implementation owner publishes
the exact typed payload contract before UI integration. All writes validate exact
allowlists, live authority, case/org relationship, expected revision and request ID.
Replay is payload-bound and returns the original receipt. Consistent locks cover
the facts checked by transitions. Existing RPCs must not bypass new invariants.

## Stage gates

| Key | User label | Evidence required to advance |
| --- | --- | --- |
| intake | Приём дела | Existing Sales handoff, acknowledgement accepted, next action/date |
| profile_and_route | Выбор программы | Approved route, confirmed selection, primary application |
| documents | Документы | Applicable primary-application documents reviewed or explicit scoped exception |
| applications | Подача через партнёра | Actual university submission proof; partner receipt is insufficient |
| decisions | Решение университета | Selected offer/decision evidence; necessary conditions fulfilled |
| visa_and_predeparture | Виза | Actual travel eligibility, applicable entry evidence, finance blockers resolved |
| arrival_and_adaptation | Поездка и прибытие | Actual arrival date, confirming person, supporting evidence |

Progression follows the primary application; alternative applications remain
independent. Completed means confirmed arrival. Cancelled/closed without arrival
is a separate explicit reasoned outcome, never counted as successful arrival.
Back-steps require a reason and preserve facts. User evidence is recorded as such,
not mislabeled as provider verification. Finance operations stay in Finance.

## Malaysia-specific distinctions

Referral agency, university and submission partner are separate. Capture campus,
intake, programme/selection; offer type/conditions/deadline; references to tuition,
administration and visa invoices/obligations/receipts without duplicating amounts.
Track EMGS and eVAL separately; entry visa and MDAC each have required/not-required/
needs-confirmation applicability, dated official source and reason. Housing has
budget/currency, campus, move-in date, approved option, contract/deposit terms and
booking confirmation. Approval does not mean payment. Departure is not arrival.
Medical, university registration and Student Pass endorsement remain separately
pending after arrival unless explicitly evidenced. No automatic post-arrival
completion, universal payment percentage, visa-on-arrival rule or guessed timing.

## UI and acceptance

One «Поступление» area on existing `/v3/profile`; calm work rows, direction switch,
focused next action and optional detail sections. Existing application/visa/
document/task/finance controls remain discoverable. Manager summary counts full
visible data, not only the current page. Filter links reproduce the same set.
Editable message templates show «Скопировано», never «Отправлено».

Required isolated real-backend journeys: CN and MY from Sales handoff to arrival,
partner receipt without submission, conditional offer, corrections, visa unknown,
finance stop, stale writes/replay, old-RPC bypass, alternate applications, curator
scope/cross-org denial, report pagination/period semantics, mobile and keyboard.
No provider sends or real customer mutations for QA. Exact-head independent review
and CI precede merge; managed production release uses its separate runbook.
