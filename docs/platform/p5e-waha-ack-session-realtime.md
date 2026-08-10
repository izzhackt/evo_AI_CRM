# P5E WAHA ACK, session health and private Realtime

## Outcome

P5E turns already authenticated P5A `message.ack` and `session.status` events
into durable, tenant-scoped Platform state and lets the accepted root
`/whatsapp` UI update without a manual browser refresh. It does not call WAHA,
send or mark a message, mutate the `evo-inbox` session, call Gemini, write
amoCRM, use legacy SQLite or change production.

## Durable provider truth

The existing disabled-by-default HMAC worker claims one verified WAHA event at
a time. `message` and `message.any` continue through P5B. `message.ack` must
prove `fromMe: true`, an exact private message binding and a matching documented
integer/name pair:

- `-1 / ERROR`
- `0 / PENDING`
- `1 / SERVER`
- `2 / DEVICE`
- `3 / READ`
- `4 / PLAYED`

Every accepted ACK remains in an immutable private observation ledger. Only the
safe ACK name and observation time are exposed with the authorized message.
Raw WAHA message/chat identifiers and source payloads never enter an RPC row or
page.

`session.status` records the exact bounded status and observation time for the
configured `evo-inbox` session. Provider `data` stays private because it may
contain passkey challenges or other engine-specific values. P5E observes
session health; it never starts, restarts, logs out, pairs or reconfigures the
session.

Replay is idempotent. Older observations may be retained as evidence but may
not move the current exposed ACK or session state backwards.

Primary WAHA sources:

- [WAHA events](https://waha.devlike.pro/docs/how-to/events/)
- [WAHA sessions](https://waha.devlike.pro/docs/how-to/sessions/)

## Realtime authorization and catch-up

Database writes emit only a private `invalidate` Broadcast on
`platform-messaging:<organization UUID>`. The payload contains no conversation,
message, media, provider, contact, student or phone identifier. Realtime RLS
admits an authenticated subscriber only when live Platform membership, JWT
claims and `communication.read.full` authority match that exact organization.
There is no browser Broadcast-send policy.

The browser treats an event only as a hint that server state changed. It calls
`router.refresh()` so the existing server RPC and RLS paths remain the source
of truth. It also refreshes after the first successful subscription, a
reconnection and return to a visible tab. A bounded disconnected fallback may
catch up while WebSocket delivery is unavailable; it is not the primary update
mechanism.

Primary Supabase sources:

- [Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)

## Evidence and rollback

Acceptance must prove exact ACK pairs, unknown/malformed denial, private
binding and tenant isolation, replay and out-of-order behavior, safe session
projection, no raw-ID exposure, receive-only private Broadcast authorization,
browser update without reload, reconnect catch-up and the unchanged P5B/P5C/
P5D paths.

Synthetic local WAHA events prove only the adapter, RLS and browser integration
contract. Real WAHA delivery/session behavior and production enablement remain
blocked until a separately authorized controlled provider run.

Rollback leaves the worker disabled, removes the Realtime client, reverts
server/UI code and forward-fixes additive schema. It does not erase audit
evidence, apply a destructive down migration, retire Lead Agent or alter the
legacy rollback path.
