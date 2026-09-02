# ADR 0025: Reuse the connected sales WAHA session for V2

- Status: accepted
- Acceptance scope partially superseded by ADR 0026; the `crm_primary`
  selection remains current
- Decision date: 2026-09-02 (Asia/Dubai)
- Decision owner: EVO product owner
- Execution slices: GitHub issues #566 and #568; webhook transfer remains part
  of the separately controlled production cutover
- Supersedes: the active exact-session selection of `evo-inbox` in earlier
  companion-era launch text and provider configuration contracts
- Retains: ADR 0024 Supabase authority and ADR 0023 human review, explicit send,
  idempotency, ambiguity reconciliation and fail-closed behavior

## Context

Read-only inspection of the existing private sales WAHA service on 2026-09-02
proved that `crm_primary` is already connected, has a provider identity and
reports `WORKING`. The separate companion session `evo-inbox` reports
`SCAN_QR_CODE` without an identity. The owner explicitly directed V2 to reuse
the working sales session instead of pairing the companion session again.

Requiring a new `evo-inbox` QR scan would not prove the intended sales account.
It would create needless re-pairing work and risk a second provider contour.
At the same time, reuse must not revive the frozen V1 sender, writer, webhook
worker or business-data authority.

## Decision

Active V2 uses `crm_primary` as its single WAHA transport session. It reuses the
existing private sales WAHA session/container and server-only credential path;
it does not copy or execute the frozen V1 sender, writer, webhook worker,
database path or UI. Supabase remains the sole V2 business authority for
conversations, messages, proposals, send attempts, receipts and business
events.

The historical `evo-inbox` session and its companion deployment remain
unchanged as rollback/history inputs. They are not an active alias, fallback,
compatibility adapter or parallel V2 UI. Existing immutable migrations and
historical evidence that name `evo-inbox` remain intact; any current binding or
selector is changed through a reviewed forward migration or provisioning
correction.

Local #566 acceptance may query and exercise `crm_primary` through the new
Supabase-backed V2 provider path under the standing bounded-provider
authorization. It must not change the current production webhook owner. In
particular, local inbound proof may use an existing provider event/readback or
the verified signed projection boundary without registering a second webhook.

Production webhook ownership transfers only in the separately controlled
cutover. Before V2 inbound traffic is enabled, execution must inventory both
per-session and global webhook configuration, stop the superseded V1
sender/writer/webhook worker, install the single V2 target and prove that only
one active runtime can process an inbound event. Open-ended coexistence or dual
processing is prohibited.

## Acceptance and exit conditions

- Sanitized provider proof identifies exactly `crm_primary`, `WORKING` and the
  expected bound identity without exposing the identity or credential.
- #566 and #568 prove the V2 server path, correlated Supabase state, exact
  provider readback and idempotent replay without invoking a frozen V1 path or
  creating duplicate effects.
- A scoped runtime/import/config inventory finds no active `evo-inbox`
  fallback, V1 sender/writer call, dual read/write, compatibility repository or
  parallel provider UI in the replaced V2 capability.
- Local acceptance leaves the current production webhook ownership unchanged.
- Before production inbound cutover, evidence shows the superseded owner is
  inactive and exactly one V2 webhook consumer is enabled.
- If `crm_primary` is missing, unhealthy, ambiguous or bound to an unexpected
  identity, execution fails closed. It does not select `evo-inbox`, re-pair an
  account, retry blindly or mutate a webhook to make the check pass.

## Consequences

V2 can validate the real sales WhatsApp path immediately without a redundant QR
scan, while retaining one Supabase authority and one eventual runtime. Provider
session reuse is deliberately narrower than production ownership transfer, so
the local product proof does not create two inbound processors.

## Official source verified 2026-09-02

- WAHA session lifecycle and `WORKING`/`SCAN_QR_CODE` states:
  <https://waha.devlike.pro/docs/how-to/sessions/>
