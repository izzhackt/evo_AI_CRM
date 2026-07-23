# Managed Supabase Companion Store

Issue #11 prepared EVO Inbox Companion for a managed Supabase Cloud project.
Issues #13 and #14 now use those tables for WAHA and amoCRM configuration while
keeping this document focused on schema, environment, RLS, and validation
workflow. This document does not deploy the app or touch `/opt/evo-crm`.

## Store Boundary

Supabase stores companion app data:

- Supabase Auth users, `profiles`, `accounts`, account roles, and invitations.
- Contacts and local shadow identity fields such as `contacts.amo_contact_id`.
- Conversations and local lead shadow fields such as `conversations.amo_lead_id`.
- Conversation/message CRM sync state such as `crm_sync_status`, which can be
  `pending`, `synced`, `not_configured`, or `blocked`.
- Messages, reactions, notifications, and retained operator UI state.
- Integration status/settings for `waha` and `amocrm` providers.
- Encrypted integration secrets in `integration_secrets`.
- AI settings, provider keys encrypted by the app, knowledge documents, and
  knowledge chunks.
- Storage buckets used by retained app features.

amoCRM remains canonical for contact identity, lead identity, sales state, and
pipeline status. Supabase shadow fields are lookup/cache fields for the
companion operator UI and must not be presented as canonical amoCRM state.
Inbound WhatsApp messages are still saved locally first so operators do not lose
visibility when amoCRM is missing or temporarily unavailable; unsynced rows must
be shown as pending/not configured/blocked until the retry path records the
amoCRM shadow ids.

## Runtime Environment

Required runtime variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-or-secret-key
ENCRYPTION_KEY=your-64-char-hex-key
```

Rules:

- Commit only variable names and placeholders.
- Keep `.env.local` untracked.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are used by
  browser and SSR clients and rely on RLS.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. It bypasses RLS and must never be
  exposed in client code, public docs, logs, URLs, or screenshots.
- `ENCRYPTION_KEY` encrypts provider keys and integration secrets with the app's
  AES-256-GCM helper. Rotating it without re-entering secrets makes existing
  ciphertext unreadable.

Official docs checked on 2026-07-06:

- Supabase CLI: https://supabase.com/docs/reference/cli/introduction
- Supabase local CLI setup: https://supabase.com/docs/guides/local-development/cli/getting-started
- Supabase local migrations: https://supabase.com/docs/guides/local-development/overview
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API keys and service-role behavior: https://supabase.com/docs/guides/getting-started/api-keys

The docs state that linked remote migration commands require `supabase link`,
`db push --dry-run` prints migrations without applying them, local `db reset`
requires a running local stack, and `gen types` can generate TypeScript types
from linked or local databases. They also state that RLS should be enabled for
tables in exposed schemas and that service/secret keys bypass RLS.

## Managed Cloud Workflow

Run from `agent-lead2-inbox/`.

```bash
supabase login
supabase link --project-ref <project-ref>
supabase migration list
supabase db push --dry-run
```

Only after confirming the linked project is a non-production/dev companion
project intended for this run:

```bash
supabase db push
supabase gen types --linked --lang typescript --schema public > src/types/supabase.generated.ts
```

Do not run `supabase db push` against production unless an explicit production
migration window has been approved. This issue does not deploy or mutate a live
Supabase project by default.

## Local Validation Workflow

If no managed credentials are available but Docker is available:

```bash
supabase start
supabase db reset --local
supabase gen types --local --lang typescript --schema public > src/types/supabase.generated.ts
```

If the CLI or Docker is missing, record the exact blocker. Do not claim local
migration success without the CLI applying the migrations to a real local
Supabase stack.

## RLS And Service-Role Boundary

Client and SSR session paths use the anon/publishable key and rely on RLS:

- Account-scoped data is filtered through `is_account_member(account_id, role)`.
- Settings tables allow member reads and admin writes.
- Operational records such as contacts, conversations, and messages are scoped
  to the member's account.

Service-role paths are allowed only in trusted server code that performs its own
authorization and account scoping before reading or writing data:

- Public API key auth has no Supabase user session, so it resolves a key to one
  `accountId` and then every downstream query must filter by that account.
- Inbound/background/provider paths can use service-role clients only after the
  route has authenticated the caller or provider event.
- `integration_secrets` has no authenticated SELECT policy. Server code should
  expose only booleans such as `has_secret` to clients, read ciphertext with a
  service-role client, and decrypt only inside server-only code.

Current WAHA/amoCRM usage:

- WAHA public config: `baseUrl`, `sessionName` (default `evo-inbox`).
- WAHA encrypted secrets: `api_key`, `webhook_hmac_secret`.
- amoCRM public config: `baseUrl`, optional `pipelineId`, `statusId`, and
  `responsibleUserId`.
- amoCRM encrypted secrets: `access_token`, optional `refresh_token`,
  `client_id`, and `client_secret`.

Current local tests cover this boundary at the highest practical seam without a
live Supabase project:

```bash
npm test -- src/lib/supabase/schema-contract.test.ts src/lib/auth/api-context.test.ts
```

Live Postgres RLS behavior still needs linked or local Supabase validation before
claiming database-enforced success.

## Draft Audit And Manual-Outbox Migration

Migration `037_operator_drafts_and_waha_outbox.sql` is a required database-first
release gate. It must be applied and verified on the intended Supabase project
before deploying application code that returns audited AI drafts or persists
manual sends.

The migration adds:

- append-only, account-scoped `ai_drafts` rows containing the operator,
  conversation, provider/model, generated text, and exact knowledge chunk ids;
- durable outbound state on `messages`, using the browser request UUID as the
  existing `messages.id` primary key and concurrency gate;
- WAHA acknowledgement evidence and a narrowly granted service-role RPC that
  advances message state without allowing browser clients to forge provider
  acknowledgements.

The application inserts a queued message before the WAHA request. A confirmed
provider rejection becomes `rejected`; a timeout, lost response, or database
finalization failure remains `unknown` or `dispatching` for review. Those
ambiguous rows must never be sent again automatically.

A successful WAHA response without a stable provider message id remains a
confirmed request acceptance and is stored as
`waha_message_status='accepted_without_id'`. It cannot be reconciled later, so
the Inbox shows an amber operator-review warning instead of a normal sent
checkmark. Verify the message directly in WhatsApp; do not resend it
automatically.

Production sequence:

```bash
supabase migration list
supabase db push --dry-run
# Review that only the intended pending migration is listed.
supabase db push
supabase migration list
```

After the push, verify the migration remotely before deploying code:

```sql
select to_regclass('public.ai_drafts') is not null as ai_drafts_exists;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'messages'
  and column_name in (
    'ai_draft_id',
    'outbound_state',
    'outbound_attempt_count',
    'outbound_error_code',
    'outbound_error',
    'outbound_started_at',
    'outbound_completed_at',
    'waha_chat_id',
    'waha_ack',
    'waha_ack_name',
    'waha_ack_at'
  )
