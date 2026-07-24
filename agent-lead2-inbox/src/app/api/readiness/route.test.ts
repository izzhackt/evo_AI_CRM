import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/readiness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports ready after Supabase health and the unauthenticated WAHA ping succeed', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co/');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'publishable-key');
    vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', 'http://evo-inbox-waha:3000/');
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      checks: { supabase: true, waha: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/health',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://evo-inbox-waha:3000/ping',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      'http://evo-inbox-waha:3000/health'
    );
  });

  it('fails closed without the private WAHA base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'publishable-key');
    vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', '');
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: 'not_ready',
      checks: { supabase: true, waha: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when WAHA ping is not reachable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'publishable-key');
    vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', 'http://evo-inbox-waha:3000');
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/ping')) {
        throw new Error('WAHA unavailable');
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: 'not_ready',
      checks: { supabase: true, waha: false },
    });
  });
});
