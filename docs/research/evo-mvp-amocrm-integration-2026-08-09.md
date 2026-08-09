# EVO MVP amoCRM/Kommo integration research

Research date: 2026-08-08 (Asia/Bishkek)
Requested artifact filename: `evo-mvp-amocrm-integration-2026-08-09.md`

## Scope and boundary

This note answers one narrow question: what the current official amoCRM/Kommo API and chat docs prove about a minimum safe EVO MVP integration where amoCRM remains the source of truth for salespeople, leads, contacts, stages, tasks, calls, and chat history.

This note does **not** prove any EVO account-specific mapping, installed scopes, webhook availability, plan tier, custom fields, active users, source IDs, or provider credentials. Those still require a real authorized EVO amoCRM/Kommo account and live provider checks.

## Executive conclusion

The current docs support a conservative MVP:

1. Use OAuth 2.0 to install the integration and call `GET /api/v4/account` first to discover the real account `id`, `subdomain`, and optional `amojo_id`/`drive_url` values.[1][2]
2. Treat amoCRM/Kommo as canonical for lead/contact/company identity, responsible manager, pipeline stage, tasks, sources, notes, calls, and chat history metadata.[2][3][4][5][6][7][8][9][10]
3. In EVO Platform, store only foreign keys, a minimal materialized projection for UI/search/reporting, durable sync metadata, and local workflow state that amoCRM does not own.
4. Prefer webhook-triggered reconciliation plus periodic `updated_at` backfill instead of trying to mirror the whole CRM continuously.[3][11][12]
5. Avoid direct canonical writes from EVO unless the business explicitly wants EVO to become an editing surface for a small approved subset such as task creation, note creation, or attachment upload. The documented API can do those writes, but the safest MVP is read-mostly with tightly bounded writes.[6][7][8][9][13][14]

## What the official docs prove

### 1. Auth and account discovery

- amoCRM documents OAuth 2.0 as the authorization model for integrations and positions OAuth as the replacement for legacy user API keys.[1]
- Kommo documents account discovery at `GET https://{subdomain}.kommo.com/api/v4/account` and returns at least `id`, `name`, `subdomain`, and `current_user_id`.[2]
- The same account endpoint can also return:
  - `amojo_id` for the chat service account ID,
  - `task_types`,
  - `drive_url` for the file service,
  - `users_groups`,
  - chat capability details via `amojo_rights`,
  when requested through `with` parameters.[2]
- Kommo permissions docs say integrations are installed by administrators, may later be authorized by other users, and API access is limited by the authorizer's rights. If an administrator granted access, requests may also use `X-Context-User-ID` to execute under another user's rights.[15]

Implication for EVO:

- First successful install should persist the real account identifiers from `/api/v4/account`, not infer them from UI text or hardcoded domains.
- OAuth custody and refresh-token storage are required for a production integration. Scope choice matters because chat history and files are separate permission groups.[15]

### 2. Leads, contacts, responsible manager, stages, tasks

- `GET /api/v4/leads` returns lead IDs, `responsible_user_id`, `created_at`, `updated_at`, `closest_task_at`, and supports `with`, paging, and filters including `responsible_user_id`, `updated_at`, `pipeline_id`, and pipeline+status filters. The per-page limit is `250`.[3]
- `GET /api/v4/contacts/{id}` returns contact identity and can embed linked leads when `with=leads` is requested.[4]
- `GET /api/v4/users/{id}` is administrator-only and can return user `uuid`, chat `amojo_id`, and rights including `is_admin` and `is_active`.[5]
- `GET /api/v4/leads/pipelines/{pipeline_id}/statuses` returns the stage directory for a pipeline.[6]
- `POST /api/v4/tasks` and `PATCH /api/v4/tasks` are documented for adding and editing tasks.[13][7]

Implication for EVO:

- Canonical lead ownership should come from amoCRM `responsible_user_id`, not from a duplicated EVO-only owner table.
- Stage mapping must be ID-based (`pipeline_id` + `status_id`), not name-based, because names are mutable and localizable.
- EVO can safely project "next task due" and "assigned manager" from amoCRM without owning task truth itself.

### 3. Webhooks and reconciliation

- Kommo documents standard webhooks as account-configured notifications and says webhook API management is available only on Advanced, Pro, and Enterprise plans.[11]
- `POST /api/v4/webhooks` exists and is administrator-only.[8]
- Standard webhook payloads are documented as `x-www-form-urlencoded` event notifications.[11]
- The webhook event catalog includes at least `add_lead`, `update_lead`, `update_contact`, `delete_lead`, `delete_contact`, `status_lead`, `note_lead`, `note_contact`, `add_task`, `update_task`, `delete_task`, and `add_message`.[12]
- Leads and contacts both expose `updated_at`, and leads support `filter[updated_at][from|to]`; notes also support `updated_at` filters.[3][4][16]

Implication for EVO:

- Safe MVP pattern:
  - receive webhook,
  - enqueue reconciliation by entity type + entity ID + event time,
  - re-read the canonical entity from amoCRM,
  - upsert the EVO projection idempotently.
- Do not trust webhook bodies alone as final truth. Webhooks should be treated as change signals, while the follow-up GET establishes current canonical state.
- Because webhook availability depends on account plan and setup, EVO still needs a scheduled `updated_at` sweep as a repair path.[11]

### 4. Calls, notes, recordings, and attachments

- Kommo documents `POST /api/v4/calls` for adding multiple calls.[9]
- Kommo subject-area docs say call events are displayed in entity records and that if the call event includes a link to the call recording, a player is embedded in the note in the card UI.[17]
- Notes are first-class entities on leads, contacts, and companies; `POST /api/v4/{entity_type}/notes` is documented.[18]
- Files are a separate capability. Kommo documents Files API scopes, file upload sessions, reusable files, file-as-note behavior, file custom fields, and entity file attachment via `PUT /api/v4/{entity}/{entity_id}/files`.[10][14]
- Files API key-features docs say a file can be displayed in a note by passing the file `uuid` and file name through the Notes API; the same file can also be attached to entity media and reused elsewhere.[14]

Implication for EVO:

- For an MVP, the lowest-risk approach is to **read** call and note evidence from amoCRM and expose links/metadata in EVO instead of re-hosting or duplicating raw recordings.
- If EVO later needs to upload generated files back to amoCRM, it can do so through the Files API and entity attachments without redefining a second document system inside EVO.[10][14]

### 5. Chats, conversations, messages, and chat-specific IDs

- Kommo separates chat identity from regular CRM identity:
  - account chat ID = `amojo_id`,
  - user chat ID = user `amojo_id`,
  - connected channel/account scope = `scope_id`,
  - chat thread key = `conversation_id`.[2][5][19][20][21]
- To work with Chat API, the docs require retrieving the account `amojo_id`, and explain that account and user chat IDs differ from the normal API IDs.[19]
- Connecting a chat channel requires `channel_id` plus the account chat ID in the request body; the response includes `scope_id` unique for that account-channel connection.[20]
- Chat history is retrieved from `GET https://amojo.kommo.com/v2/origin/custom/{scope_id}/chats/{conversation_id}/history`.[21]
- Kommo also documents `GET /api/v4/contacts/chats` for retrieving a contact's chats.[22]
- Chat webhooks use a separate validation model: each webhook includes `X-Signature`, generated from the body with `HMAC-SHA1` using the channel secret.[23]
- Chat webhook delivery is stricter than standard CRM webhooks: the docs say the integration must answer within 5 seconds, and each webhook is sent only once with no retry if it is not processed successfully.[23]

Implication for EVO:

- If EVO only needs to display the existing amoCRM conversation context, it should prefer:
  - CRM entity linkage from leads/contacts,
  - contact chat lookup,
  - chat history read APIs,
  instead of trying to become a primary message transport.
- If EVO later becomes an active chat transport, it must store and protect chat-specific IDs separately from CRM IDs and must implement strict idempotent processing for chat webhooks because missed webhooks are not retried.[19][20][21][23]

### 6. Rate limits, batching, and collision hints

- Kommo limitations docs say the API is limited to **not more than 7 requests per second** and excessive `429` responses can escalate to `403` blocking.[24]
- Lead and contact list endpoints page at up to `250` entities per request.[3][25]
- `POST /api/v4/leads/complex` supports batch creation of leads with one related contact and one related company and states that added data participates in duplicate control when enabled for that integration.[26]
- Kommo's November 18, 2024 changelog says `tags_to_add` and `tags_to_delete` were added to help avoid collisions when multiple integrations change the same entity simultaneously.[27]

Implication for EVO:

- EVO should use:
  - a global per-account rate limiter,
  - page-based incremental readers,
  - idempotency keys in its own queue/outbox,
  - read-after-write verification for the few writes it performs.
- EVO should avoid "full account resync on every event" because the docs' limit profile is too low for that pattern at scale.[24]

## Minimum safe architecture that avoids duplicating amoCRM

### Recommended ownership split

**amoCRM/Kommo remains canonical for:**

- lead, contact, company, task, source, pipeline, and stage IDs;
- `responsible_user_id` and active sales ownership;
- notes, calls, and existing chat history;
- telephony/chat-origin evidence already captured there;
- custom field definitions and option dictionaries.

**EVO Platform should own only:**

- foreign-key mappings to amoCRM IDs;
- a read-optimized projection for UI and reporting;
- webhook receipt logs and reconciliation job state;
- integration install metadata, token custody, scopes granted, sync cursors;
- platform-only workflow state that amoCRM does not model.

### Recommended flow

1. OAuth install by an amoCRM admin.
2. Call `/api/v4/account` and persist account `id`, `subdomain`, `amojo_id`, `drive_url`, task types, and scope facts actually granted.[2][15]
3. Snapshot static metadata first:
   - users,
   - pipelines and statuses,
   - lead/contact custom fields,
   - sources.[2][5][6][28]
4. Build read models from leads/contacts using `updated_at` paging.[3][25]
5. Subscribe to standard CRM webhooks if the account plan and admin rights allow it; otherwise rely on polling only.[8][11]
6. On webhook:
   - enqueue,
   - fetch current canonical entity,
   - update EVO projection,
   - never infer current state from stale local copies alone.
7. For chat visibility:
   - map contact to chats,
   - fetch history by `scope_id` + `conversation_id`,
   - store only the metadata needed for the EVO view unless a later approved requirement demands local message warehousing.[19][20][21][22]

## What EVO should read vs write in MVP

### Read by default

- account metadata;
- active users and their rights/activeness;
- pipelines and statuses;
- leads and contacts with `updated_at` filters;
- sources;
- notes and call evidence already present in amoCRM;
- chat history and contact-chat linkage when the chat scopes are granted.

### Write only if the business explicitly approves the surface

- task creation/editing from EVO operator workflows;[13][7]
- note creation for operator audit breadcrumbs or document delivery markers;[18]
- file uploads and entity attachments for generated documents;[10][14]
- tightly bounded lead/contact updates for fields that the sales team wants EVO to own operationally.

### Avoid in first MVP

- broad bi-directional lead/contact field editing;
- stage changes initiated automatically by EVO unless there is an approved exact field/stage contract;
- chat sending/importing as the first phase;
- duplicating raw recordings or becoming a second source of truth for call records.

## Loop and conflict prevention

The docs prove enough to justify these controls, even though they do not prescribe one exact architecture:

1. Treat amoCRM webhook events as hints; re-read canonical entities before final projection writes.[3][11][12]
2. Maintain per-entity high-water marks using amoCRM `updated_at`, plus a reconciliation cursor for backfills.[3][4][16]
3. Use field-level ownership rules. If EVO writes a note, task, or attachment, mark it with integration metadata so EVO can recognize its own artifacts on the next sync.
4. Keep writes narrow. A small write surface sharply reduces collision risk and rate-limit pressure.
5. Separate CRM IDs from chat IDs. `user.id` is not `user.amojo_id`; account `id` is not account `amojo_id`; channel connection `scope_id` is separate again.[2][5][19][20]
6. Assume chat webhook loss is possible because chat webhooks are single-delivery with a 5-second response budget.[23]

Secondary engineering material reinforces the same direction:

- one maintained v4 PHP client advertises OAuth auto-refresh, pagination helpers, callbacks, bulk operations, and request-rate limiting as core features;[29]
- an older wrapper explicitly advertises API throttling, request/response logging, and locking around concurrent updates to one entity.[30]

Those secondary sources are not proof of provider behavior, but they are consistent with the official rate-limit and multi-writer constraints and are good implementation cues.

## What remains unproven until live EVO provider access

These are **not** proven by documentation alone:

- which exact EVO subdomain and account ID are in use today;
- whether the EVO account is on a plan that permits webhook API management;
- which OAuth scopes an EVO admin will actually grant;
- the real lead/contact custom field IDs and enum values for OZO China and other teams;
- the real pipeline/status IDs that represent signed contract, enrolled, dropped, etc.;
- whether calls/recordings already arrive through a telephony integration in a shape EVO can reuse;
- which chat channels are connected, whether contact-chat lookup is populated, and whether outgoing-message chat webhooks are enabled;
- the exact account/provider evidence needed to prove the owner-approved
  read-mostly MVP path.

## Owner decisions applied and remaining provider questions

The owner accepted the recommended MVP boundary on `2026-08-09`:

1. use one server-side, admin-granted account integration rather than browser or
   per-user provider tokens;
2. keep an RLS-safe current projection plus bounded receipt/reconciliation
   evidence, not a second analytics CRM;
3. perform no amoCRM writes in the MVP adapter;
4. read existing chat visibility and references only; WAHA remains the Platform
   transport path;
5. expose only approved recording references/safe metadata and do not copy raw
   recordings without a later legal/privacy/storage decision;
6. use webhook hints plus scheduled delta reconciliation where the account plan
   permits, or explicit degraded polling when it does not.

Live provider access must still answer the remaining release questions: exact
account/subdomain and OAuth scopes, pipeline/status/user/custom-field mappings,
available webhook/chat/telephony capabilities, and the provider-backed identity
seam for existing duplicates. Missing answers fail closed and are never inferred.

## Sources

### Primary documentation

[1] amoCRM OAuth 2.0: https://www.amocrm.ru/developers/content/oauth/oauth
[2] Kommo account parameters: https://developers.kommo.com/reference/account-parameters
[3] Kommo leads list: https://developers.kommo.com/reference/leads-list
[4] Kommo contact by ID: https://developers.kommo.com/reference/get-contact
[5] Kommo user by ID: https://developers.kommo.com/reference/get-user-by-id
[6] Kommo pipeline stages list: https://developers.kommo.com/reference/stages-list
[7] Kommo edit tasks: https://developers.kommo.com/reference/edit-tasks
[8] Kommo add webhook: https://developers.kommo.com/reference/add-webhooks
[9] Kommo add calls: https://developers.kommo.com/reference/add-calls
[10] Kommo Files API capabilities: https://developers.kommo.com/reference/files-api
[11] Kommo webhooks overview: https://developers.kommo.com/docs/webhooks-general
[12] Kommo webhook events: https://developers.kommo.com/reference/webhook-events
[13] Kommo add tasks: https://developers.kommo.com/reference/add-tasks
[14] Kommo Files API key features: https://developers.kommo.com/reference/files-api-key-features
[15] Kommo permissions: https://developers.kommo.com/docs/permissions
[16] Kommo notes by entity ID: https://developers.kommo.com/reference/notes-by-entity-id
[17] Kommo subject area: https://developers.kommo.com/docs/subject-area
[18] Kommo add notes: https://developers.kommo.com/reference/add-notes
[19] Kommo Chats API account ID: https://developers.kommo.com/reference/chat-api-accountid
[20] Kommo connect chat channel: https://developers.kommo.com/reference/connect-channel
[21] Kommo get chat history: https://developers.kommo.com/reference/chat-history
[22] Kommo get contact chats: https://developers.kommo.com/reference/get-contact-chats
[23] Kommo chat webhooks: https://developers.kommo.com/reference/receiving-chat-webhooks
[24] Kommo API limitations: https://developers.kommo.com/docs/limitations
[25] Kommo contacts list: https://developers.kommo.com/reference/contacts-list
[26] Kommo complex leads: https://developers.kommo.com/reference/complex-leads
[27] Kommo changelog, 2024-11-18 API documentation updates: https://developers.kommo.com/changelog/updates-in-api-documentation
[28] Kommo sources and source list: https://developers.kommo.com/reference/sources and https://developers.kommo.com/reference/get-sources

### Secondary operational references

[29] `ufee/amoapi-v4` README: https://github.com/ufee/amoapi-v4/blob/main/README.md
[30] `andrey-tech/amocrm-api-php` README: https://github.com/andrey-tech/amocrm-api-php/blob/master/README.md
[31] Habr implementation write-up referencing the official docs plus a GitHub API client: https://habr.com/ru/articles/814377/
