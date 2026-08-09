# EVO MVP WAHA + AI Memory Research

Artifact date: `2026-08-09` (requested filename date; research performed on `2026-08-08`)
Research basis: current primary docs first, then selected engineering blog/forum material for operational lessons.

## Executive answer

For EVO's MVP, the smallest honest architecture is:

1. Keep **one private WAHA session** for the sales WhatsApp account.
2. Use WAHA to **ingest history + live events**, but do **not** treat WAHA or Gemini as the durable system of record.
3. Persist every inbound/outbound message, status update, attachment metadata, and qualification snapshot in the **EVO database**.
4. Download inbound media **server-side** from WAHA immediately and re-store it under EVO-controlled storage and permissions.
5. Push UI updates from EVO to the browser with **app-owned realtime** so operators never need `Cmd+R`.
6. Keep lead memory in **DB rows + rolling summaries + approved pgvector knowledge retrieval**.
7. Use Gemini as a **reasoning tool**, not as memory. For MVP, prefer one synchronous draft/qualify call per turn, not a managed autonomous agent.

## Direct answers to the owner's questions

### 1. Can WAHA bring the existing WhatsApp history?

Yes, with an important engine caveat.

- WAHA documents that **GOWS syncs the full available WhatsApp history by default**, and also exposes low-level history sync limits if you want to reduce that depth later.[W1]
- WAHA also exposes a `GET /api/messages` history API, but the docs explicitly recommend using **events via Webhooks or WebSockets instead of constant polling** to avoid performance issues.[W2]

Implication for EVO:

- If "complete existing history" matters, start with **GOWS** and allow the initial full sync.
- Treat that initial sync as an **import window**, then switch to steady-state event ingestion.
- Expect large bandwidth/storage impact if the account has years of history, because WAHA explicitly warns about proxy bandwidth and database bloat for full syncs.[W1]

### 2. Can WAHA keep media/files?

Yes, but WAHA storage is not enough by itself for EVO's long-term record.

- WAHA says that when users send media, it saves the file in **Media Storage**, and your application must **download the file** using the `media.url` it provides.[W3]
- By default, WAHA downloads all media files unless you disable or restrict it.[W4]
- WAHA documents S3 and PostgreSQL-backed media storage options, plus health thresholds for file storage.[W4]
- WAHA also warns not to put a full/admin API key into media URLs because URLs leak through browser history, logs, and referrers.[W3]

Implication for EVO:

- Do **not** expose WAHA media URLs to the browser.
- Download media **server-side immediately**, then store it in EVO-owned object storage or EVO-managed storage with your own ACLs.
- Save only WAHA's message identifiers and the EVO media pointer as the durable record.
- WAHA becomes the transport cache; EVO becomes the evidence store.

### 3. Can WAHA keep chats updating automatically without `Cmd+R`?

Yes.

- WAHA supports both **Webhooks** and **WebSockets** for real-time events.[W5]
- WAHA supports `message`, `message.any`, `message.ack`, and `session.status` events across GOWS/WEBJS/WPP/NOWEB according to the event matrix.[W5]
- WAHA recommends not subscribing to `*` for production because it can generate many requests.[W5]
- Supabase's current docs say for client-facing realtime database changes, **Broadcast is the recommended method for scalability and security**, while **Postgres Changes** is simpler but less scalable.[S1]

Implication for EVO:

- Ingest WAHA into the app server first.
- Then push normalized updates from EVO to the browser using:
  - app-owned WebSocket/SSE, or
  - Supabase Realtime Broadcast if EVO is already built around Supabase.
- Do **not** let browsers connect directly to WAHA.

### 4. Does Gemini API / Flash have "memory"?

Not durable business memory in the way EVO needs.

What is documented:

- The Interactions API supports **multi-turn conversations** by chaining turns with `previous_interaction_id`, and Google says it can handle conversation state server-side.[G1]
- The Interactions API stores requests by default (`store=true`), and Google says you can opt into **stateless** behavior with `store=false`.[G2][G3]
- The older Files API stores uploaded files for **48 hours**; files can be reused across requests during that window, but they are not a permanent knowledge base.[G4][G5]
- Context caching reduces repeated-token cost; it is a **cost/performance optimization**, not durable CRM memory.[G6][G7]

