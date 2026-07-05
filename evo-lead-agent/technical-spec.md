# Technical Spec: EVO Lead Agent

Status: implementation baseline
Runtime: FastAPI service
Primary integrations: WAHA, amoCRM v4, Gemini

## 1. Architecture

```text
WAHA private service
  -> POST /webhooks/waha with HMAC
  -> FastAPI validation and normalization
  -> SQLite message buffer and conversation control
  -> amoCRM contact/lead search or create
  -> SQLite local idempotency/history
  -> Gemini draft decision, when enabled
  -> amoCRM notes/tasks for audit and handoff
  -> signed EVO CRM internal sync
  -> WAHA sendText, only when outbound enabled
```

## 2. Runtime Components

| Component | Path | Responsibility |
| --- | --- | --- |
| FastAPI app | `src/evo_lead_agent/main.py` | Health endpoint and WAHA webhook |
| Security | `src/evo_lead_agent/security.py` | WAHA HMAC-SHA512 validation and EVO CRM HMAC-SHA256 signing |
| Service | `src/evo_lead_agent/service.py` | Main inbound pipeline |
| amoCRM client | `src/evo_lead_agent/amo.py` | OAuth refresh, contact/lead resolution, notes, tasks |
| EVO CRM client | `src/evo_lead_agent/evo_crm.py` | Signed internal CRM shadow-state callback |
| WAHA client | `src/evo_lead_agent/waha.py` | Private `sendText` call |
| Store | `src/evo_lead_agent/store.py` | SQLite idempotency, local history, CRM sync attempts |
| Agent | `src/evo_lead_agent/agent.py` | Guarded Gemini decision JSON |

The message-buffer and control model is derived from the owned Fusion source in
`research/repos/fusion-ai-agents/ai-agents-backend`: Fusion buffers messages per
chat/thread, schedules one delayed processor, and checks `agent_mode` before
calling the AI agent. EVO keeps that behavior but implements it in SQLite so the
local Docker product remains one service until Redis/ARQ is justified.

Docker runtime processing is owned by a FastAPI lifespan worker. It polls due
SQLite buffers, processes a bounded number of groups per pass, and stops on app
shutdown. The manual `/internal/buffers/process-due` endpoint remains an
operator fallback, not the primary processing mechanism.

## 3. API Endpoints

### `GET /health`

Returns configuration status booleans without exposing secrets.

### `POST /webhooks/waha`

Requires:

- `X-Webhook-Hmac`
- `X-Webhook-Hmac-Algorithm: sha512`

The raw request body is verified against `EVO_AGENT_WAHA_WEBHOOK_SECRET`.

Accepted WAHA event:

- `event: "message"`

Ignored:

- other events;
- outbound `fromMe`;
- broadcast;
- group chats;
- payloads without phone, text, or provider message ID.

## 4. amoCRM Integration

The client uses OAuth refresh-token flow:

- `POST /oauth2/access_token`
- `grant_type=refresh_token`
- persist returned refresh token to `EVO_AGENT_AMO_TOKEN_FILE`

Runtime methods:

- search contacts by `query=<phone>&with=leads`;
- create contact with `PHONE` custom field;
- create lead with optional pipeline/status/responsible user;
- link contact to lead;
- add `common` lead note;
- create follow-up task.

Open follow-up:

- add configurable custom-field mapping for target country, degree, source, and
  AI qualification fields after the amoCRM field IDs are confirmed.

## 5. WAHA Integration

The service assumes WAHA is private and reachable through Docker/network URL.

Outbound uses:

- `POST /api/sendText`
- `X-Api-Key`
- body: `session`, `chatId`, `text`

Session creation/QR can stay in EVO CRM for now. This service only needs the
session name and send/webhook credentials.

## 6. EVO CRM Sync

The lead-agent sends a compact JSON payload to
`EVO_AGENT_CRM_BASE_URL + EVO_AGENT_CRM_SYNC_PATH` after amoCRM resolution and
local inbound idempotency pass. The payload is signed with:

- `X-Evo-Agent-Timestamp`
- `X-Evo-Agent-Signature`
- `X-Evo-Agent-Signature-Algorithm: sha256`

The signature is HMAC-SHA256 over `<timestamp>.<raw-json-body>` using
`EVO_AGENT_CRM_SYNC_SECRET`. EVO CRM rejects stale timestamps and invalid
signatures.

## 7. Readiness Contract

Operators can check setup without exposing secret values through:

