# EVO Inbox privacy and retention boundary

Block C applies these rules without weakening the immutable delivery evidence
introduced by PRs #47 and #48.

| Data | Retention / deletion rule | Audit boundary |
| --- | --- | --- |
| Inbox customer media and documents | Private `chat-media` Storage objects, account path `account-<account_id>/...`, 90 days from ingestion. Access stops at expiry even before physical cleanup. Storage API deletion must record `retention_deletion`; an explicit authorized deletion must record `deletion`. | `media_audit_events` records event, account, message, actor when present, byte count, and SHA-256 of the object key. It never stores filenames, captions, message text, or object bytes. |
| WAHA temporary receive files | WAHA is a private transport cache, not durable customer storage. Production must keep a bounded `WHATSAPP_FILES_LIFETIME`; the application copies accepted inbound bytes into private Supabase Storage. | WAHA transport logs must not include media bytes or message content. |
| AI drafts | Append-only `ai_draft_audit` delivery evidence is retained indefinitely until an owner-approved legal retention schedule exists. Do not rewrite or delete it in Block C. | Existing provider/model/status metadata only. |
| Outbound attempts and messages | `outbound_attempts` and the linked message delivery fields remain append-only/durable. They are not removed when media expires. | Preserve request id, provider status/id, timestamps, and non-content error classification from PR #47/#48. |
| WAHA ACK evidence | `message_ack_events` remains append-only and duplicate-safe indefinitely. | Provider acknowledgement state and timestamps only. |
| Conversation text and transcripts | No new deletion job is authorized in Block C. Retain until the business owner approves a legal schedule; customer-request deletion must be a separately reviewed workflow that preserves required delivery evidence. | Avoid customer content in operational audit logs. |
| Application and edge logs | Operational target: 30 days, with secrets, signed URLs, customer message bodies, filenames, and media bytes excluded. Provider/VPS configuration must enforce the target separately. | Correlation ids and non-sensitive status/error codes only. |

## Access contract

- The bucket is never public.
- Browser code never receives the Supabase service-role credential.
- A signed URL is created only after the cookie-authenticated user resolves to
  the same account as the message. The URL expires after 60 seconds.
- A signed URL is a bearer grant until expiry. Keep its lifetime short and do
  not log it.
- Storage metadata is read-only SQL metadata. Uploads and deletions go through
  the Supabase Storage API so object bytes and metadata cannot diverge.

## Provider truth

Current WAHA documentation exposes authenticated inbound media through
`payload.media.url` under `/api/files/...`; it may report `hasMedia: true` with
no downloaded media when media downloading is disabled or filtered. The
application therefore archives only a populated, configured-WAHA-origin URL
and rejects redirects or cross-origin URLs.

WAHA also documents separate outbound image/file/video/voice endpoints.
However, the deployed EVO Inbox application transport currently implements and
audits only `POST /api/sendText`. Block C disables the composer attachment
control instead of presenting those unimplemented media sends as available.

Official references:

- Supabase private downloads and signed URLs:
  https://supabase.com/docs/guides/storage/serving/downloads
- Supabase Storage RLS:
  https://supabase.com/docs/guides/storage/security/access-control
- Supabase Storage schema/API deletion boundary:
  https://supabase.com/docs/guides/storage/schema/design
- WAHA receive media:
  https://waha.devlike.pro/docs/how-to/receive-messages/
- WAHA send endpoints:
  https://waha.devlike.pro/docs/how-to/send-messages/
