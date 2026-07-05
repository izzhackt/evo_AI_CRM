# Implementation Plan: EVO Lead Agent

Status: active

## Phase 0 - Repo Conversion

Goal: remove legacy runtime assumptions and establish the EVO/amoCRM product
contract.

Done:

- import the private source workspace into the EVO lead-agent repo;
- add repo-local `AGENTS.md`;
- rewrite README, functional spec, technical spec;
- keep Fusion snapshots under `research/repos/` as owned source references for
  product fundamentals, while rewriting the runtime around EVO Admissions,
  WAHA HMAC, amoCRM identity, and conservative outbound controls.

## Phase 1 - Minimal Runtime Slice

Goal: real FastAPI service with safe no-outbound defaults.

Done:

- FastAPI health endpoint;
- signed WAHA webhook endpoint;
- WAHA direct-message extraction and filtering;
- SQLite idempotency/history;
- CRM sync attempt tracking;
- amoCRM client boundary for contact/lead resolution, notes, tasks;
- signed internal EVO CRM sync callback;
- Gemini decision function behind kill switch;
- WAHA outbound behind separate kill switch;
- deterministic tests for phone parsing, HMAC, idempotency, and no-autoreply flow.

Exit criteria:

- `uv run pytest` passes;
- no secrets are committed;
- service starts locally;
- health endpoint works.

## Phase 2 - Real Local Test With User Number

Goal: test with the user's WhatsApp number without accidental bot replies.

Steps:

1. Run the service locally or in Docker with dummy local-only admin/webhook
   secrets and both outbound switches disabled.
2. Run `evo-lead-agent-smoke-waha-webhook` against the running service with the
   dummy webhook secret to prove signed inbound capture before real WAHA or
   amoCRM credentials are configured.
3. Verify the smoke response shows:
   - HTTP 200;
   - `accepted=true`;
   - the first provider message id is queued/processed to a safe
     `amo_not_configured` stop;
   - the same provider message id returns `duplicate=true`.
4. Configure `.env` with real WAHA, amoCRM, and EVO CRM sync credentials,
   including `EVO_AGENT_CRM_BASE_URL` and `EVO_AGENT_CRM_SYNC_SECRET`.
5. Run service locally or as a private Docker sibling.
6. Point WAHA session webhook to
   `http://evo-lead-agent:8000/webhooks/waha` with HMAC key.
7. Keep:
   - `EVO_AGENT_AUTOREPLY_ENABLED=false`
   - `EVO_AGENT_OUTBOUND_ENABLED=false`
8. Send a WhatsApp message from the user's number.
9. Verify:
   - webhook accepted;
   - local message inserted once;
   - amoCRM contact/lead found or created;
   - amoCRM note written.
   - EVO CRM lead/conversation shadow state synced with amo IDs.
10. Turn on `EVO_AGENT_AUTOREPLY_ENABLED=true` while outbound remains false.
11. Verify AI decision and amoCRM handoff note/task quality.
12. Only then turn on `EVO_AGENT_OUTBOUND_ENABLED=true` for one controlled reply.

Blockers:

- real amoCRM credentials;
- real WAHA API key and webhook secret;
- real EVO CRM sync base URL and secret;
- public/private route from WAHA container to this service;
- confirmed amoCRM pipeline/status/responsible-user IDs.

These blockers apply to the real WhatsApp/amoCRM part of Phase 2, not to the
no-secrets signed webhook smoke.

## Phase 2.5 - Reusable Answer Memory

Goal: make the local Docker product useful before outbound is enabled by
grounding AI answers in approved EVO Admissions chat examples.

Implemented:

- SQLite `knowledge_entries` table for curated amoCRM/chat Q&A examples;
- authenticated `POST /admin/knowledge/import` endpoint behind
  `EVO_AGENT_ADMIN_API_KEY`;
- `knowledge_count` in `/health` so Docker/local runs can prove the reusable
  database is loaded without exposing chat content;
