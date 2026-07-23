import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  IntegrationsAdminConfigurationError,
  integrationsAdminClient,
} from '@/lib/integrations/admin-client';
import { reconcileWahaOutbound } from '@/lib/whatsapp/reconcile-outbound';

export const maxDuration = 30;

export async function GET(request: Request) {
  return handleReconciliation(request);
}

export async function POST(request: Request) {
  return handleReconciliation(request);
}

async function handleReconciliation(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }

  const supplied = request.headers.get('x-cron-secret') ?? '';
  if (!secretEquals(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limit = await parseLimit(request);
    const result = await reconcileWahaOutbound(integrationsAdminClient(), {
      limit,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof IntegrationsAdminConfigurationError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          missing_fields: err.missingFields,
        },
        { status: err.status },
      );
    }
    console.error('[waha-outbound-reconcile] failed:', err);
    return NextResponse.json(
      { error: 'waha_outbound_reconcile_failed' },
      { status: 500 },
    );
  }
}

async function parseLimit(request: Request): Promise<number | undefined> {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method !== 'GET') {
    const parsed = await request.json().catch(() => null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  }
  return numberOption(body.limit) ?? numberOption(url.searchParams.get('limit'));
}

function secretEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function numberOption(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
