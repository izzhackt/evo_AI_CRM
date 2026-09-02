# ADR 0026: Remove live WhatsApp target acceptance from the active sequence

- Status: accepted
- Decision date: 2026-09-03 (Asia/Dubai)
- Decision owner: EVO product owner
- Affects: issues #549, #566 and #568; the live-provider acceptance portions
  of ADR 0025
- Retains: ADR 0024 Supabase authority, the `crm_primary` session selection,
  explicit staff send semantics, human-reviewed Gemini, idempotency,
  reconciliation and fail-closed behavior

## Context

The active #566 gate required an actual inbound message from a controlled
second WhatsApp account, followed by one Gemini proposal, human review, WAHA
send and exact readback. The connected sales session `crm_primary` is already
`WORKING`, but the owner does not currently have access to the controlled
second account and directed the program to remove this test and continue.

An outbound/self message is not equivalent to an inbound provider event, and
an arbitrary customer conversation is not an acceptable substitute. Treating
either as acceptance would create false evidence and unnecessary exposure of
customer data.

## Decision

The controlled-inbound Gemini/WhatsApp send exercise is removed from the active
#566 merge gate, from #568, and from the successor completion checklist. It is
not replaced by a mock, fixture, self-send, random customer chat or inferred
success.

#566 proves the Supabase-backed communications implementation with real local
Supabase/PostgreSQL, application and Chromium execution, server-boundary tests,
idempotency/ambiguous-result tests, legacy-eradication inventory and read-only
verification that the exact `crm_primary` provider session is configured and
`WORKING`. These checks prove implementation and fail-closed readiness; they do
not prove real Gemini generation or WhatsApp delivery.

#568 becomes an exact-main single-runtime, configuration and legacy-eradication
inventory. It performs no Gemini call, WhatsApp send, amoCRM write, selected
inbound replay or webhook mutation. Existing guarded provider-acceptance tooling
may remain as a non-gating operator utility, but it is not part of the active
plan and its presence is not evidence of provider success.

## Consequences

- The core Supabase successor work continues without waiting for access to a
  second WhatsApp account.
- Reports, PRs and completion audits must state that live Gemini/WhatsApp
  delivery was not exercised; no production/provider-success claim may be made
  from CI, local browser tests or `WORKING` session health alone.
- `crm_primary` remains the only active target and no QR scan or `evo-inbox`
  fallback is introduced.
- A future live-provider exercise may happen only if the owner separately asks
  for it and supplies an authorized target. It is not a pre-created active
  blocker or issue in this program.
- Production webhook transfer and customer-data cutover remain separately
  controlled actions; this ADR does not authorize either.

## Official source verified 2026-09-03

WAHA documents `WORKING` as a session that is connected and ready to use, while
also documenting conditions such as Reachout Timelock where the session remains
`WORKING` but sending to new contacts fails. Session health therefore supports
readiness inventory but is not delivery evidence:

- <https://waha.devlike.pro/docs/how-to/sessions/>
- <https://waha.devlike.pro/docs/how-to/send-messages/>