- lexical knowledge search for inbound questions;
- Gemini draft prompt grounding with top knowledge matches and a handoff rule when
  the database does not cover concrete price, deadline, document, policy, or
  country-specific questions.
- `evo-lead-agent-import-knowledge` CLI for importing curated JSON/JSONL into
  the Docker-mounted SQLite database, including `--dry-run` validation before
  SQLite writes.
- `evo-lead-agent-draft-knowledge` CLI for converting copied amoCRM/imBox text
  into redacted draft Q&A entries with no-chat-text metadata that must be
  reviewed before import.
- structured `--turns-json` drafting for browser-extracted amoCRM/imBox turns
  with explicit `customer` / `answerer` roles, avoiding reliance on speaker
  labels embedded inside copied text.
- CLI and `/admin/knowledge/import` reject raw phone numbers, emails, and links
  before inserting copied chat-derived entries.

Manual import contract:

- Browser/amoCRM scraping must produce curated JSON entries with `question`,
  `answer`, optional `source`, `external_id`, `language`, and `tags`.
- Do not commit customer chat exports or screenshots.
- Import through `/admin/knowledge/import` using `X-Evo-Agent-Admin-Key`.
- For local Docker, import through the CLI with `--db data/evo-lead-agent.db`
  when the service volume is mounted at `./data:/app/data`.
- Use `evo-lead-agent-draft-knowledge` only as a draft generator. Its output is
  local sensitive data and must be reviewed before import.
- Run `evo-lead-agent-import-knowledge --dry-run --pretty` before real import;
  fix unsafe entries and review warnings such as `[phone]`, `[email]`, or
  `[link]` markers.

Remaining before true auto-answer:

- configure real amoCRM OAuth credentials;
- decide whether historical chat ingestion should use official amoCRM Chat API,
  Wazzup/ChatApp export/API, or supervised browser extraction;
- seed the knowledge DB from real approved EVO chats;
- run with `EVO_AGENT_AUTOREPLY_ENABLED=true` and
  `EVO_AGENT_OUTBOUND_ENABLED=false` to review decisions before live sending.

## Phase 2.6 - Fusion Chatbot Fundamentals

Goal: port the durable chatbot behavior from the Fusion repositories inside
`research/repos/` without importing the whole monolith or weakening EVO security.

Source patterns:

- `fusion-ai-agents/ai-agents-backend` buffers WhatsApp messages per
  agent/thread and schedules one delayed processor instead of answering every
  webhook immediately;
- Fusion checks per-thread `agent_mode` before AI processing so a human can
  take over a chat;
- Fusion processes the queued message batch as one agent turn and logs outbound
  replies after sending;
- Fusion agent tools include manager escalation and user-information capture,
  which map to EVO handoff state and amoCRM notes/tasks.
- Fusion stores user-profile fields in thread metadata through its
  `upsert_user_attribute` tool; for EVO this maps to allowlisted, sanitized lead
  facts tied to the phone and concrete amo lead instead of arbitrary agent
  memory.

Implementation slice:

1. Add SQLite-backed message buffering keyed by session and phone/chat.
2. Add conversation control state with `agent_mode`, `handoff_reason`, and
   timestamps.
3. Make WAHA webhooks record inbound messages, enqueue them, and return quickly.
4. Process due buffers through the existing amoCRM, knowledge, Gemini, CRM
   sync, and WAHA outbound pipeline.
5. Persist allowlisted, sanitized `lead_updates` from AI decisions as local lead
   facts scoped to the phone and amo lead, then feed them back into later agent
   turns so qualification state survives across messages without leaking across
   leads.
6. Keep local Docker single-service friendly; Redis/ARQ can be introduced later
   only if production throughput requires it.
7. Run a FastAPI lifespan-owned buffer worker in Docker so delayed and retryable
   buffers do not depend on one request still being alive.

Exit criteria:

