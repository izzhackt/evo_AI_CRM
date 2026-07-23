# EVO Lead Agent Context Report

Generated: 2026-07-03

## Executive Summary

The imported source workspace included legacy planning docs and Fusion source
snapshots. It is now converted into an EVO Admissions lead-agent product repo.
The correct architecture is not a full Fusion fork. The useful Fusion patterns
are webhook ingress, idempotent message storage, delayed/threaded processing,
short WhatsApp formatting, and explicit handoff. The product-specific source of
truth must be amoCRM, while EVO CRM remains the staff UI and WAHA operator
surface.

## Existing EVO CRM Findings

The current EVO CRM already has:

- WAHA settings, session bootstrap, QR proxy, and signed `/api/webhooks/waha`;
- local SQLite `leads`, `wa_accounts`, `wa_conversations`, and `wa_messages`;
- inbound WhatsApp dedupe by `wa_id`;
- local AI draft endpoint for staff-reviewed WhatsApp replies;
- an amoCRM adapter that can refresh OAuth, create contacts/leads, link contact
  to lead, and fetch a lead by remote ID.

Gap:

- local WhatsApp inbound currently creates a local lead first;
- local leads/conversations do not persist remote amo lead/contact IDs;
- there is no amo webhook receiver or source-of-truth shadow sync;
- the amoCRM adapter lacks search/update/note/task coverage for the lead-agent
  source-of-truth loop.

## Fusion Findings

Useful patterns:

- minimal WAHA webhook route that enqueues work;
- first-stage inbound filtering for `fromMe`, broadcasts, malformed payloads;
- idempotent message store;
- thread identity keyed by external messenger identifier;
- response formatting as a separate pass;
- handoff as an explicit tool/job rather than a hidden fallback.

Patterns not copied:

- broad admin/multi-tenant platform;
- parser service;
- open CORS defaults;
- verbose PII logging;
- unsigned WhatsApp webhook route;
- WAHA API key in websocket query strings;
- Sentry `send_default_pii=True` defaults.

## External API Research

WAHA official docs confirmed:

- session webhooks can be configured per session;
- HMAC sends `X-Webhook-Hmac` and `X-Webhook-Hmac-Algorithm: sha512`;
- receive-message webhooks are preferred over polling;
- API requests should use `X-Api-Key`;
- text sending uses `POST /api/sendText`.

amoCRM official docs confirmed:

- OAuth access token refresh uses `POST /oauth2/access_token`;
- refresh tokens rotate and the new one must be persisted;
- `GET /api/v4/contacts` and `GET /api/v4/leads` support list/search;
- `POST /api/v4/contacts` and `POST /api/v4/leads` create entities;
- `POST /api/v4/{entity_type}/{entity_id}/notes` creates notes;
- `POST /api/v4/tasks` creates tasks;
- custom field IDs must be discovered/configured per amo account.

## Current Implementation Decision

Build a small FastAPI service in this repo:

```text
WAHA -> signed webhook -> amoCRM identity -> local idempotency/history
     -> guarded AI decision -> amo notes/tasks -> optional WAHA send
```

Default behavior is no auto-reply and no outbound send. This lets the user test
their WhatsApp number and amoCRM writes without risking uncontrolled WhatsApp
messages.

## Next Required CRM Slice

To make EVO CRM fully aligned with amoCRM as source of truth:

- add remote amo lead/contact IDs or mapping table;
- associate WhatsApp conversations to amo leads;
- expose lead-agent handoff/decision state in staff UI;
- change local WhatsApp inbound creation to resolve through amoCRM first.
