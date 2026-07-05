# Plan Changes

## 2026-07-04 - Safe Starter Answer Memory

- Added a committed `evo_starter` knowledge pack with generic EVO Admissions
  Q/A pairs for common first-contact questions: documents, pricing, countries,
  English/IELTS, age, scholarships, visa support, deadlines, and consultation
  intake.
- The starter pack intentionally contains no real amoCRM customer exports,
  phone numbers, emails, links, exact prices, deadlines, promises, or private
  lead context.
- Added tests that import the exact committed pack through the CLI safety review
  and verify Russian/English retrieval from SQLite.
- Added first-start auto-seeding from `EVO_AGENT_STARTER_KNOWLEDGE_PATH` so the
  Docker image can boot with generic approved answer memory when the knowledge
  table is empty; existing memory is not overwritten.
- Checked the currently open amoCRM deal tab and wrote a sanitized ignored local
  structured-turn snapshot under `data/`; the visible page slice did not contain
  a reusable Q/A pair, so the draft generator correctly produced zero entries.

## 2026-07-04 - Local Docker Runtime Smoke

- Built the Docker image and ran the service on a loopback-only local port with
  dummy admin/webhook secrets, autoreply disabled, and outbound disabled.
- Verified `/health`, `/admin/readiness`, `/admin/preflight`, signed WAHA-shaped
  inbound webhook capture, immediate safe stop at `amo_not_configured`, and
  duplicate provider-message id handling.
- Added explicit local WAHA URL guidance for host/Docker Desktop testing so the
  production private service name is not confused with local Docker topology.
- This still does not prove real WAHA, amoCRM, Anthropic, or EVO CRM sync; live
  completion requires real environment values and a controlled WhatsApp test.

## 2026-07-04 - Reusable Answer Memory Import Gate

- Added a dry-run validation path for curated amoCRM/imBox knowledge imports so
  real copied chat exports can be checked before SQLite writes.
- Applied the same unsafe-entry rejection to the private
  `/admin/knowledge/import` endpoint as the CLI.
- Scope remains Phase 2.5: supervised browser extraction is still the current
  path until a real official amoCRM/Wazzup/ChatApp historical chat API decision
  is made and validated.

## 2026-07-04 - Signed WAHA Webhook Smoke Helper

- Added a host-side CLI smoke command for Phase 2 that sends a WAHA-shaped
  direct-message payload to a running local/Docker service with the same HMAC
  headers WAHA uses.
- This proves the private webhook route, HMAC verifier, parser, idempotent
  inbound storage, and no-outbound safety path are wired before pointing a real
  WAHA session at the service.
- The command now prints a compact allowlisted report instead of the full
  webhook URL, phone-derived chat id, HMAC headers, or raw service response.
- This is not a substitute for the real WAHA session test; live completion still
  requires a real WhatsApp message from the user's number and real amoCRM/EVO CRM
  credentials.

## 2026-07-04 - One-Command Local Smoke Gate

- Added `evo-lead-agent-local-smoke` as a host-side safety gate for the local
  Docker service: health, starter knowledge, private admin readiness,
  non-destructive preflight reachability, and signed inbound webhook capture.
- The report is allowlisted and compact. It does not print admin keys, webhook
  secrets, HMAC headers, OAuth tokens, raw webhook URLs, or customer payloads.
- The command fails when `EVO_AGENT_OUTBOUND_ENABLED=true`; local smoke remains a
  no-outbound gate before real WAHA, amoCRM, Anthropic, and EVO CRM sync testing.

## 2026-07-04 - WAHA Session Setup Gate

- Added `evo-lead-agent-waha-setup` to create or update the WAHA session webhook,
  configure HMAC signing for `message` and `session.status`, start the session,
  and optionally save a QR PNG for scanning the first WhatsApp number.
- Added `--dry-run` so operators can validate the setup payload and compact
  report without calling WAHA.
- The command output is compact and does not print the WAHA API key, webhook
  secret, webhook URL, HMAC headers, QR payload, or customer data.
- This closes the local/server operator setup gap before a real inbound WhatsApp
  test. It still does not prove live WhatsApp delivery, amoCRM resolution,
  Anthropic reply drafting, or EVO CRM sync until real credentials are supplied
  and the controlled live path is exercised with outbound disabled first.

## 2026-07-04 - Local WAHA Compose Profile

- Added an optional `waha` Docker Compose profile using the official
  `devlikeapro/waha` image, loopback-only port `127.0.0.1:3000`, and persisted
  session volume `evo_crm_waha_sessions`.
- Documented the local topology where the lead-agent talks to
  `http://evo-crm-waha:3000` and WAHA calls back to
  `http://evo-lead-agent:8000/webhooks/waha` inside the Compose network.
- Tightened live-service preflight so a found WAHA session is not enough:
  `waha_session` only passes when the compact session status is `WORKING`, so
  QR/unpaired sessions cannot be mistaken for live readiness.

