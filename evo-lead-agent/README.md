# EVO Lead Agent

Private EVO Admissions WhatsApp lead-agent service.

This repo is the EVO Admissions lead-agent service. Runtime behavior must be
EVO/amoCRM/WAHA only. Legacy source material is retained under `research/` as
reference snapshots, not as product behavior.

## Product Boundary

- WAHA receives and sends WhatsApp messages.
- The lead agent receives signed WAHA webhooks, deduplicates inbound messages,
  resolves or creates the lead/contact in amoCRM, stores local thread history,
  and can draft or send guarded replies.
- amoCRM is the source of truth for lead/contact identity and sales status.
- EVO CRM remains the staff/operator UI and WhatsApp console. The lead-agent
  posts a signed internal sync event to EVO CRM after amoCRM resolution so local
  CRM state shadows amoCRM instead of competing with it.

## Safety Defaults

The service is intentionally conservative by default:

```bash
EVO_AGENT_AUTOREPLY_ENABLED=false
EVO_AGENT_OUTBOUND_ENABLED=false
```

With these defaults the service records inbound state, writes amoCRM notes, and
syncs EVO CRM shadow state when credentials are configured, but it does not send
WhatsApp replies. Turn on `EVO_AGENT_AUTOREPLY_ENABLED=true` only after
Gemini, amoCRM, and CRM sync are validated. Turn on
`EVO_AGENT_OUTBOUND_ENABLED=true` only when live WhatsApp replies are approved.

## Local Setup

```bash
cp .env.example .env
uv sync --extra dev
uv run pytest
uv run uvicorn evo_lead_agent.main:app --reload --port 8088
```

Host-side `uv run ...` commands and local uvicorn startup load `.env`
automatically. Explicit shell-exported variables still take precedence.

Health check:

```bash
curl http://127.0.0.1:8088/health
```

Private readiness check:

```bash
curl http://127.0.0.1:8088/admin/readiness \
  -H "X-Evo-Agent-Admin-Key: $EVO_AGENT_ADMIN_API_KEY"
```

Private non-destructive live-service preflight:

```bash
curl http://127.0.0.1:8088/admin/preflight \
  -H "X-Evo-Agent-Admin-Key: $EVO_AGENT_ADMIN_API_KEY"
```

Local CLI readiness check:

```bash
uv run evo-lead-agent-env-audit --db data/evo-lead-agent.db --pretty
uv run evo-lead-agent-readiness --db data/evo-lead-agent.db --pretty
```

Local CLI preflight check:

```bash
uv run evo-lead-agent-preflight --db data/evo-lead-agent.db --pretty
```

`evo-lead-agent-env-audit` makes no network calls. It reports only configured
booleans, missing key names, safety toggles, knowledge count, and the next setup
stage; it does not print secret values. It exits zero when the environment is
ready for the receive-only rollout gate: WAHA, amoCRM, EVO CRM sync, Gemini, and
admin inputs configured, `EVO_AGENT_AUTOREPLY_ENABLED=true`, and
`EVO_AGENT_OUTBOUND_ENABLED=false`.

`evo-lead-agent-readiness` distinguishes `receive_only_rollout` from
`live_whatsapp_outbound`. Its top-level `ok` and CLI exit code are for
receive-only readiness; outbound readiness remains a separate field and must not
be used for the first live proof.
`evo-lead-agent-preflight` exits nonzero until all configured live service
checks pass.
The amoCRM preflight check uses an existing `access_token` from
`EVO_AGENT_AMO_TOKEN_FILE` only; it will not refresh OAuth tokens because amoCRM
refresh tokens rotate.

Use the readiness output before switching safety toggles. `waha_inbound_capture`
must be green before pointing WAHA webhooks here. `amo_crm_shadow_sync` must be
green before testing real leads. `ai_decision_review` is the safe stage for
`EVO_AGENT_AUTOREPLY_ENABLED=true` while `EVO_AGENT_OUTBOUND_ENABLED=false`.
`receive_only_rollout` is the first live proof gate. Only use
`live_whatsapp_outbound` for a later controlled send test.

Docker:

```bash
cp .env.example .env
docker compose up --build
```

