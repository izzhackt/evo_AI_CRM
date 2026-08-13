import "server-only";

import {
  parsePlatformOperationalSignals,
  type PlatformOperationalSignals,
} from "../platform-operational-signals.ts";
import type { PlatformObservabilityEnabledConfig } from "./platform-observability-config.ts";

const OPERATIONAL_SIGNALS_RPC = "platform_operational_signals_v1";
const MAX_RPC_RESPONSE_BYTES = 64 * 1024;
const LOWERCASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type PlatformOperationalSignalsTransport = (
  config: PlatformObservabilityEnabledConfig,
  requestId: string,
) => Promise<PlatformOperationalSignals>;

export type PlatformOperationalSignalsCollector =
  PlatformOperationalSignalsTransport;

export class PlatformOperationalSignalsCollectionError extends Error {
  constructor() {
    super("Platform operational signals are unavailable.");
    this.name = "PlatformOperationalSignalsCollectionError";
  }
}

function fail(): never {
  throw new PlatformOperationalSignalsCollectionError();
}

function isCanonicalRequestId(value: string): boolean {
  return value !== NIL_UUID && LOWERCASE_UUID_PATTERN.test(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0].trim() !== "application/json") return fail();

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_RPC_RESPONSE_BYTES)
  ) {
    return fail();
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const reader = response.body?.getReader();
  if (!reader) return fail();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_RPC_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return fail();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(body) as unknown;
  } catch {
    return fail();
  }
}

export function createPlatformOperationalSignalsTransport(
  fetchImplementation: FetchLike = fetch,
): PlatformOperationalSignalsTransport {
  return async (config, requestId) => {
    if (!isCanonicalRequestId(requestId)) return fail();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.rpcTimeoutMs);

    try {
      const headers = new Headers({
        accept: "application/json",
        "accept-profile": "platform",
        apikey: config.supabaseSecretKey,
        authorization: `Bearer ${config.supabaseSecretKey}`,
        "content-profile": "platform",
        "content-type": "application/json",
      });
      const response = await fetchImplementation(
        `${config.supabaseUrl}/rest/v1/rpc/${OPERATIONAL_SIGNALS_RPC}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ p_request_id: requestId }),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );

      if (response.status !== 200) return fail();
      return parsePlatformOperationalSignals(await readBoundedJson(response));
    } catch (error) {
      if (error instanceof PlatformOperationalSignalsCollectionError) throw error;
      return fail();
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createPlatformOperationalSignalsCollector(
  transport: PlatformOperationalSignalsTransport,
): PlatformOperationalSignalsCollector {
  let inFlight: Promise<PlatformOperationalSignals> | null = null;

  return (config, requestId) => {
    if (inFlight) return inFlight;

    const collection = Promise.resolve().then(() => transport(config, requestId));
    inFlight = collection;
    const clear = () => {
      if (inFlight === collection) inFlight = null;
    };
    void collection.then(clear, clear);
    return collection;
  };
}

export const collectPlatformOperationalSignals =
  createPlatformOperationalSignalsCollector(
    createPlatformOperationalSignalsTransport(),
  );
