import type { InboxProbeConfig } from './config';

const REQUEST_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_VERSION_BYTES = 256;

export type InboxProbeStatus = 'ready' | 'failed' | 'unavailable' | 'missing';

type JsonResponse = Readonly<{
  status: number;
  mediaType: string | null;
  value: unknown;
}>;

class InvalidProbeResponseError extends Error {}

function isJsonMediaType(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return Boolean(
    mediaType === 'application/json' ||
    (mediaType?.startsWith('application/') && mediaType.endsWith('+json'))
  );
}

async function readBoundedJson(response: Response): Promise<JsonResponse> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength)) {
    if (Number(contentLength) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new RangeError('response_limit');
    }
  }

  if (!response.body) {
    return {
      status: response.status,
      mediaType: response.headers.get('content-type'),
      value: null,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new RangeError('response_limit');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return {
      status: response.status,
      mediaType: response.headers.get('content-type'),
      value: JSON.parse(text) as unknown,
    };
  } catch {
    throw new InvalidProbeResponseError('invalid_json');
  }
}

async function requestJson(
  url: string,
  headers: HeadersInit
): Promise<JsonResponse | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status !== 200) {
      await response.body?.cancel();
      return {
        status: response.status,
        mediaType: response.headers.get('content-type'),
        value: null,
      };
    }

    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof InvalidProbeResponseError) {
      return { status: 200, mediaType: null, value: undefined };
    }
    return null;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function probeSupabaseHealth(
  config: InboxProbeConfig['supabase']
): Promise<InboxProbeStatus> {
  if (!config) {
    return 'missing';
  }

  const response = await requestJson(`${config.origin}/auth/v1/health`, {
    apikey: config.apiKey,
  });
  if (!response) {
    return 'unavailable';
  }
  if (
    response.status !== 200 ||
    !isJsonMediaType(response.mediaType) ||
    !isJsonObject(response.value)
  ) {
    return 'failed';
  }

  const version = response.value.version;
  return response.value.name === 'GoTrue' &&
    typeof version === 'string' &&
    version.trim().length > 0 &&
    new TextEncoder().encode(version).byteLength <= MAX_VERSION_BYTES
    ? 'ready'
    : 'failed';
}

export async function probeWahaHealth(
  config: InboxProbeConfig['waha']
): Promise<InboxProbeStatus> {
  if (!config) {
    return 'missing';
  }

  const response = await requestJson(`${config.origin}/health`, {
    'x-api-key': config.apiKey,
  });
  if (!response) {
    return 'unavailable';
  }
  if (
    response.status !== 200 ||
    !isJsonMediaType(response.mediaType) ||
    !isJsonObject(response.value)
  ) {
    return 'failed';
  }

  return response.value.status === 'ok' ? 'ready' : 'failed';
}