Local Docker with WAHA included:

```bash
docker compose --profile waha up -d --build
```

This starts the lead-agent on `127.0.0.1:8088` and WAHA on
`127.0.0.1:3000`. WAHA sessions persist in the `evo_crm_waha_sessions` Docker
volume. Keep `EVO_AGENT_WAHA_BASE_URL=http://evo-crm-waha:3000` when both
services are in this Compose project. Set `WAHA_API_KEY=sha512:<hash>` for the
WAHA container and `EVO_AGENT_WAHA_API_KEY=<plain key>` for the lead-agent
client.
Compose passes only the explicit lead-agent environment allowlist into the
lead-agent container; `WAHA_API_KEY` is scoped to the WAHA container.

For local Docker testing, set `EVO_AGENT_WAHA_BASE_URL` based on where WAHA is
running:

- WAHA from this Compose profile: `http://evo-crm-waha:3000`
- same production Docker network: `http://evo-crm-waha:3000`
- WAHA running on your host/Docker Desktop: `http://host.docker.internal:3000`
- WAHA as another local Compose service: use that Compose service name

No-secrets Docker smoke:

```bash
docker build -t evo-lead-agent:smoke .
docker run --rm -p 127.0.0.1:8088:8000 \
  -v "$PWD/data:/app/data" \
  -e EVO_AGENT_DB_PATH=/app/data/evo-lead-agent.db \
  -e EVO_AGENT_ADMIN_API_KEY=smoke-admin \
  -e EVO_AGENT_WAHA_WEBHOOK_SECRET=smoke-webhook \
  -e EVO_AGENT_REPLY_DELAY_SECONDS=0 \
  -e EVO_AGENT_WORKER_ENABLED=false \
  -e EVO_AGENT_AUTOREPLY_ENABLED=false \
  -e EVO_AGENT_OUTBOUND_ENABLED=false \
  evo-lead-agent:smoke
```

Then check `GET /health`, `GET /admin/readiness`, and
`POST /admin/knowledge/import` with `X-Evo-Agent-Admin-Key: smoke-admin`.

One-command local smoke:

```bash
uv run evo-lead-agent-local-smoke \
  --base-url http://127.0.0.1:8088 \
  --admin-key smoke-admin \
  --webhook-secret smoke-webhook \
  --pretty
```

This checks health, starter knowledge, private admin route reachability,
non-destructive preflight reachability, and signed inbound webhook capture. It
fails if `EVO_AGENT_OUTBOUND_ENABLED=true`; keep outbound disabled until the real
WAHA, amoCRM, Gemini, and EVO CRM sync path is controlled-test ready.

WAHA session setup for the first real number:

```bash
uv run evo-lead-agent-waha-setup \
  --base-url http://127.0.0.1:3000 \
  --api-key "$EVO_AGENT_WAHA_API_KEY" \
  --session crm_primary \
  --webhook-url http://evo-lead-agent:8000/webhooks/waha \
  --webhook-secret "$EVO_AGENT_WAHA_WEBHOOK_SECRET" \
  --qr-output data/waha-crm-primary-qr.png \
  --dry-run \
  --pretty

uv run evo-lead-agent-waha-setup \
  --base-url http://127.0.0.1:3000 \
  --api-key "$EVO_AGENT_WAHA_API_KEY" \
  --session crm_primary \
  --webhook-url http://evo-lead-agent:8000/webhooks/waha \
  --webhook-secret "$EVO_AGENT_WAHA_WEBHOOK_SECRET" \
  --qr-output data/waha-crm-primary-qr.png \
  --pretty
```

Open `data/waha-crm-primary-qr.png` and scan it from the WhatsApp number that
should receive leads. The setup command creates or updates the WAHA session
webhook, enables HMAC signing for `message` and `session.status`, starts the
session, and saves the QR image without printing the WAHA API key, webhook
secret, webhook URL, QR payload, or customer data. Run `--dry-run` first; it
does not call WAHA. After scanning, rerun `/admin/preflight`; `waha_session` must
pass with status `WORKING` before live WhatsApp testing.

On the server, use the private lead-agent URL that WAHA can reach for
`--webhook-url`; do not expose WAHA dashboard, Swagger, or API publicly just to
complete setup.