- tests prove duplicate provider messages are ignored;
- tests prove multiple quick messages for one phone are batched into one AI
  decision;
- tests prove `agent_mode=false` records inbound but skips AI/outbound and syncs
  operator-visible handoff state;
- tests prove lead facts are allowlisted, sanitized, scoped by amo lead,
  persisted, reused in the model payload, and included in the downstream CRM sync
  payload;
- tests prove no-outbound CRM sync failures stay retryable and do not commit new
  lead facts before delivery;
- `uv run pytest` and `uv run ruff check .` pass;
- Docker health and admin knowledge import still work.
- Health exposes whether the built-in buffer worker is enabled.

## Phase 3 - EVO CRM Contract

Goal: make EVO CRM shadow amoCRM instead of creating divergent local leads.

Implemented baseline:

- remote amo lead/contact ID columns on local leads and conversations;
- signed internal lead-agent sync endpoint;
- conversation-to-amo association through the lead-agent callback;
- agent state, summary, handoff reason, and last sync timestamp in the
  WhatsApp operator UI.

## Phase 4 - Production Hardening

Goal: deploy as private sibling service on `hermes-vps`.

Tasks:

- add service to production compose or separate private compose;
- mount persistent `data/`;
- keep WAHA and lead-agent private;
- add Caddy route only if protected by internal auth or not needed;
- add logs without message-body PII by default;
- add rate limits and retry policy around amoCRM/WAHA;
- add integration tests against staging credentials.

## Phase 4.1 - Docker/Live-Test Readiness

Goal: make local Docker and tomorrow's controlled live test self-auditing before
WAHA or outbound is switched on.

Implemented:

- private `GET /admin/readiness` endpoint behind `X-Evo-Agent-Admin-Key`;
- `evo-lead-agent-readiness` CLI for local/Docker-mounted SQLite checks;
- disabled public FastAPI docs/OpenAPI output so private routes are not
  enumerated anonymously;
- staged readiness output for `docker_start`, `private_admin`,
  `waha_inbound_capture`, `amo_crm_shadow_sync`, `ai_decision_review`,
  `receive_only_rollout`, and `live_whatsapp_outbound`;
- no-secret missing-env reporting and safety warnings for risky states such as
  outbound without reply delay or autoreply without imported knowledge.

Exit criteria:

- tests prove readiness reports missing live config without exposing secret
  values;
- tests prove a fully configured receive-only rollout state is recognized while
  outbound readiness remains separate;
- tests prove admin endpoint requires the private admin key;
- tests prove FastAPI docs/OpenAPI routes are disabled;
- tests prove `evo-lead-agent-readiness` exits zero for the receive-only rollout
  gate and does not require outbound WhatsApp;
- tests prove `evo-lead-agent-env-audit` can exit zero at the receive-only
  live-preflight stage while outbound remains disabled;
- `uv run pytest` and `uv run ruff check .` pass.

## Phase 4.2 - Non-Destructive Live-Service Preflight

Goal: before the user points a real WhatsApp number at Docker, verify live
service connectivity without sending WhatsApp messages, creating amoCRM leads,
or posting fake CRM sync events.

Implementation slice:

1. Add a private `GET /admin/preflight` endpoint behind `X-Evo-Agent-Admin-Key`.
2. Add `evo-lead-agent-preflight` CLI.
3. Reuse the readiness report, then run configured read-only checks:
   - WAHA API/session visibility;
   - amoCRM OAuth/account access;
   - local EVO CRM sync signing configuration.
4. Return only status codes, missing env names, public account/session metadata,
   and sanitized error categories. Never return API keys, OAuth tokens, webhook
   secrets, message text, or customer data.

Exit criteria:

- tests prove missing config is skipped with explicit reasons;
- tests prove configured checks call the expected clients and return passed
  status;
- tests prove preflight errors are sanitized;
- tests prove the endpoint requires the private admin key;
- `uv run pytest` and `uv run ruff check .` pass.
