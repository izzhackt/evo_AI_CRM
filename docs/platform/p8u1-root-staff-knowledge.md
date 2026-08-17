# P8U1 root-owned staff knowledge seam

Issue: #278

## Outcome

Move the remaining reviewed staff knowledge-assistant and deterministic bundle
import capability under the root EVO CRM without activating Supabase Auth or
publishing a new public surface. The accepted root `/whatsapp` application
remains the only Platform UI. EVO Inbox remains a donor and rollback boundary;
the root implementation must not import or proxy its dashboard.

P8U1 produces repository code only. In an environment without the complete
Platform Auth and server configuration, the staff route is deliberately
unusable and fails before knowledge, Gemini or audit access. There is no demo,
anonymous-staff or `AUTH_DISABLED` behavior.

## Fixed route contract

- Root route: `POST /api/platform-ai/staff-assistant`.
- Every non-`POST` method returns `405` with `Allow: POST`.
- The route accepts only same-origin `application/json` requests with a closed,
  bounded body and no unknown fields. `Content-Type` is exactly
  `application/json`; the raw body is at most `65,536` bytes, must be valid
  UTF-8 and canonical JSON parsing must produce one object.
- The body is a discriminated union:
  - `client`: one to twenty strictly alternating `user`/`assistant` turns,
    starting and ending with `user`, and optional fixed evaluation case
    `client_china_documents`;
  - `internal`: one non-empty staff question and optional fixed evaluation
    case `internal_malaysia_handoff`.
- Every accepted text is trimmed, must remain between `1` and `4,000` UTF-8
  bytes, and the normalized client transcript may total at most `32,000` UTF-8
  bytes. Empty or over-limit content is rejected rather than truncated.
- The authenticated Platform actor is resolved with the same request-scoped
  Supabase client used for authorization. Only `admin`, `sales` and `curator`
  actors are admitted. Anonymous, invalid, `finance` and `student` actors fail
  before the knowledge repository or provider is called.
- A success response is exactly
  `{reply, handoff, sources, audit_id}`. `reply` is a non-empty trimmed string of
  at most `16,384` UTF-8 bytes; `handoff` is boolean; `sources` is an ordered
  non-empty array of at most five exact
  `{chunk_id, source_path}` objects; `audit_id` is one non-nil UUID.
- Every error response is exactly `{error:{code}}`, with no error text,
  exception, UUID, provider body or path. The fixed codes/statuses are:
  `invalid_request/400`, `auth_required/401`, `forbidden/403`,
  `method_not_allowed/405`, `request_too_large/413`,
  `unsupported_media_type/415`, `rate_limited/429`,
  `knowledge_unavailable/503`, `provider_unavailable/502`,
  `audit_unavailable/503` and `assistant_disabled/503`.

## Configuration and ownership

P8U1 adds an explicit disabled-by-default server configuration. Enabling the
seam later requires all of the following exact environment values to validate
together:

- `EVO_PLATFORM_STAFF_ASSISTANT_ENABLED=1`: the only enabling value;
- `NEXT_PUBLIC_SUPABASE_URL`: HTTPS project origin used by both the existing
  request-scoped SSR Auth client and server repositories;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public credential used only by the
  existing request-scoped SSR Auth client to verify the browser session;
- `EVO_PLATFORM_SUPABASE_SECRET_KEY`: privileged `sb_secret_...` credential
  used only after actor authorization for knowledge retrieval and body-free
  audit writes;
- `EVO_PLATFORM_ORGANIZATION_ID`: exact non-nil Platform organization UUID
  that the authenticated actor must match;
- `EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID`: exact non-nil canonical knowledge
  account UUID used by the server repository and importer, never by the
  browser;
- `EVO_PLATFORM_GEMINI_API_KEY`: server-only Gemini credential used for the
  single draft call and importer embeddings.

The model is not configurable in P8U1: it is exactly `gemini-3.5-flash`. The
provider timeout is exactly `15,000` ms, output cap exactly `2,048` tokens,
temperature exactly `0.2`, candidate count exactly one, `store: false`, no
tools and no application retry. These constants cannot be overridden by env.

The actor organization must equal the configured Platform organization before
the server may use the configured knowledge account. The account UUID is never
accepted from a browser request. Missing, malformed or conflicting
configuration fails closed and does not fall back to the companion, SQLite or
another account.

