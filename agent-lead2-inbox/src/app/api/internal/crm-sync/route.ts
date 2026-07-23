import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  IntegrationsAdminConfigurationError,
  integrationsAdminClient,
} from '@/lib/integrations/admin-client';
import { syncPendingAmoCrmConversations } from '@/lib/amocrm/sync';

export const maxDuration = 30;

export async function GET(request: Request) {
  return handleCrmSync(request);
}

export async function POST(request: Request) {
  return handleCrmSync(request);
}

async function handleCrmSync(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }

  const supplied = request.headers.get('x-cron-secret') ?? '';
  if (!secretEquals(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const options = await parseOptions(request);
    const result = await syncPendingAmoCrmConversations(
      integrationsAdminClient(),
      options,
    );
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
    console.error('[crm-sync] failed:', err);
    return NextResponse.json({ error: 'crm_sync_failed' }, { status: 500 });
  }
}

async function parseOptions(request: Request) {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method !== 'GET') {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const limit = numberOption(body.limit) ?? numberOption(url.searchParams.get('limit'));
  const accountId =
    stringOption(body.account_id) ??
    stringOption(body.accountId) ??
    stringOption(url.searchParams.get('account_id')) ??
    stringOption(url.searchParams.get('accountId')) ??
    undefined;
  const includeBlocked =
    booleanOption(body.include_blocked) ??
    booleanOption(body.includeBlocked) ??
    booleanOption(url.searchParams.get('include_blocked')) ??
    booleanOption(url.searchParams.get('includeBlocked')) ??
    false;

  return {
    limit,
    accountId,
    includeBlocked,
  };
}

function secretEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function stringOption(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOption(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanOption(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (['1', 'true', 'yes'].includes(value.trim().toLowerCase())) return true;
  if (['0', 'false', 'no'].includes(value.trim().toLowerCase())) return false;
  return undefined;
}
