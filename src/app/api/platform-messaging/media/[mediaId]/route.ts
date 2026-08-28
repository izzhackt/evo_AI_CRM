import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server.js";

import { parsePlatformRouteUuid } from "../../../../../lib/platform-communications.ts";

type RouteActorResult =
  Awaited<
    ReturnType<typeof import("../../../../../lib/platform-auth").resolvePlatformActor>
  >;

type GrantDownloadResponse = Readonly<{
  mediaDownloadGrantId: string;
  expiresAt: string;
  storageApiServiceSignRequired: true;
}>;

type ConsumeDownloadResponse = Readonly<{
  organizationId: string;
  mediaId: string;
  mediaDownloadGrantId: string;
  bucketId: string;
  objectName: string;
  maxSignedUrlExpiresInSeconds: number;
  mimeType: string | null;
  fileName: string | null;
}>;

const PRIVATE_MEDIA_BUCKET = "platform-whatsapp-media";
const OPAQUE_MEDIA_OBJECT_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;

type RouteDependencies = Readonly<{
  loadActor(): Promise<RouteActorResult>;
  grantDownload(input: Readonly<{
    organizationId: string;
    mediaId: string;
    requestId: string;
  }>): Promise<GrantDownloadResponse | null>;
  consumeGrant(input: Readonly<{
    mediaDownloadGrantId: string;
    requestId: string;
  }>): Promise<ConsumeDownloadResponse | null>;
  createSignedUrl(input: Readonly<{
    bucketId: string;
    objectName: string;
    expiresInSeconds: number;
    downloadFileName: string | null;
  }>): Promise<string | null>;
  createRequestId(): string;
}>;

function genericResponse(status: 403 | 404 | 503) {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function parseGrantDownloadResponse(value: unknown): GrantDownloadResponse | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    parsePlatformRouteUuid((value as { media_download_grant_id?: unknown }).media_download_grant_id) === null ||
    !isValidIsoTimestamp((value as { expires_at?: unknown }).expires_at) ||
    (value as { signed_url?: unknown }).signed_url !== null ||
    (value as { storage_api_service_sign_required?: unknown }).storage_api_service_sign_required !== true
  ) {
    return null;
  }

  return Object.freeze({
    mediaDownloadGrantId: (value as { media_download_grant_id: string }).media_download_grant_id.toLowerCase(),
    expiresAt: (value as { expires_at: string }).expires_at,
    storageApiServiceSignRequired: true,
  });
}

function parseConsumeDownloadResponse(value: unknown): ConsumeDownloadResponse | null {
  const organizationId = parsePlatformRouteUuid(
    (value as { organization_id?: unknown } | null)?.organization_id,
  );
  const mediaId = parsePlatformRouteUuid(
    (value as { media_id?: unknown } | null)?.media_id,
  );
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    organizationId === null ||
    mediaId === null ||
    parsePlatformRouteUuid((value as { media_download_grant_id?: unknown }).media_download_grant_id) === null ||
    (value as { bucket_id?: unknown }).bucket_id !== PRIVATE_MEDIA_BUCKET ||
    typeof (value as { object_name?: unknown }).object_name !== "string" ||
    !OPAQUE_MEDIA_OBJECT_PATTERN.test((value as { object_name: string }).object_name) ||
    typeof (value as { max_signed_url_expires_in_seconds?: unknown }).max_signed_url_expires_in_seconds !== "number" ||
    !Number.isSafeInteger((value as { max_signed_url_expires_in_seconds: number }).max_signed_url_expires_in_seconds) ||
    (value as { max_signed_url_expires_in_seconds: number }).max_signed_url_expires_in_seconds < 1 ||
    (value as { max_signed_url_expires_in_seconds: number }).max_signed_url_expires_in_seconds > 60 ||
    ((value as { mime_type?: unknown }).mime_type !== null &&
      typeof (value as { mime_type?: unknown }).mime_type !== "string") ||
    ((value as { file_name?: unknown }).file_name !== null &&
      typeof (value as { file_name?: unknown }).file_name !== "string") ||
    (value as { signed_url?: unknown }).signed_url !== null
  ) {
    return null;
  }

  return Object.freeze({
    organizationId,
    mediaId,
    mediaDownloadGrantId: (value as { media_download_grant_id: string }).media_download_grant_id.toLowerCase(),
    bucketId: PRIVATE_MEDIA_BUCKET,
    objectName: (value as { object_name: string }).object_name,
    maxSignedUrlExpiresInSeconds: (value as { max_signed_url_expires_in_seconds: number }).max_signed_url_expires_in_seconds,
    mimeType:
      typeof (value as { mime_type?: unknown }).mime_type === "string"
        ? (value as { mime_type: string }).mime_type.trim()
        : null,
    fileName:
      typeof (value as { file_name?: unknown }).file_name === "string"
        ? (value as { file_name: string }).file_name.trim()
        : null,
  });
}

