import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_AGENT_LIMITS,
  AI_AGENT_MCP_RPC,
  AI_AGENTS_MCP_FILE_PATH_PATTERN,
  AI_AGENTS_MCP_FILE_PATH_PREFIX,
} from "../../ai-agents/contract.ts";
import {
  getPlatformSupabaseBackendConfig,
  type PlatformSupabaseBackendConfig,
} from "../platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "../platform-supabase-service-client.ts";
import {
  AiAgentsMcpFailureLimiter,
  hashMcpToken,
  isSchemaMissingError,
  MCP_TOKEN_PATTERN,
  readClientAddress,
  withDeadline,
} from "./mcp-auth.ts";

/**
 * Файл документа по одноразовой ссылке (контракт §B.6): `GET /api/mcp/v1/files/<token>`.
 * Ссылку выдаёт инструмент `get_document_file`; в базе лежит только SHA-256 токена,
 * срок — 10 минут и 3 использования. Маршрут не проверяет IP (адрес песочницы
 * Anthropic не документирован): защита — сама ссылка-капабилити. Неудачные
 * обращения считаются по адресу. В журнал приложения — только счётчики.
 */

type LogValue = string | number | boolean;

const RESPONSE_HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } as const;
const DEFAULT_RPC_DEADLINE_MS = 8_000;
const DEFAULT_STORAGE_DEADLINE_MS = 25_000;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/i;

export type AiAgentsMcpFileDependencies = Readonly<{
  createServiceClient(config: PlatformSupabaseBackendConfig): Pick<SupabaseClient, "schema" | "storage">;
  environment: Readonly<Record<string, string | undefined>>;
  failureLimiter: AiAgentsMcpFailureLimiter;
  log(entry: Readonly<Record<string, LogValue>>): void;
  now(): number;
  rpcDeadlineMs: number;
  storageDeadlineMs: number;
}>;

export type AiAgentsMcpFileRouteContext = Readonly<{
  params?: Promise<{ token?: string }> | { token?: string };
}>;

