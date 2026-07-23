import type { SupabaseClient } from '@supabase/supabase-js';

import { writeMediaAudit } from '@/lib/waha/media-archive';

export async function deleteExpiredInboxMedia(
  db: SupabaseClient,
  input: { limit?: number; now?: Date } = {},
): Promise<{ deleted: number; failed: number }> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const now = input.now ?? new Date();
  const { data, error } = await db
    .from('messages')
    .select(
      'id, media_bucket, media_path, media_size_bytes, conversations!inner(account_id)',
    )
    .not('media_path', 'is', null)
    .is('media_deleted_at', null)
    .lte('media_retention_until', now.toISOString())
    .limit(limit);
  if (error) throw new Error('Failed to load expired Inbox media');

  let deleted = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const accountId = relationAccountId(row.conversations);
    if (!row.media_bucket || !row.media_path || !accountId) {
      failed += 1;
      continue;
    }
    const { error: removeError } = await db.storage
      .from(row.media_bucket)
      .remove([row.media_path]);
    if (removeError) {
      failed += 1;
      continue;
    }
    const { error: updateError } = await db
      .from('messages')
      .update({
        media_url: null,
        media_deleted_at: now.toISOString(),
      })
      .eq('id', row.id)
      .is('media_deleted_at', null);
    if (updateError) {
      failed += 1;
      continue;
    }
    await writeMediaAudit(db, {
      accountId,
      messageId: row.id,
      eventType: 'retention_deletion',
      objectPath: row.media_path,
      sizeBytes: row.media_size_bytes,
    });
    deleted += 1;
  }
  return { deleted, failed };
}

function relationAccountId(value: unknown): string | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== 'object') return null;
  const id = (record as { account_id?: unknown }).account_id;
  return typeof id === 'string' ? id : null;
}
