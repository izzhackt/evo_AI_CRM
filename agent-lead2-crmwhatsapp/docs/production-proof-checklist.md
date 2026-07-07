# Issue #20 production proof checklist

This document prepares issue #20 only. It does not mark #20 done, and no live
deployment or production proof was performed in this run.

## Credentials required from the owner

- Supabase URL: `NEXT_PUBLIC_SUPABASE_URL`
- Supabase anon key: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Supabase service role key: `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`: 64 hex characters
- WAHA base URL: `EVO_INBOX_WAHA_BASE_URL`
- WAHA API key: `EVO_INBOX_WAHA_API_KEY`
- WAHA webhook HMAC secret: `EVO_INBOX_WAHA_WEBHOOK_HMAC`
- amoCRM domain: `EVO_INBOX_AMOCRM_BASE_URL`
- amoCRM token: `EVO_INBOX_AMOCRM_ACCESS_TOKEN`
- OpenAI or Anthropic key: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- Test WhatsApp number: `EVO_INBOX_TEST_WHATSAPP_NUMBER`
- DNS/Caddy requirements: `inbox.evoadmissions.com` must resolve to
  `hermes-vps`, Caddy must include the inbox vhost, and Caddy plus
  `evo-inbox-app` must share `EVO_CADDY_NETWORK`

## Required proof sequence

1. Deploy the reviewed EVO Inbox build for `inbox.evoadmissions.com`.
2. Connect the WAHA session named `evo-inbox`.
3. Receive a real WhatsApp message from the provided test number.
4. Resolve or create the amoCRM contact and lead identity for that sender.
5. Verify Supabase shadow records store `amo_contact_id` and `amo_lead_id`.
6. Generate an EVO Companion AI draft using configured knowledge.
7. Manually send the WAHA reply from the operator inbox.
8. Verify no automatic AI auto-reply was sent.

## Pass criteria

- The public inbox host responds through Caddy.
- WAHA is reachable only on Docker networking and has no public port.
- The inbound WhatsApp message appears in EVO Inbox.
- The amoCRM contact/lead exists and matches the Supabase shadow ids.
- AI draft generation uses at least one configured knowledge document.
- The operator can edit before sending, and the reply is delivered manually.
- No unattended auto-reply appears in WAHA, Supabase messages, or amoCRM notes.

## Known blockers until proof time

- Real Supabase project keys are required.
- Real WAHA credentials and a connected `evo-inbox` session are required.
- Real amoCRM token/domain are required.
- Real OpenAI or Anthropic key is required.
- Real test WhatsApp number and DNS/Caddy access are required.
