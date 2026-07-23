import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import { deleteExpiredInboxMedia } from '@/lib/storage/media-retention';

export const maxDuration = 30;

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const requested = Number((body as { limit?: unknown }).limit ?? 100);
  const limit = Number.isFinite(requested) ? requested : 100;
  const result = await deleteExpiredInboxMedia(integrationsAdminClient(), { limit });
  return NextResponse.json({ success: true, ...result });
}