## Retrieval, draft and audit boundary

- Retrieval is audience-scoped to the configured account and uses the
  canonical `ai_knowledge_chunks` / `ai_knowledge_documents` schema.
- P8U1 retrieval is lexical-only and makes no embedding provider call. It calls
  `match_ai_knowledge_fts` once with the exact account, requested audience,
  normalized latest user question and `p_match_count=5`. The repository
  preserves the RPC rank-descending order, rejects duplicate/invalid rows,
  fetches source paths for the returned chunk IDs in one query, and removes any
  chunk without an exact same-account/same-audience source binding.
- Each retained excerpt is `1..4,000` UTF-8 bytes, each NFC-normalized source
  path is `1..512` UTF-8 bytes and must not contain an empty, dot, hidden,
  traversal, raw-archive or secrets segment. The ordered combined excerpt
  budget is `12,000` UTF-8 bytes; a row that would exceed it and every later row
  are not included. At least one bound source is mandatory.
- The result must retain the exact `chunk_id` and normalized `source_path` for
  every excerpt. No source binding means no draft.
- The provider call is a staff-triggered draft call only. The final system
  instruction plus transcript plus retrieved excerpts must be at most `60,000`
  UTF-8 bytes. It uses Gemini `generateContent`, `store: false`, the fixed
  system instruction, no tools, the exact constants above and no automatic
  retry. The current API documents
  `systemInstruction`, `generationConfig` and `store` here:
  https://ai.google.dev/api/generate-content.
- Customer text is treated only as untrusted content to answer, never as a
  system instruction. Internal answers remain internal.
- A successful draft is returned only after the immutable
  `ai_assistant_audits` insert succeeds. The audit retains the response hash,
  provider/model, audience, actor and source identities, not the response body.
- The seam cannot send WhatsApp, call WAHA, read/write amoCRM, update durable
  memory or enable autonomous replies.
- A process-local fixed-window guard permits at most `20` admitted requests per
  actor and `100` per organization in any `60,000` ms window. Either limit
  blocks before retrieval/provider access. This is cost containment for the
  single-instance private candidate, not a substitute for later provider-side
  quotas.

## Root-owned importer

- Package a self-contained non-root importer in the root CRM image.
- Preserve the reviewed canonical bundle and manifest byte validation,
  account/audience binding, document SHA-256 and PII/path gates.
- The CLI requires `--account-id` to equal the valid
  `EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID` before reading bundle files or reaching a
  provider/database seam. Import work is capped before Gemini at exactly:
  `16,777,216` bundle bytes, `16,384` manifest bytes, `512` documents,
  `262,144` UTF-8 content bytes per document, `12,582,912` total UTF-8 content
  bytes and `8,000` total deterministic chunks. Exceeding any cap fails before
  embedding or the sync RPC.
- Materialize all embeddings before the atomic
  `sync_ai_knowledge_bundle` RPC. A provider or validation failure must leave
  the database unchanged.
- Pin `gemini-embedding-2` at 1536 dimensions to match `vector(1536)`; Google
  documents that model and supported 1536-dimensional output here:
  https://ai.google.dev/gemini-api/docs/embeddings.
- Import output is the existing UUID-free safe projection: status, version,
  audience, bundle SHA-256 and document/chunk counters only.
- P8U1 tests the importer with deterministic local fixtures and injected
  embedding/database seams. It does not import the frozen 11/291 production
  bundles or call Gemini.

## TDD seams

The owner-confirmed seams from the parent contract are:

1. route/auth boundary;
2. audience/account/source repository boundary;
3. provider-to-body-free-audit completion boundary;
4. canonical bundle/import output boundary;
5. root image packaging boundary.

Each vertical slice starts with a failing behavior test. Tests use injected
local seams and never claim mock behavior as provider or production proof.

## Validation and completion

- Node `22.23.1` only;
- targeted tests for all five seams;
- full registered unit suite, lint, typecheck/build and `git diff --check`;
- no OrbStack/container work in P8U1;
- independent exact-head review and 4/4 PR CI;
- squash merge and exact-main green CI;
- production container identities and restart counts remain unchanged.

P8U1 grants no production, provider, customer-data, knowledge-import, Auth
activation, DNS/Caddy, restart, outbound or billed-resource authority.