function defaultLog(entry: Readonly<Record<string, LogValue>>): void {
  console.info(JSON.stringify(entry));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

type ResolvedFile = Readonly<{ bucket: string; path: string; mimeType: string; byteSize: number; fileName: string }>;

function parseResolvedFile(value: unknown): ResolvedFile | null {
  if (!isObject(value)) return null;
  const bucket = value.bucket;
  const path = value.path;
  const byteSize = pick(value, "byteSize", "byte_size");
  const mimeType = pick(value, "mimeType", "mime_type");
  const fileName = pick(value, "fileName", "file_name");
  if (typeof bucket !== "string" || bucket === "" || typeof path !== "string" || path === "") return null;
  if (typeof byteSize !== "number" || !Number.isFinite(byteSize) || byteSize < 0) return null;
  return {
    bucket,
    path,
    byteSize,
    mimeType: typeof mimeType === "string" && MEDIA_TYPE.test(mimeType) ? mimeType.toLowerCase() : "application/octet-stream",
    fileName: typeof fileName === "string" ? fileName : "",
  };
}

/** Заголовок `Content-Disposition: attachment` с безопасным именем (ASCII и UTF-8). */
export function attachmentDisposition(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? "";
  const ascii = base.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/^\.+/u, "").slice(0, 100);
  const encoded = encodeURIComponent(base.slice(0, 200)).replace(/['()*]/gu, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const safe = ascii === "" ? "document" : ascii;
  return encoded === "" ? `attachment; filename="${safe}"` : `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

async function readToken(request: Request, context: AiAgentsMcpFileRouteContext | undefined): Promise<string | null> {
  try {
    const params = await context?.params;
    if (params !== undefined && typeof params.token === "string") return params.token;
  } catch {
    // Без параметров маршрута токен берётся из пути.
  }
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  return AI_AGENTS_MCP_FILE_PATH_PATTERN.test(pathname) ? pathname.slice(AI_AGENTS_MCP_FILE_PATH_PREFIX.length) : null;
}

export function createAiAgentsMcpFileHandler(
  overrides: Partial<AiAgentsMcpFileDependencies> = {},
): (request: Request, context?: AiAgentsMcpFileRouteContext) => Promise<Response> {
  const deps: AiAgentsMcpFileDependencies = {
    createServiceClient: createPlatformSupabaseServiceClient,
    environment: process.env,
    failureLimiter: new AiAgentsMcpFailureLimiter(),
    log: defaultLog,
    now: Date.now,
    rpcDeadlineMs: DEFAULT_RPC_DEADLINE_MS,
    storageDeadlineMs: DEFAULT_STORAGE_DEADLINE_MS,
    ...overrides,
  };

  const handle = async (request: Request, context: AiAgentsMcpFileRouteContext | undefined): Promise<Response> => {
    const startedAt = deps.now();
    const finish = (status: number, body: BodyInit | null, reason: string, headers: Record<string, string> = {}): Response => {
      try {
        deps.log({
          event: "ai_agents_mcp_file",
          status,
          reason,
          duration_ms: Math.max(0, deps.now() - startedAt),
        });
      } catch {
        // Журнал не меняет ответа.
      }
      return new Response(body, { status, headers });
    };
    const json = (status: number, body: Record<string, unknown>, reason: string, headers: Record<string, string> = {}): Response =>
      finish(status, JSON.stringify(body), reason, { ...RESPONSE_HEADERS, ...headers });
    const notFound = (reason: string): Response => finish(404, null, reason, { "cache-control": "no-store" });
    const refuse = (reason: string, address: string): Response =>
      deps.failureLimiter.recordFailure(address)
        ? json(429, { error: "rate_limited" }, "rate_limited", { "retry-after": "60" })
        : notFound(reason);

    if (request.method !== "GET") {
      return json(405, { error: "method_not_allowed" }, "method_not_allowed", { allow: "GET" });
    }

    const address = readClientAddress(request.headers) ?? "unknown";
    if (deps.failureLimiter.isBlocked(address)) {
      return json(429, { error: "rate_limited" }, "rate_limited", { "retry-after": "60" });
    }

    const token = await readToken(request, context);
    if (token === null || !MCP_TOKEN_PATTERN.test(token)) return refuse("bad_token", address);

    let config: PlatformSupabaseBackendConfig;
    try {
      config = getPlatformSupabaseBackendConfig(deps.environment as NodeJS.ProcessEnv);
    } catch {
      return json(503, { error: "not_configured" }, "not_configured");
    }
    const client = deps.createServiceClient(config);

    let resolved: { data: unknown; error: unknown };
    try {
      resolved = (await withDeadline(
        client.schema("platform").rpc(AI_AGENT_MCP_RPC.fileResolve, { p_token_sha256: hashMcpToken(token) }),
        deps.rpcDeadlineMs,
      )) as { data: unknown; error: unknown };
    } catch {
      return json(503, { error: "unavailable" }, "database_unavailable");
    }
    if (resolved.error) {
      const error = isObject(resolved.error) ? resolved.error : {};
      if (error.code === "P0002" || error.message === "not_found") return refuse("not_found", address);
      return isSchemaMissingError(resolved.error)
        ? json(503, { error: "not_configured" }, "schema_missing")
        : json(503, { error: "unavailable" }, "database_unavailable");
    }
    const file = parseResolvedFile(resolved.data);
    if (file === null) return refuse("not_found", address);

    let downloaded: { data: Blob | null; error: unknown };
    try {
      downloaded = (await withDeadline(
        client.storage.from(file.bucket).download(file.path),
        deps.storageDeadlineMs,
      )) as { data: Blob | null; error: unknown };
    } catch {
      return json(503, { error: "unavailable" }, "storage_unavailable");
    }
    if (downloaded.error || !downloaded.data) {
      const message = isObject(downloaded.error) && typeof downloaded.error.message === "string" ? downloaded.error.message : "";
      return /not.?found/iu.test(message) ? notFound("object_missing") : json(503, { error: "unavailable" }, "storage_unavailable");
    }
    const blob = downloaded.data;
    if (blob.size > AI_AGENT_LIMITS.fileMaxBytes) return json(413, { error: "file_too_large" }, "file_too_large");

    return finish(200, blob, "served", {
      "content-type": file.mimeType,
      "content-disposition": attachmentDisposition(file.fileName),
      "content-length": String(blob.size),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  };

  return async (request: Request, context?: AiAgentsMcpFileRouteContext): Promise<Response> => {
    try {
      return await handle(request, context);
    } catch {
      try {
        deps.log({ event: "ai_agents_mcp_file", status: 503, reason: "internal_error", duration_ms: 0 });
      } catch {
        // Журнал не меняет ответа.
      }
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: RESPONSE_HEADERS });
    }
  };
}
