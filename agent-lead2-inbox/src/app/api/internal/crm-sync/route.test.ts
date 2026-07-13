import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/integrations/admin-client', () => ({
  IntegrationsAdminConfigurationError: class IntegrationsAdminConfigurationError extends Error {
    readonly code = 'supabase_not_configured';
    readonly status = 503;
    readonly missingFields: string[];

    constructor(missingFields: string[]) {
      super(`Supabase service configuration is missing: ${missingFields.join(', ')}`);
      this.name = 'IntegrationsAdminConfigurationError';
      this.missingFields = missingFields;
    }
  },
  integrationsAdminClient: vi.fn(() => ({ admin: true })),
}));

vi.mock('@/lib/amocrm/sync', () => ({
  syncPendingAmoCrmConversations: vi.fn(async () => ({
    scanned: 1,
    synced: 1,
    pending: 0,
    notConfigured: 0,
    blocked: 0,
  })),
}));

import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import { syncPendingAmoCrmConversations } from '@/lib/amocrm/sync';
import { GET, POST } from './route';

function request(input: {
  method?: string;
  cronHeader?: string;
  url?: string;
  body?: Record<string, unknown>;
}) {
  return new Request(input.url ?? 'https://inbox.example.com/api/internal/crm-sync', {
    method: input.method ?? 'GET',
    headers: {
      ...(input.cronHeader ? { 'x-cron-secret': input.cronHeader } : {}),
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
}

describe('/api/internal/crm-sync', () => {
  const originalSecret = process.env.AUTOMATION_CRON_SECRET;

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'valid-cron-header';
    vi.mocked(integrationsAdminClient).mockClear();
    vi.mocked(syncPendingAmoCrmConversations).mockClear();
    vi.mocked(syncPendingAmoCrmConversations).mockResolvedValue({
      scanned: 1,
      synced: 1,
      pending: 0,
      notConfigured: 0,
      blocked: 0,
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.AUTOMATION_CRON_SECRET;
    } else {
      process.env.AUTOMATION_CRON_SECRET = originalSecret;
    }
  });

  it('rejects requests when the cron secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;

    const response = await GET(request({ cronHeader: 'valid-cron-header' }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({ error: 'cron_not_configured' });
    expect(syncPendingAmoCrmConversations).not.toHaveBeenCalled();
  });

  it('rejects invalid cron secrets', async () => {
    const response = await GET(request({ cronHeader: 'invalid-cron-header' }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'Unauthorized' });
    expect(syncPendingAmoCrmConversations).not.toHaveBeenCalled();
  });

  it('runs a bounded amoCRM sync batch for authorized GET requests', async () => {
    const response = await GET(
      request({
        cronHeader: 'valid-cron-header',
        url: 'https://inbox.example.com/api/internal/crm-sync?limit=7&include_blocked=true&account_id=acct-1',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      scanned: 1,
      synced: 1,
      pending: 0,
      notConfigured: 0,
      blocked: 0,
    });
    expect(syncPendingAmoCrmConversations).toHaveBeenCalledWith(
      { admin: true },
      {
        limit: 7,
        accountId: 'acct-1',
        includeBlocked: true,
      },
    );
  });

  it('accepts POST JSON options for scheduled retries', async () => {
    await POST(
      request({
        method: 'POST',
        cronHeader: 'valid-cron-header',
        body: { limit: 3, include_blocked: false },
      }),
    );

    expect(syncPendingAmoCrmConversations).toHaveBeenCalledWith(
      { admin: true },
      {
        limit: 3,
        accountId: undefined,
        includeBlocked: false,
      },
    );
  });
});
