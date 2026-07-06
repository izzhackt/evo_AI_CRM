import { NextResponse } from 'next/server';

import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import { findWahaWebhookCandidates } from '@/lib/waha/config';
import {
  extractWahaSessionStatusEvent,
  extractWahaWebhookSessionName,
  updateWahaSessionStatus,
  verifyWahaWebhookSignature,
} from '@/lib/waha/webhook';

export const maxDuration = 30;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-hmac');
  const algorithm = request.headers.get('x-webhook-hmac-algorithm');

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sessionName = extractWahaWebhookSessionName(body);
  if (!sessionName) {
    return NextResponse.json({ error: 'Missing session' }, { status: 400 });
  }

  const db = integrationsAdminClient();
  const candidates = await findWahaWebhookCandidates(db, sessionName);
  const matched = candidates.find((candidate) =>
    verifyWahaWebhookSignature({
      rawBody,
      secret: candidate.webhookHmacSecret,
      signature,
      algorithm,
    }),
  );

  if (!matched) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = extractWahaSessionStatusEvent(body);
  if (!event) {
    return NextResponse.json({ status: 'ignored' }, { status: 202 });
  }

  await updateWahaSessionStatus(db, matched.settingId, event);
  return NextResponse.json({ status: 'received' }, { status: 200 });
}
