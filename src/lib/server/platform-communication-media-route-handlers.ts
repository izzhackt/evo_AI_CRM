import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fixedRoleCan } from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const MEDIA_BUCKET_ID = "platform-whatsapp-media";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const SIGNED_TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;
const MAX_SIGNED_TOKEN_BYTES = 8_192;
const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

type CommunicationMediaAuthorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "unavailable"; actor: null }>;

export type PlatformCommunicationMediaRouteDependencies = Readonly<{
  authorize(capability: "messaging.read"): Promise<CommunicationMediaAuthorization>;
  createUserClient(): Promise<SupabaseClient>;
  createServiceClient(): SupabaseClient;
  requestId(): string;
  supabaseOrigin(): string;
}>;

type MediaDownloadGrant = Readonly<{
  id: string;
}>;

type MediaDownloadConsumption = Readonly<{
  bucketId: typeof MEDIA_BUCKET_ID;
  objectName: string;
  expiresInSeconds: number;
}>;

type MediaRouteContext = Readonly<{
  params: Promise<Readonly<{ mediaId: string }>>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : null;
}

function secureJsonResponse(status: number, code: string): Response {
  return Response.json(
    { error: code },
    { status, headers: SECURITY_HEADERS },
  );
}

function authorizationResponse(
  status: Exclude<CommunicationMediaAuthorization["status"], "authorized">,
): Response {
  if (status === "anonymous") {
    return secureJsonResponse(401, "authentication_required");
  }
  if (status === "forbidden") return secureJsonResponse(403, "forbidden");
  return secureJsonResponse(503, "media_unavailable");
}

function normalizeGrant(value: unknown): MediaDownloadGrant | null {
  if (!isRecord(value) || !exactKeys(value, [
    "media_download_grant_id",
    "expires_at",
    "signed_url",
    "storage_api_service_sign_required",
  ])) return null;
  const id = uuid(value.media_download_grant_id);
  if (
    !id || !timestamp(value.expires_at) || value.signed_url !== null
    || value.storage_api_service_sign_required !== true
  ) return null;
  return Object.freeze({ id });
}

function normalizeConsumption(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    mediaId: string;
    grantId: string;
  }>,
): MediaDownloadConsumption | null {
  if (!isRecord(value) || !exactKeys(value, [
    "organization_id",
    "media_download_grant_id",
    "media_id",
    "bucket_id",
    "object_name",
    "max_signed_url_expires_in_seconds",
    "mime_type",
    "file_name",
    "signed_url",
  ])) return null;
  const organizationId = uuid(value.organization_id);
  const mediaId = uuid(value.media_id);
  const grantId = uuid(value.media_download_grant_id);
  const expiresInSeconds = value.max_signed_url_expires_in_seconds;
  if (
    organizationId !== expected.organizationId
    || mediaId !== expected.mediaId
    || grantId !== expected.grantId
    || value.bucket_id !== MEDIA_BUCKET_ID
    || typeof value.object_name !== "string"
    || !OBJECT_NAME_PATTERN.test(value.object_name)
    || !Number.isSafeInteger(expiresInSeconds)
    || (expiresInSeconds as number) < 1
    || (expiresInSeconds as number) > 60
    || typeof value.mime_type !== "string"
    || typeof value.file_name !== "string"
    || value.signed_url !== null
  ) return null;
  return Object.freeze({
    bucketId: MEDIA_BUCKET_ID,
    objectName: value.object_name,
    expiresInSeconds: expiresInSeconds as number,
  });
}

function safeSupabaseOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "[::1]";
    if (
      parsed.username || parsed.password || parsed.pathname !== "/"
      || parsed.search || parsed.hash || parsed.origin !== value
      || (parsed.protocol !== "https:"
        && !(loopback && parsed.protocol === "http:"))
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function safeSignedUrl(
  value: unknown,
  configuredOrigin: string,
  objectName: string,
  download: boolean,
): string | null {
  if (typeof value !== "string") return null;
  const supabaseOrigin = safeSupabaseOrigin(configuredOrigin);
  if (!supabaseOrigin) return null;
  try {
    const parsed = new URL(value);
    const tokenValues = parsed.searchParams.getAll("token");
    const downloadValues = parsed.searchParams.getAll("download");
    const keys = [...parsed.searchParams.keys()];
    const expectedPath =
      `/storage/v1/object/sign/${MEDIA_BUCKET_ID}/${objectName}`;
    if (
      parsed.origin !== supabaseOrigin || parsed.username || parsed.password
      || parsed.pathname !== expectedPath || parsed.hash
      || tokenValues.length !== 1 || !SIGNED_TOKEN_PATTERN.test(tokenValues[0] ?? "")
      || Buffer.byteLength(tokenValues[0] ?? "", "utf8") > MAX_SIGNED_TOKEN_BYTES
      || (download
        ? downloadValues.length !== 1 || downloadValues[0] !== ""
        : downloadValues.length !== 0)
      || keys.some((key) => key !== "token" && key !== "download")
      || keys.length !== (download ? 2 : 1)
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function exactDownloadMode(request: Request): boolean | null {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) return false;
  if (
    keys.length === 1 && keys[0] === "download"
    && url.searchParams.getAll("download").length === 1
    && url.searchParams.get("download") === "1"
  ) return true;
  return null;
}

async function defaultAuthorize(): Promise<CommunicationMediaAuthorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (!fixedRoleCan(result.actor.authorityRole, "messaging.read")) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

const defaultDependencies: PlatformCommunicationMediaRouteDependencies = {
  authorize: defaultAuthorize,
  createUserClient: async () => {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return createSupabaseServerClient();
  },
  createServiceClient: () =>
    createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  requestId: randomUUID,
  supabaseOrigin: () =>
    new URL(getPlatformSupabaseBackendConfig().supabaseUrl).origin,
};

export function createPlatformCommunicationMediaDownloadHandler(
  dependencies: PlatformCommunicationMediaRouteDependencies = defaultDependencies,
) {
  return async function GET(
    request: Request,
    context: MediaRouteContext,
  ): Promise<Response> {
    try {
      const authorization = await dependencies.authorize("messaging.read");
      if (authorization.status !== "authorized") {
        return authorizationResponse(authorization.status);
      }
      const mediaId = uuid((await context.params).mediaId);
      if (!mediaId) return secureJsonResponse(400, "invalid_media_request");
      const download = exactDownloadMode(request);
      if (download === null) {
        return secureJsonResponse(400, "invalid_media_request");
      }

      const userClient = await dependencies.createUserClient();
      const grantResponse = await userClient.schema("platform").rpc(
        "grant_communication_media_download",
        {
          p_organization_id: authorization.actor.organizationId,
          p_media_id: mediaId,
          p_request_id: dependencies.requestId(),
        },
      );
      if (grantResponse.error) {
        return secureJsonResponse(403, "media_not_authorized");
      }
      const grant = normalizeGrant(grantResponse.data);
      if (!grant) return secureJsonResponse(503, "media_unavailable");

      const serviceClient = dependencies.createServiceClient();
      const consumptionResponse = await serviceClient.schema("platform").rpc(
        "consume_communication_media_download_grant",
        {
          p_media_download_grant_id: grant.id,
          p_request_id: dependencies.requestId(),
        },
      );
      if (consumptionResponse.error) {
        return secureJsonResponse(403, "media_grant_invalid");
      }
      const consumption = normalizeConsumption(consumptionResponse.data, {
        organizationId: authorization.actor.organizationId,
        mediaId,
        grantId: grant.id,
      });
      if (!consumption) return secureJsonResponse(503, "media_unavailable");

      const signedResponse = await serviceClient.storage
        .from(consumption.bucketId)
        .createSignedUrl(
          consumption.objectName,
          consumption.expiresInSeconds,
          download ? { download: true } : undefined,
        );
      if (signedResponse.error) {
        return secureJsonResponse(503, "media_unavailable");
      }
      const signedUrl = safeSignedUrl(
        signedResponse.data.signedUrl,
        dependencies.supabaseOrigin(),
        consumption.objectName,
        download,
      );
      if (!signedUrl) return secureJsonResponse(503, "media_unavailable");

      return new Response(null, {
        status: 307,
        headers: { ...SECURITY_HEADERS, Location: signedUrl },
      });
    } catch {
      return secureJsonResponse(503, "media_unavailable");
    }
  };
}