order by column_name;
```

If the linked project, migration history, or pending set is unclear, stop
before `db push`. Do not deploy the new application image first: old code can
continue against the additive schema, while new code cannot safely run without
it.

## Scale And Retention Readiness

Issue #27 adds explicit knowledge retrieval provider selection and the first
production-scale storage audit for conversations, messages, and knowledge
vectors. Use `docs/supabase-scale-retention.md` before production proof and
before any historical import.

Current decision:

- Free Supabase is acceptable only for issue #20 proof and a small pilot.
- Move to Pro before sustained production WhatsApp traffic, any import above
  50k messages, database size above 250 MB, or thousands of knowledge chunks.
- Keep `vector(1536)` and HNSW for Gemini/OpenAI semantic retrieval; the
  language-neutral keyword path remains the fallback.
- No automatic retention deletion is enabled until an owner-approved retention
  policy exists.

## 2026-07-06 Validation Attempt

Commands run from `agent-lead2-inbox/`:

```bash
npm ci --include=dev
npm test
npm run lint
npm run typecheck
npm run build
supabase --version
docker info
test -n "$SUPABASE_ACCESS_TOKEN"
```

Results:

- `npm ci --include=dev` passed and reported `found 0 vulnerabilities`.
- `npm test` passed: 63 files, 625 tests.
- `npm run lint` passed with 11 existing warnings unrelated to issue #11.
- `npm run typecheck` passed.
- `npm run build` passed with existing Next.js warnings about workspace-root
  inference and the deprecated `middleware` convention.
- `supabase --version` failed with `supabase: command not found`.
- `docker info` passed, so Docker is available.
- `SUPABASE_ACCESS_TOKEN` is unset.

Supabase blocker:

The Supabase CLI is not installed as `supabase`, no linked managed Supabase
project credentials are present, and no access token is available. Because the
CLI is missing, local validation could not run even though Docker is available.
The following commands were therefore not run and must be run once the CLI and a
linked or local project are available:

```bash
supabase link --project-ref <project-ref>
supabase migration list
supabase db push --dry-run
supabase gen types --linked --lang typescript --schema public > src/types/supabase.generated.ts
```

or, for local validation:

```bash
supabase start
supabase db reset --local
supabase gen types --local --lang typescript --schema public > src/types/supabase.generated.ts
```
