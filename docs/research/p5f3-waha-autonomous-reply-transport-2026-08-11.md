# P5F3 WAHA autonomous inbound-reply transport research

Research date: `2026-08-11`

Scope: current primary-source verification for the already authorized P5F3
code slice. No real provider call, credential use, customer data, production
mutation or live WhatsApp send was performed.

## Result

The accepted P5F3 architecture remains the smallest defensible autonomous
lane:

1. Gemini produces a structured proposal but has no transport authority.
2. Deterministic EVO policy either records a blocked human-review decision or
   creates one durable, single-use send intent.
3. A private worker claims that intent, re-checks every mutable gate, verifies
   the exact WAHA session is currently `WORKING`, and only then calls
   `POST /api/sendText` with `session`, `chatId`, `text` and `reply_to`.
4. An accepted HTTP response means only transport acceptance. WAHA
   `message.any` and monotonic `message.ack` observations remain the delivery
   evidence.
5. A timeout, connection loss or structurally ambiguous response becomes
   `unknown` plus human review and is never retried automatically.

## Current official WAHA contract

- WAHA documents `POST /api/sendText` for all current engines and documents
  `reply_to` as the provider message identifier being answered:
  https://waha.devlike.pro/docs/how-to/send-messages/
- WAHA documents `message.any` for all created messages, including messages
  sent through the API where `source` may be `api`. It separately documents
  ACK progression `ERROR=-1`, `PENDING=0`, `SERVER=1`, `DEVICE=2`, `READ=3`
  and `PLAYED=4`:
  https://waha.devlike.pro/docs/how-to/events/
- WAHA documents `WORKING` as the session state ready for use, but also warns
  that an active `me.reachoutTimelock` leaves the session `WORKING` while
  outreach fails. The worker must require an explicit `null` or
  `isActive: false` timelock and fail closed on active, missing, or malformed
  state:
  https://waha.devlike.pro/docs/how-to/sessions/

The current Sessions guide documents `reachoutTimelock` on the `me` object
returned with the session and by `GET /api/sessions/{session}/me`. The field is
`null` before enforcement is observed, or carries `isActive`. The OpenAPI
schema may lag this guide, so the implementation validates only this bounded
documented gate and otherwise fails closed. The stronger application invariant
still requires every send to reply to the exact latest inbound message in the
same direct chat. A WAHA 5xx remains ambiguous because the transport could fail
after accepting work; it is recorded as `unknown` and is never retried
automatically.

The browser never calls these endpoints. Raw chat and message identifiers stay
inside private server/SQL bindings.

## Important 24-hour clarification

Meta's customer-service-window and template rules describe the official
WhatsApp Business Platform. EVO currently uses WAHA, a separate transport over
community-driven WhatsApp engines. Therefore P5F3 must not claim that WAHA
itself enforces Meta Cloud API's 24-hour rule.

EVO nevertheless keeps `<=24h` from the exact customer inbound as a stricter
internal safety policy. It reduces accidental proactive outreach and matches
the owner's approved reply-only boundary. It is a deterministic EVO gate, not
provider proof and not a promise of Meta/WAHA compliance.

Primary policy reference:
https://business.whatsapp.com/policy

## Frozen MVP policy values

- policy version: `p5f3-v1`;
- exact session: `evo-inbox`;
- language: `ru` or `en`;
- proposal confidence: at least `85`;
- proposal risk: exactly `low`;
- handoff: false, with no handoff reason;
- allowlisted intents: `greeting`, `admissions_discovery`,
  `program_or_country`, `documents`, `deadline`;
- business hours: `09:00-21:00` in `Asia/Bishkek`;
- minimum autonomous-send cooldown: `60` seconds per conversation;
- maximum autonomous sends: `6` in a rolling 24 hours;
- maximum consecutive autonomous replies without staff participation: `3`;
- one intent for one exact latest inbound source/proposal;
- runtime enablement must be explicit and the emergency kill switch must be
  explicitly disengaged;
- opt-out, media-only/unsupported content, staff takeover/manual outbound,
  stale source, missing approved evidence, unhealthy session, exhausted rate
  budget or any ambiguous provider result requires human review.

These are application safety limits. They are not inferred WAHA features.

## Evidence boundary

A disposable Supabase plus loopback WAHA fixture may prove the local adapter,
queue, RLS, idempotency, accepted UI and ACK flow. It is synthetic and must not
be reported as a real Gemini result, real WAHA send or production proof.
