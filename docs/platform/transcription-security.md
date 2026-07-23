# Main CRM Transcription Security Runbook

The Transcription Lab is an admin-only main CRM surface. Authorization is
checked again inside every upload, status, event-stream, improvement, and
deletion Route Handler. Hiding the navigation link is not an authorization
control.

## Production configuration

- Set a high-entropy `AUTH_SECRET` for sessions.
- Set a separate high-entropy `EVO_SECRET_ENCRYPTION_KEY`. Production refuses
  to store new runtime provider secrets without it and refuses to return legacy
  plaintext secret rows. Rotate or re-save any legacy plaintext secret before
  enabling the affected provider.
- Keep `EVO_ENABLE_LOCAL_TRANSCRIPTION=0` unless the production host has an
  approved, verified local MLX worker. The admin UI can load while processing
  remains unavailable.
- Keep `EVO_ENABLE_EXTERNAL_TRANSCRIPT_IMPROVEMENT=0` unless EVO has separately
  approved sending transcript content to the configured external provider.
  A provider API key does not grant that data-transfer approval.

Do not print these values in logs or commit them. Production values belong in
the existing ignored runtime secret file or deployment secret mechanism.

## Runtime controls

- One MP3 file is accepted per request, up to 100 MiB, with a 101 MiB request
  ceiling. The server requires an MP3 extension, MP3 MIME type, and an MP3
  signature; client-side checks are supplementary.
- Stored audio receives a server-generated name in a private `0700` job
  directory. The original filename and absolute server paths are never returned
  by the API.
- At most two jobs are admitted concurrently by the current single-process CRM
  architecture. Jobs unchanged for two hours are marked interrupted; terminal
  jobs delete retained source audio. Job directories are deleted after seven
  days, and admins can delete a job immediately with `DELETE` on its detail
  endpoint.
- SSE output is reduced to event, status, and numeric progress fields. Worker
  logs, provider bodies, transcript content, paths, and internal errors are not
  streamed to clients.

## Verification boundary

Local authorization, limits, build, and browser/API checks do not prove MLX or
an external AI provider is ready. Claim provider success only after a real
approved file is processed with real credentials/services and the data-transfer
approval above. This runbook does not authorize production deployment or
customer-data processing.
