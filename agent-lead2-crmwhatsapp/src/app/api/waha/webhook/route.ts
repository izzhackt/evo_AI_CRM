import { NextResponse } from 'next/server';

import {
  IntegrationsAdminConfigurationError,
  integrationsAdminClient,
} from '@/lib/integrations/admin-client';
import { findWahaWebhookCandidates } from '@/lib/waha/config';
import {
  WahaInboundDeliveryError,
  deliverWahaInboundMessage,
} from '@/lib/waha/inbound-delivery';
import {
  WahaInboundMessageParseError,
  parseWahaInboundMessageEvent,
} from '@/lib/waha/inbound-message';
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

  let db;
  try {
    db = integrationsAdminClient();
  } catch (err) {
    if (err instanceof IntegrationsAdminConfigurationError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          integration_status: 'not_configured',
          missing_fields: err.missingFields,
        },
        { status: err.status },
      );
    }
    throw err;
  }
  const candidates = await findWahaWebhookCandidates(db, sessionName);
  if (candidates.length === 0) {
    return NextResponse.json(
      {
        error: 'waha_not_configured',
        integration_status: 'not_configured',
      },
      { status: 503 },
    );
  }

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
  if (event) {
    await updateWahaSessionStatus(db, matched.settingId, event);
    return NextResponse.json({ status: 'received' }, { status: 200 });
  }

  if (isWahaMessageEvent(body)) {
    try {
      const parsed = parseWahaInboundMessageEvent(body);
      if (parsed.kind === 'ignored') {
        return NextResponse.json(
          { status: 'ignored', reason: parsed.reason },
          { status: 202 },
        );
      }

      const result = await deliverWahaInboundMessage({
        db,
        accountId: matched.accountId,
        message: parsed.message,
      });
      return NextResponse.json(
        {
          status: result.status,
          conversation_id: result.conversationId,
          message_id: result.messageId,
        },
        { status: 200 },
      );
    } catch (err) {
      if (err instanceof WahaInboundMessageParseError) {
        return NextResponse.json(
          {
            error: err.code,
            missing_fields: err.missingFields,
          },
          { status: err.status },
        );
      }
      if (err instanceof WahaInboundDeliveryError) {
        return NextResponse.json(
          {
            error: err.code,
            message: err.message,
            integration_status: err.integrationStatus,
            missing_fields: err.missingFields,
          },
          { status: err.status },
        );
      }
      throw err;
    }
  }

  return NextResponse.json({ status: 'ignored' }, { status: 202 });
}

function isWahaMessageEvent(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    (body as Record<string, unknown>).event === 'message'
  );
}
