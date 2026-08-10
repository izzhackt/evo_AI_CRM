# P5D private WAHA media

## Outcome

P5D adds a disabled-by-default, server-only archive lane for media that belongs
to an already projected P5B signed-webhook message or P5C history message. It
stores bytes in a new private Supabase Storage bucket and renders safe media
metadata and authorized access inside the accepted root `/whatsapp` UI.

This block does not send or mark a WhatsApp message, change the `evo-inbox`
session, call Gemini, interpret media, mutate amoCRM, use legacy SQLite, expose
a WAHA URL/API key, or enable production behavior.

## Provider and download boundary

The server re-fetches the exact bound message using WAHA's documented
`downloadMedia=true` message lookup. It requires the exact configured private
WAHA origin/session/direct-chat/message identity, sends the API key only over
that private server connection, rejects redirects and applies bounded
timeouts/bytes.

The returned media URL must resolve to the same configured private WAHA origin
and documented file path. A missing URL, provider error, identity mismatch,
oversize response or unsafe content is recorded as an explicit failure or
handoff; it is never presented as archived media.

References:

- [WAHA receive messages and media](https://waha.devlike.pro/docs/how-to/receive-messages/)
- [Supabase private bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase signed downloads](https://supabase.com/docs/guides/storage/serving/downloads)

## Storage and identity boundary

The fixed `platform-whatsapp-media` bucket is private and provisioned by the
Supabase configuration/Storage API. SQL records application bindings but never
writes Storage catalog rows. Object names are opaque and carry no chat,
message, phone, contact or student identifier.

The exposed Platform media row contains only the message relation, ordinal,
safe display kind, bounded filename/MIME/size, archive state and timestamps.
Raw WAHA identifiers, source URLs, evidence references and hashes remain in
`platform_private` and are service-only. The opaque Storage object name carries
no phone, chat, provider, contact or student identifier. It is absent from RPC
rows and page content and may appear only inside the audited short-lived signed
download URL.

Browser access is live-authority and record-scope checked. An authorized actor
creates an audited short-lived grant; a trusted server consumes it once and
creates a Storage signed URL valid for at most 60 seconds. Browser roles cannot
list, directly select, sign, update or delete objects.

## UI and behavior

The accepted Claude Design conversation view remains the sole UI. It may show:

- archived safe images as bounded previews;
- archived audio/video through native accessible controls;
- other archived files as explicit download links;
- pending, unavailable, failed or expired states as honest operator-visible
  status, never as a broken or invented attachment.

Media-only messages remain in human-review state. P5D does not authorize model
vision/audio/document processing or an autonomous response.

## Evidence and rollback

Local acceptance must prove configuration/HMAC denial, SSRF and redirect
denial, exact message identity, byte/MIME bounds, replay behavior, tenant and
record-scope denial, raw-ID non-exposure, opaque non-identifying object names,
private Storage upload,
audited one-time signing, accepted browser rendering and exact cleanup.

Synthetic local WAHA responses prove only the adapter and authorization
contract. Real provider completeness and production behavior remain blocked.

Rollback keeps the P5D worker disabled, reverts server/UI code and
forward-fixes additive schema. It does not delete archived objects, perform a
destructive down migration or alter the retained Lead Agent/legacy path.
