# EVO Inbox Companion Implementation Issues

Status: proposed issue split. Publish to GitHub after user approval.

Parent PRD: `docs/EVO_INBOX_COMPANION_PRD.md`

## Proposed Breakdown

1. **Vendor WACRM Base And Establish EVO Inbox Workspace**
   - Blocked by: None
   - User stories covered: 14, 15, 16, 18

2. **Remove Meta/Bulk-Automation Product Surface For First Launch**
   - Blocked by: issue 1
   - User stories covered: 1, 13, 16

3. **Bootstrap Managed Supabase Companion Data Store**
   - Blocked by: issue 1
   - User stories covered: 10, 16, 18

4. **Add WAHA Session Configuration And Authenticated Webhook Boundary**
   - Blocked by: issues 1, 3
   - User stories covered: 2, 9, 12, 16, 19

5. **Resolve Or Create amoCRM Identity For WhatsApp Senders**
   - Blocked by: issue 3
   - User stories covered: 3, 4, 9, 16, 20

6. **Deliver Inbound WAHA Message To EVO Inbox With amoCRM Shadow Identity**
   - Blocked by: issues 4, 5
   - User stories covered: 2, 3, 4, 9, 16, 19, 20

7. **Send Manual Operator Reply Through WAHA**
   - Blocked by: issue 6
   - User stories covered: 7, 9, 12, 16

8. **Retain AI Draft And Knowledge Base With Auto-Reply Disabled**
   - Blocked by: issues 3, 6, 7
   - User stories covered: 5, 6, 8, 9, 16

9. **Fully Redesign Retained Surfaces As EVO Inbox**
   - Blocked by: issues 2, 6, 7, 8
   - User stories covered: 1, 2, 3, 5, 8, 9

10. **Add hermes-vps Deployment For inbox.evoadmissions.com**
    - Blocked by: issues 3, 4, 7, 8, 9
    - User stories covered: 11, 12, 16, 17

11. **Run Real Companion Production Proof**
    - Blocked by: issue 10
    - User stories covered: 2, 3, 5, 7, 9, 11, 12, 16, 20

## Ready-To-Publish Issue Bodies

### 1. Vendor WACRM Base And Establish EVO Inbox Workspace

## What to build

Create the `agent-lead2-crmwhatsapp/` companion app workspace from the WACRM MIT base inside `izzhackt/evo_AI_CRM`. The slice should make the copied app installable, buildable, and testable in isolation without touching the current EVO CRM runtime. Preserve the WACRM MIT license notice and establish the branch/workspace conventions for future EVO Inbox work.

## Acceptance criteria

- [ ] `agent-lead2-crmwhatsapp/` contains the WACRM-derived app source and a preserved MIT license notice.
- [ ] The copied app has a clearly EVO-owned package/app identity while still acknowledging the WACRM base.
- [ ] Local install, lint, typecheck, test, and build commands are documented and run from the companion folder.
- [ ] The existing parent EVO CRM app remains untouched except for docs or repo-level config required to ignore/build the companion workspace correctly.
- [ ] No live WhatsApp, Supabase, amoCRM, AI provider, or deployment success is claimed in this slice.

## Blocked by

None - can start immediately.

### 2. Remove Meta/Bulk-Automation Product Surface For First Launch

## What to build

Turn the WACRM-derived app into a first-launch EVO Inbox product shell by removing or disabling Meta Cloud API setup, Meta templates, broadcasts, broad automations, flow-driven sending, and auto-reply entry points from active UI and runtime paths. The result should not ask for Meta credentials or present bulk WhatsApp automation as part of first launch.

## Acceptance criteria

- [ ] Active navigation and settings no longer expose Meta Cloud API setup, Meta templates, broadcasts, broad automations, or flow-driven sending.
- [ ] Runtime paths for disabled first-launch modules either do not exist or fail closed with explicit disabled/not-in-scope responses.
- [ ] The app can run without Meta app secret, phone number ID, access token, template, or registration configuration.
- [ ] Tests prove disabled modules cannot send or schedule outbound WhatsApp messages.
- [ ] Documentation states that these features are intentionally disabled for first launch, not accidentally missing.

## Blocked by

Issue 1.

### 3. Bootstrap Managed Supabase Companion Data Store

## What to build

Prepare the companion app for managed Supabase Cloud as its app data store. Keep Supabase Auth, RLS, service-role server operations, storage, migrations, account settings, message records, AI settings, knowledge-base data, and shadow identity data inside the companion app boundary.

## Acceptance criteria

- [ ] Supabase environment requirements are documented without committing secrets.
- [ ] Companion migrations include or preserve the schema needed for accounts, operators, contacts/shadow identity, conversations, messages, integration settings, AI settings, knowledge documents, and knowledge chunks.
- [ ] RLS/service-role boundaries are documented and tested at the highest practical seam.
- [ ] Local Supabase or migration validation is documented and run if available; if unavailable, the exact blocker is recorded.
- [ ] Supabase stores only companion app data and shadow identity, not canonical amoCRM identity.

## Blocked by

Issue 1.

### 4. Add WAHA Session Configuration And Authenticated Webhook Boundary

## What to build

Replace WACRM's Meta transport assumptions with a WAHA configuration/status surface and authenticated webhook boundary for one first-launch session named `evo-inbox`. Staff should be able to see whether WAHA is configured and whether the session is usable, while inbound webhook mutation paths require HMAC/authentication.

## Acceptance criteria

- [ ] The active WhatsApp transport config uses WAHA base URL, session name `evo-inbox`, API key, and webhook HMAC secret.
- [ ] WAHA send/status adapter code uses real WAHA API shapes and does not call Meta endpoints.
- [ ] WAHA webhook route rejects unsigned or invalid-HMAC requests.
- [ ] WAHA session status events update companion integration state idempotently.
- [ ] Tests cover send payload construction, status parsing, webhook HMAC rejection, and missing-config errors.

## Blocked by

Issues 1 and 3.

### 5. Resolve Or Create amoCRM Identity For WhatsApp Senders

## What to build

Add the narrow amoCRM identity resolver required by EVO Inbox. For a WhatsApp sender phone number, the app should find or create the amoCRM contact and lead, then store only shadow identifiers locally. If amoCRM is not configured or the real amoCRM API fails, the app must not present a local-only lead as a real CRM record.

## Acceptance criteria

- [ ] amoCRM configuration is stored securely and missing inputs are reported explicitly.
- [ ] Phone-based lookup finds existing amoCRM contact/lead where possible.
- [ ] Missing contact or lead can be created through real amoCRM API contracts when credentials are present.
- [ ] Supabase shadow records store `amo_contact_id` and `amo_lead_id`.
- [ ] Identity-dependent inbox writes fail clearly when amoCRM resolution fails.
- [ ] Tests cover lookup, create, missing credentials, provider failure, and no local-only real-lead presentation.

## Blocked by

Issue 3.

### 6. Deliver Inbound WAHA Message To EVO Inbox With amoCRM Shadow Identity

## What to build

Connect the authenticated WAHA inbound message path to the EVO Inbox. A real inbound message payload should resolve or create amoCRM identity, persist an idempotent Supabase conversation/message/shadow record, and appear in the staff inbox with amoCRM identifiers available for the lead profile.

## Acceptance criteria

- [ ] Inbound WAHA message events are parsed into the companion conversation/message model.
- [ ] Duplicate WAHA message ids do not create duplicate message rows.
- [ ] amoCRM identity resolution happens before the conversation is presented as a real lead.
- [ ] Staff inbox shows the inbound conversation and message from Supabase data.
- [ ] Missing WAHA or amoCRM configuration creates explicit blocked/not-configured states.
- [ ] Tests cover successful inbound, duplicate inbound, invalid webhook auth, missing amoCRM config, and provider failure.

## Blocked by

Issues 4 and 5.

### 7. Send Manual Operator Reply Through WAHA

## What to build

Enable an operator-approved manual reply from EVO Inbox through WAHA. The send path should use the same session `evo-inbox`, persist the outbound message with the WAHA message id/status, update the conversation preview, and avoid any auto-reply behavior.

## Acceptance criteria

- [ ] Operator can send a text reply from an existing conversation through WAHA.
- [ ] Outbound message persists in Supabase with direction/status and WAHA id when WAHA returns one.
- [ ] Send failures are visible and do not create fake sent messages.
- [ ] Auto-reply remains disabled by default and is not triggered by manual-send implementation.
- [ ] Tests cover successful manual send, missing WAHA config, WAHA provider error, and persistence failure behavior.

## Blocked by

Issue 6.

### 8. Retain AI Draft And Knowledge Base With Auto-Reply Disabled

## What to build

Keep WACRM's own AI assistant as the Companion AI Assistant, but launch it in draft-only mode. Operators should be able to configure OpenAI or Anthropic, add knowledge-base content, generate a draft from a conversation, edit it, and manually send through WAHA. Automatic AI replies must remain off by default.

## Acceptance criteria

- [ ] AI provider settings remain bring-your-own-key and are stored encrypted.
- [ ] Knowledge-base ingest/retrieval works for retained first-launch surfaces.
- [ ] Operator can generate a draft reply from a WAHA conversation.
- [ ] Draft output is editable before manual send.
- [ ] Auto-reply is disabled by default and hidden or clearly unavailable for first launch.
- [ ] Tests prove draft generation, missing AI config errors, knowledge retrieval usage, and auto-reply disabled behavior.

## Blocked by

Issues 3, 6, and 7.

### 9. Fully Redesign Retained Surfaces As EVO Inbox

## What to build

Replace the retained WACRM surfaces with a full EVO Inbox product redesign focused on admissions operators. The redesigned app should feel like a production admissions inbox, not a generic WhatsApp CRM template. Disabled modules should remain absent or hidden rather than polished as inactive features.

## Acceptance criteria

- [ ] App identity, navigation, page titles, empty states, and settings copy use EVO Inbox language.
- [ ] Inbox layout supports conversation scanning, lead profile context, amoCRM identifiers/status, integration state, and AI draft workflow.
- [ ] Knowledge-base and AI settings are redesigned for EVO admissions use.
- [ ] WAHA and amoCRM settings/status pages show truthful configured/blocked states.
- [ ] Disabled modules are absent from active first-launch navigation.
- [ ] Browser/UI checks prove retained surfaces render on desktop and mobile without overlapping text or broken layouts.

## Blocked by

Issues 2, 6, 7, and 8.

### 10. Add hermes-vps Deployment For inbox.evoadmissions.com

## What to build

Add production deployment support for EVO Inbox as a separate `hermes-vps` service behind Caddy at `inbox.evoadmissions.com`. The service should be deployable without disrupting the current `crm.evoadmissions.com` app and without exposing WAHA publicly.

## Acceptance criteria

- [ ] Production Docker/build config exists for the companion app.
- [ ] Deployment docs name required Supabase, WAHA, amoCRM, AI, and app secrets without committing secret values.
- [ ] Caddy routing plan sends `inbox.evoadmissions.com` to the companion app service.
- [ ] WAHA remains private to the Docker network.
- [ ] Healthchecks or preflight commands make missing configuration explicit.
- [ ] No live deployment success is claimed unless the real VPS, DNS, Caddy, Supabase, WAHA, amoCRM, and AI provider paths were exercised.

## Blocked by

Issues 3, 4, 7, 8, and 9.

### 11. Run Real Companion Production Proof

## What to build

Execute the first real production proof for EVO Inbox. The proof must use real configured services and demonstrate inbound WAHA receipt, amoCRM identity resolution or creation, Supabase shadow persistence, AI draft generation, and one operator-approved manual WAHA reply from `inbox.evoadmissions.com`.

## Acceptance criteria

- [ ] `inbox.evoadmissions.com` resolves to the deployed companion app on `hermes-vps`.
- [ ] WAHA session `evo-inbox` is connected and private.
- [ ] A real inbound WhatsApp message appears in EVO Inbox.
- [ ] The inbound sender is tied to real amoCRM contact/lead identity or a clearly marked created test contact/lead.
- [ ] Supabase contains the expected shadow conversation/message/identity records.
- [ ] AI draft generation works with the configured provider and knowledge context, or the exact missing credential/provider blocker is recorded.
- [ ] Operator sends one manual WAHA reply; auto-reply remains disabled.
- [ ] Evidence is recorded without leaking secrets or customer personal data.

## Blocked by

Issue 10.