Signed inbound webhook smoke:

```bash
uv run evo-lead-agent-smoke-waha-webhook \
  --base-url http://127.0.0.1:8088 \
  --secret smoke-webhook \
  --phone +15551234567 \
  --message "Smoke test: signed inbound webhook capture." \
  --pretty
```

This command sends a WAHA-shaped direct-message payload with the same HMAC
algorithm WAHA uses. Its report is compact: it does not print the webhook URL,
HMAC headers, phone-derived chat id, or raw service response. With
`EVO_AGENT_REPLY_DELAY_SECONDS=0`, the no-secrets smoke should process the buffer
immediately and return `reason: amo_not_configured`; that is the expected safe
stop until real amoCRM credentials are configured. It does not prove the real
WAHA session, live WhatsApp route, amoCRM credentials, or EVO CRM sync
credentials are working.

## Reusable Answer Memory

The lead agent can use a local SQLite knowledge base of approved Q/A examples
from amoCRM chats. Do not commit real customer exports. Import curated entries
into the running local Docker service:

```bash
curl -X POST http://127.0.0.1:8088/admin/knowledge/import \
  -H "Content-Type: application/json" \
  -H "X-Evo-Agent-Admin-Key: $EVO_AGENT_ADMIN_API_KEY" \
  --data @knowledge-export.json
```

Or import directly into the Docker-mounted SQLite DB from the host:

```bash
uv run evo-lead-agent-import-knowledge examples/knowledge-template.json \
  --db data/evo-lead-agent.db
```

For a safe first local test, import the generic EVO starter pack. It contains
approved-style public answers only; it is not scraped customer data:

```bash
uv run evo-lead-agent-import-knowledge examples/evo-admissions-starter-knowledge.json \
  --db data/evo-lead-agent.db \
  --pretty
```

By default, startup also tries to seed this same pack from
`EVO_AGENT_STARTER_KNOWLEDGE_PATH` when the knowledge table is empty. Set the
variable to an empty value to disable auto-seeding. Existing knowledge is not
overwritten.

Accepted JSON shape:

```json
{
  "entries": [
    {
      "source": "amo_export",
      "external_id": "amo-approved-documents-v1",
      "question": "Какие документы нужны для поступления?",
      "answer": "Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат, если есть.",
      "language": "ru",
      "tags": ["documents", "admissions"]
    }
  ]
}
```

JSONL is also accepted by the CLI, one entry object per line.

Validate a curated file before writing to SQLite:

```bash
uv run evo-lead-agent-import-knowledge data/knowledge-amo-curated.json \
  --db data/evo-lead-agent.db \
  --dry-run \
  --pretty
```

The dry run prints counts only: importable entries, skipped entries, warning
entries, and unsafe entries. Imports fail if a question or answer still contains
raw phone numbers, emails, or links. Redaction markers such as `[phone]`,
`[email]`, and `[link]` are warnings; rewrite those entries into generic
approved answers before live use.

Browser-to-knowledge workflow, manual transcript:

1. Open a real conversation in amoCRM/imBox.
2. Copy a small repeated customer-question / approved-answer transcript into an
   untracked local text file, for example `data/amo-chat-copy.txt`.
3. Generate a redacted draft:

   ```bash
   uv run evo-lead-agent-draft-knowledge data/amo-chat-copy.txt \
     --output data/knowledge-amo-curated.json
   ```

4. Review the draft and rewrite entries into generic Q/A pairs with no names,
   phone numbers, dates, schools, passport data, lead IDs, links, or private
   circumstances.
5. Run the import command with `--dry-run --pretty` and fix every unsafe entry.
6. Import it with `evo-lead-agent-import-knowledge` or `/admin/knowledge/import`.
7. Check `GET /health` and confirm `knowledge_count` increased.

Files under `data/*.json` and `data/*.jsonl` are gitignored, but still treat
them as sensitive local runtime data.
The draft helper writes `meta.source_sha256`, line counts, draft counts, and
redaction counts without printing raw transcript text. It only uses lines with
explicit manager/operator/bot/staff speaker labels as answers. It is a safety
aid, not approval to skip human review.

