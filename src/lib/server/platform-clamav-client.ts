import "server-only";

import { createConnection, type Socket } from "node:net";

export const PLATFORM_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const PLATFORM_CLAMAV_DEFAULT_PORT = 3310;
export const PLATFORM_CLAMAV_DEFAULT_CHUNK_BYTES = 64 * 1024;

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4_096;

export type PlatformClamAvErrorCode =
  | "aborted"
  | "configuration_invalid"
  | "connection_closed"
  | "connection_failed"
  | "daemon_error"
  | "payload_empty"
  | "payload_too_large"
  | "response_malformed"
  | "response_too_large"
  | "stream_limit_exceeded"
  | "timeout";

export class PlatformClamAvError extends Error {
  readonly code: PlatformClamAvErrorCode;
  readonly retryable: boolean;

  constructor(code: PlatformClamAvErrorCode, retryable: boolean) {
    super(`ClamAV request failed: ${code}`);
    this.name = "PlatformClamAvError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type PlatformClamAvScanResult =
  | { status: "clean" }
  | { status: "infected"; signature: string };

export interface PlatformClamAvReadiness {
  ready: true;
  version: string;
}

export interface PlatformClamAvClientOptions {
  host: string;
  port?: number;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  maxBytes?: number;
  chunkBytes?: number;
  maxResponseBytes?: number;
}

interface NormalizedOptions {
  host: string;
  port: number;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  maxBytes: number;
  chunkBytes: number;
  maxResponseBytes: number;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new PlatformClamAvError("configuration_invalid", false);
  }
  return candidate;
}

function normalizeOptions(options: PlatformClamAvClientOptions): NormalizedOptions {
  if (
    typeof options.host !== "string" ||
    options.host.length === 0 ||
    options.host.length > 253 ||
    options.host !== options.host.trim() ||
    /[\s\0/]/u.test(options.host)
  ) {
    throw new PlatformClamAvError("configuration_invalid", false);
  }

  const maxBytes = boundedInteger(
    options.maxBytes,
    PLATFORM_DOCUMENT_MAX_BYTES,
    1,
    PLATFORM_DOCUMENT_MAX_BYTES,
  );

  return {
    host: options.host,
    port: boundedInteger(
      options.port,
      PLATFORM_CLAMAV_DEFAULT_PORT,
      1,
      65_535,
    ),
    connectTimeoutMs: boundedInteger(
      options.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
      10,
      60_000,
    ),
    responseTimeoutMs: boundedInteger(
      options.responseTimeoutMs,
      DEFAULT_RESPONSE_TIMEOUT_MS,
      10,
      300_000,
    ),
    maxBytes,
    chunkBytes: boundedInteger(
      options.chunkBytes,
      PLATFORM_CLAMAV_DEFAULT_CHUNK_BYTES,
      1_024,
      1024 * 1024,
    ),
    maxResponseBytes: boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      64,
      65_536,
    ),
  };
}

function decodeReply(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PlatformClamAvError("response_malformed", true);
  }
}

function oneReplyRecord(response: string): string {
  if (
    response.length === 0 ||
    response.length > DEFAULT_MAX_RESPONSE_BYTES ||
    /[\0\r\n\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(response)
  ) {
    throw new PlatformClamAvError("response_malformed", true);
  }
  return response;
}

export function parseClamAvScanResponse(response: string): PlatformClamAvScanResult {
  const record = oneReplyRecord(response);
  if (record === "stream: OK") return { status: "clean" };

  const infected = /^stream: ([A-Za-z0-9][A-Za-z0-9._:+@-]{0,199}) FOUND$/u.exec(
    record,
  );
  if (infected) {
    return { status: "infected", signature: infected[1] };
  }

  if (
    record === "INSTREAM size limit exceeded. ERROR" ||
    record === "stream: INSTREAM size limit exceeded. ERROR"
  ) {
    throw new PlatformClamAvError("stream_limit_exceeded", false);
  }

  if (/^(?:stream: )?.+ ERROR$/u.test(record)) {
    throw new PlatformClamAvError("daemon_error", true);
  }

  throw new PlatformClamAvError("response_malformed", true);
}

export function buildClamAvInstreamFrames(
  bytes: Uint8Array,
  chunkBytes: number = PLATFORM_CLAMAV_DEFAULT_CHUNK_BYTES,
): Buffer[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new PlatformClamAvError("payload_empty", false);
  }
  if (bytes.byteLength > PLATFORM_DOCUMENT_MAX_BYTES) {
    throw new PlatformClamAvError("payload_too_large", false);
  }
  boundedInteger(chunkBytes, chunkBytes, 1_024, 1024 * 1024);

  const frames: Buffer[] = [Buffer.from("zINSTREAM\0", "ascii")];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength));
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(chunk.byteLength, 0);
    frames.push(header, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  frames.push(Buffer.alloc(4));
  return frames;
}

function platformErrorFromSocket(error: unknown): PlatformClamAvError {
  if (error instanceof PlatformClamAvError) return error;
  return new PlatformClamAvError("connection_failed", true);
}

async function writeSocketFrame(socket: Socket, frame: Buffer): Promise<void> {
  if (socket.write(frame)) return;
  await new Promise<void>((resolve, reject) => {
    socket.once("drain", resolve);
    socket.once("error", reject);
  });
}

async function requestClamAv(
  options: NormalizedOptions,
  frames: readonly Buffer[],
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new PlatformClamAvError("aborted", true);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let connected = false;
    let response = Buffer.alloc(0);
    const socket = createConnection({ host: options.host, port: options.port });

    const finish = (error?: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      signal?.removeEventListener("abort", onAbort);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(platformErrorFromSocket(error));
      else resolve(value ?? "");
    };

    const onAbort = () => finish(new PlatformClamAvError("aborted", true));
    signal?.addEventListener("abort", onAbort, { once: true });

    const connectTimer = setTimeout(
      () => finish(new PlatformClamAvError("timeout", true)),
      options.connectTimeoutMs,
    );
    let responseTimer = setTimeout(() => undefined, 0);
    clearTimeout(responseTimer);

    socket.once("connect", async () => {
      connected = true;
      clearTimeout(connectTimer);
      responseTimer = setTimeout(
        () => finish(new PlatformClamAvError("timeout", true)),
        options.responseTimeoutMs,
      );
      try {
        for (const frame of frames) await writeSocketFrame(socket, frame);
      } catch (error) {
        finish(error);
      }
    });

    socket.on("data", (chunk: Buffer) => {
      if (response.byteLength + chunk.byteLength > options.maxResponseBytes + 1) {
        finish(new PlatformClamAvError("response_too_large", true));
        return;
      }
      response = Buffer.concat([response, chunk]);
      const terminator = response.indexOf(0);
      if (terminator === -1) return;
      if (terminator !== response.byteLength - 1) {
        finish(new PlatformClamAvError("response_malformed", true));
        return;
      }
      try {
        finish(undefined, decodeReply(response.subarray(0, terminator)));
      } catch (error) {
        finish(error);
      }
    });
    socket.once("end", () => {
      if (!settled) finish(new PlatformClamAvError("connection_closed", true));
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled && connected) {
        finish(new PlatformClamAvError("connection_closed", true));
      }
    });
  });
}

export class PlatformClamAvClient {
  readonly #options: NormalizedOptions;

  constructor(options: PlatformClamAvClientOptions) {
    this.#options = normalizeOptions(options);
  }

  async ping(signal?: AbortSignal): Promise<void> {
    const response = await requestClamAv(
      this.#options,
      [Buffer.from("zPING\0", "ascii")],
      signal,
    );
    if (response !== "PONG") {
      throw new PlatformClamAvError("response_malformed", true);
    }
  }

  async version(signal?: AbortSignal): Promise<string> {
    const response = oneReplyRecord(
      await requestClamAv(
        this.#options,
        [Buffer.from("zVERSION\0", "ascii")],
        signal,
      ),
    );
    if (!/^ClamAV [A-Za-z0-9][A-Za-z0-9 ._+\-/:()]{0,510}$/u.test(response)) {
      throw new PlatformClamAvError("response_malformed", true);
    }
    return response;
  }

  async readiness(signal?: AbortSignal): Promise<PlatformClamAvReadiness> {
    await this.ping(signal);
    return { ready: true, version: await this.version(signal) };
  }

  async scan(
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PlatformClamAvScanResult> {
    if (bytes.byteLength > this.#options.maxBytes) {
      throw new PlatformClamAvError("payload_too_large", false);
    }
    const frames = buildClamAvInstreamFrames(bytes, this.#options.chunkBytes);
    return parseClamAvScanResponse(
      await requestClamAv(this.#options, frames, signal),
    );
  }
}
