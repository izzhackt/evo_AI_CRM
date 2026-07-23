import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  adminClient: vi.fn(() => ({ service: true })),
  reconcile: vi.fn(),
}));

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
  integrationsAdminClient: h.adminClient,
}));

vi.mock('@/lib/whatsapp/reconcile-outbound', () => ({
  reconcileWahaOutbound: h.reconcile,
}));

import { GET, POST } from './route';

function request(input: {
  method?: 'GET' | 'POST';
  cronSecret?: string;
  url?: string;
  body?: Record<string, unknown>;
}) {
  return new Request(
    input.url ??
      'https://inbox.example.com/api/internal/waha-outbound-reconcile',
    {
      method: input.method ?? 'GET',
      headers: {
        ...(input.cronSecret
          ? { 'x-cron-secret': input.cronSecret }
          : {}),
        ...(input.body ? { 'content-type': 'application/json' } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
}

describe('/api/internal/waha-outbound-reconcile', () => {
  const originalSecret = process.env.AUTOMATION_CRON_SECRET;

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'valid-cron-header';
    h.adminClient.mockClear();
    h.reconcile.mockReset();
    h.reconcile.mockResolvedValue({
      scanned: 2,
      reconciled: 1,
      unresolved: 1,
      failed: 0,
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.AUTOMATION_CRON_SECRET;
    } else {
      process.env.AUTOMATION_CRON_SECRET = originalSecret;
    }
  });

  it('fails closed when cron authentication is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;

    const response = await GET(request({ cronSecret: 'anything' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'cron_not_configured',
    });
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('rejects an invalid cron secret before loading provider configuration', async () => {
    const response = await GET(request({ cronSecret: 'wrong' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(h.adminClient).not.toHaveBeenCalled();
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('runs a bounded GET reconciliation and returns only aggregate evidence', async () => {
    const response = await GET(
      request({
        cronSecret: 'valid-cron-header',
        url: 'https://inbox.example.com/api/internal/waha-outbound-reconcile?limit=7',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      scanned: 2,
      reconciled: 1,
      unresolved: 1,
      failed: 0,
    });
    expect(h.reconcile).toHaveBeenCalledWith(
      { service: true },
      { limit: 7 },
    );
  });

  it('accepts a POST JSON limit without exposing any send operation', async () => {
    await POST(
      request({
        method: 'POST',
        cronSecret: 'valid-cron-header',
        body: { limit: 3 },
      }),
    );

    expect(h.reconcile).toHaveBeenCalledWith(
      { service: true },
      { limit: 3 },
    );
  });

  it('treats a non-object JSON body as no options', async () => {
    await POST(
      new Request(
        'https://inbox.example.com/api/internal/waha-outbound-reconcile',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-cron-secret': 'valid-cron-header',
          },
          body: 'null',
        },
      ),
    );

    expect(h.reconcile).toHaveBeenCalledWith(
      { service: true },
      { limit: undefined },
    );
  });
});