Browser-to-knowledge workflow, structured turns:

The amoCRM/imBox deal page exposes visible chat messages in feed note elements
such as `feed-note-wrapper-amojo`, `feed-note__amojo-user`, and
`feed-note__message_paragraph`. When browser extraction is available, export
only structured turns into an ignored local file:

```json
{
  "turns": [
    {"role": "customer", "text": "Какие документы нужны для поступления?"},
    {"role": "answerer", "text": "Обычно нужны паспорт, аттестат и транскрипт."}
  ]
}
```

Then draft reviewed knowledge from those turns:

```bash
uv run evo-lead-agent-draft-knowledge \
  --turns-json data/amo-visible-turns.json \
  --output data/knowledge-amo-curated.json
```

This path is safer than raw copy-paste because the browser extraction can mark
each message as `customer` or `answerer`; the draft helper still redacts phones,
emails, and links and still requires human review before import.

Verify import without exposing chat content:

```bash
curl http://127.0.0.1:8088/health
```

The `knowledge_count` value should increase. During reply drafting, the service
searches this database and passes only the top matches into the model prompt.
If the database does not cover a concrete price, deadline, policy, or
country-specific question, the agent must hand off instead of inventing.

## Required Live Credentials

- `EVO_AGENT_WAHA_BASE_URL`
- `EVO_AGENT_WAHA_API_KEY`
- `EVO_AGENT_WAHA_WEBHOOK_SECRET`
- `EVO_AGENT_WAHA_WEBHOOK_URL`
- `EVO_AGENT_ADMIN_API_KEY`
- `EVO_AGENT_AMO_BASE_URL`
- `EVO_AGENT_AMO_CLIENT_ID`
- `EVO_AGENT_AMO_CLIENT_SECRET`
- `EVO_AGENT_AMO_REDIRECT_URI`
- `EVO_AGENT_AMO_REFRESH_TOKEN`
- `EVO_AGENT_CRM_BASE_URL`
- `EVO_AGENT_CRM_SYNC_SECRET`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`, only for Gemini draft review

The amoCRM refresh token rotates every refresh. The service writes the latest
token to `EVO_AGENT_AMO_TOKEN_FILE`; persist that file or you will have to
reauthorize amoCRM.

## Current Implementation

- `src/evo_lead_agent/main.py` - FastAPI app and signed WAHA webhook endpoint.
- `GET /admin/readiness` - private no-secret readiness report for Docker/live
  test staging.
- `GET /admin/preflight` - private non-destructive checks for WAHA session
  visibility, amoCRM account access, and CRM sync signing readiness.
- FastAPI docs/OpenAPI routes are disabled so private/internal routes are not
  discoverable without source access.
- `src/evo_lead_agent/service.py` - inbound pipeline and safety gating.
- `src/evo_lead_agent/amo.py` - amoCRM v4 client for lead/contact resolution,
  notes, and follow-up tasks.
- `src/evo_lead_agent/evo_crm.py` - signed private callback to EVO CRM.
- `src/evo_lead_agent/waha.py` - WAHA sendText client.
- `src/evo_lead_agent/store.py` - local SQLite idempotency, thread history,
  lead facts, answer memory, and CRM sync attempt tracking.
- `tests/` - deterministic local tests for pure logic and no-credentials flow.
- `evo-lead-agent-context-report.md` - repo/context research synthesis.

## Research Sources Used

- WAHA docs: session webhooks, HMAC headers, receive messages, sendText, and API
  key security.
- amoCRM official docs: OAuth refresh token rotation, contacts/leads list and
  creation, notes, tasks, and custom fields.
- Google Gen AI Python SDK docs: `google-genai`, `genai.Client`, environment
  authentication with `GEMINI_API_KEY`/`GOOGLE_API_KEY`, async
  `client.aio.models.generate_content`, `GenerateContentConfig`, and JSON
  response MIME type.
- Fusion snapshots in `research/repos/`: useful patterns for webhook ingress,
  idempotency, delayed processing, profile/fact capture, short WhatsApp
  formatting, and handoff; not copied wholesale due security and platform scope
  issues.
