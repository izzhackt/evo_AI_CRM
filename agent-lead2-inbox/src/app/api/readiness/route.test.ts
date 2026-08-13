import { createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const OBSERVABILITY_SECRET = 'inbox-observability-secret-1234567890';
const NOW = new Date('2026-08-13T10:00:00.000Z');

function signedRequest(
  path = '/api/readiness',
  timestampMs = NOW.getTime()
): Request {
  const timestamp = String(timestampMs);
  const signature = createHmac('sha256', OBSERVABILITY_SECRET)
    .update(`GET\n${path}\n${REQUEST_ID}\n${timestamp}`)
    .digest('hex');

  return new Request(`http://localhost${path}`, {
    headers: {
      'x-evo-observability-request-id': REQUEST_ID,
      'x-evo-observability-timestamp': timestamp,
      'x-evo-observability-hmac-algorithm': 'sha256',
      'x-evo-observability-hmac': signature,
    },
  });
}

async function startJsonServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function enableObservability(): void {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED', '1');
  vi.stubEnv('EVO_INBOX_P7B_OBSERVABILITY_SECRET', OBSERVABILITY_SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-public-placeholder');
  vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', 'http://127.0.0.1:3000');
  vi.stubEnv('EVO_INBOX_WAHA_API_KEY', 'test-waha-header-placeholder');
}

describe('GET /api/readiness', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the exact ready DTO after signed strict Supabase and WAHA health probes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/health')) {
        expect(new Headers(init?.headers).get('apikey')).toBe(
          'test-public-placeholder'
        );
        return Response.json({ name: 'GoTrue', version: '2.177.0' });
      }

      expect(url).toBe('http://127.0.0.1:3000/health');
      expect(new Headers(init?.headers).get('x-api-key')).toBe(
        'test-waha-header-placeholder'
      );
      return Response.json({ status: 'ok' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    const response = await GET(signedRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({
      schema_version: 'p7b-v1',
      ok: true,
      status: 'ready',
      service: 'evo-inbox-companion',
      request_id: REQUEST_ID,
      observed_at: NOW.toISOString(),
      components: {
        supabase: { status: 'ready', age_seconds: null },
        waha: { status: 'ready', age_seconds: null },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenNthCalledWith(1, 3_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 3_000);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          cache: 'no-store',
          redirect: 'error',
          signal: expect.any(AbortSignal),
        })
      );
    }
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      event_code: 'p7b_readiness_request',
      service: 'evo-inbox-companion',
      request_id: REQUEST_ID,
      method: 'GET',
      route_template: '/api/readiness',
      status_class: '2xx',
      elapsed_ms: 0,
    });
  });

  it('proves the signed route against real loopback Supabase and WAHA HTTP stubs', async () => {
    const seen: Array<{ path: string; headerValue: string | undefined }> = [];
    const supabase = await startJsonServer((request, response) => {
      seen.push({
        path: request.url ?? '',
        headerValue: firstHeader(request.headers.apikey),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"name":"GoTrue","version":"2.177.0"}');
    });
    const waha = await startJsonServer((request, response) => {
      seen.push({
        path: request.url ?? '',
        headerValue: firstHeader(request.headers['x-api-key']),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
    });

    try {
      enableObservability();
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabase.origin);
      vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', waha.origin);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const now = Date.now();

      const response = await GET(signedRequest('/api/readiness', now));

      expect(response.status).toBe(200);
      expect(seen).toEqual([
        {
          path: '/auth/v1/health',
          headerValue: 'test-public-placeholder',
        },
        { path: '/health', headerValue: 'test-waha-header-placeholder' },
      ]);
    } finally {
      await Promise.all([supabase.close(), waha.close()]);
    }
  });

  it('normalizes a WAHA network failure to unavailable without exposing the error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/health')) {
          throw new TypeError('synthetic-waha-secret-provider-error');
        }
        return Response.json({ name: 'GoTrue', version: '2.177.0' });
      })
    );

    const response = await GET(signedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.components.waha).toEqual({
      status: 'unavailable',
      age_seconds: null,
    });
    expect(JSON.stringify(body)).not.toContain(
      'synthetic-waha-secret-provider-error'
    );
  });

  it('hides the route and performs no probe when observability is disabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubEnv('EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED', 'true');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(signedRequest());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing signature', new Request('http://localhost/api/readiness')],
    ['query string', signedRequest('/api/readiness?debug=1')],
    ['near path', signedRequest('/api/readiness/')],
    [
      'body-bearing header',
      new Request('http://localhost/api/readiness', {
        headers: {
          ...Object.fromEntries(signedRequest().headers.entries()),
          'content-length': '1',
        },
      }),
    ],
  ])('rejects %s before any dependency probe', async (_case, request) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty hidden response for another HTTP method', async () => {
    const response = await POST();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('rejects a stale signed request before any dependency probe', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW.getTime() + 300_001));
    enableObservability();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(signedRequest());

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing configuration',
      () => vi.stubEnv('EVO_INBOX_WAHA_API_KEY', ''),
      'missing',
    ],
    [
      'non-200 response',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn<typeof fetch>(async (input) =>
            String(input).endsWith('/health')
              ? Response.json({ status: 'ok' }, { status: 503 })
              : Response.json({ name: 'GoTrue', version: '2.177.0' })
          )
        ),
      'failed',
    ],
    [
      'wrong JSON media type',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn<typeof fetch>(async (input) =>
            String(input).endsWith('/health')
              ? new Response('{"status":"ok"}', {
                  headers: { 'content-type': 'text/plain' },
                })
              : Response.json({ name: 'GoTrue', version: '2.177.0' })
          )
        ),
      'failed',
    ],
    [
      'non-ok WAHA status',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn<typeof fetch>(async (input) =>
            String(input).endsWith('/health')
              ? Response.json({ status: 'shutting_down' })
              : Response.json({ name: 'GoTrue', version: '2.177.0' })
          )
        ),
      'failed',
    ],
  ])('maps WAHA %s to %s', async (_case, arrange, expectedStatus) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json({ name: 'GoTrue', version: '2.177.0' })
      )
    );
    arrange();

    const response = await GET(signedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.components.waha.status).toBe(expectedStatus);
  });

  it('rejects unsafe production origins before sending either credential', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://attacker.example');
    vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', 'http://waha.internal:3000');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(signedRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      components: {
        supabase: { status: 'missing', age_seconds: null },
        waha: { status: 'missing', age_seconds: null },
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts only the exact managed Supabase and private WAHA production origins', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://abcdefghijklmnopqrst.supabase.co'
    );
    vi.stubEnv('EVO_INBOX_WAHA_BASE_URL', 'http://evo-inbox-waha:3000');
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/auth/v1/health')
        ? Response.json({ name: 'GoTrue', version: '2.177.0' })
        : Response.json({ status: 'ok' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(signedRequest());

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://abcdefghijklmnopqrst.supabase.co/auth/v1/health',
      'http://evo-inbox-waha:3000/health',
    ]);
  });

  it('normalizes an over-limit response to unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/auth/v1/health')
          ? new Response('x'.repeat(65_537), {
              headers: { 'content-type': 'application/json' },
            })
          : Response.json({ status: 'ok' })
      )
    );

    const response = await GET(signedRequest());

    await expect(response.json()).resolves.toMatchObject({
      components: { supabase: { status: 'unavailable' } },
    });
  });

  it.each([
    ['too short', 'short-observability-secret'],
    ['leading whitespace', ` ${OBSERVABILITY_SECRET}`],
    ['over 128 UTF-8 bytes', 'x'.repeat(129)],
  ])('rejects a %s probe secret before network work', async (_case, secret) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubEnv('EVO_INBOX_P7B_OBSERVABILITY_SECRET', secret);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(signedRequest());

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'EVO_PLATFORM_P7B_OBSERVABILITY_SECRET',
    'EVO_INBOX_WAHA_API_KEY',
    'EVO_INBOX_WAHA_WEBHOOK_HMAC',
    'SUPABASE_SERVICE_ROLE_KEY',
    'EVO_AGENT_FUTURE_SECRET',
  ])('requires its secret to differ from %s', async (otherName) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    enableObservability();
    vi.stubEnv(otherName, OBSERVABILITY_SECRET);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(signedRequest());

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