- `GET /admin/readiness` with `X-Evo-Agent-Admin-Key`;
- `GET /admin/preflight` with `X-Evo-Agent-Admin-Key`;
- `evo-lead-agent-readiness --db data/evo-lead-agent.db --pretty`;
- `evo-lead-agent-preflight --db data/evo-lead-agent.db --pretty`.

The report is staged:

- `docker_start`;
- `private_admin`;
- `waha_inbound_capture`;
- `amo_crm_shadow_sync`;
- `ai_decision_review`;
- `receive_only_rollout`;
- `live_whatsapp_outbound`.

Each stage returns only booleans, missing environment variable names, safety
switches, warning codes, and the imported knowledge count. It must never return
API keys, OAuth tokens, webhook secrets, message bodies, or customer data.
The readiness CLI exits zero for `receive_only_rollout`, which requires draft
review enabled and outbound disabled. `live_whatsapp_outbound` is reported
separately and is not part of the first live proof. FastAPI documentation and
OpenAPI routes are disabled so private endpoints are not anonymously
enumerable.

Preflight is non-destructive. It may check WAHA session visibility and amoCRM
account access when credentials are configured, but it must not send WhatsApp
messages, create contacts/leads, write notes, create tasks, or post fake CRM sync
events. The amoCRM account check must use an existing `access_token` from
`EVO_AGENT_AMO_TOKEN_FILE` and must not refresh OAuth tokens, because amoCRM
refresh tokens rotate. It returns passed/skipped/failed checks with sanitized
error categories.

## 8. Local State

SQLite tables:

- `conversations`: unique phone, amo lead ID, amo contact ID;
- `messages`: conversation ID, provider message ID, direction, text.
- `conversation_controls`: per-phone `agent_mode`, handoff reason, and updated
  timestamp for human takeover.
- `lead_facts`: allowlisted, sanitized qualification facts learned from approved
  AI decision output and scoped by phone plus amo lead ID, such as target
  country, education level, age, intake, or language level.
- `message_buffers`: pending inbound provider IDs/text grouped by session,
  phone, and chat until the processing delay expires.
- `crm_sync_attempts`: idempotency key, compact payload, attempt count, last
  error, delivered timestamp.
- `knowledge_entries`: curated historical Q/A examples from approved amoCRM or
  chat exports, keyed by source/external ID and searched before AI drafting.
  Entries can be imported through the authenticated HTTP endpoint or the
  `evo-lead-agent-import-knowledge` CLI for Docker-mounted SQLite volumes.
  Copied browser transcripts can be converted into redacted draft entries with
  `evo-lead-agent-draft-knowledge`, but draft output is not trusted until a
  human reviews and imports it.

This state is not the CRM source of truth. It exists for idempotency, short
history, qualification context, reusable answer grounding, safe model context,
and callback recovery evidence.

## 9. Security Controls

- WAHA webhook HMAC required.
- EVO CRM internal sync HMAC required.
- Knowledge import requires `EVO_AGENT_ADMIN_API_KEY` through
  `X-Evo-Agent-Admin-Key`.
- WAHA and amoCRM secrets only from environment.
- amoCRM token file permissions set to `0600`.
- Autoreply and outbound are separate kill switches.
- Health endpoint returns only booleans/status, not secrets.
- Real customer chat exports must stay out of git; import them into the runtime
  SQLite volume only after curation.
- Reference Fusion snapshots must not be copied wholesale because their webhook
  route lacks signature validation, logging is too verbose for PII, CORS is open,
  and Sentry PII defaults are unsafe for chat data.

## 9. External Documentation Verified

- WAHA official docs confirm session webhooks, HMAC headers
  `X-Webhook-Hmac`/`X-Webhook-Hmac-Algorithm`, receive-message webhooks, API key
  header, and `sendText`.
- amoCRM official docs confirm OAuth refresh-token rotation, `GET /api/v4/leads`,
  `GET /api/v4/contacts`, `POST /api/v4/leads`, `POST /api/v4/contacts`,
  `POST /api/v4/{entity_type}/{entity_id}/notes`, `POST /api/v4/tasks`, and
  separate chat/talk API surfaces for historical chat ingestion decisions.
- FastAPI docs confirm async path operations, `Request`, `JSONResponse`, and
  background-task patterns.
- Google Gen AI Python SDK docs confirm `google-genai`, `genai.Client`,
  `GEMINI_API_KEY`/`GOOGLE_API_KEY` environment authentication,
  async `client.aio.models.generate_content`, `GenerateContentConfig`, and
  `response_mime_type="application/json"` for JSON responses.
