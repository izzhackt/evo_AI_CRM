# ADR 0016: Greenfield Platform UI and data boundary

- Status: historical boundary; accepted UI/Supabase direction retained, but
  no-legacy-import and execution-order clauses superseded by ADR 0020
- Date: 2026-07-30
- Supersedes in conflict: legacy migration/cutover assumptions in ADR 0014 and
  ADR 0015
- Refines: the retained target architecture and Supabase foundation decisions
  in ADR 0014 and ADR 0015
- Superseded in conflict by: ADR 0020

Specifically superseded are ADR 0014's SQLite inventory/import/dual-read
sequence and fixed-duration retirement gate, plus ADR 0015's root-client
identity migration and P2I-as-a-prerequisite language. Those texts remain
historical decision context, not current implementation authority.

## Context

The repository now has an accepted unified frontend contract from PRs #64, #71
and #72, plus reusable repository-level Supabase foundation work through
P2A-P2H. The current deployed reality remains split across root SQLite/custom auth, EVO
Inbox Supabase/WAHA and EVO Lead Agent. The next product step must keep one UI
while avoiding accidental extension of the legacy root data plane or a parallel
Inbox UI.

## Decision

1. The Platform backend is greenfield and Supabase-native.
2. Platform work does not import legacy SQLite data or accounts, does not
   migrate root auth into Platform, and does not use dual-read or dual-write
   between legacy and Platform planes.
3. The merged unified frontend from PRs #64, #71 and #72 is the sole product UI
   contract. Platform implementation wires that UI through repository/session
   seams rather than replacing it or reviving a parallel Inbox UI.
4. The first product slice is thin operator messaging only:
   conversation list/thread, necessary contact/student context, WAHA
   receive/send, ACK/delivery, AI draft, staff manual send, approved knowledge,
   audit and minimal health/settings.
5. Inbox CRM/dashboard/pipeline/deal/lead/broadcast/flow/campaign/unrelated
   analytics/settings surfaces are excluded from the thin slice.
6. P1 containment remains historical legacy reference. P2A-P2H remain reusable
   greenfield foundation. Former P2I restore duties move to P7 and do not
   block the thin slice.
7. Controlled cutover evidence requires a bounded evidence window with zero
   unexplained loss or duplicates, health checks and rollback proof. A fixed
   duration soak is not required by contract.

## Consequences

- The existing root SQLite/custom-auth runtime remains separate reference and
  is not the Platform evolution path.
- The first Platform implementation effort focuses on backend seams under the
  existing frontend, not on parallel UI or broad backend parity.
- Broader Student 360 and non-messaging operational domains follow after the
  thin messaging slice and bounded provider proof.
