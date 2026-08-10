# P4R1 bounded live canonical amoCRM context

Status: implementation candidate, disabled by default

Date: 2026-08-10 (Asia/Bishkek)

Block-ID: `EVO-P4R1-AMOCRM-CANONICAL-CONTEXT-2026-08-10`

Baseline: `88169c55935f0b66d0b58e844a5e6c4cac2cc285`

## Outcome

P4R1 adds the smallest live, read-only canonical amoCRM context behind the
accepted `/whatsapp/[id]` operator thread. When the authorized Platform
conversation already carries exact provider account/contact/lead IDs and the
server has an enabled read credential, the UI can show the provider's current
contact, lead, responsible manager and pipeline/stage names.

This is not P4B mapping approval, identity discovery, an amoCRM write or a
provider cutover. It never uses the legacy SQLite settings or mutable amoCRM
adapter. Missing or conflicting truth remains visible as a disabled, blocked,
degraded or stale state.

## Provider boundary

The server may issue only bounded HTTPS `GET` requests to one validated
`<subdomain>.amocrm.ru` or `<subdomain>.kommo.com` origin:

1. `/api/v4/account`
2. `/api/v4/contacts/{contact_id}?with=leads`
3. `/api/v4/leads/{lead_id}?with=contacts`
4. `/api/v4/leads/pipelines/{pipeline_id}`
5. `/api/v4/users/{responsible_user_id}`

The user lookup is administrator-only according to the provider documentation.
Its denial degrades the responsible-manager label without turning the rest of
the verified contact/lead/stage response into fake success. Kommo Chats API is
outside this slice because the exact CRM entity IDs are already the input.

Requests reject redirects, credentials in origins, unexpected hosts, oversized
or malformed responses and mismatched provider IDs. They use a shared bounded
start rate, a timeout and no automatic retry. `429` metadata may guide a later
attempt but never causes an immediate retry storm.

## Durable truth contract

- A provider account ID must match the conversation account ID.
- Contact and lead must cross-reference the exact other entity.
- Pipeline/status and responsible-user IDs must equal the IDs on the exact
  provider lead.
- Browser data contains only the small sanitized context and observation time;
  it never contains the token or raw provider response.
- Supabase keeps append-only observations for successful and failed live read
  attempts plus one minimal current projection per organization/conversation.
- Service-only writes revalidate that the Platform conversation owns the exact
  provider account/contact/lead IDs. Staff reads repeat live organization,
  role, access-version and conversation-scope authorization.
- Each success records adapter contract version, safe canonical values,
  provider relationships/capabilities actually exercised and observation time.
  Each failure records a bounded code without token or raw response data.
- A failed refresh may retain a prior successful value only with `state=stale`
  and its original observation time. A process-local single-flight guard may
  suppress duplicate concurrent refreshes but is never the durable store.
- These observations are read evidence, not P4B semantic mapping approval, AI
  grounding, ownership/handoff authority or real-provider proof.

## Excluded

- amoCRM create/update/delete, stage changes and task/note/file writes;
- task, call/recording or chat-history reads;
- name/phone search, inferred links or hardcoded account/mapping IDs;
- P4A latest-snapshot selection as an implicit approval;
- P4B approval/revocation/current-selection state;
- SQLite fallback, provider mocks described as live proof, and production
  credential/session/deployment mutation.

## Evidence required before merge

- focused config, client, normalization, relationship and repository tests;
- disposable PostgreSQL append-only/idempotency/service-only/RLS/tenant/scope
  tests for the additive current projection;
- accepted-thread rendering and server-only secret containment tests;
- root unit/security-node, lint, type generation, TypeScript, production build,
  dependency audits, scoped secret scan and diff checks;
- exact-head GitHub CI and one independent read-only review of that exact SHA.

Synthetic provider responses are local contract evidence only. Real amoCRM
proof remains blocked until an owner-approved credential and sanitized contact/
lead are exercised without any provider write.

## Rollback

Keep the feature disabled or revert server/UI code and forward-fix the additive
schema. Do not use a destructive database down migration. P4B and the retained
Lead Agent/legacy rollback path remain unchanged.