Implication for EVO:

- Gemini can hold **short-lived conversation state** if you deliberately use Interactions API statefulness.
- That is **not** a substitute for per-lead CRM memory, audit history, approval state, or canonical knowledge.
- Durable lead memory still belongs in **EVO's DB**.

### 5. Does "Gemini 3.5 Flash" actually exist as a current official model?

Yes. It is a real current official model name, not a made-up label.

- Google AI's model page names the stable model as **`gemini-3.5-flash`**.[G8]
- The "What's new in Gemini 3.5 Flash" page says it is **GA, stable, and ready for scaled production use**.[G9]
- Google's newer "Using the latest Gemini models" guide also treats **Gemini 3.6 Flash** and **Gemini 3.5 Flash-Lite** as the newer migration targets for many new workloads.[G10]

Practical reading:

- `gemini-3.5-flash` is real and current.
- For a **new** build today, Google is also clearly steering developers toward **`gemini-3.6-flash`** or **`gemini-3.5-flash-lite`** depending on workload.[G10]

## WAHA details that matter for EVO

### Event semantics to rely on

- `message.any` exists across engines and is the safest "message created/observed" umbrella event in WAHA's event matrix.[W5]
- `message.ack` exists across engines and is the right source for delivery/read progression in WAHA's model.[W5]
- WAHA explicitly notes you can request a single message by ID to obtain the **latest `ack`**, but recommends events instead of repeated fetches.[W2]
- `session.status` exists across engines and provides operational state such as `STARTING`, `SCAN_QR_CODE`, `WORKING`, and `FAILED`.[W6]
- In `FAILED`, WAHA recommends restart first, then logout/start if needed.[W6]
- WAHA autostarts previously run sessions after worker restart unless `WAHA_WORKER_RESTART_SESSIONS=False` is set.[W7]

### Reconnect and reconciliation

For EVO, the honest model is:

- **Primary path**: trust webhook/WebSocket delivery for low-latency updates.
- **Repair path**: run a reconciliation worker that periodically compares the last known message/status per chat against WAHA history endpoints.
- **Recovery trigger**: use `session.status` transitions, webhook delivery failures, or message gaps to start reconciliation.

Why this is necessary:

- WAHA gives you transport events and a history API, but it does **not** document a business-level "exactly-once CRM sync" guarantee.
- So EVO still needs its own idempotency, gap detection, and replay logic.

### Privacy and access

For EVO, all of these should stay private:

- WAHA dashboard
- WAHA API
- WAHA media fetch endpoint
- webhook HMAC secret
- session keys

WAHA's own docs support this stance:

- HMAC-authenticated webhooks are supported with SHA-512 headers.[W5]
- Media endpoints accept API keys, but WAHA warns against embedding high-privilege keys in URLs.[W3]

## Gemini details that matter for EVO

### What Gemini can do well here

- classify lead intent
- extract qualification facts
- draft replies
- summarize chat windows
- answer from approved knowledge when you retrieve the right context first

### What Gemini should not be treated as

- the durable CRM memory
- the compliance audit log
- the canonical lead state
- the sole source of truth for approved knowledge

### File Search vs pgvector

Google's managed File Search is real and production-usable:

- It imports, chunks, indexes, and retrieves grounding context for prompts.[G11]
- It supports custom metadata on file imports.[G12]

But for EVO's approved-knowledge requirement, pgvector is still the safer default:

- Files API storage is **48 hours**, so it is not a durable document vault.[G4][G5]
- File Search is a managed retrieval layer, but the official docs do not promise the full retrieval control that a hand-built pgvector pipeline gives you.
- One current developer-forum thread reports metadata filter problems on Interactions API File Search; this is advisory, not contract, but it is enough to avoid making File Search the foundation of EVO's approval-sensitive KB on day one.[A1]
- Another forum thread reports an apparent retrieval cap around a handful of chunks/documents; again advisory only, but it reinforces caution for citation-sensitive workflows.[A2]

Recommendation:

- Keep the **approved sales/admissions knowledge base in EVO-owned pgvector**.
- Use Gemini with retrieved passages from pgvector as explicit context.
- Consider Google File Search only later if you want managed RAG convenience and accept its storage/retrieval tradeoffs.

## Durable memory design for one lead

For each lead, keep four separate memory layers:

### A. Immutable event log

Store every WAHA event you care about:

- external event id
- session
- message id
- chat id
- direction
- timestamps
- ack state
- raw payload
- media metadata

Purpose: replay, audit, debugging, reconciliation.

### B. Canonical chat/message tables

Store normalized rows for:

- chats
- participants
- messages
- attachments
- delivery/read state

Purpose: fast UI queries and operator workflows.

### C. Rolling lead memory

Store compact structured facts such as:

- preferred country/program
- budget signals
- intake stage
- language
- urgency
- blockers
- last promised follow-up
- unanswered questions

Plus one or two summaries:

- `short_summary`: last 10-20 meaningful turns
- `long_summary`: durable narrative summary updated only when needed

Purpose: cheap prompt assembly without replaying the full chat every turn.

### D. Approved knowledge retrieval

Store only approved documents/chunks in pgvector:

- sales playbook
- admissions FAQs
- country rules
- pricing/policy text that is explicitly approved

Purpose: answer accurately without pretending the model "just remembers".

## Option comparison

| Option | Good for | Main problems | MVP verdict |
| --- | --- | --- | --- |
| Per-client filesystem memory | Simple experiments | Hard to query, hard to audit, hard to secure, bad for multi-operator CRM | No |
| DB event log + rolling summaries | Durable lead memory, auditability, easy prompt building | Requires summary maintenance logic | Yes |
| Gemini Interactions server-side session state | Short multi-turn continuity | Google-side storage by default, not durable CRM memory, weaker business control | Optional, not primary |
| Managed agents / agent sessions | Long-running tool use and autonomous workflows | More moving parts than MVP needs; agent harness is overkill for draft qualification | Later, not MVP |
| RAG with pgvector | Approved knowledge retrieval with full control | Requires chunking/indexing discipline | Yes |
| Google File Search | Managed RAG convenience | 48h file storage in Files API and less retrieval control than pgvector; current forum warnings exist | Maybe later |

## Smallest honest architecture for EVO

### Ingestion

1. WAHA GOWS session links the one sales WhatsApp account.
2. WAHA sends only the needed webhooks:
   - `message.any`
   - `message.ack`
   - `session.status`
3. EVO verifies HMAC, persists raw event, and idempotently upserts normalized rows.
4. If media is present, EVO downloads it server-side from `media.url`, stores it under EVO control, and links it to the message row.

### Live operator UI

1. Message write lands in EVO DB.
2. EVO emits a UI event.
3. Browser subscribes to EVO-owned realtime:
   - Supabase Broadcast if that stack already exists, because Supabase recommends Broadcast for scalability/security.[S1]
   - Otherwise plain SSE/WebSocket from EVO is enough for one-account MVP.

### AI qualification

On each new inbound customer message:

1. Build prompt context from:
   - recent normalized messages
   - rolling lead memory
   - retrieved approved KB chunks from pgvector
2. Run one model call to:
   - extract new facts
   - update qualification fields
   - draft the next reply
   - produce a confidence/risk flag
3. Save:
   - extracted facts
   - updated summary
   - draft reply
   - model metadata
4. Show the proposal to an operator during the dry-run stage. After the
   owner-approved deterministic policy and real provider E2E pass, queue only an
   eligible inbound-triggered reply inside the 24-hour service window.

### Model choice

For a new EVO MVP today:

- If you want one strong default model: start with **`gemini-3.6-flash`** because Google's latest guide positions it as stronger on complex agentic/multimodal tasks and lower-priced than 3.5 Flash.[G10]
- If you want cheaper high-volume extraction/summarization workers later: add **`gemini-3.5-flash-lite`**.[G10]
- If you specifically need **`gemini-3.5-flash`**, it is valid and GA.[G8][G9]

## Proposal vs transport authority

For EVO's current risk posture, the safe MVP boundary is:

- AI may **draft**
- AI may **classify**
- AI may **summarize**
- AI may **suggest next action**
- AI may **update internal lead-memory fields**

AI should **never**:

- call WAHA or authorize customer messages itself
- invent prices, scholarships, deadlines, package details, or policy claims
- mutate approved KB content
- change sales stage irreversibly without human review

That boundary fits both the product risk and the documentation reality:

- WAHA gives transport events, not policy truth.
- Gemini gives reasoning, not durable approved memory.
- EVO must own the business record.

## Material decisions

1. Use **WAHA GOWS** if full history import is required.
2. Use **WAHA only as ingress/transport**, not as long-term memory.
3. Store every durable customer-memory artifact in **EVO DB**.
4. Store approved KB in **pgvector**, not in per-client files and not initially in Google File Search.
5. Push UI updates from **EVO-owned realtime**, not direct WAHA-to-browser.
6. Start with a **draft-only dry run**, then enable only the owner-approved
   reply-only lane after deterministic gate, takeover, idempotency, ACK and
   rollback E2E evidence.
7. Treat Gemini's session state and caching as **optional optimization**, not the system of record.

## Source notes

### Primary documentation

- [W1] WAHA config and GOWS history sync: https://waha.devlike.pro/docs/how-to/config/
- [W2] WAHA receive messages and history API guidance: https://waha.devlike.pro/docs/how-to/receive-messages/
- [W3] WAHA media retrieval and media URL security guidance: https://waha.devlike.pro/docs/how-to/receive-messages/
- [W4] WAHA file/media storage configuration: https://waha.devlike.pro/docs/how-to/config/
- [W5] WAHA events, webhooks, websockets, HMAC, and event matrix: https://waha.devlike.pro/docs/how-to/events/
- [W6] WAHA session lifecycle and `session.status`: https://waha.devlike.pro/docs/how-to/sessions/
- [W7] WAHA advanced sessions and autostart: https://waha.devlike.pro/docs/how-to/sessions/
- [G1] Gemini multi-turn conversations with `previous_interaction_id`: https://ai.google.dev/gemini-api/docs/text-generation
- [G2] Interactions API overview and default server-side state: https://ai.google.dev/gemini-api/docs/interactions-overview
- [G3] Gemini logs/datasets and default `store=true` behavior: https://ai.google.dev/gemini-api/docs/logs-datasets
- [G4] Gemini Files API usage/storage limits: https://ai.google.dev/gemini-api/docs/files
- [G5] Gemini document processing note on 48-hour file retention: https://ai.google.dev/gemini-api/docs/document-processing
- [G6] Gemini context caching: https://ai.google.dev/gemini-api/docs/caching
- [G7] Gemini long-context guidance: https://ai.google.dev/gemini-api/docs/long-context
- [G8] Gemini 3.5 Flash model page: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- [G9] What's new in Gemini 3.5 Flash: https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5
- [G10] Latest Gemini models guidance: https://ai.google.dev/gemini-api/docs/latest-model
- [G11] Gemini File Search overview: https://ai.google.dev/gemini-api/docs/file-search
- [G12] Gemini File Search stores API with custom metadata: https://ai.google.dev/api/file-search/file-search-stores
- [S1] Supabase realtime guidance on Broadcast vs Postgres Changes: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes

### Advisory operational lessons, not API contract

- [A1] Google AI Developers Forum: metadata filter concerns on Interactions API File Search: https://discuss.ai.google.dev/t/metadata-filter-for-file-search-stores-in-interactions-api-not-working/127506
- [A2] Google AI Developers Forum: observed File Search retrieval-limit discussion: https://discuss.ai.google.dev/t/investigating-undocumented-file-search-retrieval-limits-that-cap-grounding-at-5-chunks-2-3-documents-per-query/112877
- [A3] Google AI Developers Forum: older chat-session history was in-memory in SDK usage: https://discuss.ai.google.dev/t/gemini-chat-history/5933
- [A4] WAHA 2025.1 release post on GOWS reliability and PostgreSQL support: https://waha.devlike.pro/blog/waha-2025-1/
