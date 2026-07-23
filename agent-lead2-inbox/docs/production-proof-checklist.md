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
- amoCRM seed file: ignored `.env.amocrm`, created from
  `deploy/env.amocrm.example`
- Gemini key for this rollout: `EVO_INBOX_GEMINI_API_KEY` in the ignored
  `.env.gemini` seed file
- AI knowledge retrieval provider: `EVO_INBOX_EMBEDDINGS_PROVIDER=gemini` for
  first proof, reusing the Gemini key for embeddings; use `keyword` only when
  deliberately proving lexical fallback
- Test WhatsApp number: `EVO_INBOX_TEST_WHATSAPP_NUMBER`
- DNS/Caddy requirements: `inbox.evoadmissions.com` must resolve to
  `hermes-vps`, and `evo-edge-caddy` plus `evo-inbox-app` must share
  `EVO_CADDY_NETWORK`
- Until that DNS record exists, `https://evo-inbox.72.62.119.112.sslip.io`
  may be used for server/proxy smoke checks, but it does not satisfy the final
  `inbox.evoadmissions.com` production proof.
- `acadis-caddy-1` must not own host ports `80/443` during EVO Inbox proof.
  Preserve `/opt/acadis` if archived, but serve EVO routes from
  `evo-edge-caddy`.
- Private WAHA requirement: the separate `evo-inbox-waha` service must be
  reachable only on Docker networking at `http://evo-inbox-waha:3000`

## Required proof sequence

1. Deploy the reviewed EVO Inbox build for `inbox.evoadmissions.com`.
2. Connect the WAHA session named `evo-inbox`.
3. Seed WAHA runtime settings with `npm run seed:prod-waha`; verify a real
   `session.status` webhook from WAHA returns HTTP 200 from
   `/api/waha/webhook`.
4. Seed amoCRM identity settings with `npm run seed:prod-amocrm`; verify the
   command succeeds with a real `GET /api/v4/account` provider call, stores
   only encrypted `access_token` secret material, and resets repairable CRM sync
   rows to `pending`.
5. Seed Gemini AI draft settings with `npm run seed:prod-ai`; verify the
   command succeeds with real Google GenerateContent and Gemini Embeddings
   provider calls, then stores only encrypted account-level AI config in
   Supabase with `embeddings_provider='gemini'`.
6. Receive a real WhatsApp message from the provided test number.
7. Verify the message appears in EVO Inbox and the Supabase message row exists
   even if amoCRM is not yet synced.
8. Verify `crm_sync_status` on the conversation and message is truthful:
   `synced`, `pending`, `not_configured`, or `blocked`.
9. Resolve or create the amoCRM contact and lead identity for that sender; if
   it stayed pending/not configured, run the internal CRM sync retry endpoint
   after configuration is fixed.
10. Verify Supabase shadow records store `amo_contact_id` and `amo_lead_id` when
    `crm_sync_status='synced'`.
11. Generate an EVO Companion AI draft using configured knowledge.
12. Manually send the WAHA reply from the operator inbox.
13. Verify no automatic AI auto-reply was sent.

## Pass criteria

- The public inbox host responds through Caddy.
- WAHA is the separate `evo-inbox-waha` service, reachable only on Docker
  networking and with no public port.
- WAHA account settings exist in Supabase with non-secret public config and
  encrypted `api_key` / `webhook_hmac_secret` rows.
- WAHA `session.status` webhooks for `evo-inbox` are accepted with HTTP 200.
- The WEBJS session has `config.webjs.tagsEventsOn=true`, and its signed webhook
  subscribes to `message`, `message.ack`, and `session.status`. Preserve the
  full existing session configuration when using WAHA's full-replacement
  `PUT /api/sessions/{session}` operation.
- Gemini AI config exists in Supabase as `provider='gemini'`,
  `model='gemini-3.5-flash'`, `embeddings_provider='gemini'`, and encrypted
  `api_key`.
- amoCRM settings exist in Supabase with non-secret public config and encrypted
  `access_token`.
- Supabase scale audit from `docs/supabase-scale-retention.md` shows the
  database is still within the current plan threshold, or the project is on Pro.
- The inbound WhatsApp message appears in EVO Inbox.
- The WAHA webhook returns HTTP 200 after local Supabase save, even when amoCRM
  sync is pending, not configured, or blocked.
- The amoCRM contact/lead exists and matches the Supabase shadow ids.
- No conversation or message is left in `pending`, `not_configured`, or
  `blocked` for the final proof conversation.
- AI draft generation uses at least one configured knowledge document.
- The operator can edit before sending, and the reply is delivered manually.
- No unattended auto-reply appears in WAHA, Supabase messages, or amoCRM notes.

## Known blockers until proof time

- Real Supabase project keys are required.
- Real WAHA credentials and a connected `evo-inbox` session are required.
- Real amoCRM token/domain are required.
- Real Gemini key is required for this rollout.
- Real test WhatsApp number and DNS/Caddy access are required.