## 2026-07-04 - Structured amoCRM Turn Drafting

- Added structured `turns` JSON support to `evo-lead-agent-draft-knowledge` so
  browser extraction can pass role-marked `customer` and `answerer` messages
  instead of relying only on speaker labels in copied text.
- Observed the live amoCRM/imBox deal page structure in Chrome and confirmed
  visible chat/feed content is exposed through feed note classes such as
  `feed-note-wrapper-amojo`, `feed-note__amojo-user`, and
  `feed-note__message_paragraph`.
- Raw chat exports remain local ignored data under `data/`; structured drafts
  still require review, dry-run validation, and explicit import before the agent
  can use them.

## 2026-07-04 - amoCRM Visible-Turn Draft Hardening

- Re-checked the open amoCRM deal tab and saved a sanitized ignored local
  visible-turn sample under `data/`; the visible page slice still did not contain
  a reusable customer-question plus manager-answer pair, so the draft generator
  correctly produced zero importable entries.
- Hardened structured-turn drafting for amoCRM/Wazzup exports where an outbound
  manager answer can be labeled as `customer` by the messenger bridge. The draft
  helper now rescues only manager-style answer text and still stops on customer
  questions or follow-up customer tails.
- Expanded Russian country tag matching so questions containing forms such as
  `страны` are tagged consistently for answer-memory retrieval.

## 2026-07-04 - Docker Environment Scoping

- Replaced bulk `env_file` loading for the lead-agent service with an explicit
  Docker Compose environment allowlist.
- The local `.env` workflow remains the same, but `WAHA_API_KEY` is now scoped
  to the optional WAHA container instead of also being injected into the
  lead-agent container. The lead-agent continues to use only
  `EVO_AGENT_WAHA_API_KEY` for WAHA client calls.
- Validated the no-secrets Docker path with `/dev/null` as the Compose env file,
  a successful image build, and `evo-lead-agent-local-smoke` against the running
  container. The smoke passed in safe mode and stopped at missing real
  WAHA/amoCRM/EVO CRM/Anthropic credentials, as expected.

## 2026-07-04 - Host CLI Dotenv Loading

- Made `load_settings()` read the local `.env` file without overriding explicit
  shell environment variables.
- This aligns host-side `uv run evo-lead-agent-*` commands and local uvicorn
  startup with the Docker Compose workflow, so the operator does not need to
  remember a separate `set -a && source .env` step before running preflight,
  WAHA setup, or local smoke commands.

## 2026-07-04 - Non-Destructive Env Audit

- Added `evo-lead-agent-env-audit` as the first operator check before WAHA QR
  setup or live preflight.
- The command reads the same `.env`/environment as the service, counts local
  knowledge entries, and reports readiness for local smoke, WAHA setup, live
  preflight, AI decision review, and live outbound without network calls.
- Output is allowlisted: configured booleans, missing key names, safety toggles,
  knowledge count, warnings, and next action only. It does not print secret
  values, webhook URLs, OAuth tokens, API keys, or customer data.
- Intentional acceptance-criteria split: `evo-lead-agent-env-audit` exits zero
  once the environment is ready for non-destructive live preflight, while
  `evo-lead-agent-readiness` remains strict and exits nonzero until controlled
  live outbound is ready. This keeps setup from pressuring operators to enable
  WhatsApp sending just to clear a local environment audit.

## 2026-07-05 - Gemini Draft Review Provider

- Replaced the Anthropic-only lead-agent draft decision path with the current
  Google Gen AI Python SDK and `gemini-3.5-flash` as the default model.
- Accepted Gemini API secrets only from environment variables:
  `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `EVO_AGENT_GEMINI_API_KEY`.
- Kept the existing `AgentDecision` shape and receive-only safety split:
  autoreply may create draft review state, but WhatsApp sending still requires
  `EVO_AGENT_OUTBOUND_ENABLED=true`.
- Added explicit readiness/preflight reporting for missing Gemini
  configuration; live Gemini success still requires real credentials and an
  exercised provider call.

## 2026-07-05 - Receive-Only Production Preflight Gate

- Split readiness into `receive_only_rollout` and `live_whatsapp_outbound` so
  the first live proof can require WAHA, amoCRM, EVO CRM sync, Gemini, private
  admin configuration, `EVO_AGENT_AUTOREPLY_ENABLED=true`, and
  `EVO_AGENT_OUTBOUND_ENABLED=false` without treating outbound send readiness as
  complete.
- Added an explicit `admin_configuration` preflight check and tightened amoCRM
  missing-input reporting to exact env names before any live-service calls.
- Updated `evo-lead-agent-env-audit` to exit zero only for the receive-only
  rollout gate, while still reporting outbound readiness separately.
- Local smoke remains a no-outbound gate and fails when the running service
  reports `EVO_AGENT_OUTBOUND_ENABLED=true`.
