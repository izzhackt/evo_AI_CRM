import {
  readInboxObservabilitySecret,
  readInboxProbeConfig,
} from '@/lib/observability/config';
import {
  probeSupabaseHealth,
  probeWahaHealth,
} from '@/lib/observability/health-probes';
import { logInboxReadinessRequest } from '@/lib/observability/logging';
import { authenticateReadinessRequest } from '@/lib/observability/request-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

function hiddenNotFound(): Response {
  return new Response(null, { status: 404, headers: SAFE_HEADERS });
}

export const HEAD = hiddenNotFound;
export const POST = hiddenNotFound;
export const PUT = hiddenNotFound;
export const PATCH = hiddenNotFound;
export const DELETE = hiddenNotFound;
export const OPTIONS = hiddenNotFound;

export async function GET(request: Request): Promise<Response> {
  const secret = readInboxObservabilitySecret();
  if (!secret) {
    return hiddenNotFound();
  }

  const nowMs = Date.now();
  const authenticated = authenticateReadinessRequest(request, secret, nowMs);
  if (!authenticated) {
    return hiddenNotFound();
  }

  const config = readInboxProbeConfig();
  const [supabase, waha] = await Promise.all([
    probeSupabaseHealth(config.supabase),
    probeWahaHealth(config.waha),
  ]);
  const ready = supabase === 'ready' && waha === 'ready';
  const status = ready ? 200 : 503;

  logInboxReadinessRequest({
    requestId: authenticated.requestId,
    status,
    startedAtMs: nowMs,
    completedAtMs: Date.now(),
  });

  return Response.json(
    {
      schema_version: 'p7b-v1',
      ok: ready,
      status: ready ? 'ready' : 'not_ready',
      service: 'evo-inbox-companion',
      request_id: authenticated.requestId,
      observed_at: new Date(nowMs).toISOString(),
      components: {
        supabase: { status: supabase, age_seconds: null },
        waha: { status: waha, age_seconds: null },
      },
    },
    {
      status,
      headers: SAFE_HEADERS,
    }
  );
}
