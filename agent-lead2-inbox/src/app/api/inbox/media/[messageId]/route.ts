import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  UnauthorizedError,
  getCurrentAccount,
} from '@/lib/auth/account';
import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import { writeMediaAudit } from '@/lib/waha/media-archive';

const SIGNED_URL_SECONDS = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  try {
    const account = await getCurrentAccount();
    const { messageId } = await context.params;
    const { data: message, error } = await account.supabase
      .from('messages')
      .select(
        'id, media_bucket, media_path, media_size_bytes, media_retention_until, media_deleted_at, conversations!inner(account_id)',
      )
      .eq('id', messageId)
      .eq('conversations.account_id', account.accountId)
      .maybeSingle();

    if (error || !message?.media_bucket || !message.media_path) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }
    if (
      message.media_deleted_at ||
      (message.media_retention_until &&
        new Date(message.media_retention_until).getTime() <= Date.now())
    ) {
      return NextResponse.json({ error: 'Media retention expired' }, { status: 410 });
    }

    const admin = integrationsAdminClient();
    const { data, error: signError } = await admin.storage
      .from(message.media_bucket)
      .createSignedUrl(message.media_path, SIGNED_URL_SECONDS);
    if (signError || !data?.signedUrl) {
      return NextResponse.json({ error: 'Media access unavailable' }, { status: 503 });
    }

    await writeMediaAudit(admin, {
      accountId: account.accountId,
      messageId,
      eventType: 'access_grant',
      actorUserId: account.userId,
      objectPath: message.media_path,
      sizeBytes: message.media_size_bytes,
    });
    return NextResponse.redirect(data.signedUrl, 307);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Media access unavailable' }, { status: 503 });
  }
}
