# P5C WAHA history reconciliation

## Outcome

P5C adds a disabled-by-default, server-only and read-only reconciliation lane
for the single approved WAHA session `evo-inbox`. It imports the history that
the currently deployed WAHA engine and store can actually return into the
existing Supabase conversation/message model used by the accepted root
`/whatsapp` frontend.

This block does not send, edit, delete, mark as read, restart, log out or
reconfigure anything in WAHA. It does not call amoCRM or Gemini, infer a
canonical Sales owner, expose a provider secret to the browser, or use the
legacy SQLite data plane.

## Provider contract

The implementation follows the current primary WAHA documentation:

- chats are read with `GET /api/{session}/chats` using `limit` and `offset`;
- messages are read with
  `GET /api/{session}/chats/{chatId}/messages` using `limit`, `offset` and
  `downloadMedia=false`;
- an offset advances by the requested limit, including when a provider page is
  shorter than the limit;
- only direct chats whose canonical identifier ends in `@c.us` enter this
  Platform slice; groups, status and broadcasts remain outside the MVP;
- the session must be exactly `evo-inbox`, have status `WORKING` and report a
  supported engine;
- NOWEB history is unavailable unless `config.noweb.store.enabled` is
  explicitly true. The Platform reads this setting but never changes it.

References:

- [WAHA chat and message history](https://waha.devlike.pro/docs/how-to/chats/)
- [WAHA session lifecycle](https://waha.devlike.pro/docs/how-to/sessions/)
- [NOWEB Store and full-sync limits](https://waha.devlike.pro/docs/engines/noweb/)

“Available history” is deliberately literal. It means the rows returned by the
existing provider store. It is not a claim that WhatsApp exposes lifetime
history, that old media bytes still exist, or that a disabled NOWEB store can
be repaired without a separately authorized session change.

## Fail-closed runtime

The private trigger is accepted only when the history feature is explicitly
enabled, every backend credential is present, the request carries a fresh
HMAC, the configured URL passes the private-network boundary, and the provider
preflight passes. Provider or Supabase failures keep the durable cursor at the
last committed page and return an unavailable result; they do not fabricate a
successful import.

Each invocation has a fixed page/time budget. A bounded invocation that still
has work records `paused`; the next authenticated invocation resumes the same
run. Reaching the end records `completed`. Cursor movement and page projection
commit atomically.

## Data and identity boundary

Raw chat identifiers, raw message identifiers and provider response bodies are
private evidence. Public Platform rows keep provider IDs null and use the P5B
private binding seam. The browser receives only opaque Platform UUIDs and the
existing role/RLS-scoped read contract.

History imports both directions:

- inbound rows are shown as customer messages;
- outbound rows are shown as historical staff-side messages with explicit
  history provenance. They are not falsely represented as a Platform manual
  send and do not create a manual-send authorization;
- an empty text body with `hasMedia=true` becomes an operator-visible media
  marker. P5C does not download media bytes. Private archival and safe display
  belong to the next P5 block;
- an empty non-media item is rejected instead of producing an invented
  message.

The configured Sales membership is an intake-queue authorization only.
Existing conversation assignment is preserved, and no history row creates an
amoCRM identity, stage or handoff claim.

## Service RPCs

The server uses three service-role-only, organization/session-bound RPCs:

1. `platform.begin_waha_history_reconciliation` creates or resumes a run and
   returns the durable chat/message offsets.
2. `platform.project_waha_history_page` stores the private provider evidence,
   idempotently projects a normalized page and advances the cursor in the same
   transaction.
3. `platform.finish_waha_history_reconciliation` records `paused` or
   `completed` without changing provider state.

Anonymous and authenticated browser roles have no direct table or mutation-RPC
access to history runs, observations, checkpoints, effects or raw bindings.

## Evidence and rollback

Local acceptance must prove configuration and HMAC denial, URL/SSRF denial,
session/engine/store preflight, provider pagination, inbound/outbound ordering,
media marker behavior, replay/conflict handling, tenant isolation, assignment
preservation, raw-ID non-exposure and the accepted `/whatsapp` read path.
Synthetic local WAHA responses prove only our adapter and authorization
contracts; they are not real-provider proof.

Rollback is flags off plus code revert. Migration changes are additive and are
repaired forward; no destructive down migration is part of this block. Real
WAHA proof remains blocked on private credentials, the live engine/store state,
a sanitized test chat and explicit provider-test authority.