async function createDefaultDependencies(): Promise<RouteDependencies> {
  const [{ resolvePlatformActor }, { createSupabaseServerContext }] =
    await Promise.all([
      import("../../../../../lib/platform-auth.ts"),
      import("../../../../../lib/supabase/server.ts"),
    ]);
  const context = await createSupabaseServerContext();
  const [{ getPlatformMessagingBackendConfig }, { createPlatformSupabaseServiceClient }] =
    await Promise.all([
      import("../../../../../lib/server/platform-messaging-backend-config.ts"),
      import("../../../../../lib/server/platform-supabase-service-client.ts"),
    ]);
  const backend = getPlatformMessagingBackendConfig();
  const serviceClient = createPlatformSupabaseServiceClient(backend);

  return {
    async loadActor() {
      return resolvePlatformActor();
    },
    async grantDownload(input) {
      const response = await context.client
        .schema("platform")
        .rpc("grant_communication_media_download", {
          p_organization_id: input.organizationId,
          p_media_id: input.mediaId,
          p_request_id: input.requestId,
        });
      if (response.error) return null;
      return parseGrantDownloadResponse(response.data);
    },
    async consumeGrant(input) {
      const response = await serviceClient
        .schema("platform")
        .rpc("consume_communication_media_download_grant", {
          p_media_download_grant_id: input.mediaDownloadGrantId,
          p_request_id: input.requestId,
        });
      if (response.error) return null;
      return parseConsumeDownloadResponse(response.data);
    },
    async createSignedUrl(input) {
      const response = await serviceClient.storage
        .from(input.bucketId)
        .createSignedUrl(
          input.objectName,
          input.expiresInSeconds,
          input.downloadFileName ? { download: input.downloadFileName } : undefined,
        );
      if (response.error || typeof response.data?.signedUrl !== "string") {
        return null;
      }
      return response.data.signedUrl;
    },
    createRequestId() {
      return randomUUID();
    },
  };
}

export function createPlatformMessagingMediaHandler(
  dependenciesFactory: (() => Promise<RouteDependencies>) | null = null,
) {
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ mediaId: string }> },
  ) {
    const { mediaId: rawMediaId } = await params;
    const mediaId = parsePlatformRouteUuid(rawMediaId);
    if (mediaId === null) return genericResponse(404);

    let dependencies: RouteDependencies;
    try {
      dependencies = dependenciesFactory
        ? await dependenciesFactory()
        : await createDefaultDependencies();
    } catch {
      return genericResponse(503);
    }

    const actor = await dependencies.loadActor();
    if (actor.status !== "authenticated") return genericResponse(404);
    if (
      actor.actor.platformRole !== "admin" &&
      actor.actor.platformRole !== "sales" &&
      actor.actor.platformRole !== "admissions"
    ) {
      return genericResponse(403);
    }

    const grantRequestId = dependencies.createRequestId();
    const grant = await dependencies.grantDownload({
      organizationId: actor.actor.organizationId,
      mediaId,
      requestId: grantRequestId,
    });
    if (grant === null) return genericResponse(404);

    const consume = await dependencies.consumeGrant({
      mediaDownloadGrantId: grant.mediaDownloadGrantId,
      requestId: dependencies.createRequestId(),
    });
    if (
      consume === null ||
      consume.mediaDownloadGrantId !== grant.mediaDownloadGrantId ||
      consume.organizationId !== actor.actor.organizationId ||
      consume.mediaId !== mediaId ||
      consume.bucketId !== PRIVATE_MEDIA_BUCKET ||
      !OPAQUE_MEDIA_OBJECT_PATTERN.test(consume.objectName)
    ) {
      return genericResponse(404);
    }

    const signedUrl = await dependencies.createSignedUrl({
      bucketId: consume.bucketId,
      objectName: consume.objectName,
      expiresInSeconds: consume.maxSignedUrlExpiresInSeconds,
      downloadFileName:
        request.nextUrl.searchParams.get("download") === "1"
          ? consume.fileName
          : null,
    });
    if (signedUrl === null) return genericResponse(503);

    const response = NextResponse.redirect(signedUrl, { status: 307 });
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPlatformMessagingMediaHandler();
