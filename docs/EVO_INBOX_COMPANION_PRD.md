# EVO Inbox Companion App PRD

## Problem Statement

EVO needs a WhatsApp-first admissions inbox that can be owned inside `izzhackt/evo_AI_CRM`, hosted on `hermes-vps`, and adapted from WACRM without keeping Meta Cloud API as the transport. The current CRM remains the production EVO Admissions CRM, but the new companion app should let staff evaluate a redesigned EVO Inbox experience with WAHA, managed Supabase, amoCRM identity resolution, and WACRM's own AI draft assistant.

The first release must not create a second CRM source of truth, hide behind mock integrations, or preserve WACRM modules that make the product look like a generic bulk WhatsApp automation tool.

## Solution

Create `agent-lead2-inbox/` inside this repository as an EVO-owned companion application derived from WACRM under its MIT license. Redesign the retained surfaces into `EVO Inbox`, remove Meta Cloud API integration completely, wire WAHA session `evo-inbox`, use managed Supabase Cloud for app data/auth/files/AI knowledge, and resolve or create amoCRM contact and lead identity from WhatsApp senders.

Host the app at `inbox.evoadmissions.com` on `hermes-vps` as a separate service behind Caddy. GitHub remains the source of truth for code, plan, issues, PRs, and deployment config. amoCRM remains the source of truth for CRM identity and sales state. Supabase stores only companion app data and shadow identity fields.

## User Stories

1. As an EVO operator, I want a dedicated `EVO Inbox` surface, so that WhatsApp admissions conversations do not feel like a generic CRM template.
2. As an EVO operator, I want inbound WAHA messages to appear in the inbox, so that I can work real WhatsApp conversations from one staff surface.
3. As an EVO operator, I want the app to resolve or create the amoCRM contact and lead for each sender, so that WhatsApp conversations stay tied to the canonical CRM identity.
4. As an EVO operator, I want local shadow records to store `amo_contact_id` and `amo_lead_id`, so that the inbox can load quickly while amoCRM remains authoritative.
5. As an EVO operator, I want to generate an AI draft reply from the conversation, so that I can answer faster while still approving the final message myself.
6. As an EVO operator, I want auto-reply disabled by default, so that no newly converted WAHA transport sends unattended customer messages.
7. As an EVO operator, I want to send one approved manual WhatsApp reply through WAHA, so that the first production proof covers the complete operator loop.
8. As an EVO operator, I want to upload EVO knowledge-base content, so that AI drafts are grounded in admissions services, process, and policy.
9. As an EVO operator, I want visible integration states for WAHA, amoCRM, Supabase, and AI, so that missing credentials are explicit blockers.
10. As an EVO administrator, I want managed Supabase Auth for the companion app, so that staff access is separated from the existing CRM session model.
11. As an EVO administrator, I want the app on `inbox.evoadmissions.com`, so that it has a clean deployment and auth boundary from `crm.evoadmissions.com`.
12. As an EVO administrator, I want only one first-launch WAHA session named `evo-inbox`, so that QR setup, webhook routing, and proof scope stay narrow.
13. As an EVO administrator, I want broadcasts and broad automations disabled for first launch, so that the app does not become bulk WhatsApp automation before the manual workflow is proven.
14. As an EVO administrator, I want WACRM's MIT notice preserved, so that the copied base remains license-compliant after rebranding.
15. As a developer, I want GitHub issues and PRs to track every implementation block, so that GitHub is the source of truth for code execution.
16. As a developer, I want real validation commands and real services named per block, so that no fake success claims can enter the launch path.
17. As a developer, I want Caddy and Docker deployment config committed, so that `hermes-vps` can run the app reproducibly.
18. As a developer, I want Supabase migrations kept with the companion app, so that app schema changes are reviewable with code.
19. As a developer, I want WAHA webhook authentication with HMAC, so that public inbound mutation endpoints are not unauthenticated.
20. As a developer, I want amoCRM failures to block identity-dependent writes clearly, so that the app does not create local-only leads presented as real CRM records.

## Implementation Decisions

- The companion app is standalone and does not replace the existing EVO Operator UI.
- The companion app lives under `agent-lead2-inbox/` in `izzhackt/evo_AI_CRM`.
- The WACRM base can be copied and modified because it is MIT licensed; the MIT license notice must remain in the companion app.
- The companion app receives a full EVO Inbox redesign, not a light WACRM rename.
- Retained first-launch surfaces are inbox, contacts/lead profile, optional pipeline context, AI draft, knowledge base, WAHA settings/status, amoCRM settings/status, and production readiness/status.
- Broadcasts, broad automations, flow-driven sending, and auto-reply are disabled or removed for first launch.
- Meta Cloud API is removed as a transport. No Meta app secret, phone number ID, template sync, Meta registration, or Meta webhook verification remains in the active product.
- WAHA is the only WhatsApp transport for first launch. The initial session name is `evo-inbox`.
- The companion app handles its own inbound WAHA webhooks and AI assistant. It does not delegate to the existing EVO lead-agent.
- The companion app uses managed Supabase Cloud for Auth, Postgres, Storage, shadow records, messages, AI settings, and knowledge-base data.
- amoCRM remains the identity source of truth. The companion app may create or resolve amoCRM contacts and leads, then store only shadow identifiers and operator state locally.
- The first amoCRM scope is phone-based resolution, missing contact/lead creation, and storing `amo_contact_id` / `amo_lead_id`. Full pipeline mirroring is out of scope.
- AI starts in draft-only mode. Operators approve and manually send replies. Auto-reply remains disabled by default.
- The production proof includes inbound WAHA receipt, amoCRM identity resolution or creation, Supabase shadow persistence, AI draft generation, and one manual outbound WAHA reply.
- The app is hosted on `hermes-vps` at `inbox.evoadmissions.com` as a separate Docker service behind Caddy.
- GitHub is the source of truth for code, issues, PRs, deployment config, and implementation evidence.

## Testing Decisions

- Test behavior at external seams: WAHA API adapter, WAHA webhook route, amoCRM identity resolution, Supabase persistence, AI draft route, and operator inbox workflows.
- Prefer existing WACRM tests where they cover retained behavior, but rewrite or delete tests that preserve Meta Cloud API or disabled modules.
- Add adapter-level tests proving WAHA send payloads, session status parsing, webhook HMAC rejection, duplicate message idempotency, and manual outbound persistence.
- Add amoCRM contract tests around phone lookup, create contact, create lead, token/config blockers, and no local-only lead presentation after amoCRM failure.
- Add AI draft tests proving provider configuration errors are explicit, knowledge retrieval is used when configured, and auto-reply is off by default.
- Add UI/runtime checks for the redesigned first-launch surfaces after the app can run locally.
- Use real builds, lint/type checks, Supabase migrations, and production preflight commands. Live WAHA, amoCRM, AI provider, Supabase, DNS, and Caddy success can only be claimed after real credentials and real provider responses are exercised.

## Out of Scope

- Replacing the current EVO Admissions CRM.
- Migrating the existing EVO SQLite CRM to Supabase in this project phase.
- Using the existing EVO lead-agent for companion app inbound handling or AI replies.
- Enabling AI auto-reply for first launch.
- Enabling broadcasts, broad automations, or flow-driven sending for first launch.
- Supporting multiple WAHA sessions or multiple WhatsApp numbers for first launch.
- Mirroring the full amoCRM pipeline into Supabase.
- Claiming live deployment, WAHA, amoCRM, Supabase, AI, DNS, or Caddy success without real credentials and real execution.

## Further Notes

Primary implementation should proceed in mergeable launch-control blocks. Each block needs a named write set, real validation, and independent review before merge. If a block changes the scope, architecture, acceptance criteria, deployment shape, or data model, update `docs/PLAN_CHANGES.md` before coding.
