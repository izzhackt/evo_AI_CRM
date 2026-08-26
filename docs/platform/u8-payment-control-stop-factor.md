# U8 minimal payment control and finance stop-factor

Status: active Issue #385 implementation contract rebound to verified U7 main

- Parent: #376
- Dependency satisfied: U7/#384 merged through PR #399 at exact main
  `bbc78a376b017a1d068c20ccce7978a128858371`; exact-main run `33004299957`
  completed successfully
- Current base: exact verified U7 main above; U8 retains its own exact-head,
  protected `--match-head-commit` and exact-main gates
- Plan authority: ADR 0021 and `EVO-LONG-RUN-1-U8-FINANCE-CONTROL-2026-08-26`
- Evidence boundary: repository plus disposable local Supabase only; no managed,
  production, provider, WhatsApp, WAHA, amoCRM or customer-data mutation

## Outcome

Admissions staff can see a truthful operational payment schedule for the
canonical Student Case, understand whether money is due, overdue or settled,
and see explicit finance stop factors that halt downstream work. The same
canonical facts appear in the connected case and relevant manager queues with
bounded audit history. EVO remains an internal operational control surface, not
a bank, payment gateway or accounting replacement.

## Canonical boundary

- `platform.student_cases.id` remains the only case identity.
- `platform.payment_obligations`, `platform.payment_events`,
  `platform.stop_factors` and `platform.stop_factor_events` remain the only
  finance/stop-factor records for this slice.
- Supabase/PostgreSQL remains canonical. U8 may add hardened RPC/read-model
  surfaces and connected adapters, but it must not use SQLite, fixture data,
  dual-read, dual-write or a browser-only stop-factor state.
- Existing finance permissions remain authoritative:
  `finance.read.summary`, `finance.read.full`, `finance.event.confirm` and
  `finance.stop.manage`. The later U1 boundary additionally requires the
  individual `finance.first.payment.confirm` grant for payment confirmation.
- Finance remains a module. The pilot roles stay `sales`, `curator` and
  `admin`; stop-factor management remains in the approved Admin bundle, while
  first-payment confirmation remains individually granted. Both are proven
  inside SQL, not inferred from route access or UI controls.

## Supabase security basis

Official Supabase guidance checked on 2026-08-26:

- [Database Functions](https://supabase.com/docs/guides/database/functions)
  requires extra care for `security definer` functions, including an explicit
  `search_path`, and recommends revoking the default function execute privilege
  before granting only the intended roles.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
  explains that exposed tables need RLS policies tied to the authenticated
  caller.
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
  explains that table grants and RLS are complementary controls.

Therefore the U8 read-model functions use an empty `search_path`, fully
qualified object names, explicit `REVOKE`/`GRANT`, and their own tenant and
permission checks. A browser route, UI role check, or table policy alone is not
accepted as authorization proof.

## Existing operations to reuse

U8 reuses the accepted finance foundation instead of creating parallel tables or
mutations:

- case-scoped finance summary: `platform.case_finance_summaries()`;
- existing connected case snapshot and case queue reads:
  `platform.staff_student_case_page(...)` and
  `platform.staff_student_case_read_snapshot(...)`;
- existing connected case finance adapter:
  `listPlatformCaseFinance(...)`;
- existing payment mutation path where still in scope:
  `platform.record_payment_event(...)` through the connected server action;
- stop-factor mutation paths:
  `platform.create_stop_factor(...)` and
  canonical `platform.resolve_stop_factor(...)`, reached from the browser
  through the exact-case `platform.resolve_case_stop_factor(...)` wrapper.

Every mutation keeps request UUID, tenant, permission, replay and audit
contracts. If a stop resolution commits but its response is lost or malformed,
the server action makes one immediate byte-equivalent retry with the same
request UUID so the canonical replay receipt can reconcile the result before
the active stop disappears from the page. U8 does not add a hidden operator
convention or client-side bypass.

## Staff surfaces

The connected canonical `/clients/[caseId]` page must show:

- the expected payment checkpoints/schedule needed for the pilot;
- derived due, overdue, partially paid, paid and remaining state for each
  checkpoint;
- active stop factors, their reason/evidence owner, and whether they block
  downstream work;
- a bounded finance history that makes payment/stop-factor changes auditable;
- truthful actions only when the actor has the existing approved permission
  path.

Relevant manager queues must show enough signal to route work without opening a
separate finance product:

- case queue visibility should surface overdue/blocked finance state for the
  canonical case;
- connected application/admissions queue surfaces may show the bounded blocked
  interpretation when a finance stop factor prevents downstream progress;
- the application queue must request finance state for the exact canonical
  case IDs on the current application page. A separate global top-N finance
  slice must not be interpreted as zero overdue items or zero stop factors for
  a page row that was absent from that slice;
- queue signals must come from hardened platform read models, not ad hoc joins
  in the browser.

The legacy `/finance` route may remain as historical read/write surface, but it
is not U8 proof and must not become the implementation authority for connected
Admissions payment control.

## Blocked-work interpretation

U8 must explain blocked downstream work using explicit canonical facts:

- payment due or overdue alone is operational state, not automatically a stop
  factor;
- an active stop factor is the explicit halt reason and must name the blocked
  work in bounded staff language;
- resolution by payment event versus manual override must remain distinguishable
  and auditable;
- only Admin may resolve a stop factor by override if the underlying SQL
  contract says so; the UI must not suggest a broader authority.

## Required proof

- Migration history stays contiguous and a clean reset succeeds.
- Disposable PostgreSQL/Supabase tests prove:
  allowed and denied finance-stop create/resolve paths;
  cross-organization finance visibility denial;
  unauthorized finance mutation denial;
  blocked-downstream interpretation derived from active stop factors;
  bounded finance history/audit visibility.
- Unit tests prove strict connected normalization, exact RPC arguments,
  malformed/foreign response rejection, one bounded lost-response
  reconciliation with one audit event, and truthful blocked-state mapping.
- Local authenticated browser proof starts from a real U6/U7 canonical case and
  shows schedule, overdue state, stop-factor assertion/clearance, blocked
  interpretation and history on that same case without touching external
  providers.
- Existing U1-U7, security, lint, typecheck, build and exact-head/exact-main
  gates remain green.

## Exclusions

No banking, payment gateway, bookkeeping, accounting replacement, outbound
WhatsApp reminder, amoCRM write, hidden stop-factor convention, provider call,
legacy fallback, production deployment or managed Supabase/customer-data
mutation is part of U8.
