import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { WahaConfig } from './client';
import type { WahaInboundMedia } from './inbound-message';

const MEDIA_BUCKET = 'chat-media';
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const RETENTION_DAYS = 90;

export class WahaMediaArchiveError extends Error {
  readonly code = 'waha_media_archive_failed';
  readonly status = 502;
}

export async function archiveWahaInboundMedia(input: {
  db: SupabaseClient;
  accountId: string;
  messageId: string;
  media: WahaInboundMedia;
  waha: WahaConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!input.waha.apiKey) {
    throw new WahaMediaArchiveError('WAHA API key is unavailable');
  }
  const source = requirePrivateWahaMediaUrl(input.media.url, input.waha.baseUrl);
  const response = await fetchImpl(source, {
    headers: { 'X-Api-Key': input.waha.apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new WahaMediaArchiveError(`WAHA media download failed with ${response.status}`);
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_MEDIA_BYTES) {
    throw new WahaMediaArchiveError('WAHA media exceeds the 16 MB Inbox limit');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new WahaMediaArchiveError('WAHA media exceeds the 16 MB Inbox limit');
  }

  const now = input.now ?? new Date();
  const fileName = safeFileName(input.media.filename, source.pathname);
  const objectPath = `account-${input.accountId}/${input.messageId}/${fileName}`;
  const { error: uploadError } = await input.db.storage
    .from(MEDIA_BUCKET)
    .upload(objectPath, bytes, {
      contentType: input.media.mimetype,
      cacheControl: 'private, max-age=0',
      upsert: true,
    });
  if (uploadError) {
    throw new WahaMediaArchiveError('Private Inbox media upload failed');
  }

  const retentionUntil = new Date(now);
  retentionUntil.setUTCDate(retentionUntil.getUTCDate() + RETENTION_DAYS);
  const { error: updateError } = await input.db
    .from('messages')
    .update({
      media_url: `/api/inbox/media/${input.messageId}`,
      media_bucket: MEDIA_BUCKET,
      media_path: objectPath,
      media_mime_type: input.media.mimetype,
      media_file_name: fileName,
      media_size_bytes: bytes.byteLength,
      media_retention_until: retentionUntil.toISOString(),
      media_deleted_at: null,
    })
    .eq('id', input.messageId);
  if (updateError) {
    await input.db.storage.from(MEDIA_BUCKET).remove([objectPath]);
    throw new WahaMediaArchiveError('Inbox media metadata update failed');
  }

  await writeMediaAudit(input.db, {
    accountId: input.accountId,
    messageId: input.messageId,
    eventType: 'upload',
    objectPath,
    sizeBytes: bytes.byteLength,
  });
}

export async function writeMediaAudit(
  db: SupabaseClient,
  input: {
    accountId: string;
    messageId: string;
    eventType: 'upload' | 'access_grant' | 'deletion' | 'retention_deletion';
    objectPath: string;
    actorUserId?: string | null;
    sizeBytes?: number | null;
  },
): Promise<void> {
  const { error } = await db.from('media_audit_events').insert({
    account_id: input.accountId,
    message_id: input.messageId,
    event_type: input.eventType,
    actor_user_id: input.actorUserId ?? null,
    object_key_sha256: createHash('sha256').update(input.objectPath).digest('hex'),
    size_bytes: input.sizeBytes ?? null,
  });
  if (error) throw new Error('Failed to write media audit event');
}

export function requirePrivateWahaMediaUrl(mediaUrl: string, baseUrl: string): URL {
  const media = new URL(mediaUrl);
  const waha = new URL(baseUrl);
  if (media.origin !== waha.origin || !media.pathname.startsWith('/api/files/')) {
    throw new WahaMediaArchiveError('WAHA media URL is outside the configured private service');
  }
  return media;
}

function safeFileName(value: string | null, pathname: string): string {
  const source = value || pathname.split('/').pop() || 'attachment';
  const cleaned = source
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-120);
  return cleaned || 'attachment';
}
